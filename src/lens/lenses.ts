/**
 * A world's lenses, and its web through one of them (the lens profile, read by the SDK).
 *
 * The choices: every Lens Construct the page keeps (`isLens`; hidden, proposed and room ones are
 * already gone, by the page's own rules), a template left out (a recipe with no anchor reads as
 * nothing), by name as Atlas orders them. The reading: the SDK's `worldGraph` with the lens, handed
 * every element the page keeps and the world's own now (a lens's window counts from it), so its
 * nodes are exactly what the lens kept and its edges the links between them. The reader is the
 * owner's over what the page was served, as the whole web's is. Nothing is written.
 */

import { isLens, isTemplate, worldGraph } from '@onlyworlds/sdk';
import type { Edge, Element, WorldGraph } from './graph';

export interface LensChoice {
  id: string;
  name: string;
}

/** A lens's name as the box says it. */
export function lensName(el: Element): string {
  return (typeof el.name === 'string' && el.name.trim()) || 'Unnamed lens';
}

/** The world's lenses for the Lens box, by name (then id), as Atlas lists them. */
export function lensChoices(g: WorldGraph): LensChoice[] {
  return g.held
    .filter((el) => isLens(el) && !isTemplate(el))
    .map((el) => ({ id: el.id, name: lensName(el) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type LensView =
  | { kind: 'ok'; graph: WorldGraph; name: string }
  /** The lens keeps nothing here (every anchor out, or a window with nothing in it). */
  | { kind: 'empty'; name: string }
  /** The reader cannot read the lens's `x_lens`: `key` names what it could not read, when it says. */
  | { kind: 'unreadable'; name: string; key: string | null };

/**
 * The web through one lens: the whole graph's shape, its nodes and edges the lens's. The aids and the
 * left-out counts stay the world's; `byId` keeps every element a page can open, so a chip on an
 * element's page still opens what the lens did not keep.
 */
export function lensView(g: WorldGraph, lensId: string, now: number | null): LensView | null {
  const lens = g.held.find((el) => el.id === lensId);
  if (!lens || !isLens(lens) || isTemplate(lens)) return null;
  const name = lensName(lens);
  let read;
  try {
    read = worldGraph({ elements: g.held, now }, { rung: 'owner' }, { lens: lensId });
  } catch {
    return { kind: 'unreadable', name, key: null };
  }
  if (read.unreadable) return { kind: 'unreadable', name, key: read.unreadable };
  const nodes = read.nodes.map((n) => g.byId.get(n.id)).filter((el): el is Element => !!el);
  if (nodes.length === 0) return { kind: 'empty', name };
  const drawn = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = read.edges
    .filter((e) => drawn.has(e.source) && drawn.has(e.target))
    .map((e) => ({ source: e.source, field: e.field, target: e.target, index: e.index }));
  return { kind: 'ok', name, graph: { ...g, nodes, edges } };
}
