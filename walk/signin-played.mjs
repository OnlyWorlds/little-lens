// Sign in with OnlyWorlds, played: Playwright serves https://little-lens.onlyworlds.com from a build under
// its own _headers and _redirects and plays keel (the authorize and consent pages, the token exchange,
// the account's worlds, a world read on the token, the public reader, the token's revoke), with real
// presses. keel's consent rule is modelled: a tool's consent ends with its last live token unless the
// registry keeps it (the default plays keel's main as it is, without that flag; KEEP_CONSENT=1 plays it with). What it cannot see: the
// host's own rules, and real keel (the live walk).
//   npm run build && node walk/signin-played.mjs [chromium|firefox]      DIST=<dir> for a control
import { chromium, firefox } from '@playwright/test';
import { createHash } from 'node:crypto';
import { hostFor } from './host.mjs';

const DIST = process.env.DIST ?? 'dist';
const KEEP_CONSENT = process.env.KEEP_CONSENT === '1';
const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const PROD = 'https://little-lens.onlyworlds.com';
const CALLBACK = `${PROD}/signin/callback`;
const OTHER = 'https://elsewhere.example';
const MINE = '11111111-1111-7111-8111-111111111111';
const SHARED = '22222222-2222-7222-8222-222222222222'; // shared with the account, and public
const BARE = '33333333-3333-7333-8333-333333333333'; // owned; its world body carries no counts
const NOTMINE = '44444444-4444-7444-8444-444444444444';
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const { serve } = hostFor(DIST);

const WORLDS = [
  { id: SHARED, name: 'Alpha Shared', role: 'collaborator', member_role: 'contributor', public_read: true, keys: [] },
  { id: MINE, name: 'Saltmere Coast', role: 'owner', public_read: false, keys: [] },
  { id: BARE, name: 'beta', role: 'owner', public_read: false, keys: [] },
];
// What each reader is served: a member sees one more Character in the shared world than the public does.
const ELEMENTS = {
  [MINE]: { character: [{ id: id(1), name: 'Ada Vane', friends: [id(2)] }, { id: id(2), name: 'Bram Holt' }], location: [{ id: id(10), name: 'Saltmere' }] },
  [SHARED]: { character: [{ id: id(21), name: 'Public Pell' }, { id: id(22), name: 'Members Mira', friends: [id(21)] }] },
  [BARE]: { law: [{ id: id(31), name: 'The Tide Law' }], event: [{ id: id(32), name: 'The Flood' }] },
};
const PUBLIC_VIEW = { [SHARED]: { character: [{ id: id(21), name: 'Public Pell' }] } };

let failures = 0;
let checks = 0;
const check = (tag, ok, what) => {
  checks++;
  if (!ok) failures++;
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const watchdog = setTimeout(() => {
  console.error('signin-played: watchdog, 240 s');
  process.exit(2);
}, 240_000);

const browser = await engine.launch();

async function session(tag, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) errors.push(m.text());
  });
  const keel = { tokens: new Map(), minted: 0, consent: false, consentShown: 0, calls: [], challenge: '', code: '', cancelNext: false, busyExchange: false };
  const live = () => [...keel.tokens.values()].filter((t) => !t.revoked);
  await ctx.route('https://www.onlyworlds.com/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const hdr = req.headers();
    const bearer = (hdr['authorization'] ?? '').replace(/^Bearer /, '') || null;
    keel.calls.push({ m, path: u.pathname, q: u.search, bearer, apiKey: hdr['api-key'] ?? null });
    const json = (status, body, extra = {}) =>
      r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': PROD, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'Retry-After, RateLimit-Remaining, RateLimit-Reset', ...extra }, body: body === null ? '' : JSON.stringify(body) });
    if (m === 'OPTIONS') return json(204, null);
    if (u.pathname === '/signin/authorize') {
      keel.challenge = u.searchParams.get('code_challenge');
      keel.code = `c0de-${keel.minted + 1}`;
      const state = u.searchParams.get('state');
      const back = `${CALLBACK}?code=${keel.code}&state=${state}`;
      const cancel = `${CALLBACK}?error=access_denied&state=${state}`;
      if (keel.consent) return r.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
      keel.consentShown++;
      return r.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><title>Consent</title><h1>Little Lens wants to read your worlds</h1><a id="go" href=${JSON.stringify(back)}>Continue</a> <a id="no" href=${JSON.stringify(cancel)}>Cancel</a>`,
      });
    }
    if (u.pathname === '/api/v2/auth/token') {
      if (keel.busyExchange) return json(429, { error: { code: 'too_many_login_attempts', message: 'KEEL TEXT' } }, { 'Retry-After': '120' });
      const b = JSON.parse(req.postData());
      const ok = b.code === keel.code && b.client_id === 'little-lens' && b.redirect_uri === CALLBACK && b64url(createHash('sha256').update(b.code_verifier).digest()) === keel.challenge;
      if (!ok) return json(400, { error: { code: 'invalid_grant', message: 'KEEL TEXT' } });
      keel.code = '';
      keel.consent = true;
      const n = ++keel.minted;
      const token = `ow_a_${String(n).repeat(40)}`;
      keel.tokens.set(token, { id: `tok-${n}`, revoked: false });
      return json(200, { token, token_id: `tok-${n}`, token_type: 'bearer', account: { id: 'acc-1', username: 'wren' } });
    }
    const p = u.pathname.replace('/api/v2', '');
    const t = bearer ? keel.tokens.get(bearer) : null;
    if (bearer && (!t || t.revoked)) return json(401, { error: { code: t ? 'key_revoked' : 'invalid_credentials' } });
    if (m === 'DELETE' && p.startsWith('/account/tokens/')) {
      const tid = decodeURIComponent(p.split('/')[3]);
      if (!t || t.id !== tid) return json(404, { error: { code: 'not_found' } });
      t.revoked = true;
      if (live().length === 0 && !KEEP_CONSENT) keel.consent = false;
      return json(204, null);
    }
    if (p === '/account/worlds') return t ? json(200, { data: WORLDS }) : json(401, { error: { code: 'authentication_failed' } });
    const world = u.searchParams.get('world');
    const member = t && WORLDS.some((w) => w.id === world);
    const view = member ? ELEMENTS[world] : PUBLIC_VIEW[world];
    if (!view) return json(404, { error: { code: 'not_found' } });
    if (p === '/world/') {
      const name = member ? WORLDS.find((w) => w.id === world).name : 'Alpha Shared';
      const body = { id: world, name, description: '', image_url: '' };
      if (world !== BARE) body.counts = { total: 0, types: Object.fromEntries(Object.entries(view).map(([k, v]) => [k, v.length])) };
      return json(200, body);
    }
    const type = p.split('/')[1];
    return json(200, { data: view[type] ?? [], has_more: false, next_cursor: null });
  });
  // Each write the page sends, method, address and keepalive (never a header), kept across an unload.
  await ctx.addInitScript(() => {
    const real = window.fetch;
    window.fetch = (input, init) => {
      const m = init?.method ?? 'GET';
      if (m !== 'GET') localStorage.setItem('__walk_fetch', `${localStorage.getItem('__walk_fetch') ?? ''}${m} ${String(input)} keepalive=${init?.keepalive} | `);
      return real(input, init);
    };
  });
  await ctx.route(`${PROD}/**`, async (r) => r.fulfill(serve(new URL(r.request().url()).pathname)));
  await ctx.route(`${OTHER}/**`, async (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Elsewhere</title><p>elsewhere</p>' }));
  return { ctx, page, keel, errors };
}

async function signIn(page, keel, { consent = 'continue' } = {}) {
  await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
  await page.waitForURL((u) => u.hostname === 'www.onlyworlds.com' || u.hostname === 'little-lens.onlyworlds.com', { timeout: 15_000 });
  if (page.url().startsWith('https://www.onlyworlds.com/signin/authorize') && (await page.locator('#go').count())) {
    await page.click(consent === 'cancel' ? '#no' : '#go');
  }
  await page.waitForURL((u) => u.hostname === 'little-lens.onlyworlds.com' && !u.pathname.startsWith('/signin'), { timeout: 15_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Signing in…'), null, { timeout: 15_000 });
}

const storageOf = (page) => page.evaluate(() => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.keys(sessionStorage) }));
const waitFor = async (pred, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
};

// The revoke a leaving page sends: the page's own fetch is logged (the log survives the unload), and
// keel's side is read where the engine lets routing see it. Chromium's routing never sees a keepalive
// request that outlives its document, so there the request is the page's word; the live walk reads
// the token itself.
async function leftRevoke(tag, page, keel, token, how) {
  const tid = keel.tokens.get(token)?.id;
  const sent = await page.evaluate(() => localStorage.getItem('__walk_fetch') ?? '');
  await page.evaluate(() => localStorage.removeItem('__walk_fetch'));
  check(tag, sent.includes(`DELETE https://www.onlyworlds.com/api/v2/account/tokens/${tid} keepalive=true`), `on ${how} the page calls fetch for its token's revoke, keepalive (${sent.trim() || 'nothing'})`);
  const landed = await waitFor(() => keel.tokens.get(token)?.revoked === true);
  if (which === 'firefox') check(tag, landed, `and keel takes it (${how})`);
  else console.log(`[${tag}] note: keel ${landed ? 'took' : 'did not see'} the revoke on ${how}: Chromium's routing cannot see a request that outlives its page`);
}

// 1. The way in, the round trip, the picker, a world on the token.
{
  const tag = `${which} main`;
  const { ctx, page, keel, errors } = await session(tag);
  await page.goto(`${PROD}/`);
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1, 'the ways in offers Sign in with OnlyWorlds on the registered origin');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `walk/out-signin-${which}-390-ways.png` });
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page, keel);
  check(tag, keel.consentShown === 1, 'the first sign-in shows the consent page');
  await page.locator('ul.mine').waitFor({ timeout: 15_000 });
  check(tag, page.url() === `${PROD}/#/`, `the callback ends on the ways in, its code gone from the address (${page.url()})`);
  check(tag, (await page.textContent('.who')).startsWith('Signed in as wren'), 'the ways in says who is signed in');
  const names = await page.locator('.mine .mname').allTextContents();
  check(tag, names.join('|') === 'beta|Saltmere Coast|Alpha Shared', `owned then shared, each A to Z (${names.join(', ')})`);
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 0, 'signed in, no second Sign in');
  const st = await storageOf(page);
  const token1 = [...keel.tokens.keys()][0];
  check(tag, !JSON.stringify(st).includes(token1) && st.session.length === 0, 'the token is in no storage');
  check(tag, Object.keys(st.local).filter((k) => k.startsWith('ow_signin') || k.startsWith('little-lens.signin')).length === 0, 'the record, the stamp and the resume are gone after the return');
  await page.screenshot({ path: `walk/out-signin-${which}-picker.png` });

  await page.click('.mine a:has-text("Saltmere Coast")');
  await page.waitForSelector('.tally', { timeout: 15_000 });
  check(tag, page.url() === `${PROD}/#/me/${MINE}`, 'a picked world opens under #/me/');
  check(tag, (await page.textContent('.wsub')) === 'signed in as wren', 'the world says whose reading it is');
  check(tag, (await page.textContent('.tally')) === '3 elements · 1 links', await page.textContent('.tally'));
  const reads = keel.calls.filter((c) => c.q.includes(`world=${MINE}`));
  check(tag, reads.length > 0 && reads.every((c) => c.bearer === token1 && !c.apiKey), 'every read of it carries the token as the bearer, and no key');
  await page.click('a[href$="view=list"]');
  await page.waitForSelector('.cards');
  const hrefs = await page.locator('.cards a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check(tag, hrefs.length === 3 && hrefs.every((h) => h.startsWith(`#/me/${MINE}/e/`)), 'every link a signed-in world draws stays under #/me/');
  await page.click('.cards a:has-text("Ada Vane")');
  await page.waitForSelector('.eview');
  check(tag, (await page.locator('.crumbs a:not(.dway)').getAttribute('href')) === `#/me/${MINE}`, 'the crumb goes back under #/me/');
  await page.screenshot({ path: `walk/out-signin-${which}-world.png` });

  // A world whose body carries no counts reads every type the graph keeps.
  const before = keel.calls.length;
  await page.goto(`${PROD}/#/me/${BARE}`);
  await page.waitForSelector('.tally', { timeout: 15_000 });
  check(tag, (await page.textContent('.tally')) === '2 elements · 0 links', `a countless world still draws (${await page.textContent('.tally')})`);
  const lists = keel.calls.slice(before).filter((c) => c.path !== '/api/v2/world/');
  check(tag, lists.length === 18, `it reads the 18 types the graph keeps (${lists.length})`);

  // One world, two readers: never one standing in for the other.
  await page.goto(`${PROD}/#/w/${SHARED}`);
  await page.waitForSelector('.tally', { timeout: 15_000 });
  check(tag, (await page.textContent('.tally')).startsWith('1 elements') && (await page.textContent('.wsub')) === 'public world, read without your sign-in', 'the public address reads the public view, and says it is read without the sign-in');
  check(tag, keel.calls.filter((c) => c.q.includes(`world=${SHARED}`)).every((c) => c.bearer === null), 'the public read sends no token');
  await page.goto(`${PROD}/#/me/${SHARED}`);
  await page.waitForSelector('.wsub:has-text("signed in")', { timeout: 15_000 });
  check(tag, (await page.textContent('.tally')).startsWith('2 elements'), 'the same world under #/me/ reads again, as the member');
  await page.goto(`${PROD}/#/w/${SHARED}`);
  await page.waitForSelector('.wsub:has-text("public world")', { timeout: 15_000 });
  check(tag, (await page.textContent('.tally')).startsWith('1 elements'), 'and back under #/w/ the public view again, never the member view');

  // A world the account cannot read.
  await page.goto(`${PROD}/#/me/${NOTMINE}`);
  await page.waitForSelector('main.closed h1', { timeout: 15_000 });
  check(tag, (await page.textContent('main.closed p')) === 'Your account may not be in it, or the address may be wrong.', 'a world the account cannot read is the closed door, in the signed-in words');

  // Sign out: the token deleted by its id with itself as the bearer.
  await page.goto(`${PROD}/#/`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('.ways .said:has-text("Signed out")', { timeout: 15_000 });
  const del = keel.calls.filter((c) => c.m === 'DELETE');
  check(tag, del.length === 1 && del[0].path === '/api/v2/account/tokens/tok-1' && del[0].bearer === token1, 'Sign out deletes the token by its id, the token the bearer');
  check(tag, (await page.textContent('.ways .said')) === 'Signed out, and the sign-in is removed from your OnlyWorlds account.', 'and says it is removed');
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1, 'the Sign in way is back');
  await page.goto(`${PROD}/#/me/${MINE}`);
  await page.waitForSelector('.ways', { timeout: 15_000 });
  check(tag, (await page.textContent('.ways .said')) === 'Sign in to open this world.', 'a #/me/ address with no sign-in asks for one');

  // Signing in from there comes back to the world; the consent page shows again only where keel would.
  await signIn(page, keel);
  await page.waitForSelector('.tally', { timeout: 15_000 });
  check(tag, page.url() === `${PROD}/#/me/${MINE}`, 'the return goes to the world the address named');
  check(tag, keel.consentShown === (KEEP_CONSENT ? 1 : 2), `the second sign-in shows the consent page ${KEEP_CONSENT ? 'no more' : 'again'} (shown ${keel.consentShown})`);

  // A reload signs out: the page revokes the token as it goes.
  const token2 = [...keel.tokens.keys()][1];
  await page.reload();
  await page.waitForSelector('.ways', { timeout: 15_000 });
  check(tag, (await page.textContent('.ways .said')) === 'Sign in to open this world.', 'after a reload the world asks for a sign-in again');
  await leftRevoke(tag, page, keel, token2, 'a reload');

  // The sign-in ended elsewhere (Disconnect): the next read says so, never a closed world.
  await signIn(page, keel);
  await page.waitForSelector('.tally', { timeout: 15_000 });
  const token3 = [...keel.tokens.keys()][2];
  keel.tokens.get(token3).revoked = true;
  await page.goto(`${PROD}/#/me/${BARE}`);
  await page.waitForSelector('.ways .said', { timeout: 15_000 });
  check(tag, (await page.textContent('.ways .said')) === 'Your sign-in ended on OnlyWorlds, so Little Lens is signed out. Sign in again to go on.', 'a revoked token reads as the sign-in ending');
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1, 'and the Sign in way is back');

  check(tag, errors.length === 0, `no page error, no policy violation (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// 2. Cancel, a refused exchange, a stale record, a hand-typed #/signing-in.
{
  const tag = `${which} edges`;
  const { ctx, page, keel, errors } = await session(tag);
  await page.goto(`${PROD}/`);
  await signIn(page, keel, { consent: 'cancel' });
  await page.waitForSelector('.ways .said', { timeout: 15_000 });
  check(tag, (await page.textContent('.ways .said')) === 'Sign-in cancelled: nothing changed.', 'Cancel says nothing changed');
  check(tag, !keel.calls.some((c) => c.path === '/api/v2/auth/token'), 'and trades nothing');
  check(tag, Object.keys((await storageOf(page)).local).length === 0, 'and leaves nothing in storage');

  keel.busyExchange = true;
  await signIn(page, keel);
  await page.waitForSelector('.ways .said', { timeout: 15_000 });
  const line = await page.textContent('.ways .said');
  check(tag, line.includes('from this network') && !line.includes('KEEL'), `a 429 names the network, in Little Lens's words (${line})`);
  keel.busyExchange = false;

  await page.evaluate(() => {
    localStorage.setItem('ow_signin:little-lens', '{"state":"s","verifier":"v","redirectUri":"x"}');
  });
  await page.goto(`${PROD}/#/`);
  await page.reload();
  check(tag, (await page.evaluate(() => localStorage.getItem('ow_signin:little-lens'))) === null, 'a record with no stamp is dropped at load');

  await page.goto(`${PROD}/#/signing-in`);
  await page.waitForSelector('.ways', { timeout: 15_000 });
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1, '#/signing-in with nothing pending is the ways in');

  // Back after a sign-in through the consent page: keel's authorize page sends a fresh code to a
  // record already used. That is a page revisited, never "another tab".
  await signIn(page, keel);
  await page.locator('ul.mine').waitFor({ timeout: 15_000 });
  const shownBefore = keel.consentShown;
  await page.goBack();
  await page.waitForFunction(() => location.hostname === 'www.onlyworlds.com' || (location.pathname === '/' && !document.body.innerText.includes('Signing in…') && !!document.querySelector('.ways')), null, { timeout: 15_000 });
  if (page.url().startsWith('https://www.onlyworlds.com/')) {
    console.log(`[${tag}] note: Back met keel's consent page again (the revoke had ended the consent first), so no code came back`);
    check(tag, keel.consentShown === shownBefore + 1, 'Back to a consent that ended shows the consent page, nothing traded');
  } else {
    const back = (await page.textContent('.ways .said')) ?? '';
    check(tag, !back.includes('another tab') && back.startsWith('That sign-in is no longer waiting here'), `Back into a used sign-in says so plainly (${back})`);
    check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1, 'and offers Sign in again');
  }
  check(tag, errors.length === 0, `no page error, no policy violation (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// 3. Leaving and coming Back: the page that comes back holds no token it revoked.
{
  const tag = `${which} back`;
  const { ctx, page, keel, errors } = await session(tag);
  await page.goto(`${PROD}/`);
  await signIn(page, keel);
  await page.locator('ul.mine').waitFor({ timeout: 15_000 });
  await page.click('.mine a:has-text("Saltmere Coast")');
  await page.waitForSelector('.tally', { timeout: 15_000 });
  const token = [...keel.tokens.keys()][0];
  await page.evaluate(() => window.addEventListener('pageshow', (e) => (window.__restored = e.persisted)));
  await page.goto(`${OTHER}/`);
  await page.goBack();
  await page.waitForSelector('.ways', { timeout: 15_000 });
  await leftRevoke(tag, page, keel, token, 'leaving for another site');
  const restored = await page.evaluate(() => window.__restored === true);
  const said = await page.textContent('.ways .said');
  check(tag, restored ? said === 'You left the page, so Little Lens signed you out.' : said === 'Sign in to open this world.', `Back lands on the ways in (${restored ? 'from the back/forward cache' : 'a fresh load'}): ${said}`);
  const after = keel.calls.filter((c) => c.bearer === token && c.m === 'GET' && c.path !== '/api/v2/account/worlds');
  console.log(`[${tag}] note: the page came back ${restored ? 'from the back/forward cache' : 'as a fresh load'}; ${after.length} reads on the token in all`);

  // The back/forward cache's own branch, which Playwright's pages never take: the handler, played by a
  // synthetic pagehide and pageshow with persisted (a claim about the handler, not about any engine's cache).
  await page.goto(`${PROD}/#/`);
  await signIn(page, keel);
  await page.locator('ul.mine').waitFor({ timeout: 15_000 });
  await page.click('.mine a:has-text("Saltmere Coast")');
  await page.waitForSelector('.tally', { timeout: 15_000 });
  const cached = [...keel.tokens.keys()].at(-1);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.waitForSelector('.ways .said', { timeout: 15_000 });
  check(tag, (await page.textContent('.ways .said')) === 'You left the page, so Little Lens signed you out.', 'a page back from the cache signs out and says why');
  check(tag, await waitFor(() => keel.tokens.get(cached)?.revoked === true), 'the token it held was revoked as it left');
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1, 'and offers Sign in again');
  check(tag, errors.length === 0, `no page error, no policy violation (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// 4. Another origin never offers it.
{
  const tag = `${which} origin`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ctx.route('https://little-lens-preview.example/**', async (r) => r.fulfill(serve(new URL(r.request().url()).pathname)));
  await ctx.route('https://www.onlyworlds.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('https://little-lens-preview.example/');
  await page.waitForSelector('.ways');
  check(tag, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 0, 'another origin keeps two ways in');
  await page.goto(`https://little-lens-preview.example/#/me/${MINE}`);
  await page.waitForSelector('.ways .said');
  check(tag, (await page.textContent('.ways .said')) === 'This address opens a world signed in, on little-lens.onlyworlds.com.', 'and says where a #/me/ address opens');
  await ctx.close();
}

await browser.close();
clearTimeout(watchdog);
console.log(`signin-played ${which}${KEEP_CONSENT ? '' : ' (no consent flag)'}: ${checks - failures} of ${checks} checks`);
process.exit(failures ? 1 : 0);
