import { describe, expect, it } from 'vitest';
import { OwSignInError } from '@onlyworlds/sdk';
import {
  ALREADY_USED_LINE,
  NO_STORAGE_LINE,
  RESUME_KEY,
  SIGN_IN_RECORD_KEY,
  SIGN_IN_REDIRECT_URI,
  STALE_RECORD_MS,
  STAMP_KEY,
  beginOnlyWorldsSignIn,
  canSignInWithOnlyWorlds,
  isSignInCallback,
  resumeHashOf,
  signInCallbackLine,
  startSignInCallback,
  sweepStaleRecord,
  type RecordStore,
} from './signin';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const E = '0695db83-afd7-76ee-8000-00f4295f8866';
const TOKEN = 'ow_a_secret_token_value';

/** A storage that keeps every write it was ever given, so a test can ask what reached it. */
function recordingStore(): RecordStore & { map: Map<string, string>; writes: [string, string][] } {
  const map = new Map<string, string>();
  const writes: [string, string][] = [];
  return {
    map,
    writes,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      writes.push([k, v]);
      map.set(k, v);
    },
    remove: (k) => void map.delete(k),
  };
}

async function begin(store: RecordStore, resume: string | null = null, now = Date.now()): Promise<URL> {
  let went = '';
  await beginOnlyWorldsSignIn(resume, { store, now, navigate: (u) => (went = u) });
  return new URL(went);
}

function tokenAnswer(body: unknown = { token: TOKEN, token_id: 'tok-1', token_type: 'bearer', account: { id: 'acc-1', username: 'wren' } }, status = 200) {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { f, seen };
}

describe('the round trip', () => {
  it('is offered only on the registered origin, and knows its callback', () => {
    expect(canSignInWithOnlyWorlds('https://little-lens.onlyworlds.com')).toBe(true);
    for (const o of ['http://localhost:5173', 'https://preview.little-lens.pages.dev', 'https://little-lens.onlyworlds.com.evil.example']) expect(canSignInWithOnlyWorlds(o)).toBe(false);
    expect(isSignInCallback('/signin/callback')).toBe(true);
    expect(isSignInCallback('/signin/callback/')).toBe(true);
    expect(isSignInCallback('/')).toBe(false);
  });

  it('stamps the press before the record, and goes to keel with the registered address', async () => {
    const store = recordingStore();
    const url = await begin(store, `#/me/${W}`, 1000);
    expect(store.writes[0]).toEqual([STAMP_KEY, '1000']);
    expect(store.writes.findIndex(([k]) => k === SIGN_IN_RECORD_KEY)).toBeGreaterThan(0);
    expect(url.origin + url.pathname).toBe('https://www.onlyworlds.com/signin/authorize');
    expect(url.searchParams.get('client_id')).toBe('little-lens');
    expect(url.searchParams.get('redirect_uri')).toBe(SIGN_IN_REDIRECT_URI);
    expect(store.map.get(RESUME_KEY)).toBe(`#/me/${W}`);
  });

  it('comes back with the token in memory only: nothing written anywhere holds it', async () => {
    const store = recordingStore();
    const url = await begin(store);
    const back = `${SIGN_IN_REDIRECT_URI}?code=abc&state=${url.searchParams.get('state')}`;
    const { f, seen } = tokenAnswer();
    const out = await startSignInCallback(back, { store, fetchImpl: f });
    expect(out).toMatchObject({ ok: true, token: TOKEN, tokenId: 'tok-1', username: 'wren', resume: null });
    expect(seen).toEqual(['https://www.onlyworlds.com/api/v2/auth/token']);
    expect(store.writes.some(([k, v]) => k.includes(TOKEN) || v.includes(TOKEN))).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('hands back where the person was going, in its own shape only', async () => {
    const store = recordingStore();
    const url = await begin(store, `#/me/${W}/e/${E}`);
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=${url.searchParams.get('state')}`, { store, fetchImpl: tokenAnswer().f });
    expect(out).toMatchObject({ ok: true, resume: `#/me/${W}/e/${E}` });
    for (const bad of [`#/w/${W}`, 'javascript:alert(1)', `#/me/${W}?view=list`, `https://evil.example/#/me/${W}`, 42, null]) expect(resumeHashOf(bad)).toBeNull();
    // The time view and its moment come back too; anything after the moment does not.
    for (const good of [`#/me/${W}/time`, `#/me/${W}/time?at=300`, `#/me/${W}/time?at=-4`]) expect(resumeHashOf(good)).toBe(good);
    for (const bad of [`#/me/${W}/time?at=007`, `#/me/${W}/time?at=3&x=1`, `#/me/${W}/time/e/${E}`]) expect(resumeHashOf(bad)).toBeNull();
    // The messages and one conversation come back too.
    for (const good of [`#/me/${W}/messages`, `#/me/${W}/messages/${E}`]) expect(resumeHashOf(good)).toBe(good);
    for (const bad of [`#/me/${W}/messages/x`, `#/me/${W}/messages/${E}/e/${E}`, `#/me/${W}/messages?at=3`]) expect(resumeHashOf(bad)).toBeNull();
  });

  it('on Cancel, says so, sends nothing, and leaves no record, stamp or resume', async () => {
    const store = recordingStore();
    const url = await begin(store, `#/me/${W}`);
    const { f, seen } = tokenAnswer();
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?error=access_denied&state=${url.searchParams.get('state')}`, { store, fetchImpl: f });
    expect(out).toMatchObject({ ok: false, cancelled: true });
    expect(signInCallbackLine(out as { cancelled: boolean; error: unknown })).toBe('Sign-in cancelled: nothing changed.');
    expect(seen).toHaveLength(0);
    expect(store.map.size).toBe(0);
  });

  it('a return with no record waiting is a page revisited: nothing sent, no talk of another tab', async () => {
    const store = recordingStore();
    const { f, seen } = tokenAnswer();
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=xyz`, { store, fetchImpl: f });
    expect(out.ok).toBe(false);
    expect(seen).toHaveLength(0);
    expect(signInCallbackLine(out as { cancelled: boolean; error: unknown })).toBe(ALREADY_USED_LINE);
  });

  it('a return whose record is another round trip’s names the other tab', async () => {
    const store = recordingStore();
    await begin(store);
    const { f, seen } = tokenAnswer();
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=not-this-one`, { store, fetchImpl: f });
    expect(seen).toHaveLength(0);
    expect(signInCallbackLine(out as { cancelled: boolean; error: unknown })).toMatch(/another tab may have started one/);
  });

  it('with no storage, says so in its own words', async () => {
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=xyz`, { store: null, fetchImpl: tokenAnswer().f });
    expect(signInCallbackLine(out as { cancelled: boolean; error: unknown })).toBe(NO_STORAGE_LINE);
    await expect(beginOnlyWorldsSignIn(null, { store: null, navigate: () => {} })).rejects.toThrow(NO_STORAGE_LINE);
  });

  it('never says keel’s text: each refusal is Little Lens’s line, the 429 naming the network', async () => {
    for (const [status, body, re] of [
      [429, { error: { code: 'too_many_login_attempts', message: 'KEEL TEXT' } }, /from this network/],
      [400, { error: { code: 'invalid_grant', message: 'KEEL TEXT' } }, /may have waited too long/],
      [500, { error: { code: 'boom', message: 'KEEL TEXT' } }, /did not work/],
    ] as const) {
      const store = recordingStore();
      const url = await begin(store);
      const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=${url.searchParams.get('state')}`, { store, fetchImpl: tokenAnswer(body, status).f });
      expect(out.ok).toBe(false);
      const line = signInCallbackLine(out as { cancelled: boolean; error: unknown });
      expect(line).toMatch(re);
      expect(line).not.toContain('KEEL');
      expect(store.map.size).toBe(0);
    }
    expect(signInCallbackLine({ cancelled: false, error: new OwSignInError('offline', 'KEEL TEXT') })).not.toContain('KEEL');
  });
});

describe('a record nobody came back for', () => {
  it('is dropped when its stamp is over an hour old, or missing; a fresh one stays', () => {
    const now = 10 * STALE_RECORD_MS;
    const fresh = recordingStore();
    fresh.set(STAMP_KEY, String(now - 59 * 60 * 1000));
    fresh.set(SIGN_IN_RECORD_KEY, '{}');
    sweepStaleRecord(fresh, now);
    expect(fresh.map.has(SIGN_IN_RECORD_KEY)).toBe(true);

    const old = recordingStore();
    old.set(STAMP_KEY, String(now - STALE_RECORD_MS - 1));
    old.set(SIGN_IN_RECORD_KEY, '{}');
    old.set(RESUME_KEY, `#/me/${W}`);
    sweepStaleRecord(old, now);
    expect(old.map.size).toBe(0);

    const unstamped = recordingStore();
    unstamped.set(SIGN_IN_RECORD_KEY, '{}');
    sweepStaleRecord(unstamped, now);
    expect(unstamped.map.size).toBe(0);

    const orphanStamp = recordingStore();
    orphanStamp.set(STAMP_KEY, String(now));
    sweepStaleRecord(orphanStamp, now);
    expect(orphanStamp.map.size).toBe(0);
  });
});

describe('the source', () => {
  // Every source file of the app, tests aside, as text.
  const sources = Object.entries(import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).filter(([p]) => !p.endsWith('.test.ts'));

  it('never mints a world key: Little Lens holds one token and nothing else', () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const [, text] of sources) expect(text).not.toMatch(/mintWorldKey|createAccountWorld|\/keys\b/);
  });

  it('never puts the token in storage or a log', () => {
    const src = sources.map(([, text]) => text).join('\n');
    expect(sources.some(([p]) => p.endsWith('/main.ts'))).toBe(true);
    expect(src).not.toMatch(/sessionStorage|indexedDB|document\.cookie/);
    expect(src).not.toMatch(/console\.\w+\([^)]*token/i);
    expect(src).not.toMatch(/(setItem|set)\([^)]*\.token\b/);
  });
});
