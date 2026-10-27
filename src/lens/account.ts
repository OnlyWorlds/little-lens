/**
 * What a sign-in holds: one account token, in this page's memory only, and the worlds it can
 * open. No world key is ever minted. The token is revoked when the page is done with it.
 */

import { OwV2Client, simpleCaseFold, type OwAccountWorld } from '@onlyworlds/sdk';
import { API_BASE } from './world-read';
import { CLIENT_NAME } from './signin';

export interface SignedIn {
  token: string;
  /** The token's id, for its revoke; null from a keel that did not send one. */
  tokenId: string | null;
  username: string;
}

export const REVOKE_LIMIT_MS = 8_000;
export const LIST_LIMIT_MS = 15_000;

/**
 * `revoked`: keel took it back (2xx), or it works no more (401). `unconfirmed`: anything else, a 404,
 * a 5xx, no answer or a time-out, so it may still be live. `no-id`: nothing to send.
 */
export type RevokeOutcome = 'revoked' | 'unconfirmed' | 'no-id';

/** `DELETE /account/tokens/{id}` with the token itself as the bearer, keepalive and a time limit. */
export async function revokeToken(s: SignedIn, opts: { fetchImpl?: typeof fetch; limitMs?: number } = {}): Promise<RevokeOutcome> {
  if (!s.tokenId) return 'no-id';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.limitMs ?? REVOKE_LIMIT_MS);
  const send = (keepalive: boolean) =>
    (opts.fetchImpl ?? fetch)(`${API_BASE}/account/tokens/${encodeURIComponent(s.tokenId!)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${s.token}` },
      credentials: 'omit',
      keepalive,
      signal: ctl.signal,
    });
  try {
    let res: Response;
    try {
      res = await send(true);
    } catch (err) {
      // A browser may refuse a keepalive request that needs a preflight: once more without it.
      if (ctl.signal.aborted) throw err;
      res = await send(false);
    }
    if (res.ok || res.status === 401) return 'revoked';
    return 'unconfirmed';
  } catch {
    return 'unconfirmed';
  } finally {
    clearTimeout(timer);
  }
}

/** Owned, then shared; each A to Z by the folded name in code-unit order, then the id (the dashboard's picker). */
export function pickerOrder(worlds: OwAccountWorld[]): OwAccountWorld[] {
  const key = (w: OwAccountWorld) => simpleCaseFold(w.name ?? '');
  const rank = (w: OwAccountWorld) => (w.role === 'owner' ? 0 : 1);
  return [...worlds].sort((a, b) => rank(a) - rank(b) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `GET /account/worlds` on the token: every world the account owns or is a member of, unpaged. */
export async function listMyWorlds(s: SignedIn, opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<OwAccountWorld[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LIST_LIMIT_MS);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const limited: typeof fetch = (input, init) => (opts.fetchImpl ?? fetch)(input, { ...init, credentials: 'omit', signal: ctl.signal });
  try {
    const client = new OwV2Client({ baseUrl: API_BASE, apiKey: s.token, client: CLIENT_NAME, fetch: limited });
    return pickerOrder(await client.listAccountWorlds());
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
