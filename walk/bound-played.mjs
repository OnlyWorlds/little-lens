// Two reads of a world file the SDK at 4.203.1 changed, played on the build:
//  1. a world holding a tool's own world.json under a dot-folder (`.atlas/world.json`) opens as its one world;
//  2. a world whose one calendar holds 300 eras words its dates as numbers, where one with 3 eras names them.
// On a build pinned before (the control), the first is refused as more than one world, and the 300-era
// calendar names the dates.
//   node walk/bound-played.mjs [base] [chromium|firefox]
import { chromium, firefox } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorldFile } from '@onlyworlds/sdk';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const which = process.argv[3] ?? 'chromium';
const label = `${which} ${new URL(base).host}`;
let bad = 0;
const check = (name, ok, got = '') => { if (!ok) bad++; console.log(`[${label}] ${ok ? 'ok ' : 'BAD'} ${name}${ok ? '' : `: ${got}`}`); };
const enc = new TextEncoder();
const part = (path, o) => ({ path, data: enc.encode(JSON.stringify(o)) });
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const dir = mkdtempSync(join(tmpdir(), 'll-bound-'));
const write = (name, parts) => { const p = join(dir, name); writeFileSync(p, writeWorldFile(parts, name.replace('.owworld', ''))); return p; };
const eras = (n) => ({ version: 1, grain: 'year', eras: Array.from({ length: n }, (_, i) => ({ name: `Age ${i}`, abbrev: `A${i}`, start: i * 10 })) });
const calWorld = (n, w) => write(`cal${n}.owworld`, [
  part('world.json', { id: id(w), name: `Ages ${n}`, time_basic_unit: 'year' }),
  part('elements/event/fall.json', { id: id(w + 1), name: 'The Fall', start_date: 1234 }),
  part('elements/construct/count.json', { id: id(w + 2), name: 'The count', supertype: 'calendar', atlas_calendar: eras(n) }),
]);
const dotFile = write('abbey.owworld', [
  part('world.json', { id: id(100), name: 'The Abbey' }),
  part('.atlas/world.json', { id: id(109), name: 'A tool copy' }),
  part('elements/character/brother.json', { id: id(101), name: 'Brother Cadfael' }),
]);

const browser = await (which === 'firefox' ? firefox : chromium).launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.route(/^https:\/\/(?!little-lens\.)[^/]*onlyworlds\.com\//, (r) => r.abort());

async function openFile(path) {
  await page.goto(`${base}/#/`);
  await page.setInputFiles('input[type=file][accept]', path);
  return page.waitForSelector('.tally', { timeout: 15_000 }).then(() => true, () => false);
}

const opened = await openFile(dotFile);
check('a world file with a dot-folder world.json opens', opened, opened ? '' : (await page.textContent('main'))?.slice(0, 160));
if (opened) {
  const all = (await page.textContent('body')) ?? '';
  const tally = await page.textContent('.tally');
  check('as its one world', all.includes('The Abbey') && !all.includes('A tool copy') && tally === '1 elements · 0 links', `${tally} | ${all.slice(0, 120)}`);
}

async function whenOf(path) {
  if (!(await openFile(path))) return 'did not open';
  await page.click('a[href$="view=time"], nav.switch a:has-text("Time")');
  await page.waitForSelector('.trow .twhen', { timeout: 15_000 });
  return (await page.locator('.trow .twhen').allTextContents()).join('|');
}
const small = await whenOf(calWorld(3, 200));
check('3 eras name the date', small !== 'starts year 1234' && small.startsWith('starts ') && /A\d/.test(small), small);
const big = await whenOf(calWorld(300, 300));
check('300 eras give the number', big === 'starts year 1234', big);
await browser.close();
console.log(bad ? `${bad} BAD` : 'all ok');
process.exitCode = bad ? 1 : 0;
