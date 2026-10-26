import { describe, expect, it } from 'vitest';
import { writeWorldFile } from '@onlyworlds/sdk';
import { MORE_THAN_ONE, NOT_A_WORLD, readWorldFileBytes, readWorldFolder, worldRootOf } from './file-read';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const enc = new TextEncoder();
const file = (path: string, body: unknown) => ({ path, data: enc.encode(typeof body === 'string' ? body : JSON.stringify(body)) });

const parts = [
  file('world.json', { id: W, name: 'Test world' }),
  file('elements/character/a.json', { id: id(1), name: 'A', type: 'location', friends: [id(2)] }),
  file('elements/character/b.json', { id: id(2), name: 'B', hidden: true }),
  file('elements/character/broken.json', '{not json'),
  file('elements/character/noid.json', { name: 'no id' }),
  file('elements/notatype/c.json', { id: id(3) }),
  file('spatial/pin/p.json', { id: id(4) }),
];

describe('the file read', () => {
  it('reads a world file: the folder names the type, broken files counted, map space skipped', () => {
    const w = readWorldFileBytes(writeWorldFile(parts, 'test-world'));
    expect(w.id).toBe(W);
    expect(w.name).toBe('Test world');
    expect(w.elements.map((e) => [e.id, e.type])).toEqual([
      [id(1), 'character'],
      [id(2), 'character'],
    ]);
    expect(w.unreadable).toBe(2);
  });

  it('reads the same world from a picked folder', async () => {
    const picked = parts.map((p) => ({ path: `Test world/${p.path}`, bytes: async () => p.data }));
    const w = await readWorldFolder(picked);
    expect(w.elements.map((e) => e.id)).toEqual([id(1), id(2)]);
  });

  it('finds the root as the file reader does: a producer record and a dot folder are no second world', () => {
    expect(worldRootOf(['W/world.json', 'W/elements/character/a.json', 'W/records/tool/world.json', 'W/.atlas/world.json'])).toBe('W/');
    expect(worldRootOf(['P/W/world.json', 'P/.git/x', 'P/.atlas/world.json'])).toBe('P/W/');
    expect(worldRootOf(['world.json'])).toBe('');
    expect(() => worldRootOf(['W/elements/character/a.json'])).toThrow(NOT_A_WORLD);
    expect(() => worldRootOf(['P/A/world.json', 'P/B/world.json'])).toThrow(MORE_THAN_ONE);
    expect(() => worldRootOf(['W/world.json', 'W/elements/other/world.json'])).toThrow(MORE_THAN_ONE);
  });

  it('marks a room element whose file carries no type, since the folder names it', async () => {
    const { buildGraph } = await import('./graph');
    const w = readWorldFileBytes(
      writeWorldFile([file('world.json', { id: W }), file('elements/narrative/r.json', { id: id(5), supertype: 'Message', x_room_of: id(9) })], 'w'),
    );
    expect(buildGraph(w.elements).leftOut.room).toBe(1);
  });

  it('opens nothing but the world and its kept element files from a folder, and drops the key', async () => {
    const opened: string[] = [];
    const pick = (path: string, body: unknown) => ({
      path,
      bytes: async () => {
        opened.push(path);
        return enc.encode(JSON.stringify(body));
      },
    });
    const w = await readWorldFolder([
      pick('W/world.json', { id: W, name: 'Linked', api: { api_key: 'secret' } }),
      pick('W/.env', 'KEY=secret'),
      pick('W/elements/character/a.json', { id: id(1) }),
      pick('W/elements/character/a2.json', { id: id(1), name: 'repeat' }),
      pick('W/elements/pin/p.json', { id: id(2) }),
      pick('W/elements/.hidden/x.json', { id: id(3) }),
    ]);
    expect(opened.sort()).toEqual(['W/elements/character/a.json', 'W/elements/character/a2.json', 'W/world.json']);
    expect(w.elements.map((e) => e.id)).toEqual([id(1)]);
    expect(w.unreadable).toBe(1);
  });
});
