/**
 * Parity for a picked folder: every small world of the standard written out as a folder, the
 * played folders the tests and the walk open, and one folder of the shapes the folder read guards.
 * Each is read by `readWorldFolder` as it stands and recorded (`folder.parity.json`): the files it
 * opened, the elements, the graph (its structure and its bodies), the unreadable count a person sees.
 *
 * To record again: `PARITY_RECORD=1 npx vitest run src/lens/folder.parity.test.ts` prints one
 * `PARITY {...}` line; that line's JSON is the file. `FOLDER_COMPARE=1` instead prints, per folder,
 * how a read through the SDK's folder source (`@onlyworlds/sdk/folder`) differs from the record.
 */

import { describe, expect, it } from 'vitest';
import { OwV2Client } from '@onlyworlds/sdk';
import { folderFetch, type OwFolderReadReport } from '@onlyworlds/sdk/folder';
import worlds from '../standard/worlds.json';
import recorded from './folder.parity.json';
import { readWorldFolder, worldRootOf, type PickedFile } from './file-read';
import { buildGraph, isGraphType, type Element } from './graph';
import { timeOfWorldBody } from './time';
import { PAGE_LIMIT, typesToRead } from './world-read';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
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
  part('elements/character/upper.json', { id: id(2).toUpperCase(), name: 'Bo in capitals' }),
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

async function recordOf(files: PickedFile[]) {
  const o = opening(files);
  const w = await readWorldFolder(o.files);
  const s = structure(w.elements);
  return {
    opened: o.opened.sort(),
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

/** The same folder read through the SDK's folder source: the guards first, then the client's reads. */
async function throughSource(files: PickedFile[]) {
  const root = worldRootOf(files.map((f) => f.path));
  const entries: Part[] = [];
  for (const f of files) {
    if (!f.path.startsWith(root)) continue;
    const rel = f.path.slice(root.length);
    if (rel.split('/').some((s) => s.startsWith('.'))) continue;
    if (rel !== 'world.json' && !rel.startsWith('elements/') && !rel.startsWith('spatial/')) continue;
    entries.push({ path: rel, data: await f.bytes() });
  }
  let report: OwFolderReadReport | null = null;
  const c = new OwV2Client({ fetch: folderFetch(entries, { onRead: (r) => (report = r) }) });
  const body = (await c.getWorld()) as unknown as Record<string, unknown>;
  const types = (body.counts as { types?: Record<string, number> } | undefined)?.types ?? null;
  const counts: Record<string, number> | null = types ? Object.fromEntries(Object.entries(types).filter(([, n]) => n > 0)) : null;
  const out = new Map<string, Element>();
  for (const type of typesToRead(counts)) {
    let cursor: string | undefined;
    for (;;) {
      const page = await c.list(type, { limit: PAGE_LIMIT, cursor });
      for (const r of page.data) out.set(r.id as string, { ...(r as object), type } as Element);
      if (!page.has_more || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
  }
  const els = [...out.values()];
  const r = report as OwFolderReadReport | null;
  return { name: typeof body.name === 'string' && body.name ? body.name : 'Untitled world', description: typeof body.description === 'string' ? body.description : '', time: timeOfWorldBody(body), els, report: r };
}

describe('parity of the folder read', () => {
  it('reads every folder into the same record', async () => {
    const now: Record<string, unknown> = {};
    for (const [k, files] of folders()) now[k] = await recordOf(files);
    if (env.PARITY_RECORD) console.log(`PARITY ${JSON.stringify(now)}`);
    expect(Object.keys(now)).toHaveLength(worlds.worlds.length + 3);
    expect(now).toEqual(recorded);
  });

  it.runIf(!!env.FOLDER_COMPARE)('prints how the folder source differs from the record', async () => {
    const lines: string[] = [];
    for (const [k, files] of folders()) {
      const old = await readWorldFolder(files);
      const s = await throughSource(files);
      const a = structure(old.elements);
      const b = structure(s.els);
      const diff: string[] = [];
      for (const key of ['nodes', 'edges', 'aids', 'outside', 'held'] as const) {
        const x = new Set(a[key]);
        const y = new Set(b[key]);
        const lost = [...x].filter((v) => !y.has(v));
        const got = [...y].filter((v) => !x.has(v));
        if (lost.length || got.length) diff.push(`${key}: only file-read [${lost.join('; ')}] only source [${got.join('; ')}]`);
        else if (a[key].join('|') !== b[key].join('|')) diff.push(`${key}: same set, other order`);
      }
      if (JSON.stringify(a.leftOut) !== JSON.stringify(b.leftOut)) diff.push(`leftOut ${JSON.stringify(a.leftOut)} vs ${JSON.stringify(b.leftOut)}`);
      if (old.name !== s.name || old.description !== s.description) diff.push(`name/description ${JSON.stringify([old.name, old.description])} vs ${JSON.stringify([s.name, s.description])}`);
      if (JSON.stringify(old.time) !== JSON.stringify(s.time)) diff.push(`time ${JSON.stringify(old.time)} vs ${JSON.stringify(s.time)}`);
      const skipped = s.report?.skipped ?? [];
      const keptSkips = skipped.filter((x) => isGraphType(x.path.split('/')[1]));
      if (old.unreadable !== skipped.length || old.unreadable !== keptSkips.length) diff.push(`unreadable ${old.unreadable} vs source skipped ${skipped.length} (${skipped.map((x) => `${x.path}:${x.reason}`).join(', ')}), of them in kept types ${keptSkips.length}`);
      // Bodies: what the source adds, drops or changes in each element both hold.
      const ob = bodiesOf(old.elements);
      const sb = bodiesOf(s.els);
      const added = new Set<string>();
      const dropped = new Set<string>();
      const changed = new Set<string>();
      for (const [eid, x] of Object.entries(ob)) {
        const y = sb[eid] as Record<string, unknown> | undefined;
        if (!y) continue;
        const xo = x as Record<string, unknown>;
        for (const f of Object.keys(y)) if (!(f in xo)) added.add(f);
        for (const f of Object.keys(xo)) if (!(f in y)) dropped.add(f);
        for (const f of Object.keys(xo)) if (f in y && JSON.stringify(xo[f]) !== JSON.stringify(y[f])) changed.add(`${f}: ${JSON.stringify(xo[f])} -> ${JSON.stringify(y[f])}`);
      }
      if (dropped.size) diff.push(`body fields dropped: ${[...dropped].join(', ')}`);
      if (changed.size) diff.push(`body fields changed: ${[...changed].join('; ')}`);
      if (added.size) diff.push(`body fields added (${added.size}): ${[...added].slice(0, 12).join(', ')}${added.size > 12 ? ', …' : ''}`);
      lines.push(`## ${k}: ${diff.length ? `${diff.length} differences` : 'same'}\n${diff.map((d) => `- ${d}`).join('\n')}`);
    }
    console.log(`COMPARE\n${lines.join('\n')}\nEND`);
  });
});
