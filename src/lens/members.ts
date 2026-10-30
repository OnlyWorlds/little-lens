/**
 * A signed-in world's members list, read whole or not at all, and whether the reader is served
 * every read mark. The list is what lets the message profile's readers prove a sender and count a
 * mark; a list missing a row would turn a real mark into a "not yet", so only a complete one counts.
 * Nothing here ends a sign-in or closes a world: any failure is no list.
 */

import { isMessage, OwV2Client, type OwAccountWorld, type OwMessageMember } from '@onlyworlds/sdk';
import type { Element } from './graph';
import { isReadRelation } from './messages';
import { CLIENT_NAME } from './signin';
import { API_BASE, budgetOf, ReadError, REQUEST_LIMIT_MS, type Budget } from './world-read';

/** The row keys the SDK's readers read; every other key of a row (a username, a role, a lens) is dropped. */
function keep(row: Record<string, unknown>): OwMessageMember {
  return { id: row.id as string | null, character: typeof row.character === 'string' ? row.character : null };
}

/**
 * keel's `{ data }` as a members list, or null. Complete means: every row an object with a string or
 * null `id` and a string, null or absent `character`; one owner row (`id` null); no id twice; no sign
 * of another page; and every hand on the world's messages and read marks (`created_by`,
 * `changed_by`) names a row, as keel promises one row per membership, removed ones included.
 */
export function completeMembers(body: unknown, bodies: Iterable<Element>): OwMessageMember[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as { data?: unknown; has_more?: unknown; next_cursor?: unknown };
  if (!Array.isArray(b.data) || b.has_more === true || typeof b.next_cursor === 'string') return null;
  const ids = new Set<string>();
  let owners = 0;
  for (const row of b.data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const { id, character } = row as { id?: unknown; character?: unknown };
    if (character !== undefined && character !== null && typeof character !== 'string') return null;
    if (id === null) owners++;
    else if (typeof id !== 'string' || ids.has(id)) return null;
    else ids.add(id);
  }
  if (owners !== 1) return null;
  for (const el of bodies) {
    if (!el || !(isMessage(el) || isReadRelation(el))) continue;
    for (const hand of [el.created_by, el.changed_by]) if (typeof hand === 'string' && !ids.has(hand)) return null;
  }
  return (b.data as Record<string, unknown>[]).map(keep);
}

/**
 * The SDK's `members()` on the token and the world (`GET /members?world=<id>`), after waiting out a
 * budget the last read spent, read as a complete list or null. Every failure is null, a 401
 * included: the sign-in is judged by the next read that needs it. An abort is the caller's, and
 * rethrown as one.
 */
export async function readMembers(
  worldId: string,
  token: string,
  bodies: Iterable<Element>,
  opts: PaceHooks & { fetchImpl?: typeof fetch; signal?: AbortSignal; budget?: Budget; onBudget?: (b: Budget) => void } = {},
): Promise<OwMessageMember[] | null> {
  try {
    await paceFor(opts.budget, opts, opts.signal);
    // keel serves the list unpaged; the SDK hands back its rows alone, so a sign of another page is
    // read here, beside it: a paged answer is a partial list, and a partial list is none.
    let paged = false;
    const rows = await withLimit(opts.signal, (signal) => {
      const limited: typeof fetch = async (input, init) => {
        const res = await (opts.fetchImpl ?? fetch)(input, { ...init, credentials: 'omit', signal });
        opts.onBudget?.(budgetOf(res));
        if (res.ok) {
          const peek = (await res.clone().json().catch(() => null)) as { has_more?: unknown; next_cursor?: unknown } | null;
          paged = peek?.has_more === true || typeof peek?.next_cursor === 'string';
        }
        return res;
      };
      return new OwV2Client({ baseUrl: API_BASE, apiKey: token, world: worldId, client: CLIENT_NAME, fetch: limited }).members();
    });
    return completeMembers(paged ? { data: rows, has_more: true } : { data: rows }, bodies);
  } catch (e) {
    if (opts.signal?.aborted) throw e instanceof ReadError ? e : new ReadError({ kind: 'network' });
    return null;
  }
}

/** One call under its own time limit, cut too when the caller's signal aborts. */
async function withLimit<T>(outer: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_LIMIT_MS);
  const onAbort = () => ctl.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    return await run(ctl.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export interface PaceHooks {
  /** Called before waiting out keel's window, with the seconds to wait. */
  onWait?: (seconds: number) => void;
  /** Called when the wait, if any, is over and the read is sent. */
  onRead?: () => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Wait out keel's window when the last answer left nothing, then say the read goes. */
export async function paceFor(b: Budget | undefined, hooks: PaceHooks, signal?: AbortSignal): Promise<void> {
  if (b && b.remaining !== null && b.remaining < 1 && b.reset !== null && b.reset > 0) {
    hooks.onWait?.(b.reset);
    await (hooks.sleep ?? sleepFor)(b.reset * 1000 + 250, signal);
  }
  hooks.onRead?.();
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new ReadError({ kind: 'network' }));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });

/**
 * Whether keel serves this reader every read mark of the world: the owner and a co-builder see them
 * all; a contributor is not served hidden ones and a guest only its own slice, with no sign of what
 * was left out. An unknown rung is not.
 */
export function servesEveryMark(w: OwAccountWorld | null | undefined): boolean {
  return !!w && (w.role === 'owner' || (w.role === 'collaborator' && w.member_role === 'co_builder'));
}
