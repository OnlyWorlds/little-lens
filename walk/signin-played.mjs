// Sign in with OnlyWorlds, played: Playwright serves https://little-lens.onlyworlds.com from a build under
// its own _headers and _redirects and plays keel (the authorize and consent pages, the token exchange,
// the account's worlds, a world read on the token, the world's members list, the public reader, the
// token's revoke), with real presses. keel's consent rule is modelled: a tool's consent ends with its last live token unless the
// registry keeps it (the default plays keel's main as it is, without that flag; KEEP_CONSENT=1 plays it with). What it cannot see: the
// host's own rules, and real keel (the live walk). A path the played keel does not know answers 404, never an empty list.
//   npm run build && node walk/signin-played.mjs [chromium|firefox]      DIST=<dir> for a control
import { chromium, firefox } from '@playwright/test';
import { ELEMENT_TYPES } from '@onlyworlds/sdk';
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

// A world with messages, owned (and public), and the same letters in a world the account is a contributor in.
const LETTERS = '55555555-5555-7555-8555-555555555555';
const CONTRIB = '66666666-6666-7666-8666-666666666666';
const ADA = id(51);
const MARA = id(52);
const BO = id(53);
const FIRST = id(61);
const REPLY = id(62);
const LETTERS_WORLDS = [
  ...WORLDS,
  { id: LETTERS, name: 'Letters Kept', role: 'owner', public_read: true, keys: [] },
  { id: CONTRIB, name: 'Letters Shared', role: 'collaborator', member_role: 'contributor', public_read: false, keys: [] },
];
// The owner wrote the first (`created_by` null), member m1, who plays Mara, the reply and the Read mark.
const letters = (hands) => {
  const h = (by) => (hands ? { created_by: by } : {});
  return {
    character: [{ id: ADA, name: 'Ada Quill' }, { id: MARA, name: 'Mara Fenn' }, { id: BO, name: 'Bo Reed' }],
    narrative: [
      { id: FIRST, supertype: 'Message', name: 'The harbour fees', narrator: ADA, characters: [MARA, BO], story: 'The fees go up at the turn of the tide.', created_at: '2026-10-01T09:00:00Z', ...h(null) },
      { id: REPLY, supertype: 'Message', name: 'Re: The harbour fees', parent_narrative: FIRST, narrator: MARA, characters: [ADA], story: 'Then we sail before it.', created_at: '2026-10-02T09:00:00Z', ...h('m1') },
    ],
    relation: [{ id: id(71), supertype: 'Read', name: 'Read: Mara', actor: MARA, narratives: [FIRST], ...h('m1') }],
  };
};
ELEMENTS[LETTERS] = letters(true);
ELEMENTS[CONTRIB] = letters(true);
PUBLIC_VIEW[LETTERS] = letters(false);
// keel's members list as it serves it: the owner's row first, then one per membership.
const ROSTER = [
  { id: null, kind: 'owner', role: 'owner', character: ADA, status: 'active', lenses: [], lenses_from: null },
  { id: 'm1', kind: 'member', role: 'contributor', character: MARA, status: 'active', lenses: [], lenses_from: null },
];
const NO_LIST = 'Little Lens could not read who is in this world, so senders cannot be proved and read marks are not shown.';
const NOT_EVERY_MARK = 'Read marks you cannot see are not counted, so only who has read a message is shown.';

let failures = 0;
let checks = 0;
const check = (tag, ok, what) => {
  checks++;
  if (!ok) failures++;
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const watchdog = setTimeout(() => {
  console.error('signin-played: watchdog, 420 s');
  process.exit(2);
}, 420_000);

const browser = await engine.launch();

async function session(tag, viewport = { width: 1280, height: 860 }, worlds = WORLDS) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) errors.push(m.text());
  });
  // `members`: how `/members` answers ('full', a status, 'null', 'array', 'has_more', 'no-owner', 'unplayed');
  // `holdMembers`: the next one waits until `release()`; `spent`: every answer says the budget is spent for 2 s.
  const keel = { tokens: new Map(), minted: 0, consent: false, consentShown: 0, calls: [], challenge: '', code: '', cancelNext: false, busyExchange: false, worlds, account: { id: 'acc-1', username: 'wren' }, members: 'full', holdMembers: false, release: null, spent: false };
  const live = () => [...keel.tokens.values()].filter((t) => !t.revoked);
  await ctx.route('https://www.onlyworlds.com/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const m = req.method();
    const hdr = req.headers();
    const bearer = (hdr['authorization'] ?? '').replace(/^Bearer /, '') || null;
    keel.calls.push({ m, path: u.pathname, q: u.search, bearer, apiKey: hdr['api-key'] ?? null, at: Date.now() });
    const spent = keel.spent && m === 'GET' ? { 'RateLimit-Remaining': '0', 'RateLimit-Reset': '2' } : {};
    const json = (status, body, extra = {}) =>
      r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': PROD, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'Retry-After, RateLimit-Remaining, RateLimit-Reset', ...spent, ...extra }, body: body === null ? '' : JSON.stringify(body) });
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
      return json(200, { token, token_id: `tok-${n}`, token_type: 'bearer', account: { ...keel.account } });
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
    if (p === '/account/worlds') return t ? json(200, { data: keel.worlds }) : json(401, { error: { code: 'authentication_failed' } });
    const world = u.searchParams.get('world');
    const isMembers = p === '/members/' || p === '/members';
    if (isMembers && !world) return json(422, { error: { code: 'validation_error', param: 'world' } });
    const member = t && keel.worlds.some((w) => w.id === world);
    const view = member ? ELEMENTS[world] : PUBLIC_VIEW[world];
    if (!view) return json(404, { error: { code: 'not_found' } });
    if (p === '/world/') {
      const name = keel.worlds.find((w) => w.id === world)?.name ?? 'Untitled';
      const body = { id: world, name, description: '', image_url: '' };
      if (world !== BARE) body.counts = { total: 0, types: Object.fromEntries(Object.entries(view).map(([k, v]) => [k, v.length])) };
      return json(200, body);
    }
    // The members list: only on a token with a grant in the world (keel's 404 otherwise).
    if (isMembers) {
      if (!member) return json(404, { error: { code: 'not_found' } });
      if (keel.holdMembers) {
        keel.holdMembers = false;
        await new Promise((res) => (keel.release = res));
      }
      const mode = keel.members;
      const raw = (text) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': PROD }, body: text });
      try {
        if (typeof mode === 'number') return await json(mode, { error: { code: 'played' } }, mode === 429 || mode === 503 ? { 'Retry-After': '30' } : {});
        if (mode === 'null') return await raw('null');
        if (mode === 'array') return await raw(JSON.stringify(ROSTER));
        if (mode === 'has_more') return await json(200, { data: ROSTER, has_more: true, next_cursor: 'c2' });
        if (mode === 'no-owner') return await json(200, { data: ROSTER.filter((row) => row.id !== null) });
        if (mode === 'unplayed') return await json(200, { data: ROSTER.map((row) => (row.id === 'm1' ? { ...row, character: null } : row)) });
        return await json(200, { data: ROSTER });
      } catch {
        return; // the page aborted it: a late answer to nobody
      }
    }
    const type = p.split('/')[1];
    if (p !== `/${type}/` || !ELEMENT_TYPES.includes(type)) return json(404, { error: { code: 'not_found' } });
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

// 4. Messages, signed in: the members list read before anything is drawn, proved senders and counted
// marks with a whole list; any failure is no list; a rung not served every mark says only "Read by";
// a list held past Sign out, another world or another account draws nothing; a public world and a
// world with no message ask for none.
{
  const tag = `${which} members`;
  const { ctx, page, keel, errors } = await session(tag, undefined, LETTERS_WORLDS);
  const membersCalls = (w) => keel.calls.filter((c) => c.path.startsWith('/api/v2/members') && c.q.includes(`world=${w}`));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const drawn = (name) => page.waitForFunction((n) => document.querySelector('.wname')?.textContent === n && !!document.querySelector('.tally'), name, { timeout: 15_000 });
  // Another world first, so the next open of a world reads it again.
  const away = async () => {
    await page.goto(`${PROD}/#/me/${MINE}`);
    await drawn('Saltmere Coast');
  };
  /** A world's one conversation as drawn, from the web view's Messages tab by real clicks. */
  const conversation = async (worldId, name) => {
    await page.goto(`${PROD}/#/me/${worldId}`);
    await drawn(name);
    await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
    await page.waitForSelector('ul.threads');
    const listCheck = await page.evaluate(() => document.querySelector('.mhead .mcheck')?.textContent ?? null);
    await page.locator('a.thread').first().click();
    await page.waitForSelector('.mthread');
    return {
      listCheck,
      ...(await page.evaluate(() => ({
        check: document.querySelector('.mhead .mcheck')?.textContent ?? null,
        text: document.body.textContent,
        msgs: [...document.querySelectorAll('.mthread > .msg')].map((li) => ({
          subject: li.querySelector('.msubject')?.textContent ?? null,
          from: li.querySelector('.mfrom')?.textContent ?? null,
          bold: !!li.querySelector('.mfrom b'),
          read: li.querySelector('.mread')?.textContent ?? null,
        })),
      }))),
    };
  };
  const ownerReads = (sub, v) => {
    const [a, b] = v.msgs;
    check(tag, v.msgs.length === 2 && a.subject === 'The harbour fees' && b.subject === 'Re: The harbour fees', `${sub}: the conversation holds the message and its reply, in order (${v.msgs.map((m) => m.subject).join(' | ')})`);
    check(tag, a?.from === 'From Ada Quill' && a.bold, `${sub}: the owner's message is "From Ada Quill", in bold (${a?.from}, bold ${a?.bold})`);
    check(tag, b?.from === 'From Mara Fenn' && b.bold, `${sub}: m1's reply is "From Mara Fenn", in bold (${b?.from}, bold ${b?.bold})`);
    check(tag, a?.read === 'Read by Mara Fenn', `${sub}: the first says "Read by Mara Fenn" and no "not yet" for Bo, whom nobody plays (${a?.read})`);
    check(tag, b?.read === 'Not yet by Ada Quill', `${sub}: the reply's "not yet" names Ada, whom the owner's row plays (${b?.read})`);
    check(tag, v.check === null && v.listCheck === null, `${sub}: no check line (${v.listCheck} / ${v.check})`);
  };

  await page.goto(`${PROD}/`);
  await signIn(page, keel);
  await page.locator('ul.mine').waitFor({ timeout: 15_000 });
  const token1 = [...keel.tokens.keys()][0];

  // 1. A whole list: senders proved, marks counted, one /members on the token before anything is drawn.
  {
    const before = keel.calls.length;
    const v = await conversation(LETTERS, 'Letters Kept');
    ownerReads('a whole list', v);
    const reads = keel.calls.slice(before);
    const asked = reads.filter((c) => c.path.startsWith('/api/v2/members'));
    check(tag, asked.length === 1 && asked[0].q === `?world=${LETTERS}` && asked[0].bearer === token1 && !asked[0].apiKey, `one GET /members/?world=<id> on the token (${asked.map((c) => c.path + c.q).join(' ')})`);
    const paths = reads.map((c) => c.path);
    check(tag, paths.join(' ') === '/api/v2/world/ /api/v2/character/ /api/v2/narrative/ /api/v2/relation/ /api/v2/members/ /api/v2/account/worlds', `the world, its three types, the list, then the rung read fresh (one worlds read): ${paths.join(' ')}`);
    const rung = reads.find((c) => c.path === '/api/v2/account/worlds');
    check(tag, rung?.bearer === token1, 'the rung is read on the same token');
  }

  // 1b. The budget spent: the list and the rung each wait out keel's window, under the pacing line.
  {
    await away();
    keel.spent = true;
    const before = keel.calls.length;
    await page.goto(`${PROD}/#/me/${LETTERS}`);
    const paced = await page
      .waitForFunction(() => document.querySelector('main .said')?.textContent === 'OnlyWorlds asks Little Lens to pace its reading. Continuing in 2 seconds…', null, { timeout: 8000 })
      .then(() => true, () => false);
    await drawn('Letters Kept');
    keel.spent = false;
    const reads = keel.calls.slice(before);
    const at = (path) => reads.find((c) => c.path === path)?.at;
    const gap1 = at('/api/v2/members/') - at('/api/v2/relation/');
    const gap2 = at('/api/v2/account/worlds') - at('/api/v2/members/');
    check(tag, paced, 'a spent budget: the pacing line shows before the list');
    check(tag, gap1 >= 2000 && gap2 >= 2000, `a spent budget: /members waits out the window after the last type, and the rung after /members (${gap1} ms, ${gap2} ms)`);
  }

  // 1c. A hand that plays no Character: its message only claims, its mark does not count, and the head says why.
  {
    keel.members = 'unplayed';
    await away();
    const v = await conversation(LETTERS, 'Letters Kept');
    const [a, b] = v.msgs;
    const UNPLAYED = 'A message written with a key whose holder plays no Character says only who it claims to be from.';
    check(tag, a?.from === 'From Ada Quill' && a.bold && b?.from === 'Claims to be from Mara Fenn' && !b.bold, `unplayed hand: the owner's message proved, m1's reply a claim (${a?.from} | ${b?.from})`);
    check(tag, a?.read === null && b?.read === 'Not yet by Ada Quill', `unplayed hand: m1's mark does not count, and Mara, whom nobody plays now, gets no "not yet" (${a?.read} | ${b?.read})`);
    check(tag, v.check === UNPLAYED && v.listCheck === UNPLAYED, `unplayed hand: the head says so (${v.check})`);
    await away();
    const c = await conversation(CONTRIB, 'Letters Shared');
    const both = 'A message written with a key whose holder plays no Character you can see says only who it claims to be from. ' + NOT_EVERY_MARK;
    check(tag, c.check === both && c.listCheck === both, `unplayed hand, as a contributor: both lines, "you can see" in the first (${c.check})`);
    keel.members = 'full';
  }

  // 2. Every failure is no list: every sender a claim, no read line, the one check line.
  for (const mode of [401, 403, 404, 410, 422, 429, 503, 'null', 'array', 'has_more', 'no-owner']) {
    keel.members = mode;
    await away();
    const n = membersCalls(LETTERS).length;
    const before = keel.calls.length;
    let v;
    try {
      v = await conversation(LETTERS, 'Letters Kept');
    } catch (e) {
      check(tag, false, `/members ${mode}: the world opens and its conversation draws (${String(e?.message ?? e).split('\n')[0]})`);
      continue;
    }
    check(tag, membersCalls(LETTERS).length === n + 1, `/members ${mode}: the world drew, and /members was asked once (${membersCalls(LETTERS).length - n})`);
    check(tag, !keel.calls.slice(before).some((c) => c.path === '/api/v2/account/worlds'), `/members ${mode}: no rung read follows a failed list`);
    check(tag, v.msgs.length === 2 && v.msgs.every((m) => m.from.startsWith('Claims to be from ') && !m.bold), `/members ${mode}: every sender a claim, none bold (${v.msgs.map((m) => m.from).join(' | ')})`);
    check(tag, v.msgs.every((m) => m.read === null) && !v.text.includes('Read by') && !/not yet/i.test(v.text), `/members ${mode}: no read line (${v.msgs.map((m) => m.read).join(' | ')})`);
    check(tag, v.check === NO_LIST && v.listCheck === NO_LIST, `/members ${mode}: the check line says the list could not be read (${v.check})`);
    if (mode === 401) {
      await page.goto(`${PROD}/#/`);
      await page.waitForSelector('.ways', { timeout: 15_000 });
      check(tag, ((await page.textContent('.who')) ?? '').startsWith('Signed in as wren') && (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 0, `/members 401: still signed in after (${await page.textContent('.ways .said')})`);
    }
  }
  keel.members = 'full';

  // 3. A contributor is not served every mark: only "Read by", never "not yet".
  {
    await away();
    const before = keel.calls.length;
    const v = await conversation(CONTRIB, 'Letters Shared');
    const [a, b] = v.msgs;
    check(tag, a?.from === 'From Ada Quill' && a.bold && b?.from === 'From Mara Fenn' && b.bold, `contributor: the senders are still proved (${a?.from} | ${b?.from})`);
    check(tag, a?.read === 'Read by Mara Fenn' && b?.read === null && !/not yet/i.test(v.text), `contributor: only "Read by", never "not yet" (${a?.read} | ${b?.read})`);
    check(tag, v.check === NOT_EVERY_MARK && v.listCheck === NOT_EVERY_MARK, `contributor: the check line says unseen marks are not counted (${v.check})`);
    check(tag, keel.calls.slice(before).filter((c) => c.path === '/api/v2/account/worlds').length === 1, 'contributor: the rung read fresh, once, on the open');
  }

  // 4. A held list lands for nobody: after Sign out, after another world, after another account.
  {
    await away();
    keel.holdMembers = true;
    keel.release = null;
    const n = membersCalls(LETTERS).length;
    await page.goto(`${PROD}/#/me/${LETTERS}`);
    check(tag, await waitFor(() => keel.release !== null, 10_000), 'held: the read reached /members');
    const said = await page.locator('main .said').first().textContent({ timeout: 2000 }).catch(() => null);
    check(tag, said === 'Reading who is in Letters Kept…', `held: the progress line says who is being read (${said})`);
    check(tag, (await page.locator('.tally').count()) === 0, 'held: nothing of the world is drawn while its list is read');
    await page.goto(`${PROD}/#/`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForSelector('.ways .said:has-text("Signed out")', { timeout: 15_000 });
    keel.release?.();
    keel.holdMembers = false;
    await sleep(800);
    const after = await page.evaluate(() => ({ hash: location.hash, tally: !!document.querySelector('.tally'), text: document.body.textContent }));
    check(tag, after.hash === '#/' && !after.tally && !after.text.includes('Ada Quill') && !after.text.includes('Letters Kept'), `released after Sign out: nothing of the world drawn (${after.hash}, tally ${after.tally})`);
    await signIn(page, keel);
    await page.locator('ul.mine').waitFor({ timeout: 15_000 });
    ownerReads('after Sign out, signed in again', await conversation(LETTERS, 'Letters Kept'));
    check(tag, membersCalls(LETTERS).length === n + 2, `after Sign out: the next open asked /members again (${membersCalls(LETTERS).length - n} in all)`);
  }
  {
    await away();
    keel.holdMembers = true;
    keel.release = null;
    const n = membersCalls(LETTERS).length;
    await page.goto(`${PROD}/#/me/${LETTERS}`);
    check(tag, await waitFor(() => keel.release !== null, 10_000), 'held again: the read reached /members');
    await page.goto(`${PROD}/#/me/${BARE}`);
    await drawn('beta');
    keel.release?.();
    keel.holdMembers = false;
    await sleep(800);
    const after = await page.evaluate(() => ({ hash: location.hash, name: document.querySelector('.wname')?.textContent, text: document.body.textContent }));
    check(tag, after.name === 'beta' && after.hash === `#/me/${BARE}` && !after.text.includes('Ada Quill'), `released after another world opened: that world stays, nothing of the first (${after.name}, ${after.hash})`);
    ownerReads('after another world', await conversation(LETTERS, 'Letters Kept'));
    check(tag, membersCalls(LETTERS).length === n + 2, `after another world: the next open asked /members again (${membersCalls(LETTERS).length - n} in all)`);
  }
  {
    await away();
    keel.holdMembers = true;
    keel.release = null;
    const n = membersCalls(LETTERS).length;
    await page.goto(`${PROD}/#/me/${LETTERS}`);
    check(tag, await waitFor(() => keel.release !== null, 10_000), 'held a third time: the read reached /members');
    const heldBy = membersCalls(LETTERS).at(-1)?.bearer;
    await page.goto(`${PROD}/#/`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForSelector('.ways .said:has-text("Signed out")', { timeout: 15_000 });
    keel.account = { id: 'acc-2', username: 'kit' };
    await signIn(page, keel);
    await page.locator('ul.mine').waitFor({ timeout: 15_000 });
    const kit = [...keel.tokens.keys()].at(-1);
    keel.release?.();
    keel.holdMembers = false;
    await sleep(800);
    const after = await page.evaluate(() => ({ hash: location.hash, who: document.querySelector('.who')?.textContent ?? '', tally: !!document.querySelector('.tally'), text: document.body.textContent }));
    check(tag, after.hash === '#/' && after.who.startsWith('Signed in as kit') && !after.tally && !after.text.includes('Ada Quill'), `released after another account signed in: kit's ways in, nothing of the first world (${after.who})`);
    ownerReads('the second account', await conversation(LETTERS, 'Letters Kept'));
    const last = membersCalls(LETTERS).at(-1);
    check(tag, membersCalls(LETTERS).length === n + 2 && last?.bearer === kit && heldBy !== kit, `after another account: the next open asked /members again, on the new token (${membersCalls(LETTERS).length - n} in all)`);
  }

  // 5. Signed in, a public world with messages and a world with no message ask for no list.
  {
    await away();
    let before = keel.calls.length;
    await page.goto(`${PROD}/#/w/${LETTERS}`);
    await page.waitForSelector('.wsub:has-text("public world")', { timeout: 15_000 });
    await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
    await page.waitForSelector('ul.threads');
    let reads = keel.calls.slice(before);
    check(tag, reads.length === 4 && !reads.some((c) => c.path.startsWith('/api/v2/members')) && reads.every((c) => c.bearer === null), `signed in, the public world with messages: 4 reads, no /members, no token (${reads.map((c) => c.path).join(' ')})`);
    before = keel.calls.length;
    await page.goto(`${PROD}/#/me/${BARE}`);
    await drawn('beta');
    await away();
    reads = keel.calls.slice(before).filter((c) => c.q.includes(`world=${MINE}`));
    check(tag, reads.map((c) => c.path).join(' ') === '/api/v2/world/ /api/v2/character/ /api/v2/location/', `signed in, a world with no message: its world and two types, no /members (${reads.map((c) => c.path).join(' ')})`);
    check(tag, !keel.calls.slice(before).some((c) => c.path.startsWith('/api/v2/members')), 'and no /members for the countless world either');
  }

  // 6. The played keel answers what it does not know 404, never an empty list.
  {
    const probe = await page.evaluate(async (w) => {
      const st = async (path) => (await fetch(`https://www.onlyworlds.com/api/v2${path}`, { credentials: 'omit' })).status;
      return { unknown: await st(`/nothing-here/?world=${w}`), nested: await st(`/character/x/?world=${w}`), members: await st(`/members/?world=${w}`), noWorld: await st('/members/'), known: await st(`/character/?world=${w}`) };
    }, LETTERS);
    check(tag, probe.unknown === 404 && probe.nested === 404 && probe.members === 404 && probe.noWorld === 422 && probe.known === 200, `the played keel: an unknown path 404, /members without a grant 404, without world= 422, a type 200 (${JSON.stringify(probe)})`);
  }
  check(tag, errors.length === 0, `no page error, no policy violation (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// 5. Another origin never offers it.
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
