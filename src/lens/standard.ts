/**
 * The small worlds from the OnlyWorlds standard: the lens and charter profiles' fixture worlds,
 * vendored at one schema-dist release (`src/standard/worlds.json`, written by
 * `scripts/standard-worlds.mjs`, never by hand). Loaded on first ask, in a chunk of their own.
 * Each opens as its owner is served it, the ids its hidden mark keeps from the others marked
 * hidden, so every reader here leaves them out and counts them.
 */

import type { OwMessageMember } from '@onlyworlds/sdk';
import type { Element } from './graph';
import type { WorldTime } from './time';

export interface StandardWorld {
  profile: string;
  key: string;
  id: string;
  name: string;
  elements: Element[];
  hidden: string[];
  members?: OwMessageMember[];
  time_basic_unit?: string;
  now?: number;
}

export interface StandardFile {
  tag: string;
  serial: number;
  worlds: StandardWorld[];
}

let file: Promise<StandardFile> | null = null;

export function standardWorlds(): Promise<StandardFile> {
  // A failed chunk load is forgotten, so the next ask tries again.
  file ??= import('../standard/worlds.json').then(
    (m) => m.default as unknown as StandardFile,
    (e: unknown) => {
      file = null;
      throw e;
    },
  );
  return file;
}

export interface OpenedStandard {
  world: StandardWorld;
  serial: number;
  bodies: Element[];
  time: WorldTime;
  members: OwMessageMember[] | null;
}

/** One small world as a world to read, or null for an id the file does not hold. */
export async function openStandard(id: string): Promise<OpenedStandard | null> {
  const f = await standardWorlds();
  const world = f.worlds.find((w) => w.id === id);
  if (!world) return null;
  const hidden = new Set(world.hidden ?? []);
  const bodies = world.elements.map((e) => (hidden.has(e.id) ? { ...e, hidden: true } : { ...e }));
  const time: WorldTime = {
    unit: typeof world.time_basic_unit === 'string' && world.time_basic_unit.trim() !== '' ? world.time_basic_unit : null,
    now: Number.isInteger(world.now) ? (world.now as number) : null,
  };
  return { world, serial: f.serial, bodies, time, members: Array.isArray(world.members) ? world.members : null };
}
