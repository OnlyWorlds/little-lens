/**
 * The reads on the SDK's client: every answer keel can give still comes out as the same failure,
 * and keel's budget still reaches its callback after every answer, an error's included. Each test
 * also holds that the read went through `OwV2Client`, so it says something only once it does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwV2Client } from '@onlyworlds/sdk';
import { readDraught } from './draught';
import { REQUEST_LIMIT_MS, readWorldElements, readWorldMeta, type Budget, type WorldMeta } from './world-read';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const C = '0695db83-afd7-76ee-8000-00f4295f8866';
const TOKEN = 'ow_a_tok';
const META: WorldMeta = { id: W, name: 'M', description: '', imageUrl: '', time: { unit: null, now: null, calendarNamed: undefined }, counts: { character: 1 } };

const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

let spies: { getWorld: ReturnType<typeof vi.spyOn>; list: ReturnType<typeof vi.spyOn>; draught: ReturnType<typeof vi.spyOn> };
beforeEach(() => {
  spies = {
    getWorld: vi.spyOn(OwV2Client.prototype, 'getWorld'),
    list: vi.spyOn(OwV2Client.prototype, 'list'),
    draught: vi.spyOn(OwV2Client.prototype, 'draught'),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The three reads, each on one answer. */
const reads = {
  meta: (f: typeof fetch, token: string | null = null, budget?: (b: Budget) => void) => readWorldMeta(W, f, undefined, budget, token),
  list: (f: typeof fetch, token: string | null = null, budget?: (b: Budget) => void) => readWorldElements(META, f, { onBudget: budget }, undefined, token),
  draught: (f: typeof fetch, token: string | null = null) => readDraught(W, C, 300, f, undefined, token),
};
const through = { meta: 'getWorld', list: 'list', draught: 'draught' } as const;

async function failureOf(read: keyof typeof reads, f: typeof fetch, token: string | null = null) {
  const e = await reads[read](f, token).then(
    () => null,
    (x: unknown) => x,
  );
  expect(spies[through[read]], `${read} goes through the client`).toHaveBeenCalledTimes(1);
  return (e as { failure?: unknown } | null)?.failure;
}

describe('the reads on the client: failures', () => {
  for (const read of ['meta', 'list', 'draught'] as const) {
    it(`${read}: a private, unknown or gone world is closed, with its status`, async () => {
      for (const status of [404, 410, 403, 401]) {
        vi.clearAllMocks();
        expect(await failureOf(read, answer(status, { error: { code: 'not_found' } }))).toEqual({ kind: 'closed', status });
      }
    });

    it(`${read}: signed in, a 401 is the sign-in ended, a 404 or 403 still closed`, async () => {
      expect(await failureOf(read, answer(401, { error: { code: 'key_revoked' } }), TOKEN)).toEqual({ kind: 'ended' });
      for (const status of [404, 403]) {
        vi.clearAllMocks();
        expect(await failureOf(read, answer(status), TOKEN)).toEqual({ kind: 'closed', status });
      }
    });

    it(`${read}: 429 and 503 are a wait, with Retry-After in seconds or none`, async () => {
      const cases: [number, Record<string, string>, number | null][] = [
        [429, { 'Retry-After': '17' }, 17],
        [503, { 'Retry-After': '5' }, 5],
        [429, {}, null],
        [429, { 'Retry-After': '0' }, null],
        // A date is not read as seconds, as before the client.
        [429, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }, null],
      ];
      for (const [status, headers, retryAfter] of cases) {
        vi.clearAllMocks();
        expect(await failureOf(read, answer(status, { error: { code: 'rate_limited' } }, headers))).toEqual({ kind: 'slow-down', retryAfter });
      }
    });

    it(`${read}: a dropped connection is the network`, async () => {
      const down = (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch;
      expect(await failureOf(read, down)).toEqual({ kind: 'network' });
    });

    it(`${read}: any other refusal is the server's, with its status; so is a body that is not JSON`, async () => {
      for (const status of [500, 502, 400, 422]) {
        vi.clearAllMocks();
        expect(await failureOf(read, answer(status, { error: { code: 'x' } }))).toEqual({ kind: 'server', status });
      }
      vi.clearAllMocks();
      expect(await failureOf(read, answer(200, '<html>not json'))).toEqual({ kind: 'server', status: 200 });
      vi.clearAllMocks();
      expect(await failureOf(read, (async () => new Response(null, { status: 204 })) as unknown as typeof fetch)).toEqual({ kind: 'server', status: 204 });
    });

    it(`${read}: a request past its own time limit is the network`, async () => {
      vi.useFakeTimers();
      const hang = ((_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
      const p = failureOf(read, hang);
      await vi.advanceTimersByTimeAsync(REQUEST_LIMIT_MS - 1);
      let settled = false;
      void p.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toEqual({ kind: 'network' });
    });

    it(`${read}: a refusal whose body never ends is mapped at once, as before the client`, async () => {
      vi.useFakeTimers();
      const stuck = (status: number, headers: Record<string, string>) =>
        ((_u: RequestInfo | URL, init?: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
            },
          });
          return Promise.resolve(new Response(body, { status, headers }));
        }) as typeof fetch;
      for (const [status, headers, failure] of [
        [429, { 'Retry-After': '9' }, { kind: 'slow-down', retryAfter: 9 }],
        [500, {}, { kind: 'server', status: 500 }],
      ] as const) {
        vi.clearAllMocks();
        let got: unknown = 'pending';
        void failureOf(read, stuck(status, headers)).then((f) => (got = f));
        await vi.advanceTimersByTimeAsync(1);
        expect(got).toEqual(failure);
        await vi.advanceTimersByTimeAsync(REQUEST_LIMIT_MS);
      }
    });

    it(`${read}: the caller's abort is the network`, async () => {
      const ctl = new AbortController();
      const hang = ((_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
      const run =
        read === 'meta' ? readWorldMeta(W, hang, ctl.signal) : read === 'list' ? readWorldElements(META, hang, {}, ctl.signal) : readDraught(W, C, 300, hang, ctl.signal);
      ctl.abort();
      await expect(run).rejects.toMatchObject({ failure: { kind: 'network' } });
      expect(spies[through[read]]).toHaveBeenCalledTimes(1);
    });
  }

  it('meta: an answer for another world is closed', async () => {
    expect(await failureOf('meta', answer(200, { id: C, name: 'other' }))).toEqual({ kind: 'closed' });
  });

  it('draught: a packet for another world is the server error', async () => {
    expect(await failureOf('draught', answer(200, { world: { id: C } }))).toEqual({ kind: 'server', status: 200 });
  });
});

describe('the reads on the client: the budget', () => {
  const h = (remaining: number, reset: number) => ({ 'RateLimit-Remaining': String(remaining), 'RateLimit-Reset': String(reset) });

  it('meta: reaches the callback on an answer and on a refusal, before the failure', async () => {
    const seen: Budget[] = [];
    await reads.meta(answer(200, { id: W, name: 'M' }, h(41, 30)), null, (b) => seen.push(b));
    await reads.meta(answer(429, {}, { ...h(0, 12), 'Retry-After': '12' }), null, (b) => seen.push(b)).catch(() => {});
    expect(seen).toEqual([
      { remaining: 41, reset: 30 },
      { remaining: 0, reset: 12 },
    ]);
    expect(spies.getWorld).toHaveBeenCalledTimes(2);
  });

  it('list: reaches onBudget after every page, and paces the next page by it', async () => {
    let n = 0;
    const pages = (async () => {
      n++;
      const body = n === 1 ? { data: [{ id: 'a' }], has_more: true, next_cursor: 'c2' } : { data: [{ id: 'b' }], has_more: false, next_cursor: null };
      return new Response(JSON.stringify(body), { headers: n === 1 ? h(0, 7) : h(58, 60) });
    }) as unknown as typeof fetch;
    const seen: Budget[] = [];
    const waits: number[] = [];
    const els = await readWorldElements({ ...META, counts: { character: 2000 } }, pages, { onBudget: (b) => seen.push(b), onWait: (s) => waits.push(s), sleep: async () => {} });
    expect(els.map((e) => e.id)).toEqual(['a', 'b']);
    expect(seen).toEqual([
      { remaining: 0, reset: 7 },
      { remaining: 58, reset: 60 },
    ]);
    expect(waits).toEqual([7]);
    expect(spies.list).toHaveBeenCalledTimes(2);
  });

  it('list: a budget with no headers is null, never zero', async () => {
    const seen: Budget[] = [];
    await reads.list(answer(200, { data: [], has_more: false }), null, (b) => seen.push(b));
    expect(seen).toEqual([{ remaining: null, reset: null }]);
    expect(spies.list).toHaveBeenCalledTimes(1);
  });
});

describe('the reads on the client: the wire', () => {
  it('signed out sends no header at all; signed in the bearer alone; credentials omitted; a signal of its own each', async () => {
    const sent: { heads: string[]; credentials?: string; signal?: AbortSignal }[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      const hd = new Headers(init?.headers);
      sent.push({ heads: [...hd.entries()].map(([k, v]) => `${k}: ${v}`), credentials: init?.credentials, signal: init?.signal ?? undefined });
      return new Response(JSON.stringify({ id: W, name: 'M' }));
    }) as typeof fetch;
    await readWorldMeta(W, f);
    await readWorldMeta(W, f, undefined, undefined, TOKEN);
    expect(sent.map((s) => s.heads)).toEqual([[], [`authorization: Bearer ${TOKEN}`]]);
    expect(sent.every((s) => s.credentials === 'omit')).toBe(true);
    expect(sent[0].signal).toBeDefined();
    expect(sent[0].signal).not.toBe(sent[1].signal);
    expect(spies.getWorld).toHaveBeenCalledTimes(2);
  });

  it('the draught carries the client\'s compact=false, keel\'s own default, beside the same parameters', async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL) => {
      seen.push(String(u));
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    await readDraught(W, C, 300, f).catch(() => {});
    const q = new URL(seen[0]).searchParams;
    expect([...q.keys()].sort()).toEqual(['as_of', 'budget', 'compact', 'components', 'world']);
    expect(q.get('compact')).toBe('false');
    expect(spies.draught).toHaveBeenCalledTimes(1);
  });
});
