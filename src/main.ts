/**
 * Little Lens: look at a world through a lens. It only reads. A public world comes from
 * OnlyWorlds signed out; a world file or folder is read in this tab and kept nowhere.
 */

import './style.css';
import { ELEMENT_TYPES, simpleCaseFold, type ElementType } from '@onlyworlds/sdk';
import { buildGraph, degrees, isKnownOfStub, type Element, type WorldGraph } from './lens/graph';
import { parseRoute, worldHash, type Route } from './lens/route';
import { PublicReadError, readPublicElements, readPublicWorldMeta, type Budget } from './lens/public-read';
import { readWorldFileBytes, readWorldFolder, type FileWorld, type PickedFile } from './lens/file-read';
import { clear, h, inkOf, owMark, pluralWord, typeIcon } from './ui/dom';
import { mountWeb, type WebHandle } from './ui/web';
import { elementView } from './ui/element-view';

export const MOPPETOPIA = '0695db52-5433-7332-8000-db7fe10da375';

interface Loaded {
  /** The public world's id, or null for the world held from a file. */
  worldId: string | null;
  name: string;
  sub: string;
  graph: WorldGraph;
  degree: Map<string, number>;
  /** Lines under the counts: what was left out and why, files that would not read. */
  notes: string[];
}

const app = document.getElementById('app')!;
let loaded: Loaded | null = null;
let loading: { worldId: string; ctl: AbortController } | null = null;
let web: WebHandle | null = null;
/** The world web's filter: one kind or all, and the search text. */
let filter: { type: ElementType | null; q: string } = { type: null, q: '' };

function screen(...children: (Node | null)[]): void {
  web?.destroy();
  web = null;
  clear(app);
  app.append(...children.filter((c): c is Node => c !== null));
}

function brandLink(): HTMLElement {
  return h('a', { class: 'brand', href: '#/', 'aria-label': 'Little Lens, the ways in' }, owMark(26, 'Little Lens'));
}

function top(name: string, sub: string): HTMLElement {
  return h('header', { class: 'top' }, brandLink(), h('span', { class: 'wname' }, name), h('span', { class: 'wsub' }, sub));
}

// -- The ways in -----------------------------------------------------------

function waysIn(line: string | null = null): void {
  const fileInput = h('input', { type: 'file', accept: '.owworld,.zip', class: 'hide', 'aria-hidden': 'true', tabindex: '-1' });
  const folderInput = h('input', { type: 'file', class: 'hide', 'aria-hidden': 'true', tabindex: '-1' });
  folderInput.setAttribute('webkitdirectory', '');
  const said = h('p', { class: 'said', role: 'status' }, line ?? '');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    said.textContent = 'Opening…';
    try {
      holdFile(readWorldFileBytes(new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      said.textContent = e instanceof Error ? e.message : 'That file could not be opened.';
    }
  });
  folderInput.addEventListener('change', async () => {
    const list = [...(folderInput.files ?? [])];
    if (list.length === 0) return;
    said.textContent = 'Opening…';
    const picked: PickedFile[] = list.map((f) => ({ path: f.webkitRelativePath || f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) }));
    try {
      holdFile(await readWorldFolder(picked));
    } catch (e) {
      said.textContent = e instanceof Error ? e.message : 'That folder could not be opened.';
    }
  });
  screen(
    h(
      'main',
      { class: 'ways' },
      owMark(60, 'OnlyWorlds'),
      h('h1', {}, 'Little Lens'),
      h('p', { class: 'tag' }, 'look at a world through a lens'),
      h('button', { class: 'way', type: 'button', onclick: () => fileInput.click() }, 'Open a world file'),
      h('button', { class: 'way', type: 'button', onclick: () => folderInput.click() }, 'Open a world folder'),
      h('p', { class: 'or' }, 'or look without an account'),
      h('a', { class: 'way', href: worldHash(MOPPETOPIA) }, 'Explore Moppetopia, a public world'),
      said,
      h('p', { class: 'only' }, 'Little Lens only reads. To change a world, open it in Atlas or Lantern.'),
      fileInput,
      folderInput,
    ),
  );
}

function holdFile(w: FileWorld): void {
  const g = buildGraph(w.elements);
  const notes = leftOutNotes(g);
  if (w.unreadable > 0) notes.push(`${w.unreadable} ${w.unreadable === 1 ? 'file' : 'files'} could not be read.`);
  loaded = { worldId: null, name: w.name, sub: 'opened from a file', graph: g, degree: degrees(g), notes };
  filter = { type: null, q: '' };
  if (location.hash === '#/file') route();
  else location.hash = '#/file';
}

function leftOutNotes(g: WorldGraph): string[] {
  const parts: string[] = [];
  if (g.leftOut.hidden) parts.push(`${g.leftOut.hidden} hidden`);
  if (g.leftOut.proposed) parts.push(`${g.leftOut.proposed} proposed`);
  if (g.leftOut.room) parts.push(`${g.leftOut.room} in a room`);
  return parts.length ? [`Left out: ${parts.join(', ')}.`] : [];
}

// -- A public world --------------------------------------------------------

const CLOSED_TITLE = 'You cannot open this world';
const CLOSED_LINE = 'It may be private, or the address may be wrong. Little Lens opens public worlds and world files.';

function closedDoor(): void {
  screen(
    h('header', { class: 'top' }, brandLink()),
    h('main', { class: 'closed' }, h('h1', {}, CLOSED_TITLE), h('p', {}, CLOSED_LINE), h('a', { class: 'way', href: '#/' }, 'Back to the ways in')),
  );
}

function failed(worldId: string, err: unknown): void {
  if (err instanceof PublicReadError && err.failure.kind === 'closed') return closedDoor();
  let line = 'Little Lens could not reach OnlyWorlds. Check your connection and try again.';
  if (err instanceof PublicReadError && err.failure.kind === 'slow-down') {
    const s = err.failure.retryAfter;
    line = `OnlyWorlds is asking Little Lens to slow down. Try again in ${s ? `${s} seconds` : 'a minute'}.`;
  } else if (err instanceof PublicReadError && err.failure.kind === 'server') {
    line = 'OnlyWorlds answered with an error. Try again in a moment.';
  }
  screen(
    h('header', { class: 'top' }, brandLink()),
    h('main', { class: 'closed' }, h('p', {}, line), h('button', { class: 'way', type: 'button', onclick: () => openPublic(worldId) }, 'Try again')),
  );
}

async function openPublic(worldId: string): Promise<void> {
  if (loaded?.worldId === worldId) return route();
  if (loading?.worldId === worldId) return;
  loading?.ctl.abort();
  const ctl = new AbortController();
  loading = { worldId, ctl };
  const progress = h('p', { class: 'said', role: 'status' }, 'Reading the world…');
  screen(h('header', { class: 'top' }, brandLink()), h('main', { class: 'closed' }, progress));
  try {
    let budget: Budget | undefined;
    const meta = await readPublicWorldMeta(worldId, fetch, ctl.signal, (b) => (budget = b));
    progress.textContent = `Reading ${meta.name}…`;
    const els = await readPublicElements(
      meta,
      fetch,
      {
        budget,
        onProgress: (d, t) => (progress.textContent = `Reading ${meta.name}: ${d} of ${t} types`),
        onWait: (s) => (progress.textContent = `OnlyWorlds asks Little Lens to pace its reading. Continuing in ${s} seconds…`),
      },
      ctl.signal,
    );
    if (loading?.ctl !== ctl) return;
    const g = buildGraph(els);
    loaded = { worldId, name: meta.name, sub: 'public world, signed out', graph: g, degree: degrees(g), notes: leftOutNotes(g) };
    filter = { type: null, q: '' };
    loading = null;
    route();
  } catch (e) {
    if (loading?.ctl !== ctl) return;
    loading = null;
    failed(worldId, e);
  }
}

// -- The world page --------------------------------------------------------

function matches(el: Element, q: string): boolean {
  if (!q) return true;
  const hay = simpleCaseFold(`${el.name ?? ''} ${typeof el.description === 'string' ? el.description : ''}`);
  return hay.includes(simpleCaseFold(q));
}

function worldPage(l: Loaded, view: 'web' | 'list'): void {
  const g = l.graph;
  const counts = new Map<ElementType, number>();
  for (const n of g.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const lit = (id: string) => {
    const el = g.byId.get(id);
    return !!el && (filter.type === null || el.type === filter.type) && matches(el, filter.q);
  };
  const hrefOf = (id: string) => worldHash(l.worldId, id);

  const search = h('input', { type: 'search', class: 'search', placeholder: 'search name and description', 'aria-label': 'Search name and description', value: filter.q });
  const switcher = h(
    'nav',
    { class: 'switch', 'aria-label': 'View' },
    h('a', { href: worldHash(l.worldId, null, 'web'), class: view === 'web' ? 'on' : '', 'aria-current': view === 'web' ? 'page' : null }, 'Web'),
    h('a', { href: worldHash(l.worldId, null, 'list'), class: view === 'list' ? 'on' : '', 'aria-current': view === 'list' ? 'page' : null }, 'List'),
  );
  const pills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Types' });
  const drawPills = () => {
    clear(pills);
    const all = h('button', { type: 'button', class: `pill${filter.type === null ? ' on' : ''}`, 'aria-pressed': String(filter.type === null), onclick: () => setType(null) }, `all ${g.nodes.length}`);
    pills.append(all);
    for (const t of ELEMENT_TYPES) {
      const n = counts.get(t);
      if (!n) continue;
      const b = h('button', { type: 'button', class: `pill${filter.type === t ? ' on' : ''}`, 'aria-pressed': String(filter.type === t), onclick: () => setType(filter.type === t ? null : t) }, typeIcon(t, 13), h('span', {}, `${pluralWord(t)} ${n}`));
      b.style.setProperty('--ink', inkOf(t));
      pills.append(b);
    }
  };
  const body = h('div', { class: 'wbody' });
  const drawList = () => {
    clear(body);
    // Code-unit order of the folded name, then the id: the same in every viewer's locale.
    const key = (n: Element) => simpleCaseFold(n.name ?? '');
    const rows = g.nodes.filter((n) => lit(n.id)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : 1));
    if (rows.length === 0) {
      body.append(h('p', { class: 'empty' }, 'Nothing matches.'));
      return;
    }
    const grid = h('ul', { class: 'cards' });
    for (const n of rows) {
      const desc = typeof n.description === 'string' ? n.description : '';
      const stub = isKnownOfStub(n);
      const card = h('li', {}, h('a', { class: 'card', href: hrefOf(n.id) }, h('span', { class: 'chead' }, typeIcon(n.type, 15), h('span', { class: 'cname' }, n.name || 'Untitled'), h('span', { class: 'cdeg' }, stub ? 'known of' : String(l.degree.get(n.id) ?? 0))), desc ? h('span', { class: 'cdesc' }, desc) : null));
      card.style.setProperty('--ink', inkOf(n.type));
      grid.append(card);
    }
    body.append(grid);
  };
  const refresh = () => {
    drawPills();
    if (view === 'web') web?.redraw();
    else drawList();
  };
  const setType = (t: ElementType | null) => {
    filter = { ...filter, type: t };
    refresh();
  };
  search.addEventListener('input', () => {
    filter = { ...filter, q: search.value };
    refresh();
  });

  const lens = h('label', { class: 'lens' }, h('span', {}, 'Lens'), h('select', { disabled: true, 'aria-label': 'Lens' }, h('option', {}, 'The whole world')));
  const tally = h('span', { class: 'tally' }, h('b', {}, String(g.nodes.length)), ' elements · ', h('b', {}, String(g.edges.length)), ' links');
  const empty = g.nodes.length === 0;
  screen(
    top(l.name, l.sub),
    h(
      'main',
      { class: 'world' },
      h('div', { class: 'bar' }, search, switcher),
      pills,
      h('div', { class: 'meta' }, lens, tally, ...l.notes.map((n) => h('span', { class: 'leftout' }, n))),
      empty ? h('p', { class: 'empty' }, 'Nothing to draw: this world has no elements Little Lens shows.') : body,
    ),
  );
  drawPills();
  if (empty) return;
  if (view === 'web') web = mountWeb(body, { graph: g, degree: l.degree, lit, onOpen: (id) => (location.hash = hrefOf(id)) });
  else drawList();
}

function elementPage(l: Loaded, id: string): void {
  const el = l.graph.byId.get(id);
  if (!el) {
    // An element this world does not show here: the same door as a world that is closed.
    screen(
      top(l.name, l.sub),
      h('main', { class: 'closed' }, h('h1', {}, 'You cannot open this element'), h('p', {}, 'It may be private, left out of this view, or the address may be wrong.'), h('a', { class: 'way', href: worldHash(l.worldId) }, 'Back to the world')),
    );
    return;
  }
  screen(
    top(l.name, l.sub),
    h('nav', { class: 'crumbs' }, h('a', { href: worldHash(l.worldId) }, `← ${l.name}`)),
    // A file's pictures are never fetched: what a file names, the file's author chose.
    h('main', { class: 'element' }, elementView({ graph: l.graph, degree: l.degree, element: el, hrefOf: (i) => worldHash(l.worldId, i), pictures: l.worldId !== null })),
  );
  document.title = `${el.name || 'Untitled'} · Little Lens`;
}

// -- The router ------------------------------------------------------------

function route(): void {
  const r: Route = parseRoute(location.hash);
  document.title = 'Little Lens · OnlyWorlds';
  if (r.kind === 'home') return waysIn();
  if (r.kind === 'closed') return closedDoor();
  if (r.kind === 'file') {
    if (!loaded || loaded.worldId !== null) return waysIn('Open the file again: Little Lens keeps nothing once the page closes.');
    return r.elementId ? elementPage(loaded, r.elementId) : worldPage(loaded, r.view);
  }
  if (loaded?.worldId !== r.worldId) {
    void openPublic(r.worldId);
    return;
  }
  if (r.elementId) elementPage(loaded, r.elementId);
  else worldPage(loaded, r.view);
}

window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});
route();
