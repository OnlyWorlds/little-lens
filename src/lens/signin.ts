/**
 * Sign in with OnlyWorlds, as the other OnlyWorlds tools do it. The SDK's two calls: `signInWithOnlyWorlds` sends the browser
 * to onlyworlds.com with a PKCE challenge, `completeSignIn` trades the code on `/signin/callback`.
 * Only the round trip's record is stored, and only across the redirect; the token lives in the
 * page's memory and nowhere else.
 */

import { OwSignInError, OwV2Client } from '@onlyworlds/sdk';
import { API_BASE } from './world-read';

/** keel's registry (`GET /api/v2/auth/clients`) lists `little-lens` with exactly this address. */
export const SIGN_IN_CLIENT_ID = 'little-lens';
export const SIGN_IN_REDIRECT_URI = 'https://little-lens.onlyworlds.com/signin/callback';
export const SIGN_IN_CALLBACK_PATH = '/signin/callback';
const SIGN_IN_ORIGIN = new URL(SIGN_IN_REDIRECT_URI).origin;
export const CLIENT_NAME = 'little-lens';
export const SIGN_IN_EXCHANGE_LIMIT_MS = 20_000;
/** Where the callback page goes while the exchange runs. */
export const SIGNING_IN_HASH = '#/signing-in';
/** The SDK's record (`ow_signin:` and the client id), the press time beside it, and where the person was going. */
export const SIGN_IN_RECORD_KEY = `ow_signin:${SIGN_IN_CLIENT_ID}`;
export const STAMP_KEY = 'little-lens.signin.at';
export const RESUME_KEY = 'little-lens.signin.resume';
/**
 * A record older than this, or one with no stamp, is a round trip nobody came back from (they left
 * at the consent page). An hour, since a sign-up that waits on a confirmation mail takes longer than
 * ten minutes. Never applied on the callback, where the SDK consumes the record.
 */
export const STALE_RECORD_MS = 60 * 60 * 1000;

/** Offered only on the registered origin: anywhere else the return would land on another origin's storage. */
export function canSignInWithOnlyWorlds(origin: string = globalThis.location?.origin ?? ''): boolean {
  return origin === SIGN_IN_ORIGIN;
}

export function isSignInCallback(pathname: string = globalThis.location?.pathname ?? ''): boolean {
  return pathname.replace(/\/$/, '') === SIGN_IN_CALLBACK_PATH;
}

export type RecordStore = { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };

/** The record lives in localStorage: the round trip leaves the tab through another origin. */
export function recordStore(): RecordStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: (k) => ls.removeItem(k) };
  } catch {
    return null;
  }
}

/** Every key of the round trip gone: the SDK's record, the stamp, the resume. */
export function dropSignInRecord(store: RecordStore | null = recordStore()): void {
  try {
    store?.remove(SIGN_IN_RECORD_KEY);
    store?.remove(STAMP_KEY);
    store?.remove(RESUME_KEY);
  } catch {
    /* no storage, no record */
  }
}

/** On a load that is not the callback: a record nobody came back for is dropped. */
export function sweepStaleRecord(store: RecordStore | null = recordStore(), now: number = Date.now()): void {
  if (!store) return;
  try {
    if (store.get(SIGN_IN_RECORD_KEY) === null) {
      store.remove(STAMP_KEY);
      store.remove(RESUME_KEY);
      return;
    }
    const at = Number(store.get(STAMP_KEY));
    if (!Number.isFinite(at) || at <= 0 || now - at > STALE_RECORD_MS || at > now + 60_000) dropSignInRecord(store);
  } catch {
    /* no storage, no record */
  }
}

/** Only what Little Lens itself would write: a signed-in world's address, an element in one, its draught or its time view, each at a moment. */
export function resumeHashOf(raw: unknown): string | null {
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const at = '(\\?at=(0|-?[1-9]\\d{0,9}))?';
  return typeof raw === 'string' && new RegExp(`^#/me/${id}(/e/${id}(/draught${at})?|/time${at}|/messages(/${id})?)?$`, 'i').test(raw) ? raw : null;
}

export const NEEDS_CONNECTION_LINE = 'Signing in needs a connection. Check yours and try again.';
export const NO_STORAGE_LINE = 'This browser keeps no storage for Little Lens, so the sign-in could not come back here. Open Little Lens in a normal window and try again.';

/** Send the browser to onlyworlds.com. Throws, in Little Lens's words, when it cannot leave. */
export async function beginOnlyWorldsSignIn(resumeHash: string | null, opts: { navigate?: (url: string) => void; store?: RecordStore | null; now?: number } = {}): Promise<void> {
  if (globalThis.navigator?.onLine === false) throw new Error(NEEDS_CONNECTION_LINE);
  const storage = opts.store === undefined ? recordStore() : opts.store;
  if (!storage) throw new Error(NO_STORAGE_LINE);
  const hash = resumeHashOf(resumeHash);
  try {
    // The stamp goes first, so a record never exists without one.
    storage.set(STAMP_KEY, String(opts.now ?? Date.now()));
    if (hash) storage.set(RESUME_KEY, hash);
    else storage.remove(RESUME_KEY);
  } catch {
    throw new Error(NO_STORAGE_LINE);
  }
  await new OwV2Client({ baseUrl: API_BASE, client: CLIENT_NAME }).signInWithOnlyWorlds({
    clientId: SIGN_IN_CLIENT_ID,
    redirectUri: SIGN_IN_REDIRECT_URI,
    storage,
    ...(opts.navigate ? { navigate: opts.navigate } : {}),
  });
}

export type SignInOutcome =
  | { ok: true; token: string; tokenId: string | null; username: string; resume: string | null }
  | { ok: false; cancelled: boolean; error: unknown };

class NoStorage extends Error {}
/** A return with no round trip waiting here: a page revisited, not a refusal. */
export class AlreadyUsed extends Error {}
export const ALREADY_USED_LINE = 'That sign-in is no longer waiting here: it was used, or a newer one took its place. Press Sign in with OnlyWorlds to sign in again.';

/**
 * On `/signin/callback`, at module load, before any other request to onlyworlds.com: the SDK takes
 * `code` and `state` out of the address before its first await, and this sets the address to
 * `/#/signing-in` before returning, so the router never reads the callback's own address. The
 * stamp and the resume go on every return, whatever the outcome.
 */
export function startSignInCallback(href: string = location.href, opts: { fetchImpl?: typeof fetch; store?: RecordStore | null } = {}): Promise<SignInOutcome> {
  const cancelled = new URL(href).searchParams.get('error') === 'access_denied';
  const storage = opts.store === undefined ? recordStore() : opts.store;
  let resume: string | null = null;
  try {
    resume = resumeHashOf(storage?.get(RESUME_KEY));
  } catch {
    /* no storage, no resume */
  }
  // Whether a round trip is waiting at all: with none, this is a return already used (Back into
  // keel's authorize page sends a fresh code to a record long consumed), not another tab's.
  let waiting = false;
  try {
    waiting = (storage?.get(SIGN_IN_RECORD_KEY) ?? null) !== null;
  } catch {
    /* no storage: NoStorage below */
  }
  // The limit spans the whole exchange, its answer's body too.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SIGN_IN_EXCHANGE_LIMIT_MS);
  const limited: typeof fetch = (input, init) => (opts.fetchImpl ?? fetch)(input, { ...init, signal: ctl.signal });
  const client = new OwV2Client({ baseUrl: API_BASE, client: CLIENT_NAME, fetch: limited });
  const pending = (storage ? client.completeSignIn({ clientId: SIGN_IN_CLIENT_ID, url: href, storage }) : Promise.reject(new NoStorage('no storage'))).finally(() => {
    clearTimeout(timer);
    dropSignInRecord(storage);
  });
  try {
    globalThis.history?.replaceState(null, '', `/${SIGNING_IN_HASH}`);
  } catch {
    /* the address stays; the router waits for the outcome anyway */
  }
  return pending.then(
    (r): SignInOutcome => ({ ok: true, token: r.token, tokenId: r.tokenId, username: r.account.username, resume }),
    (error: unknown): SignInOutcome => ({
      ok: false,
      cancelled,
      error: storage && !waiting && !cancelled && error instanceof OwSignInError && error.reason === 'state_mismatch' ? new AlreadyUsed('no record waiting') : error,
    }),
  );
}

/** What to tell the person when the round trip did not sign them in. Never keel's text. */
export function signInCallbackLine(outcome: { cancelled: boolean; error: unknown }): string {
  if (outcome.cancelled) return 'Sign-in cancelled: nothing changed.';
  const err = outcome.error;
  if (err instanceof NoStorage) return NO_STORAGE_LINE;
  if (err instanceof AlreadyUsed) return ALREADY_USED_LINE;
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'state_mismatch':
        return 'Little Lens could not match that sign-in to one waiting here (another tab may have started one). Press Sign in with OnlyWorlds again.';
      case 'invalid_grant':
        return 'OnlyWorlds did not take that sign-in: it may have waited too long. Press Sign in with OnlyWorlds again.';
      case 'rate_limited':
        return 'Too many sign-ins from this network in a short time: OnlyWorlds counts every sign-in from one address together. Try again in a few minutes.';
      case 'offline':
        return 'OnlyWorlds could not be reached, so the sign-in did not finish. Check your connection and try again.';
      default:
        break;
    }
  }
  return 'Signing in with OnlyWorlds did not work. Try again in a moment.';
}
