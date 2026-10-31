// The open door on a real host and real keel, signed out: Moppetopia (public) by #/open/ lands on its web
// under #/w/, one of its elements by #/open/…/element/ on its page, a world id keel does not serve publicly
// lands on #/me/ with the sign-in ask, and Back skips the door. Nothing is written anywhere.
//   node walk/live-open.mjs [base] [chromium|firefox]
import { chromium, firefox } from '@playwright/test';

const base = process.argv[2] ?? 'https://little-lens.onlyworlds.com';
const which = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const MOPPETOPIA = '0695db52-5433-7332-8000-db7fe10da375';
const NOT_PUBLIC = '01a19282-0000-7000-8000-00000000d00f';
let failures = 0;
const check = (ok, what) => {
  console.log(`[${which}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const watchdog = setTimeout(() => {
  console.error('live-open: watchdog, 120 s');
  process.exit(2);
}, 120_000);

const browser = await (which === 'firefox' ? firefox : chromium).launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}/#/`);
await page.waitForSelector('main.ways', { timeout: 20_000 });
await page.goto(`${base}/#/open/${MOPPETOPIA}`);
const web = await page.waitForSelector('canvas.webcanvas', { timeout: 40_000 }).then(() => true, () => false);
check(web && new URL(page.url()).hash === `#/w/${MOPPETOPIA}`, `a public world opens public (${new URL(page.url()).hash})`);
await page.goBack();
await page.waitForTimeout(500);
check(new URL(page.url()).hash === '#/', `Back skips the door (${new URL(page.url()).hash})`);
await page.goto(`${base}/#/w/${MOPPETOPIA}?view=list`);
await page.waitForSelector('.cards a', { timeout: 40_000 });
const href = await page.locator('.cards a').first().getAttribute('href');
const el = href?.match(/\/e\/([^/?]+)/)?.[1];
const name = (await page.locator('.cards .cname').first().textContent())?.trim();
await page.goto(`${base}/#/open/${MOPPETOPIA}/element/${el}`);
await page.waitForSelector('.eview', { timeout: 40_000 }).catch(() => {});
check(new URL(page.url()).hash === `#/w/${MOPPETOPIA}/e/${el}` && (await page.textContent('main h1').catch(() => ''))?.trim() === name, `an element opens on its page (${name})`);
await page.goto(`${base}/#/open/${NOT_PUBLIC}`);
await page.waitForSelector('main.ways', { timeout: 30_000 }).catch(() => {});
const said = (await page.textContent('.ways .said').catch(() => '')) ?? '';
check(new URL(page.url()).hash === `#/me/${NOT_PUBLIC}` && said === 'Sign in to open this world.', `a world keel does not serve publicly asks for the sign-in (${new URL(page.url()).hash}, ${JSON.stringify(said)})`);
check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
await browser.close();
clearTimeout(watchdog);
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
