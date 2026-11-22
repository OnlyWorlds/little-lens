/**
 * Parity for a picked folder: every small world of the standard written out as a folder, the
 * played folders the tests and the walk open, and one folder of the shapes the folder read guards.
 *
 * `folder.parity.json` is the record of the folder read before it moved onto the SDK's folder
 * source: the files it opened, the meta, the unreadable count, the graph's structure and bodies,
 * hashed. That read is kept here (`before`: the guards, then the world file's element reader on the
 * same files) and held to the record first, so the comparison below is with the read as it was.
 *
 * The read now follows the SDK's reader of the folder format, so a folder reads as keel would
 * serve it. Every difference from the read before is named below, by the rule that makes it:
 *   A  keel's body: every schema field served (empty as "", null or []), any key that is neither
 *      schema nor an extension dropped
 *   B  a link held twice is held once, a null in a list dropped
 *   C  the body's type over its folder's
 *   D  the legacy `spatial/` layout read (a Zone is a node)
 *   E  a file that is not UTF-8 is not JSON
 *   F  ids matched as UUIDs: one in capitals repeats the other
 *   G  the world's time as the world body serves it (`time_current` first, as given)
 *   U  the unreadable count holds only the graph's own types; E and F add to it
 * Added fields that are empty are rule A and listed by no one; any other difference is red.
 */

import { describe, expect, it, vi } from 'vitest';
import { OwV2Client } from '@onlyworlds/sdk';
import worlds from '../standard/worlds.json';
import recorded from './folder.parity.json';
import { fromEntries, keptElementType, readWorldFolder, worldRootOf, type FileWorld, type PickedFile } from './file-read';
import { buildGraph, type Element } from './graph';

const enc = new TextEncoder();
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const W = '0695db52-5433-7332-8000-db7fe10da375';

type Part = { path: string; data: Uint8Array };
const part = (path: string, body: unknown): Part => ({ path, data: typeof body === 'string' ? enc.encode(body) : body instanceof Uint8Array ? body : enc.encode(JSON.stringify(body)) });

/** A small world of the standard as its owner's folder: `world.json`, one file per element, the hidden marked. */
function standardFolder(w: (typeof worlds.worlds)[number]): Part[] {
  const hidden = new Set(w.hidden ?? []);
  const wb = w as { time_basic_unit?: string; now?: number };
  return [
    part('world.json', { id: w.id, name: w.name, ...(wb.time_basic_unit ? { time_basic_unit: wb.time_basic_unit } : {}), ...(wb.now !== undefined ? { time_current: wb.now } : {}) }),
    ...(w.elements as Record<string, unknown>[]).map((e) => part(`elements/${e.type}/${e.id}.json`, hidden.has(e.id as string) ? { ...e, hidden: true } : e)),
  ];
}

/** The file read's own test folder. */
const testFolder = [
  part('world.json', { id: W, name: 'Test world' }),
  part('elements/character/a.json', { id: id(1), name: 'A', type: 'location', friends: [id(2)] }),
  part('elements/character/b.json', { id: id(2), name: 'B', hidden: true }),
  part('elements/character/broken.json', '{not json'),
  part('elements/character/noid.json', { name: 'no id' }),
  part('elements/notatype/c.json', { id: id(3) }),
  part('spatial/pin/p.json', { id: id(4) }),
];

/** The played walk's folder (walk/played.mjs). */
const playedFolder = [
  part('world.json', { id: W, name: 'File world' }),
  part('elements/character/a.json', { id: id(1), name: 'Ada Vane', friends: [id(2), id(3), id(4)] }),
  part('elements/character/b.json', { id: id(2), name: 'Hidden Bram', hidden: true }),
  part('elements/character/c.json', { id: id(3), name: 'Proposed Cleo', x_review_proposed: { by: 'someone' } }),
  part('elements/narrative/d.json', { id: id(4), name: 'Room line', supertype: 'Message', x_room_of: id(50) }),
  part('elements/location/e.json', { id: id(10), name: 'Saltmere', image_url: 'https://media.onlyworlds.com/u/planted.png' }),
  part('elements/character/k.json', { id: id(11), name: 'Known Kit', known_of: true }),
];

/** The shapes the folder read guards, one file each, in one top-level folder of the picked one. */
const guarded = [
  part('world.json', { id: W, name: 'Guarded', description: 'every shape', time_basic_unit: 'Year', time_current: 'soon', time_range_current: 40, api: { api_key: 'secret' } }),
  part('records/tool/world.json', { id: id(900), name: 'a producer record' }),
  part('.atlas/world.json', { id: id(901) }),
  part('.atlas/elements/character/x.json', { id: id(902) }),
  part('.env', 'KEY=secret'),
  part('elements/character/a.json', { id: id(1), name: 'Ada', location: id(10), friends: [id(2), id(2), null], notes_extra: 'kept?', x_custom: 1 }),
  part('elements/character/b.json', { id: id(2), name: 'Bo', birth_date: 12 }),
  part('elements/character/bad.json', '{not json'),
  part('elements/character/dup.json', { id: id(2), name: 'Bo again' }),
  part('elements/character/hex.json', { id: 'abcdef00-0000-7000-8000-0000000000cc', name: 'Hex' }),
  part('elements/character/upper.json', { id: 'ABCDEF00-0000-7000-8000-0000000000CC', name: 'Hex in capitals' }),
  part('elements/character/emptyid.json', { id: '', name: 'empty id' }),
  part('elements/character/latin1.json', new Uint8Array([...enc.encode('{"id":"' + id(5) + '","name":"caf'), 0xe9, ...enc.encode('"}')])),
  part('elements/character/.dotfile.json', { id: id(6) }),
  part('elements/character/sub/deep.json', { id: id(7) }),
  part('elements/notatype/x.json', { id: id(8) }),
  part('elements/location/l.json', { id: id(10), name: 'Harrow' }),
  part('elements/location/typed.json', { id: id(11), name: 'Says character', type: 'character' }),
  part('elements/event/arr.json', '[1,2]'),
  part('elements/pin/broken.json', '{not json'),
  part('spatial/zone/z.json', { id: id(12), name: 'Legacy zone' }),
  part('elements/zone/z2.json', { id: id(13), name: 'Zone', map: id(14) }),
];

const PICKED = 'Picked';
function folders(): [string, PickedFile[]][] {
  const pick = (top: string, parts: Part[], extra: Part[] = []) =>
    [...parts.map((p) => ({ path: `${top}/${p.path}`, data: p.data })), ...extra].map((p) => ({ path: p.path, data: p.data }));
  const out: [string, { path: string; data: Uint8Array }[]][] = [];
  for (const w of worlds.worlds) out.push([`standard ${w.id} ${w.name}`, pick(w.name, standardFolder(w))]);
  out.push(['file read test folder', pick('Test world', testFolder)]);
  out.push(['played walk folder', pick('File world', playedFolder)]);
  // world.json one folder down, beside a .git folder of the picked one.
  out.push(['guarded shapes', pick(`${PICKED}/Guarded`, guarded, [part(`${PICKED}/.git/config`, '[core]')])]);
  return out.map(([k, files]) => [k, files.map((f) => ({ path: f.path, bytes: async () => f.data }))]);
}

/** What a picked folder's read opened, as the record holds it. */
function opening(files: PickedFile[]) {
  const opened: string[] = [];
  return { opened, files: files.map((f) => ({ path: f.path, bytes: async () => (opened.push(f.path), f.bytes()) })) };
}

async function hash(v: unknown): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(v)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function structure(els: Element[]) {
  const g = buildGraph(els);
  return {
    nodes: g.nodes.map((n) => `${n.type}:${n.id}`),
    edges: g.edges.map((e) => `${e.source} ${e.field}[${e.index}] ${e.target}`),
    aids: g.aids.map((a) => `${a.type}:${a.id}`),
    outside: [...g.outside.entries()].map(([k, n]) => `${k} ${n}`),
    leftOut: g.leftOut,
    held: g.held.map((h) => `${h.type}:${h.id}`),
  };
}
const bodiesOf = (els: Element[]) => Object.fromEntries([...buildGraph(els).byId.entries()].map(([k, v]) => [k, v]));

/** The folder read before the source, as it stood: the kept element files under the world's root, read as a world file's are. */
async function before(files: PickedFile[]): Promise<FileWorld> {
  const root = worldRootOf(files.map((f) => f.path));
  const world = JSON.parse(new TextDecoder().decode(await files.find((f) => f.path === `${root}world.json`)!.bytes())) as Record<string, unknown>;
  const parts: Part[] = [];
  for (const f of files) {
    if (!f.path.startsWith(root)) continue;
    const rel = f.path.slice(root.length);
    if (keptElementType(rel) !== null) parts.push({ path: rel, data: await f.bytes() });
  }
  return fromEntries(world, parts);
}

async function recordOf(w: FileWorld, opened: string[]) {
  const s = structure(w.elements);
  return {
    opened: [...opened].sort(),
    name: w.name,
    description: w.description,
    time: w.time,
    unreadable: w.unreadable,
    elements: w.elements.length,
    nodes: s.nodes.length,
    edges: s.edges.length,
    structure: await hash(s),
    bodies: await hash(bodiesOf(w.elements)),
  };
}

const empty = (v: unknown) => v === '' || v === null || (Array.isArray(v) && v.length === 0);

/** Every way the read now differs from the read before, one line each; an added empty field is rule A and not a line. */
function differences(a: FileWorld, b: FileWorld): string[] {
  const out: string[] = [];
  const sa = structure(a.elements);
  const sb = structure(b.elements);
  for (const key of ['nodes', 'edges', 'aids', 'outside', 'held'] as const) {
    const x = new Set(sa[key]);
    const y = new Set(sb[key]);
    for (const v of sa[key]) if (!y.has(v)) out.push(`${key} - ${v}`);
    for (const v of sb[key]) if (!x.has(v)) out.push(`${key} + ${v}`);
    if (sa[key].filter((v) => y.has(v)).join('|') !== sb[key].filter((v) => x.has(v)).join('|')) out.push(`${key} order`);
  }
  if (JSON.stringify(sa.leftOut) !== JSON.stringify(sb.leftOut)) out.push(`leftOut ${JSON.stringify(sa.leftOut)} -> ${JSON.stringify(sb.leftOut)}`);
  for (const k of ['id', 'name', 'description'] as const) if (a[k] !== b[k]) out.push(`${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`);
  if (JSON.stringify(a.time) !== JSON.stringify(b.time)) out.push(`time ${JSON.stringify(a.time)} -> ${JSON.stringify(b.time)}`);
  if (a.unreadable !== b.unreadable) out.push(`unreadable ${a.unreadable} -> ${b.unreadable}`);
  const ab = bodiesOf(a.elements);
  const bb = bodiesOf(b.elements);
  for (const [eid, x] of Object.entries(ab) as [string, Record<string, unknown>][]) {
    const y = bb[eid] as Record<string, unknown> | undefined;
    if (!y) continue;
    for (const f of Object.keys(x)) if (!(f in y)) out.push(`body ${eid} - ${f}`);
    for (const f of Object.keys(y)) if (!(f in x) && !empty(y[f])) out.push(`body ${eid} + ${f}`);
    for (const f of Object.keys(x)) if (f in y && JSON.stringify(x[f]) !== JSON.stringify(y[f])) out.push(`body ${eid} ~ ${f}`);
  }
  return out;
}

/** The differences each folder is expected to show, each with the rule that makes it. */
const HEX = 'ABCDEF00-0000-7000-8000-0000000000CC';
const EXPECTED: Record<string, [string, string][]> = {
  'standard 019a7f00-0000-7000-8000-00000000f101 Grey Harbour': [['B', 'body 019a7f00-0000-7000-8000-000000000203 ~ constructs']],
  'file read test folder': [
    ['C', `nodes - character:${id(1)}`],
    ['C', `nodes + location:${id(1)}`],
    ['C', `outside - ${id(1)} 1`],
    ['C', `held - character:${id(1)}`],
    ['C', `held + location:${id(1)}`],
    ['C', `body ${id(1)} - friends`],
    ['C', `body ${id(1)} ~ type`],
  ],
  'guarded shapes': [
    ['E', `nodes - character:${id(5)}`],
    ['C', `nodes - location:${id(11)}`],
    ['F', `nodes - character:${HEX}`],
    ['C', `nodes + character:${id(11)}`],
    ['D', `nodes + zone:${id(12)}`],
    ['E', `held - character:${id(5)}`],
    ['F', `held - character:${HEX}`],
    ['C', `held - location:${id(11)}`],
    ['C', `held + character:${id(11)}`],
    ['D', `held + zone:${id(12)}`],
    ['G', 'time {"unit":"Year","now":40} -> {"unit":"Year","now":null}'],
    ['U', 'unreadable 4 -> 6'],
    ['A', `body ${id(1)} - notes_extra`],
    ['A', `body ${id(13)} - map`],
    ['B', `body ${id(1)} ~ friends`],
    ['C', `body ${id(11)} ~ type`],
  ],
};

describe('parity of the folder read', () => {
  it('keeps the read before as it was recorded', async () => {
    const now: Record<string, unknown> = {};
    for (const [k, files] of folders()) {
      const o = opening(files);
      now[k] = await recordOf(await before(o.files), o.opened);
    }
    expect(Object.keys(now)).toHaveLength(worlds.worlds.length + 3);
    expect(now).toEqual(recorded);
  });

  it('reads every folder through the client, differing only as each rule says', async () => {
    const got: Record<string, [string, string][]> = {};
    const want: Record<string, [string, string][]> = {};
    for (const [k, files] of folders()) {
      const lines = differences(await before(files), await readWorldFolder(files));
      const expected = EXPECTED[k] ?? [];
      const rule = new Map(expected.map(([r, l]) => [l, r]));
      // In line order: which line comes first is the graph's order, held by the other tests.
      const byLine = (a: [string, string], b: [string, string]) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      got[k] = lines.map((l): [string, string] => [rule.get(l) ?? '?', l]).sort(byLine);
      want[k] = [...expected].sort(byLine);
    }
    expect(got).toEqual(want);
  });

  it('keeps the graph whole on every standard world and the played folder: only empty fields added', async () => {
    for (const [k, files] of folders()) {
      if (k === 'file read test folder' || k === 'guarded shapes') continue;
      const a = structure((await before(files)).elements);
      const b = structure((await readWorldFolder(files)).elements);
      expect(b, k).toEqual(a);
    }
  });

  it('opens only the world and its element files: no producer record, no dot folder or file, no .env, nothing outside', async () => {
    const [, files] = folders().find(([k]) => k === 'guarded shapes')!;
    const o = opening(files);
    await readWorldFolder(o.files);
    const at = (p: string) => `${PICKED}/Guarded/${p}`;
    expect(o.opened.sort()).toEqual(
      [
        'world.json',
        'elements/character/a.json',
        'elements/character/b.json',
        'elements/character/bad.json',
        'elements/character/dup.json',
        'elements/character/emptyid.json',
        'elements/character/hex.json',
        'elements/character/latin1.json',
        'elements/character/sub/deep.json',
        'elements/character/upper.json',
        'elements/event/arr.json',
        'elements/location/l.json',
        'elements/location/typed.json',
        'elements/notatype/x.json',
        'elements/pin/broken.json',
        'elements/zone/z2.json',
        'spatial/zone/z.json',
      ]
        .map(at)
        .sort(),
    );
  });

  it('reads a folder through OwV2Client', async () => {
    const getWorld = vi.spyOn(OwV2Client.prototype, 'getWorld');
    const list = vi.spyOn(OwV2Client.prototype, 'list');
    const [, files] = folders().find(([k]) => k === 'played walk folder')!;
    await readWorldFolder(files);
    expect(getWorld).toHaveBeenCalledTimes(1);
    expect(list.mock.calls.map((c) => c[0]).sort()).toEqual(['character', 'location', 'narrative']);
    vi.restoreAllMocks();
  });
});
