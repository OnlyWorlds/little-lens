// The time view at scale: a played world of 5,000 dated events, the strip drawn and a drag across
// it, every long task over 50 ms recorded from before the view opens.
//   node walk/time-scale.mjs [base] [chromium|firefox]
// Chromium reports long tasks; Firefox has no longtask entry, so there the drag's slowest frame is read.
import { chromium, firefox } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const which = process.argv[3] === 'firefox' ? 'firefox' : 'chromium';
const W = '66666666-6666-7666-8666-666666666666';
const N = 5000;
const id = (n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const events = Array.from({ length: N }, (_, i) => ({ id: id(i + 1), name: `Event ${i + 1}`, start_date: (i * 7919) % 20000 - 10000 }));

const browser = await (which === 'firefox' ? firefox : chromium).launch();
const watchdog = setTimeout(() => process.exit(2), 120_000);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('https://www.onlyworlds.com/**', (route) => {
  const u = new URL(route.request().url());
  const send = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (u.pathname === '/api/v2/world/') return send({ id: W, name: 'Many', time_basic_unit: 'year', time_range_current: 0, counts: { types: { event: N } } });
  return send({ data: u.pathname.split('/')[3] === 'event' ? events : [], has_more: false, next_cursor: null });
});
await page.goto(`${base}/#/w/${W}`);
await page.waitForSelector('canvas.webcanvas', { timeout: 30_000 });
await page.evaluate(() => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => Math.round(e.duration)))).observe({ type: 'longtask', buffered: false });
  } catch {}
});
const t0 = Date.now();
await page.click('.switch a:has-text("Time")');
await page.waitForSelector('.strip');
const open = Date.now() - t0;
await page.waitForFunction((n) => document.querySelectorAll('.trow').length === n, N);
await page.waitForTimeout(300);
const longOpen = await page.evaluate(() => window.__long.splice(0));
const box = await page.locator('.strip').boundingBox();
await page.mouse.move(box.x + 40, box.y + 40);
await page.mouse.down();
const frames = [];
for (let f = 0.1; f <= 0.9; f += 0.05) {
  const s = Date.now();
  await page.mouse.move(box.x + box.width * f, box.y + 40);
  frames.push(Date.now() - s);
}
await page.waitForTimeout(300);
const longDrag = await page.evaluate(() => window.__long.splice(0));
await page.mouse.up();
await page.waitForTimeout(300);
const longRelease = await page.evaluate(() => window.__long.splice(0));
const long = [...longOpen, ...longDrag, ...longRelease];
console.log(`  open ${JSON.stringify(longOpen)} · drag ${JSON.stringify(longDrag)} · release ${JSON.stringify(longRelease)}`);
const dots = await page.locator('.tdot').count();
// The gate's C4: a fresh open past the last date ends with the list at its end, once every row is built.
await page.goto(`${base}/#/w/${W}/time?at=99999`);
await page.waitForFunction((n) => document.querySelectorAll('.trow').length === n, N, { timeout: 30_000 });
await page.waitForTimeout(300);
const tail = await page.evaluate(() => { const l = document.querySelector('.tlist'); return l.scrollHeight - l.clientHeight - l.scrollTop; });
console.log(`  a moment past the last date leaves the list ${tail} px from its end`);
console.log(`time-scale ${which}: ${N} dated, ${dots} dots drawn, open ${open} ms, long tasks ${JSON.stringify(long)}, slowest drag move ${Math.max(...frames)} ms`);
clearTimeout(watchdog);
await browser.close();
process.exit(long.some((d) => d > 50) || tail > 2 ? 1 : 0);
