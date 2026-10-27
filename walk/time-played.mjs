// The time view's played walk: a served build against a played OnlyWorlds (every request to www
// answered here), with a real mouse and keyboard, at a desk and at 390.
//   node walk/time-played.mjs [base] [chromium|firefox]
// Cases: a dated world with a unit and a now (the range line, the order, the row words, the now);
// a drag (one history entry, focus kept, the page not scrolled); keys (the next date, Home, End);
// Back and Forward between moments, drawn in place; an address's moment and one outside the range;
// a calendar world (dates in the calendar's words); a world with nothing dated; a world file whose
// world.json holds time_current, with a hidden element and a stub.
import { chromium, firefox } from '@playwright/test';
import { formatStep, readCalendarValue, writeWorldFile } from '@onlyworlds/sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const which = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const DATED = '11111111-1111-7111-8111-111111111111';
const CAL_W = '22222222-2222-7222-8222-222222222222';
const BARE = '33333333-3333-7333-8333-333333333333';
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const CAL = { version: 1, grain: 'day', bundles: { year: { steps: 360 } }, eras: [{ name: 'After Founding', abbrev: 'AF', start: 0 }] };
const cfg = readCalendarValue(CAL);

const worlds = {
  [DATED]: {
    world: { id: DATED, name: 'Dated Coast', time_basic_unit: 'year', time_range_current: 300, counts: { types: { character: 3, event: 3, location: 1, object: 1 } } },
    els: {
      character: [
        { id: id(1), name: 'Ada Vane', birth_date: 250 },
        { id: id(2), name: 'Bram Holt', birth_date: 280 },
        { id: id(3), name: 'Cleo Marsh' },
      ],
      event: [
        { id: id(4), name: 'The Flood', start_date: 300 },
        { id: id(5), name: 'The Storm', start_date: 320 },
        { id: id(6), name: 'The Quiet', start_date: '310' },
      ],
      location: [{ id: id(7), name: 'Saltmere', founding_date: 100 }],
      object: [{ id: id(8), name: 'A lamp' }],
    },
  },
  [CAL_W]: {
    world: { id: CAL_W, name: 'Calendar Isle', time_basic_unit: 'day', time_range_current: null, counts: { types: { construct: 1, event: 3 } } },
    els: {
      construct: [{ id: id(20), name: 'The Reckoning', supertype: 'calendar', atlas_calendar: CAL }],
      event: [
        { id: id(21), name: 'Landing', start_date: 400 },
        { id: id(22), name: 'Harvest', start_date: 1000 },
        { id: id(23), name: 'Feast', start_date: 1000 },
      ],
    },
  },
  [BARE]: {
    world: { id: BARE, name: 'Timeless Hills', counts: { types: { character: 1, species: 1 } } },
    els: { character: [{ id: id(30), name: 'Nobody' }], species: [{ id: id(31), name: 'Moss' }] },
  },
};

const dir = mkdtempSync(join(tmpdir(), 'll-time-'));
const enc = new TextEncoder();
const part = (path, body) => ({ path, data: enc.encode(JSON.stringify(body)) });
const worldFile = join(dir, 'time-file.owworld');
writeFileSync(
  worldFile,
  writeWorldFile(
    [
      part('world.json', { id: 'file-w', name: 'File of years', time_basic_unit: 'age', time_current: 7, time_range_current: 99 }),
      part('elements/event/a.json', { id: 'e1', name: 'First', start_date: 2 }),
      part('elements/event/b.json', { id: 'e2', name: 'Hidden one', start_date: 5, hidden: true }),
      part('elements/event/c.json', { id: 'e3', name: 'Last', start_date: 9 }),
      part('elements/character/d.json', { id: 'e4', name: 'Known Kit', known_of: true }),
    ],
    'time-file',
  ),
);

let checks = 0;
const fails = [];
function check(label, ok, detail = '') {
  checks++;
  if (!ok) fails.push(`${label}${detail ? `: ${detail}` : ''}`);
}

const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('time-played: watchdog, 180 s');
  process.exit(2);
}, 180_000);

for (const [label, viewport] of [['desk', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://www.onlyworlds.com/**', (route) => {
    const u = new URL(route.request().url());
    const send = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const w = worlds[u.searchParams.get('world')];
    if (!w) return send(404, { error: { code: 'not_found' } });
    if (u.pathname === '/api/v2/world/') return send(200, w.world);
    const type = u.pathname.split('/')[3];
    return send(200, { data: w.els[type] ?? [], has_more: false, next_cursor: null });
  });

  // A dated world, its now and no moment chosen.
  await page.goto(`${base}/#/w/${DATED}/time`);
  await page.waitForSelector('.strip', { timeout: 20_000 });
  const range = await page.textContent('.trange');
  check(`${label} range line`, range === 'Each dot is one dated element, coloured by its type: 5 of the 8 elements are dated, year 100 to year 320. 2 more of a dated type carry no date.', range);
  const rows = await page.locator('.trow .chip').allTextContents();
  check(`${label} date order`, rows.join('|') === 'Saltmere|Ada Vane|Bram Holt|The Flood|The Storm', rows.join('|'));
  const when = await page.locator('.trow .twhen').allTextContents();
  check(`${label} row words`, when.join('|') === 'founded year 100|born year 250|born year 280|starts year 300|after the moment · starts year 320', when.join('|'));
  const said = await page.textContent('.tmoment');
  check(`${label} the now`, said === "Dated up to the world's now, year 300: 4 of 5.", said);
  check(`${label} now line drawn`, (await page.locator('.tnow').count()) === 1);
  check(`${label} slider at the now`, (await page.getAttribute('.strip', 'aria-valuenow')) === '300');

  // A drag: one entry, focus kept, the page where it was.
  await page.evaluate(() => {
    document.querySelector('.strip').dataset.walk = 'same';
    window.scrollTo(0, 40);
  });
  const y0 = await page.evaluate(() => window.scrollY);
  const len0 = await page.evaluate(() => history.length);
  const box = await page.locator('.strip').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  for (const f of [0.3, 0.4, 0.5, 0.6]) await page.mouse.move(box.x + box.width * f, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => ({ len: history.length, y: window.scrollY, focus: document.activeElement?.classList.contains('strip'), hash: location.hash, same: document.querySelector('.strip')?.dataset.walk === 'same', now: document.querySelector('.strip').getAttribute('aria-valuenow') }));
  check(`${label} drag pushes one entry`, afterDrag.len === len0 + 1, `${len0} -> ${afterDrag.len}`);
  check(`${label} drag keeps focus`, afterDrag.focus === true);
  check(`${label} drag keeps the page still`, afterDrag.y === y0, `${y0} -> ${afterDrag.y}`);
  check(`${label} drag moves the address`, /\/time\?at=\d+$/.test(afterDrag.hash) && afterDrag.hash.endsWith(`at=${afterDrag.now}`), afterDrag.hash);
  check(`${label} drag draws in place`, afterDrag.same === true);
  const dragAt = Number(afterDrag.now);

  // Keys: the next date, then the ends.
  await page.keyboard.press('ArrowRight');
  const nextDate = [100, 250, 280, 300, 320].find((d) => d > dragAt) ?? 320;
  check(`${label} arrow to the next date`, (await page.getAttribute('.strip', 'aria-valuenow')) === String(nextDate), await page.getAttribute('.strip', 'aria-valuenow'));
  await page.keyboard.press('End');
  check(`${label} End`, (await page.getAttribute('.strip', 'aria-valuenow')) === '320');
  const atEnd = await page.textContent('.tmoment');
  check(`${label} moment words`, atEnd === "Dated up to year 320: 5 of 5. The world's now is year 300.", atEnd);
  await page.keyboard.press('Home');
  check(`${label} Home`, (await page.getAttribute('.strip', 'aria-valuenow')) === '100');
  check(`${label} after marked in words`, (await page.locator('.trow.after').count()) === 4);

  // Back and Forward: in place, the same strip, the page still.
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.strip').getAttribute('aria-valuenow') === '320');
  await page.goBack();
  await page.waitForFunction((n) => document.querySelector('.strip').getAttribute('aria-valuenow') === String(n), nextDate);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.strip').getAttribute('aria-valuenow') === '320');
  const back = await page.evaluate(() => ({ same: document.querySelector('.strip')?.dataset.walk === 'same', y: window.scrollY }));
  check(`${label} back and forward in place`, back.same === true && back.y === y0, JSON.stringify(back));

  // The gate's C2: the view torn down in the middle of a run (a key held, the address changed from
  // inside the page) adds one entry, and Back returns to the moment, never to a phantom /time.
  await page.goto(`${base}/#/w/${DATED}/time`);
  await page.waitForSelector('.strip');
  await page.focus('.strip');
  const lenRun = await page.evaluate(() => history.length);
  await page.keyboard.down('ArrowRight');
  const held = await page.evaluate(() => location.hash);
  await page.evaluate((w) => { location.hash = `#/w/${w}`; }, DATED);
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(200);
  const lenAfter = await page.evaluate(() => history.length);
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  const backTo = await page.evaluate(() => location.hash);
  check(`${label} a run cut by leaving adds one entry`, lenAfter === lenRun + 1, `${lenRun} -> ${lenAfter}`);
  check(`${label} Back from there returns to the moment`, backTo === held, `${backTo}, held ${held}`);

  // An address's moment outside the range: kept, said, never clamped.
  await page.goto(`${base}/#/w/${DATED}/time?at=5000`);
  await page.waitForSelector('.strip');
  const far = await page.textContent('.tmoment');
  check(`${label} far moment said`, far === "Dated up to year 5000, after the last date: 5 of 5. The world's now is year 300.", far);
  check(`${label} far moment kept`, (await page.getAttribute('.strip', 'aria-valuemax')) === '5000');
  await page.goto(`${base}/#/w/${DATED}/time?at=007`);
  await page.waitForSelector('.strip');
  check(`${label} a malformed moment is none`, (await page.getAttribute('.strip', 'aria-valuenow')) === '300');

  // A calendar world, no now.
  await page.goto(`${base}/#/w/${CAL_W}/time`);
  await page.waitForSelector('.strip');
  const calWhen = await page.locator('.trow .twhen').allTextContents();
  check(`${label} calendar words`, calWhen.join('|') === `starts ${formatStep(cfg, 400)}|starts ${formatStep(cfg, 1000)}|starts ${formatStep(cfg, 1000)}`, calWhen.join('|'));
  const noNow = await page.textContent('.tmoment');
  check(`${label} no now, no fence`, noNow === 'This world has no now, so nothing is fenced: choose a moment on the strip.', noNow);
  check(`${label} no now line`, (await page.locator('.tnow').count()) === 0);
  // The gate's C1: End on a stacked last date says its count, and pressing the last dot fences it in.
  await page.focus('.strip');
  await page.keyboard.press('End');
  const endText = await page.getAttribute('.strip', 'aria-valuetext');
  check(`${label} End says the stack's count`, endText === `${formatStep(cfg, 1000)}, 2 elements here`, endText);
  await page.keyboard.press('Home');
  const lastDot = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('.tdot')].map((d) => d.getBoundingClientRect());
    const r = dots.reduce((a, b) => (b.x > a.x ? b : a));
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(lastDot.x, lastDot.y);
  check(`${label} the pressed dot is fenced in`, (await page.getAttribute('.strip', 'aria-valuenow')) === '1000' && (await page.locator('.trow.after').count()) === 0, await page.getAttribute('.strip', 'aria-valuenow'));
  // The gate's C3: Alt+Arrow is the browser's, never the slider's.
  const beforeAlt = await page.getAttribute('.strip', 'aria-valuenow');
  await page.focus('.strip');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(300);
  const altNow = await page.locator('.strip').count() ? await page.getAttribute('.strip', 'aria-valuenow') : 'left the view';
  check(`${label} Alt+Arrow leaves the moment alone`, altNow === beforeAlt || altNow === 'left the view', `${beforeAlt} -> ${altNow}`);

  // Nothing dated.
  await page.goto(`${base}/#/w/${BARE}/time`);
  await page.waitForSelector('.trange');
  // The Character is of a dated type with no date, so it is counted; the Species is timeless.
  check(`${label} nothing dated`, (await page.textContent('.trange')) === 'Nothing in this world is dated. 1 more of a dated type carries no date.' && (await page.locator('.strip').count()) === 0, await page.textContent('.trange'));

  // A world file: time_current over time_range_current, a hidden one out, a stub said.
  await page.goto(`${base}/#/`);
  const chooser = page.waitForEvent('filechooser');
  await page.click('text=Open a world file');
  await (await chooser).setFiles(worldFile);
  await page.waitForSelector('canvas.webcanvas, .cards', { timeout: 20_000 });
  await page.click('.switch a:has-text("Time")');
  await page.waitForSelector('.strip');
  const fileRange = await page.textContent('.trange');
  check(`${label} file range`, fileRange === 'Each dot is one dated element, coloured by its type: 2 of the 2 elements are dated, age 2 to age 9. 1 known only by name, its date unknown.', fileRange);
  check(`${label} file now from time_current`, (await page.textContent('.tmoment')) === "Dated up to the world's now, age 7: 1 of 2.", await page.textContent('.tmoment'));
  check(`${label} file address`, page.url().endsWith('#/file/time'), page.url());

  check(`${label} no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

clearTimeout(watchdog);
await browser.close();
console.log(`time-played ${which} on ${base}: ${checks - fails.length}/${checks}`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
