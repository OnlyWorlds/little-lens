// The draught page's played walk: a served build against a played OnlyWorlds (every request to www
// answered here, none reaching the real server), to reach what a live walk cannot: races, failures,
// the clipboard refused, and request counts. A real mouse and keyboard, at a desk and at 390.
//   node walk/draught-played.mjs [base] [chromium|firefox]
// The played context route FENCES like keel: in each section a row stays only when its date (the
// lens profile's table, written out here on purpose) is null or <= as_of; it echoes as_of, now,
// policy.components (no `roster`, keel drops it for the public reader) and cut.
// Cases: 1 the way in (a Character offers it, a Location and a file world do not) · 2 a moment in
// the address, the list kept and what is dated after · 3 no moment: the world's now (as_of=453), and
// a world with no now reads the top once · 4 a drag and held keys read once, on release, one history
// entry · 5 races (a slow answer overtaken, both ways) · 6 Back and Forward in place, cached · 7 429
// with Retry-After, a 429 on the whole read, 404, 410 · 8 copy: the clipboard, and refused · 9 a cut
// · 10 no sideways scroll at 360 and 390 · 11 the requests of a cold open.
import { chromium, firefox } from '@playwright/test';
import { draughtText, writeWorldFile } from '@onlyworlds/sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:5173';
const which = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const baseHost = new URL(base).hostname;
const out = (name) => fileURLToPath(new URL(`./out-draught-played-${which}-${name}.png`, import.meta.url));

const WHOLE = 2147483647;
const NOW = 453;
const W = '11111111-1111-7111-8111-111111111111'; // a unit and a now
const WN = '22222222-2222-7222-8222-222222222222'; // a unit, no now
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C = id(1);
const BRAM = id(2);

// -- The played world --------------------------------------------------------------------------------

/** The lens profile's date field by type (the SDK's DATE_FIELD, written out so the fence is the walk's own). */
const DATE_FIELD = { character: 'birth_date', creature: 'birth_date', institution: 'founding_date', location: 'founding_date', collective: 'formation_date', law: 'date', title: 'grant_date', construct: 'start_date', event: 'start_date', narrative: 'start_date', relation: 'start_date', zone: 'start_date' };

const ADA = { type: 'character', id: C, name: 'Ada Vane', description: 'A harbour pilot.', birth_date: 100, rivals: [BRAM] };
const BRAM_EL = { type: 'character', id: BRAM, name: 'Bram Holt', description: 'Keeps the lighthouse.' };
const E = {
  admiral: { type: 'title', id: id(10), name: 'Admiral', grant_date: 150 },
  flood: { type: 'event', id: id(11), name: 'The Flood', start_date: 200 },
  storm: { type: 'event', id: id(12), name: 'The Storm', start_date: 320 },
  quiet: { type: 'event', id: id(13), name: 'The Quiet', start_date: 400 },
  chronicle: { type: 'narrative', id: id(14), name: 'The Chronicle', start_date: 250 },
  pact: { type: 'relation', id: id(15), name: 'The Old Pact', start_date: 350 },
  saltmere: { type: 'location', id: id(16), name: 'Saltmere', founding_date: 50 },
  navy: { type: 'institution', id: id(17), name: 'The Harbour Navy' },
};
const item = (element, via, dated) => ({ ...(dated === undefined ? {} : { dated }), via, her_links: 1, grade: 'whole', element });
// Eight rows: 5 dated up to 300 (Admiral, Flood, Chronicle, Saltmere, Navy undated), 3 dated after it.
const SRC = {
  role: [item(E.admiral, ['holders'])],
  events: [item(E.flood, ['characters'], true), item(E.storm, ['characters'], true), item(E.quiet, ['characters'], true)],
  names: { narrative: [item(E.chronicle, ['characters'])], relation: [item(E.pact, ['actor', 'characters'])] },
  sheet: [item(E.saltmere, ['birthplace']), item(E.navy, ['institutions'])],
};
const ALL_ELS = [ADA, BRAM_EL, ...Object.values(E)];
const AFTER_300 = ['The Storm', 'The Quiet', 'The Old Pact'];

const worldOf = (wid, name, now) => ({
  id: wid,
  name,
  description: 'A played coast.',
  time_basic_unit: 'year',
  ...(now === null ? {} : { time_range_current: now }),
  counts: { types: Object.fromEntries([...new Set(ALL_ELS.map((e) => e.type))].map((t) => [t, ALL_ELS.filter((e) => e.type === t).length])) },
});
const WORLDS = { [W]: worldOf(W, 'Draught Coast', NOW), [WN]: worldOf(WN, 'Nowless Coast', null) };
const LIST_TYPES = [...new Set(ALL_ELS.map((e) => e.type))].length;

/** keel's packet for Ada at `asOf`, fenced; `cut` drops names rows on the whole read only. */
function packetOf(wid, asOf, components, cut) {
  const keep = (it) => {
    const f = DATE_FIELD[it.element.type];
    const d = f ? it.element[f] : null;
    return d === null || d === undefined || d <= asOf;
  };
  const names = {};
  for (const [t, list] of Object.entries(SRC.names)) {
    const kept = list.filter(keep);
    if (kept.length) names[t] = kept;
  }
  let cutOut = {};
  if (cut && asOf === WHOLE) {
    let n = cut.names ?? 0;
    for (const t of Object.keys(names).reverse()) while (n > 0 && names[t].length) (names[t].pop(), n--);
    for (const t of Object.keys(names)) if (!names[t].length) delete names[t];
    cutOut = cut;
  }
  const comps = components.filter((c) => c !== 'roster');
  const now = wid === W ? NOW : null;
  return {
    world: { id: wid, name: WORLDS[wid].name, description: WORLDS[wid].description },
    calendar: { time_format_names: [], time_format_equivalents: [], time_basic_unit: 'Year', time_range_min: 0, time_range_max: 500, time_range_current: now },
    as_of: asOf,
    now,
    mode: 'voice',
    policy: { components: comps, mode: 'voice', as_of: asOf, undated: 'include', since: null, budget: 1000, depth: 1, compact: false },
    cut: cutOut,
    recent_cursor: null,
    recent_more: false,
    character: { self: true, grade: 'whole', element: ADA },
    role: SRC.role.filter(keep),
    work: [],
    style: null,
    events: SRC.events.filter(keep),
    knowledge: [],
    names,
    sheet: SRC.sheet.filter(keep),
    recent: [],
  };
}
const rowCount = (p) => p.role.length + p.work.length + p.events.length + p.knowledge.length + p.sheet.length + p.recent.length + Object.values(p.names).reduce((s, l) => s + l.length, 0);
const COMPONENTS = 'self,role,work,style,events,knowledge,names,sheet,roster'.split(',');
const plain = (p) => JSON.parse(JSON.stringify(p));
const N300 = rowCount(packetOf(W, 300, COMPONENTS, null));
const NALL = rowCount(packetOf(W, WHOLE, COMPONENTS, null));
const TEXT300 = draughtText(plain(packetOf(W, 300, COMPONENTS, null)));

// A world file with a Character in it: it offers no draught.
const dir = mkdtempSync(join(tmpdir(), 'll-draught-'));
const enc = new TextEncoder();
const part = (path, body) => ({ path, data: enc.encode(JSON.stringify(body)) });
const worldFile = join(dir, 'file-world.owworld');
writeFileSync(worldFile, writeWorldFile([part('world.json', { id: 'file-w', name: 'File world', time_basic_unit: 'year', time_current: 453 }), part('elements/character/a.json', { id: 'f1', name: 'Filed Ada', birth_date: 100 }), part('elements/event/b.json', { id: 'f2', name: 'Filed Flood', start_date: 200 })], 'file-world'));

// -- The walk's own bookkeeping ----------------------------------------------------------------------

let checks = 0;
const fails = [];
function check(label, ok, detail = '') {
  checks++;
  if (!ok) fails.push(`${label}${detail !== '' ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== '' ? ` · ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('draught-played: watchdog, 420 s');
  process.exit(2);
}, 420_000);

/** A page against the played keel; `S` holds what the walk plays and what it saw. */
async function open(viewport, { clipboard = false, init = null } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (clipboard && which === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  if (init) await ctx.addInitScript(init);
  const S = { log: [], ctx: [], stray: [], delay: {}, fail: {}, cut: null, errors: [] };
  // Anything that is neither this build nor the played www is a failure, and never goes out.
  await ctx.route(
    (u) => u.hostname !== baseHost && u.hostname !== 'www.onlyworlds.com' && !/^(data|blob|about):/.test(u.protocol),
    (route) => {
      S.stray.push(route.request().url());
      return route.abort();
    },
  );
  await ctx.route('https://www.onlyworlds.com/**', async (route) => {
    const u = new URL(route.request().url());
    const send = async (status, body, headers = {}) => {
      try {
        await route.fulfill({
          status,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After, RateLimit-Remaining, RateLimit-Reset', ...headers },
          body: JSON.stringify(body),
        });
      } catch {
        /* the page aborted it: a late answer to nobody */
      }
    };
    S.log.push(u.pathname + u.search);
    const wid = u.searchParams.get('world');
    const w = WORLDS[wid];
    if (!w) return send(404, { error: { code: 'not_found' } });
    if (u.pathname === '/api/v2/world/') return send(200, w);
    const m = u.pathname.match(/^\/api\/v2\/character\/([^/]+)\/context$/);
    if (m) {
      const asOf = Number(u.searchParams.get('as_of'));
      S.ctx.push(asOf);
      if (S.delay[asOf]) await sleep(S.delay[asOf]);
      const f = S.fail[asOf];
      if (f) return send(f.status, { error: { code: 'played' } }, f.headers ?? {});
      if (m[1].toLowerCase() !== C) return send(404, { error: { code: 'not_found' } });
      return send(200, packetOf(wid, asOf, (u.searchParams.get('components') ?? '').split(',').filter(Boolean), S.cut));
    }
    const type = u.pathname.split('/')[3];
    return send(200, { data: ALL_ELS.filter((e) => e.type === type).map(({ type: _t, ...rest }) => rest), has_more: false, next_cursor: null });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (e) => S.errors.push(String(e)));
  return { ctx, page, S };
}

/** One case in one viewport: a fresh page, then the page errors and strays it must not have. */
async function scenario(vpLabel, name, viewport, opts, fn) {
  const { ctx, page, S } = await open(viewport, opts);
  const t = (tag, ok, detail = '') => check(`${vpLabel} ${name}: ${tag}`, ok, detail);
  try {
    await fn({ page, S, t, ctx });
  } catch (e) {
    t('the case ran to its end', false, String(e).split('\n')[0]);
  }
  t('no page errors', S.errors.length === 0, S.errors.slice(0, 3).join(' | '));
  t('nothing reached beyond the played keel', S.stray.length === 0, S.stray.slice(0, 3).join(' | '));
  await ctx.close();
}

// -- Helpers on the page ------------------------------------------------------------------------------

const draughtAt = (wid, at) => `${base}/#/w/${wid}/e/${C}/draught${at === undefined ? '' : `?at=${at}`}`;
const cap = (page) => page.textContent('.dcap');
const waitCap = (page, text) => page.waitForFunction((t) => (document.querySelector('.dcap')?.textContent ?? '') === t, text);
const waitCapStarts = (page, text) => page.waitForFunction((t) => (document.querySelector('.dcap')?.textContent ?? '').startsWith(t), text);
/** The whole read has landed: the second way's pill is drawn and not disabled. */
const waitWhole = (page) => page.waitForFunction(() => document.querySelector('.dways .pill:nth-child(2)') && !document.querySelector('.dways .pill:nth-child(2)').disabled);
const histLen = (page) => page.evaluate(() => history.length);
const rowNames = (page) => page.locator('.dbody .drow .dn').allTextContents();
const captionRecorder = () => {
  window.__caps = [];
  const rec = () => {
    const t = document.querySelector('.dcap')?.textContent;
    if (t && window.__caps[window.__caps.length - 1] !== t) window.__caps.push(t);
  };
  new MutationObserver(rec).observe(document, { subtree: true, childList: true, characterData: true });
};
const dbg = (n) => `${n} rows`;

const VIEWPORTS = [['desk', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]];

for (const [vp, viewport] of VIEWPORTS) {
  // 1. The way in.
  await scenario(vp, 'the way in', viewport, {}, async ({ page, S, t }) => {
    await page.goto(`${base}/#/w/${W}/e/${C}`);
    await page.waitForSelector('main.element');
    t('a Character offers its draught', (await page.locator('a.dway').count()) === 1);
    t('the way leads to the draught address', ((await page.getAttribute('a.dway', 'href')) ?? '').endsWith(`/e/${C}/draught`), await page.getAttribute('a.dway', 'href'));
    await page.goto(`${base}/#/w/${W}/e/${E.saltmere.id}`);
    await page.waitForFunction(() => /Saltmere/.test(document.body.textContent ?? ''));
    t('a Location offers none', (await page.locator('main.element').count()) === 1 && (await page.locator('a.dway').count()) === 0);
    t('no context read by the element pages', S.ctx.length === 0, String(S.ctx.length));
  });
  await scenario(vp, 'a world file', viewport, {}, async ({ page, S, t }) => {
    await page.goto(`${base}/#/`);
    const chooser = page.waitForEvent('filechooser');
    await page.click('text=Open a world file');
    await (await chooser).setFiles(worldFile);
    await page.waitForSelector('canvas.webcanvas, .cards', { timeout: 20_000 });
    await page.evaluate(() => (location.hash = '#/file/e/f1'));
    await page.waitForSelector('main.element');
    t('a Character from a file is on screen', /Filed Ada/.test((await page.textContent('main.element')) ?? ''));
    t('a world opened from a file offers no draught', (await page.locator('a.dway').count()) === 0);
    t('and read nothing from OnlyWorlds', S.log.length === 0, S.log.join(' '));
  });

  // 2. A moment in the address.
  await scenario(vp, 'at 300', viewport, {}, async ({ page, S, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await waitWhole(page);
    t(`the caption says year 300 and the fenced count, ${N300}`, (await cap(page)) === `Dated up to year 300: ${dbg(N300)}`, await cap(page));
    t('the kept list draws that many rows', (await page.locator('.dbody .drow').count()) === N300, String(await page.locator('.dbody .drow').count()));
    t('nothing dated after 300 is in the kept list', !(await rowNames(page)).some((n) => AFTER_300.includes(n)), (await rowNames(page)).join('|'));
    t('the request carries as_of=300 and the SDK budget', S.log.some((l) => /\/context\?/.test(l) && l.includes('as_of=300') && l.includes('budget=1000')), S.log.filter((l) => /context/.test(l)).join(' '));
    t('the components asked end in roster, keyless', S.log.some((l) => /components=[^&]*roster/.test(l)));
    t('the pill counts the kept list', (await page.textContent('.dways .pill:nth-child(1)')) === `The list kept · ${N300}`, await page.textContent('.dways .pill:nth-child(1)'));
    t('and the rows dated after', (await page.textContent('.dways .pill:nth-child(2)')) === `Dated after year 300 · ${AFTER_300.length}`, await page.textContent('.dways .pill:nth-child(2)'));
    await page.screenshot({ path: out(`${vp}-1-at300`), fullPage: true });
    await page.click('.dways .pill:nth-child(2)');
    const after = await rowNames(page);
    t('the after way lists exactly the 3', after.length === AFTER_300.length && [...after].sort().join('|') === [...AFTER_300].sort().join('|'), after.join('|'));
    t('its caption', (await cap(page)) === `Dated after year 300: ${AFTER_300.length} rows`, await cap(page));
    t('it says it was found by a second read', (await page.locator('.dfound').count()) === 1);
    await page.screenshot({ path: out(`${vp}-2-after`), fullPage: true });
  });

  // 3. No moment in the address.
  await scenario(vp, 'no moment: the now', viewport, {}, async ({ page, S, t }) => {
    await page.goto(`${base}/#/w/${W}/e/${C}`);
    await page.click('a.dway');
    await waitCap(page, `Dated up to year ${NOW}: ${dbg(NALL)}`);
    await page.waitForSelector('.strip');
    await sleep(600);
    t(`the first read is as_of=${NOW}`, S.ctx[0] === NOW, S.ctx.join(','));
    t('the second is the whole read, nothing else', S.ctx.length === 2 && S.ctx[1] === WHOLE, S.ctx.join(','));
    t('the address carries no moment', !page.url().includes('at='), page.url());
    t('the caption is the now', (await cap(page)) === `Dated up to year ${NOW}: ${dbg(NALL)}`, await cap(page));
    t('the way back to the now is not offered at the now', (await page.locator('.dnow').count()) === 0);
    t('nothing is dated after the now: the second way is disabled and says so', (await page.locator('.dways .pill:nth-child(2)').isDisabled()) && ((await page.textContent('.dcutnote')) ?? '').includes(`Nothing in this draught is dated after year ${NOW}`), await page.textContent('.dways'));
  });
  await scenario(vp, 'no now', viewport, {}, async ({ page, S, t }) => {
    await page.goto(draughtAt(WN));
    await waitCapStarts(page, 'Everything the record holds');
    await sleep(900);
    t('a world with no now reads as_of=2147483647 once, one request', S.ctx.length === 1 && S.ctx[0] === WHOLE, S.ctx.join(','));
    t('the caption starts "Everything the record holds"', (await cap(page)).startsWith('Everything the record holds'), await cap(page));
    t('and counts the rows', (await cap(page)) === `Everything the record holds, nothing dated is fenced: ${dbg(NALL)}`, await cap(page));
    t('no after way is drawn', (await page.locator('.dways .pill').count()) === 0);
    t('the strip still draws from the one read', (await page.locator('.strip').count()) === 1);
  });

  // 4. A drag and held keys.
  await scenario(vp, 'a drag', viewport, {}, async ({ page, S, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await page.waitForSelector('.strip');
    await waitWhole(page);
    const readsBefore = S.ctx.length;
    const len0 = await histLen(page);
    const box = await page.locator('.strip').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.7, y);
    await page.mouse.down();
    for (const f of [0.6, 0.5, 0.42, 0.35]) await page.mouse.move(box.x + box.width * f, y, { steps: 4 });
    await sleep(300);
    const mid = await page.evaluate(() => ({ now: document.querySelector('.strip').getAttribute('aria-valuenow'), hash: location.hash, len: history.length }));
    t('while the mouse is down nothing is read', S.ctx.length === readsBefore, `${S.ctx.length - readsBefore} new`);
    t('while it is down the address follows without an entry', mid.len === len0 && mid.hash.endsWith(`at=${mid.now}`), `${mid.hash} len ${mid.len}`);
    await page.mouse.up();
    const to = Number((await page.getAttribute('.strip', 'aria-valuenow')) ?? NaN);
    await waitCapStarts(page, `Dated up to year ${to}:`);
    await sleep(400);
    const fresh = ![300, NOW, WHOLE].includes(to);
    t('the drag ended on a moment not read before', fresh, `ended on ${to}`);
    t('exactly one new context read, for the moment it ended on', S.ctx.length === readsBefore + 1 && S.ctx[S.ctx.length - 1] === to, `${S.ctx.slice(readsBefore).join(',')} for ${to}`);
    t('one history entry', (await histLen(page)) === len0 + 1, `${len0} -> ${await histLen(page)}`);
    t('the address holds the moment', (await page.evaluate(() => location.hash)).endsWith(`/draught?at=${to}`), await page.evaluate(() => location.hash));
    t('the caption is the packet at that moment', /^Dated up to year \d+: \d+ rows$/.test(await cap(page)), await cap(page));
  });
  await scenario(vp, 'held keys', viewport, {}, async ({ page, S, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await page.waitForSelector('.strip');
    await waitWhole(page);
    await page.focus('.strip');
    const readsBefore = S.ctx.length;
    const len0 = await histLen(page);
    for (let i = 0; i < 3; i++) await page.keyboard.down('ArrowLeft'); // held: the key repeats
    await sleep(300);
    const held = await page.evaluate(() => ({ now: document.querySelector('.strip').getAttribute('aria-valuenow'), hash: location.hash, len: history.length }));
    t('while the key is held nothing is read', S.ctx.length === readsBefore, `${S.ctx.length - readsBefore} new`);
    t('the strip moved left of 300 and the address follows without an entry', Number(held.now) < 300 && held.hash.endsWith(`at=${held.now}`) && held.len === len0, JSON.stringify(held));
    await page.keyboard.up('ArrowLeft');
    const to = Number(held.now);
    await waitCapStarts(page, `Dated up to year ${to}:`);
    await sleep(400);
    t('on keyup exactly one read, for where the run ended', S.ctx.length === readsBefore + 1 && S.ctx[S.ctx.length - 1] === to, `${S.ctx.slice(readsBefore).join(',')} for ${to}`);
    t('one history entry', (await histLen(page)) === len0 + 1, `${len0} -> ${await histLen(page)}`);
    // Repeated presses: each press is a run of its own, one read each.
    const r1 = S.ctx.length;
    await page.keyboard.press('ArrowLeft');
    const to2 = Number(await page.getAttribute('.strip', 'aria-valuenow'));
    await waitCapStarts(page, `Dated up to year ${to2}:`);
    await sleep(300);
    t('a single press reads once, on its keyup', S.ctx.length === r1 + 1 && S.ctx[S.ctx.length - 1] === to2 && to2 < to, `${S.ctx.slice(r1).join(',')} for ${to2}`);
  });

  // 5. Races: a slow answer overtaken by the moment the page has moved to.
  await scenario(vp, 'race: a slow 300 overtaken by 453', viewport, { init: captionRecorder }, async ({ page, S, t }) => {
    S.delay[300] = 2000;
    await page.goto(draughtAt(W, 300));
    await page.waitForSelector('.strip');
    await page.evaluate((h) => (location.hash = h), `#/w/${W}/e/${C}/draught?at=${NOW}`);
    await waitCap(page, `Dated up to year ${NOW}: ${dbg(NALL)}`);
    const settledAt = Date.now();
    await sleep(2600); // the slow answer for 300 would land inside this
    const caps = await page.evaluate(() => window.__caps);
    const first453 = caps.findIndex((c) => c.includes(`year ${NOW}`));
    t('the caption ends on 453\'s packet', (await cap(page)) === `Dated up to year ${NOW}: ${dbg(NALL)}`, await cap(page));
    t('300\'s caption never shows after 453\'s', first453 >= 0 && !caps.slice(first453).some((c) => c.includes('year 300')), caps.join(' | '));
    t('300\'s caption never shows at all', !caps.some((c) => c.includes('year 300')), caps.join(' | '));
    t('both moments were asked, 300 first', S.ctx.indexOf(300) !== -1 && S.ctx.indexOf(NOW) > S.ctx.indexOf(300), S.ctx.join(','));
    t('the strip and the address say 453', (await page.getAttribute('.strip', 'aria-valuenow')) === String(NOW) && page.url().endsWith(`at=${NOW}`), `${await page.getAttribute('.strip', 'aria-valuenow')} ${page.url()}`);
    t('no "Reading up to" line left over', ((await page.textContent('.draught .said')) ?? '') === '', await page.textContent('.draught .said'));
    void settledAt;
  });
  await scenario(vp, 'race: a slow 453 overtaken by 300', viewport, { init: captionRecorder }, async ({ page, S, t }) => {
    S.delay[NOW] = 2000;
    await page.goto(draughtAt(W, NOW));
    await page.waitForSelector('.strip');
    await page.evaluate((h) => (location.hash = h), `#/w/${W}/e/${C}/draught?at=300`);
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await sleep(2600);
    const caps = await page.evaluate(() => window.__caps);
    t('the caption stays on 300\'s packet', (await cap(page)) === `Dated up to year 300: ${dbg(N300)}`, await cap(page));
    t('453\'s caption never shows', !caps.some((c) => c.includes(`year ${NOW}`)), caps.join(' | '));
    t('the rows are 300\'s', (await page.locator('.dbody .drow').count()) === N300);
  });

  // 6. Back and Forward between two moments: in place, from the cache.
  await scenario(vp, 'back and forward', viewport, {}, async ({ page, S, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await page.waitForSelector('.strip');
    await waitWhole(page);
    // The page is made tall enough to scroll, so "still" means something; both entries are scrolled
    // alike, because the browser restores each entry's own scroll on Back (a scrollTo(0,0) would show).
    await page.evaluate(() => {
      document.body.style.paddingBottom = '3000px';
      document.querySelector('main.draught').dataset.walk = 'same';
      window.scrollTo(0, 60);
    });
    await sleep(200);
    await page.evaluate((h) => (location.hash = h), `#/w/${W}/e/${C}/draught?at=${NOW}`);
    await waitCap(page, `Dated up to year ${NOW}: ${dbg(NALL)}`);
    await sleep(300);
    const y0 = await page.evaluate(() => window.scrollY);
    const reads = S.ctx.length;
    const logLen = S.log.length;
    await page.goBack();
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    const back = await page.evaluate(() => ({ y: window.scrollY, same: document.querySelector('main.draught')?.dataset.walk === 'same', strip: document.querySelector('.strip')?.getAttribute('aria-valuenow') }));
    t('the page was scrolled to start with', y0 > 0, String(y0));
    t('Back redraws in place: scrollY unchanged', back.y === y0, `${y0} -> ${back.y}`);
    t('Back keeps the same page element', back.same === true);
    t('the strip follows to 300', back.strip === '300', back.strip);
    await page.goForward();
    await waitCap(page, `Dated up to year ${NOW}: ${dbg(NALL)}`);
    const fwd = await page.evaluate(() => ({ y: window.scrollY, same: document.querySelector('main.draught')?.dataset.walk === 'same', strip: document.querySelector('.strip')?.getAttribute('aria-valuenow') }));
    t('Forward redraws in place: scrollY unchanged', fwd.y === y0 && fwd.same === true, `${y0} -> ${fwd.y}`);
    t('the strip follows to 453', fwd.strip === String(NOW), fwd.strip);
    await sleep(400);
    t('no new request for a moment already read', S.ctx.length === reads && S.log.length === logLen, S.log.slice(logLen).join(' '));
  });

  // 7. Failures.
  await scenario(vp, '429 on the moment', viewport, {}, async ({ page, S, t }) => {
    S.fail[300] = { status: 429, headers: { 'retry-after': '7' } };
    await page.goto(draughtAt(W, 300));
    await page.waitForSelector('.draught .said button');
    const said = (await page.textContent('.draught .said')) ?? '';
    t('the status says slow down', /slow down/.test(said), said);
    t('and 7 seconds', said.includes('7 seconds'), said);
    t('and offers Try again', (await page.textContent('.draught .said button')) === 'Try again');
    t('no packet is drawn, no caption', (await page.locator('.dpanel:not([hidden])').count()) === 0);
    delete S.fail[300];
    await page.click('.draught .said button');
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await sleep(300);
    t('Try again, healed, draws the packet', (await cap(page)) === `Dated up to year 300: ${dbg(N300)}`, await cap(page));
    t('and the status line clears', ((await page.textContent('.draught .said')) ?? '') === '', await page.textContent('.draught .said'));
    t('300 was asked twice, the whole once', S.ctx.filter((a) => a === 300).length === 2 && S.ctx.filter((a) => a === WHOLE).length === 1, S.ctx.join(','));
  });
  await scenario(vp, '429 on the whole read', viewport, {}, async ({ page, S, t }) => {
    S.fail[WHOLE] = { status: 429, headers: { 'retry-after': '7' } };
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await page.waitForSelector('.draught .said button');
    const said = (await page.textContent('.draught .said')) ?? '';
    t('the moment\'s packet stays drawn, the status says slow down', /slow down/.test(said) && said.includes('7 seconds'), said);
    t('the second way cannot be told yet and is disabled', await page.locator('.dways .pill:nth-child(2)').isDisabled(), await page.textContent('.dways .pill:nth-child(2)'));
    delete S.fail[WHOLE];
    await page.click('.draught .said button');
    await waitWhole(page);
    t('Try again reads the whole, and the second way counts 3', (await page.textContent('.dways .pill:nth-child(2)')) === `Dated after year 300 · ${AFTER_300.length}`, await page.textContent('.dways .pill:nth-child(2)'));
  });
  for (const status of [404, 410]) {
    await scenario(vp, `${status} on the context route`, viewport, {}, async ({ page, S, t }) => {
      S.fail[300] = { status };
      await page.goto(draughtAt(W, 300));
      await page.waitForSelector('main.closed h1');
      t('the page says it cannot be read', (await page.textContent('main.closed h1')) === "You cannot read this Character's draught", await page.textContent('main.closed h1'));
      t('and offers the way back to the element', ((await page.getAttribute('main.closed a.way', 'href')) ?? '').endsWith(`/e/${C}`));
      await sleep(400);
      t('and stays so once the other read lands', (await page.locator('main.closed h1').count()) === 1 && (await page.locator('.dcap').count()) === 0);
    });
  }

  // 8. Copy.
  await scenario(vp, 'copy', viewport, { clipboard: true }, async ({ page, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await page.click('.dcopy');
    await page.waitForFunction(() => (document.querySelector('.dcopied')?.textContent ?? '') !== '');
    const line = (await page.textContent('.dcopied')) ?? '';
    const btn = await page.textContent('.dcopy');
    t('the line names the moment', line.includes('dated up to year 300'), line);
    if (which === 'chromium') {
      const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'); // the OS clipboard is CRLF on Windows
      t('the clipboard starts with "# "', clip.startsWith('# '), clip.slice(0, 60).replace(/\n/g, ' / '));
      t('it contains "dated up to year 300" (the SDK writes the unit as keel\'s calendar does: "Year")', /dated up to year 300/i.test(clip), clip.split('\n').slice(0, 2).join(' / '));
      t('it is the SDK\'s text of the packet at 300', clip === TEXT300, `${clip.length} vs ${TEXT300.length}`);
      t('the button says Copied', btn === 'Copied', btn);
      t('the line says it is on the clipboard', line.startsWith('On your clipboard: Ada Vane, dated up to year 300'), line);
    } else {
      // Firefox: the clipboard cannot be read from a page here; either the write was allowed or the box shows the text.
      const boxed = await page.locator('.dbox').isVisible();
      t('allowed (Copied) or refused (the box), never silent', btn === 'Copied' || (btn === 'Select and copy' && boxed), btn);
      if (boxed) t('the box holds the SDK\'s text', (await page.inputValue('.dbox')) === TEXT300);
    }
  });
  await scenario(vp, 'copy refused', viewport, { init: () => { const no = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); try { navigator.clipboard.writeText = no; } catch { /* instance */ } try { Object.defineProperty(navigator.clipboard, 'writeText', { value: no, configurable: true }); } catch { /* prototype */ } try { Object.defineProperty(Clipboard.prototype, 'writeText', { value: no, configurable: true }); } catch { /* none */ } } }, async ({ page, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    t('the box is hidden before', !(await page.locator('.dbox').isVisible()));
    await page.click('.dcopy');
    await page.waitForFunction(() => document.querySelector('.dcopy')?.textContent === 'Select and copy');
    t('the button reads "Select and copy"', (await page.textContent('.dcopy')) === 'Select and copy');
    t('the box is visible', await page.locator('.dbox').isVisible());
    const val = await page.inputValue('.dbox');
    t('its value is the SDK\'s text of the packet at 300', val === TEXT300, `${val.length} vs ${TEXT300.length}`);
    t('the line says the browser did not allow it, and the moment', /did not allow/.test((await page.textContent('.dcopied')) ?? '') && ((await page.textContent('.dcopied')) ?? '').includes('dated up to year 300'), await page.textContent('.dcopied'));
    t('the box is the focused, selected text', await page.evaluate(() => document.activeElement?.classList.contains('dbox') && document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === document.activeElement.value.length));
    await page.screenshot({ path: out(`${vp}-3-refused`), fullPage: true });
  });

  // 9. A cut.
  await scenario(vp, 'a cut', viewport, {}, async ({ page, S, t }) => {
    S.cut = { names: 2 };
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await page.waitForSelector('.dcutnote');
    const pill = page.locator('.dways .pill:nth-child(2)');
    t('the after way is disabled', await pill.isDisabled(), await pill.textContent());
    const note = (await page.textContent('.dcutnote')) ?? '';
    t('a note says keel\'s budget left rows out', /keel's budget left rows out/.test(note), note);
    t('the kept list still draws the moment\'s packet', (await page.locator('.dbody .drow').count()) === N300);
    t('the caption stays honest', (await cap(page)) === `Dated up to year 300: ${dbg(N300)}`, await cap(page));
  });
}

// 10. No sideways scroll on a narrow phone.
for (const [vp, viewport] of [['360', { width: 360, height: 740 }], ['390', { width: 390, height: 844 }]]) {
  const noSide = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  await scenario(vp, 'no sideways scroll', viewport, { init: () => { const no = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); try { navigator.clipboard.writeText = no; } catch { /* instance */ } try { Object.defineProperty(Clipboard.prototype, 'writeText', { value: no, configurable: true }); } catch { /* none */ } } }, async ({ page, t }) => {
    await page.goto(draughtAt(W, 300));
    await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
    await waitWhole(page);
    let m = await noSide(page);
    t('the kept list fits', m.sw <= m.iw, `${m.sw} <= ${m.iw}`);
    await page.click('.dways .pill:nth-child(2)');
    m = await noSide(page);
    t('the after list fits', m.sw <= m.iw, `${m.sw} <= ${m.iw}`);
    await page.click('.dways .pill:nth-child(1)');
    await page.click('.dcopy');
    await page.waitForFunction(() => document.querySelector('.dcopy')?.textContent === 'Select and copy');
    m = await noSide(page);
    t('the refused-copy box fits', m.sw <= m.iw, `${m.sw} <= ${m.iw}`);
    await page.goto(draughtAt(WN));
    await waitCapStarts(page, 'Everything the record holds');
    m = await noSide(page);
    t('the whole read fits', m.sw <= m.iw, `${m.sw} <= ${m.iw}`);
  });
}

// 11. The requests of a cold open.
await scenario('desk', 'cold open', VIEWPORTS[0][1], {}, async ({ page, S, t }) => {
  await page.goto(draughtAt(W, 300));
  await waitCap(page, `Dated up to year 300: ${dbg(N300)}`);
  await waitWhole(page);
  await sleep(600);
  const world = S.log.filter((l) => l.startsWith('/api/v2/world/')).length;
  const ctxN = S.ctx.length;
  const lists = S.log.length - world - ctxN;
  console.log(`cold open of a draught address: ${S.log.length} OnlyWorlds requests (world ${world}, ${lists} type lists, ${ctxN} context reads: ${S.ctx.join(', ')})`);
  t('one world read', world === 1, String(world));
  t(`one list per type held (${LIST_TYPES})`, lists === LIST_TYPES, String(lists));
  t('two context reads: the moment and the whole', ctxN === 2 && S.ctx[0] === 300 && S.ctx[1] === WHOLE, S.ctx.join(','));
  t(`${1 + LIST_TYPES + 2} OnlyWorlds requests in all`, S.log.length === 1 + LIST_TYPES + 2, String(S.log.length));
});

clearTimeout(watchdog);
await browser.close();
console.log(`draught-played ${which} on ${base}: ${checks - fails.length}/${checks}`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
