/** A small element builder. Text goes in as text, never as markup: every name and description is a stranger's. */

import { ELEMENT_ICONS, familyOf, getElementLabel, type ElementType, type ElementFamily } from '@onlyworlds/sdk';
import { TYPE_ICON_PATHS } from './type-icons';
import owmark from './owmark.svg?raw';

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The type's glyph, coloured by the surrounding text. */
export function typeIcon(type: ElementType, size = 14): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 -960 960 960', width: size, height: size, 'aria-hidden': 'true', class: 'ticon' });
  const d = TYPE_ICON_PATHS[type];
  if (d) s.append(svg('path', { d, fill: 'currentColor' }));
  s.dataset.icon = ELEMENT_ICONS[type] ?? '';
  return s;
}

/** The OnlyWorlds mark, from its traced master (currentColor). */
export function owMark(size = 28, label = 'OnlyWorlds'): HTMLElement {
  const span = h('span', { class: 'owmark', role: 'img', 'aria-label': label });
  // The master is our own file, bundled at build: the one place markup goes in whole.
  span.innerHTML = owmark;
  const s = span.querySelector('svg');
  if (s) {
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.removeAttribute('role');
    s.setAttribute('aria-hidden', 'true');
  }
  return span;
}

/** The kind's colour on the dark ground: the old tool's palette, one per family. */
export const FAMILY_INK: Record<ElementFamily, string> = {
  agents: '#7fa8ec',
  world: '#5fb760',
  abstract: '#e07aa0',
  temporal: '#d6a548',
};

export function inkOf(type: ElementType): string {
  return FAMILY_INK[familyOf(type)];
}

/** "Characters" → "characters"; "Phenomena" stays plural. */
export function pluralWord(type: ElementType): string {
  return getElementLabel(type).toLowerCase();
}

/** The type's own word in the singular, from its slug. */
export function singularWord(type: ElementType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}
