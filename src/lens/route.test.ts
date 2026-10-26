import { describe, expect, it } from 'vitest';
import { parseRoute, worldHash } from './route';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const E = '0695db83-afd7-76ee-8000-00f4295f8866';

describe('parseRoute', () => {
  it('reads the ways in, a world, an element and the list', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
    expect(parseRoute(`#/w/${W}`)).toEqual({ kind: 'world', worldId: W, elementId: null, view: 'web' });
    expect(parseRoute(`#/w/${W}?view=list`)).toEqual({ kind: 'world', worldId: W, elementId: null, view: 'list' });
    expect(parseRoute(`#/w/${W}/e/${E}`)).toEqual({ kind: 'world', worldId: W, elementId: E, view: 'web' });
    expect(parseRoute('#/file')).toEqual({ kind: 'file', elementId: null, view: 'web' });
    expect(parseRoute(`#/file/e/${E}`)).toEqual({ kind: 'file', elementId: E, view: 'web' });
  });

  it('sends an id that is no id to the closed door, never to a request', () => {
    expect(parseRoute('#/w/moppetopia')).toEqual({ kind: 'closed' });
    expect(parseRoute(`#/w/${W}/e/../x`)).toEqual({ kind: 'home' });
    expect(parseRoute(`#/w/${W}/e/nope`)).toEqual({ kind: 'closed' });
  });

  it('takes any id in a file address, as the folder spec allows, and round-trips it', () => {
    expect(parseRoute('#/file/e/hand-written%20id')).toEqual({ kind: 'file', elementId: 'hand-written id', view: 'web' });
    expect(parseRoute(worldHash(null, '__proto__'))).toEqual({ kind: 'file', elementId: '__proto__', view: 'web' });
    expect(parseRoute('#/file/e/%E0%A4%A')).toEqual({ kind: 'closed' });
  });

  it('round-trips its own addresses', () => {
    for (const h of [worldHash(W), worldHash(W, E), worldHash(W, null, 'list'), worldHash(null), worldHash(null, E)]) {
      const r = parseRoute(h);
      expect(r.kind === 'world' || r.kind === 'file').toBe(true);
    }
    expect(worldHash(W, E)).toBe(`#/w/${W}/e/${E}`);
  });
});
