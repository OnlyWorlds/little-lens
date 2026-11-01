import { describe, expect, it } from 'vitest';
import { worldGraph } from '@onlyworlds/sdk';
import { buildGraph, degrees, neighbourhood, type Element } from './graph';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const el = (n: number, type: string, extra: Record<string, unknown> = {}): Element => ({ id: id(n), type, name: `E${n}`, ...extra }) as Element;

describe('buildGraph', () => {
  it('draws the reader\'s edges: one per listed target, the declared x_ links too, never a text field', () => {
    const g = buildGraph([
      el(1, 'character', { location: id(2), friends: [id(3), id(3), ''], rivals: [id(3)], x_spine_depends_on: [id(2)], description: id(2) }),
      el(2, 'location'),
      el(3, 'character'),
    ]);
    expect(g.edges).toEqual([
      { source: id(1), field: 'friends', target: id(3), index: 0 },
      { source: id(1), field: 'friends', target: id(3), index: 1 },
      { source: id(1), field: 'location', target: id(2), index: 0 },
      { source: id(1), field: 'rivals', target: id(3), index: 0 },
      { source: id(1), field: 'x_spine_depends_on', target: id(2), index: 0 },
    ]);
    // Every listed id drew an edge, so nothing is "not shown".
    expect(g.outside.get(id(1))).toBeUndefined();
  });

  it('holds the edges equal to the SDK\'s worldGraph on a world with nothing the page leaves out', () => {
    const world = [
      el(1, 'character', { location: id(2), friends: [id(3)], species: [id(4)] }),
      el(2, 'location', { parent_location: id(5) }),
      el(3, 'character', { friends: [id(1)], x_lens_leads_to: [id(2)] }),
      el(4, 'species'),
      el(5, 'zone', { map: id(6) }),
      el(6, 'map'),
      el(7, 'pin', { map: id(6), element_type: 'character', element_id: id(1) }),
    ];
    const reader = worldGraph({ elements: world }, { rung: 'owner' });
    const page = buildGraph(world);
    expect(page.edges.map(({ source, field, target, index }) => ({ source, field, target, index }))).toEqual(reader.edges);
    expect(page.nodes.map((n) => n.id)).toEqual(reader.nodes.map((n) => n.id));
  });

  it('draws a Zone as a node, keeps Map, Pin and Marker out', () => {
    const g = buildGraph([el(1, 'zone'), el(2, 'map'), el(3, 'pin'), el(4, 'marker'), el(5, 'location', { zone: id(1) })]);
    expect(g.nodes.map((n) => n.type)).toEqual(['zone', 'location']);
    expect(g.byId.has(id(3))).toBe(false);
  });

  it('keeps the reading aids off the web and the list, counted, and each still opens on its own page', () => {
    const charter = el(1, 'law', { supertype: 'Charter', x_charter_of: 'world' });
    const g = buildGraph([charter, el(2, 'character')]);
    expect(g.nodes.map((n) => n.id)).toEqual([id(2)]);
    expect(g.leftOut.readingAid).toBe(1);
    expect(g.byId.get(id(1))).toBe(charter);
  });

  it('counts links to ids outside the set and draws none of them', () => {
    const g = buildGraph([el(1, 'character', { location: id(9), friends: [id(8), id(2)] }), el(2, 'character')]);
    expect(g.edges).toHaveLength(1);
    expect(g.outside.get(id(1))).toBe(2);
  });

  it('leaves out map space, hidden, proposed and room elements, and says how many', () => {
    const g = buildGraph([
      el(1, 'character', { location: id(2), friends: [id(3), id(4), id(5)] }),
      el(2, 'pin'),
      el(3, 'character', { hidden: true }),
      el(4, 'character', { x_review_proposed: { by: 'someone', on: '2026-10-26' } }),
      el(5, 'narrative', { supertype: 'Message', x_room_of: id(99) }),
      el(8, 'narrative', { supertype: 'Message' }),
      el(9, 'character', { x_review_proposed: 'yes' }),
      el(6, 'character', { hidden: false }),
      el(7, 'character', { hidden: null }),
    ]);
    // A Message without the room mark is lore and stays; a doubtful proposed mark leaves.
    expect(g.nodes.map((n) => n.id)).toEqual([id(1), id(6), id(7), id(8)]);
    expect(g.leftOut).toEqual({ hidden: 1, proposed: 2, room: 1, readingAid: 0 });
    // A link to a left-out element is no edge.
    expect(g.edges).toHaveLength(0);
  });

  it('draws no link that names another kind than its field does, and does not call it "not shown": its chip opens it', () => {
    const g = buildGraph([el(1, 'character', { location: id(2), friends: [id(3)] }), el(2, 'character'), el(3, 'location')]);
    expect(g.edges).toEqual([]);
    expect(g.outside.get(id(1))).toBeUndefined();
  });

  it('counts as not shown exactly the ids no page opens, each once per field', () => {
    const charter = el(5, 'law', { supertype: 'Charter', x_charter_of: 'world' });
    const g = buildGraph([
      el(1, 'character', { friends: [id(9), id(9)], laws: [id(5)], location: id(3) }),
      charter,
      el(3, 'location', { hidden: true }),
    ]);
    // The missing friend once (its chip shows once), the hidden location once; the charter opens.
    expect(g.outside.get(id(1))).toBe(2);
  });

  it('names the reading aids for the world page, charter first, and gives an aid its own count of what it cannot open', () => {
    const g = buildGraph([
      el(1, 'construct', { supertype: 'Domain', x_charter_of: 'world', name: 'Docks', characters: [id(4)] }),
      el(2, 'law', { supertype: 'Charter', x_charter_of: 'world', name: 'House Rules' }),
      el(3, 'construct', { supertype: 'Guide', x_charter_of: 'world', name: 'Start here' }),
      el(4, 'character', { hidden: true }),
    ]);
    expect(g.aids.map((a) => a.name)).toEqual(['House Rules', 'Start here', 'Docks']);
    expect(g.nodes).toHaveLength(0);
    expect(g.outside.get(id(1))).toBe(1);
  });

  it('leaves out a room element by either reader: a nested mark, any value but null, not a blank string', () => {
    const g = buildGraph([
      el(1, 'narrative', { supertype: 'message', extensions: { x_room_of: id(9) } }),
      el(2, 'narrative', { supertype: 'Message', x_room_of: { room: 1 } }),
      el(3, 'narrative', { supertype: ' Message ', x_room_of: '   ' }),
      el(4, 'narrative', { supertype: 'Message', x_room_of: null }),
    ]);
    // A blank mark is no mark for either reader since SDK 4.111 (it once held the older SDK's room).
    expect(g.leftOut.room).toBe(2);
    expect(g.nodes.map((n) => n.id)).toEqual([id(3), id(4)]);
  });

  it('gives the same order whatever order the elements came in', () => {
    const a = [el(3, 'character', { friends: [id(2), id(1)] }), el(1, 'character', { friends: [id(3)] }), el(2, 'location')];
    const b = [...a].reverse();
    expect(buildGraph(a).edges).toEqual(buildGraph(b).edges);
    expect(buildGraph(a).nodes.map((n) => n.id)).toEqual([id(1), id(2), id(3)]);
  });

  it('keeps a Relation as a node with an edge per field', () => {
    const g = buildGraph([el(1, 'relation', { actor: id(2), characters: [id(2), id(3)] }), el(2, 'character'), el(3, 'character')]);
    expect(g.nodes).toHaveLength(3);
    expect(g.edges.map((e) => e.field)).toEqual(['actor', 'characters', 'characters']);
  });

  it('counts degree and neighbours by element, each once per side', () => {
    const g = buildGraph([el(1, 'relation', { actor: id(2), characters: [id(2)] }), el(2, 'character', { rivals: [id(3)] }), el(3, 'character', { friends: [id(2)] })]);
    expect(degrees(g).get(id(1))).toBe(2);
    expect(degrees(g).get(id(2))).toBe(4);
    const n = neighbourhood(g, id(2));
    expect(n.out.map((e) => e.id)).toEqual([id(3)]);
    expect(n.in.map((e) => e.id)).toEqual([id(1), id(3)]);
  });
});
