/**
 * Little Lens: look at a world through a lens. It only reads. A public world comes from
 * OnlyWorlds signed out; a signed-in person's worlds on one account token held in memory; a world
 * file or folder is read in this tab and kept nowhere.
 */

import './style.css';
import { ELEMENT_TYPES, OwApiError, simpleCaseFold, type ElementType, type OwAccountWorld } from '@onlyworlds/sdk';
import { buildGraph, degrees, isKnownOfStub, type Element, type WorldGraph } from './lens/graph';
import { parseRoute, worldHash, type Reader, type Route } from './lens/route';
import { ReadError, readWorldElements, readWorldMeta, type Budget } from './lens/world-read';
import { readWorldFileBytes, readWorldFolder, type FileWorld, type PickedFile } from './lens/file-read';
import { beginOnlyWorldsSignIn, canSignInWithOnlyWorlds, isSignInCallback, signInCallbackLine, startSignInCallback, sweepStaleRecord, type SignInOutcome } from './lens/signin';
import { listMyWorlds, revokeToken, type SignedIn } from './lens/account';
import { clear, h, inkOf, owMark, pluralWord, typeIcon } from './ui/dom';
import { mountWeb, type WebHandle } from './ui/web';
import { mountTime, type TimeHandle } from './ui/time-view';
import { readTime, type TimeReading, type WorldTime } from './lens/time';
import { elementView } from './ui/element-view';

export const MOPPETOPIA = '0695db52-5433-7332-8000-db7fe10da375';

interface Loaded {
  /** Who it was read as: a world is the pair (reader, id), never the id alone. */
  reader: Reader;
  /** The world's id, or null for the world held from a file. */
  worldId: string | null;
  name: string;
  sub: string;
  graph: WorldGraph;
  degree: Map<string, number>;
  /** The world's unit and now; the time reading of its kept elements, made on first use. */
  time: WorldTime;
  reading: TimeReading | null;
  /** Lines under the counts: what was left out and why, files that would not read. */
  notes: string[];
}

const app = document.getElementById('app')!;
let loaded: Loaded | null = null;
/** The one read in flight; any new read aborts it. */
let loading: { reader: 'public' | 'me'; worldId: string; ctl: AbortController } | null = null;
let web: WebHandle | null = null;
/** The time view on screen, and the world it stands for: a change of moment alone redraws it in place. */
let timeView: { handle: TimeHandle; key: string } | null = null;
/** The world web's filter: one kind or all, and the search text. */
let filter: { type: ElementType | null; q: string } = { type: null, q: '' };

/** The sign-in: one token in this page's memory, never stored. */
let session: SignedIn | null = null;
/** The picker's list for this sign-in, read once per sign-in. */
let worlds: OwAccountWorld[] | null = null;
let worldsRead: AbortController | null = null;
let worldsProblem: string | null = null;
/** The callback's exchange is running: nothing routes until its outcome. */
let exchanging = false;
/** The page has started to leave: a token that arrives now is revoked on arrival. */
let leaving = false;
/** A line the next ways in says once (signed out, the sign-in ended, a refused return). */
let notice: string | null = null;

const ENDED_LINE = 'Your sign-in ended on OnlyWorlds, so Little Lens is signed out. Sign in again to go on.';
const LEFT_LINE = 'You left the page, so Little Lens signed you out.';

// The callback's code leaves the address before any other request; on any other load, a round
// trip nobody came back from is dropped.
const callback: Promise<SignInOutcome> | null = isSignInCallback() ? startSignInCallback() : null;
if (!callback) sweepStaleRecord();

// The page is done with the token when it leaves. A page that comes back from the back/forward
// cache held a token this revoked, so it signs out.
window.addEventListener('pagehide', () => {
  leaving = true;
  if (session) void revokeToken(session);
});
window.addEventListener('pageshow', (e) => {
  leaving = false;
  if (e.persisted && session) {
    // The page is alive again: one more revoke costs a request and covers a hide that lost its own.
    void revokeToken(session);
    endSession(LEFT_LINE);
  }
});

/** Forget the sign-in and everything read on it, and go to the ways in with a line. */
function endSession(line: string): void {
  if (loading?.reader === 'me') {
    loading.ctl.abort();
    loading = null;
  }
  worldsRead?.abort();
  worldsRead = null;
  if (loaded?.reader === 'me') loaded = null;
  session = null;
  worlds = null;
  worldsProblem = null;
  notice = line;
  // Only a screen that stood on the sign-in moves: a public world or a file needs none, and keeps
  // its place; the line waits for the next ways in.
  const r = parseRoute(location.hash);
  if (r.kind === 'home') route();
  else if (r.kind === 'world' && r.reader === 'me') location.hash = '#/';
}

/** The one read in flight is nobody's once the person stands anywhere else. */
function dropRead(): void {
  loading?.ctl.abort();
  loading = null;
}

async function signOut(): Promise<void> {
  const s = session;
  if (!s) return;
  // A read in flight goes first, so its answer never paints over what follows.
  loading?.ctl.abort();
  loading = null;
  worldsRead?.abort();
  worldsRead = null;
  if (loaded?.reader === 'me') loaded = null;
  session = null;
  worlds = null;
  worldsProblem = null;
  screen(h('main', { class: 'closed' }, h('p', { class: 'said', role: 'status' }, 'Signing out…')));
  const out = await revokeToken(s);
  notice =
    out === 'revoked'
      ? 'Signed out, and the sign-in is removed from your OnlyWorlds account.'
      : 'Signed out here, but OnlyWorlds did not confirm the sign-in was removed, so it may still be live. Remove it in Account settings on onlyworlds.com.';
  history.replaceState(null, '', '/#/');
  route();
}

function screen(...children: (Node | null)[]): void {
  web?.destroy();
  web = null;
  timeView?.handle.destroy();
  timeView = null;
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
      session ? yourWorlds(session) : signInWay(said),
      h('button', { class: 'way', type: 'button', onclick: () => fileInput.click() }, 'Open a world file'),
      h('button', { class: 'way', type: 'button', onclick: () => folderInput.click() }, 'Open a world folder'),
      h('p', { class: 'or' }, 'or look without an account'),
      h('a', { class: 'way', href: worldHash('public', MOPPETOPIA) }, 'Explore Moppetopia, a public world'),
      said,
      h('p', { class: 'only' }, 'Little Lens only reads. To change a world, open it in Atlas or Lantern.'),
      fileInput,
      folderInput,
    ),
  );
}

/** The third way in, only on the registered origin. A `#/me/` address waiting is kept for the return. */
function signInWay(said: HTMLElement): HTMLElement | null {
  if (!canSignInWithOnlyWorlds()) return null;
  return h(
    'button',
    {
      class: 'way primary',
      type: 'button',
      onclick: () => {
        const r = parseRoute(location.hash);
        const resume = r.kind === 'world' && r.reader === 'me' ? worldHash('me', r.worldId, r.elementId, r.view === 'time' ? 'time' : 'web', r.view === 'time' ? r.at : null) : null;
        said.textContent = 'Going to OnlyWorlds…';
        beginOnlyWorldsSignIn(resume).catch((err: unknown) => (said.textContent = err instanceof Error ? err.message : 'Signing in did not start. Try again.'));
      },
    },
    'Sign in with OnlyWorlds',
  );
}

/** Signed in, the ways in shows who and their worlds, never a second Sign in. */
function yourWorlds(s: SignedIn): HTMLElement {
  const list = h('div', { class: 'picker' });
  if (worlds === null) {
    if (worldsProblem) {
      list.append(h('p', { class: 'said' }, worldsProblem), h('button', { class: 'way', type: 'button', onclick: () => ((worldsProblem = null), route()) }, 'Try again'));
    } else {
      list.append(h('p', { class: 'said', role: 'status' }, 'Reading your worlds…'));
      void readMyWorlds(s);
    }
  } else if (worlds.length === 0) {
    list.append(h('p', { class: 'said' }, 'This account has no worlds yet. Make one on onlyworlds.com, or open a world file.'));
  } else {
    const ul = h('ul', { class: 'mine', 'aria-label': 'Your worlds' });
    for (const w of worlds) {
      ul.append(h('li', {}, h('a', { class: 'way', href: worldHash('me', w.id) }, h('span', { class: 'mname' }, w.name || 'Untitled world'), h('span', { class: 'mrole' }, w.role === 'owner' ? 'yours' : 'shared'))));
    }
    list.append(ul);
  }
  return h(
    'section',
    { class: 'signed', 'aria-label': 'Signed in' },
    h('p', { class: 'who' }, 'Signed in as ', h('b', {}, s.username), ' · ', h('button', { class: 'linkish', type: 'button', onclick: () => void signOut() }, 'Sign out')),
    list,
  );
}

async function readMyWorlds(s: SignedIn): Promise<void> {
  if (worldsRead) return;
  const ctl = new AbortController();
  worldsRead = ctl;
  try {
    const got = await listMyWorlds(s, { signal: ctl.signal });
    if (worldsRead !== ctl || session !== s) return;
    worlds = got;
  } catch (err) {
    if (worldsRead !== ctl || session !== s) return;
    if (err instanceof OwApiError && err.status === 401) {
      worldsRead = null;
      return endSession(ENDED_LINE);
    }
    worldsProblem =
      err instanceof OwApiError && err.isRateLimited
        ? `OnlyWorlds is asking Little Lens to slow down. Try again in ${err.retryAfter ? `${err.retryAfter} seconds` : 'a minute'}.`
        : 'Little Lens could not read your worlds. Check your connection and try again.';
  }
  worldsRead = null;
  if (parseRoute(location.hash).kind === 'home') route();
}

function holdFile(w: FileWorld): void {
  const g = buildGraph(w.elements);
  const notes = leftOutNotes(g);
  if (w.unreadable > 0) notes.push(`${w.unreadable} ${w.unreadable === 1 ? 'file' : 'files'} could not be read.`);
  dropRead();
  loaded = { reader: 'file', worldId: null, name: w.name, sub: 'opened from a file', graph: g, degree: degrees(g), time: w.time, reading: null, notes };
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

// -- A world on OnlyWorlds: public, or signed in ---------------------------

const CLOSED_TITLE = 'You cannot open this world';
const CLOSED_LINE = 'It may be private, or the address may be wrong. Little Lens opens public worlds and world files.';
const CLOSED_LINE_ME = 'Your account may not be in it, or the address may be wrong.';

function closedDoor(reader: 'public' | 'me' = 'public'): void {
  screen(
    h('header', { class: 'top' }, brandLink()),
    h(
      'main',
      { class: 'closed' },
      h('h1', {}, CLOSED_TITLE),
      h('p', {}, reader === 'me' ? CLOSED_LINE_ME : session ? `${CLOSED_LINE} If it is one of your worlds, open it from your worlds on the first screen.` : CLOSED_LINE),
      h('a', { class: 'way', href: '#/' }, reader === 'me' ? 'Back to your worlds' : 'Back to the ways in'),
    ),
  );
}

function failed(reader: 'public' | 'me', worldId: string, err: unknown): void {
  if (err instanceof ReadError && err.failure.kind === 'ended') return endSession(ENDED_LINE);
  if (err instanceof ReadError && err.failure.kind === 'closed') return closedDoor(reader);
  let line = 'Little Lens could not reach OnlyWorlds. Check your connection and try again.';
  if (err instanceof ReadError && err.failure.kind === 'slow-down') {
    const s = err.failure.retryAfter;
    line = `OnlyWorlds is asking Little Lens to slow down. Try again in ${s ? `${s} seconds` : 'a minute'}.`;
  } else if (err instanceof ReadError && err.failure.kind === 'server') {
    line = 'OnlyWorlds answered with an error. Try again in a moment.';
  }
  screen(
    h('header', { class: 'top' }, brandLink()),
    h('main', { class: 'closed' }, h('p', {}, line), h('button', { class: 'way', type: 'button', onclick: () => openWorld(reader, worldId) }, 'Try again')),
  );
}

/** One read per open of a world: keyless for `public`, on the session's token for `me`. */
async function openWorld(reader: 'public' | 'me', worldId: string): Promise<void> {
  if (loaded?.reader === reader && loaded.worldId === worldId) return route();
  if (loading?.reader === reader && loading.worldId === worldId) return;
  const s = reader === 'me' ? session : null;
  if (reader === 'me' && !s) return route();
  loading?.ctl.abort();
  const ctl = new AbortController();
  loading = { reader, worldId, ctl };
  const token = s?.token ?? null;
  const progress = h('p', { class: 'said', role: 'status' }, 'Reading the world…');
  screen(h('header', { class: 'top' }, brandLink()), h('main', { class: 'closed' }, progress));
  try {
    let budget: Budget | undefined;
    const meta = await readWorldMeta(worldId, fetch, ctl.signal, (b) => (budget = b), token);
    progress.textContent = `Reading ${meta.name}…`;
    const els = await readWorldElements(
      meta,
      fetch,
      {
        budget,
        onProgress: (d, t) => (progress.textContent = `Reading ${meta.name}: ${d} of ${t} types`),
        onWait: (sec) => (progress.textContent = `OnlyWorlds asks Little Lens to pace its reading. Continuing in ${sec} seconds…`),
      },
      ctl.signal,
      token,
    );
    if (!stillWanted(ctl, s, reader, worldId)) return;
    const g = buildGraph(els);
    const sub = s ? `signed in as ${s.username}` : session ? 'public world, read without your sign-in' : 'public world, signed out';
    loaded = { reader, worldId, name: meta.name, sub, graph: g, degree: degrees(g), time: meta.time, reading: null, notes: leftOutNotes(g) };
    filter = { type: null, q: '' };
    loading = null;
    route();
  } catch (e) {
    if (!stillWanted(ctl, s, reader, worldId)) return;
    loading = null;
    failed(reader, worldId, e);
  }
}

/**
 * A read lands only while it is the read in flight, on the sign-in it began with, and the address
 * still names its world; otherwise it is nobody's, and its slot is freed.
 */
function stillWanted(ctl: AbortController, s: SignedIn | null, reader: 'public' | 'me', worldId: string): boolean {
  if (loading?.ctl !== ctl) return false;
  const r = parseRoute(location.hash);
  if ((s && session !== s) || r.kind !== 'world' || r.reader !== reader || r.worldId !== worldId) {
    loading = null;
    return false;
  }
  return true;
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
  const hrefOf = (id: string) => worldHash(l.reader, l.worldId, id);

  const search = h('input', { type: 'search', class: 'search', placeholder: 'search name and description', 'aria-label': 'Search name and description', value: filter.q });
  const switcher = h(
    'nav',
    { class: 'switch', 'aria-label': 'View' },
    h('a', { href: worldHash(l.reader, l.worldId, null, 'web'), class: view === 'web' ? 'on' : '', 'aria-current': view === 'web' ? 'page' : null }, 'Web'),
    h('a', { href: worldHash(l.reader, l.worldId, null, 'list'), class: view === 'list' ? 'on' : '', 'aria-current': view === 'list' ? 'page' : null }, 'List'),
    h('a', { href: worldHash(l.reader, l.worldId, null, 'time') }, 'Time'),
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

/** The time view: the strip, the moment and the dated list, read from the web's own kept elements. */
function timePage(l: Loaded, at: number | null): void {
  const reading = (l.reading ??= readTime(l.graph.nodes));
  const switcher = h(
    'nav',
    { class: 'switch', 'aria-label': 'View' },
    h('a', { href: worldHash(l.reader, l.worldId, null, 'web') }, 'Web'),
    h('a', { href: worldHash(l.reader, l.worldId, null, 'list') }, 'List'),
    h('a', { href: worldHash(l.reader, l.worldId, null, 'time'), class: 'on', 'aria-current': 'page' }, 'Time'),
  );
  const body = h('section', { class: 'time', 'aria-label': 'Time' });
  screen(top(l.name, l.sub), h('main', { class: 'world' }, h('div', { class: 'bar' }, h('h2', { class: 'ttitle' }, 'Time'), switcher), ...l.notes.map((n) => h('p', { class: 'leftout' }, n)), body));
  timeView = {
    handle: mountTime(body, { reading, time: l.time, at, hrefOf: (id) => worldHash(l.reader, l.worldId, id), hashFor: (a) => worldHash(l.reader, l.worldId, null, 'time', a) }),
    key: timeKey(l),
  };
}

/** Which world a time view stands for: the reader and the id, or the file. */
function timeKey(l: Loaded): string {
  return `${l.reader}:${l.worldId ?? ''}`;
}

function elementPage(l: Loaded, id: string): void {
  const el = l.graph.byId.get(id);
  if (!el) {
    // An element this world does not show here: the same door as a world that is closed.
    screen(
      top(l.name, l.sub),
      h('main', { class: 'closed' }, h('h1', {}, 'You cannot open this element'), h('p', {}, 'It may be private, left out of this view, or the address may be wrong.'), h('a', { class: 'way', href: worldHash(l.reader, l.worldId) }, 'Back to the world')),
    );
    return;
  }
  screen(
    top(l.name, l.sub),
    h('nav', { class: 'crumbs' }, h('a', { href: worldHash(l.reader, l.worldId) }, `← ${l.name}`)),
    // A file's pictures are never fetched: what a file names, the file's author chose.
    h('main', { class: 'element' }, elementView({ graph: l.graph, degree: l.degree, element: el, hrefOf: (i) => worldHash(l.reader, l.worldId, i), pictures: l.reader !== 'file' })),
  );
  document.title = `${el.name || 'Untitled'} · Little Lens`;
}

// -- The router ------------------------------------------------------------

function route(): void {
  if (exchanging) return;
  const r: Route = parseRoute(location.hash);
  document.title = 'Little Lens · OnlyWorlds';
  if (r.kind !== 'world') dropRead();
  if (r.kind === 'home') {
    const line = notice;
    notice = null;
    return waysIn(line);
  }
  if (r.kind === 'closed') return closedDoor(location.hash.startsWith('#/me/') ? 'me' : 'public');
  if (r.kind === 'file') {
    if (!loaded || loaded.reader !== 'file') return waysIn('Open the file again: Little Lens keeps nothing once the page closes.');
    if (r.elementId) return elementPage(loaded, r.elementId);
    return r.view === 'time' ? timePage(loaded, r.at) : worldPage(loaded, r.view);
  }
  // A signed-in address never falls back to a public read of the same world.
  if (r.reader === 'me' && !session) return waysIn(canSignInWithOnlyWorlds() ? 'Sign in to open this world.' : 'This address opens a world signed in, on little-lens.onlyworlds.com.');
  if (loaded?.reader !== r.reader || loaded.worldId !== r.worldId) {
    void openWorld(r.reader, r.worldId);
    return;
  }
  if (r.elementId) elementPage(loaded, r.elementId);
  else if (r.view === 'time') timePage(loaded, r.at);
  else worldPage(loaded, r.view);
}

window.addEventListener('hashchange', () => {
  // Back and Forward between moments of the time view on screen: redrawn in place, no scroll.
  const r = parseRoute(location.hash);
  if (timeView && loaded && !exchanging && (r.kind === 'world' || r.kind === 'file') && r.view === 'time' && !r.elementId) {
    const key = r.kind === 'file' ? 'file:' : `${r.reader}:${r.worldId}`;
    if (key === timeView.key && key === timeKey(loaded)) return timeView.handle.setAt(r.at);
  }
  route();
  window.scrollTo(0, 0);
});

/** On the callback, "Signing in…" with nothing to press, and the first route only after the outcome. */
async function start(): Promise<void> {
  if (callback) {
    exchanging = true;
    screen(h('main', { class: 'ways' }, owMark(60, 'OnlyWorlds'), h('p', { class: 'said', role: 'status' }, 'Signing in…')));
    const outcome = await callback;
    exchanging = false;
    if (outcome.ok) {
      const s: SignedIn = { token: outcome.token, tokenId: outcome.tokenId, username: outcome.username };
      // A token that arrives after the page started to leave is revoked on arrival, and a page
      // that comes back finds the ways in, not a sign-in it no longer holds.
      if (leaving) {
        void revokeToken(s);
        notice = LEFT_LINE;
        history.replaceState(null, '', '/#/');
      } else {
        session = s;
        history.replaceState(null, '', `/${outcome.resume ?? '#/'}`);
      }
    } else {
      if (!outcome.cancelled) console.warn('[sign-in] the return did not sign in:', outcome.error);
      notice = signInCallbackLine(outcome);
      history.replaceState(null, '', '/#/');
    }
  }
  route();
}

void start();
