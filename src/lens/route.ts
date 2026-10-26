/** Little Lens's addresses, all in the hash: the ways in, a public world, the world held from a file. */

export type Route =
  | { kind: 'home' }
  | { kind: 'world'; worldId: string; elementId: string | null; view: 'web' | 'list' }
  | { kind: 'file'; elementId: string | null; view: 'web' | 'list' }
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
  const view = new URLSearchParams(query).get('view') === 'list' ? 'list' : 'web';
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'w' && (parts.length === 2 || (parts.length === 4 && parts[2] === 'e'))) {
    const worldId = parts[1];
    const elementId = parts[3] ?? null;
    if (!isId(worldId) || (elementId !== null && !isId(elementId))) return { kind: 'closed' };
    return { kind: 'world', worldId: worldId.toLowerCase(), elementId: elementId?.toLowerCase() ?? null, view };
  }
  if (parts[0] === 'file' && (parts.length === 1 || (parts.length === 3 && parts[1] === 'e'))) {
    // A file's ids are any non-empty string (folder spec), kept as written and looked up in a Map.
    let elementId: string | null = null;
    if (parts[2] !== undefined) {
      try {
        elementId = decodeURIComponent(parts[2]);
      } catch {
        return { kind: 'closed' };
      }
    }
    return { kind: 'file', elementId, view };
  }
  return { kind: 'home' };
}

export function worldHash(worldId: string | null, elementId: string | null = null, view: 'web' | 'list' = 'web'): string {
  const base = worldId ? `#/w/${worldId}` : '#/file';
  const el = elementId ? `/e/${encodeURIComponent(elementId)}` : '';
  return `${base}${el}${view === 'list' && !elementId ? '?view=list' : ''}`;
}
