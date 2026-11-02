// The Lens box on a real public world, signed out: every lens the world serves is listed by name, and
// choosing one redraws the web through it. The oracle is the SDK's own reading of the same keyless
// read, as the public reader (the page reads as the owner over what it was served): each lens's
// nodes and edges against the page's tally, the box's options against the lenses, then back to the
// whole world. Writes nothing.
//   node walk/live-lenses.mjs [base] [chromium|firefox] [--world <id>] [--phone]
// base: a served build (http://localhost:5173 with `npx vite preview --port 5173`; keel's CORS admits
// that origin) or https://little-lens.onlyworlds.com once flown. Default world: Moppetopia.
import { chromium, firefox } from '@playwright/test';
import { isLens, isTemplate, worldGraph, ELEMENT_TYPES } from '@onlyworlds/sdk';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173';
const engineName = args.includes('firefox') ? 'firefox' : 'chromium';
const phone = args.includes('--phone');
const wi = args.indexOf('--world');
const WORLD = wi >= 0 ? args[wi + 1] : '0695db52-5433-7332-8000-db7fe10da375';
const API = 'https://www.onlyworlds.com/api/v2';
const tag = `lenses-${engineName}${phone ? '-390' : ''}`;
let failures = 0;
const check = (ok, what) => { console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const watchdog = setTimeout(() => { console.log(`[${tag}] WATCHDOG: past 5 minutes`); process.exit(2); }, 300_000);
// keel's keyless budget is 60 reads a minute per visitor, the page's reads included: a 429 waits it out once.
const get = async (url, again = true) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 429 && again) {
    const wait = Number(r.headers.get('retry-after') ?? r.headers.get('x-ratelimit-reset') ?? 60);
    console.log(`[${tag}] keel's keyless budget spent: waiting ${wait} s`);
    await new Promise((res) => setTimeout(res, (wait + 1) * 1000));
    return get(url, false);
  }
  if (!r.ok) throw new Error(`${r.status} on ${url.replace(API, '')}`);
  return r.json();
};

// 1. The oracle: the world as keel serves it signed out, read by the SDK as the public reader.
const world = await get(`${API}/world/?world=${WORLD}`);
const counts = world.counts?.types ?? {};
const elements = [];
// Map space is no node for any reader here, so the oracle reads what the page reads.
for (const type of ELEMENT_TYPES) {
  if (!(counts[type] > 0) || ['map', 'pin', 'marker'].includes(type)) continue;
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ world: WORLD, limit: '1000' });
    if (cursor) q.set('cursor', cursor);
    const body = await get(`${API}/${type}/?${q}`);
    for (const row of body.data ?? []) elements.push({ ...row, type });
    if (body.has_more !== true || !body.next_cursor || body.next_cursor === cursor) break;
    cursor = body.next_cursor;
  }
}
const now = Number.isInteger(world.time_range_current) ? world.time_range_current : null;
const lenses = elements.filter((e) => isLens(e) && !isTemplate(e)).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'en'));
console.log(`[${tag}] ${world.name}: ${elements.length} elements served, ${lenses.length} lenses: ${lenses.map((l) => l.name).join(' · ') || 'none'}`);
const whole = worldGraph({ elements, now }, { rung: 'public' });
const oracle = new Map(lenses.map((l) => {
  const g = worldGraph({ elements, now }, { rung: 'public' }, { lens: l.id });
  return [l.id, { nodes: g.nodes.length, edges: g.edges.length, unreadable: g.unreadable }];
}));

// 2. The page.
const browser = await (engineName === 'firefox' ? firefox : chromium).launch();
const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tally = async () => {
  const t = await page.locator('.tally').innerText({ timeout: 20_000 }).catch(() => '');
  const m = t.match(/([\d,]+) elements · ([\d,]+) links/);
  return m ? { nodes: Number(m[1].replace(/,/g, '')), edges: Number(m[2].replace(/,/g, '')) } : null;
};
try {
  await page.goto(`${base}/#/w/${WORLD}`);
  await page.locator('.tally').waitFor({ timeout: 60_000 });
  const box = page.locator('select[aria-label="Lens"]');
  const options = await box.locator('option').allInnerTexts();
  check(options[0] === 'The whole world', 'the box starts on the whole world');
  check(JSON.stringify(options.slice(1)) === JSON.stringify(lenses.map((l) => String(l.name).trim() || 'Unnamed lens')), `the box lists the world's lenses by name (${options.length - 1})`);
  check((await box.isDisabled()) === (lenses.length === 0), lenses.length ? 'the box is open' : 'the box is shut: no lenses');
  const w0 = await tally();
  console.log(`[${tag}] whole world: page ${w0?.nodes}/${w0?.edges}, the SDK as the public reader ${whole.nodes.length}/${whole.edges.length}`);
  for (const l of lenses) {
    await box.selectOption(l.id);
    const o = oracle.get(l.id);
    if (o.unreadable || o.nodes === 0) {
      const said = await page.locator('main.world p.empty').innerText({ timeout: 10_000 }).catch(() => '');
      check(o.unreadable ? said.includes('cannot read the lens') : said.includes('keeps nothing'), `${l.name}: says ${o.unreadable ? 'it cannot be read' : 'it keeps nothing'}`);
      continue;
    }
    await page.waitForFunction((n) => document.querySelector('.tally')?.textContent?.includes(`${n} elements`), o.nodes, { timeout: 15_000 }).catch(() => {});
    const t = await tally();
    check(t?.nodes === o.nodes && t?.edges === o.edges, `${l.name}: the web draws ${t?.nodes}/${t?.edges}, the lens keeps ${o.nodes}/${o.edges}`);
    check((await page.locator('canvas').count()) > 0, `${l.name}: a web is drawn`);
    if (phone) {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      check(wide <= 390, `${l.name}: nothing scrolls sideways at 390 (${wide} px)`);
    }
    await page.screenshot({ path: `walk/out-${tag}-${l.id.slice(-6)}.png` });
  }
  // Switch to the list and back: the lens holds with the world.
  if (lenses.length) {
    const last = oracle.get(lenses[lenses.length - 1].id);
    await page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'List', exact: true }).click();
    await page.locator('ul.cards, main.world p.empty').first().waitFor({ timeout: 15_000 });
    const t = await tally();
    check(!last.nodes || t?.nodes === last.nodes, `the list keeps the chosen lens (${t?.nodes})`);
    await page.locator('select[aria-label="Lens"]').selectOption('');
    const back = await tally();
    check(back?.nodes === w0?.nodes && back?.edges === w0?.edges, `back to the whole world: ${back?.nodes}/${back?.edges}`);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  check(false, `the walk threw: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: `walk/out-${tag}-threw.png` }).catch(() => {});
} finally {
  await browser.close();
  clearTimeout(watchdog);
}
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
