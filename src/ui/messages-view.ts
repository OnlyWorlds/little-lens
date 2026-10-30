/**
 * A world's messages: the conversations, newest first, and one conversation in its order. Every
 * line about a message is the messages reader's (the SDK's answers, worded); this file only lays
 * them out. Text goes in as text.
 */

import { h } from './dom';
import { fromLine, isLapsed, isProposedMessage, isRoomLine, plainText, readLine, toLine, whenOf, type MessageReading, type Thread } from '../lens/messages';
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
    const sender = `${isProposedMessage(last) ? `${proposedWord(last)} · ` : ''}${fromLine(r, last).text}`;
    ul.append(
      h(
        'li',
        {},
        h(
          'a',
          { class: 'thread', href: p.threadHref(t.rootId) },
          h('span', { class: 'tsubject', dir: 'auto' }, subjectOf(root)),
          h('span', { class: 'tmeta' }, `${t.messages.length} ${t.messages.length === 1 ? 'message' : 'messages'} · ${sender}${at ? ` · ${at}` : ''}`),
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
    const read = readLine(r, m);
    const at = when(r, m);
    const proposed = isProposedMessage(m);
    // Only a proved sender is drawn as one: bold, and a link to which Character it is.
    const href = f.verified ? p.elementHref(f.verified.id) : null;
    const who = f.verified ? h('b', {}, h('bdi', {}, f.verified.name)) : null;
    const fromEl = f.verified
      ? h('p', { class: 'mfrom' }, 'From ', href ? h('a', { class: 'mwho', href }, who) : who, f.text.slice(`From ${f.verified.name}`.length))
      : h('p', { class: 'mfrom claim' }, f.text);
    list.append(
      h(
        'li',
        { class: `msg${proposed ? ' proposed' : ''}` },
        h('h3', { class: 'msubject', dir: 'auto' }, subjectOf(m)),
        proposed ? h('p', { class: 'mflag' }, proposedWord(m)) : null,
        isRoomLine(m) ? h('p', { class: 'mflag' }, 'A line in a room') : null,
        fromEl,
        h('p', { class: 'mto' }, toLine(r, m)),
        at ? h('p', { class: 'mwhen' }, at) : null,
        read ? h('p', { class: 'mread' }, read) : null,
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
