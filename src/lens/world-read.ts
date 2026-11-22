/**
 * A world, read: signed out through keel's keyless reader, or signed in on the account token. The
 * wire is the same either way, `?world=<id>` on the world and on each type's list; signed in adds
 * only the token as the bearer. One request at a time (keel gives an address 60
 * keyless reads a minute, a token 300), each with its own time limit, and only the types the graph
 * keeps and the world counts. Nothing read is stored. A world that is private, unknown or no world
 * at all is one answer: closed. Signed in, a 401 is the sign-in ending, never a closed world.
 * Every read goes through the SDK's client, made in one place (`worldClient`), on a `fetch` of
 * this file's that adds the limit, the caller's signal and the budget on the way through.
 */

import { OwApiError, OwNetworkError, OwV2Client } from '@onlyworlds/sdk';
import { GRAPH_TYPES, isElementType, isGraphType, type Element } from './graph';
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
  | { kind: 'closed'; status?: number }
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

/**
 * The one client every world read goes through: keyless, or the account token as the bearer, on
 * the world named. It adds nothing to a read: no key, no PIN, and no client name (that rides writes
 * only).
 */
export function worldClient(worldId: string, token: string | null, fetchImpl: Fetch): OwV2Client {
  return new OwV2Client({ baseUrl: API_BASE, world: worldId, fetch: fetchImpl, ...(token ? { apiKey: token } : {}) });
}

/**
 * One read on the client: under its own time limit and the caller's signal, credentials omitted,
 * keel's budget handed on from the answer before anything else is made of it, and the client's
 * failure read as this reader's.
 */
export async function clientRead<T>(
  worldId: string,
  token: string | null,
  fetchImpl: Fetch,
  signal: AbortSignal | undefined,
  budget: ((b: Budget) => void) | undefined,
  read: (client: OwV2Client) => Promise<T>,
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_LIMIT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  const last: { res: Response | null } = { res: null };
  const limited: Fetch = async (input, init) => {
    const res = await fetchImpl(input, { ...init, signal: ctl.signal, credentials: 'omit' });
    last.res = res;
    budget?.(budgetOf(res));
    // A refusal is read by its status and Retry-After alone (failureOf, on the answer kept above):
    // the client is handed it without the body, so a body that never ends cannot hold the mapping.
    return res.ok ? res : new Response(null, { status: res.status, headers: res.headers });
  };
  try {
    const out = await read(worldClient(worldId, token, limited));
    // The client reads a 204 as no body. No read is answered so, and a body that is none is the server's.
    if (last.res?.status === 204) throw new ReadError({ kind: 'server', status: 204 });
    return out;
  } catch (e) {
    throw failureOf(e, last.res, token, ctl.signal.aborted);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** The client's failure as a ReadFailure, by keel's status; what the client refused before sending is thrown as it is. */
function failureOf(e: unknown, res: Response | null, token: string | null, aborted: boolean): unknown {
  if (e instanceof ReadError) return e;
  if (e instanceof OwApiError) {
    const status = e.status;
    // Signed in, keel judges the bearer before the world: a 401 is the token, and a world the
    // account cannot read is the 404 below.
    if (status === 401 && token) return new ReadError({ kind: 'ended' });
    // 401 is keel's answer while its public door is shut: from outside, a closed world like any other.
    // 410 is a deleted element, for a reader keel shows tombstones: gone is closed, never a retry.
    if (status === 404 || status === 410 || status === 401 || status === 403) return new ReadError({ kind: 'closed', status });
    if (status === 429 || status === 503) {
      // Seconds only, as keel sends it (the client would also read a date).
      const ra = Number(res?.headers.get('Retry-After'));
      return new ReadError({ kind: 'slow-down', retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null });
    }
    return new ReadError({ kind: 'server', status });
  }
  if (e instanceof OwNetworkError) return new ReadError({ kind: 'network' });
  // An answer came and its body did not read: cut by the time limit, the network's; not JSON, the server's.
  if (res) return new ReadError(aborted ? { kind: 'network' } : { kind: 'server', status: res.status });
  return e;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function readWorldMeta(worldId: string, fetchImpl: Fetch = fetch, signal?: AbortSignal, budget?: (b: Budget) => void, token: string | null = null): Promise<WorldMeta> {
  const body = (await clientRead(worldId, token, fetchImpl, signal, budget, (c) => c.getWorld())) as unknown as Record<string, unknown>;
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
  if (counts === null) return [...GRAPH_TYPES].sort();
  return Object.keys(counts).filter((t) => counts[t] > 0 && isElementType(t) && isGraphType(t)).sort();
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
      const page = cursor ?? undefined;
      const body = (await clientRead(
        world.id,
        token,
        fetchImpl,
        signal,
        (b) => {
          budget = b;
          hooks.onBudget?.(b);
        },
        (c) => c.list(type, { limit: PAGE_LIMIT, cursor: page }),
      )) as unknown as { data?: unknown; has_more?: unknown; next_cursor?: unknown };
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
