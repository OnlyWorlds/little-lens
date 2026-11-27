import { describe, expect, it } from 'vitest';
import { writeWorldFile } from '@onlyworlds/sdk';
import { zipSync } from 'fflate';
import { FILE_WORLD_UNREADABLE, MORE_THAN_ONE, NAME_CASE, NOT_A_WORLD, WORLD_UNREADABLE, readWorldFileBytes, readWorldFolder, worldRootOf } from './file-read';

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
  it('reads a world file as the SDK reads a folder: the body names the type, broken files counted', async () => {
    const w = await readWorldFileBytes(writeWorldFile(parts, 'test-world'));
    expect(w.id).toBe(W);
    expect(w.name).toBe('Test world');
    // a.json says it is a location: the SDK's folder reader takes the body's type over its folder's.
    expect(w.elements.map((e) => [e.id, e.type])).toEqual([
      [id(2), 'character'],
      [id(1), 'location'],
    ]);
    expect(w.unreadable).toBe(2);
  });

  it('reads the same files from a picked folder as the SDK reads a folder: the body names the type', async () => {
    const picked = parts.map((p) => ({ path: `Test world/${p.path}`, bytes: async () => p.data }));
    const w = await readWorldFolder(picked);
    // a.json says it is a location: the SDK's folder reader takes the body's type over its folder's.
    expect(w.elements.map((e) => [e.id, e.type])).toEqual([
      [id(2), 'character'],
      [id(1), 'location'],
    ]);
    expect(w.unreadable).toBe(2);
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
    const w = await readWorldFileBytes(
      writeWorldFile([file('world.json', { id: W }), file('elements/narrative/r.json', { id: id(5), supertype: 'Message', x_room_of: id(9) })], 'w'),
    );
    expect(buildGraph(w.elements).leftOut.room).toBe(1);
  });

  it('opens a world file whose world.json is not UTF-8, as the file reader always has: the odd byte a replacement mark', async () => {
    const latin1 = new Uint8Array([...enc.encode(`{"id":"${W}","name":"caf`), 0xe9, ...enc.encode('"}')]);
    const w = await readWorldFileBytes(writeWorldFile([{ path: 'world.json', data: latin1 }, file('elements/character/a.json', { id: id(1), name: 'A' })], 'w'));
    expect(w.name).toBe('caf\uFFFD');
    expect(w.elements.map((e) => e.id)).toEqual([id(1)]);
  });

  it('opens a world file whose world.json nests within the format\'s bound, and refuses one past it in a sentence', async () => {
    const deep = (n: number, tail: Uint8Array) => new Uint8Array([...enc.encode(`{"id":"${W}","x":${'['.repeat(n)}${']'.repeat(n)},"name":"caf`), ...tail, ...enc.encode('"}')]);
    const a = file('elements/character/a.json', { id: id(1), name: 'A' });
    // world.json itself is one level: a value 199 deep inside it is 200, the format's bound.
    const w = await readWorldFileBytes(writeWorldFile([{ path: 'world.json', data: deep(199, enc.encode('e')) }, a], 'w'));
    expect(w.name).toBe('cafe');
    // Past the bound, the SDK's writer refuses to make such a file, so it is zipped by hand, as any tool could.
    const zipped = (world: Uint8Array) => zipSync({ 'w/world.json': world, [`w/${a.path}`]: a.data });
    await expect(readWorldFileBytes(zipped(deep(200, enc.encode('e'))))).rejects.toThrow(FILE_WORLD_UNREADABLE);
    await expect(readWorldFileBytes(zipped(deep(20000, enc.encode('e'))))).rejects.toThrow(FILE_WORLD_UNREADABLE);
    // Past the bound and not UTF-8: still the world.json that cannot be read, never a file with no world.
    await expect(readWorldFileBytes(zipped(deep(20000, new Uint8Array([0xe9]))))).rejects.toThrow(FILE_WORLD_UNREADABLE);
  });

  it('says a world file holding elements/ in other capitals is named wrong, never a world with no elements', async () => {
    const z = zipSync({ 'w/world.json': enc.encode(JSON.stringify({ id: W, name: 'Caps' })), 'w/Elements/character/a.json': enc.encode(JSON.stringify({ id: id(1), name: 'A' })) });
    await expect(readWorldFileBytes(z)).rejects.toThrow(NAME_CASE);
  });

  it('says the world.json cannot be read when it does not parse, is not UTF-8 or has no id', async () => {
    const latin1 = new Uint8Array([...enc.encode(`{"id":"${W}","name":"caf`), 0xe9, ...enc.encode('"}')]);
    for (const body of [enc.encode('{not json'), enc.encode(JSON.stringify({ name: 'no id' })), enc.encode(JSON.stringify({ id: '' })), enc.encode('[]'), latin1]) {
      const picked = [
        { path: 'W/world.json', bytes: async () => body },
        { path: 'W/elements/character/a.json', bytes: async () => enc.encode(JSON.stringify({ id: id(1) })) },
      ];
      await expect(readWorldFolder(picked)).rejects.toThrow(WORLD_UNREADABLE);
    }
    expect(WORLD_UNREADABLE).not.toBe(NOT_A_WORLD);
  });

  it('opens only .json files under elements/ and spatial/: a large file of any other kind is never read', async () => {
    const opened: string[] = [];
    const big = new Uint8Array(64 * 1024 ** 2);
    const pick = (path: string, data: Uint8Array) => ({
      path,
      bytes: async () => {
        opened.push(path);
        return data;
      },
    });
    const w = await readWorldFolder([
      pick('W/world.json', enc.encode(JSON.stringify({ id: W, name: 'With media' }))),
      pick('W/elements/character/a.json', enc.encode(JSON.stringify({ id: id(1), name: 'A' }))),
      pick('W/elements/character/portrait.mp4', big),
      pick('W/elements/portrait.png', big),
      pick('W/spatial/readme.txt', big),
      pick('W/elements/character/a.json.bak', big),
    ]);
    expect(opened.sort()).toEqual(['W/elements/character/a.json', 'W/world.json']);
    expect(w.elements.map((e) => e.id)).toEqual([id(1)]);
    expect(w.unreadable).toBe(0);
  });

  it('opens nothing but the world and its element files from a folder, and drops the key', async () => {
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
    // Every element file is opened, map space too: a body may name another type than its folder's.
    expect(opened.sort()).toEqual(['W/elements/character/a.json', 'W/elements/character/a2.json', 'W/elements/pin/p.json', 'W/world.json']);
    expect(w.elements.map((e) => e.id)).toEqual([id(1)]);
    expect(w.unreadable).toBe(1);
    expect(JSON.stringify(w)).not.toContain('secret');
  });
});
