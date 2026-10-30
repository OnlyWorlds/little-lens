// Messages, signed in, read live on a host against real keel. crew-walk-b owns a kept, empty test
// world; this walk makes two Characters, a message from the first to the second, a reply, and a Read
// relation naming the first message (through a world key it mints), signs in to Little Lens by Sign
// in with OnlyWorlds, opens the world's Messages from the view switcher as a person would, reads the
// conversation, follows the reply's element page back into it, and signs out. Because senders cannot
// be checked in a signed-in read yet, every sender must read as a claim and no read mark may show.
// Every element, key and token it makes is recorded by id and taken back at the end, a throw
// included; credentials, keys and tokens are never printed. Claim the account in its room first.
//   CREW_WALK_ACCOUNTS=<file> WORLD="<a world the account owns>" node walk/live-messages-signin.mjs [chromium|firefox] [--expect-old] [--phone]
// `--expect-old` is the control on a build without Messages: the walk must fail at the Messages link
// (FAIL lines, exit 1) and still take everything back.
import fs from 'node:fs';
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';

const engineName = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const expectOld = process.argv.includes('--expect-old');
const phone = process.argv.includes('--phone');
const tag = `messages-live-${engineName}${phone ? '-390' : ''}${expectOld ? '-old' : ''}`;
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

const walk = await new OwV2Client({ client: 'little-lens-walk', fetch: limited(20000) }).signInWithPassword({ email, password, tokenName: 'little lens messages walk' });
const acct = async (method, path) => {
  const r = await fetch(`${API}${path}`, { method, headers: bearer(walk.token), signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const made = { tokens: [], elements: [], key: null };
let browser = null;
let cleaned = false;
const goneStatus = (s) => s === 404 || s === 410;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  await browser?.close().catch(() => {});
  let left = 0;
  if (made.key) {
    const owner = new OwV2Client({ apiKey: made.key.key, apiPin: pin, fetch: limited(20000) });
    for (const el of [...made.elements].reverse()) await owner.delete(el.type, el.id).catch((e) => console.log(`[${tag}] delete ${el.type}: ${String(e?.status ?? e)}`));
    for (const el of made.elements) {
      const s = await status(`${API}/${el.type}/${el.id}`, { 'API-Key': made.key.key, 'API-Pin': pin }).catch(() => 0);
      if (!goneStatus(s)) left++;
      console.log(`[${tag}] cleanup: ${el.type} reads back ${s}${goneStatus(s) ? ' (gone)' : ' (NOT GONE)'}`);
    }
    const revoked = await acct('DELETE', `/account/worlds/${made.worldId}/keys/${made.key.id}`);
    const keyRead = await status(`${API}/world/`, { 'API-Key': made.key.key, 'API-Pin': pin }).catch(() => 0);
    if (keyRead !== 401) left++;
    console.log(`[${tag}] cleanup: the walk's world key taken back by id (${revoked.status}); it now reads ${keyRead}`);
  }
  for (const id of made.tokens) await acct('DELETE', `/account/tokens/${id}`).catch(() => {});
  console.log(`[${tag}] cleanup: ${made.tokens.length} sign-in token(s) taken back by id`);
  await acct('DELETE', `/account/tokens/${walk.id}`);
  const own = await status(`${API}/account`, bearer(walk.token)).catch(() => 0);
  if (own !== 401) left++;
  console.log(`[${tag}] the walk's own token reads back ${own}`);
  console.log(`[${tag}] cleanup: ${made.elements.length} element(s) recorded, ${left} left over`);
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

// 0. The ground: the world by name, a key minted and recorded, every element made and recorded.
made.worldId = ((await acct('GET', '/account/worlds')).body?.data ?? []).find((w) => w.name === WORLD && w.role === 'owner')?.id;
if (!made.worldId) throw new Error(`crew-walk-b owns no "${WORLD}"`);
const minted = await new OwV2Client({ apiKey: walk.token, fetch: limited(20000) }).mintWorldKey(made.worldId, { scope: 'write', name: 'little lens messages walk' });
made.key = { id: minted.id, key: minted.key };
const owner = new OwV2Client({ apiKey: made.key.key, apiPin: pin, fetch: limited(20000) });
const make = async (type, body) => {
  const el = await owner.create(type, body);
  made.elements.push({ type, id: el.id });
  return el;
};
const ada = await make('character', { name: 'Lens walk Ada' });
const mara = await make('character', { name: 'Lens walk Mara' });
const first = await make('narrative', { name: 'Lens walk question', supertype: 'Message', narrator: ada.id, characters: [mara.id], story: 'Are the lamps lit on the east road?' });
const reply = await make('narrative', { name: 'Re: Lens walk question', supertype: 'Message', narrator: mara.id, characters: [ada.id], parent_narrative: first.id, story: 'Lit at dusk, as always.' });
await make('relation', { name: 'Read: Lens walk Mara', supertype: 'Read', actor: mara.id, narratives: [first.id] });
console.log(`[${tag}] made 2 Characters, 2 messages and a Read relation, recorded by id`);

browser = await (engineName === 'firefox' ? firefox : chromium).launch();
const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 900 }, hasTouch: phone });
const errors = [];
const exchanged = [];
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', async (r) => {
  if (!r.url().startsWith(`${API}/auth/token`) || r.request().method() !== 'POST') return;
  const b = await r.json().catch(() => null);
  if (b?.token_id) {
    exchanged.push(b.token);
    made.tokens.push(b.token_id);
  }
});
const bodyText = () => page.evaluate(() => document.body.textContent ?? '');

// 1. Signed in on the site, then Sign in with OnlyWorlds from Little Lens's ways in.
await page.goto('https://www.onlyworlds.com/accounts/login/');
await page.fill('input[name="login"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }), page.locator('form button[type="submit"]').first().click()]);
await page.goto(`${LENS}/`);
await page.getByRole('heading', { name: 'Little Lens' }).waitFor({ timeout: 20000 });
await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
const consent = page.locator('button[name="decision"][value="continue"]');
if (await consent.waitFor({ timeout: 8000 }).then(() => true, () => false)) await consent.click();
check(await page.getByText('Signed in as').waitFor({ timeout: 30000 }).then(() => true, () => false), 'back on the ways in, signed in as the account');
check(exchanged.length === 1, 'one exchange, its token recorded by id');

// 2. The world from "Your worlds", then Messages from the view switcher.
const escaped = WORLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
await page.getByRole('list', { name: 'Your worlds' }).getByRole('link', { name: new RegExp(`^${escaped}\\s*yours$`) }).click();
check(await page.locator('.wsub', { hasText: 'signed in as' }).waitFor({ timeout: 30000 }).then(() => true, () => false), 'the world opens, read as the account');
await page.locator('nav.switch').waitFor({ timeout: 30000 }).catch(() => {});
const tab = page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true });
const hasTab = (await tab.count()) === 1;
check(hasTab, 'the view switcher has Messages');
if (!hasTab) {
  if (expectOld) console.log(`[${tag}] control: this build has no Messages, so the walk stops here`);
  await finish();
}
await tab.click();
await page.waitForSelector('section.messages');
check(page.url().includes(`#/me/${made.worldId}/messages`), `at #/me/<world id>/messages (${page.url().replace(LENS, '')})`);

// 3. The list: its head, its check line, and no read mark anywhere.
const head = (await page.locator('.mhead .mcount').first().textContent()) ?? '';
check(head === '2 messages in 1 conversation', `the head counts the two in one conversation (${head})`);
const checkLine = (await page.locator('.mhead .mcheck').first().textContent().catch(() => '')) ?? '';
check(checkLine === 'Senders cannot be checked here yet, so each says who it claims to be from, and read marks are not shown.', `the check line says senders cannot be checked (${checkLine.slice(0, 60)})`);
let text = await bodyText();
check(!text.includes('Read by') && !text.includes('Not yet by'), 'the list shows no read mark');
await page.screenshot({ path: `walk/out-${tag}-list.png`, fullPage: true });

// 4. The conversation: both messages in created order, claimed senders, named recipients.
await page.locator('a.thread').first().click();
await page.waitForSelector('.mthread');
const msgs = await page.evaluate(() =>
  [...document.querySelectorAll('.mthread > .msg')].map((li) => ({
    subject: li.querySelector('.msubject')?.textContent ?? null,
    from: li.querySelector('.mfrom')?.textContent ?? null,
    fromBold: !!li.querySelector('.mfrom b'),
    to: li.querySelector('.mto')?.textContent ?? null,
    read: li.querySelector('.mread')?.textContent ?? null,
    body: li.querySelector('.mbody')?.textContent ?? null,
  })),
);
check(msgs.length === 2 && msgs[0].subject === 'Lens walk question' && msgs[1].subject === 'Re: Lens walk question', `both messages, in created order (${msgs.map((m) => m.subject).join(' | ')})`);
check(msgs.length === 2 && msgs.every((m) => m.from?.startsWith('Claims to be from ') && !m.fromBold), `each From line is a claim, none a bold proved name (${msgs.map((m) => m.from).join(' | ')})`);
check(msgs.length === 2 && msgs[0].from === 'Claims to be from Lens walk Ada' && msgs[1].from === 'Claims to be from Lens walk Mara', 'the claims name Ada, then Mara');
check(msgs.length === 2 && msgs[0].to === 'To Lens walk Mara' && msgs[1].to === 'To Lens walk Ada', `the To lines name Mara, then Ada (${msgs.map((m) => m.to).join(' | ')})`);
check(msgs.length === 2 && msgs[0].body === 'Are the lamps lit on the east road?' && msgs[1].body === 'Lit at dusk, as always.', 'each message shows its story');
text = await bodyText();
check(!text.includes('Read by') && !text.includes('Not yet by') && msgs.every((m) => m.read === null), 'the conversation shows no "Read by" and no "Not yet by"');
await page.screenshot({ path: `walk/out-${tag}-conversation.png`, fullPage: true });

// 5. The reply's element page offers its conversation, and the way lands on it.
await page.goto(`${LENS}/#/me/${made.worldId}/e/${reply.id}`);
await page.waitForSelector('.eview');
const way = page.getByRole('link', { name: 'Read it in its conversation' });
check((await way.count()) === 1, 'the reply\'s element page offers "Read it in its conversation"');
await way.click();
await page.waitForSelector('.mthread');
const landed = await page.locator('.mthread > .msg .msubject').allTextContents();
check(landed.join('|') === 'Lens walk question|Re: Lens walk question', `it lands on the conversation (${landed.join(' | ')})`);

// 6. Sign out: the token is removed.
await page.goto(`${LENS}/#/`);
await page.getByRole('button', { name: 'Sign out' }).click();
check(await page.getByText('Signed out, and the sign-in is removed from your OnlyWorlds account.').waitFor({ timeout: 20000 }).then(() => true, () => false), 'Sign out says the sign-in is removed');
check((await status(`${API}/account`, bearer(exchanged[0]))) === 401, 'the token reads back 401');
check(errors.length === 0, `no page error (${errors.slice(0, 2).join(' | ')})`);
await finish();
