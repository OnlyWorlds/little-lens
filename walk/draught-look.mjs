// The draught at a date on real OnlyWorlds: public Moppetopia's Admiral Fluffington, signed out,
// at year 300 and at the world's now, the list kept and what is dated after, Back and Forward,
// and the copy, at a desk and at 390. Each count on the page is checked against keel's own answer,
// read fresh by this walk (keyless, as the page reads it).
//   node walk/draught-look.mjs [base] [chromium|firefox] [--expect-old]
// `--expect-old`: the control. A build without the draught must fail every check.
import { chromium, firefox } from '@playwright/test';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = args[0] ?? 'http://localhost:5173';
const name = args[1] === 'firefox' ? 'firefox' : 'chromium';
const engine = name === 'firefox' ? firefox : chromium;
const expectOld = process.argv.includes('--expect-old');
const W = '0695db52-5433-7332-8000-db7fe10da375';
const C = '0695db83-afd7-76ee-8000-00f4295f8866';
const API = 'https://www.onlyworlds.com/api/v2';

const watchdog = setTimeout(() => {
  console.error('draught-look: watchdog, 360 s');
  process.exit(2);
}, 360_000);

// keel's own answer, keyless, each request with its own limit.
async function draught(asOf) {
  const q = new URLSearchParams({ world: W, budget: '1000' });
  if (asOf !== null) q.set('as_of', String(asOf));
  const res = await fetch(`${API}/character/${C}/context?${q}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`keel ${res.status}`);
  return res.json();
}
const keysOf = (d) => {
  const out = [];
  for (const s of ['role', 'work', 'events', 'knowledge', 'sheet', 'recent']) for (const it of d[s] ?? []) out.push(`${it.element.type}:${it.element.id}`);
  if (d.style) out.push(`${d.style.element.type}:${d.style.element.id}`);
  for (const list of Object.values(d.names ?? {})) for (const it of list) out.push(`${it.element.type}:${it.element.id}`);
  return out;
};
const at300 = keysOf(await draught(300));
const all = keysOf(await draught(2147483647));
const after300 = all.filter((k) => !at300.includes(k));
const now = (await draught(null)).now;
console.log(`keel: at 300 ${at300.length} rows, whole ${all.length}, after 300 ${after300.length}, now ${now}`);

const browser = await engine.launch();
const results = [];
const check = (label, ok, said) => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${said !== undefined ? ` · ${said}` : ''}`);
};

for (const [label, viewport] of [['desk', { width: 1440, height: 900 }], ['390', { width: 390, height: 844, isMobile: name === 'chromium', hasTouch: true }]]) {
  const context = await browser.newContext({ viewport });
  if (name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.setDefaultTimeout(30_000);
  try {
    // The way in: the element page of a Character offers the draught.
    // The world's read waits out keel's keyless budget (60 a minute) when an earlier run spent it.
    await page.goto(`${base}/#/w/${W}/e/${C}`);
    await page.waitForSelector('.eview', { timeout: 120_000 });
    const way = page.locator('a.dway');
    check(`${label}: a Character's page offers its draught`, (await way.count()) === 1);
    await way.click();
    await page.waitForSelector('.dcap');
    await page.waitForFunction(() => document.querySelector('.dways .pill:nth-child(2)') && !document.querySelector('.dways .pill:nth-child(2)').disabled);
    const capNow = await page.textContent('.dcap');
    check(`${label}: at the world's now, the caption is keel's count`, capNow.includes(`: ${all.length} rows`), capNow);
    await page.screenshot({ path: `walk/out-draught-${name}-${label}-1-now.png`, fullPage: true });

    // A moment in the address: year 300.
    await page.goto(`${base}/#/w/${W}/e/${C}/draught?at=300`);
    await page.waitForFunction((n) => (document.querySelector('.dcap')?.textContent ?? '').includes(`: ${n} rows`), at300.length);
    await page.waitForFunction(() => !document.querySelector('.dways .pill:nth-child(2)')?.disabled);
    const cap = await page.textContent('.dcap');
    const rows = await page.locator('.dbody .drow').count();
    check(`${label}: at 300, ${at300.length} rows as keel holds them`, cap.includes(`: ${at300.length} rows`) && rows === at300.length, `${cap} · ${rows} drawn`);
    await page.screenshot({ path: `walk/out-draught-${name}-${label}-2-at300.png`, fullPage: true });
    await page.click('.dways .pill:nth-child(2)');
    const afterRows = await page.locator('.dbody .drow').count();
    const capAfter = await page.textContent('.dcap');
    check(`${label}: dated after 300, ${after300.length} rows`, afterRows === after300.length && capAfter.startsWith('Dated after'), `${capAfter} · ${afterRows} drawn`);
    check(`${label}: the after list says it was found by a second read`, (await page.locator('.dfound').count()) === 1);
    await page.screenshot({ path: `walk/out-draught-${name}-${label}-3-after.png`, fullPage: true });

    // Copy: the SDK's text of the packet on screen.
    await page.click('.dways .pill:nth-child(1)');
    await page.click('.dcopy');
    await page.waitForFunction(() => /Copied|Select and copy/.test(document.querySelector('.dcopy')?.textContent ?? ''));
    const copiedLine = await page.textContent('.dcopied');
    let pasted = null;
    if (name === 'chromium') pasted = await page.evaluate(() => navigator.clipboard.readText());
    else if (await page.locator('.dbox:not([hidden])').count()) pasted = await page.inputValue('.dbox');
    // The moment in the world's own words, as the caption says it.
    const capWords = cap.slice('Dated up to '.length, cap.lastIndexOf(':'));
    const okText = copiedLine.includes(`Admiral Fluffington, dated up to ${capWords}`) && (pasted === null || pasted.includes('Admiral Fluffington'));
    check(`${label}: the copy is the draught at 300`, okText, copiedLine.slice(0, 120));

    // Back returns to the now's address, and the caption follows the packet.
    await page.goBack();
    await page.waitForFunction((n) => (document.querySelector('.dcap')?.textContent ?? '').includes(`: ${n} rows`), all.length);
    check(`${label}: Back to the now draws the now's packet`, (await page.textContent('.dcap')).includes(`: ${all.length} rows`), await page.textContent('.dcap'));
  } catch (e) {
    check(`${label}: the walk ran to its end`, false, String(e).split('\n')[0]);
  }
  check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}
await browser.close();
clearTimeout(watchdog);
const passed = results.filter(Boolean).length;
console.log(`${name}: ${passed} of ${results.length}${expectOld ? ' (control: expected to fail)' : ''}`);
process.exit(expectOld ? (passed < results.length ? 0 : 1) : passed === results.length ? 0 : 1);
