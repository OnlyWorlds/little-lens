/**
 * The draught at a date: what the record holds around one Character, dated up to a moment, as
 * keel's draught route serves it to this reader (keyless on a world open to anyone, or the
 * session's token). Two reads, both keel's own: the moment's, and the whole one at the top of
 * keel's range, where nothing dated is past the fence. "Dated after" is the rows of the whole
 * read the moment's read does not hold: computed here, and said to be.
 */

import { dateOf } from '@onlyworlds/sdk';
import { API_BASE, ReadError, getJson } from './world-read';

/** keel's `as_of` is a 32-bit signed integer: at its top nothing dated is fenced. */
export const WHOLE = 2147483647;
export const DRAUGHT_BUDGET = 1000;
/**
 * What is asked: every section but `recent` (with no `since` keel never reads the feed, so an
 * empty `recent` would say nothing changed), and `roster`, which keel drops for the public reader:
 * its absence from the echo is how a page tells a public reading from a seat's.
 */
export const DRAUGHT_COMPONENTS = ['self', 'role', 'work', 'style', 'events', 'knowledge', 'names', 'sheet', 'roster'] as const;

/** The sections that hold rows, in the packet's order (keel's COMPONENTS); `names` is by type. */
export const ROW_SECTIONS = ['role', 'work', 'style', 'events', 'knowledge', 'names', 'sheet', 'recent', 'roster'] as const;
export type Section = (typeof ROW_SECTIONS)[number];

export interface DraughtElement {
  id: string;
  type: string;
  name?: string;
  [field: string]: unknown;
}

export interface Row {
  section: Section;
  /** For `names`: the type it is listed under. */
  group: string | null;
  element: DraughtElement;
  via: string[];
  grade: 'whole' | 'known_of';
  /** `false` only where keel says so (events and knowledge rows with no date). */
  dated: boolean | null;
  /** The row's date on its served body, or null (a stub is served none). */
  date: number | null;
}

/** A packet as read, kept whole for the copy, and its rows. */
export interface Draught {
  packet: Record<string, unknown>;
  asOf: number | null;
  now: number | null;
  rows: Row[];
  /** Her own element as served, or null when it is hidden from this reader. */
  self: DraughtElement | null;
  /** What the budget dropped, by section; empty when whole. */
  cut: Record<string, number>;
  /** Sections the packet served with nothing in them. */
  empty: Section[];
  /** Read as the public reader (keyless, or an account with no seat in the world): the echo holds no roster. */
  publicReader: boolean;
  /** `character` came back null: her own element is hidden from this reader. */
  selfHidden: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);

function elementOf(v: unknown): DraughtElement | null {
  return isObj(v) && typeof v.id === 'string' && typeof v.type === 'string' ? (v as DraughtElement) : null;
}

function rowOf(section: Section, group: string | null, item: unknown): Row | null {
  if (!isObj(item)) return null;
  const element = elementOf(item.element);
  if (!element) return null;
  const via = Array.isArray(item.via) ? item.via.filter((f): f is string => typeof f === 'string') : [];
  return { section, group, element, via, grade: item.grade === 'known_of' ? 'known_of' : 'whole', dated: typeof item.dated === 'boolean' ? item.dated : null, date: dateOf(element) };
}

/**
 * The packet's rows in its own order. A packet that is not one, or that names another world or
 * another Character, is the server's error.
 */
export function parseDraught(body: unknown, worldId: string, characterId: string): Draught {
  if (!isObj(body) || !isObj(body.world) || body.world.id !== worldId) throw new ReadError({ kind: 'server', status: 200 });
  const her = isObj(body.character) ? elementOf(body.character.element) : null;
  if (her && her.id.toLowerCase() !== characterId.toLowerCase()) throw new ReadError({ kind: 'server', status: 200 });
  const rows: Row[] = [];
  const empty: Section[] = [];
  const policy = isObj(body.policy) ? body.policy : {};
  const served = new Set(Array.isArray(policy.components) ? policy.components.filter((c): c is string => typeof c === 'string') : []);
  for (const section of ROW_SECTIONS) {
    const v = body[section];
    const before = rows.length;
    if (section === 'names' && isObj(v)) {
      for (const [group, list] of Object.entries(v)) if (Array.isArray(list)) for (const it of list) push(rowOf(section, group, it));
    } else if (section === 'style') {
      if (v) push(rowOf(section, null, v));
    } else if (section === 'roster') {
      // The roster's rows are seats, not elements: drawn as the copy draws them, never as a row here.
      continue;
    } else if (Array.isArray(v)) {
      for (const it of v) push(rowOf(section, null, it));
    }
    if (rows.length === before && served.has(section)) empty.push(section);
  }
  function push(r: Row | null) {
    if (r) rows.push(r);
  }
  const cut: Record<string, number> = {};
  if (isObj(body.cut)) for (const [k, n] of Object.entries(body.cut)) if (typeof n === 'number' && n > 0) cut[k] = n;
  return { packet: body, asOf: intOrNull(body.as_of), now: intOrNull(body.now), rows, self: her, cut, empty, publicReader: !served.has('roster'), selfHidden: body.character === null };
}

/** What keel's budget left out of a packet, in rows. */
export function cutCount(d: Draught): number {
  return Object.values(d.cut).reduce((s, n) => s + n, 0);
}

const keyOf = (r: Row) => `${r.element.type}:${r.element.id}`;

/** Rows of the whole read the moment's read does not hold, in the whole read's order. */
export function datedAfter(moment: Draught, whole: Draught): Row[] {
  const held = new Set(moment.rows.map(keyOf));
  return whole.rows.filter((r) => !held.has(keyOf(r)));
}

/**
 * One draught read: keyless, or on the session's token as the bearer. `as_of` is always sent:
 * left out, keel would fence at whatever the world's now is when the read lands.
 */
export async function readDraught(worldId: string, characterId: string, asOf: number, fetchImpl: typeof fetch = fetch, signal?: AbortSignal, token: string | null = null): Promise<Draught> {
  const q = new URLSearchParams({ world: worldId, as_of: String(asOf), budget: String(DRAUGHT_BUDGET), components: DRAUGHT_COMPONENTS.join(',') });
  const body = await getJson(`${API_BASE}/character/${encodeURIComponent(characterId)}/context?${q}`, fetchImpl, signal, undefined, token);
  return parseDraught(body, worldId, characterId);
}
