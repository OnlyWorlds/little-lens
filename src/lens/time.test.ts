import { describe, expect, it } from 'vitest';
import { DATE_FIELD, formatStep, readCalendarValue } from '@onlyworlds/sdk';
import { buildGraph, type Element } from './graph';
import { binColumns, datedUpTo, dateWordOf, parseAt, readTime, stepToDate, stepWords, timeOfWorldBody, timeOfWorldFile } from './time';
import { parseRoute, worldHash } from './route';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const el = (n: number, type: string, extra: Record<string, unknown> = {}): Element => ({ id: id(n), type, name: `E${n}`, ...extra }) as Element;
const CAL = { version: 1, grain: 'day', bundles: { year: { steps: 360 } }, eras: [{ name: 'After Founding', abbrev: 'AF', start: 0 }] };
const calendar = (n: number, cfg: unknown = CAL, extra: Record<string, unknown> = {}) => el(n, 'construct', { supertype: 'calendar', atlas_calendar: cfg, ...extra });

describe('T1, dated by the lens profile table', () => {
  it('dates each of the twelve types by its own field, a whole number only', () => {
    let n = 0;
    for (const [type, field] of Object.entries(DATE_FIELD)) {
      const r = readTime([el(++n, type, { [field]: 300 })]);
      expect(r.dated.map((d) => d.date)).toEqual([300]);
    }
    expect(Object.keys(DATE_FIELD)).toHaveLength(12);
  });

  it('leaves a string, a fraction, null and the wrong field undated, and timeless types uncounted', () => {
    const r = readTime([el(1, 'event', { start_date: '300' }), el(2, 'event', { start_date: 300.5 }), el(3, 'event', { start_date: null }), el(4, 'character', { start_date: 5 }), el(5, 'object', { start_date: 9 }), el(6, 'species')]);
    expect(r.dated).toEqual([]);
    expect(r.undatedOfDatedKind).toBe(4);
    expect(r.whole).toBe(6);
  });

  it('fences at the edge with <=, as keel does', () => {
    const r = readTime([el(1, 'event', { start_date: 10 }), el(2, 'event', { start_date: 20 })]);
    expect(datedUpTo(r.dated, 20)).toBe(2);
    expect(datedUpTo(r.dated, 19)).toBe(1);
    expect(datedUpTo(r.dated, 9)).toBe(0);
  });

  it('orders by date, then folded name, then id, and names the field', () => {
    const r = readTime([el(3, 'event', { start_date: 5, name: 'b' }), el(1, 'event', { start_date: 5, name: 'B' }), el(2, 'character', { birth_date: 1, name: 'a' })]);
    expect(r.dated.map((d) => d.el.id)).toEqual([id(2), id(1), id(3)]);
    expect(dateWordOf('character')).toBe('born');
    expect(dateWordOf('location')).toBe('founded');
    expect(dateWordOf('collective')).toBe('formed');
    expect(dateWordOf('title')).toBe('granted');
    expect(dateWordOf('law')).toBe('dated');
    expect(dateWordOf('event')).toBe('starts');
  });
});

describe('T2, the web\'s own kept elements', () => {
  it('leaves out hidden, proposed and room elements exactly as the graph does, and stubs from the whole', () => {
    const g = buildGraph([
      el(1, 'event', { start_date: 1 }),
      el(2, 'event', { start_date: 2, hidden: true }),
      el(3, 'event', { start_date: 3, x_review_proposed: { by: 'x' } }),
      el(4, 'character', { known_of: true }),
      el(5, 'zone', { start_date: 4 }),
    ]);
    const r = readTime(g.nodes);
    expect(r.dated.map((d) => d.date)).toEqual([1]);
    expect(r.stubs).toBe(1);
    expect(r.whole).toBe(1);
    expect(r.undatedOfDatedKind).toBe(0);
  });
});

describe('T3, the calendar', () => {
  it('names dates by the one calendar among the kept elements, a JSON string too', () => {
    expect(readCalendarValue(CAL)).not.toBeNull();
    const one = readTime([calendar(1), el(2, 'event', { start_date: 400 })]);
    expect(one.calendar?.id).toBe(id(1));
    expect(stepWords(400, one.calendar, 'year')).toBe(formatStep(one.calendar!.config, 400));
    const str = readTime([calendar(1, JSON.stringify(CAL))]);
    expect(str.calendar?.id).toBe(id(1));
  });

  it('reads bare numbers with none, several, or only a hidden calendar', () => {
    expect(readTime([el(2, 'event', { start_date: 4 })]).calendar).toBeNull();
    expect(readTime([calendar(1), calendar(3)]).calendar).toBeNull();
    expect(readTime(buildGraph([calendar(1, CAL, { hidden: true })]).nodes).calendar).toBeNull();
    expect(stepWords(4, null, 'year')).toBe('year 4');
    expect(stepWords(4, null, null)).toBe('4');
  });
});

describe('T4, the world\'s now', () => {
  it('reads the world GET\'s time_range_current and unit', () => {
    expect(timeOfWorldBody({ time_range_current: 300, time_basic_unit: 'year' })).toEqual({ unit: 'year', now: 300 });
    expect(timeOfWorldBody({ time_range_current: '300', time_basic_unit: '' })).toEqual({ unit: null, now: null });
  });

  it('prefers a file\'s time_current, a null one absent', () => {
    expect(timeOfWorldFile({ time_current: 5, time_range_current: 9 }).now).toBe(5);
    expect(timeOfWorldFile({ time_current: null, time_range_current: 9 }).now).toBe(9);
    expect(timeOfWorldFile({}).now).toBeNull();
  });
});

describe('T6, the moment in the address', () => {
  it('takes the address profile\'s step and nothing else', () => {
    for (const ok of ['0', '5', '-5', '2147483647', '-2147483648']) expect(parseAt(ok)).toBe(Number(ok));
    for (const bad of ['+5', '007', '-0', '1e3', '0x10', '2147483648', '-2147483649', '', ' 5', '5.0', null]) expect(parseAt(bad)).toBeNull();
  });

  it('round-trips the time address under each reader, and keeps no moment on an element', () => {
    const W = '0695db52-5433-7332-8000-db7fe10da375';
    expect(parseRoute(`#/w/${W}/time?at=300`)).toEqual({ kind: 'world', reader: 'public', worldId: W, elementId: null, view: 'time', at: 300 });
    expect(parseRoute(`#/me/${W}/time`)).toEqual({ kind: 'world', reader: 'me', worldId: W, elementId: null, view: 'time', at: null });
    expect(parseRoute('#/file/time?at=-4')).toEqual({ kind: 'file', elementId: null, view: 'time', at: -4 });
    expect(parseRoute(`#/w/${W}/time?at=007`)).toMatchObject({ view: 'time', at: null });
    expect(parseRoute(`#/w/${W}/e/${W}?at=3`)).toEqual({ kind: 'world', reader: 'public', worldId: W, elementId: W, view: 'web' });
    expect(parseRoute('#/w/nope/time')).toEqual({ kind: 'closed' });
    for (const reader of ['public', 'me', 'file'] as const) {
      expect(parseRoute(worldHash(reader, W, null, 'time', 12))).toMatchObject({ view: 'time', at: 12 });
      expect(parseRoute(worldHash(reader, W, null, 'time'))).toMatchObject({ view: 'time', at: null });
    }
  });
});

describe('the strip\'s arithmetic', () => {
  it('steps to the previous and next distinct date, holding at the ends', () => {
    const r = readTime([el(1, 'event', { start_date: 10 }), el(2, 'event', { start_date: 10 }), el(3, 'event', { start_date: 30 })]);
    expect(stepToDate(r.dated, 10, 1)).toBe(30);
    expect(stepToDate(r.dated, 30, 1)).toBe(30);
    expect(stepToDate(r.dated, 20, -1)).toBe(10);
    expect(stepToDate(r.dated, 10, -1)).toBe(10);
  });

  it('bins into columns, several in one drawn once, one distinct date at the centre', () => {
    const r = readTime([el(1, 'event', { start_date: 0 }), el(2, 'event', { start_date: 0 }), el(3, 'event', { start_date: 100 })]);
    const cols = binColumns(r.dated, 80, 8);
    expect(cols.map((c) => c.items.length)).toEqual([2, 1]);
    expect(cols[1].x).toBe(72);
    const single = binColumns(readTime([el(1, 'event', { start_date: 7 }), el(2, 'event', { start_date: 7 })]).dated, 80, 8);
    expect(single).toHaveLength(1);
    expect(single[0].x).toBe(32);
  });
});
