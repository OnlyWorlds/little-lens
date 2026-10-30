/**
 * A world's messages, read by the message profile and only by it: every line (from, to, read,
 * edited, the thread, the order) is the SDK's answer. Built from every body the world read, never
 * from the graph's kept set, which leaves out the proposed and the room lines a message view
 * shows. A hidden message is shown nowhere: it is counted, never named.
 */

import { editedBy, handsOnAsProposed, hasUnseenRecipients, isMessage, isNote, isToEveryone, proposedMarkOf, readMarkOf, recipientsOf, senderStatus, simpleCaseFold, threadOf, type OwMessageMember, type OwSenderStatus } from '@onlyworlds/sdk';
import { isHidden, isRoomish, type Element } from './graph';

/** Where the bodies came from decides what can be checked: hands, marks, "everyone". */
export type Source = 'file' | 'standard' | 'public' | 'me';

export interface MessageReading {
  /** Shown messages, settled and proposed, in the order read, each id once. */
  messages: Element[];
  /** Of those, the proposed: shown apart, never counted with the settled. */
  proposed: number;
  /** Messages left out as hidden: a count, never a name. */
  hidden: number;
  /** Shown Notes: never listed, but a chain walks through them (the profile's thread rule). */
  notes: Element[];
  /** Read relations a mark may come from: neither hidden nor proposed. */
  marks: Element[];
  members: readonly OwMessageMember[] | null;
  keyless: boolean;
  /** Whether a read mark can count here at all. */
  marksCount: boolean;
  /** The reader is served every read mark (a file, a small world, a signed-in owner or co-builder), so a "not yet" can be said. */
  everyMark: boolean;
  /** With a members list, the Characters some row plays: only their marks can ever count. */
  played: Set<string> | null;
  /** With a members list, some message claims a sender and was written by a hand the list shows playing no Character, so it can only claim. */
  unplayedHand: boolean;
  /** Each Character's read mark as the SDK reads it, found once per reading. */
  markOf: Map<string, Element | null>;
  /** A Read mark was left out (hidden or proposed): "not yet" is said of no one, so the silence names nobody. */
  marksLeftOut: boolean;
  /** Shown Characters' names (room cards included, hidden and proposed never), stripped. */
  names: Map<string, string>;
  /** One row per conversation, newest activity first. */
  threads: Thread[];
  /** Messages whose `created_at` the SDK reads as a time. */
  readable: Set<string>;
}

export interface Thread {
  rootId: string;
  /** The thread in the SDK's order. */
  messages: Element[];
  /** The root answers an id that is in no conversation here. */
  answersOutside: boolean;
  /** The newest message whose time the SDK can read, or null. */
  newest: Element | null;
}

const READ = simpleCaseFold('Read');

export function isReadRelation(el: Element): boolean {
  return el.type === 'relation' && typeof el.supertype === 'string' && simpleCaseFold(el.supertype.trim()) === READ;
}

/** A body carries the hands the profile checks (`created_by` or `changed_by`), as a wire body does. */
function carriesHands(el: Element): boolean {
  return 'created_by' in el || 'changed_by' in el;
}

/** Proposed as this view shows it: any mark present, a doubt included, as the web leaves it out. */
export function isProposedMessage(m: Element): boolean {
  return handsOnAsProposed(m);
}

/** A proposed mark that has lapsed (review rule 2: shown as lapsed, never dropped). */
export function isLapsed(m: Element): boolean {
  return proposedMarkOf(m)?.lapsed === true;
}

export function isRoomLine(m: Element): boolean {
  return isRoomish(m);
}

/** Whether any body is a message, shown or hidden: a count's worth of work, for the view's way in. */
export function holdsMessages(bodies: Iterable<Element>): boolean {
  for (const el of bodies) if (el && isMessage(el)) return true;
  return false;
}

/**
 * The SDK's order of the messages by `created_at`, read through `threadOf` itself, so the instant
 * and what counts as readable are the SDK's, never a parse of the app's own. Every message is
 * hung, as a proxy with a prefixed id, on one root; ties keep id order; a marker with no time,
 * placed first among the proxies, is the first unreadable, so whatever sorts before it is readable.
 */
function sdkOrder(messages: Element[]): { rank: Map<string, number>; readable: Set<string> } {
  const ROOT = 'root';
  const END = 'end';
  const proxies = [...messages]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((m) => ({ id: `m${m.id}`, type: 'narrative', supertype: 'Message', parent_narrative: ROOT, created_at: m.created_at }));
  const all = [{ id: ROOT, type: 'narrative', supertype: 'Message', parent_narrative: null, created_at: null }, { id: END, type: 'narrative', supertype: 'Message', parent_narrative: ROOT, created_at: null }, ...proxies];
  const rank = new Map<string, number>();
  const readable = new Set<string>();
  let past = false;
  threadOf(all, ROOT).forEach((p, i) => {
    if (p.id === END) past = true;
    if (p.id === ROOT || p.id === END) return;
    const id = p.id.slice(1);
    rank.set(id, i);
    if (!past) readable.add(id);
  });
  return { rank, readable };
}

export function readMessages(bodies: Iterable<Element>, source: Source, members: readonly OwMessageMember[] | null, everyMark: boolean): MessageReading {
  const messages: Element[] = [];
  const notes: Element[] = [];
  const marks: Element[] = [];
  const names = new Map<string, string>();
  const seen = new Set<string>();
  let hidden = 0;
  let marksLeftOut = false;
  let hands = false;
  for (const el of bodies) {
    // One body per id, the first: the SDK's thread rule keeps the first too.
    if (!el || typeof el.id !== 'string' || seen.has(el.id)) continue;
    seen.add(el.id);
    if (isMessage(el)) {
      hands ||= carriesHands(el);
      if (isHidden(el)) hidden++;
      else messages.push(el);
    } else if (isNote(el)) {
      if (!isHidden(el)) notes.push(el);
    } else if (isReadRelation(el)) {
      hands ||= carriesHands(el);
      if (!isHidden(el) && !handsOnAsProposed(el)) marks.push(el);
      else marksLeftOut = true;
    } else if (el.type === 'character' && !isHidden(el) && !handsOnAsProposed(el)) {
      names.set(el.id, plainText(el.name).trim() || 'Untitled');
    }
  }
  const keyless = source === 'public';
  // Keyless: a mark's hands were left out, so none counts (the message profile, after serial 94).
  // Signed in, a mark counts only against a members list. A file or small world whose messages or
  // marks carry hands needs one too: without it no mark could ever be checked, so a "not yet"
  // could never be wrong, and none is said.
  const marksCount = keyless ? false : source === 'me' ? members !== null : members !== null || !hands;
  const order = sdkOrder(messages);
  const played = members === null ? null : new Set(members.map((m) => m.character).filter((c): c is string => typeof c === 'string'));
  // The SDK's own answer: a message that names a sender, written by a hand whose row plays no
  // Character the reader can see (a hidden one reads as unseen, never this).
  const unplayedHand = members !== null && messages.some((m) => 'created_by' in m && (({ status, claimed }) => status === 'unverifiable' && claimed !== null)(senderStatus(m, members)));
  return {
    messages,
    proposed: messages.filter(isProposedMessage).length,
    hidden,
    notes,
    marks,
    members,
    keyless,
    marksCount,
    everyMark,
    played,
    unplayedHand,
    markOf: new Map(),
    marksLeftOut,
    names,
    threads: threadsOf(messages, notes, order),
    readable: order.readable,
  };
}

/**
 * The conversations, in one pass. The list a chain walks is the messages and the shown Notes,
 * never another Narrative. Each message's root is found once, up its chain: the topmost message
 * the chain reaches, or, when the chain loops, the earliest message on the loop in the SDK's order
 * (ties by id), so a reload never moves it and a reply into the loop joins the loop's thread, as
 * `threadOf` would put it. Each thread is then `threadOf` over its own messages and the Notes on
 * their chains, so its order is the SDK's.
 */
function threadsOf(messages: Element[], notes: Element[], order: { rank: Map<string, number>; readable: Set<string> }): Thread[] {
  const byId = new Map<string, Element>();
  for (const e of [...notes, ...messages]) if (!byId.has(e.id)) byId.set(e.id, e);
  const isMsg = new Set(messages.map((m) => m.id));
  const parentOf = (e: Element): string | null => (typeof e.parent_narrative === 'string' && e.parent_narrative !== '' ? e.parent_narrative : null);
  const rankOf = (id: string) => order.rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rootOf = new Map<string, { root: string; outside: boolean }>();
  const notesOf = new Map<string, Set<string>>();
  for (const m of messages) {
    if (rootOf.has(m.id)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let cur: string | null = m.id;
    let found: { root: string; outside: boolean } | null = null;
    while (cur !== null) {
      const known = rootOf.get(cur);
      if (known) {
        found = known;
        break;
      }
      if (onPath.has(cur)) {
        // A loop: its root is the earliest message on it. A loop of Notes alone is a chain's end.
        const loop = path.slice(onPath.get(cur)!).filter((id) => isMsg.has(id));
        found = { root: loop.length ? loop.reduce((a, id) => (rankOf(id) < rankOf(a) ? id : a)) : path.filter((id) => isMsg.has(id)).pop()!, outside: false };
        break;
      }
      onPath.set(cur, path.length);
      path.push(cur);
      const e = byId.get(cur);
      const p: string | null = e ? parentOf(e) : null;
      if (p !== null && !byId.has(p)) {
        found = { root: path.filter((id) => isMsg.has(id)).pop()!, outside: true };
        break;
      }
      cur = p;
    }
    found ??= { root: path.filter((id) => isMsg.has(id)).pop()!, outside: false };
    const ns = notesOf.get(found.root) ?? new Set<string>();
    for (const id of path) {
      if (isMsg.has(id)) rootOf.set(id, found);
      else ns.add(id);
    }
    notesOf.set(found.root, ns);
  }
  const groups = new Map<string, Element[]>();
  for (const m of messages) {
    const root = rootOf.get(m.id)!.root;
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(m);
  }
  const threads: Thread[] = [];
  for (const [root, group] of groups) {
    const ns = notesOf.get(root) ?? new Set<string>();
    const list = (threadOf([...notes.filter((n) => ns.has(n.id)), ...group], root) as Element[]).filter((e) => isMsg.has(e.id));
    const readable = list.filter((e) => order.readable.has(e.id));
    const newest = readable.length ? readable.reduce((a, e) => (rankOf(e.id) > rankOf(a.id) ? e : a)) : null;
    // The root answers something outside only when it is the chain's own top, not a loop's choice.
    threads.push({ rootId: root, messages: list, answersOutside: rootOf.get(root)!.outside && rootOf.get(root)!.root === root, newest });
  }
  // Newest activity first, by the SDK's order; a thread with no readable time goes last, by root id.
  const key = (t: Thread) => (t.newest ? rankOf(t.newest.id) : -1);
  return threads.sort((a, b) => key(b) - key(a) || (a.rootId < b.rootId ? -1 : a.rootId > b.rootId ? 1 : 0));
}

/** The thread a shown message is in, by its own id; never by a hidden id a reply names. */
export function threadOfId(r: MessageReading, id: string): Thread | null {
  return r.threads.find((t) => t.messages.some((m) => m.id === id)) ?? null;
}

/** A readable `created_at` as an instant, or null: only for a message the SDK reads a time on. */
export function whenOf(r: MessageReading, m: Element): number | null {
  if (!r.readable.has(m.id) || typeof m.created_at !== 'string') return null;
  // The SDK has vetted the shape. It reads a time without an offset as UTC (Date.parse would
  // read it as local), and a lower-case t or z (Firefox's Date.parse refuses those).
  const v = m.created_at.toUpperCase();
  const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isFinite(t) ? t : null;
}

// -- The lines, each the SDK's answer, worded ------------------------------

const NOT_SHOWN = 'someone not shown here';

function nameIn(r: MessageReading, id: string | null): string {
  return id === null ? NOT_SHOWN : (r.names.get(id) ?? NOT_SHOWN);
}

export interface FromLine {
  status: OwSenderStatus;
  /** The verified sender's id and name, the only sender drawn bold; never on a proposed message. */
  verified: { id: string; name: string } | null;
  text: string;
}

export function fromLine(r: MessageReading, m: Element): FromLine {
  const s = senderStatus(m, r.members);
  let text: string;
  let verified: FromLine['verified'] = null;
  if (s.status === 'verified' && s.claimed !== null) {
    const name = nameIn(r, s.claimed);
    if (r.names.has(s.claimed) && !isProposedMessage(m)) verified = { id: s.claimed, name };
    text = `From ${name}`;
  } else if (s.status === 'mismatch') {
    text = `Claims to be from ${nameIn(r, s.claimed)}, written with the key of ${nameIn(r, s.writtenBy)}`;
  } else if (s.status === 'unseen') text = 'From someone you cannot see';
  else text = s.claimed === null ? 'From nobody' : `Claims to be from ${nameIn(r, s.claimed)}`;
  const e = editedBy(m, r.members);
  if (e.edited) text += e.by !== null && r.names.has(e.by) ? ` · edited by ${nameIn(r, e.by)}` : ' · edited by another hand';
  return { status: s.status, verified, text };
}

function listWords(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Shown names once each, in order, then one "someone not shown here" for any the reader is not shown (never how many). */
function namesOf(r: MessageReading, ids: string[]): string[] {
  const out: string[] = [];
  let unknown = false;
  for (const id of ids.filter((c, i, a) => a.indexOf(c) === i)) {
    if (r.names.has(id)) out.push(nameIn(r, id));
    else unknown = true;
  }
  return unknown ? [...out, NOT_SHOWN] : out;
}

export function toLine(r: MessageReading, m: Element): string {
  const opts = { keyless: r.keyless };
  const ids = recipientsOf(m);
  const unseen = hasUnseenRecipients(m, opts) === true;
  if (ids.length === 0) {
    if (isToEveryone(m, opts)) return 'To everyone';
    if (unseen) return 'To someone you cannot see';
    if (r.keyless) return 'No recipients named: to everyone, or to someone the public cannot see';
    return 'To nobody';
  }
  const names = namesOf(r, ids);
  return `To ${listWords(unseen ? [...names, 'someone you cannot see'] : names)}`;
}

/** Whose own the message is: the proved sender where the body carries hands, its narrator where it carries none. */
function ownerOf(r: MessageReading, m: Element): unknown {
  if ('created_by' in m) {
    const s = senderStatus(m, r.members);
    return s.status === 'verified' ? s.claimed : null;
  }
  return m.narrator;
}

/** The Character's read mark, the SDK's answer, asked once per reading. */
function markOf(r: MessageReading, c: string): Element | null {
  if (!r.markOf.has(c)) r.markOf.set(c, readMarkOf(r.marks, c, r.members) as Element | null);
  return r.markOf.get(c)!;
}

/**
 * Who has read it, or null: nothing where no mark can count, on a proposed message, or when no
 * shown Character's mark names it. Only shown Characters are listed; a proved own message is
 * never the sender's to read. "Not yet" is said only where the reader is served every mark, none
 * was left out, and, with a members list, of a Character some row plays (no other's mark could count).
 */
export function readLine(r: MessageReading, m: Element): string | null {
  if (!r.marksCount || isProposedMessage(m)) return null;
  const hasRead = (c: string) => {
    const mark = markOf(r, c);
    return !!mark && Array.isArray(mark.narratives) && (mark.narratives as unknown[]).includes(m.id);
  };
  const opts = { keyless: r.keyless };
  const recipients = recipientsOf(m);
  const own = ownerOf(r, m);
  const readers = (recipients.length === 0 ? (isToEveryone(m, opts) ? [...r.names.keys()] : []) : recipients).filter((c, i, a) => a.indexOf(c) === i && r.names.has(c) && c !== own);
  const read = readers.filter(hasRead).map((c) => nameIn(r, c));
  // To everyone, those not yet are not known here: only who has.
  const notYet = recipients.length === 0 || r.marksLeftOut || !r.everyMark ? [] : readers.filter((c) => (r.played === null || r.played.has(c)) && !hasRead(c)).map((c) => nameIn(r, c));
  const parts = [];
  if (read.length) parts.push(`Read by ${listWords(read)}`);
  if (notYet.length) parts.push(`${read.length ? 'not' : 'Not'} yet by ${listWords(notYet)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** The bidirectional controls (embeddings, overrides, isolates, the marks) and C0 and C1 controls but tab and newline, by code point. */
const STRIPPED = new RegExp(
  `[${[[0x202a, 0x202e], [0x2066, 0x2069], [0x061c, 0x061c], [0x200e, 0x200f], [0x0000, 0x0008], [0x000b, 0x001f], [0x007f, 0x009f]].map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')}]`,
  'g',
);

/** Text with those characters taken out. */
export function plainText(v: unknown): string {
  return typeof v === 'string' ? v.replace(STRIPPED, '') : '';
}
