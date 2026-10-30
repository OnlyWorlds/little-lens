// The messages played walk: a served build against played worlds (every request to www answered here,
// none reaching the real server), with real clicks and keys. Messages, and the small worlds from the
// OnlyWorlds standard.
//   node walk/messages-played.mjs [base] [chromium|firefox]
// Cases (desk 1366x900 unless said):
//   1 the small worlds: the way in, the list of 16, The Post (its tab, its head, the hidden message
//     shown nowhere, the proved sender, the mismatch, the read lines, a reload, the hidden address),
//     The Stub Room ("From nobody"), a world without messages (no tab, its /messages address closed),
//     and not one request off the page's own origin
//   2 a world file: a thread in order, an orphan, a proposed message, a room line, a hidden one
//     counted and absent, claimed senders, a read mark counted, a stripped subject, the element page's
//     way into its conversation; then a file whose read mark carries hands (no mark shown)
//   3 a public world read keyless: the head's line, a message with no recipients named, no read mark
//     shown, no "To everyone"; and a public world with no messages (no tab, its address closed)
//   4 a phone (390): no sideways scroll, each conversation row at least 44 px tall
// A case that cannot finish (a missing way in, a missing page) fails by name and the walk goes on.
import { chromium, firefox } from '@playwright/test';
import { writeWorldFile } from '@onlyworlds/sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:5173';
const which = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const baseOrigin = new URL(base).origin;
const shot = (name) => fileURLToPath(new URL(`./out-messages-played-${which}-${name}.png`, import.meta.url));

const DESK = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };
const STD = (n) => `019a7f00-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const POST = STD(0xf004);
const STUBS = STD(0xf006);
const DAWN = STD(0xf005);
const ASHFEN = STD(0xf009);
const HIDDEN_IN_POST = STD(0x38);
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const OVERRIDE = '‮';

// -- The checks ---------------------------------------------------------------------------------------

const results = []; // { c, label, ok, detail }
let current = 0;
function check(label, ok, detail = '') {
  results.push({ c: current, label, ok: !!ok, detail });
  console.log(`[case ${current}] ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` :: ${detail}` : ''}`);
}
async function runCase(n, name, fn) {
  current = n;
  try {
    await fn();
  } catch (e) {
    const where = String(e?.stack ?? '').split('\n').find((l) => l.includes('messages-played.mjs')) ?? '';
    check(`${name}: finished`, false, `${String(e?.message ?? e).split('\n')[0]} ${where.trim()}`);
  }
}

// -- Reading the page ---------------------------------------------------------------------------------

const textOf = (page, sel) => page.locator(sel).first().textContent();
const bodyText = (page) => page.evaluate(() => document.body.textContent);

/** The messages on a conversation page, field by field. */
const readThread = (page) =>
  page.evaluate(() => ({
    head: document.querySelector('.mhead .mcount')?.textContent ?? null,
    check: document.querySelector('.mhead .mcheck')?.textContent ?? null,
    answersOutside: [...document.querySelectorAll('.messages > .mflag')].map((x) => x.textContent),
    msgs: [...document.querySelectorAll('.mthread > .msg')].map((li) => ({
      subject: li.querySelector('.msubject')?.textContent ?? null,
      from: li.querySelector('.mfrom')?.textContent ?? null,
      fromBold: !!li.querySelector('.mfrom b'),
      fromLink: li.querySelector('.mfrom a.mwho')?.getAttribute('href') ?? null,
      fromLinkBold: !!li.querySelector('.mfrom a.mwho b'),
      flags: [...li.querySelectorAll('.mflag')].map((x) => x.textContent),
      proposedClass: li.classList.contains('proposed'),
      to: li.querySelector('.mto')?.textContent ?? null,
      read: li.querySelector('.mread')?.textContent ?? null,
      body: li.querySelector('.mbody')?.textContent ?? null,
    })),
  }));

/** The conversation rows on the list: subject, meta line and address, in the order shown. */
const readList = (page) =>
  page.evaluate(() => ({
    head: document.querySelector('.mhead .mcount')?.textContent ?? null,
    check: document.querySelector('.mhead .mcheck')?.textContent ?? null,
    rows: [...document.querySelectorAll('a.thread')].map((a) => ({
      subject: a.querySelector('.tsubject')?.textContent ?? null,
      meta: a.querySelector('.tmeta')?.textContent ?? null,
      href: a.getAttribute('href'),
    })),
  }));

/**
 * From the list: every conversation opened with a real click and read, then back by the page's own
 * link. Returns the list as first read, and each conversation's reading and full text.
 */
async function visitAll(page) {
  await page.waitForSelector('section.messages');
  const list = await readList(page);
  const listText = await bodyText(page);
  const threads = [];
  for (const row of list.rows) {
    await page.locator(`a.thread[href="${row.href}"]`).click();
    await page.waitForSelector('.mthread');
    threads.push({ href: row.href, ...(await readThread(page)), text: await bodyText(page) });
    await page.getByRole('link', { name: '← All conversations' }).click();
    await page.waitForSelector('ul.threads');
  }
  return { list, listText, threads };
}

const allMsgs = (v) => v.threads.flatMap((t) => t.msgs);

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(25_000);
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss();
  });
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  return { ctx, page, errors, requests };
}

const sideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth);

// -- The played worlds --------------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'll-messages-'));
const enc = new TextEncoder();
const part = (path, body) => ({ path, data: enc.encode(JSON.stringify(body)) });

// A file world: a thread of three (ids run against the time), an orphan whose parent is hidden, a
// proposed message, a room line, a Note in a chain, a subject with a bidi override, and a Read mark.
function fileParts(handsOnMark) {
  const msg = (n, name, extra) => part(`elements/narrative/m${n}.json`, { id: id(n), supertype: 'Message', name, ...extra });
  return [
    part('world.json', { id: id(1000), name: 'Message file world' }),
    part('elements/character/ada.json', { id: id(1), name: 'Ada Venn' }),
    part('elements/character/bram.json', { id: id(2), name: 'Bram Hale' }),
    part('elements/character/cleo.json', { id: id(3), name: 'Cleo Marsh' }),
    msg(13, 'Fees 1', { narrator: id(1), characters: [id(2)], story: 'First line.', created_at: '2026-10-01T09:00:00Z' }),
    msg(12, 'Fees 2', { parent_narrative: id(13), narrator: id(2), characters: [id(1)], story: 'Second line.', created_at: '2026-10-02T09:00:00Z' }),
    msg(11, 'Fees 3', { parent_narrative: id(12), narrator: id(1), characters: [id(2), id(3)], story: 'Third line.', created_at: '2026-10-03T09:00:00Z' }),
    msg(14, 'Orphan', { parent_narrative: id(99), narrator: id(3), characters: [id(1)], story: 'Answering a closed door.', created_at: '2026-10-04T09:00:00Z' }),
    msg(99, 'Hidden root', { hidden: true, narrator: id(1), characters: [id(3)], story: 'HIDDEN BODY TEXT', created_at: '2026-09-30T09:00:00Z' }),
    msg(15, 'Maybe later', { x_review_proposed: { by: 'someone' }, narrator: id(1), characters: [id(2)], story: 'Draft words.', created_at: '2026-10-05T09:00:00Z' }),
    msg(16, 'Room line', { x_room_of: id(50), narrator: id(3), characters: [], story: 'Said in a room.', created_at: '2026-10-06T09:00:00Z' }),
    msg(17, 'Chain root', { narrator: id(1), characters: [id(2)], story: 'Before the note.', created_at: '2026-10-07T09:00:00Z' }),
    part('elements/narrative/n18.json', { id: id(18), supertype: 'Note', name: 'A note on the chain', parent_narrative: id(17), story: 'A note.' }),
    msg(19, 'Chain reply', { parent_narrative: id(18), narrator: id(2), characters: [id(1)], story: 'After the note.', created_at: '2026-10-08T09:00:00Z' }),
    msg(20, `Bidi ${OVERRIDE}evil subject`, { narrator: id(2), characters: [id(1)], story: 'A subject that tries to turn the page around.', created_at: '2026-10-09T09:00:00Z' }),
    part('elements/relation/r30.json', { id: id(30), supertype: 'Read', name: 'Read: Bram', actor: id(2), narratives: [id(13), id(15)], ...(handsOnMark ? { created_by: id(2) } : {}) }),
  ];
}
const fileA = join(dir, 'messages-file.owworld');
const fileB = join(dir, 'messages-file-hands.owworld');
writeFileSync(fileA, writeWorldFile(fileParts(false), 'messages-file'));
// A world file drops the author fields unless asked, so the second file asks for them.
writeFileSync(fileB, writeWorldFile(fileParts(true), 'messages-file-hands', { includeAuthorFields: true }));

// A public world: messages without hands, one with `characters: []`, and a Read relation.
const PUB = '66666666-6666-7666-8666-666666666666';
const PUB_EMPTY = '77777777-7777-7777-8777-777777777777';
const pubEls = {
  character: [
    { id: id(101), name: 'Ada Venn' },
    { id: id(102), name: 'Bram Hale' },
  ],
  narrative: [
    { id: id(111), supertype: 'Message', name: 'Notice', narrator: id(101), characters: [id(102)], story: 'A notice for Bram.', created_at: '2026-10-01T09:00:00Z' },
    { id: id(112), supertype: 'Message', name: 'Open call', narrator: id(101), characters: [], story: 'A call with nobody named.', created_at: '2026-10-02T09:00:00Z' },
    { id: id(113), supertype: 'Message', name: 'A word for Ada', narrator: id(102), characters: [id(101)], story: 'A word.', created_at: '2026-10-03T09:00:00Z' },
  ],
  relation: [{ id: id(121), supertype: 'Read', name: 'Read: Bram', actor: id(102), narratives: [id(111)] }],
};
const pubEmptyEls = { character: [{ id: id(131), name: 'Cleo Marsh', friends: [] }] };

async function playWww(ctx, log) {
  await ctx.route('https://www.onlyworlds.com/**', (route) => {
    const u = new URL(route.request().url());
    log?.push(u.pathname + u.search);
    const world = u.searchParams.get('world');
    const send = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const els = world === PUB ? pubEls : world === PUB_EMPTY ? pubEmptyEls : null;
    if (!els) return send(404, { error: { code: 'not_found' } });
    if (u.pathname === '/api/v2/world/') {
      const types = Object.fromEntries(Object.entries(els).map(([t, rows]) => [t, rows.length]));
      return send(200, { id: world, name: world === PUB ? 'Played public messages' : 'Played public quiet', description: '', image_url: '', counts: { total: Object.values(types).reduce((a, b) => a + b, 0), types } });
    }
    const type = u.pathname.split('/')[3];
    return send(200, { data: els[type] ?? [], has_more: false, next_cursor: null });
  });
}

// -- The walk -----------------------------------------------------------------------------------------

const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('messages-played: watchdog, 240 s');
  process.exit(2);
}, 240_000);

// Case 1: the small worlds from the standard.
await runCase(1, 'small worlds', async () => {
  const { ctx, page, errors, requests } = await newPage(browser, DESK);
  // Nothing may leave the page's own origin; if it tried, it is stopped and counted.
  await ctx.route((url) => url.origin !== baseOrigin, (route) => route.abort());
  await page.goto(`${base}/#/`);
  await page.waitForSelector('.ways');
  check('the ways in offers the small worlds', (await page.locator('a.way', { hasText: 'Small worlds from the OnlyWorlds standard' }).count()) === 1);
  await page.locator('a.way', { hasText: 'Small worlds from the OnlyWorlds standard' }).click();
  await page.waitForSelector('ul[aria-label="Small worlds"] li');
  check('#/std lists 16 worlds', (await page.locator('ul[aria-label="Small worlds"] li').count()) === 16, String(await page.locator('ul[aria-label="Small worlds"] li').count()));
  check('the list is at #/std', new URL(page.url()).hash === '#/std', page.url());
  await page.screenshot({ path: shot('desk-1-std-list') });

  // The Post, opened by its link.
  await page.locator('ul[aria-label="Small worlds"] a.way', { hasText: 'The Post' }).click();
  await page.waitForSelector('nav.switch');
  check('The Post is at its address', new URL(page.url()).hash === `#/std/${POST}`, page.url());
  const tab = page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true });
  check('The Post shows a Messages tab', (await tab.count()) === 1);
  await tab.click();
  await page.waitForSelector('ul.threads');
  const post = await visitAll(page);
  check('The Post head', post.list.head === '5 messages in 5 conversations · 1 hidden, not shown', post.list.head);
  check('The Post has 5 conversations of one message each', post.threads.length === 5 && post.threads.every((t) => t.msgs.length === 1), JSON.stringify(post.threads.map((t) => t.msgs.length)));
  check('The Post needs no check line (it has its members)', post.list.check === null, post.list.check);
  await page.screenshot({ path: shot('desk-1-post-list') });
  const texts = [post.listText, ...post.threads.map((t) => t.text)];
  check('"Sealed" appears nowhere on the list or any conversation', texts.every((t) => !t.includes('Sealed')));
  check('the hidden message body appears nowhere', texts.every((t) => !t.includes('Kept back')));
  const msgs = allMsgs(post);
  const lamps = msgs.find((m) => m.subject === 'On the lamps');
  check('a proved sender is a bold link', !!lamps && lamps.from === 'From Dov Marr' && lamps.fromLinkBold && lamps.fromLink === `#/std/${POST}/e/${STD(0x32)}`, JSON.stringify(lamps));
  const notes = msgs.find((m) => m.subject === 'Notes to self');
  check('the mismatch is worded', !!notes && notes.from === 'Claims to be from Ada Venn, written with the key of Dov Marr', notes?.from);
  check('a claimed sender is not bold', !!notes && !notes.fromBold && notes.fromLink === null);
  check('a "Read by Ada Venn" line is shown', msgs.some((m) => m.read !== null && m.read.includes('Read by Ada Venn')), JSON.stringify(msgs.map((m) => m.read)));
  check('a "Not yet by Ada Venn" line is shown', msgs.some((m) => m.read !== null && m.read.includes('Not yet by Ada Venn')), JSON.stringify(msgs.map((m) => m.read)));

  // A reload of a conversation address shows the same conversation.
  await page.locator(`a.thread[href="${post.list.rows.find((r) => r.subject === 'On the lamps').href}"]`).click();
  await page.waitForSelector('.mthread');
  const before = await readThread(page);
  const urlBefore = page.url();
  await page.screenshot({ path: shot('desk-1-post-conversation') });
  await page.reload();
  await page.waitForSelector('.mthread');
  const after = await readThread(page);
  check('a reload keeps the address', page.url() === urlBefore, page.url());
  check('a reload shows the same conversation', JSON.stringify(before) === JSON.stringify(after) && after.msgs.length === 1 && after.msgs[0].subject === 'On the lamps', JSON.stringify(after.msgs));

  // The hidden message's address is the closed door, and says nothing of it.
  await page.goto(`${base}/#/std/${POST}/messages/${HIDDEN_IN_POST}`);
  await page.waitForSelector('main.closed h1');
  check('the hidden id gives "You cannot open this conversation"', (await textOf(page, 'main.closed h1')) === 'You cannot open this conversation', await textOf(page, 'main.closed h1'));
  const closedText = await bodyText(page);
  check('the closed door names no hidden message', !closedText.includes('Sealed') && !closedText.includes('Kept back'));
  await page.screenshot({ path: shot('desk-1-post-hidden-closed') });

  // The Stub Room: a message from nobody.
  await page.goto(`${base}/#/std`);
  await page.waitForSelector('ul[aria-label="Small worlds"] li');
  await page.locator('ul[aria-label="Small worlds"] a.way', { hasText: 'The Stub Room' }).click();
  await page.waitForSelector('nav.switch');
  check('The Stub Room is at its address', new URL(page.url()).hash === `#/std/${STUBS}`, page.url());
  await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
  await page.waitForSelector('ul.threads');
  const stubs = await visitAll(page);
  const stubFroms = allMsgs(stubs).map((m) => m.from);
  check('The Stub Room shows "From nobody"', stubFroms.includes('From nobody'), JSON.stringify(stubFroms));
  check('The Stub Room: every message is "From nobody"', stubFroms.length === 2 && stubFroms.every((f) => f === 'From nobody'), JSON.stringify(stubFroms));

  // A world without messages: no tab, and its address is closed.
  await page.goto(`${base}/#/std`);
  await page.waitForSelector('ul[aria-label="Small worlds"] li');
  await page.locator('ul[aria-label="Small worlds"] a.way', { hasText: 'Dawn' }).click();
  await page.waitForSelector('nav.switch');
  check('a world without messages has no Messages tab', (await page.locator('nav.switch').getByRole('link', { name: 'Messages' }).count()) === 0);
  check('its tabs are the others', (await page.locator('nav.switch a').allTextContents()).join('|') === 'Web|List|Time', (await page.locator('nav.switch a').allTextContents()).join('|'));
  await page.goto(`${base}/#/std/${DAWN}/messages`);
  await page.waitForSelector('main.closed h1');
  check('its /messages address says "You cannot open this conversation"', (await textOf(page, 'main.closed h1')) === 'You cannot open this conversation', await textOf(page, 'main.closed h1'));
  await page.screenshot({ path: shot('desk-1-no-messages-closed') });

  // Every request made on the #/std pages stayed on the page's own origin.
  const strays = requests.filter((u) => new URL(u).origin !== baseOrigin);
  check('no request left the page origin', strays.length === 0 && requests.length > 0, strays.join(' | ') || `no requests seen (${requests.length})`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

// Case 2: a world file, and a file whose read mark carries hands.
await runCase(2, 'world file', async () => {
  const { ctx, page, errors, requests } = await newPage(browser, DESK);
  await playWww(ctx, null);
  await page.goto(`${base}/#/`);
  await page.waitForSelector('.ways');
  await page.setInputFiles('input[type=file][accept]', fileA);
  await page.waitForSelector('.tally');
  await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
  await page.waitForSelector('ul.threads');
  const v = await visitAll(page);
  await page.screenshot({ path: shot('desk-2-file-list') });
  check('the head counts settled, proposed and hidden', v.list.head === '8 messages in 6 conversations · 1 proposed · 1 hidden, not shown', v.list.head);
  check('a file needs no check line when no mark carries hands', v.list.check === null, v.list.check);
  check('the list is newest first', v.list.rows.map((r) => r.subject).join('|') === 'Bidi evil subject|Chain root|Room line|Maybe later|Orphan|Fees 1', v.list.rows.map((r) => r.subject).join('|'));
  const T = v.threads.find((t) => t.msgs[0]?.subject === 'Fees 1');
  check('the thread shows its three in order', !!T && T.msgs.map((m) => m.subject).join('|') === 'Fees 1|Fees 2|Fees 3', T?.msgs.map((m) => m.subject).join('|'));
  check('a thread that is answered has no orphan line', !!T && T.answersOutside.length === 0, JSON.stringify(T?.answersOutside));
  const O = v.threads.find((t) => t.msgs[0]?.subject === 'Orphan');
  check('the orphan says "Answers something not in these conversations"', !!O && O.answersOutside.includes('Answers something not in these conversations'), JSON.stringify(O?.answersOutside));
  const P = v.threads.find((t) => t.msgs[0]?.subject === 'Maybe later');
  check('the proposed one says "Proposed, not yet reviewed"', !!P && P.msgs[0].flags.includes('Proposed, not yet reviewed') && P.msgs[0].proposedClass, JSON.stringify(P?.msgs[0]));
  check('the proposed one has no Read line even with a mark naming it', !!P && P.msgs[0].read === null, P?.msgs[0].read);
  check('the proposed one\'s sender is not bold', !!P && !P.msgs[0].fromBold && P.msgs[0].from === 'Claims to be from Ada Venn', JSON.stringify(P?.msgs[0]));
  check('the proposed row says so first', (v.list.rows.find((r) => r.subject === 'Maybe later')?.meta ?? '').includes('Proposed, not yet reviewed · Claims to be from Ada Venn'), v.list.rows.find((r) => r.subject === 'Maybe later')?.meta);
  const R = v.threads.find((t) => t.msgs[0]?.subject === 'Room line');
  check('the room line says "A line in a room"', !!R && R.msgs[0].flags.includes('A line in a room'), JSON.stringify(R?.msgs[0]));
  check('the hidden one is absent (subject and body)', v.threads.every((t) => !t.text.includes('Hidden root') && !t.text.includes('HIDDEN BODY TEXT')) && !v.listText.includes('Hidden root') && !v.listText.includes('HIDDEN BODY TEXT'));
  const all = allMsgs(v);
  check('every sender is a claim (a file has no members list)', all.every((m) => m.from.startsWith('Claims to be from ') && !m.fromBold && m.fromLink === null), JSON.stringify(all.map((m) => m.from)));
  check('the read line counts the mark', T?.msgs[0].read === 'Read by Bram Hale', T?.msgs[0].read);
  check('a recipient who has not read it is named', T?.msgs[1].read === 'Not yet by Ada Venn', T?.msgs[1].read);
  const C = v.threads.find((t) => t.msgs[0]?.subject === 'Chain root');
  check('a reply to a Note in the chain stays in its conversation', !!C && C.msgs.map((m) => m.subject).join('|') === 'Chain root|Chain reply', C?.msgs.map((m) => m.subject).join('|'));
  check('a Note is never a message of its own', all.every((m) => m.subject !== 'A note on the chain') && v.list.rows.every((r) => r.subject !== 'A note on the chain'));
  const B = v.threads.find((t) => t.msgs[0]?.subject.includes('evil subject'));
  check('the subject renders with the override removed (conversation)', !!B && !B.msgs[0].subject.includes(OVERRIDE) && B.msgs[0].subject === 'Bidi evil subject', JSON.stringify(B?.msgs[0].subject));
  check('the subject renders with the override removed (list)', !v.list.rows.some((r) => r.subject.includes(OVERRIDE)) && v.list.rows[0].subject === 'Bidi evil subject');
  check('the override is nowhere on the pages', !v.listText.includes(OVERRIDE) && v.threads.every((t) => !t.text.includes(OVERRIDE)));

  // The element page of a message: a way into its conversation, by a real click.
  await page.getByRole('link', { name: 'List', exact: true }).click();
  await page.waitForSelector('.cards');
  await page.locator('.cards a', { hasText: 'Fees 3' }).click();
  await page.waitForSelector('.eview');
  const way = page.getByRole('link', { name: 'Read it in its conversation' });
  check('an element page of a message offers "Read it in its conversation"', (await way.count()) === 1);
  await way.click();
  await page.waitForSelector('.mthread');
  const landed = await readThread(page);
  check('it lands on that conversation', landed.msgs.map((m) => m.subject).join('|') === 'Fees 1|Fees 2|Fees 3', landed.msgs.map((m) => m.subject).join('|'));
  check('it is at a conversation address', /^#\/file\/messages\//.test(new URL(page.url()).hash), page.url());
  await page.screenshot({ path: shot('desk-2-file-conversation') });
  // A element page of a non-message offers nothing of the kind.
  await page.goto(`${base}/#/file/e/${id(1)}`);
  await page.waitForSelector('.eview');
  check('a Character\'s element page does not offer it', (await page.getByRole('link', { name: 'Read it in its conversation' }).count()) === 0);

  // A second file whose Read relation carries hands: no mark can be checked here.
  await page.goto(`${base}/#/`);
  await page.waitForSelector('.ways');
  await page.setInputFiles('input[type=file][accept]', fileB);
  await page.waitForSelector('.tally');
  await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
  await page.waitForSelector('ul.threads');
  const w = await visitAll(page);
  await page.screenshot({ path: shot('desk-2-file-hands-list') });
  check('the head says read marks cannot be checked', w.list.check === 'Read marks cannot be checked here, so none is shown.', w.list.check);
  const texts = [w.listText, ...w.threads.map((t) => t.text)];
  check('no "Read by" or "Not yet by" anywhere', texts.every((t) => !t.includes('Read by') && !t.includes('Not yet by')) && allMsgs(w).every((m) => m.read === null));
  check('the same conversations are still read', w.list.head === '8 messages in 6 conversations · 1 proposed · 1 hidden, not shown', w.list.head);

  check('no request left the page origin except the played www', requests.every((u) => new URL(u).origin === baseOrigin || new URL(u).hostname === 'www.onlyworlds.com'), requests.filter((u) => new URL(u).origin !== baseOrigin).join(' | '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

// Case 3: a public world, read keyless.
await runCase(3, 'public world', async () => {
  const { ctx, page, errors } = await newPage(browser, DESK);
  const seen = [];
  await playWww(ctx, seen);
  await page.goto(`${base}/#/w/${PUB}`);
  await page.waitForSelector('canvas.webcanvas');
  check('the world is read keyless', seen.length > 0 && !seen.some((p) => /api[_-]?key|token/i.test(p)), seen.join(' '));
  await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
  await page.waitForSelector('ul.threads');
  const v = await visitAll(page);
  await page.screenshot({ path: shot('desk-3-public-list') });
  check('the head says it is read as the public', (v.list.check ?? '').startsWith('Read as the public:'), v.list.check);
  check('the head counts the three', v.list.head === '3 messages in 3 conversations', v.list.head);
  const open = allMsgs(v).find((m) => m.subject === 'Open call');
  check('a message with no recipients named says so', !!open && open.to.startsWith('No recipients named'), open?.to);
  const texts = [v.listText, ...v.threads.map((t) => t.text)];
  check('no "Read by" anywhere although a Read relation exists', texts.every((t) => !t.includes('Read by') && !t.includes('Not yet by')) && allMsgs(v).every((m) => m.read === null));
  check('no "To everyone" anywhere', texts.every((t) => !t.includes('To everyone')) && allMsgs(v).every((m) => !m.to.includes('To everyone')));
  check('no sender is proved keyless', allMsgs(v).every((m) => !m.fromBold && m.fromLink === null && m.from.startsWith('Claims to be from ')), JSON.stringify(allMsgs(v).map((m) => m.from)));
  await page.screenshot({ path: shot('desk-3-public-conversation') });

  // A public world with no messages: no tab, and its address is closed.
  await page.goto(`${base}/#/w/${PUB_EMPTY}`);
  await page.waitForSelector('canvas.webcanvas');
  check('a public world without messages has no Messages tab', (await page.locator('nav.switch').getByRole('link', { name: 'Messages' }).count()) === 0);
  await page.goto(`${base}/#/w/${PUB_EMPTY}/messages`);
  await page.waitForSelector('main.closed h1');
  check('its /messages address says "You cannot open this conversation"', (await textOf(page, 'main.closed h1')) === 'You cannot open this conversation', await textOf(page, 'main.closed h1'));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

// Case 4: a phone.
await runCase(4, 'phone', async () => {
  const { ctx, page, errors } = await newPage(browser, PHONE);
  await playWww(ctx, null);
  const rowsOk = async (label) => {
    const boxes = await page.locator('a.thread').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check(`${label}: every conversation row is at least 44 px tall`, boxes.length > 0 && boxes.every((b) => b >= 44), JSON.stringify(boxes));
  };
  const noScroll = async (label) => {
    const w = await sideways(page);
    check(`${label}: no sideways scroll`, w <= PHONE.width, `scrollWidth ${w}`);
  };

  // The Post.
  await page.goto(`${base}/#/std/${POST}`);
  await page.waitForSelector('nav.switch');
  await noScroll('The Post web');
  await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
  await page.waitForSelector('ul.threads');
  await noScroll('The Post list');
  await rowsOk('The Post list');
  await page.screenshot({ path: shot('390-1-post-list') });
  await page.locator('a.thread', { hasText: 'Notes to self' }).click();
  await page.waitForSelector('.mthread');
  await noScroll('The Post conversation');
  await page.screenshot({ path: shot('390-2-post-conversation') });

  // Ashfen, the standard's longest message world.
  await page.goto(`${base}/#/std/${ASHFEN}/messages`);
  await page.waitForSelector('ul.threads');
  await noScroll('Ashfen list');
  await rowsOk('Ashfen list');

  // The file world, with a long thread, a bidi subject and a proposed line.
  await page.goto(`${base}/#/`);
  await page.waitForSelector('.ways');
  await page.setInputFiles('input[type=file][accept]', fileA);
  await page.waitForSelector('.tally');
  await page.locator('nav.switch').getByRole('link', { name: 'Messages', exact: true }).click();
  await page.waitForSelector('ul.threads');
  await noScroll('file list');
  await rowsOk('file list');
  await page.screenshot({ path: shot('390-3-file-list') });
  await page.locator('a.thread', { hasText: 'Fees 1' }).click();
  await page.waitForSelector('.mthread');
  await noScroll('file conversation');
  await page.screenshot({ path: shot('390-4-file-conversation') });

  // The public world.
  await page.goto(`${base}/#/w/${PUB}/messages`);
  await page.waitForSelector('ul.threads');
  await noScroll('public list');
  await rowsOk('public list');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await browser.close();
clearTimeout(watchdog);

const names = { 1: 'small worlds', 2: 'world file', 3: 'public world', 4: 'phone 390' };
const failed = results.filter((r) => !r.ok);
console.log(`\nmessages-played ${which}:`);
for (const c of [1, 2, 3, 4]) {
  const rs = results.filter((r) => r.c === c);
  console.log(`  case ${c} (${names[c]}): ${rs.filter((r) => r.ok).length} of ${rs.length}`);
}
console.log(`  total: ${results.length - failed.length} of ${results.length} checks`);
for (const f of failed) console.log(`  FAIL [case ${f.c}] ${f.label}${f.detail ? ` :: ${f.detail}` : ''}`);
process.exit(failed.length ? 1 : 0);
