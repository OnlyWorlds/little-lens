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
import { readDraught, type Draught } from './lens/draught';
import { mountDraught, type DraughtHandle } from './ui/draught-view';
import { isMessage, type OwMessageMember } from '@onlyworlds/sdk';
import { holdsMessages, readMessages, threadOfId, type MessageReading, type Source } from './lens/messages';
import { messagesList, messagesThread } from './ui/messages-view';
import { openStandard, standardWorlds } from './lens/standard';

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
  /**
   * Draughts read in this world, by Character and moment, in memory only: they go with the world
   * (another world, sign-out, the sign-in ending), so a signed-in packet never outlives its sign-in.
   */
  draughts: Map<string, Draught>;
  /** Every body read, for the readers that are not the graph's (the messages). */
  bodies: Element[];
  /** Where the bodies came from, and the members list when there is one to read. */
  source: Source;
  members: readonly OwMessageMember[] | null;
  /** The messages reading, made on the first Messages page; whether there is one, on the first switcher. */
  messages: MessageReading | null;
  hasMessages?: boolean;
}

/** Packets kept per open world; the oldest goes first. */
const DRAUGHTS_KEPT = 64;

const app = document.getElementById('app')!;
// Every page sets its own scroll: a redraw in place (a moment) keeps it, any other page starts at
// the top. The browser's own restore would move a page that redrew in place.
history.scrollRestoration = 'manual';
let loaded: Loaded | null = null;
/** The one read in flight; any new read aborts it. */
let loading: { reader: 'public' | 'me'; worldId: string; ctl: AbortController } | null = null;
let web: WebHandle | null = null;
/** The time view on screen, and the world it stands for: a change of moment alone redraws it in place. */
let timeView: { handle: TimeHandle; key: string } | null = null;
/** The draught on screen, and the Character it stands for, the same way. */
let draughtView: { handle: DraughtHandle; key: string } | null = null;
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

/**
 * A draught on the sign-in stops reading: a read still running when the token goes would answer
 * 401 and say the sign-in ended over the line that says why it did.
 */
function dropSignedInDraught(): void {
  if (!draughtView?.key.startsWith('me:')) return;
  draughtView.handle.destroy();
  draughtView = null;
}

/** Forget the sign-in and everything read on it, and go to the ways in with a line. */
function endSession(line: string): void {
  dropSignedInDraught();
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
  dropSignedInDraught();
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
  draughtView?.handle.destroy();
  draughtView = null;
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
      h('a', { class: 'way', href: '#/std' }, 'Small worlds from the OnlyWorlds standard'),
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
        // The list resumes as its world (the resume takes no `?view=`); a moment rides along.
        const resume = r.kind === 'world' && r.reader === 'me' ? worldHash('me', r.worldId, r.elementId, r.view === 'list' ? 'web' : r.view, 'at' in r ? r.at : null, r.view === 'messages' ? r.thread : null) : null;
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
  loaded = { reader: 'file', worldId: null, name: w.name, sub: 'opened from a file', graph: g, degree: degrees(g), time: w.time, reading: null, notes, draughts: new Map(), bodies: w.elements, source: 'file', members: null, messages: null };
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

function closedDoor(reader: 'public' | 'me' | 'standard' = 'public'): void {
  if (reader === 'standard') {
    screen(
      h('header', { class: 'top' }, brandLink()),
      h('main', { class: 'closed' }, h('h1', {}, CLOSED_TITLE), h('p', {}, 'Little Lens holds no small world at this address.'), h('a', { class: 'way', href: '#/std' }, 'Back to the small worlds')),
    );
    return;
  }
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
    // Signed in, no members list until keel serves it to the token: senders stay claims.
    loaded = { reader, worldId, name: meta.name, sub, graph: g, degree: degrees(g), time: meta.time, reading: null, notes: leftOutNotes(g), draughts: new Map(), bodies: els, source: reader, members: null, messages: null };
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
  const switcher = switcherFor(l, view);
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

/** The world's messages, read once from every body read. */
function messagesOf(l: Loaded): MessageReading {
  return (l.messages ??= readMessages(l.bodies, l.source, l.members));
}

/** Messages is a view only where the world holds one, shown or hidden. */
function hasMessages(l: Loaded): boolean {
  return (l.hasMessages ??= holdsMessages(l.bodies));
}

function switcherFor(l: Loaded, current: 'web' | 'list' | 'time' | 'messages'): HTMLElement {
  const link = (v: 'web' | 'list' | 'time' | 'messages', label: string) =>
    h('a', { href: worldHash(l.reader, l.worldId, null, v), class: current === v ? 'on' : '', 'aria-current': current === v ? 'page' : null }, label);
  return h('nav', { class: 'switch', 'aria-label': 'View' }, link('web', 'Web'), link('list', 'List'), link('time', 'Time'), hasMessages(l) ? link('messages', 'Messages') : null);
}

/** What cannot be checked about these messages, said once at the head. */
function checkLineOf(l: Loaded): string | null {
  if (l.source === 'public') return 'Read as the public: senders cannot be checked, a message may have recipients the public cannot see, and read marks are not shown.';
  if (l.source === 'me' && l.members === null) return 'Senders cannot be checked here yet, so each says who it claims to be from, and read marks are not shown.';
  if (!messagesOf(l).marksCount) return 'Read marks cannot be checked here, so none is shown.';
  return null;
}

function cannotOpenConversation(l: Loaded): void {
  screen(
    top(l.name, l.sub),
    h('main', { class: 'closed' }, h('h1', {}, 'You cannot open this conversation'), h('p', {}, hasMessages(l) ? 'It may be hidden, or the address may be wrong.' : 'This world holds no messages Little Lens shows.'), hasMessages(l) ? h('a', { class: 'way', href: worldHash(l.reader, l.worldId, null, 'messages') }, 'Back to the messages') : h('a', { class: 'way', href: worldHash(l.reader, l.worldId) }, 'Back to the world')),
  );
}

/** The conversations, or one of them by any of its messages' ids. */
function messagesPage(l: Loaded, thread: string | null): void {
  const r = messagesOf(l);
  if (!hasMessages(l)) return cannotOpenConversation(l);
  const t = thread === null ? null : threadOfId(r, thread);
  if (thread !== null && !t) return cannotOpenConversation(l);
  const props = {
    reading: r,
    // A room's card is no element of the web: its name is said, never linked.
    elementHref: (id: string) => (l.graph.byId.has(id) ? worldHash(l.reader, l.worldId, id) : null),
    threadHref: (root: string) => worldHash(l.reader, l.worldId, null, 'messages', null, root),
    listHref: worldHash(l.reader, l.worldId, null, 'messages'),
    checkLine: checkLineOf(l),
  };
  screen(
    top(l.name, l.sub),
    h('main', { class: 'world' }, h('div', { class: 'bar' }, h('h2', { class: 'ttitle' }, 'Messages'), switcherFor(l, 'messages')), t ? messagesThread(props, t) : messagesList(props)),
  );
  document.title = `${t ? 'A conversation' : 'Messages'} · ${l.name} · Little Lens`;
}

// -- The small worlds from the standard ------------------------------------

/** The elements a small world opens with: its hidden ones are left out. */
function shownCount(w: { elements: { id: string }[]; hidden?: string[] }): number {
  const hidden = new Set(w.hidden ?? []);
  return w.elements.filter((e) => !hidden.has(e.id)).length;
}

function standardList(): void {
  const host = h('main', { class: 'closed std' }, h('p', { class: 'said', role: 'status' }, 'Opening the small worlds…'));
  screen(h('header', { class: 'top' }, brandLink()), host);
  standardWorlds()
    .then((f) => {
      if (parseRoute(location.hash).kind !== 'standard-list') return;
      clear(host);
      const ul = h('ul', { class: 'mine', 'aria-label': 'Small worlds' });
      for (const w of f.worlds) {
        ul.append(h('li', {}, h('a', { class: 'way', href: worldHash('standard', w.id) }, h('span', { class: 'mname' }, w.name), h('span', { class: 'mrole' }, `${w.profile} profile · ${shownCount(w)} ${shownCount(w) === 1 ? 'element' : 'elements'}`))));
      }
      host.append(
        h('h1', {}, 'Small worlds from the OnlyWorlds standard'),
        h('p', {}, `The worlds the standard's lens and charter profiles are tested on, release ${f.serial}. Each opens as its owner sees it.`),
        ul,
        h('a', { class: 'way', href: '#/' }, 'Back to the ways in'),
      );
    })
    .catch(() => {
      clear(host);
      host.append(h('p', {}, 'The small worlds could not be opened. Reload the page and try again.'), h('a', { class: 'way', href: '#/' }, 'Back to the ways in'));
    });
}

/** The small world being opened, so a second address change while it opens does not open it twice. */
let openingStandard: string | null = null;

/** A small world, opened from the bundled file: the same at every reload. */
async function openStandardWorld(worldId: string): Promise<void> {
  if (openingStandard === worldId) return;
  openingStandard = worldId;
  dropRead();
  screen(h('header', { class: 'top' }, brandLink()), h('main', { class: 'closed' }, h('p', { class: 'said', role: 'status' }, 'Opening the world…')));
  let opened: Awaited<ReturnType<typeof openStandard>>;
  try {
    opened = await openStandard(worldId);
  } catch {
    // The page's own chunk did not load (offline, or a newer release under an open tab): not "no such world".
    if (openingStandard === worldId) openingStandard = null;
    const r = parseRoute(location.hash);
    if (r.kind !== 'world' || r.reader !== 'standard' || r.worldId !== worldId) return;
    screen(
      h('header', { class: 'top' }, brandLink()),
      h('main', { class: 'closed' }, h('p', {}, 'The small worlds could not be opened. Check your connection, or reload the page.'), h('button', { class: 'way', type: 'button', onclick: () => route() }, 'Try again')),
    );
    return;
  }
  if (openingStandard === worldId) openingStandard = null;
  const r = parseRoute(location.hash);
  if (r.kind !== 'world' || r.reader !== 'standard' || r.worldId !== worldId) return;
  if (!opened) return closedDoor('standard');
  const g = buildGraph(opened.bodies);
  loaded = {
    reader: 'standard',
    worldId,
    name: opened.world.name,
    sub: `a small world from the standard's ${opened.world.profile} profile, release ${opened.serial}`,
    graph: g,
    degree: degrees(g),
    time: opened.time,
    reading: null,
    notes: leftOutNotes(g),
    draughts: new Map(),
    bodies: opened.bodies,
    source: 'standard',
    members: opened.members,
    messages: null,
  };
  filter = { type: null, q: '' };
  route();
}

/** The time view: the strip, the moment and the dated list, read from the web's own kept elements. */
function timePage(l: Loaded, at: number | null): void {
  const reading = (l.reading ??= readTime(l.graph.nodes));
  const switcher = switcherFor(l, 'time');
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
  // A Character's draught is keel's to serve: a world on OnlyWorlds offers it, a file never.
  const draughtWay = el.type === 'character' && (l.reader === 'public' || l.reader === 'me') ? h('a', { class: 'way dway', href: worldHash(l.reader, l.worldId, id, 'draught') }, 'Its draught at a moment') : null;
  // A message shown here is in exactly one conversation.
  const threadWay = isMessage(el) && threadOfId(messagesOf(l), id) ? h('a', { class: 'way dway', href: worldHash(l.reader, l.worldId, null, 'messages', null, id) }, 'Read it in its conversation') : null;
  screen(
    top(l.name, l.sub),
    h('nav', { class: 'crumbs' }, h('a', { href: worldHash(l.reader, l.worldId) }, `← ${l.name}`), draughtWay, threadWay),
    // A file's pictures are never fetched: what a file names, the file's author chose.
    h('main', { class: 'element' }, elementView({ graph: l.graph, degree: l.degree, element: el, hrefOf: (i) => worldHash(l.reader, l.worldId, i), pictures: l.reader === 'public' || l.reader === 'me' })),
  );
  document.title = `${el.name || 'Untitled'} · Little Lens`;
}

/** Which Character's draught a view stands for: the reader, the world and the id. */
function draughtKey(reader: string, worldId: string | null, id: string): string {
  return `${reader}:${worldId ?? ''}:${id}`;
}

function cannotReadDraught(l: Loaded, id: string): void {
  screen(
    top(l.name, l.sub),
    h('main', { class: 'closed' }, h('h1', {}, "You cannot read this Character's draught"), h('p', {}, l.reader === 'standard' ? 'A small world from the standard has no draughts: OnlyWorlds reads a draught, and these worlds live only in this page.' : 'A draught is read for a Character this world shows you. It may be hidden, or the address may be wrong.'), h('a', { class: 'way', href: worldHash(l.reader, l.worldId, id) }, 'Back to the element')),
  );
}

/** An element's draught at a moment: keel's packet, read keyless or on the session's token. */
function draughtPage(l: Loaded, id: string, at: number | null): void {
  const el = l.graph.byId.get(id);
  if (!el || el.type !== 'character' || (l.reader !== 'public' && l.reader !== 'me') || !l.worldId) return cannotReadDraught(l, id);
  const worldId = l.worldId;
  const s = l.reader === 'me' ? session : null;
  // Kept by Character and moment: a world holds many Characters' draughts.
  const keyOf = (asOf: number) => `${id}:${asOf}`;
  const host = h('main', { class: 'draught', 'aria-label': 'Draught' });
  screen(top(l.name, l.sub), h('nav', { class: 'crumbs' }, h('a', { href: worldHash(l.reader, worldId, id) }, `← ${el.name || 'Untitled'}`)), host);
  document.title = `${el.name || 'Untitled'}, its draught · Little Lens`;
  const reading = (l.reading ??= readTime(l.graph.nodes));
  draughtView = {
    key: draughtKey(l.reader, worldId, id),
    handle: mountDraught(host, {
      name: el.name ?? '',
      time: l.time,
      calendar: reading.calendar,
      at,
      signedIn: l.reader === 'me',
      cached: (asOf) => {
        // A hit moves to the newest slot, so what is used stays longest.
        const hit = l.draughts.get(keyOf(asOf));
        if (hit) {
          l.draughts.delete(keyOf(asOf));
          l.draughts.set(keyOf(asOf), hit);
        }
        return hit;
      },
      read: async (asOf, signal) => {
        // A signed-in read stands on the sign-in it began with, and is kept only while both stand.
        if (l.reader === 'me' && (!s || session !== s)) throw new ReadError({ kind: 'ended' });
        const d = await readDraught(worldId, id, asOf, fetch, signal, s?.token ?? null);
        if (loaded === l && (l.reader !== 'me' || session === s)) {
          l.draughts.set(keyOf(asOf), d);
          while (l.draughts.size > DRAUGHTS_KEPT) l.draughts.delete(l.draughts.keys().next().value!);
        }
        return d;
      },
      hrefOf: (i) => (l.graph.byId.has(i) ? worldHash(l.reader, worldId, i) : null),
      hashFor: (a) => worldHash(l.reader, worldId, id, 'draught', a),
      onFailure: (err) => {
        if (err instanceof ReadError && err.failure.kind === 'ended') {
          endSession(ENDED_LINE);
          return null;
        }
        if (err instanceof ReadError && err.failure.kind === 'closed') {
          cannotReadDraught(l, id);
          return null;
        }
        if (err instanceof ReadError && err.failure.kind === 'slow-down') {
          const sec = err.failure.retryAfter;
          return `OnlyWorlds is asking Little Lens to slow down. Try again in ${sec ? `${sec} seconds` : 'a minute'}.`;
        }
        if (err instanceof ReadError && err.failure.kind === 'server') return 'OnlyWorlds answered with an error. Try again in a moment.';
        return 'Little Lens could not reach OnlyWorlds. Check your connection and try again.';
      },
    }),
  };
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
  if (r.kind === 'closed') return closedDoor(location.hash.startsWith('#/me/') ? 'me' : location.hash.startsWith('#/std/') ? 'standard' : 'public');
  if (r.kind === 'standard-list') return standardList();
  if (r.kind === 'file') {
    if (!loaded || loaded.reader !== 'file') return waysIn('Open the file again: Little Lens keeps nothing once the page closes.');
    if (r.elementId) return elementPage(loaded, r.elementId);
    if (r.view === 'messages') return messagesPage(loaded, r.thread);
    return r.view === 'time' ? timePage(loaded, r.at) : worldPage(loaded, r.view === 'list' ? 'list' : 'web');
  }
  if (r.reader === 'standard') {
    if (loaded?.reader !== 'standard' || loaded.worldId !== r.worldId) {
      void openStandardWorld(r.worldId);
      return;
    }
  }
  // A signed-in address never falls back to a public read of the same world.
  if (r.reader === 'me' && !session) return waysIn(canSignInWithOnlyWorlds() ? 'Sign in to open this world.' : 'This address opens a world signed in, on little-lens.onlyworlds.com.');
  else if (r.reader !== 'standard' && (loaded?.reader !== r.reader || loaded.worldId !== r.worldId)) {
    void openWorld(r.reader, r.worldId);
    return;
  }
  if (!loaded) return;
  if (r.elementId && r.view === 'draught') draughtPage(loaded, r.elementId, r.at);
  else if (r.elementId) elementPage(loaded, r.elementId);
  else if (r.view === 'messages') messagesPage(loaded, r.thread);
  else if (r.view === 'time') timePage(loaded, r.at);
  else worldPage(loaded, r.view === 'list' ? 'list' : 'web');
}

window.addEventListener('hashchange', () => {
  // Back and Forward between moments of the time view on screen: redrawn in place, no scroll.
  const r = parseRoute(location.hash);
  if (timeView && loaded && !exchanging && (r.kind === 'world' || r.kind === 'file') && r.view === 'time' && !r.elementId) {
    const key = r.kind === 'file' ? 'file:' : `${r.reader}:${r.worldId}`;
    if (key === timeView.key && key === timeKey(loaded)) return timeView.handle.setAt(r.at);
  }
  // The same between moments of the draught on screen: the strip moves and the moment is read.
  if (draughtView && loaded && !exchanging && r.kind === 'world' && r.view === 'draught' && r.elementId && loaded.reader === r.reader && loaded.worldId === r.worldId) {
    if (draughtView.key === draughtKey(r.reader, r.worldId, r.elementId)) return draughtView.handle.setAt(r.at);
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
