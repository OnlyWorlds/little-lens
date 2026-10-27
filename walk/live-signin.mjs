// Sign in with OnlyWorlds read live on little-lens.onlyworlds.com against real keel. An account,
// signed in on onlyworlds.com by its own form, presses Sign in with OnlyWorlds, takes the consent
// page if it is shown, lands on its worlds, opens one it owns and signs out: the token reads back
// 401. A second sign-in must skip the consent page (consent outlives the last token), and leaving
// the page must revoke its token (401). Each exchange's expires_at is read against a six-hour lifetime.
// `--expect-old` is the control on a build without the button.
// Every token this run makes is recorded by id and taken back at the end, a throw included;
// credentials and tokens are never printed. Claim the account in its room first.
//   CREW_WALK_ACCOUNTS=<file> WORLD="<a world the account owns>" node walk/live-signin.mjs [chromium|firefox] [--expect-old] [--account crew-walk-b]
import fs from 'node:fs';
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';

const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const expectOld = process.argv.includes('--expect-old');
const accountArg = process.argv.indexOf('--account');
const account = accountArg > 0 ? process.argv[accountArg + 1] : 'crew-walk-b';
const tag = `live-${engineName}${expectOld ? '-old' : ''}`;
const LENS = process.env.LENS ?? 'https://little-lens.onlyworlds.com';
const API = 'https://www.onlyworlds.com/api/v2';
const WORLD = process.env.WORLD;
if (!WORLD) throw new Error('WORLD names a world the account owns');
const lines = fs.readFileSync(process.env.CREW_WALK_ACCOUNTS, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith(`${account} `) && l.includes('@')).trim().split(/\s+/);
let failures = 0;
const check = (ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
// Each request makes its own limit; one signal made at the start would abort every later fetch.
const limited = (ms) => (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
const status = async (url, headers) => (await fetch(url, { headers, signal: AbortSignal.timeout(20000) })).status;
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// 0. The walk's own token, recorded first, and the world by name.
const walk = await new OwV2Client({ client: 'little-lens-walk', fetch: limited(20000) }).signInWithPassword({ email, password, tokenName: 'little lens walk S496' });
const acct = async (method, path) => {
  const r = await fetch(`${API}${path}`, { method, headers: bearer(walk.token), signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const worldId = ((await acct('GET', '/account/worlds')).body?.data ?? []).find((w) => w.name === WORLD && w.role === 'owner')?.id;
if (!worldId) throw new Error(`${account} owns no "${WORLD}"`);
const made = { tokens: [] };

const browser = await (engineName === 'firefox' ? firefox : chromium).launch();
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  await browser.close().catch(() => {});
  for (const id of made.tokens) await acct('DELETE', `/account/tokens/${id}`).catch(() => {});
  console.log(`[${tag}] cleanup: ${made.tokens.length} token(s) taken back by id`);
  await acct('DELETE', `/account/tokens/${walk.id}`);
  console.log(`[${tag}] the walk's own token reads back ${await status(`${API}/account`, bearer(walk.token))}`);
};
process.on('uncaughtException', async (e) => {
  console.log(`[${tag}] aborted: ${String(e?.message ?? e).split('\n')[0]}`);
  await cleanup();
  process.exit(1);
});
const watchdog = setTimeout(async () => {
  console.log(`[${tag}] aborted: past 5 minutes`);
  await cleanup();
  process.exit(1);
}, 300_000);
const finish = async () => {
  clearTimeout(watchdog);
  await cleanup();
  console.log(failures ? `\n${failures} FAILED` : '\nall ok');
  process.exit(failures ? 1 : 0);
};

const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const errors = [];
// The tokens Little Lens receives, read off the exchange's answer by id (the value stays in memory, unprinted).
const exchanged = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', async (r) => {
    if (!r.url().startsWith(`${API}/auth/token`) || r.request().method() !== 'POST') return;
    const b = await r.json().catch(() => null);
    if (b?.token_id) {
      exchanged.push({ token: b.token, id: b.token_id, expiresAt: b.expires_at ?? null, at: Date.now() });
      made.tokens.push(b.token_id);
    }
  });
};
let page = await ctx.newPage();
watch(page);

// 1. Signed in on the site by its own form.
await page.goto('https://www.onlyworlds.com/accounts/login/');
await page.fill('input[name="login"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }), page.locator('form button[type="submit"]').first().click()]);

// 2. Little Lens's ways in.
await page.goto(`${LENS}/`);
await page.getByRole('heading', { name: 'Little Lens' }).waitFor({ timeout: 20000 });
const button = page.getByRole('button', { name: 'Sign in with OnlyWorlds' });
if (expectOld) {
  check((await button.count()) === 0, 'the old build offers no sign-in (control)');
  check(errors.length === 0, `no page error (${errors.slice(0, 2).join(' | ')})`);
  await finish();
}
check((await button.count()) === 1, 'the ways in offer Sign in with OnlyWorlds');

async function signIn(n) {
  await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
  await page.waitForURL((u) => u.hostname === 'www.onlyworlds.com' || (u.hostname === new URL(LENS).hostname && u.pathname === '/'), { timeout: 30000 });
  const consent = page.locator('button[name="decision"][value="continue"]');
  const shown = await consent.waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (shown) {
    await page.screenshot({ path: `${process.env.SHOTS ?? '.'}/${tag}-consent-${n}.png` }).catch(() => {});
    await consent.click();
  }
  console.log(`[${tag}] sign-in ${n}: consent page ${shown ? 'shown, Continue pressed' : 'not shown'}`);
  const landed = await page.getByText('Signed in as').waitFor({ timeout: 30000 }).then(() => true, () => false);
  return { shown, landed };
}
const lifetime = (x) => (x?.expiresAt ? (Date.parse(x.expiresAt) - x.at) / 3_600_000 : null);

// 3. The first sign-in: who, the worlds, one opened.
const first = await signIn(1);
check(first.landed, 'back on the ways in, signed in as the account');
check(new URL(page.url()).pathname === '/', `the address left the callback (${page.url()})`);
check(exchanged.length === 1, 'one exchange, its token recorded by id');
const h1 = lifetime(exchanged[0]);
check(h1 !== null && h1 > 5.9 && h1 <= 6.01, `the token's lifetime is six hours (expires_at ${exchanged[0]?.expiresAt ?? 'absent'}, ${h1?.toFixed(3)} h)`);
const mine = page.getByRole('list', { name: 'Your worlds' }).getByRole('link', { name: new RegExp(`^${WORLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*yours$`) });
await mine.waitFor({ timeout: 30000 });
await page.screenshot({ path: `${process.env.SHOTS ?? '.'}/${tag}-worlds.png` }).catch(() => {});
await mine.click();
check(await page.locator('.wsub', { hasText: 'signed in as' }).waitFor({ timeout: 30000 }).then(() => true, () => false), 'the world opens, read as the account');
check(page.url().includes(`#/me/${worldId}`), 'at #/me/<world id>');
await page.screenshot({ path: `${process.env.SHOTS ?? '.'}/${tag}-world.png` }).catch(() => {});

// 4. Sign out: the token is removed.
await page.goto(`${LENS}/#/`);
await page.getByRole('button', { name: 'Sign out' }).click();
check(await page.getByText('Signed out, and the sign-in is removed from your OnlyWorlds account.').waitFor({ timeout: 20000 }).then(() => true, () => false), 'Sign out says the sign-in is removed');
check((await status(`${API}/account`, bearer(exchanged[0].token))) === 401, 'the first token reads back 401');

// 5. A second sign-in skips the consent page; leaving the page revokes its token.
await page.goto(`${LENS}/`);
const second = await signIn(2);
check(second.landed, 'the second sign-in lands signed in');
check(!second.shown, 'the second sign-in shows no consent page (consent outlives the last token)');
check(exchanged.length === 2, 'a second exchange, recorded');
await page.goto('https://www.onlyworlds.com/');
await page.waitForTimeout(3000);
check((await status(`${API}/account`, bearer(exchanged[1].token))) === 401, 'leaving the page: the second token reads back 401');

// 6. A third sign-in, then the tab closed: reported, not asserted (Firefox may drop the revoke; the lifetime covers it).
await page.goto(`${LENS}/`);
const third = await signIn(3);
check(third.landed && exchanged.length === 3, 'the third sign-in lands signed in');
await page.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 3000));
console.log(`[${tag}] after a tab close the third token reads ${await status(`${API}/account`, bearer(exchanged[2].token))} (taken back by id in the cleanup)`);

check(errors.length === 0, `no page error (${errors.slice(0, 2).join(' | ')})`);
await finish();
