/**
 * A world as a graph, read through the SDK's `worldGraph` (the lens profile's graph section): its
 * nodes and edges are the reader's, never this page's own. So a Zone is a node, the declared `x_` links
 * (`x_lens_leads_to`, `x_spine_depends_on`) are edges, a target listed twice is two edges, and the
 * reading aids (the charter, its guide, its domains) stay off the web and the list, as a lore view
 * leaves them, while their own pages still open. Map, Pin and Marker stay out.
 *
 * The page keeps two rules of its own, applied before the reader: hidden, proposed and room
 * elements leave by the page's readings below (the room one the stricter of the SDK's and keel's),
 * each counted once, so the world's line says how many were left out and why. The reader is the
 * owner's: what the page holds is what it was served, and nothing more is cut by rung.
 */

import { ELEMENT_TYPES, FIELD_SCHEMA, ROOM_PAIRS, handsOnAsProposed, isCharterElement, isRoomElement, readingAidOf, simpleCaseFold, worldGraph, type ElementType } from '@onlyworlds/sdk';

export type Element = { id: string; type: ElementType; name?: string; [field: string]: unknown };

export interface Edge {
  source: string;
  field: string;
  target: string;
  /** The target's place in its field's list (0 for a single link), as the reader answers it. */
  index: number;
}

export interface LeftOut {
  hidden: number;
  proposed: number;
  room: number;
  /** The charter, its guide and its domains: off the web and the list, each on its own page. */
  readingAid: number;
}

export interface WorldGraph {
  /** The reader's nodes, in its order (by id). */
  nodes: Element[];
  /** Every element a page can open: the nodes and the reading aids. */
  byId: Map<string, Element>;
  /** The reading aids, off the web and the list: the charter, then the guide, then the domains, each by name. */
  aids: Element[];
  /** The reader's edges: by source id, field, then the target's place in the field. */
  edges: Edge[];
  /** Ids an element's schema link fields hold that no page here opens (hidden, out, or not in the world), each id once per field, by source id. */
  outside: Map<string, number>;
  leftOut: LeftOut;
}

const KNOWN = new Set<string>(ELEMENT_TYPES);

/**
 * The types the reader draws, asked of the reader itself: one bare element of each type, kept or
 * not. So the readers that fetch a world (keel's lists, a file's folders) skip exactly the map space
 * the graph would cut, and follow the profile when it moves (a Zone became a node in serial 92).
 */
export const GRAPH_TYPES: readonly ElementType[] = ELEMENT_TYPES.filter(
  (t) => worldGraph({ elements: [{ id: '00000000-0000-7000-8000-000000000001', type: t, name: 'probe' }] }, { rung: 'owner' }).nodes.length === 1,
);
const DRAWN = new Set<string>(GRAPH_TYPES);

/** Whether the graph draws this type (every type but the map space). */
export function isGraphType(t: string): boolean {
  return DRAWN.has(t);
}

export function isElementType(t: unknown): t is ElementType {
  return typeof t === 'string' && KNOWN.has(t);
}

/** The one reading of the hidden mark (folder spec §4.8): present and not null or false. */
export function isHidden(el: Record<string, unknown>): boolean {
  return 'hidden' in el && el.hidden !== null && el.hidden !== false && el.hidden !== undefined;
}

/**
 * A room element by either reader: the SDK's (a non-empty inline mark) or keel's (any value but
 * null, a whitespace-only string not counted, and the mark nested in a folder body's
 * `extensions`). Where they differ the element stays out, the stricter of the two.
 */
export function isRoomish(el: Record<string, unknown>): boolean {
  if (isRoomElement(el as Parameters<typeof isRoomElement>[0])) return true;
  if (typeof el.type !== 'string' || typeof el.supertype !== 'string') return false;
  const type = simpleCaseFold(el.type.trim());
  const supertype = simpleCaseFold(el.supertype.trim());
  if (!ROOM_PAIRS.some((p) => simpleCaseFold(p.type) === type && simpleCaseFold(p.supertype) === supertype)) return false;
  const ext = el.extensions;
  const mark = 'x_room_of' in el ? el.x_room_of : ext && typeof ext === 'object' ? (ext as Record<string, unknown>).x_room_of : undefined;
  if (mark === null || mark === undefined) return false;
  return typeof mark === 'string' ? mark.trim() !== '' : true;
}

/** A known-of stub (a file may hold them): its absent fields are unknown, not empty. */
export function isKnownOfStub(el: Record<string, unknown>): boolean {
  return el.known_of === true;
}

/** The link fields of a type, in the schema's order: [field, multi, the type it names]. */
export function linkFieldsOf(type: ElementType): Array<[string, boolean, string]> {
  const schema = FIELD_SCHEMA[type] as Record<string, { type: string; target?: string }>;
  const out: Array<[string, boolean, string]> = [];
  for (const [field, info] of Object.entries(schema)) {
    if (info.type === 'single_link') out.push([field, false, info.target ?? 'any']);
    else if (info.type === 'multi_link') out.push([field, true, info.target ?? 'any']);
  }
  return out;
}

/** The ids a link field holds, as strings, empty values dropped, each once, in their order. */
export function idsIn(value: unknown, multi: boolean): string[] {
  const raw = multi ? (Array.isArray(value) ? value : []) : [value];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v === 'string' && v !== '' && !seen.has(v)) seen.add(v);
  }
  return [...seen];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildGraph(elements: Iterable<Element>): WorldGraph {
  const leftOut: LeftOut = { hidden: 0, proposed: 0, room: 0, readingAid: 0 };
  const kept = new Map<string, Element>();
  for (const el of elements) {
    if (!el || typeof el.id !== 'string' || !isElementType(el.type)) continue;
    // One reason each, in this order, so the counts add up to what is gone.
    if (isHidden(el)) leftOut.hidden++;
    // Any value in the proposed mark leaves it out, a doubtful one too (the SDK's reader for handing a world on).
    else if (handsOnAsProposed(el)) leftOut.proposed++;
    else if (isRoomish(el)) leftOut.room++;
    // One element per id: the reader hands them over in the order that wins.
    else if (!kept.has(el.id)) kept.set(el.id, el);
  }
  const g = worldGraph({ elements: [...kept.values()] }, { rung: 'owner' });
  leftOut.readingAid = g.cut.reading_aid ?? 0;
  const nodes = g.nodes.map((n) => kept.get(n.id)!);
  const byId = new Map<string, Element>(nodes.map((n) => [n.id, n]));
  const AID_ORDER = { charter: 0, guide: 1, domain: 2 } as const;
  const aids = [...kept.values()]
    .filter((el) => !byId.has(el.id) && isCharterElement(el))
    .sort((a, b) => AID_ORDER[readingAidOf(a) ?? 'domain'] - AID_ORDER[readingAidOf(b) ?? 'domain'] || byString(String(a.name ?? ''), String(b.name ?? '')) || byString(a.id, b.id));
  for (const el of aids) byId.set(el.id, el);
  const edges: Edge[] = g.edges.map((e) => ({ source: e.source, field: e.field, target: e.target, index: e.index }));
  // The ids an element's own link fields hold that no page here opens: exactly the chips beside it that cannot open.
  const outside = new Map<string, number>();
  for (const el of byId.values()) {
    let n = 0;
    for (const [field, multi] of linkFieldsOf(el.type)) for (const target of idsIn(el[field], multi)) if (!byId.has(target)) n++;
    if (n > 0) outside.set(el.id, n);
  }
  return { nodes, byId, aids, edges, outside, leftOut };
}

/** Links each node takes part in, either end, an edge to itself counted once. */
export function degrees(g: WorldGraph): Map<string, number> {
  const d = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1);
    if (e.target !== e.source) d.set(e.target, (d.get(e.target) ?? 0) + 1);
  }
  return d;
}

/** One element's neighbourhood: what it links to and what links to it, each element once per side. */
export function neighbourhood(g: WorldGraph, id: string): { out: Element[]; in: Element[] } {
  const outIds = new Set<string>();
  const inIds = new Set<string>();
  for (const e of g.edges) {
    if (e.source === id && e.target !== id) outIds.add(e.target);
    if (e.target === id && e.source !== id) inIds.add(e.source);
  }
  const pick = (ids: Set<string>) => [...ids].sort(byString).map((i) => g.byId.get(i)!);
  return { out: pick(outIds), in: pick(inIds) };
}
