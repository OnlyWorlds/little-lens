/**
 * A world from a file or a folder, read in the browser and held in memory: nothing read from it
 * is sent anywhere or stored. A world file (`.owworld`, a zip) goes through the SDK's
 * `readWorldFile`; a folder is the same world unpacked and is found by the same rule (OW-2, OW-5):
 * `world.json` at the top or in one top-level folder, a second one only under `records/`.
 * Element files sit at `elements/<type>/<name>.json` and the folder names the type. Map space is
 * not read, since the graph leaves it out, and from a folder nothing else is opened: no dot
 * folder, no `.env`, and the world's `api` block is dropped as the file reader drops it.
 */

import { OwWorldFileError, SPATIAL_TYPES, readWorldFile } from '@onlyworlds/sdk';
import { isElementType, type Element } from './graph';

export interface FileWorld {
  id: string;
  name: string;
  description: string;
  elements: Element[];
  /** Element files that were not JSON, had no id, or repeated an id already read. */
  unreadable: number;
}

export const NOT_A_WORLD = 'That is not a world Little Lens can open: it holds no world.json.';
export const MORE_THAN_ONE = 'That holds more than one world. Open one world at a time.';
export const NOT_OPENABLE = 'That file is not a world Little Lens can open.';
export const TOO_BIG = 'That world is too big for Little Lens to open in a browser.';

/** A world file larger than this is refused before it is inflated. */
export const MAX_FILE_BYTES = 512 * 1024 ** 2;

const ELEMENT_PATH = /^elements\/([a-z]+)\/[^/]+\.json$/;
const SPATIAL = new Set<string>(SPATIAL_TYPES);
const dec = new TextDecoder();

/** The element files the graph reads: a kept type's own folder, no dot-prefixed name. */
export function keptElementType(rel: string): string | null {
  const m = rel.match(ELEMENT_PATH);
  if (!m || !isElementType(m[1]) || SPATIAL.has(m[1])) return null;
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return null;
  return m[1];
}

interface Entry {
  path: string;
  data: Uint8Array;
}

function fromEntries(world: Record<string, unknown>, entries: Entry[]): FileWorld {
  const id = typeof world.id === 'string' ? world.id : '';
  if (!id) throw new Error(NOT_A_WORLD);
  const byId = new Map<string, Element>();
  let unreadable = 0;
  // Code-point order, so the same files always give the same winner of a repeated id.
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of sorted) {
    const type = keptElementType(f.path);
    if (!type) continue;
    try {
      const body = JSON.parse(dec.decode(f.data)) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.id !== 'string' || body.id === '' || byId.has(body.id)) {
        unreadable++;
        continue;
      }
      // The folder names the type, set before any mark is read (the room mark needs it).
      byId.set(body.id, { ...body, id: body.id, type } as Element);
    } catch {
      unreadable++;
    }
  }
  return {
    id,
    name: typeof world.name === 'string' && world.name ? world.name : 'Untitled world',
    description: typeof world.description === 'string' ? world.description : '',
    elements: [...byId.values()],
    unreadable,
  };
}

export function readWorldFileBytes(bytes: Uint8Array): FileWorld {
  let read: ReturnType<typeof readWorldFile>;
  try {
    read = readWorldFile(bytes, { maxBytes: MAX_FILE_BYTES, skip: (p) => keptElementType(p) === null });
  } catch (e) {
    if (e instanceof OwWorldFileError) {
      if (e.reason === 'not_a_world') throw new Error(NOT_A_WORLD);
      if (e.reason === 'more_than_one') throw new Error(MORE_THAN_ONE);
      if (e.reason === 'too_big' || e.reason === 'too_many') throw new Error(TOO_BIG);
      throw new Error(NOT_OPENABLE);
    }
    throw e;
  }
  return fromEntries(read.world as Record<string, unknown>, read.files);
}

/** A picked folder's files, each with its path from the picked folder (`webkitRelativePath`). */
export interface PickedFile {
  path: string;
  bytes(): Promise<Uint8Array>;
}

/**
 * The world's folder within the picked one, as the file reader finds it in an archive: the picked
 * folder's own name is dropped, then `world.json` sits at the top or in exactly one top-level
 * folder that is not dot-prefixed, and any deeper one outside `records/` is a second world.
 * Returns the prefix to strip from each picked path.
 */
export function worldRootOf(paths: string[]): string {
  const picked = paths.length > 0 && paths.every((p) => p.includes('/')) ? paths[0].slice(0, paths[0].indexOf('/') + 1) : '';
  const rel = paths.filter((p) => p.startsWith(picked)).map((p) => p.slice(picked.length));
  let prefix: string;
  if (rel.includes('world.json')) prefix = '';
  else {
    const roots = new Set(rel.filter((n) => n.split('/').length === 2 && n.endsWith('/world.json') && !n.startsWith('.')).map((n) => n.slice(0, -'world.json'.length)));
    if (roots.size === 0) throw new Error(NOT_A_WORLD);
    if (roots.size > 1) throw new Error(MORE_THAN_ONE);
    prefix = [...roots][0];
  }
  for (const n of rel) {
    if (!n.startsWith(prefix)) continue;
    const inner = n.slice(prefix.length);
    if (inner !== 'world.json' && inner.endsWith('/world.json') && !inner.startsWith('records/') && !inner.split('/').some((s) => s.startsWith('.'))) {
      throw new Error(MORE_THAN_ONE);
    }
  }
  return picked + prefix;
}

export async function readWorldFolder(files: PickedFile[]): Promise<FileWorld> {
  const root = worldRootOf(files.map((f) => f.path));
  const worldFile = files.find((f) => f.path === `${root}world.json`)!;
  let world: Record<string, unknown>;
  try {
    world = JSON.parse(dec.decode(await worldFile.bytes())) as Record<string, unknown>;
  } catch {
    throw new Error(NOT_A_WORLD);
  }
  if (!world || typeof world !== 'object' || Array.isArray(world)) throw new Error(NOT_A_WORLD);
  // A linked folder's key never enters this page's memory.
  delete world.api;
  const entries: Entry[] = [];
  for (const f of files) {
    if (!f.path.startsWith(root)) continue;
    const rel = f.path.slice(root.length);
    if (keptElementType(rel) === null) continue;
    entries.push({ path: rel, data: await f.bytes() });
  }
  return fromEntries(world, entries);
}
