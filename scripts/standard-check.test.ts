import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module, no types
import { checkWorld } from './standard-check.mjs';

const W = '019a7f00-0000-7000-8000-00000000f001';
const E = '019a7f00-0000-7000-8000-000000000001';
const good = () => ({ id: W, name: 'A world', elements: [{ id: E, type: 'character' }], hidden: [E], members: [{ id: null, character: E }] });

describe('a small world before it is bundled', () => {
  it('takes a world its addresses can open', () => {
    expect(() => checkWorld('t', good())).not.toThrow();
  });
  it('refuses ids the addresses refuse, repeats, stray hidden ids and odd members', () => {
    const cases: Array<[string, (w: ReturnType<typeof good>) => void]> = [
      ['a world id that is no UUID', (w) => (w.id = 'harbour')],
      ['an element without a UUID id', (w) => (w.elements[0].id = 'e1')],
      ['seen twice', (w) => w.elements.push({ ...w.elements[0] })],
      ['no element of this world', (w) => (w.hidden = ['019a7f00-0000-7000-8000-0000000000ff'])],
      ['members is not a list', (w) => ((w as { members: unknown }).members = [{ id: 3, character: null }])],
      ['no name', (w) => (w.name = ' ')],
    ];
    for (const [word, spoil] of cases) {
      const w = good();
      spoil(w);
      expect(() => checkWorld('t', w)).toThrow(word);
    }
  });
});
