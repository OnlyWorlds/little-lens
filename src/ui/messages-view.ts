/**
 * A world's messages: the conversations, newest first, and one conversation in its order. Every
 * line about a message is the messages reader's (the SDK's answers, worded); this file only lays
 * them out. Text goes in as text.
 */

import { h } from './dom';
import { fromLine, isLapsed, isProposedMessage, isRoomLine, plainText, readParts, toParts, whenOf, type Line, type MessageReading, type Thread } from '../lens/messages';
import type { Element } from '../lens/graph';

export interface MessagesProps {
  reading: MessageReading;
  /** The conversation's address. */
  threadHref: (rootId: string) => string;
  /** The list's address. */
  listHref: string;
  /** An element's address, for the proved sender's name, or null when the web does not show it. */
  elementHref: (id: string) => string | null;
  /** The line saying what cannot be checked here, or null. */
  checkLine: string | null;
}

function when(r: MessageReading, m: Element): string | null {
  const t = whenOf(r, m);
  return t === null ? null : new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function subjectOf(m: Element): string {
  return plainText(m.name).trim() || 'No subject';
}

/**
 * A line's parts as nodes: our words as text, each name in its own `<bdi>` so a right-to-left name
 * keeps the words around it in place. The proved sender is bold, and a link when `href` is given.
 */
function drawLine(line: Line, href: string | null = null): Node[] {
  return line.map((p) => {
    if (typeof p === 'string') return document.createTextNode(p);
    const name = h('bdi', {}, p.name);
    if (!p.proved) return name;
    const b = h('b', {}, name);
    return href ? h('a', { class: 'mwho', href }, b) : b;
  });
}

function proposedWord(m: Element): string {
  return isLapsed(m) ? 'Proposed, lapsed' : 'Proposed, not yet reviewed';
}

function countLine(r: MessageReading): string {
  const settled = r.messages.length - r.proposed;
  const c = r.threads.length;
  const parts = [`${settled} ${settled === 1 ? 'message' : 'messages'} in ${c} ${c === 1 ? 'conversation' : 'conversations'}`];
  if (r.proposed) parts.push(`${r.proposed} proposed`);
  if (r.hidden) parts.push(`${r.hidden} hidden, not shown`);
  return parts.join(' · ');
}

function head(p: MessagesProps): HTMLElement {
  return h('div', { class: 'mhead' }, h('p', { class: 'mcount' }, countLine(p.reading)), p.checkLine ? h('p', { class: 'mcheck' }, p.checkLine) : null);
}

export function messagesList(p: MessagesProps): HTMLElement {
  const r = p.reading;
  const ul = h('ul', { class: 'threads', 'aria-label': 'Conversations' });
  for (const t of r.threads) {
    const root = t.messages[0];
    const last = t.newest ?? t.messages[t.messages.length - 1];
    const at = when(r, last);
    // The row is one link and its sender plain, as before: each name isolated, none bold.
    const meta: Line = [
      `${t.messages.length} ${t.messages.length === 1 ? 'message' : 'messages'} · ${isProposedMessage(last) ? `${proposedWord(last)} · ` : ''}`,
      ...fromLine(r, last).parts.map((q) => (typeof q === 'string' ? q : { name: q.name })),
      at ? ` · ${at}` : '',
    ];
    ul.append(
      h(
        'li',
        {},
        h(
          'a',
          { class: 'thread', href: p.threadHref(t.rootId) },
          h('span', { class: 'tsubject', dir: 'auto' }, subjectOf(root)),
          h('span', { class: 'tmeta' }, ...drawLine(meta)),
        ),
      ),
    );
  }
  return h('section', { class: 'messages', 'aria-label': 'Messages' }, head(p), r.threads.length ? ul : h('p', { class: 'empty' }, 'No messages shown here.'));
}

export function messagesThread(p: MessagesProps, t: Thread): HTMLElement {
  const r = p.reading;
  const list = h('ol', { class: 'mthread', 'aria-label': 'The conversation' });
  for (const m of t.messages) {
    const f = fromLine(r, m);
    const read = readParts(r, m);
    const at = when(r, m);
    const proposed = isProposedMessage(m);
    // Only a proved sender is drawn as one: bold, and a link to which Character it is.
    const href = f.verified ? p.elementHref(f.verified.id) : null;
    const fromEl = h('p', { class: f.verified ? 'mfrom' : 'mfrom claim' }, ...drawLine(f.parts, href));
    list.append(
      h(
        'li',
        { class: `msg${proposed ? ' proposed' : ''}` },
        h('h3', { class: 'msubject', dir: 'auto' }, subjectOf(m)),
        proposed ? h('p', { class: 'mflag' }, proposedWord(m)) : null,
        isRoomLine(m) ? h('p', { class: 'mflag' }, 'A line in a room') : null,
        fromEl,
        h('p', { class: 'mto' }, ...drawLine(toParts(r, m))),
        at ? h('p', { class: 'mwhen' }, at) : null,
        read ? h('p', { class: 'mread' }, ...drawLine(read)) : null,
        plainText(m.story) ? h('p', { class: 'mbody', dir: 'auto' }, plainText(m.story)) : null,
      ),
    );
  }
  return h(
    'section',
    { class: 'messages', 'aria-label': 'Conversation' },
    h('nav', { class: 'mback' }, h('a', { href: p.listHref }, '← All conversations')),
    head(p),
    t.answersOutside ? h('p', { class: 'mflag' }, 'Answers something not in these conversations') : null,
    list,
  );
}
