// The draught at a date, signed in, read live on a host against real keel. crew-walk-b owns a kept,
// empty test world; this walk makes a Character born at 100 and an Event at 300 that names her
// (through a world key it mints), signs in to Little Lens by Sign in with OnlyWorlds, opens her
// draught at 200 (the Event dated after) and at the world's top, copies it, and signs out. Every
// element, key and token it makes is recorded by id and taken back at the end, a throw included;
// credentials, keys and tokens are never printed. Claim the account in its room first.
//   CREW_WALK_ACCOUNTS=<file> WORLD="<a world the account owns>" node walk/live-draught-signin.mjs [chromium|firefox] [--expect-old] [--phone]
import fs from 'node:fs';
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';

const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const expectOld = process.argv.includes('--expect-old');
const phone = process.argv.includes('--phone');
const tag = `draught-live-${engineName}${phone ? '-390' : ''}${expectOld ? '-old' : ''}`;
const LENS = process.env.LENS ?? 'https://little-lens.onlyworlds.com';
const API = 'https://www.onlyworlds.com/api/v2';
const WORLD = process.env.WORLD;
if (!WORLD) throw new Error('WORLD names a world the account owns');
const lines = fs.readFileSync(process.env.CREW_WALK_ACCOUNTS, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
const pin = (lines.find((l) => l.startsWith('crew-walk-b PIN ')) ?? '').trim().split(/\s+/)[2] ?? '';
let failures = 0;
const check = (ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const status = async (url, headers) => (await fetch(url, { headers, signal: AbortSignal.timeout(20000) })).status;
// Each request makes its own limit; one signal made at the start would abort every later fetch.
const limited = (ms) => (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(ms) });

const walk = await new OwV2Client({ client: 'little-lens-walk', fetch: limited(20000) }).signInWithPassword({ email, password, tokenName: 'little lens draught walk S514' });
const acct = async (method, path) => {
  const r = await fetch(`${API}${path}`, { method, headers: bearer(walk.token), signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const made = { tokens: [], elements: [], key: null };
let browser = null;
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  await browser?.close().catch(() => {});
  if (made.key) {
    const owner = new OwV2Client({ apiKey: made.key.key, apiPin: pin, fetch: limited(20000) });
    for (const el of [...made.elements].reverse()) await owner.delete(el.type, el.id).catch((e) => console.log(`[${tag}] delete ${el.type}: ${String(e?.status ?? e)}`));
    for (const el of made.elements) console.log(`[${tag}] cleanup: ${el.type} reads back ${await status(`${API}/${el.type}/${el.id}`, { 'API-Key': made.key.key, 'API-Pin': pin })}`);
    const revoked = await acct('DELETE', `/account/worlds/${made.worldId}/keys/${made.key.id}`);
    console.log(`[${tag}] cleanup: the walk's world key taken back by id (${revoked.status}); it now reads ${await status(`${API}/world/`, { 'API-Key': made.key.key, 'API-Pin': pin })}`);
  }
  for (const id of made.tokens) await acct('DELETE', `/account/tokens/${id}`).catch(() => {});
  console.log(`[${tag}] cleanup: ${made.tokens.length} sign-in token(s) taken back by id`);
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

// 0. The ground: the world by name, a key minted and recorded, two elements made and recorded.
made.worldId = ((await acct('GET', '/account/worlds')).body?.data ?? []).find((w) => w.name === WORLD && w.role === 'owner')?.id;
if (!made.worldId) throw new Error(`crew-walk-b owns no "${WORLD}"`);
const minted = await new OwV2Client({ apiKey: walk.token, fetch: limited(20000) }).mintWorldKey(made.worldId, { scope: 'write', name: 'little lens draught walk S514' });
made.key = { id: minted.id, key: minted.key };
const owner = new OwV2Client({ apiKey: made.key.key, apiPin: pin, fetch: limited(20000) });
const ada = await owner.create('character', { name: 'Lens walk Ada', birth_date: 100 });
made.elements.push({ type: 'character', id: ada.id });
const storm = await owner.create('event', { name: 'Lens walk storm', start_date: 300, characters: [ada.id] });
made.elements.push({ type: 'event', id: storm.id });
console.log(`[${tag}] made a Character and an Event, recorded by id`);

browser = await (engineName === 'firefox' ? firefox : chromium).launch();
const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 900 }, hasTouch: phone });
if (engineName === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LENS });
const errors = [];
const exchanged = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', async (r) => {
  if (!r.url().startsWith(`${API}/auth/token`) || r.request().method() !== 'POST') return;
  const b = await r.json().catch(() => null);
  if (b?.token_id) {
    exchanged.push(b.token);
    made.tokens.push(b.token_id);
  }
});

// 1. Signed in on the site, then Sign in with OnlyWorlds, resuming at her draught at 200.
await page.goto('https://www.onlyworlds.com/accounts/login/');
await page.fill('input[name="login"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }), page.locator('form button[type="submit"]').first().click()]);
const at200 = `${LENS}/#/me/${made.worldId}/e/${ada.id}/draught?at=200`;
await page.goto(at200);
await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
const consent = page.locator('button[name="decision"][value="continue"]');
if (await consent.waitFor({ timeout: 8000 }).then(() => true, () => false)) await consent.click();
await page.waitForURL((u) => u.hostname === new URL(LENS).hostname && !u.pathname.startsWith('/signin'), { timeout: 30000 });
check(exchanged.length === 1, 'one exchange, its token recorded by id');

if (expectOld) {
  await page.goto(`${LENS}/#/me/${made.worldId}/e/${ada.id}`);
  await page.waitForSelector('.eview', { timeout: 60000 });
  check((await page.locator('a.dway').count()) === 0, 'the old build offers no draught (control)');
  await finish();
}

// 2. The sign-in came back to her draught at 200: the Event is dated after it.
const resumed = await page.waitForFunction(() => /: \d+ rows?/.test(document.querySelector('.dcap')?.textContent ?? ''), null, { timeout: 60000 }).then(() => true, () => false);
check(resumed && page.url().includes(`/e/${ada.id}/draught?at=200`), `the sign-in resumed at her draught at 200 (${page.url().replace(LENS, '')})`);
await page.waitForFunction(() => !document.querySelector('.dways .pill:nth-child(2)')?.disabled, null, { timeout: 30000 }).catch(() => {});
const cap = (await page.textContent('.dcap')) ?? '';
check(/^Dated up to .*200: 0 rows$/.test(cap), `at 200 the draught holds no row: the storm is at 300 (${cap})`);
check(((await page.textContent('.dreader')) ?? '') === '', 'read as her owner, no public-reader line');
await page.click('.dways .pill:nth-child(2)');
const after = await page.locator('.dbody .drow').allTextContents();
check(after.length === 1 && after[0].includes('Lens walk storm'), `dated after 200: the storm alone (${after.length})`);
await page.screenshot({ path: `walk/out-${tag}-after.png`, fullPage: true });

// 3. Back to the world's now or the top: the storm is kept.
await page.click('.dways .pill:nth-child(1)');
await page.goto(`${LENS}/#/me/${made.worldId}/e/${ada.id}/draught?at=300`);
await page.waitForFunction(() => /: 1 row$/.test(document.querySelector('.dcap')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check(/: 1 row$/.test((await page.textContent('.dcap')) ?? ''), `at 300, a row dated at the moment is kept (${await page.textContent('.dcap')})`);
await page.click('.dcopy');
await page.waitForFunction(() => /Copied|Select and copy/.test(document.querySelector('.dcopy')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
const copiedLine = (await page.textContent('.dcopied')) ?? '';
check(copiedLine.includes('Lens walk Ada'), `the copy names her and its moment (${copiedLine.slice(0, 100)})`);
if (engineName === 'chromium') {
  const pasted = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(pasted.startsWith('# Lens walk Ada') && pasted.includes('Lens walk storm'), 'the pasted text is her draught with the storm');
}
await page.screenshot({ path: `walk/out-${tag}-at300.png`, fullPage: true });

// 4. Sign out: the token is removed, and nothing of the draught stays on screen.
await page.goto(`${LENS}/#/`);
await page.getByRole('button', { name: 'Sign out' }).click();
check(await page.getByText('Signed out, and the sign-in is removed from your OnlyWorlds account.').waitFor({ timeout: 20000 }).then(() => true, () => false), 'Sign out says the sign-in is removed');
check((await status(`${API}/account`, bearer(exchanged[0]))) === 401, 'the token reads back 401');
await page.goto(at200);
check(await page.getByText('Sign in to open this world.').waitFor({ timeout: 10000 }).then(() => true, () => false), 'her draught address now asks to sign in, showing nothing read before');
check(errors.length === 0, `no page error (${errors.slice(0, 2).join(' | ')})`);
await finish();
