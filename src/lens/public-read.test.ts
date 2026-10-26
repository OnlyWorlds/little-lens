import { describe, expect, it } from 'vitest';
import { API_BASE, PublicReadError, costOf, readPublicElements, readPublicWorldMeta, typesToRead } from './public-read';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function fake(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    return hit ? hit[1]() : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, seen };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers });

describe('the public read', () => {
  it('reads only the counted element types the graph keeps, in order', () => {
    expect(typesToRead({ marker: 131, character: 23, pin: 4, zone: 1, map: 2, location: 3, nonsense: 9, event: 0 } as Record<string, number>)).toEqual(['character', 'location']);
  });

  it('follows the cursor and stops on has_more false', async () => {
    const { f, seen } = fake({
      [`${API_BASE}/character/?world=${W}&limit=1000&cursor=c2`]: json({ data: [{ id: id(3) }], has_more: false, next_cursor: null }),
      [`${API_BASE}/character/?world=${W}&limit=1000`]: json({ data: [{ id: id(1) }, { id: id(2) }], has_more: true, next_cursor: 'c2' }),
    });
    const els = await readPublicElements({ id: W, name: 'M', description: '', imageUrl: '', counts: { character: 3 } }, f);
    expect(els.map((e) => e.id)).toEqual([id(1), id(2), id(3)]);
    expect(els.every((e) => e.type === 'character')).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it('stops when a cursor comes back unchanged', async () => {
    const { f, seen } = fake({ [`${API_BASE}/character/`]: json({ data: [{ id: id(1) }], has_more: true, next_cursor: 'same' }) });
    await readPublicElements({ id: W, name: 'M', description: '', imageUrl: '', counts: { character: 1 } }, f);
    expect(seen).toHaveLength(2);
  });

  it('answers a private world, a 401 and an id mismatch with the same closed door', async () => {
    for (const r of [json({ error: 'not_found' }, 404), json({}, 401), json({ id: id(7), name: 'other' })]) {
      const { f } = fake({ [`${API_BASE}/world/`]: r });
      await expect(readPublicWorldMeta(W, f)).rejects.toMatchObject({ failure: { kind: 'closed' } });
    }
  });

  it('names a 429 with its wait, and a dropped connection as the network', async () => {
    const slow = fake({ [`${API_BASE}/world/`]: json({}, 429, { 'Retry-After': '17' }) });
    await expect(readPublicWorldMeta(W, slow.f)).rejects.toMatchObject({ failure: { kind: 'slow-down', retryAfter: 17 } });
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const e = await readPublicWorldMeta(W, down).catch((x) => x);
    expect(e).toBeInstanceOf(PublicReadError);
    expect(e.failure).toEqual({ kind: 'network' });
  });

  it('reads a 503 as a wait, like a 429', async () => {
    const busy = fake({ [`${API_BASE}/world/`]: json({}, 503, { 'Retry-After': '5' }) });
    await expect(readPublicWorldMeta(W, busy.f)).rejects.toMatchObject({ failure: { kind: 'slow-down', retryAfter: 5 } });
  });

  it('lets a later page replace an earlier copy of the same id', async () => {
    const { f } = fake({
      [`${API_BASE}/character/?world=${W}&limit=1000&cursor=c2`]: json({ data: [{ id: id(1), name: 'new' }], has_more: false, next_cursor: null }),
      [`${API_BASE}/character/?world=${W}&limit=1000`]: json({ data: [{ id: id(1), name: 'old' }], has_more: true, next_cursor: 'c2' }),
    });
    const els = await readPublicElements({ id: W, name: 'M', description: '', imageUrl: '', counts: { character: 1 } }, f);
    expect(els.map((e) => e.name)).toEqual(['new']);
  });

  it('waits out the window when the budget left is under the reads to come', async () => {
    const waits: number[] = [];
    const { f, seen } = fake({
      [`${API_BASE}/character/`]: json({ data: [], has_more: false, next_cursor: null }, 200, { 'RateLimit-Remaining': '0', 'RateLimit-Reset': '7' }),
      [`${API_BASE}/location/`]: json({ data: [], has_more: false, next_cursor: null }),
    });
    await readPublicElements({ id: W, name: 'M', description: '', imageUrl: '', counts: { character: 1, location: 1 } }, f, {
      budget: { remaining: 40, reset: 30 },
      onWait: (s) => waits.push(s),
      sleep: async () => {},
    });
    expect(waits).toEqual([7]);
    expect(seen).toHaveLength(2);
    expect(costOf({ character: 2500, location: 1, pin: 5000 })).toBe(4);
  });

  it('reads the world meta and its counts', async () => {
    const { f } = fake({ [`${API_BASE}/world/?world=${W}`]: json({ id: W, name: 'Moppetopia', description: 'd', image_url: '', counts: { total: 3, types: { character: 2, pin: 1, law: 0 } } }) });
    expect(await readPublicWorldMeta(W, f)).toEqual({ id: W, name: 'Moppetopia', description: 'd', imageUrl: '', counts: { character: 2, pin: 1 } });
  });
});
