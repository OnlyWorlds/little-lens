import { describe, expect, it } from 'vitest';
import { threadOf } from '@onlyworlds/sdk';
import standard from '../standard/worlds.json';
import type { Element } from './graph';
import { fromLine, plainText, readLine, readMessages, threadOfId, toLine, whenOf } from './messages';

type World = { id: string; key: string; name: string; elements: Element[]; hidden: string[]; members?: { id: string | null; character: string | null }[] };
const worlds = standard.worlds as unknown as World[];
/** A small world as Little Lens opens it: the hidden ids marked hidden. */
function opened(key: string) {
  const w = worlds.find((x) => x.key === key)!;
  const hid = new Set(w.hidden);
  return { w, bodies: w.elements.map((e) => (hid.has(e.id) ? { ...e, hidden: true } : e)) };
}
const msg = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'narrative', supertype: 'Message', narrator: null, characters: [], parent_narrative: null, created_at: '2026-01-01T00:00:00Z', ...extra }) as unknown as Element;
const char = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, type: 'character', name, ...extra }) as unknown as Element;
const mark = (id: string, actor: string, narratives: string[], extra: Record<string, unknown> = {}) => ({ id, type: 'relation', supertype: 'Read', actor, narratives, ...extra }) as unknown as Element;

describe("the standard's The Post, read by the profile", () => {
  const { w, bodies } = opened('post');
  const r = readMessages(bodies, 'standard', w.members ?? null);
  const byName = (n: string) => r.messages.find((m) => m.name === n)!;

  it('leaves the hidden message out, counted and never named, by any line or address', () => {
    expect(r.hidden).toBe(1);
    expect(r.messages).toHaveLength(5);
    expect(r.threads).toHaveLength(5);
    const said = JSON.stringify(r.threads.flatMap((t) => t.messages.map((m) => [m.name, m.story, fromLine(r, m).text, toLine(r, m), readLine(r, m)])));
    const sealed = w.elements.find((e) => e.id === w.hidden[0])!;
    expect(said).not.toContain(sealed.name as string);
    expect(threadOfId(r, sealed.id)).toBeNull();
  });

  it('says a proved sender plainly, and a key writing another name as the mismatch it is', () => {
    const lamps = fromLine(r, byName('On the lamps'));
    expect(lamps.status).toBe('verified');
    expect(lamps.text).toBe(`From ${lamps.verified!.name}`);
    expect(fromLine(r, byName('Notes to self'))).toMatchObject({ status: 'mismatch', verified: null, text: 'Claims to be from Ada Venn, written with the key of Dov Marr' });
  });

  it("says who has read it from the reader's own mark", () => {
    const m = w.elements.find((e) => e.type === 'relation')!;
    const ada = m.actor as string;
    let both = 0;
    for (const x of r.messages) {
      if (!((x.characters as string[]) ?? []).includes(ada)) continue;
      const read = (m.narratives as string[]).includes(x.id);
      expect(readLine(r, x)).toBe(read ? 'Read by Ada Venn' : 'Not yet by Ada Venn');
      both |= read ? 1 : 2;
    }
    expect(both).toBe(3);
  });

  it('G2: a forged sender never hides the Character it names from the read line', () => {
    const forged = byName('Notes to self');
    const m = w.elements.find((e) => e.type === 'relation')!;
    const withMark = bodies.map((e) => (e.id === m.id ? { ...e, narratives: [...(m.narratives as string[]), forged.id] } : e));
    const r2 = readMessages(withMark, 'standard', w.members ?? null);
    expect(readLine(r2, r2.messages.find((x) => x.id === forged.id)!)).toContain('Ada Venn');
  });
});

describe('From nobody, shown (The Stub Room)', () => {
  it('a message with no narrator is from nobody', () => {
    const { w, bodies } = opened('stubs');
    const r = readMessages(bodies, 'standard', w.members ?? null);
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages.some((m) => fromLine(r, m).text === 'From nobody')).toBe(true);
  });
});

describe('what can be checked', () => {
  const ada = char('a', 'Ada');
  const m = msg('m', { narrator: 'b', characters: ['a'] });

  it('reads no mark keyless, and says no one is "everyone" keyless', () => {
    const r = readMessages([ada, m, mark('k', 'a', ['m']), msg('e')], 'public', null);
    expect(r.marksCount).toBe(false);
    expect(readLine(r, m)).toBeNull();
    expect(toLine(r, r.messages[1])).toMatch(/^No recipients named/);
    expect(toLine(readMessages([msg('e')], 'file', null), msg('e'))).toBe('To everyone');
  });

  it('G10: a mark carrying hands with no members list counts nowhere, and says no "not yet"', () => {
    const r = readMessages([ada, m, mark('k', 'a', ['x'], { created_by: null })], 'file', null);
    expect(r.marksCount).toBe(false);
    expect(readLine(r, m)).toBeNull();
    expect(readMessages([ada, m, mark('k', 'a', ['m'])], 'file', null).marksCount).toBe(true);
    expect(readMessages([ada, m, mark('k', 'a', ['x'], { created_by: null })], 'me', null).marksCount).toBe(false);
  });

  it('G6: a recipient not shown here is never in a read line', () => {
    const r = readMessages([ada, msg('m2', { characters: ['a', 'h'] }), mark('k', 'h', ['m2'])], 'file', null);
    expect(readLine(r, r.messages[0])).toBe('Not yet by Ada');
    expect(toLine(r, r.messages[0])).toBe('To Ada and someone not shown here');
  });

  it('G7 and G8: a proposed mark counts for nothing; a proposed message has no read line, no bold, and is counted apart', () => {
    const p = msg('p', { narrator: 'a', characters: ['b'], x_review_proposed: { by: 'x' } });
    const r = readMessages([ada, char('b', 'Bo'), m, p, mark('k', 'a', ['m'], { x_review_proposed: { by: 'x' } }), mark('j', 'b', ['p'])], 'file', null);
    // A mark was left out, so no one is said not to have read it.
    expect(readLine(r, m)).toBeNull();
    expect(r.proposed).toBe(1);
    expect(readLine(r, p)).toBeNull();
    expect(fromLine(r, p).verified).toBeNull();
  });

  it('G13: a room card names the sender; a hidden or proposed Character never does', () => {
    const card = char('c', 'Card', { x_room_of: 'w', supertype: 'Member' });
    const r = readMessages([card, char('h', 'Secret', { hidden: true }), char('q', 'Maybe', { x_review_proposed: { by: 'x' } }), msg('m', { narrator: 'c', characters: ['h', 'q'] })], 'file', null);
    expect(fromLine(r, r.messages[0]).text).toBe('Claims to be from Card');
    expect(toLine(r, r.messages[0])).toBe('To someone not shown here');
  });

  it('G12: names and text lose bidirectional and control characters', () => {
    const r = readMessages([char('a', '‮Mara\u0085'), msg('m', { narrator: 'a' })], 'file', null);
    expect(fromLine(r, r.messages[0]).text).toBe('Claims to be from Mara');
    expect(plainText('a‮b⁦c\u0007d\te\nf\u0000\u009B؜')).toBe('abcd\te\nf');
  });
});

describe('threads', () => {
  const ids = (r: ReturnType<typeof readMessages>) => r.threads.map((t) => t.messages.map((m) => m.id));

  it('G4: a loop is one thread, rooted the same whatever order it was read in', () => {
    const a = msg('a', { parent_narrative: 'b', created_at: '2026-01-02T00:00:00Z' });
    const b = msg('b', { parent_narrative: 'a', created_at: '2026-01-01T00:00:00Z' });
    const one = readMessages([a, b], 'file', null);
    const two = readMessages([b, a], 'file', null);
    expect(one.threads).toHaveLength(1);
    expect(one.threads[0].rootId).toBe(two.threads[0].rootId);
    expect(ids(one)[0].sort()).toEqual(['a', 'b']);
  });

  it('G4: a chain walks through a Note, and another Narrative is never listed', () => {
    const note = { id: 'n', type: 'narrative', supertype: 'Note', parent_narrative: 'a', created_at: '2026-01-02T00:00:00Z' } as unknown as Element;
    const lore = { id: 'l', type: 'narrative', supertype: 'History', parent_narrative: 'a', created_at: '2026-01-02T00:00:00Z' } as unknown as Element;
    const r = readMessages([msg('a'), note, lore, msg('c', { parent_narrative: 'n', created_at: '2026-01-03T00:00:00Z' })], 'file', null);
    expect(ids(r)).toEqual([['a', 'c']]);
  });

  it('G5: a hidden parent opens nothing, and its reply says it answers something outside', () => {
    const r = readMessages([msg('h', { hidden: true }), msg('c', { parent_narrative: 'h', created_at: '2026-01-02T00:00:00Z' })], 'file', null);
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0]).toMatchObject({ rootId: 'c', answersOutside: true });
    expect(threadOfId(r, 'h')).toBeNull();
  });

  it("G3: conversations are ordered by the SDK's instant; times it cannot read go last and show no date", () => {
    const times: Record<string, string> = { r1: '2026-10-05T00:00:00Z', r2: '2026-10-06', r3: '2026-10-04T00:00:00', r4: 'October 9, 2026', r5: '2026-10-05T03:00:00+05:00' };
    const ms = Object.entries(times).map(([id, at]) => msg(id, { created_at: at }));
    const r = readMessages(ms, 'file', null);
    // The oracle is the SDK alone: its order of the same bodies, with a marker of no time first
    // among the unreadables, so what comes before the marker is what it reads.
    const sdk = threadOf([msg('*', { created_at: null }), msg('|', { parent_narrative: '*', created_at: null }), ...ms.map((m) => ({ ...m, parent_narrative: '*' }))], '*').map((m) => m.id).filter((id) => id !== '*');
    const readable = sdk.slice(0, sdk.indexOf('|'));
    expect([...r.readable].sort()).toEqual([...readable].sort());
    expect(r.threads.map((t) => t.rootId)).toEqual([...[...readable].reverse(), ...sdk.slice(sdk.indexOf('|') + 1).sort()]);
    for (const id of ['r2', 'r4']) {
      expect(r.readable.has(id)).toBe(false);
      expect(whenOf(r, r.messages.find((m) => m.id === id)!)).toBeNull();
    }
    // An offset-less time is UTC, as the SDK reads it, and a lower-case t and z read too.
    expect(whenOf(r, r.messages.find((m) => m.id === 'r3')!)).toBe(Date.UTC(2026, 9, 4));
    const lower = readMessages([msg('l', { created_at: '2026-10-04t00:00:00z' })], 'file', null);
    if (lower.readable.has('l')) expect(whenOf(lower, lower.messages[0])).toBe(Date.UTC(2026, 9, 4));
  });

  it('C7: a time at the very end is still readable, and no id can stand in for the order\'s own markers', () => {
    const late = readMessages([msg('a', { created_at: '2026-01-01T00:00:00Z' }), msg('z', { created_at: '9999-12-31T23:59:59.9995Z' })], 'file', null);
    expect(late.readable.has('z')).toBe(true);
    expect(late.threads[0].rootId).toBe('z');
    for (const id of ['end', 'root', 'mend']) {
      const r = readMessages([msg(id, { created_at: '2026-01-02T00:00:00Z' }), msg('b', { created_at: '2026-01-01T00:00:00Z' })], 'file', null);
      expect([...r.readable].sort()).toEqual(['b', id].sort());
      expect(r.threads.map((t) => t.rootId)).toEqual([id, 'b']);
    }
  });

  it('C3: a reply into a loop, older than the loop, joins the loop\'s conversation', () => {
    const r = readMessages([msg('A', { parent_narrative: 'B', created_at: '2026-01-02T00:00:00Z' }), msg('B', { parent_narrative: 'A', created_at: '2026-01-03T00:00:00Z' }), msg('C', { parent_narrative: 'A', created_at: '2026-01-01T00:00:00Z' })], 'file', null);
    expect(ids(r)).toEqual([['C', 'A', 'B']]);
    // Rooted at the loop's earliest message, whatever the order read.
    expect(r.threads[0].rootId).toBe('A');
  });

  it('every conversation is threadOf over its root, in random worlds with loops, Notes and missing parents', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let w = 0; w < 400; w++) {
      const n = 2 + Math.floor(rnd() * 9);
      const bodies: Element[] = [];
      for (let i = 0; i < n; i++) {
        const r = rnd();
        const parent = r < 0.3 ? null : r < 0.4 ? 'gone' : `e${Math.floor(rnd() * n)}`;
        const at = rnd() < 0.15 ? 'later' : `2026-01-${String(1 + Math.floor(rnd() * 5)).padStart(2, '0')}T00:00:00Z`;
        bodies.push(rnd() < 0.2 ? ({ id: `e${i}`, type: 'narrative', supertype: 'Note', parent_narrative: parent, created_at: at } as unknown as Element) : msg(`e${i}`, { parent_narrative: parent, created_at: at }));
      }
      const r = readMessages(bodies, 'file', null);
      const shown = new Set(r.messages.map((m) => m.id));
      const listed = r.threads.flatMap((t) => t.messages.map((m) => m.id));
      expect(listed.sort()).toEqual([...shown].sort());
      for (const t of r.threads) expect(t.messages.map((m) => m.id)).toEqual(threadOf(bodies, t.rootId).map((m) => m.id).filter((id) => shown.has(id)));
    }
  });

  it('C9: a repeated id is one message, the first', () => {
    const r = readMessages([msg('a', { name: 'first' }), msg('a', { name: 'second' })], 'file', null);
    expect(r.messages.map((m) => m.name)).toEqual(['first']);
  });

  it('C2: five thousand conversations read in well under a second', () => {
    const many = Array.from({ length: 5000 }, (_, i) => msg(`m${String(i).padStart(5, '0')}`, { created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
    const t0 = performance.now();
    const r = readMessages(many, 'file', null);
    expect(r.threads).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('C1: no "not yet" where no mark can count', () => {
  const ada = char('a', 'Ada');
  it('signed in without a members list, with no marks at all', () => {
    // Signed in, the source alone decides, even for a body that carries no hands.
    const r = readMessages([ada, msg('m', { characters: ['a'] })], 'me', null);
    expect(r.marksCount).toBe(false);
    expect(readLine(r, r.messages[0])).toBeNull();
  });
  it('a small world or file whose bodies carry hands and no members list', () => {
    for (const source of ['standard', 'file'] as const) {
      const r = readMessages([ada, msg('m', { narrator: 'a', characters: ['a', 'b'], created_by: 'x' })], source, null);
      expect(readLine(r, r.messages[0])).toBeNull();
    }
  });
  it('a recipient named twice is said once', () => {
    const r = readMessages([ada, msg('m', { characters: ['a', 'a'] })], 'file', null);
    expect(toLine(r, r.messages[0])).toBe('To Ada');
  });
});
