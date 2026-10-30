/**
 * The draught at a date: what the record holds around one Character, dated up to a moment you
 * choose on a strip of the draught's own dated rows. The list kept is keel's packet at the moment;
 * "dated after" is computed from a second read at the top of keel's range, and says so. Every
 * caption names the packet it captions, never the slider. Copy is the SDK's `draughtText` of the
 * moment's packet on screen.
 */

import { dateOf, draughtText, simpleCaseFold, type OwDraught, type WorldCalendar } from '@onlyworlds/sdk';
import { WHOLE, cutCount, datedAfter, type Draught, type DraughtElement, type Row, type Section } from '../lens/draught';
import { isElementType, type Element } from '../lens/graph';
import { dateWordOf, stepWords, type Dated, type TimeReading, type WorldTime } from '../lens/time';
import { clear, h, inkOf, singularWord, typeIcon } from './dom';
import { mountTime, type TimeHandle } from './time-view';

export interface DraughtHandle {
  /** The address moved to another moment (Back, Forward): redraw and read for it. */
  setAt(at: number | null): void;
  destroy(): void;
}

export interface DraughtViewOptions {
  /** Her name as the world web holds it, until her own packet names her. */
  name: string;
  time: WorldTime;
  calendar: WorldCalendar | null;
  at: number | null;
  /** Signed in: a packet with no roster was read as the public, and says so. */
  signedIn: boolean;
  /** A packet already read for this Character at `asOf`, or none. */
  cached: (asOf: number) => Draught | undefined;
  /** One read at `asOf`, kept by the caller once it lands. */
  read: (asOf: number, signal: AbortSignal) => Promise<Draught>;
  /** An element's page here, or null when the world web does not hold it. */
  hrefOf: (id: string) => string | null;
  hashFor: (at: number | null) => string;
  /** A read failed: the caller draws what it means (a closed door, the sign-in ended), or returns a line to say here. */
  onFailure: (err: unknown) => string | null;
}

const SECTION_WORDS: Record<Section, [string, string]> = {
  role: ['Role', 'the titles and roles it holds'],
  work: ['Work', 'its open work'],
  style: ['Style', 'how it works'],
  events: ['Events', 'events that name it'],
  knowledge: ['Knowledge', 'narratives it knows'],
  names: ['Names', 'other things that name it'],
  sheet: ['The sheet', 'what its own fields link to'],
  recent: ['Recent', 'what changed around it'],
  roster: ['Members', 'the seats in the world'],
};

const COPIED_MS = 2000;
const SETTLE_MS = 350;
const rowsWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

export function mountDraught(host: HTMLElement, o: DraughtViewOptions): DraughtHandle {
  const words = (step: number) => stepWords(step, o.calendar, o.time.unit);
  let at = o.at;
  let live = true;
  /** The moment's packet on screen: every caption reads its own `as_of`. */
  let drawn: Draught | null = null;
  /** The whole read: the strip's dots and the "dated after" rows. */
  let whole: Draught | null = null;
  /** Two slots: a new moment aborts the moment's read, only leaving aborts the whole one. */
  let momentRead: AbortController | null = null;
  let wholeRead: AbortController | null = null;
  let wholeFailed: string | null = null;
  let momentFailed: string | null = null;
  let way: 'kept' | 'after' = 'kept';
  let strip: TimeHandle | null = null;
  let copiedTimer = 0;
  let settleTimer = 0;
  /** The packet the copy state (Copied, the refused box) belongs to: kept across redraws of it. */
  let copyFor: Draught | null = null;

  const title = h('h1', { class: 'dname' }, typeIcon('character', 22), h('span', {}, o.name || 'this Character'));
  const lead = h('p', { class: 'dlead' }, 'A draught is what the record holds around one element, up to a moment you choose.');
  const status = h('p', { class: 'said', role: 'status', tabindex: '-1' });
  // Its room held while the whole read is out, so the strip landing late pushes nothing down.
  const stripHost = h('section', { class: 'time dstrip pending', 'aria-label': 'Moment' });
  const ways = h('div', { class: 'dways', role: 'group', 'aria-label': 'Ways to see' });
  // A new moment's packet is announced by its caption.
  const caption = h('h2', { class: 'dcap', 'aria-live': 'polite' });
  const reader = h('p', { class: 'dreader' });
  const copyBtn = h('button', { class: 'way dcopy', type: 'button' }, 'Copy as plain text');
  const copied = h('p', { class: 'dcopied', role: 'status' });
  const copyBox = h('textarea', { class: 'dbox', readonly: true, rows: 12, 'aria-label': 'The draught as plain text', hidden: true });
  const body = h('div', { class: 'dbody' });
  const panel = h('section', { class: 'panel dpanel', 'aria-label': 'The draught' }, h('div', { class: 'dhead' }, caption, copyBtn), reader, copied, copyBox, body);
  host.append(title, lead, status, stripHost, ways, panel);
  panel.hidden = true;
  copyBtn.addEventListener('click', () => void copy());

  /** The moment asked of keel: the address's, else the world's now, else the top (nothing fenced). */
  const asked = () => at ?? o.time.now ?? WHOLE;
  const isWhole = (d: Draught) => d.asOf === WHOLE;

  // -- Reading ----------------------------------------------------------------------------------

  async function readMoment(): Promise<void> {
    const m = asked();
    momentRead?.abort();
    momentRead = null;
    momentFailed = null;
    const hit = o.cached(m);
    if (hit) {
      drawn = hit;
      if (m === WHOLE) setWhole(hit);
      return redraw();
    }
    // The top is on its way as the whole read: it is drawn when that lands, never read twice.
    if (m === WHOLE && wholeRead) return redraw();
    const ctl = new AbortController();
    momentRead = ctl;
    redraw();
    try {
      const d = await o.read(m, ctl.signal);
      if (!live || momentRead !== ctl) return;
      momentRead = null;
      drawn = d;
      // At the top the moment's read is the whole one: one packet serves both.
      if (m === WHOLE) setWhole(d);
    } catch (err) {
      if (!live || momentRead !== ctl) return;
      momentRead = null;
      momentFailed = o.onFailure(err);
      if (!live) return;
    }
    redraw();
  }

  /** The whole read, from whichever read brought it: a failure said before it is over. */
  function setWhole(w: Draught): void {
    if (!whole) whole = w;
    wholeFailed = null;
  }

  async function readWhole(): Promise<void> {
    if (whole || wholeRead) return;
    const hit = o.cached(WHOLE);
    if (hit) {
      setWhole(hit);
      return redraw();
    }
    // The moment at the top reads it already.
    if (asked() === WHOLE) return;
    const ctl = new AbortController();
    wholeRead = ctl;
    wholeFailed = null;
    try {
      const w = await o.read(WHOLE, ctl.signal);
      if (!live || wholeRead !== ctl) return;
      setWhole(w);
      // The address moved to the top while this was out: this packet is that moment's too.
      if (asked() === WHOLE) drawn = w;
    } catch (err) {
      if (!live || wholeRead !== ctl) return;
      wholeFailed = o.onFailure(err);
      if (!live) return;
    } finally {
      if (wholeRead === ctl) wholeRead = null;
    }
    redraw();
  }

  function retry(): void {
    if (momentFailed !== null) void readMoment();
    wholeFailed = null;
    void readWhole();
    redraw();
  }

  // -- The strip: the whole read's own dated rows ---------------------------------------------

  function ensureStrip(): void {
    if (strip || !whole || !live) return;
    strip = mountTime(stripHost, {
      reading: readingOf(whole, o.calendar),
      time: o.time,
      at,
      hrefOf: () => '#',
      hashFor: o.hashFor,
      stripOnly: { range: stripLine(whole) },
      onSettle: (next) => {
        at = next;
        // Key presses settle one by one: the read waits for a pause, so five presses are one read.
        clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => void readMoment(), SETTLE_MS);
        redraw();
      },
    });
    stripHost.classList.remove('pending');
  }

  // -- Drawing ------------------------------------------------------------------------------------

  function redraw(): void {
    if (!live) return;
    ensureStrip();
    stripHost.classList.toggle('pending', !whole && wholeFailed === null);
    drawStatus();
    drawWayBack();
    if (!drawn) return;
    panel.hidden = false;
    const self = drawn.self;
    if (self?.name) title.lastElementChild!.textContent = self.name;
    const ownDate = self ? rowDate(self) : null;
    lead.textContent = `A draught is what the record holds around one element, up to a moment you choose${ownDate ? ` (${ownDate})` : ''}.`;
    // "Dated after" only when both reads are whole: a budget cut ranks rows by the moment too.
    const comparable = whole !== null && cutCount(drawn) === 0 && cutCount(whole) === 0;
    const after = !isWhole(drawn) && comparable ? datedAfter(drawn, whole!) : null;
    if (way === 'after' && (isWhole(drawn) || !comparable)) way = 'kept';
    const cut = cutCount(drawn);
    const cutWords = cut > 0 ? `, and ${cut} left out by keel's budget` : '';
    caption.textContent = isWhole(drawn)
      ? `Everything the record holds, nothing dated is fenced: ${rowsWord(drawn.rows.length)}${cutWords}`
      : way === 'after'
        ? `Dated after ${words(drawn.asOf!)}: ${rowsWord(after!.length)}`
        : `Dated up to ${words(drawn.asOf!)}: ${rowsWord(drawn.rows.length)}${cutWords}`;
    reader.textContent = o.signedIn && drawn.publicReader ? 'Read as the public: your account holds no seat in this world.' : '';
    drawWays(after, comparable);
    clear(body);
    if (drawn.selfHidden) body.append(h('p', { class: 'note' }, "Its own element is hidden from you; the draught holds what names it."));
    if (way === 'after') drawAfter(after!);
    else drawKept(drawn);
    syncCopy();
  }

  function drawStatus(): void {
    // Try again pressed: the focus stays in the line, on the new button or on the line itself.
    const hadFocus = status.contains(document.activeElement);
    clear(status);
    if (hadFocus) status.focus({ preventScroll: true });
    const line = momentFailed ?? wholeFailed;
    if (line !== null) {
      // The drawn packet stays with its own caption; the line says what failed, and Try again reads.
      const again = h('button', { class: 'linkish', type: 'button', onclick: retry }, 'Try again');
      status.append(line, ' ', again);
      if (hadFocus) again.focus({ preventScroll: true });
    } else if (momentRead) {
      const m = asked();
      status.append(m === WHOLE ? 'Reading the draught…' : `Reading up to ${words(m)}…`);
    } else if (wholeRead && drawn) {
      status.append('Reading what comes after…');
    }
  }

  /** A moment in the address can always go back to the world's now, which the strip's End may not reach. */
  let wayBack: HTMLElement | null = null;
  function drawWayBack(): void {
    const want = at !== null && o.time.now !== null;
    if (!want) {
      wayBack?.remove();
      wayBack = null;
      return;
    }
    if (!wayBack) {
      wayBack = h('a', { class: 'dnow', href: o.hashFor(null) }, "Back to the world's now");
      stripHost.after(wayBack);
    }
  }

  function drawWays(after: Row[] | null, comparable: boolean): void {
    // A way pressed keeps the focus through the redraw it causes.
    const focused = [...ways.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement);
    clear(ways);
    if (!drawn || isWhole(drawn)) return;
    const kept = h('button', { type: 'button', class: `pill${way === 'kept' ? ' on' : ''}`, 'aria-pressed': String(way === 'kept'), onclick: () => setWay('kept') }, `The list kept · ${drawn.rows.length}`);
    const label = `Dated after ${words(drawn.asOf!)}`;
    const count = after !== null ? String(after.length) : wholeRead ? '…' : whole === null ? 'not read' : 'not known';
    const later = h('button', { type: 'button', class: `pill${way === 'after' ? ' on' : ''}`, 'aria-pressed': String(way === 'after'), onclick: () => setWay('after'), disabled: after === null || after.length === 0 }, `${label} · ${count}`);
    ways.append(kept, later);
    const again = [kept, later][focused];
    if (again && !again.disabled) again.focus({ preventScroll: true });
    if (whole !== null && !comparable) ways.append(h('p', { class: 'note dcutnote' }, "keel's budget left rows out of a read, so what is dated after this moment cannot be told from what the budget dropped."));
    else if (after !== null && after.length === 0) ways.append(h('p', { class: 'note dcutnote' }, `Nothing in this draught is dated after ${words(drawn.asOf!)}.`));
  }

  function setWay(w: 'kept' | 'after'): void {
    if (way === w) return;
    way = w;
    redraw();
  }

  function drawKept(d: Draught): void {
    const bySection = new Map<Section, Row[]>();
    for (const r of d.rows) {
      const list = bySection.get(r.section);
      if (list) list.push(r);
      else bySection.set(r.section, [r]);
    }
    for (const [section, rows] of bySection) {
      const [name, hint] = SECTION_WORDS[section];
      const left = d.cut[section] ?? 0;
      body.append(h('h3', { class: 'dsec' }, name, h('span', { class: 'dhint' }, ` ${hint} · ${rows.length} here${left ? `, ${left} left out by keel's budget` : ''}`)), rowList(rows));
    }
    const roster = d.packet.roster;
    if (Array.isArray(roster) && roster.length > 0) body.append(h('p', { class: 'note' }, `The world's ${roster.length} ${roster.length === 1 ? 'seat is' : 'seats are'} in the copied text, under Members.`));
    if (d.rows.length === 0) body.append(h('p', { class: 'empty' }, 'Nothing dated up to this moment names it, and nothing undated does.'));
    if (d.empty.length > 0) body.append(h('p', { class: 'note' }, `Nothing in: ${d.empty.map((s) => SECTION_WORDS[s][0].toLowerCase()).join(', ')}.`));
  }

  function drawAfter(after: Row[]): void {
    body.append(h('p', { class: 'note dfound' }, 'Not listed in the draught at this moment, found by a second read of the whole draught.'));
    body.append(rowList(after));
  }

  function rowList(rows: Row[]): HTMLElement {
    const ul = h('ul', { class: 'drows' });
    for (const r of rows) {
      const el = r.element;
      const type = isElementType(el.type) ? el.type : null;
      const href = o.hrefOf(el.id);
      const nameNode = href ? h('a', { class: 'dn', href }, el.name || 'Untitled') : h('span', { class: 'dn' }, el.name || 'Untitled');
      const date = r.date !== null ? rowDate(el) : null;
      const li = h(
        'li',
        { class: 'drow' },
        type ? typeIcon(type, 15) : null,
        nameNode,
        h('span', { class: 'dkind' }, type ? singularWord(type) : el.type),
        r.grade === 'known_of' ? h('span', { class: 'dtag' }, 'known of') : null,
        r.dated === false ? h('span', { class: 'dtag dund' }, 'undated') : null,
        h('span', { class: 'dvia' }, [r.via.length ? `via ${r.via.join(', ')}` : '', date ?? ''].filter(Boolean).join(' · ')),
      );
      if (type) li.style.setProperty('--ink', inkOf(type));
      ul.append(li);
    }
    return ul;
  }

  /** Its date on the body as served, by the lens profile's one table (a stub is served none). */
  function rowDate(el: DraughtElement): string | null {
    const d = dateOf(el as Parameters<typeof dateOf>[0]);
    return d === null ? null : `${dateWordOf(el.type)} ${words(d)}`;
  }

  // -- Copy: always the moment's packet ---------------------------------------------------------

  function textOf(d: Draught): string | null {
    try {
      return draughtText(d.packet as unknown as OwDraught);
    } catch {
      return null;
    }
  }

  function syncCopy(): void {
    // A redraw of the same packet (a way pressed, the whole read landing) keeps Copied and the
    // refused box; only another packet resets them.
    if (drawn === copyFor && (copyBtn.textContent !== 'Copy as plain text' || !copyBox.hidden)) return;
    copyFor = drawn;
    copyBox.hidden = true;
    copyBox.value = '';
    clearTimeout(copiedTimer);
    copyBtn.textContent = 'Copy as plain text';
    copied.textContent = '';
    const ok = drawn ? textOf(drawn) !== null : false;
    copyBtn.hidden = !ok;
    if (drawn && !ok) copied.textContent = 'This draught cannot be put into plain text here.';
    else if (drawn && way === 'after') copied.textContent = `Copy gives the draught at ${words(drawn.asOf!)}; the rows dated after are not in it.`;
  }

  async function copy(): Promise<void> {
    const d = drawn;
    if (!d) return;
    const text = textOf(d);
    if (text === null) return;
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    const what = `${d.self?.name || o.name || 'this Character'}, ${isWhole(d) ? 'everything the record holds' : `dated up to ${words(d.asOf!)}`}, ${lines} lines`;
    try {
      await navigator.clipboard.writeText(text);
      if (!live) return;
      // The moment moved while the clipboard answered: say what it holds, and claim nothing of the new one.
      if (drawn !== d) {
        copied.textContent = `On your clipboard: ${what}.`;
        return;
      }
      copyBox.hidden = true;
      copyBtn.textContent = 'Copied';
      copied.textContent = `On your clipboard: ${what}.`;
      clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => (copyBtn.textContent = 'Copy as plain text'), COPIED_MS);
    } catch {
      if (!live || drawn !== d) return;
      // The browser refused the clipboard: the same text, selected, for the person's own copy.
      copyBox.value = text;
      copyBox.hidden = false;
      copyBtn.textContent = 'Select and copy';
      copied.textContent = `The browser did not allow copying. The text below is selected: press your copy keys. It is ${what}.`;
      copyBox.focus();
      copyBox.select();
    }
  }

  void readMoment();
  void readWhole();

  return {
    setAt(next) {
      if (next === at) return;
      at = next;
      clearTimeout(settleTimer);
      strip?.setAt(next);
      void readMoment();
      // A whole read lost with an earlier moment (a moment at the top that failed) is read again.
      void readWhole();
    },
    destroy() {
      live = false;
      momentRead?.abort();
      wholeRead?.abort();
      momentRead = wholeRead = null;
      clearTimeout(copiedTimer);
      clearTimeout(settleTimer);
      strip?.destroy();
    },
  };
}

/** The strip's reading: the whole read's rows with a date on their served body. */
export function readingOf(whole: Draught, calendar: WorldCalendar | null): TimeReading {
  const dated: Dated[] = [];
  let stubs = 0;
  let undatedOfDatedKind = 0;
  for (const r of whole.rows) {
    if (r.grade === 'known_of') stubs++;
    else if (r.date !== null) dated.push({ el: r.element as unknown as Element, date: r.date });
    else if (r.dated === false) undatedOfDatedKind++;
  }
  const folded = new Map(dated.map((d) => [d, simpleCaseFold(d.el.name ?? '')]));
  const by = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  dated.sort((a, b) => a.date - b.date || by(folded.get(a)!, folded.get(b)!) || by(a.el.id, b.el.id));
  return { dated, whole: whole.rows.length, undatedOfDatedKind, stubs, calendar };
}

/** The line over the strip: what a dot is, and what has none. */
export function stripLine(whole: Draught): string {
  const r = readingOf(whole, null);
  if (r.dated.length === 0) return "Nothing in this draught carries a date you are shown, so it is read at the world's now, or at a moment in the address.";
  const parts = [`Each dot is a dated row of the whole draught: ${r.dated.length} of ${r.whole}.`];
  if (r.stubs > 0) parts.push(`${r.stubs} known of, ${r.stubs === 1 ? 'its date' : 'their dates'} not shown to you.`);
  const undated = r.whole - r.dated.length - r.stubs;
  if (undated > 0) parts.push(`${undated} with no date.`);
  parts.push('Drag the moment, or use the arrow keys.');
  return parts.join(' ');
}
