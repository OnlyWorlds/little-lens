import { describe, expect, it } from 'vitest';
import { draughtText } from '@onlyworlds/sdk';
import { API_BASE, ReadError } from './world-read';
import { DRAUGHT_COMPONENTS, WHOLE, cutCount, datedAfter, parseDraught, readDraught } from './draught';
import { parseRoute, worldHash } from './route';
import { resumeHashOf } from './signin';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const C = '0695db83-afd7-76ee-8000-00f4295f8866';
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const item = (type: string, n: number, extra: Record<string, unknown> = {}, grade = 'whole') => ({ via: ['characters'], her_links: 1, grade, element: { type, id: id(n), name: `${type} ${n}`, ...extra } });

function packet(asOf: number, rows: { events?: unknown[]; names?: Record<string, unknown[]>; sheet?: unknown[] }, more: Record<string, unknown> = {}) {
  return {
    world: { id: W, name: 'Moppetopia', description: '' },
    calendar: { time_basic_unit: 'Year' },
    as_of: asOf,
    now: 453,
    mode: 'voice',
    policy: { components: ['self', 'role', 'work', 'style', 'events', 'knowledge', 'names', 'sheet'], as_of: asOf, budget: 1000 },
    cut: {},
    recent_cursor: null,
    recent_more: null,
    character: { self: true, grade: 'whole', element: { type: 'character', id: C, name: 'Admiral Fluffington', birth_date: 249 } },
    role: [],
    work: [],
    style: null,
    events: rows.events ?? [],
    knowledge: [],
    names: rows.names ?? {},
    sheet: rows.sheet ?? [],
    ...more,
  };
}

describe('the draught packet', () => {
  it('reads rows in the packet order, with the date on each served body', () => {
    const d = parseDraught(packet(300, { events: [item('event', 1, { start_date: 120 }, 'whole')], names: { character: [item('character', 2, { birth_date: 40 })] }, sheet: [item('location', 3, {}, 'known_of')] }), W, C);
    expect(d.rows.map((r) => [r.section, r.element.id, r.date, r.grade])).toEqual([
      ['events', id(1), 120, 'whole'],
      ['names', id(2), 40, 'whole'],
      ['sheet', id(3), null, 'known_of'],
    ]);
    expect(d.asOf).toBe(300);
    expect(d.self?.name).toBe('Admiral Fluffington');
    expect(d.empty).toEqual(['role', 'work', 'style', 'knowledge']);
  });

  it('is the server error when it names another world or another Character', () => {
    expect(() => parseDraught(packet(300, {}), id(9), C)).toThrow(ReadError);
    const other = packet(300, {}, { character: { self: true, grade: 'whole', element: { type: 'character', id: id(8), name: 'B' } } });
    expect(() => parseDraught(other, W, C)).toThrow(ReadError);
    expect(() => parseDraught([], W, C)).toThrow(ReadError);
  });

  it('tells a public reading by keel\'s reader, by the missing roster only when reader is absent, and a hidden self by its null', () => {
    expect(parseDraught(packet(300, {}, { reader: 'public' }), W, C).publicReader).toBe(true);
    // reader wins over the echo: an owner's packet that named no roster is still the owner's.
    expect(parseDraught(packet(300, {}, { reader: 'owner' }), W, C).publicReader).toBe(false);
    expect(parseDraught(packet(300, {}), W, C).publicReader).toBe(true);
    const seat = packet(300, {}, { policy: { components: ['self', 'names', 'roster'] }, roster: [] });
    expect(parseDraught(seat, W, C).publicReader).toBe(false);
    expect(parseDraught(packet(300, {}, { character: null }), W, C).selfHidden).toBe(true);
  });

  it('counts what the budget left out', () => {
    expect(cutCount(parseDraught(packet(300, {}, { cut: { names: 5, sheet: 7, junk: 'x' } }), W, C))).toBe(12);
  });
});

describe('dated after', () => {
  it('is the whole read less the moment, in the whole read order, by type and id', () => {
    const early = item('event', 1, { start_date: 120 });
    const late = item('event', 2, { start_date: 370 });
    const born = item('character', 3, { birth_date: 360 });
    const undated = item('construct', 4);
    const moment = parseDraught(packet(300, { events: [early], names: { construct: [undated] } }), W, C);
    const whole = parseDraught(packet(WHOLE, { events: [early, late], names: { character: [born], construct: [undated] } }), W, C);
    expect(datedAfter(moment, whole).map((r) => r.element.id)).toEqual([id(2), id(3)]);
  });

  it('keeps a row whose id another type also uses apart', () => {
    const moment = parseDraught(packet(300, { events: [item('event', 1, { start_date: 1 })] }), W, C);
    const whole = parseDraught(packet(WHOLE, { events: [item('event', 1, { start_date: 1 })], names: { narrative: [item('narrative', 1)] } }), W, C);
    expect(datedAfter(moment, whole).map((r) => r.element.type)).toEqual(['narrative']);
  });
});

describe('the draught read', () => {
  it('always sends as_of, the budget and the components, never recent', async () => {
    const seen: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify(packet(WHOLE, {})), { status: 200 });
    }) as typeof fetch;
    await readDraught(W, C, WHOLE, f);
    const u = new URL(seen[0]);
    expect(`${u.origin}${u.pathname}`).toBe(`${API_BASE}/character/${C}/context`);
    expect(u.searchParams.get('world')).toBe(W);
    expect(u.searchParams.get('as_of')).toBe(String(WHOLE));
    expect(u.searchParams.get('budget')).toBe('1000');
    expect(u.searchParams.get('components')).toBe(DRAUGHT_COMPONENTS.join(','));
    expect(u.searchParams.get('components')).not.toContain('recent');
  });

  it('reads 404 and 410 as closed, a signed-in 401 as the sign-in ended', async () => {
    for (const status of [404, 410]) {
      const f = (async () => new Response('{}', { status })) as unknown as typeof fetch;
      await expect(readDraught(W, C, 300, f)).rejects.toMatchObject({ failure: { kind: 'closed' } });
    }
    const f401 = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(readDraught(W, C, 300, f401, undefined, 'tok')).rejects.toMatchObject({ failure: { kind: 'ended' } });
  });
});

describe('the draught address', () => {
  it('reads and writes an element draught with its moment, and never for a file', () => {
    for (const reader of ['public', 'me'] as const) {
      const at300 = worldHash(reader, W, C, 'draught', 300);
      expect(at300).toBe(`#/${reader === 'me' ? 'me' : 'w'}/${W}/e/${C}/draught?at=300`);
      expect(parseRoute(at300)).toEqual({ kind: 'world', reader, worldId: W, elementId: C, view: 'draught', at: 300 });
      expect(parseRoute(worldHash(reader, W, C, 'draught'))).toEqual({ kind: 'world', reader, worldId: W, elementId: C, view: 'draught', at: null });
    }
    expect(parseRoute(`#/w/${W}/e/${C}/draught?at=007`)).toMatchObject({ view: 'draught', at: null });
    expect(parseRoute(`#/w/${W}/e/nope/draught`)).toEqual({ kind: 'closed' });
    expect(worldHash('file', null, C, 'draught', 300)).toBe(`#/file/e/${C}`);
    expect(parseRoute(`#/file/e/${C}/draught`)).toEqual({ kind: 'home' });
  });

  it('resumes a signed-in draught through sign-in, its moment kept', () => {
    for (const good of [`#/me/${W}/e/${C}/draught`, `#/me/${W}/e/${C}/draught?at=300`, `#/me/${W}/e/${C}/draught?at=-4`]) expect(resumeHashOf(good)).toBe(good);
    for (const bad of [`#/w/${W}/e/${C}/draught`, `#/me/${W}/e/${C}/draught?at=007`, `#/me/${W}/draught`, `#/me/${W}/e/${C}/draught?at=3&x=1`]) expect(resumeHashOf(bad)).toBeNull();
  });
});

describe('the copy', () => {
  it('is the SDK text of the packet, its moment in it', () => {
    const p = packet(300, { events: [item('event', 1, { start_date: 120 })] });
    const d = parseDraught(p, W, C);
    const text = draughtText(d.packet as never);
    expect(text).toBe(draughtText(p as never));
    expect(text).toContain('dated up to Year 300');
    expect(text).toContain("Read as the Character's own view.");
  });

  it('names the public reader on a public packet, never her own view', () => {
    const text = draughtText(parseDraught(packet(300, {}, { reader: 'public' }), W, C).packet as never);
    expect(text).toContain('Read as the public reader.');
    expect(text).not.toContain("the Character's own view");
  });
});
