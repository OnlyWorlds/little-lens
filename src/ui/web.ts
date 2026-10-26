/**
 * The world web on a canvas: every kept element once, laid out to rest before the first paint,
 * dot size by links, the most linked named where their labels do not collide. A filter (a kind,
 * a search) dims the rest in place; the layout never moves for it.
 */

import type { WorldGraph } from '../lens/graph';
import { layOut, type Placed } from '../lens/layout';
import { inkOf } from './dom';

export const NAMED = 22;

export interface WebOptions {
  graph: WorldGraph;
  degree: Map<string, number>;
  /** Whether an element is lit; the rest are dimmed. */
  lit: (id: string) => boolean;
  onOpen: (id: string) => void;
}

export interface WebHandle {
  redraw(): void;
  destroy(): void;
}

function radiusOf(deg: number): number {
  return 2.5 + Math.sqrt(deg) * 1.6;
}

export function mountWeb(host: HTMLElement, opts: WebOptions): WebHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'webcanvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `The world web: ${opts.graph.nodes.length} elements and ${opts.graph.edges.length} links. The List view names each one.`);
  const tip = document.createElement('div');
  tip.className = 'webtip';
  tip.hidden = true;
  host.append(canvas, tip);

  const named = new Set(
    [...opts.graph.nodes]
      .filter((n) => (opts.degree.get(n.id) ?? 0) > 0)
      .sort((a, b) => (opts.degree.get(b.id)! - opts.degree.get(a.id)!) || (a.id < b.id ? -1 : 1))
      .slice(0, NAMED)
      .map((n) => n.id),
  );

  let placed = new Map<string, Placed>();
  let size = { w: 0, h: 0 };

  function measure(): boolean {
    const w = Math.round(host.clientWidth);
    const h = Math.round(Math.max(360, Math.min(720, w * 0.6)));
    if (w === size.w && h === size.h) return false;
    size = { w, h };
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    placed = layOut(opts.graph, opts.degree, w, h);
    return true;
  }

  function draw(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.lineWidth = 0.6;
    for (const e of opts.graph.edges) {
      const a = placed.get(e.source);
      const b = placed.get(e.target);
      if (!a || !b || e.source === e.target) continue;
      const on = opts.lit(e.source) && opts.lit(e.target);
      ctx.strokeStyle = on ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.06)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of opts.graph.nodes) {
      const p = placed.get(n.id);
      if (!p) continue;
      ctx.globalAlpha = opts.lit(n.id) ? 1 : 0.15;
      ctx.fillStyle = inkOf(n.type);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusOf(opts.degree.get(n.id) ?? 0), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Labels, most linked first, each only where it collides with none drawn before it.
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    const boxes: Array<[number, number, number, number]> = [];
    const order = [...named].sort((a, b) => (opts.degree.get(b)! - opts.degree.get(a)!) || (a < b ? -1 : 1));
    for (const id of order) {
      if (!opts.lit(id)) continue;
      const p = placed.get(id);
      const n = opts.graph.byId.get(id);
      if (!p || !n) continue;
      const text = (n.name || 'Untitled').slice(0, 40);
      const r = radiusOf(opts.degree.get(id) ?? 0);
      const tw = ctx.measureText(text).width;
      const box: [number, number, number, number] = [p.x + r + 3, p.y - 8, p.x + r + 3 + tw, p.y + 8];
      if (box[2] > size.w - 2) continue;
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(text, box[0] + 1, p.y + 1);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(text, box[0], p.y);
    }
  }

  function hit(ev: MouseEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of opts.graph.nodes) {
      const p = placed.get(n.id);
      if (!p || !opts.lit(n.id)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      const reach = radiusOf(opts.degree.get(n.id) ?? 0) + 5;
      if (d <= reach && d < bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  }

  canvas.addEventListener('mousemove', (ev) => {
    const id = hit(ev);
    canvas.style.cursor = id ? 'pointer' : 'default';
    if (!id) {
      tip.hidden = true;
      return;
    }
    const p = placed.get(id)!;
    tip.textContent = opts.graph.byId.get(id)?.name || 'Untitled';
    tip.hidden = false;
    tip.style.left = `${p.x + 10}px`;
    tip.style.top = `${p.y - 28}px`;
  });
  canvas.addEventListener('mouseleave', () => (tip.hidden = true));
  canvas.addEventListener('click', (ev) => {
    const id = hit(ev);
    if (id) opts.onOpen(id);
  });

  const ro = new ResizeObserver(() => {
    if (measure()) draw();
  });
  ro.observe(host);
  measure();
  draw();

  return {
    redraw: draw,
    destroy() {
      ro.disconnect();
      canvas.remove();
      tip.remove();
    },
  };
}
