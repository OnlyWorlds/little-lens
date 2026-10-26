/**
 * A public world, read signed out through keel's keyless reader: `?world=<id>` on the world and
 * on each type's list. One request at a time (keel gives an address 60 keyless reads a minute),
 * each with its own time limit, and only the types the graph keeps and the world counts. Nothing
 * read is stored. A world that is private, unknown or no world at all is one answer: closed.
 */

import { SPATIAL_TYPES } from '@onlyworlds/sdk';
import { isElementType, type Element } from './graph';

export const API_BASE = 'https://www.onlyworlds.com/api/v2';
export const REQUEST_LIMIT_MS = 15_000;
export const PAGE_LIMIT = 1000;
/** A ceiling on pages per type, so a server that never says "no more" cannot hold the read. */
const MAX_PAGES = 200;

export interface PublicWorld {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  counts: Record<string, number>;
}

export type ReadFailure =
  | { kind: 'closed' }
  | { kind: 'slow-down'; retryAfter: number | null }
  | { kind: 'network' }
  | { kind: 'server'; status: number };

export class PublicReadError extends Error {
  constructor(readonly failure: ReadFailure) {
    super(failure.kind);
  }
}

type Fetch = typeof fetch;

/** keel's budget as its last answer stated it (`RateLimit-Remaining`, `RateLimit-Reset` in seconds). */
export interface Budget {
  remaining: number | null;
  reset: number | null;
}

function budgetOf(res: Response): Budget {
  const n = (h: string) => {
    const v = res.headers.get(h);
    const x = v === null ? NaN : Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  return { remaining: n('RateLimit-Remaining'), reset: n('RateLimit-Reset') };
}

async function getJson(url: string, fetchImpl: Fetch, signal?: AbortSignal, budget?: (b: Budget) => void): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_LIMIT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: 'GET', signal: ctl.signal, credentials: 'omit' });
    } catch {
      throw new PublicReadError({ kind: 'network' });
    }
    budget?.(budgetOf(res));
    // 401 is keel's answer while its public door is shut: from outside, a closed world like any other.
    if (res.status === 404 || res.status === 401 || res.status === 403) throw new PublicReadError({ kind: 'closed' });
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('Retry-After'));
      throw new PublicReadError({ kind: 'slow-down', retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null });
    }
    if (!res.ok) throw new PublicReadError({ kind: 'server', status: res.status });
    try {
      return await res.json();
    } catch {
      // A body cut by the time limit is the network's; one that is not JSON is the server's.
      throw new PublicReadError(ctl.signal.aborted ? { kind: 'network' } : { kind: 'server', status: res.status });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function readPublicWorldMeta(worldId: string, fetchImpl: Fetch = fetch, signal?: AbortSignal, budget?: (b: Budget) => void): Promise<PublicWorld> {
  const body = (await getJson(`${API_BASE}/world/?world=${encodeURIComponent(worldId)}`, fetchImpl, signal, budget)) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || body.id !== worldId) throw new PublicReadError({ kind: 'closed' });
  const types = ((body.counts as { types?: unknown } | undefined)?.types ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [t, n] of Object.entries(types)) if (typeof n === 'number' && n > 0) counts[t] = n;
  return { id: worldId, name: str(body.name) || 'Untitled world', description: str(body.description), imageUrl: str(body.image_url), counts };
}

/** The types to read: counted above zero, an element type, and kept by the graph. */
export function typesToRead(counts: Record<string, number>): string[] {
  const spatial = new Set<string>(SPATIAL_TYPES);
  return Object.keys(counts).filter((t) => counts[t] > 0 && isElementType(t) && !spatial.has(t)).sort();
}

/** What reading a world costs in requests, from its counts: one per thousand of each kept type. */
export function costOf(counts: Record<string, number>): number {
  return typesToRead(counts).reduce((s, t) => s + Math.ceil(counts[t] / PAGE_LIMIT), 0);
}

export interface ReadHooks {
  onProgress?: (done: number, total: number) => void;
  /** Called before waiting out keel's window, with the seconds to wait. */
  onWait?: (seconds: number) => void;
  /** The wait itself, replaceable in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The budget the world's own read left, so the first list can pace too. */
  budget?: Budget;
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new PublicReadError({ kind: 'network' }));
    });
  });

export async function readPublicElements(world: PublicWorld, fetchImpl: Fetch = fetch, hooks: ReadHooks = {}, signal?: AbortSignal): Promise<Element[]> {
  const types = typesToRead(world.counts);
  // A later page's copy of an id replaces an earlier one (an element edited during the walk moves on).
  const out = new Map<string, Element>();
  let left = costOf(world.counts);
  let budget: Budget = hooks.budget ?? { remaining: null, reset: null };
  let done = 0;
  for (const type of types) {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      // Wait out keel's window rather than walk into a 429 halfway through.
      if (budget.remaining !== null && budget.remaining < Math.max(left, 1) && budget.reset !== null && budget.reset > 0) {
        hooks.onWait?.(budget.reset);
        await (hooks.sleep ?? sleepFor)(budget.reset * 1000 + 250, signal);
        budget = { remaining: null, reset: null };
      }
      const q = new URLSearchParams({ world: world.id, limit: String(PAGE_LIMIT) });
      if (cursor) q.set('cursor', cursor);
      const body = (await getJson(`${API_BASE}/${type}/?${q}`, fetchImpl, signal, (b) => (budget = b))) as { data?: unknown; has_more?: unknown; next_cursor?: unknown };
      left = Math.max(left - 1, 0);
      const rows = Array.isArray(body?.data) ? body.data : [];
      for (const r of rows) {
        if (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') out.set((r as { id: string }).id, { ...(r as object), type } as Element);
      }
      const next = typeof body?.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null;
      // A cursor that comes back unchanged would walk the same page for ever.
      if (body?.has_more !== true || !next || next === cursor) break;
      cursor = next;
    }
    hooks.onProgress?.(++done, types.length);
  }
  return [...out.values()];
}
