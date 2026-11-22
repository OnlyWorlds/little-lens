/**
 * Parity: the world read and the draught read on a fixed set of keel answers (every small world of
 * the standard, served as keel would, and two played worlds), recorded once from the read as it
 * stood before it moved onto the SDK's client (`world-read.parity.json`). Each run reads the same
 * answers again and must leave the same record: every request (method, path, its parameters as a
 * set, its headers, its credentials), every budget, wait and progress call, the world meta, the
 * elements, the graph built from them, and the draught parsed.
 *
 * To record again (only when the answers here change, never to make a red go away):
 * `PARITY_RECORD=1 npx vitest run src/lens/world-read.parity.test.ts` prints one `PARITY {...}`
 * line; that line's JSON is the file.
 */

import { describe, expect, it } from 'vitest';
import worlds from '../standard/worlds.json';
import recorded from './world-read.parity.json';
import { buildGraph, type Element } from './graph';
import { readDraught, WHOLE } from './draught';
import { readWorldElements, readWorldMeta, type Budget } from './world-read';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

type Route = (u: URL) => { status?: number; body: unknown; headers?: Record<string, string> } | null;

/** keel, played: each request is written down as the reader sent it, then answered by the route. */
function keel(route: Route) {
  const sent: string[] = [];
  let remaining = 59;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const params = [...u.searchParams.entries()]
      // The draught's `compact` is the one parameter the client adds (its default, keel's too); the
      // read test holds it on its own.
      .filter(([k]) => !(k === 'compact' && u.pathname.endsWith('/context')))
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    const h = new Headers(init?.headers);
    const heads = [...h.keys()].sort().map((k) => (k === 'authorization' ? `${k}:${h.get(k)}` : k));
    sent.push(`${init?.method ?? 'GET'} ${u.pathname} ${params.join('&')} heads=[${heads.join(',')}] credentials=${init?.credentials} signal=${init?.signal ? 'yes' : 'no'} body=${init?.body === undefined ? 'none' : 'some'}`);
    const r = route(u) ?? { status: 404, body: { error: { code: 'not_found' } } };
    remaining = Math.max(remaining - 1, 0);
    const headers = { 'RateLimit-Remaining': String(remaining), 'RateLimit-Reset': '30', ...(r.headers ?? {}) };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers });
  }) as typeof fetch;
  return { f, sent };
}

/** One type's list in pages of `per`, cursors `p<n>`, as keel pages. */
function paged(rows: unknown[], u: URL, per: number) {
  const at = Number((u.searchParams.get('cursor') ?? 'p0').slice(1));
  const next = at + per < rows.length ? `p${at + per}` : null;
  return { body: { data: rows.slice(at, at + per), has_more: next !== null, next_cursor: next } };
}

async function hash(v: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const graphOf = (els: Element[]) => {
  const g = buildGraph(els);
  return { nodes: g.nodes, byId: [...g.byId.entries()], aids: g.aids, edges: g.edges, outside: [...g.outside.entries()], leftOut: g.leftOut, held: g.held };
};

/** A world read through, as the page reads it: the meta, then the lists, every callback written down. */
async function readThrough(worldId: string, route: Route, token: string | null) {
  const { f, sent } = keel(route);
  const calls: string[] = [];
  let budget: Budget | undefined;
  let meta;
  try {
    meta = await readWorldMeta(worldId, f, undefined, (b) => {
      budget = b;
      calls.push(`meta budget ${b.remaining}/${b.reset}`);
    }, token);
  } catch (e) {
    return { sent, calls, failure: (e as { failure?: unknown }).failure ?? String(e) };
  }
  const els = await readWorldElements(meta, f, {
    budget,
    onBudget: (b) => calls.push(`budget ${b.remaining}/${b.reset}`),
    onWait: (s) => calls.push(`wait ${s}`),
    onProgress: (d, t) => calls.push(`progress ${d}/${t}`),
    sleep: async (ms) => void calls.push(`sleep ${ms}`),
  }, undefined, token);
  return { sent, calls, counts: { elements: els.length }, meta: await hash(meta), elements: await hash(els), graph: await hash(graphOf(els)) };
}

/** A standard world as keel would serve it to its owner: the meta with its counts, each type's list. */
function standardRoute(w: (typeof worlds.worlds)[number]): Route {
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const e of w.elements as Record<string, unknown>[]) {
    const { type, ...body } = e;
    byType.set(type as string, [...(byType.get(type as string) ?? []), body]);
  }
  const types: Record<string, number> = {};
  for (const [t, rows] of byType) types[t] = rows.length;
  const wb = w as { time_basic_unit?: string; now?: number };
  return (u) => {
    if (u.searchParams.get('world') !== w.id) return { status: 404, body: { error: { code: 'not_found' } } };
    if (u.pathname === '/api/v2/world/') return { body: { id: w.id, name: w.name, description: '', image_url: '', time_basic_unit: wb.time_basic_unit ?? null, time_range_current: wb.now ?? null, counts: { total: w.elements.length, types } } };
    const type = u.pathname.split('/')[3];
    return paged(byType.get(type) ?? [], u, 2);
  };
}

const P1 = id(9001);
const P2 = id(9002);

/** Played: an older keel with no counts, so every kept type is read to its end; pages that edit, repeat and stall. */
const played1: Route = (u) => {
  if (u.searchParams.get('world') !== P1) return { status: 404, body: { error: { code: 'not_found' } } };
  const type = u.pathname.split('/')[3];
  const c = u.searchParams.get('cursor');
  if (u.pathname === '/api/v2/world/') return { body: { id: P1, name: 'Played One', description: 'played', image_url: 'https://media.onlyworlds.com/x.png', time_basic_unit: 'Year', time_range_current: 300 } };
  if (type === 'character') {
    if (!c) return { body: { data: [{ id: id(1), name: 'Ada', location: id(10), friends: [id(2)] }, { id: id(2), name: 'Bo', birth_date: 12 }], has_more: true, next_cursor: 'c2' } };
    if (c === 'c2') return { body: { data: [{ id: id(1), name: 'Ada, edited', location: id(10), friends: [id(2), id(3)] }, { id: id(3), name: 'Cy' }, { name: 'no id' }], has_more: true, next_cursor: 'c3' }, headers: { 'RateLimit-Remaining': '1', 'RateLimit-Reset': '9' } };
    return { body: { data: [{ id: id(4), name: 'Dee', supertype: 'Message' }], has_more: false, next_cursor: null } };
  }
  if (type === 'location') return { body: { data: [{ id: id(10), name: 'Harrow', parent_location: id(11) }], has_more: true, next_cursor: c ?? 'same' } };
  if (type === 'event') return { body: { data: [{ id: id(20), name: 'The Fall', characters: [id(1), id(3)], start_date: 250 }], has_more: true, next_cursor: null } };
  if (type === 'institution') return { body: { data: 'not a list', has_more: false } };
  return { body: { data: [], has_more: false, next_cursor: null } };
};

/** Played, signed in: counts with map space, a zero, a type no element has, and a large type in two pages. */
const played2: Route = (u) => {
  if (u.searchParams.get('world') !== P2) return { status: 404, body: { error: { code: 'not_found' } } };
  const type = u.pathname.split('/')[3];
  if (u.pathname === '/api/v2/world/') return { body: { id: P2, name: '', counts: { total: 9, types: { character: 1500, pin: 4, marker: 2, map: 1, zone: 1, law: 0, nonsense: 3, narrative: 2 } } } };
  if (type === 'character') {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: id(100 + i), name: `C${i}`, ...(i % 7 === 0 ? { friends: [id(101 + i)] } : {}) }));
    return paged(rows, u, 1000);
  }
  if (type === 'zone') return { body: { data: [{ id: id(50), name: 'Z', map: id(51) }], has_more: false, next_cursor: null } };
  if (type === 'narrative') return { body: { data: [{ id: id(60), name: 'N', characters: [id(100)] }, { id: id(61), name: 'N2', x_review_proposed: true }], has_more: false, next_cursor: null } };
  return { body: { data: [], has_more: false, next_cursor: null } };
};

/** A world that is not served, and a busy keel: the failures are part of the record too. */
const closed: Route = () => ({ status: 404, body: { error: { code: 'not_found' } } });
const busy: Route = () => ({ status: 429, body: { error: { code: 'rate_limited' } }, headers: { 'Retry-After': '17', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '17' } });

const C = id(1);
const packet = (asOf: number) => ({
  world: { id: P1, name: 'Played One', description: '' },
  calendar: { time_basic_unit: 'Year' },
  as_of: asOf,
  now: 300,
  mode: 'voice',
  reader: 'public',
  policy: { components: ['self', 'role', 'work', 'style', 'events', 'knowledge', 'names', 'sheet'], as_of: asOf, budget: 1000, compact: false },
  cut: { events: 2 },
  character: { self: true, grade: 'whole', element: { type: 'character', id: C, name: 'Ada', birth_date: 40 } },
  role: [],
  work: [{ via: ['characters'], her_links: 1, grade: 'whole', element: { type: 'construct', id: id(30), name: 'Loom' } }],
  style: null,
  events: [{ via: ['characters'], her_links: 2, grade: 'whole', dated: true, element: { type: 'event', id: id(20), name: 'The Fall', start_date: asOf - 50 } }],
  knowledge: [],
  names: { location: [{ via: ['location'], her_links: 1, grade: 'known_of', element: { type: 'location', id: id(10), name: 'Harrow' } }] },
  sheet: [],
});
const draughtRoute: Route = (u) => (u.pathname === `/api/v2/character/${C}/context` && u.searchParams.get('world') === P1 ? { body: packet(Number(u.searchParams.get('as_of'))) } : null);

async function draughtThrough(token: string | null) {
  const { f, sent } = keel(draughtRoute);
  const out: unknown[] = [];
  for (const asOf of [250, WHOLE]) out.push(await readDraught(P1, C, asOf, f, undefined, token));
  return { sent, draught: await hash(out) };
}

async function record() {
  const out: Record<string, unknown> = {};
  for (const w of worlds.worlds) out[`standard ${w.id} ${w.name}`] = await readThrough(w.id, standardRoute(w), null);
  out['played one, signed out'] = await readThrough(P1, played1, null);
  out['played one, signed in'] = await readThrough(P1, played1, 'ow_a_played');
  out['played two, signed in'] = await readThrough(P2, played2, 'ow_a_played');
  out['closed'] = await readThrough(P1, closed, null);
  out['busy, signed in'] = await readThrough(P1, busy, 'ow_a_played');
  out['draught, signed out'] = await draughtThrough(null);
  out['draught, signed in'] = await draughtThrough('ow_a_played');
  return out;
}

describe('parity with the read before the client', () => {
  it('reads the same answers into the same record', async () => {
    const now = await record();
    if (env.PARITY_RECORD) console.log(`PARITY ${JSON.stringify(now)}`);
    expect(Object.keys(now)).toHaveLength(worlds.worlds.length + 7);
    expect(now).toEqual(recorded);
  });
});
