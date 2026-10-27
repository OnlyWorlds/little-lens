/**
 * A world along time: which kept elements are dated, by the lens profile's one date table (the
 * SDK's `dateOf`, never a copy of the table), the world's calendar and its now, and the moment an
 * address holds. Pure: the strip draws from what this returns.
 */

import { DATE_FIELD, approxYearLength, dateOf, formatMidLabel, formatStep, formatYearLabel, resolveCalendar, simpleCaseFold, type WorldCalendar } from '@onlyworlds/sdk';
import { isKnownOfStub, type Element } from './graph';

/** The world's own time words: its unit (free text, as written) and its now, each when it has one. */
export interface WorldTime {
  unit: string | null;
  now: number | null;
}

const NO_TIME: WorldTime = { unit: null, now: null };

function unitOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** The world GET's fields: `time_range_current` is the now when it is a whole number. */
export function timeOfWorldBody(body: Record<string, unknown> | null | undefined): WorldTime {
  if (!body || typeof body !== 'object') return NO_TIME;
  return { unit: unitOf(body.time_basic_unit), now: Number.isInteger(body.time_range_current) ? (body.time_range_current as number) : null };
}

/** A world file's or folder's `world.json`: readers prefer `time_current`, then `time_range_current`. */
export function timeOfWorldFile(world: Record<string, unknown> | null | undefined): WorldTime {
  if (!world || typeof world !== 'object') return NO_TIME;
  const now = Number.isInteger(world.time_current) ? (world.time_current as number) : Number.isInteger(world.time_range_current) ? (world.time_range_current as number) : null;
  return { unit: unitOf(world.time_basic_unit), now };
}

/** The word a row says before its date, by the field it was read from. */
const FIELD_WORD: Record<string, string> = {
  birth_date: 'born',
  founding_date: 'founded',
  formation_date: 'formed',
  grant_date: 'granted',
  date: 'dated',
  start_date: 'starts',
};

export function dateWordOf(type: string): string {
  const field = DATE_FIELD[type.toLowerCase()];
  return (field && FIELD_WORD[field]) ?? 'dated';
}

export interface Dated {
  el: Element;
  date: number;
}

export interface TimeReading {
  /** Dated kept elements, by date, then name, then id. */
  dated: Dated[];
  /** Kept elements that are not known-of stubs: the range label's whole. */
  whole: number;
  /** Elements of a dated type whose field holds no whole number: said as a count, never listed. */
  undatedOfDatedKind: number;
  /** Known-of stubs: their dates are unknown, so they are neither dated nor undated. */
  stubs: number;
  calendar: WorldCalendar | null;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One reading of the kept nodes (the web's own set: hidden, proposed and room already out, spatial never in). */
export function readTime(nodes: readonly Element[]): TimeReading {
  const dated: Dated[] = [];
  let whole = 0;
  let undatedOfDatedKind = 0;
  let stubs = 0;
  for (const el of nodes) {
    if (isKnownOfStub(el)) {
      stubs++;
      continue;
    }
    whole++;
    const date = dateOf(el);
    if (date !== null) dated.push({ el, date });
    else if (typeof el.type === 'string' && DATE_FIELD[el.type.toLowerCase()]) undatedOfDatedKind++;
  }
  // Code-unit order of the folded name, then the id: the same in every viewer's locale. Each name
  // is folded once, not on every comparison.
  const folded = new Map(dated.map((d) => [d, simpleCaseFold(d.el.name ?? '')]));
  dated.sort((a, b) => a.date - b.date || byString(folded.get(a)!, folded.get(b)!) || byString(a.el.id, b.el.id));
  // A calendar on a node the web leaves out is never read: only kept nodes are offered.
  const calendar = resolveCalendar(nodes, undefined, { fallbackToOnly: true });
  return { dated, whole, undatedOfDatedKind, stubs, calendar };
}

/** A step in the world's words: the calendar's, else the unit as written and the number, else the number. */
export function stepWords(step: number, calendar: WorldCalendar | null, unit: string | null): string {
  if (calendar) return formatStep(calendar.config, step);
  return unit ? `${unit} ${step}` : String(step);
}

/**
 * A tick's label: year labels when ticks are at least a year apart, the mid rung when closer.
 * Without a calendar the bare number: the unit is free text that could crowd every tick, and the
 * range line and the rows say it.
 */
export function tickWords(step: number, spacing: number, calendar: WorldCalendar | null): string {
  if (!calendar) return String(step);
  const year = approxYearLength(calendar.config);
  return year !== null && spacing >= year ? formatYearLabel(calendar.config, step) : formatMidLabel(calendar.config, step);
}

const AT = /^(0|-?[1-9]\d*)$/;

/** The address's `at`: the address profile's step grammar within the 32-bit signed range, else none. */
export function parseAt(raw: string | null | undefined): number | null {
  if (raw == null || !AT.test(raw)) return null;
  const n = Number(raw);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}

/** The moment: the address's `at`, else the world's now, else none (no fence). */
export function momentOf(at: number | null, time: WorldTime): number | null {
  return at ?? time.now;
}

/** Dated elements up to and at the moment (keel's fence: `date <= at`). */
export function datedUpTo(dated: readonly Dated[], at: number): number {
  let n = 0;
  for (const d of dated) if (d.date <= at) n++;
  return n;
}

/** The previous or next distinct date from a step, or the step itself at an end. */
export function stepToDate(dated: readonly Dated[], from: number, dir: -1 | 1): number {
  if (dated.length === 0) return from;
  if (dir > 0) {
    for (const d of dated) if (d.date > from) return d.date;
    return Math.max(from, dated[dated.length - 1].date);
  }
  for (let i = dated.length - 1; i >= 0; i--) if (dated[i].date < from) return dated[i].date;
  return Math.min(from, dated[0].date);
}

export function columnCount(span: number, width: number): number {
  return Math.max(1, Math.floor(span / width));
}

/**
 * The one step-to-column rule: binning, drawing, the moment line and the slider's count all read
 * it, so a dot, the line on it and the count said there never disagree. A step outside the range
 * sits in the end column.
 */
export function columnOf(step: number, lo: number, hi: number, cols: number): number {
  if (hi === lo) return Math.floor((cols - 1) / 2);
  const s = Math.min(hi, Math.max(lo, step));
  return Math.min(cols - 1, Math.floor(((s - lo) / (hi - lo)) * cols));
}

export interface Column {
  /** Its index, from the strip's start. */
  index: number;
  /** The column's left edge, in px from the strip's start. */
  x: number;
  items: Dated[];
}

/**
 * Dated elements binned into columns `width` px wide over `span` px: a column holding several draws
 * once, with its count. One distinct date draws at the centre.
 */
export function binColumns(dated: readonly Dated[], span: number, width: number): Column[] {
  if (dated.length === 0 || span <= 0) return [];
  const lo = dated[0].date;
  const hi = dated[dated.length - 1].date;
  const cols = columnCount(span, width);
  const out = new Map<number, Dated[]>();
  for (const d of dated) {
    const c = columnOf(d.date, lo, hi, cols);
    const list = out.get(c);
    if (list) list.push(d);
    else out.set(c, [d]);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([c, items]) => ({ index: c, x: c * width, items }));
}
