/**
 * The time view: a strip of a world's dated elements, the world's now as a line, a moment held in
 * the address, and the dated elements listed in date order below. A change of moment redraws in
 * place: the strip keeps its focus and the page its scroll.
 */

import type { ElementType } from '@onlyworlds/sdk';
import { binColumns, columnCount, columnOf, datedUpTo, dateWordOf, momentOf, stepToDate, stepWords, tickWords, type Column, type Dated, type TimeReading, type WorldTime } from '../lens/time';
import { clear, h, inkOf, singularWord, svg, typeIcon } from './dom';

export interface TimeHandle {
  /** The address moved to another moment (Back, Forward, a link): redraw for it. */
  setAt(at: number | null): void;
  destroy(): void;
}

export interface TimeViewOptions {
  reading: TimeReading;
  time: WorldTime;
  at: number | null;
  hrefOf: (id: string) => string;
  /** The time view's address at a moment. */
  hashFor: (at: number | null) => string;
  /**
   * The strip alone (the draught's page): no list of dated elements and no count line, since that
   * page's counts are keel's; the range line is the caller's.
   */
  stripOnly?: { range: string };
  /** A moment the address settled on: a run's end, Back or Forward. */
  onSettle?: (at: number | null) => void;
}

const PAD = 28;
const COL = 8;
const HEIGHT = 112;
const BASE = 66;
const STACK = 5;
/** Rows built per frame. */
const BATCH = 120;

export function mountTime(host: HTMLElement, o: TimeViewOptions): TimeHandle {
  const { reading, time } = o;
  const words = (step: number) => stepWords(step, reading.calendar, time.unit);
  const dated = reading.dated;

  const only = o.stripOnly ?? null;
  host.append(h('p', { class: 'trange' }, only ? only.range : rangeLine(reading, words)));
  if (dated.length === 0) return { setAt() {}, destroy() {} };

  const lo = dated[0].date;
  const hi = dated[dated.length - 1].date;
  let at = o.at;

  const strip = h('div', {
    class: 'strip',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Moment',
  });
  // Said only while a stack draws a number above it (Seethe's T1: a bare "+4" says nothing).
  const stackNote = h('p', { class: 'tstack', hidden: true }, 'A number above a stack counts the dots it cannot show.');
  const said = h('p', { class: 'tmoment' });
  const list = h('ul', { class: 'tlist', 'aria-label': 'Dated elements, in date order' });
  host.append(strip, stackNote, said);
  if (!only) host.append(list);

  // The list is built a batch per frame, so a world of thousands never holds the page in one task;
  // each row is marked as it is made. A row says "after the moment" (the line above names it), so
  // a new moment touches only the rows it moves across.
  const rows: Array<{ d: Dated; li: HTMLElement; mark: HTMLElement; after: boolean }> = [];
  let frame = 0;
  function buildRows(): void {
    frame = 0;
    const moment = momentOf(at, time);
    const end = Math.min(dated.length, rows.length + BATCH);
    const batch = document.createDocumentFragment();
    for (let i = rows.length; i < end; i++) {
      const d = dated[i];
      const mark = h('span', { class: 'tafter' });
      const chip = h('a', { class: 'chip', href: o.hrefOf(d.el.id) }, typeIcon(d.el.type, 13), h('span', {}, d.el.name || 'Untitled'));
      chip.style.setProperty('--ink', inkOf(d.el.type));
      const li = h('li', { class: 'trow' }, chip, h('span', { class: 'tkind' }, singularWord(d.el.type as ElementType)), h('span', { class: 'twhen' }, mark, `${dateWordOf(d.el.type)} ${words(d.date)}`));
      const row = { d, li, mark, after: false };
      setAfter(row, moment !== null && d.date > moment);
      rows.push(row);
      batch.append(li);
    }
    list.append(batch);
    if (rows.length < dated.length) frame = requestAnimationFrame(buildRows);
    else if (pendingScroll) scrollList();
  }
  function setAfter(row: (typeof rows)[number], after: boolean): void {
    if (row.after === after) return;
    row.after = after;
    row.li.classList.toggle('after', after);
    row.mark.textContent = after ? 'after the moment · ' : '';
  }

  let width = 0;
  let cols = 1;
  let columns: Column[] = [];
  let byIndex = new Map<number, Column>();
  const span = () => Math.max(1, width - PAD * 2);
  // Every mark on the strip (a dot, the now, the moment, a tick) sits at its column's centre, by the
  // one rule in `columnOf`, so the count said for a moment is the count drawn under its line.
  const colAt = (step: number) => columnOf(step, lo, hi, cols);
  const xOf = (step: number) => PAD + colAt(step) * COL + COL / 2;
  const stepAtX = (x: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((x - PAD) / COL)));
    const here = byIndex.get(c);
    // A column with dots chooses its last date, so a dot pressed is fenced in, never after the moment.
    if (here) return here.items[here.items.length - 1].date;
    return hi === lo ? lo : Math.round(lo + ((c + 0.5) / cols) * (hi - lo));
  };
  const columnAt = (step: number) => (step < lo || step > hi ? null : (byIndex.get(colAt(step)) ?? null));

  function drawStrip(): void {
    width = strip.clientWidth;
    cols = columnCount(span(), COL);
    columns = binColumns(dated, span(), COL);
    byIndex = new Map(columns.map((c) => [c.index, c]));
    const moment = momentOf(at, time);
    const s = svg('svg', { width, height: HEIGHT, 'aria-hidden': 'true', class: 'tsvg' });
    s.append(svg('line', { x1: PAD, x2: PAD + cols * COL, y1: BASE + 10, y2: BASE + 10, class: 'taxis' }));
    const n = width < 500 ? 3 : 5;
    const ticks = hi === lo ? [lo] : [...new Set(Array.from({ length: n }, (_, i) => Math.round(lo + ((hi - lo) * i) / (n - 1))))];
    const spacing = hi === lo ? 0 : (hi - lo) / (n - 1);
    ticks.forEach((t, i) => {
      const x = xOf(t);
      s.append(svg('line', { x1: x, x2: x, y1: BASE + 10, y2: BASE + 16, class: 'ttick' }));
      // The end labels lean inward, so neither is cut at the strip's edge.
      const anchor = ticks.length === 1 ? 'middle' : i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle';
      const label = svg('text', { x: anchor === 'start' ? x - COL / 2 : anchor === 'end' ? x + COL / 2 : x, y: BASE + 32, class: 'tlabel', 'text-anchor': anchor });
      label.textContent = tickWords(t, spacing, reading.calendar);
      s.append(label);
    });
    stackNote.hidden = !columns.some((c) => c.items.length > STACK);
    for (const c of columns) {
      const cx = PAD + c.x + COL / 2;
      c.items.slice(0, STACK).forEach((d, k) => {
        const dot = svg('circle', { cx, cy: BASE - k * 9, r: 3.6, fill: inkOf(d.el.type), class: moment !== null && d.date > moment ? 'tdot tlater' : 'tdot' });
        s.append(dot);
      });
      if (c.items.length > STACK) {
        const more = svg('text', { x: cx, y: BASE - STACK * 9 - 2, class: 'tmore', 'text-anchor': 'middle' });
        more.textContent = `+${c.items.length - STACK}`;
        s.append(more);
      }
    }
    if (time.now !== null) {
      const x = xOf(time.now);
      s.append(svg('line', { x1: x, x2: x, y1: 10, y2: BASE + 12, class: 'tnow' }));
      const t = svg('text', { x, y: 8, class: 'tnowlabel', 'text-anchor': x > width - 60 ? 'end' : x < 60 ? 'start' : 'middle' });
      t.textContent = 'now';
      s.append(t);
    }
    if (at !== null) {
      const x = xOf(at);
      s.append(svg('line', { x1: x, x2: x, y1: 14, y2: BASE + 14, class: 'tat' }));
    }
    const old = strip.querySelector('svg');
    if (old) old.replaceWith(s);
    else strip.append(s);
  }

  function edgeWords(step: number): string {
    return step < lo ? ', before the first date' : step > hi ? ', after the last date' : '';
  }

  function sayMoment(): void {
    const moment = momentOf(at, time);
    const min = Math.min(lo, at ?? lo, time.now ?? lo);
    const max = Math.max(hi, at ?? hi, time.now ?? hi);
    strip.setAttribute('aria-valuemin', String(min));
    strip.setAttribute('aria-valuemax', String(max));
    const now = moment ?? lo;
    strip.setAttribute('aria-valuenow', String(now));
    const here = columnAt(now);
    const count = here && here.items.length > 1 && now >= lo && now <= hi ? `, ${here.items.length} ${only ? 'rows' : 'elements'} here` : '';
    strip.setAttribute('aria-valuetext', `${words(now)}${count}`);
    clear(said);
    if (only) {
      // The strip alone names only the moment it stands on: the counts are the caller's, read from keel.
      said.append(moment === null ? 'Choose a moment on the strip.' : `The moment: ${words(moment)}${edgeWords(moment)}${at === null ? ", the world's now" : ''}.`);
      return;
    }
    const nowLine = time.now !== null ? `The world's now is ${words(time.now)}${edgeWords(time.now)}.` : null;
    if (moment === null) {
      said.append('This world has no now, so nothing is fenced: choose a moment on the strip.');
      return;
    }
    const n = datedUpTo(dated, moment);
    const lead = at !== null ? `Dated up to ${words(moment)}${edgeWords(moment)}: ` : `Dated up to the world's now, ${words(moment)}${edgeWords(moment)}: `;
    said.append(lead, h('b', {}, `${n} of ${dated.length}`), '.');
    if (at !== null && nowLine) said.append(' ', nowLine);
  }

  /** The rows the moment moved across, found by the order: the list is sorted by date. */
  function markRows(): void {
    const moment = momentOf(at, time);
    const cut = moment === null ? rows.length : datedUpTo(dated, moment);
    for (let i = 0; i < rows.length; i++) setAfter(rows[i], i >= cut);
    pendingScroll = at !== null && moment !== null;
    scrollList();
  }

  // A chosen moment scrolls the list inside itself to where it falls; the page never moves. The
  // world's now alone leaves the list at its start. A row not built yet scrolls when it is.
  let pendingScroll = false;
  function scrollList(): void {
    if (!pendingScroll) return;
    const cut = datedUpTo(dated, momentOf(at, time)!);
    if (cut >= rows.length && rows.length < dated.length) return;
    pendingScroll = false;
    const first = rows[cut]?.li;
    list.scrollTop = first ? Math.max(0, first.offsetTop - list.offsetTop - list.clientHeight / 2) : list.scrollHeight;
  }

  /** The strip and its words; the list follows when a run ends (a drag would rewrite it every move). */
  function render(list = true): void {
    drawStrip();
    sayMoment();
    if (list) markRows();
  }

  // One history entry per run (a drag, or keys held): the address moves by replace while it runs,
  // and the run's last moment is pushed once when it ends.
  let runStart: string | null = null;
  function moveTo(next: number): void {
    if (runStart === null) runStart = location.hash;
    if (next === at) return;
    at = next;
    history.replaceState(history.state, '', o.hashFor(at));
    render(false);
  }
  let live = true;
  function endRun(): void {
    if (runStart === null || !live || !strip.isConnected) return;
    if (!only) markRows();
    const end = location.hash;
    const moved = end !== runStart;
    if (moved) {
      history.replaceState(history.state, '', runStart);
      history.pushState(null, '', end);
    }
    runStart = null;
    if (moved) o.onSettle?.(at);
  }

  const xIn = (e: PointerEvent) => e.clientX - strip.getBoundingClientRect().left;
  let dragging = false;
  strip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    strip.setPointerCapture(e.pointerId);
    strip.focus({ preventScroll: true });
    moveTo(stepAtX(xIn(e)));
  });
  strip.addEventListener('pointermove', (e) => {
    if (dragging) moveTo(stepAtX(xIn(e)));
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    endRun();
  };
  strip.addEventListener('pointerup', release);
  strip.addEventListener('pointercancel', release);
  strip.addEventListener('lostpointercapture', release);

  const KEYS = new Set(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End']);
  strip.addEventListener('keydown', (e) => {
    // Alt+Arrow is the browser's Back and Forward; a modified key is never the slider's.
    if (!KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const moment = momentOf(at, time);
    let next: number;
    if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hi;
    else if (moment === null) next = lo;
    else next = stepToDate(dated, moment, e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1);
    e.preventDefault();
    moveTo(next);
  });
  strip.addEventListener('keyup', (e) => {
    if (KEYS.has(e.key) && !dragging) endRun();
  });
  strip.addEventListener('blur', () => {
    if (!dragging) endRun();
  });

  const resize = new ResizeObserver(() => {
    if (strip.clientWidth === width) return;
    drawStrip();
    sayMoment();
  });
  resize.observe(strip);
  render(!only);
  if (!only) buildRows();

  return {
    setAt(next) {
      runStart = null;
      if (next === at) return;
      at = next;
      render(!only);
    },
    destroy() {
      // A run cut short by the view going (Back mid-drag) ends with nothing: the address is
      // already elsewhere, and the strip's blur or lost capture must not write it back.
      live = false;
      runStart = null;
      dragging = false;
      resize.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

function rangeLine(r: TimeReading, words: (n: number) => string): string {
  const parts: string[] = [];
  if (r.dated.length === 0) parts.push('Nothing in this world is dated.');
  else {
    const lo = r.dated[0].date;
    const hi = r.dated[r.dated.length - 1].date;
    const span = lo === hi ? `all at ${words(lo)}` : `${words(lo)} to ${words(hi)}`;
    parts.push(`Each dot is one dated element, coloured by its type: ${r.dated.length} of the ${r.whole} elements are dated, ${span}.`);
  }
  if (r.undatedOfDatedKind > 0) parts.push(`${r.undatedOfDatedKind} more of a dated type ${r.undatedOfDatedKind === 1 ? 'carries' : 'carry'} no date.`);
  if (r.stubs > 0) parts.push(`${r.stubs} known only by name, ${r.stubs === 1 ? 'its date' : 'their dates'} unknown.`);
  return parts.join(' ');
}
