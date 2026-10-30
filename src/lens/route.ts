/**
 * Little Lens's addresses, all in the hash: the ways in, a public world (`#/w/`), a world read as
 * the signed-in account (`#/me/`), the world held from a file. A world's time view is `/time`,
 * its moment `?at=<step>`.
 */

import { parseAt } from './time';

/** Who a world is read as: keyless, as the signed-in account, or from a file held in this tab. */
export type Reader = 'public' | 'me' | 'file';

export type View = 'web' | 'list' | 'time' | 'draught';

/** The time view and an element's draught carry their moment; the others carry none. */
type ViewPart = { view: 'web' | 'list' } | { view: 'time' | 'draught'; at: number | null };

export type Route =
  | { kind: 'home' }
  | ({ kind: 'world'; reader: 'public' | 'me'; worldId: string; elementId: string | null } & ViewPart)
  | ({ kind: 'file'; elementId: string | null } & ViewPart)
  /** An address with an id that is no id: drawn as the closed door, with no request. */
  | { kind: 'closed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(s: string): boolean {
  return UUID.test(s);
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const plain: ViewPart = { view: params.get('view') === 'list' ? 'list' : 'web' };
  const time: ViewPart = { view: 'time', at: parseAt(params.get('at')) };
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'w' || parts[0] === 'me') {
    const reader = parts[0] === 'me' ? 'me' : 'public';
    const worldId = parts[1];
    const isTime = parts.length === 3 && parts[2] === 'time';
    // An element's draught: the only element address that carries a moment.
    const isDraught = parts.length === 5 && parts[2] === 'e' && parts[4] === 'draught';
    if (parts.length === 2 || isTime || (parts.length === 4 && parts[2] === 'e') || isDraught) {
      const elementId = parts.length >= 4 ? parts[3] : null;
      if (!isId(worldId) || (elementId !== null && !isId(elementId))) return { kind: 'closed' };
      const view: ViewPart = isTime ? time : isDraught ? { view: 'draught', at: parseAt(params.get('at')) } : plain;
      return { kind: 'world', reader, worldId: worldId.toLowerCase(), elementId: elementId?.toLowerCase() ?? null, ...view };
    }
  }
  if (parts[0] === 'file') {
    if (parts.length === 2 && parts[1] === 'time') return { kind: 'file', elementId: null, ...time };
    if (parts.length === 1 || (parts.length === 3 && parts[1] === 'e')) {
      // A file's ids are any non-empty string (folder spec), kept as written and looked up in a Map.
      let elementId: string | null = null;
      if (parts[2] !== undefined) {
        try {
          elementId = decodeURIComponent(parts[2]);
        } catch {
          return { kind: 'closed' };
        }
      }
      return { kind: 'file', elementId, ...plain };
    }
  }
  return { kind: 'home' };
}

export function worldHash(reader: Reader, worldId: string | null, elementId: string | null = null, view: View = 'web', at: number | null = null): string {
  const base = reader === 'file' || !worldId ? '#/file' : `#/${reader === 'me' ? 'me' : 'w'}/${worldId}`;
  // A file has no draught (keel reads it), so its element address is the element's.
  if (elementId && view === 'draught' && base !== '#/file') return `${base}/e/${encodeURIComponent(elementId)}/draught${at !== null ? `?at=${at}` : ''}`;
  if (elementId) return `${base}/e/${encodeURIComponent(elementId)}`;
  if (view === 'time') return `${base}/time${at !== null ? `?at=${at}` : ''}`;
  return `${base}${view === 'list' ? '?view=list' : ''}`;
}
