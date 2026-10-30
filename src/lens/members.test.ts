import { describe, expect, it } from 'vitest';
import { readMarkOf } from '@onlyworlds/sdk';
import type { Element } from './graph';
import { completeMembers, readMembers, servesEveryMark } from './members';
import { fromLine, readLine, readMessages } from './messages';
import { ReadError } from './world-read';

const msg = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'narrative', supertype: 'Message', narrator: null, characters: [], parent_narrative: null, created_at: '2026-01-01T00:00:00Z', ...extra }) as unknown as Element;
const char = (id: string, name: string) => ({ id, type: 'character', name }) as unknown as Element;
const mark = (id: string, actor: string, narratives: string[], extra: Record<string, unknown> = {}) => ({ id, type: 'relation', supertype: 'Read', actor, narratives, ...extra }) as unknown as Element;

// The owner plays Ada; member m1 plays Mara; member m2 (removed) played Wren; nobody plays Bo.
const ROWS = [
  { id: null, kind: 'owner', role: 'owner', character: 'ada', status: 'active', name: 'owner-username', lenses: [] },
  { id: 'm1', kind: 'person', role: 'contributor', character: 'mara', status: 'active', name: 'mara-username' },
  { id: 'm2', kind: 'person', role: 'guest', character: 'wren', status: 'removed' },
];
const ada = char('ada', 'Ada');
const mara = char('mara', 'Mara');
const wren = char('wren', 'Wren');
const bo = char('bo', 'Bo');
const fromAda = msg('q', { narrator: 'ada', characters: ['mara', 'wren', 'bo'], created_by: null, changed_by: null });
const maraRead = mark('r1', 'mara', ['q'], { created_by: 'm1', changed_by: 'm1' });
const BODIES = [ada, mara, wren, bo, fromAda, maraRead];

describe('M2: only a complete list is a list', () => {
  it('a full list is kept, each row as its id and Character only', () => {
    expect(completeMembers({ data: ROWS }, BODIES)).toEqual([
      { id: null, character: 'ada' },
      { id: 'm1', character: 'mara' },
      { id: 'm2', character: 'wren' },
    ]);
  });

  const no: [string, unknown, Element[]?][] = [
    ['an empty data', { data: [] }],
    ['no owner row', { data: ROWS.slice(1) }],
    ['two owner rows', { data: [...ROWS, { id: null, character: null }] }],
    ['an id twice', { data: [...ROWS, { id: 'm1', character: null }] }],
    ['has_more', { data: ROWS, has_more: true }],
    ['a next cursor', { data: ROWS, next_cursor: 'abc' }],
    ['a row id a number', { data: [...ROWS, { id: 7, character: null }] }],
    ['a row with no id', { data: [...ROWS, { character: null }] }],
    ['a character an object', { data: [...ROWS, { id: 'm3', character: { id: 'x' } }] }],
    ['a row not an object', { data: [...ROWS, 'm4'] }],
    ['data missing', { rows: ROWS }],
    ['a top-level array', ROWS],
    ['null', null],
    ['a mark whose hand names no row', { data: ROWS }, [...BODIES, mark('r9', 'bo', ['q'], { created_by: 'm9', changed_by: 'm9' })]],
    ['a message edited by a hand on no row', { data: ROWS }, [...BODIES, msg('e', { created_by: 'm1', changed_by: 'mx' })]],
    // The check reads every body served, the hidden and the proposed too: their hands are rows as well.
    ['a hidden message by a hand on no row', { data: ROWS }, [...BODIES, msg('h', { hidden: true, created_by: 'm7', changed_by: 'm7' })]],
    ['a proposed mark by a hand on no row', { data: ROWS }, [...BODIES, mark('p', 'mara', ['q'], { x_review_proposed: { by: 'm8' }, created_by: 'm8', changed_by: 'm8' })]],
  ];
  for (const [what, body, bodies] of no) it(`no list: ${what}`, () => expect(completeMembers(body, bodies ?? BODIES)).toBeNull());

  it('a hand on an element that is no message and no mark is not asked for', () => {
    expect(completeMembers({ data: ROWS }, [...BODIES, { ...char('z', 'Z'), created_by: 'm9' } as Element])).not.toBeNull();
  });
});

describe('M3: the read never ends a sign-in or closes a world', () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
  const statuses = [401, 403, 404, 410, 422, 429, 500, 503];
  for (const s of statuses) {
    it(`a ${s} is no list`, async () => {
      expect(await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: answer(s, { error: {} }) as typeof fetch })).toBeNull();
    });
  }
  it('a body that is not JSON, and a network error, are no list', async () => {
    expect(await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: (async () => new Response('<html>', { status: 200 })) as typeof fetch })).toBeNull();
    expect(await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: (async () => { throw new TypeError('offline'); }) as typeof fetch })).toBeNull();
  });
  it('a 200 list is read on the token, with world=', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get('Authorization') };
      return new Response(JSON.stringify({ data: ROWS }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await readMembers('w 1', 'ow_a_tok', BODIES, { fetchImpl: f })).toHaveLength(3);
    expect(seen).toEqual({ url: 'https://www.onlyworlds.com/api/v2/members/?world=w%201', auth: 'Bearer ow_a_tok' });
  });
  it('an abort is the caller\'s and is thrown', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const f = (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch;
    await expect(readMembers('w', 'ow_a_t', BODIES, { fetchImpl: f, signal: ctl.signal })).rejects.toBeInstanceOf(ReadError);
  });
  it('a paged answer, read through the SDK, is no list', async () => {
    expect(await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: answer(200, { data: ROWS, has_more: true }) as typeof fetch })).toBeNull();
    expect(await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: answer(200, { data: ROWS, next_cursor: 'c' }) as typeof fetch })).toBeNull();
    expect(await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: answer(200, { data: ROWS }) as typeof fetch })).toHaveLength(3);
  });
  it('a spent budget is waited out first', async () => {
    const waits: number[] = [];
    const out = await readMembers('w', 'ow_a_t', BODIES, { fetchImpl: answer(200, { data: ROWS }) as typeof fetch, budget: { remaining: 0, reset: 3 }, onWait: (s) => waits.push(s), sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([3, 3250]);
    expect(out).toHaveLength(3);
  });
});

describe('M4: what the list says', () => {
  const members = completeMembers({ data: ROWS }, BODIES)!;

  it('proves the owner\'s message from Ada, and counts Mara\'s own mark', () => {
    const r = readMessages(BODIES, 'me', members, true);
    expect(fromLine(r, fromAda)).toMatchObject({ status: 'verified', text: 'From Ada', verified: { id: 'ada' } });
    // Wren is played by a removed row, so a mark of hers could count: "not yet". Bo is played by no one: never "not yet".
    expect(readLine(r, fromAda)).toBe('Read by Mara · not yet by Wren');
  });

  it('M4b: a reader not served every mark says only who has read it', () => {
    const r = readMessages(BODIES, 'me', members, false);
    expect(readLine(r, fromAda)).toBe('Read by Mara');
    expect(readLine(readMessages([ada, mara, wren, bo, fromAda], 'me', members, false), fromAda)).toBeNull();
  });

  it('M4c: a recipient nobody plays gets no "not yet"; without a list a file still says it', () => {
    const r = readMessages([ada, bo, msg('b', { narrator: 'ada', characters: ['bo'], created_by: null, changed_by: null })], 'me', members, true);
    expect(readLine(r, r.messages[0])).toBeNull();
    const f = readMessages([ada, bo, msg('b', { narrator: 'ada', characters: ['bo'] })], 'file', null, true);
    expect(readLine(f, f.messages[0])).toBe('Not yet by Bo');
  });

  it('M5: a hand that plays no Character is said, and a hidden one is not', () => {
    const quiet = completeMembers({ data: [{ id: null, character: null }, ROWS[1]] }, BODIES)!;
    expect(readMessages(BODIES, 'me', quiet, true).unplayedHand).toBe(true);
    expect(readMessages(BODIES, 'me', members, true).unplayedHand).toBe(false);
    // A message naming no sender claims nothing, so it needs no line.
    expect(readMessages([ada, msg('n', { narrator: null, created_by: null, changed_by: null })], 'me', quiet, true).unplayedHand).toBe(false);
  });

  it('M4d: each Character\'s mark is asked once, agrees with readMarkOf, and a large thread stays fast', () => {
    const C = 200;
    const T = 300;
    const K = 400;
    const chars = Array.from({ length: C }, (_, i) => char(`c${i}`, `C${i}`));
    const rows = [{ id: null, character: 'c0' }, ...chars.slice(1).map((c, i) => ({ id: `p${i}`, character: c.id }))];
    const msgs = Array.from({ length: T }, (_, i) => msg(`t${i}`, { narrator: 'c0', parent_narrative: i ? 't0' : null, created_by: null, changed_by: null, created_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    const marks = Array.from({ length: K }, (_, i) => mark(`k${i}`, `c${(i % (C - 1)) + 1}`, [`t${i % T}`], { created_by: `p${i % (C - 1)}`, changed_by: `p${i % (C - 1)}` }));
    const bodies = [...chars, ...msgs, ...marks];
    const list = completeMembers({ data: rows }, bodies)!;
    const r = readMessages(bodies, 'me', list, true);
    const t0 = performance.now();
    for (const m of r.messages) readLine(r, m);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(r.markOf.size).toBe(C - 1);
    for (const [c, kept] of r.markOf) expect(kept).toBe(readMarkOf(r.marks, c, list));
  });
});

describe('the rung', () => {
  it('the owner and a co-builder are served every mark; a contributor, a guest and an unknown are not', () => {
    const w = (role: 'owner' | 'collaborator', member_role?: string) => ({ id: 'w', name: 'W', role, member_role, public_read: false, keys: [] });
    expect(servesEveryMark(w('owner'))).toBe(true);
    expect(servesEveryMark(w('collaborator', 'co_builder'))).toBe(true);
    expect(servesEveryMark(w('collaborator', 'contributor'))).toBe(false);
    expect(servesEveryMark(w('collaborator', 'guest'))).toBe(false);
    expect(servesEveryMark(w('collaborator'))).toBe(false);
    expect(servesEveryMark(undefined)).toBe(false);
  });
});
