// A first look on a served build: the ways in, Moppetopia's web and list, one element, at a desk
// and at 390, with every console error and every request to OnlyWorlds counted.
//   node walk/look.mjs [base] [chromium|firefox]
import { chromium, firefox } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const engine = process.argv[3] === 'firefox' ? firefox : chromium;
const name = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const MOPPETOPIA = '0695db52-5433-7332-8000-db7fe10da375';
const FLUFFINGTON = '0695db83-afd7-76ee-8000-00f4295f8866';

const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('look: watchdog, 120 s');
  process.exit(2);
}, 120_000);
let failures = 0;
for (const [label, viewport] of [['desk', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  let owRequests = 0;
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => r.url().startsWith('https://www.onlyworlds.com/') && owRequests++);
  await page.goto(`${base}/#/`);
  await page.screenshot({ path: `walk/out-${name}-${label}-1-ways.png` });
  await page.goto(`${base}/#/w/${MOPPETOPIA}`);
  await page.waitForSelector('canvas.webcanvas', { timeout: 60_000 });
  const tally = await page.textContent('.tally');
  await page.screenshot({ path: `walk/out-${name}-${label}-2-web.png` });
  await page.click('a[href$="view=list"]');
  await page.waitForSelector('.cards');
  const cards = await page.locator('.cards li').count();
  await page.screenshot({ path: `walk/out-${name}-${label}-3-list.png` });
  await page.goto(`${base}/#/w/${MOPPETOPIA}/e/${FLUFFINGTON}`);
  await page.waitForSelector('.eview');
  await page.screenshot({ path: `walk/out-${name}-${label}-4-element.png`, fullPage: true });
  const cap = await page.textContent('.cap');
  console.log(`${name} ${label}: tally "${tally}" · cards ${cards} · "${cap}" · OnlyWorlds requests ${owRequests} · errors ${errors.length}`);
  for (const e of errors) console.log(`  error: ${e}`);
  if (errors.length) failures++;
  await page.close();
}
await browser.close();
clearTimeout(watchdog);
process.exit(failures ? 1 : 0);
