import { describe, expect, it } from 'vitest';
import { resolveLens, worldGraph } from '@onlyworlds/sdk';
import { buildGraph, type Element } from './graph';
import { lensChoices, lensView } from './lenses';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const el = (n: number, type: string, extra: Record<string, unknown> = {}): Element => ({ id: id(n), type, name: `E${n}`, ...extra }) as Element;
const lens = (n: number, name: string, extra: Record<string, unknown> = {}) => el(n, 'construct', { name, supertype: 'Lens', ...extra });

// Ada (1) knows Bo (2), who lives in Haven (3); Cy (4) knows nobody. Two lenses and a plain Construct.
const world = [
  el(1, 'character', { friends: [id(2)] }),
  el(2, 'character', { location: id(3) }),
  el(3, 'location'),
  el(4, 'character'),
  lens(10, 'Zed, around Ada', { characters: [id(1)] }),
  lens(11, 'around cy', { characters: [id(4)] }),
  el(12, 'construct', { supertype: 'Engine' }),
];

describe('lensChoices', () => {
  it('lists the world\'s lenses by name, a plain Construct left out', () => {
    expect(lensChoices(buildGraph(world)).map((c) => c.name)).toEqual(['around cy', 'Zed, around Ada']);
  });

  it('leaves out a proposed or hidden lens, as the page leaves them out of the world', () => {
    const g = buildGraph([...world, lens(13, 'Doubted', { characters: [id(1)], x_review_proposed: true }), lens(14, 'Secret', { characters: [id(1)], hidden: true })]);
    expect(lensChoices(g).map((c) => c.name)).toEqual(['around cy', 'Zed, around Ada']);
  });

  it('leaves out a known-of stub of a lens, and will not read one (the gate\'s M1)', () => {
    const g = buildGraph([...world, lens(16, 'Only heard of', { known_of: true })]);
    expect(lensChoices(g).map((c) => c.name)).toEqual(['around cy', 'Zed, around Ada']);
    expect(lensView(g, id(16), null)).toBeNull();
  });

  it('has none for a world with no lenses', () => {
    expect(lensChoices(buildGraph(world.filter((e) => e.type !== 'construct')))).toEqual([]);
  });
});

describe('lensView', () => {
  it('draws exactly what the lens keeps, as resolveLens reads it over the whole world', () => {
    const g = buildGraph(world);
    const v = lensView(g, id(10), null);
    expect(v?.kind).toBe('ok');
    if (v?.kind !== 'ok') return;
    const kept = resolveLens({ elements: g.held }, id(10), { rung: 'owner' }).kept;
    expect(v.graph.nodes.map((n) => n.id).sort()).toEqual([...kept].sort());
    expect(v.graph.nodes.map((n) => n.id)).toContain(id(2));
    expect(v.graph.nodes.map((n) => n.id)).not.toContain(id(4));
  });

  it('keeps the reader\'s edges between kept elements, and every page still opens', () => {
    const g = buildGraph(world);
    const v = lensView(g, id(10), null);
    if (v?.kind !== 'ok') throw new Error('not ok');
    const want = worldGraph({ elements: g.held }, { rung: 'owner' }, { lens: id(10) }).edges.map((e) => `${e.source}>${e.field}>${e.target}`);
    expect(v.graph.edges.map((e) => `${e.source}>${e.field}>${e.target}`)).toEqual(want);
    expect(v.graph.edges.some((e) => e.source === id(1) && e.target === id(2))).toBe(true);
    expect(v.graph.byId.get(id(4))).toBeDefined();
  });

  it('reads a lens over the world, never a slice: a link out of the lens is no edge, and its target is still a page', () => {
    const g = buildGraph(world);
    const v = lensView(g, id(11), null);
    if (v?.kind !== 'ok') throw new Error(`not ok: ${v?.kind}`);
    expect(v.graph.nodes.map((n) => n.id)).toContain(id(4));
    expect(v.graph.nodes.map((n) => n.id)).not.toContain(id(1));
  });

  it('says a lens it cannot read, naming the key', () => {
    const g = buildGraph([...world, lens(15, 'Odd', { characters: [id(1)], x_lens: { depth: 'far' } })]);
    const v = lensView(g, id(15), null);
    expect(v?.kind).toBe('unreadable');
    if (v?.kind === 'unreadable') expect(v.key).toBeTruthy();
  });

  it('answers null for an id that is no lens here: the box then falls back to the whole world', () => {
    const g = buildGraph(world);
    expect(lensView(g, id(12), null)).toBeNull();
    expect(lensView(g, id(99), null)).toBeNull();
  });
});
