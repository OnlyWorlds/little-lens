/**
 * An element: its sheet on the left (the fields in the schema's sections, links as chips that
 * open the element they name) and its neighbourhood on the right, one ring: what it links to
 * drawn solid, what links to it dashed, the twelve most linked of them named.
 */

import { ELEMENT_SECTIONS, FIELD_SCHEMA, fieldLabel, type ElementType } from '@onlyworlds/sdk';
import { idsIn, isKnownOfStub, neighbourhood, type Element, type WorldGraph } from '../lens/graph';
import { h, svg, typeIcon, owMark, inkOf, singularWord } from './dom';

export const NAMED_AROUND = 12;
const PICTURE_HOST = 'media.onlyworlds.com';

export interface ElementViewOptions {
  graph: WorldGraph;
  degree: Map<string, number>;
  element: Element;
  hrefOf: (id: string) => string;
  /** Whether a picture from our own host may load (a public world); a file's never do. */
  pictures: boolean;
}

function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** A picture only from our own host; any other host is named and never asked for. */
export function picture(url: unknown, load: boolean): HTMLElement | null {
  if (typeof url !== 'string' || url.trim() === '') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!load) return h('p', { class: 'pic-off' }, `A picture at ${u.hostname || 'another address'}, not loaded from a file.`);
  if (u.protocol === 'https:' && u.hostname === PICTURE_HOST) {
    return h('img', { class: 'pic', src: u.href, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  }
  return h('p', { class: 'pic-off' }, `A picture at ${u.hostname || 'another address'}, not loaded here.`);
}

function chip(g: WorldGraph, id: string, hrefOf: (id: string) => string): HTMLElement {
  const target = g.byId.get(id);
  if (!target) return h('span', { class: 'chip off', title: 'Not in this view' }, `…${id.slice(-8)}`);
  const a = h('a', { class: 'chip', href: hrefOf(id) }, typeIcon(target.type, 13), h('span', {}, target.name || 'Untitled'));
  a.style.setProperty('--ink', inkOf(target.type));
  return a;
}

function fieldRows(g: WorldGraph, el: Element, hrefOf: (id: string) => string): HTMLElement[] {
  const schema = FIELD_SCHEMA[el.type] as Record<string, { type: string }>;
  const rows: HTMLElement[] = [];
  const sections = [...ELEMENT_SECTIONS[el.type]].sort((a, b) => a.order - b.order);
  for (const s of sections) {
    for (const f of s.fields) {
      const kind = schema[f]?.type;
      if (kind === 'single_link' || kind === 'multi_link') {
        const ids = idsIn(el[f], kind === 'multi_link');
        if (ids.length === 0) continue;
        rows.push(h('div', { class: 'frow' }, h('dt', {}, fieldLabel(f)), h('dd', { class: 'chips' }, ...ids.map((id) => chip(g, id, hrefOf)))));
      } else {
        const t = textOf(el[f]);
        if (t === null) continue;
        rows.push(h('div', { class: 'frow' }, h('dt', {}, fieldLabel(f)), h('dd', {}, t)));
      }
    }
  }
  return rows;
}

function radial(o: ElementViewOptions): SVGSVGElement {
  const { out, in: inn } = neighbourhood(o.graph, o.element.id);
  // Each neighbour once; one that both links and is linked is drawn solid.
  const outIds = new Set(out.map((e) => e.id));
  const ring = [...out, ...inn.filter((e) => !outIds.has(e.id))];
  const W = 640, H = 560, cx = W / 2, cy = H / 2, R = 200;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'radial', role: 'img', 'aria-label': `What it links to: ${out.length}. What links to it: ${inn.length}.` });
  const angle = (i: number) => (i / Math.max(ring.length, 1)) * Math.PI * 2 - Math.PI / 2;
  // The most linked are named first, each only where its label clears the ones before it.
  const named = new Set<string>();
  const boxes: Array<[number, number, number, number]> = [];
  const byLinks = ring.map((e, i) => ({ e, i })).sort((a, b) => (o.degree.get(b.e.id)! - o.degree.get(a.e.id)!) || (a.e.id < b.e.id ? -1 : 1));
  for (const { e, i } of byLinks) {
    if (named.size >= NAMED_AROUND) break;
    const t = angle(i);
    const x = cx + Math.cos(t) * R, y = cy + Math.sin(t) * R;
    const w = Math.min((e.name || 'Untitled').length, 22) * 7.6;
    const left = Math.cos(t) < -0.1;
    const box: [number, number, number, number] = left ? [x - 12 - w, y - 10, x, y + 10] : [x, y - 10, x + 12 + w, y + 10];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    named.add(e.id);
  }
  ring.forEach((e, i) => {
    const t = angle(i);
    const x = cx + Math.cos(t) * R;
    const y = cy + Math.sin(t) * R;
    const solid = outIds.has(e.id);
    s.append(svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: solid ? 'r-out' : 'r-in' }));
    const a = svg('a', { href: o.hrefOf(e.id), class: 'r-node' });
    const title = svg('title');
    title.textContent = e.name || 'Untitled';
    a.append(title, svg('circle', { cx: x, cy: y, r: 7, fill: inkOf(e.type) }));
    if (named.has(e.id)) {
      const left = Math.cos(t) < -0.1;
      const label = svg('text', { x: x + (left ? -12 : 12), y: y + 4, 'text-anchor': left ? 'end' : 'start', class: 'r-label' });
      const name = e.name || 'Untitled';
      label.textContent = name.length > 22 ? `${name.slice(0, 21)}…` : name;
      a.append(label);
    }
    s.append(a);
  });
  s.append(svg('circle', { cx, cy, r: 16, fill: inkOf(o.element.type), class: 'r-self' }));
  return s;
}

export function elementView(o: ElementViewOptions): HTMLElement {
  const el = o.element;
  const { out, in: inn } = neighbourhood(o.graph, el.id);
  const kind = [singularWord(el.type as ElementType), textOf(el.supertype), textOf(el.subtype)].filter(Boolean).join(' · ');
  const outside = o.graph.outside.get(el.id) ?? 0;
  const left = h(
    'section',
    { class: 'panel sheet' },
    h('h1', { class: 'ename' }, owMark(30, 'OnlyWorlds'), h('span', {}, el.name || 'Untitled')),
    picture(el.image_url, o.pictures),
    isKnownOfStub(el) ? h('p', { class: 'note' }, 'Known of: only part of this element is known here. Its other fields are unknown, not empty.') : null,
    textOf(el.description) ? h('p', { class: 'edesc' }, String(el.description)) : null,
    h('dl', { class: 'fields' }, h('div', { class: 'frow' }, h('dt', {}, 'Kind'), h('dd', { class: 'kind' }, typeIcon(el.type, 14), h('span', {}, kind))), ...fieldRows(o.graph, el, o.hrefOf)),
    outside > 0 ? h('p', { class: 'note' }, `${outside} ${outside === 1 ? 'link goes' : 'links go'} to elements not shown here.`) : null,
    h('p', { class: 'note' }, 'Little Lens only reads. To change this element, open it in Atlas or Lantern.'),
  );
  const right = h(
    'section',
    { class: 'panel around' },
    h('h2', { class: 'cap' }, `What it links to · ${out.length}, and what links to it · ${inn.length}`),
    out.length + inn.length > 0 ? radial(o) : h('p', { class: 'empty' }, 'Nothing links to this element, and it links to nothing shown here.'),
    h('p', { class: 'key' }, 'Solid line: this element links to it · dashed line: it links to this element'),
  );
  return h('div', { class: 'eview' }, left, right);
}
