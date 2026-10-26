/**
 * A world as a graph, by the graph sheet's rules (points 4 to 11): elements are nodes, the
 * schema's link fields are edges, one edge per element, field and target, everything ordered by
 * id and then field so the same set always gives the same picture. A Relation is a node like any
 * other. Map, Pin, Marker and Zone stay out, and so do hidden, proposed and room elements: the
 * world's line says how many were left out and why.
 */

import { ELEMENT_TYPES, FIELD_SCHEMA, ROOM_PAIRS, SPATIAL_TYPES, handsOnAsProposed, isRoomElement, simpleCaseFold, type ElementType } from '@onlyworlds/sdk';

export type Element = { id: string; type: ElementType; name?: string; [field: string]: unknown };

export interface Edge {
  source: string;
  field: string;
  target: string;
}

export interface LeftOut {
  hidden: number;
  proposed: number;
  room: number;
}

export interface WorldGraph {
  /** Kept elements, by id. */
  nodes: Element[];
  byId: Map<string, Element>;
  /** One per (source, field, target), both ends kept, by source id, field, target id. */
  edges: Edge[];
  /** Links a kept element holds to ids outside the kept set, by source id. */
  outside: Map<string, number>;
  leftOut: LeftOut;
}

const KNOWN = new Set<string>(ELEMENT_TYPES);
const OUT_OF_GRAPH = new Set<string>(SPATIAL_TYPES);

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
  const leftOut: LeftOut = { hidden: 0, proposed: 0, room: 0 };
  const byId = new Map<string, Element>();
  for (const el of elements) {
    if (!el || typeof el.id !== 'string' || !isElementType(el.type) || OUT_OF_GRAPH.has(el.type)) continue;
    // One reason each, in this order, so the counts add up to what is gone.
    if (isHidden(el)) leftOut.hidden++;
    // Any value in the proposed mark leaves it out, a doubtful one too (the SDK's reader for handing a world on).
    else if (handsOnAsProposed(el)) leftOut.proposed++;
    else if (isRoomish(el)) leftOut.room++;
    // One node per id: the reader hands them over in the order that wins.
    else if (!byId.has(el.id)) byId.set(el.id, el);
  }
  const nodes = [...byId.values()].sort((a, b) => byString(a.id, b.id));
  const edges: Edge[] = [];
  const outside = new Map<string, number>();
  for (const el of nodes) {
    const fields = linkFieldsOf(el.type).sort((a, b) => byString(a[0], b[0]));
    for (const [field, multi, targetType] of fields) {
      for (const target of idsIn(el[field], multi).sort(byString)) {
        const t = byId.get(target);
        // A link names its field's own type; one that names another kind is no link we draw.
        if (t && (targetType === 'any' || t.type === targetType)) edges.push({ source: el.id, field, target });
        else outside.set(el.id, (outside.get(el.id) ?? 0) + 1);
      }
    }
  }
  return { nodes, byId, edges, outside, leftOut };
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
