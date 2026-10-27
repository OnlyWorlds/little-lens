import { describe, expect, it } from 'vitest';
import { parseRoute, worldHash } from './route';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const E = '0695db83-afd7-76ee-8000-00f4295f8866';

describe('parseRoute', () => {
  it('reads the ways in, a world, an element and the list', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
    expect(parseRoute(`#/w/${W}`)).toEqual({ kind: 'world', reader: 'public', worldId: W, elementId: null, view: 'web' });
    expect(parseRoute(`#/w/${W}?view=list`)).toEqual({ kind: 'world', reader: 'public', worldId: W, elementId: null, view: 'list' });
    expect(parseRoute(`#/w/${W}/e/${E}`)).toEqual({ kind: 'world', reader: 'public', worldId: W, elementId: E, view: 'web' });
    expect(parseRoute('#/file')).toEqual({ kind: 'file', elementId: null, view: 'web' });
    expect(parseRoute(`#/file/e/${E}`)).toEqual({ kind: 'file', elementId: E, view: 'web' });
  });

  it('reads a signed-in world under #/me/, never as a public one', () => {
    expect(parseRoute(`#/me/${W}`)).toEqual({ kind: 'world', reader: 'me', worldId: W, elementId: null, view: 'web' });
    expect(parseRoute(`#/me/${W}/e/${E}`)).toEqual({ kind: 'world', reader: 'me', worldId: W, elementId: E, view: 'web' });
    expect(parseRoute('#/me/nope')).toEqual({ kind: 'closed' });
    expect(parseRoute('#/me')).toEqual({ kind: 'home' });
    expect(parseRoute('#/signing-in')).toEqual({ kind: 'home' });
  });

  it('sends an id that is no id to the closed door, never to a request', () => {
    expect(parseRoute('#/w/moppetopia')).toEqual({ kind: 'closed' });
    expect(parseRoute(`#/w/${W}/e/../x`)).toEqual({ kind: 'home' });
    expect(parseRoute(`#/w/${W}/e/nope`)).toEqual({ kind: 'closed' });
  });

  it('takes any id in a file address, as the folder spec allows, and round-trips it', () => {
    expect(parseRoute('#/file/e/hand-written%20id')).toEqual({ kind: 'file', elementId: 'hand-written id', view: 'web' });
    expect(parseRoute(worldHash('file', null, '__proto__'))).toEqual({ kind: 'file', elementId: '__proto__', view: 'web' });
    expect(parseRoute('#/file/e/%E0%A4%A')).toEqual({ kind: 'closed' });
  });

  it('round-trips its own addresses, each under its own reader', () => {
    for (const reader of ['public', 'me'] as const) {
      for (const h of [worldHash(reader, W), worldHash(reader, W, E), worldHash(reader, W, null, 'list')]) {
        const r = parseRoute(h);
        expect(r.kind === 'world' && r.reader === reader && r.worldId === W).toBe(true);
      }
    }
    for (const h of [worldHash('file', null), worldHash('file', null, E)]) expect(parseRoute(h).kind).toBe('file');
    expect(worldHash('public', W, E)).toBe(`#/w/${W}/e/${E}`);
    expect(worldHash('me', W, E)).toBe(`#/me/${W}/e/${E}`);
  });
});
