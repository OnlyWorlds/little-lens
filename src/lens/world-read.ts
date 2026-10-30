/**
 * A world, read: signed out through keel's keyless reader, or signed in on the account token. The
 * wire is the same either way, `?world=<id>` on the world and on each type's list; signed in adds
 * only the token as the bearer. One request at a time (keel gives an address 60
 * keyless reads a minute, a token 300), each with its own time limit, and only the types the graph
 * keeps and the world counts. Nothing read is stored. A world that is private, unknown or no world
 * at all is one answer: closed. Signed in, a 401 is the sign-in ending, never a closed world.
 */

import { ELEMENT_TYPES, SPATIAL_TYPES } from '@onlyworlds/sdk';
import { isElementType, type Element } from './graph';
import { timeOfWorldBody, type WorldTime } from './time';

export const API_BASE = 'https://www.onlyworlds.com/api/v2';
export const REQUEST_LIMIT_MS = 15_000;
export const PAGE_LIMIT = 1000;
/** A ceiling on pages per type, so a server that never says "no more" cannot hold the read. */
const MAX_PAGES = 200;

export interface WorldMeta {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  /** Elements per type as keel counted them, or null when the body carries no counts. */
  counts: Record<string, number> | null;
  /** The world's unit and now, as the world GET serves them to every reader. */
  time: WorldTime;
}

export type ReadFailure =
  | { kind: 'closed' }
  /** The token was refused (revoked, disconnected, unknown): the sign-in is over. */
  | { kind: 'ended' }
  | { kind: 'slow-down'; retryAfter: number | null }
  | { kind: 'network' }
  | { kind: 'server'; status: number };

export class ReadError extends Error {
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

export function budgetOf(res: Response): Budget {
  const n = (h: string) => {
    const v = res.headers.get(h);
    const x = v === null ? NaN : Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  return { remaining: n('RateLimit-Remaining'), reset: n('RateLimit-Reset') };
}

export async function getJson(url: string, fetchImpl: Fetch, signal: AbortSignal | undefined, budget: ((b: Budget) => void) | undefined, token: string | null): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_LIMIT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res: Response;
    try {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      res = await fetchImpl(url, { method: 'GET', signal: ctl.signal, credentials: 'omit', headers });
    } catch {
      throw new ReadError({ kind: 'network' });
    }
    budget?.(budgetOf(res));
    // Signed in, keel judges the bearer before the world: a 401 is the token, and a world the
    // account cannot read is the 404 below.
    if (res.status === 401 && token) throw new ReadError({ kind: 'ended' });
    // 401 is keel's answer while its public door is shut: from outside, a closed world like any other.
    // 410 is a deleted element, for a reader keel shows tombstones: gone is closed, never a retry.
    if (res.status === 404 || res.status === 410 || res.status === 401 || res.status === 403) throw new ReadError({ kind: 'closed' });
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('Retry-After'));
      throw new ReadError({ kind: 'slow-down', retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null });
    }
    if (!res.ok) throw new ReadError({ kind: 'server', status: res.status });
    try {
      return await res.json();
    } catch {
      // A body cut by the time limit is the network's; one that is not JSON is the server's.
      throw new ReadError(ctl.signal.aborted ? { kind: 'network' } : { kind: 'server', status: res.status });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function readWorldMeta(worldId: string, fetchImpl: Fetch = fetch, signal?: AbortSignal, budget?: (b: Budget) => void, token: string | null = null): Promise<WorldMeta> {
  const body = (await getJson(`${API_BASE}/world/?world=${encodeURIComponent(worldId)}`, fetchImpl, signal, budget, token)) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || body.id !== worldId) throw new ReadError({ kind: 'closed' });
  const types = (body.counts as { types?: unknown } | undefined)?.types;
  let counts: Record<string, number> | null = null;
  if (types && typeof types === 'object') {
    counts = {};
    for (const [t, n] of Object.entries(types as Record<string, unknown>)) if (typeof n === 'number' && n > 0) counts[t] = n;
  }
  return { id: worldId, name: str(body.name) || 'Untitled world', description: str(body.description), imageUrl: str(body.image_url), counts, time: timeOfWorldBody(body) };
}

/**
 * The types to read: counted above zero, an element type, and kept by the graph. A body with no
 * counts (an older server) reads every type the graph keeps, each until its list ends.
 */
export function typesToRead(counts: Record<string, number> | null): string[] {
  const spatial = new Set<string>(SPATIAL_TYPES);
  if (counts === null) return ELEMENT_TYPES.filter((t) => !spatial.has(t)).sort();
  return Object.keys(counts).filter((t) => counts[t] > 0 && isElementType(t) && !spatial.has(t)).sort();
}

/** What reading a world costs in requests, from its counts: one per thousand of each kept type. */
export function costOf(counts: Record<string, number> | null): number {
  if (counts === null) return typesToRead(null).length;
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
  /** Each answer's budget, so a read after the lists can pace too. */
  onBudget?: (b: Budget) => void;
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ReadError({ kind: 'network' }));
    });
  });

export async function readWorldElements(world: WorldMeta, fetchImpl: Fetch = fetch, hooks: ReadHooks = {}, signal?: AbortSignal, token: string | null = null): Promise<Element[]> {
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
      const body = (await getJson(`${API_BASE}/${type}/?${q}`, fetchImpl, signal, (b) => {
        budget = b;
        hooks.onBudget?.(b);
      }, token)) as { data?: unknown; has_more?: unknown; next_cursor?: unknown };
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
