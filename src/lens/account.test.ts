import { describe, expect, it } from 'vitest';
import type { OwAccountWorld } from '@onlyworlds/sdk';
import { listMyWorlds, pickerOrder, revokeToken } from './account';

const S = { token: 'ow_a_tok', tokenId: 'tok-1', username: 'wren' };

function answering(status: number | 'throw', body: unknown = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (status === 'throw') throw new TypeError('Failed to fetch');
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, calls };
}

describe('the revoke', () => {
  it('deletes the token by its id, the token itself the bearer, keepalive', async () => {
    const { f, calls } = answering(204);
    expect(await revokeToken(S, { fetchImpl: f })).toBe('revoked');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://www.onlyworlds.com/api/v2/account/tokens/tok-1');
    expect(calls[0].init?.method).toBe('DELETE');
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer ow_a_tok');
    expect(calls[0].init?.keepalive).toBe(true);
    expect(calls[0].init?.credentials).toBe('omit');
  });

  it('reads 401 as gone, and a 404, a 5xx or no answer as unconfirmed (it may be live)', async () => {
    expect(await revokeToken(S, { fetchImpl: answering(401).f })).toBe('revoked');
    for (const s of [404, 500, 503] as const) expect(await revokeToken(S, { fetchImpl: answering(s).f })).toBe('unconfirmed');
    expect(await revokeToken(S, { fetchImpl: answering('throw').f })).toBe('unconfirmed');
  });

  it('sends once more without keepalive when a browser refuses it', async () => {
    let n = 0;
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      n++;
      if (init?.keepalive) throw new TypeError('keepalive refused');
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    expect(await revokeToken(S, { fetchImpl: f })).toBe('revoked');
    expect(n).toBe(2);
  });

  it('with no token id, sends nothing', async () => {
    const { f, calls } = answering(204);
    expect(await revokeToken({ ...S, tokenId: null }, { fetchImpl: f })).toBe('no-id');
    expect(calls).toHaveLength(0);
  });

  it('gives up at its time limit', async () => {
    const f = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    expect(await revokeToken(S, { fetchImpl: f, limitMs: 20 })).toBe('unconfirmed');
  });
});

describe('the picker', () => {
  const w = (name: string, role: 'owner' | 'collaborator', id: string): OwAccountWorld => ({ id, name, role, public_read: false, keys: [] });

  it('lists owned worlds, then shared, each A to Z by folded name, then id', () => {
    const got = pickerOrder([w('beta', 'collaborator', '3'), w('Zed', 'owner', '2'), w('alpha', 'owner', '1'), w('Alpha', 'owner', '0'), w('Ärger', 'collaborator', '4')]);
    expect(got.map((x) => x.id)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('reads /account/worlds on the token, no cookie sent', async () => {
    const { f, calls } = answering(200, { data: [w('b', 'owner', '2'), w('a', 'owner', '1')] });
    const got = await listMyWorlds(S, { fetchImpl: f });
    expect(got.map((x) => x.id)).toEqual(['1', '2']);
    expect(calls[0].url).toBe('https://www.onlyworlds.com/api/v2/account/worlds');
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer ow_a_tok');
    expect(calls[0].init?.credentials).toBe('omit');
  });

  it('lets a 401 through as an API error with its status, for the sign-in to end', async () => {
    const { f } = answering(401, { error: { code: 'key_revoked', message: 'revoked' } });
    await expect(listMyWorlds(S, { fetchImpl: f })).rejects.toMatchObject({ status: 401 });
  });
});
