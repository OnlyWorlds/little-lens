/**
 * A world from a file or a folder, read in the browser and held in memory: nothing read from it
 * is sent anywhere or stored. A world file (`.owworld`, a zip) is unpacked by the SDK's
 * `readWorldFile`, which finds its world; a folder's world is found by the same rule (OW-2, OW-5):
 * `world.json` at the top or in one top-level folder, a second one only under `records/`.
 *
 * Then both are read the same way, as an online world is: through the SDK's client, its source the
 * SDK's folder source, so the folder format is read as the SDK reads it and every element as keel
 * would serve it, and a world file and the same folder read alike. Only `world.json`, `elements/`
 * and `spatial/` are opened, and of those only `.json` files, never a dot folder or file, nor
 * `.env`; the world's `api` block is dropped.
 */

import { OwWorldFileError, readWorldFile } from '@onlyworlds/sdk';
import type { OwFolderReadReport } from '@onlyworlds/sdk/folder';
import { isGraphType, type Element } from './graph';
import type { WorldTime } from './time';
import { folderSource, readWorldElements, readWorldMeta } from './world-read';

export interface FileWorld {
  id: string;
  name: string;
  description: string;
  elements: Element[];
  /** Element files of the graph's own types that were not JSON, had no id, or repeated an id already read. */
  unreadable: number;
  /** The world's unit and now, from its `world.json`. */
  time: WorldTime;
}

export const NOT_A_WORLD = 'That is not a world Little Lens can open: it holds no world.json.';
/** A folder's world.json is there, and the folder format's reader cannot read it (not JSON, not UTF-8, no id). */
export const WORLD_UNREADABLE = "That folder's world.json cannot be read.";
/** The same for a world file: its world.json opened, and the folder format's reader cannot read it (nested past the format's bound, 200 levels). */
export const FILE_WORLD_UNREADABLE = "That world file's world.json cannot be read.";
export const MORE_THAN_ONE = 'That holds more than one world. Open one world at a time.';
export const NOT_OPENABLE = 'That file is not a world Little Lens can open.';
export const TOO_BIG = 'That world is too big for Little Lens to open in a browser.';

const enc = new TextEncoder();
const strict = new TextDecoder('utf-8', { fatal: true });

/** A world file larger than this is refused before it is inflated. */
export const MAX_FILE_BYTES = 512 * 1024 ** 2;

interface Entry {
  path: string;
  data: Uint8Array;
}

export async function readWorldFileBytes(bytes: Uint8Array): Promise<FileWorld> {
  let read: ReturnType<typeof readWorldFile>;
  try {
    read = readWorldFile(bytes, { maxBytes: MAX_FILE_BYTES, skip: (p) => !opensInFolder(p) });
  } catch (e) {
    if (e instanceof OwWorldFileError) {
      if (e.reason === 'not_a_world') throw new Error(NOT_A_WORLD);
      if (e.reason === 'more_than_one') throw new Error(MORE_THAN_ONE);
      if (e.reason === 'too_big' || e.reason === 'too_many') throw new Error(TOO_BIG);
      throw new Error(NOT_OPENABLE);
    }
    // Anything else the reader throws on a file (the engine's own limits included) is still a file
    // this reader cannot open, said as one: the person never reads the engine's text.
    console.warn('[little-lens] the world file reader threw', e);
    throw new Error(NOT_OPENABLE);
  }
  return readEntries(read.files.map((f) => (f.path === 'world.json' ? { path: f.path, data: worldBytesOf(f.data, read.world) } : f)), FILE_WORLD_UNREADABLE);
}

/**
 * The file's world.json for the folder source. Its own bytes, unless they are not UTF-8: the file
 * reader decodes leniently (a name in Latin-1 opens, its odd byte a replacement mark, as it always
 * has here) and the folder source strictly, so then the world as the file reader read it is handed
 * on instead. A world that cannot be written back out (nested past what the engine can) is no world
 * this reader can open.
 */
function worldBytesOf(bytes: Uint8Array, world: Record<string, unknown>): Uint8Array {
  try {
    strict.decode(bytes);
    return bytes;
  } catch {
    try {
      return enc.encode(JSON.stringify(world));
    } catch {
      throw new Error(NOT_OPENABLE);
    }
  }
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

/**
 * What a folder's read opens: its world and the `.json` files under `elements/` and `spatial/`,
 * never a dot folder or file (`.env`, `.atlas/`), nor a file that could be no element (a picture,
 * a video), which is never read into memory. Which of them is an element is the SDK's rule.
 */
function opensInFolder(rel: string): boolean {
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return false;
  return rel === 'world.json' || ((rel.startsWith('elements/') || rel.startsWith('spatial/')) && rel.endsWith('.json'));
}

export async function readWorldFolder(files: PickedFile[]): Promise<FileWorld> {
  const root = worldRootOf(files.map((f) => f.path));
  const entries: Entry[] = [];
  for (const f of files) {
    if (!f.path.startsWith(root)) continue;
    const rel = f.path.slice(root.length);
    if (opensInFolder(rel)) entries.push({ path: rel, data: await f.bytes() });
  }
  return readEntries(entries);
}

/**
 * A world's opened files, a folder's or a world file's, read as one world through the SDK's
 * folder source (`world.json` among them, relative to the world's folder).
 */
async function readEntries(entries: Entry[], worldRefusal = WORLD_UNREADABLE): Promise<FileWorld> {
  const seen: { report: OwFolderReadReport | null } = { report: null };
  const source = folderSource(entries, (r) => (seen.report = r));
  let meta;
  try {
    meta = await readWorldMeta(null, source);
  } catch (e) {
    // The world.json is there (the root was found by it), and the source cannot read it: not JSON,
    // not UTF-8, no id, or nested past the format's bound (200 levels). It serves nothing from it.
    if (seen.report && !seen.report.world) throw new Error(worldRefusal);
    throw e;
  }
  const elements = await readWorldElements(meta, source);
  // A file the view never reads (map space) is not one it failed to read.
  const unreadable = (seen.report?.skipped ?? []).filter((s) => isGraphType(s.path.split('/')[1] ?? '')).length;
  return { id: meta.id, name: meta.name, description: meta.description, elements, unreadable, time: meta.time };
}
