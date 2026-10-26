/**
 * The world web's layout: a small force layout run to rest before the first paint, each kind
 * pulled toward its family's quarter, starting from positions hashed from each id, so the same set
 * always lands the same way. Elements with no links sit along the frame's edge, in id order.
 * Positions are the drawing's own, never the world's (the graph sheet's point 10).
 */

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { familyOf, FAMILY_ORDER, type ElementFamily } from '@onlyworlds/sdk';
import { isKnownOfStub, type WorldGraph } from './graph';

export interface Placed {
  id: string;
  x: number;
  y: number;
  /** True for an element with no links, set along the edge. */
  loose: boolean;
}

/** FNV-1a over the id: a stable number in [0, 1). */
export function unitHash(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** Each family's quarter, as a point in the unit square. */
const QUARTER: Record<ElementFamily, [number, number]> = Object.fromEntries(
  FAMILY_ORDER.map((f, i) => [f, [i % 2 === 0 ? 0.3 : 0.7, i < 2 ? 0.32 : 0.68]]),
) as Record<ElementFamily, [number, number]>;

type Node = SimulationNodeDatum & { id: string; fam: ElementFamily };

/** d3's own linear congruential source, seeded the same each run. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => (s = (1664525 * s + 1013904223) % 4294967296) / 4294967296;
}

/** Lays the graph out in a width by height frame, inside a margin. */
export function layOut(g: WorldGraph, degree: Map<string, number>, width: number, height: number, margin = 24): Map<string, Placed> {
  const out = new Map<string, Placed>();
  // A known-of stub's links are unknown, never "none": it stays among the rest, not on the edge.
  const isLoose = (n: (typeof g.nodes)[number]) => (degree.get(n.id) ?? 0) === 0 && !isKnownOfStub(n);
  const linked = g.nodes.filter((n) => !isLoose(n));
  const loose = g.nodes.filter(isLoose);
  const w = Math.max(width - 2 * margin, 1);
  const h = Math.max(height - 2 * margin, 1);

  const nodes: Node[] = linked.map((n) => ({
    id: n.id,
    fam: familyOf(n.type),
    x: unitHash(n.id, 1) * w,
    y: unitHash(n.id, 2) * h,
  }));
  const links = g.edges.filter((e) => e.source !== e.target).map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(nodes)
    .force('link', forceLink<Node, { source: string; target: string }>(links).id((d) => d.id).distance(36).strength(0.25))
    .force('charge', forceManyBody().strength(-38).distanceMax(Math.max(w, h) / 2))
    .force('x', forceX<Node>((d) => QUARTER[d.fam][0] * w).strength(0.06))
    .force('y', forceY<Node>((d) => QUARTER[d.fam][1] * h).strength(0.06))
    .force('collide', forceCollide(7))
    // A fixed random source, so a jiggle between two coincident points lands the same every time.
    .randomSource(lcg())
    .stop();
  const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < ticks; i++) sim.tick();

  // Fit what settled into the frame, keeping its proportions.
  if (nodes.length > 0) {
    const xs = nodes.map((n) => n.x!);
    const ys = nodes.map((n) => n.y!);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    // Room for the loose ones along the edge.
    const inset = loose.length > 0 ? 28 : 0;
    const s = Math.min((w - 2 * inset) / Math.max(maxX - minX, 1), (h - 2 * inset) / Math.max(maxY - minY, 1));
    const ox = margin + inset + ((w - 2 * inset) - (maxX - minX) * s) / 2;
    const oy = margin + inset + ((h - 2 * inset) - (maxY - minY) * s) / 2;
    for (const n of nodes) out.set(n.id, { id: n.id, x: ox + (n.x! - minX) * s, y: oy + (n.y! - minY) * s, loose: false });
  }

  // The loose ones walk the frame's edge, clockwise from the top left.
  const per = 2 * (w + h);
  loose.forEach((n, i) => {
    const t = ((i + 0.5) / loose.length) * per;
    let x: number, y: number;
    if (t < w) [x, y] = [t, 0];
    else if (t < w + h) [x, y] = [w, t - w];
    else if (t < 2 * w + h) [x, y] = [w - (t - w - h), h];
    else [x, y] = [0, h - (t - 2 * w - h)];
    out.set(n.id, { id: n.id, x: margin + x, y: margin + y, loose: true });
  });
  return out;
}
