import { describe, expect, it } from 'vitest';
import { buildGraph, degrees, neighbourhood, type Element } from './graph';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const el = (n: number, type: string, extra: Record<string, unknown> = {}): Element => ({ id: id(n), type, name: `E${n}`, ...extra }) as Element;

describe('buildGraph', () => {
  it('makes one edge per element, field and target from the schema link fields only', () => {
    const g = buildGraph([
      el(1, 'character', { location: id(2), friends: [id(3), id(3), ''], rivals: [id(3)], x_spine_depends_on: [id(2)], description: id(2) }),
      el(2, 'location'),
      el(3, 'character'),
    ]);
    expect(g.edges).toEqual([
      { source: id(1), field: 'friends', target: id(3) },
      { source: id(1), field: 'location', target: id(2) },
      { source: id(1), field: 'rivals', target: id(3) },
    ]);
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
    expect(g.leftOut).toEqual({ hidden: 1, proposed: 2, room: 1 });
    // A link to a left-out element is no edge.
    expect(g.edges).toHaveLength(0);
  });

  it('draws no link that names another kind than its field does, and counts it as not shown', () => {
    const g = buildGraph([el(1, 'character', { location: id(2), friends: [id(3)] }), el(2, 'character'), el(3, 'location')]);
    expect(g.edges).toEqual([]);
    expect(g.outside.get(id(1))).toBe(2);
  });

  it('leaves out a room element by either reader: a nested mark, any value but null, not a blank string', () => {
    const g = buildGraph([
      el(1, 'narrative', { supertype: 'message', extensions: { x_room_of: id(9) } }),
      el(2, 'narrative', { supertype: 'Message', x_room_of: { room: 1 } }),
      el(3, 'narrative', { supertype: ' Message ', x_room_of: '   ' }),
      el(4, 'narrative', { supertype: 'Message', x_room_of: null }),
    ]);
    expect(g.leftOut.room).toBe(3);
    expect(g.nodes.map((n) => n.id)).toEqual([id(4)]);
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
