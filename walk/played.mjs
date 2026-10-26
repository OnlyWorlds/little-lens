// The played walk: a served build against a played OnlyWorlds (every request to www answered here,
// none reaching the real server), at a desk and at 390.
//   node walk/played.mjs [base] [chromium|firefox]
// Cases: a public world (web, list, kind filter, search, element, a link to a left-out element),
// a private world and a malformed address (one closed door, word for word, no request for the
// malformed one), a 429, a world file and a world folder holding a hidden, a proposed and a room
// element (left out and counted), a reload on #/file, and a broken file.
import { chromium, firefox } from '@playwright/test';
import { writeWorldFile } from '@onlyworlds/sdk';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const which = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const W = '11111111-1111-7111-8111-111111111111';
const PRIVATE = '22222222-2222-7222-8222-222222222222';
const SLOW = '33333333-3333-7333-8333-333333333333';
const SHUT = '44444444-4444-7444-8444-444444444444';
const BUSY = '55555555-5555-7555-8555-555555555555';
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// The played world: 5 characters, a location, a relation, a pin; one character hidden on the
// server never arrives (the server strips it), so a link to it is to an id outside the set.
const els = {
  character: [
    { id: id(1), name: 'Ada Vane', description: 'A harbour pilot.', location: id(10), friends: [id(2), id(3)], rivals: [id(99)] },
    { id: id(2), name: 'Bram Holt', description: 'Keeps the lighthouse.', friends: [id(1)] },
    { id: id(3), name: 'Cleo Marsh', description: 'Sails at night.', location: id(10) },
    { id: id(4), name: 'Dov Reed', description: 'Nobody knows him.' },
    { id: id(5), name: '<img src=x onerror=alert(1)>', description: '<b>bold</b>' },
    { id: id(6), name: '</text><a href="https://evil.example">x</a>', friends: [id(1)] },
  ],
  location: [{ id: id(10), name: 'Saltmere', description: 'A harbour town.', image_url: 'https://evil.example/p.png' }],
  relation: [{ id: id(20), name: 'Ada and Cleo', actor: id(1), characters: [id(3)] }],
  pin: [{ id: id(30), name: 'pin', map: id(40), element: id(10) }],
};
const counts = { character: 6, location: 1, relation: 1, pin: 1 };

const fileParts = (() => {
  const enc = new TextEncoder();
  const f = (path, body) => ({ path, data: enc.encode(JSON.stringify(body)) });
  return [
    f('world.json', { id: W, name: 'File world' }),
    f('elements/character/a.json', { id: id(1), name: 'Ada Vane', friends: [id(2), id(3), id(4)] }),
    f('elements/character/b.json', { id: id(2), name: 'Hidden Bram', hidden: true }),
    f('elements/character/c.json', { id: id(3), name: 'Proposed Cleo', x_review_proposed: { by: 'someone' } }),
    f('elements/narrative/d.json', { id: id(4), name: 'Room line', supertype: 'Message', x_room_of: id(50) }),
    f('elements/location/e.json', { id: id(10), name: 'Saltmere', image_url: 'https://media.onlyworlds.com/u/planted.png' }),
    f('elements/character/k.json', { id: id(11), name: 'Known Kit', known_of: true }),
  ];
})();

const dir = mkdtempSync(join(tmpdir(), 'll-walk-'));
const worldFile = join(dir, 'file-world.owworld');
writeFileSync(worldFile, writeWorldFile(fileParts, 'file-world'));
writeFileSync(join(dir, 'broken.owworld'), 'not a zip');
const folder = join(dir, 'File world');
for (const p of fileParts) {
  const full = join(folder, ...p.path.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, p.data);
}

let checks = 0;
const fails = [];
function check(label, ok, detail = '') {
  checks++;
  if (!ok) fails.push(`${label}${detail ? `: ${detail}` : ''}`);
}

const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('played: watchdog, 180 s');
  process.exit(2);
}, 180_000);

for (const [label, viewport] of [['desk', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  const ow = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss();
  });
  // Any request to another host than the page and www is a leak (the picture's host above).
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(base).origin && u.hostname !== 'www.onlyworlds.com') errors.push(`request to ${u.hostname}`);
  });
  await page.route('https://www.onlyworlds.com/**', (route) => {
    const u = new URL(route.request().url());
    ow.push(u.pathname + u.search);
    const world = u.searchParams.get('world');
    const send = (status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) });
    if (world === SLOW) return send(429, { error: { type: 'rate_limited' } }, { 'Retry-After': '42', 'access-control-expose-headers': 'Retry-After' });
    if (world === BUSY) return send(503, { error: { type: 'api_error' } }, { 'Retry-After': '9', 'access-control-expose-headers': 'Retry-After' });
    if (world === SHUT) return send(401, { error: { code: 'authentication_failed' } });
    if (world !== W) return send(404, { error: { code: 'not_found' } });
    if (u.pathname === '/api/v2/world/') return send(200, { id: W, name: 'Saltmere Coast', description: '', image_url: '', counts: { total: 8, types: counts } });
    const type = u.pathname.split('/')[3];
    if (!els[type]) return send(200, { data: [], has_more: false, next_cursor: null });
    return send(200, { data: els[type], has_more: false, next_cursor: null });
  });

  // A public world.
  await page.goto(`${base}/#/w/${W}`);
  await page.waitForSelector('canvas.webcanvas', { timeout: 20_000 });
  check(`${label} tally`, (await page.textContent('.tally')) === '8 elements · 8 links', await page.textContent('.tally'));
  check(`${label} sub line`, (await page.textContent('.wsub')) === 'public world, signed out');
  check(`${label} no pin read`, !ow.some((p) => p.startsWith('/api/v2/pin/')), ow.join(' '));
  check(`${label} reads`, ow.length === 4, ow.join(' '));
  check(`${label} pills`, (await page.locator('.pill').allTextContents()).join('|') === 'all 8|characters 6|locations 1|relations 1');
  await page.screenshot({ path: `walk/out-played-${which}-${label}-web.png` });
  // The list, a kind, a search.
  await page.click('a[href$="view=list"]');
  await page.waitForSelector('.cards');
  check(`${label} list`, (await page.locator('.cards li').count()) === 8);
  await page.click('.pill:has-text("locations")');
  check(`${label} kind filter`, (await page.locator('.cards li').count()) === 1);
  await page.click('.pill:has-text("locations")');
  await page.fill('input.search', 'LIGHTHOUSE');
  check(`${label} search folds case and reads descriptions`, (await page.locator('.cards .cname').allTextContents()).join('|') === 'Bram Holt');
  await page.fill('input.search', '');
  // The stranger's markup stays text.
  check(`${label} name is text`, (await page.locator('.cards .cname', { hasText: '<img src=x' }).count()) === 1);
  // An element.
  await page.click('.cards a:has-text("Ada Vane")');
  await page.waitForSelector('.eview');
  check(`${label} cap`, (await page.textContent('.cap')) === 'What it links to · 3, and what links to it · 3', await page.textContent('.cap'));
  check(`${label} outside line`, (await page.locator('.note', { hasText: '1 link goes to elements not shown here.' }).count()) === 1);
  check(`${label} chip to left out`, (await page.locator('.chip.off').allTextContents()).join('|') === `…${id(99).slice(-8)}`);
  // The radial names a neighbour whose name is markup: it stays text there too.
  const injected = await page.evaluate(() => document.querySelectorAll('img[src="x"], a[href^="https://evil"], b').length);
  check(`${label} no element made from world text`, injected === 0, String(injected));
  await page.screenshot({ path: `walk/out-played-${which}-${label}-element.png`, fullPage: true });
  await page.click('.chip:has-text("Saltmere")');
  await page.waitForSelector('.pic-off');
  check(`${label} foreign picture named, not loaded`, (await page.textContent('.pic-off')) === 'A picture at evil.example, not loaded here.');
  check(`${label} no reread on element moves`, ow.length === 4, ow.join(' '));
  // A link to an element this world does not show.
  await page.goto(`${base}/#/w/${W}/e/${id(99)}`);
  check(`${label} left-out element door`, (await page.textContent('main h1')) === 'You cannot open this element');

  // The closed door: private, and malformed (no request).
  const before = ow.length;
  await page.goto(`${base}/#/w/${PRIVATE}`);
  await page.waitForSelector('main.closed h1');
  const privateText = await page.textContent('main.closed');
  await page.goto(`${base}/#/w/not-an-id`);
  await page.waitForSelector('main.closed h1');
  const malformedText = await page.textContent('main.closed');
  check(`${label} closed door word for word`, privateText === malformedText && privateText.startsWith('You cannot open this world'), `${privateText} / ${malformedText}`);
  check(`${label} malformed sends nothing`, ow.length === before + 1, ow.slice(before).join(' '));
  await page.screenshot({ path: `walk/out-played-${which}-${label}-closed.png` });

  // A 429.
  await page.goto(`${base}/#/w/${SLOW}`);
  await page.waitForSelector('main.closed button');
  check(`${label} slow down`, (await page.textContent('main.closed p')) === 'OnlyWorlds is asking Little Lens to slow down. Try again in 42 seconds.', await page.textContent('main.closed p'));
  // A 503 waits the same way; a 401 (the public door shut) is the closed door, word for word.
  await page.goto(`${base}/#/w/${BUSY}`);
  await page.waitForSelector('main.closed button');
  check(`${label} busy`, (await page.textContent('main.closed p')) === 'OnlyWorlds is asking Little Lens to slow down. Try again in 9 seconds.', await page.textContent('main.closed p'));
  await page.goto(`${base}/#/w/${SHUT}`);
  await page.waitForSelector('main.closed h1');
  check(`${label} shut door looks closed`, (await page.textContent('main.closed')) === privateText);

  // A world file: the marks left out and counted.
  await page.goto(`${base}/#/`);
  await page.setInputFiles('input[type=file][accept]', worldFile);
  await page.waitForSelector('.tally');
  check(`${label} file tally`, (await page.textContent('.tally')) === '3 elements · 0 links', await page.textContent('.tally'));
  const leftOut = (await page.locator('.leftout').allTextContents()).join('|');
  check(`${label} file left out`, leftOut === 'Left out: 1 hidden, 1 proposed, 1 in a room.', leftOut);
  check(`${label} file sub`, (await page.textContent('.wsub')) === 'opened from a file');
  await page.click('a[href$="view=list"]');
  await page.waitForSelector('.cards');
  const names = (await page.locator('.cards .cname').allTextContents()).join('|');
  check(`${label} file shows no marked element`, names === 'Ada Vane|Known Kit|Saltmere', names);
  await page.screenshot({ path: `walk/out-played-${which}-${label}-file.png` });
  check(`${label} known of on its card`, (await page.locator('.cards a:has-text("Known Kit") .cdeg').textContent()) === 'known of');
  // A file's picture on our own host is named and never fetched (a fetch would be a stray request above).
  await page.click('.cards a:has-text("Saltmere")');
  await page.waitForSelector('.pic-off');
  check(`${label} file picture not loaded`, (await page.textContent('.pic-off')) === 'A picture at media.onlyworlds.com, not loaded from a file.');
  await page.goBack();
  await page.click('.cards a:has-text("Known Kit")');
  await page.waitForSelector('.eview');
  check(`${label} known of said on its page`, (await page.locator('.note', { hasText: 'Known of:' }).count()) === 1);
  await page.goBack();
  // A reload forgets it.
  await page.reload();
  await page.waitForSelector('.ways');
  check(`${label} reload forgets the file`, (await page.textContent('.said')) === 'Open the file again: Little Lens keeps nothing once the page closes.');
  // A folder (Chromium and Firefox both take a directory here).
  await page.setInputFiles('input[webkitdirectory]', folder);
  await page.waitForSelector('.tally');
  check(`${label} folder tally`, (await page.textContent('.tally')) === '3 elements · 0 links', await page.textContent('.tally'));
  // A broken file.
  await page.goto(`${base}/#/`);
  await page.setInputFiles('input[type=file][accept]', join(dir, 'broken.owworld'));
  await page.waitForFunction(() => document.querySelector('.said')?.textContent !== 'Opening…' && document.querySelector('.said')?.textContent !== '');
  check(`${label} broken file`, (await page.textContent('.said')) === 'That file is not a world Little Lens can open.', await page.textContent('.said'));

  check(`${label} no page errors or stray requests`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
clearTimeout(watchdog);
console.log(`played ${which}: ${checks - fails.length} of ${checks} checks`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
