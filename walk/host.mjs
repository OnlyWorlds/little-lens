// The host, as the Worker answers a build directory: its _headers blocks by path (`! Name` detaching an
// inherited header) and its _redirects' 200 rewrites, for a walk that serves https://little-lens.onlyworlds.com
// from a local build through Playwright's routing (the dashboard's walk/host.mjs). The host's own rules beyond these need a read on the host itself.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function hostFor(dist) {
  const blocks = [];
  let cur = null;
  for (const raw of readFileSync(join(dist, '_headers'), 'utf-8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { cur = { path: raw.trim(), set: [], drop: [] }; blocks.push(cur); continue; }
    const l = raw.trim();
    if (l.startsWith('!')) cur.drop.push(l.slice(1).trim().toLowerCase());
    else { const i = l.indexOf(':'); cur.set.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]); }
  }
  const rewrites = existsSync(join(dist, '_redirects'))
    ? readFileSync(join(dist, '_redirects'), 'utf-8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/))
    : [];
  const headersFor = path => {
    const out = {};
    for (const b of blocks) {
      const re = new RegExp('^' + b.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (!re.test(path)) continue;
      for (const d of b.drop) for (const k of Object.keys(out)) if (k.toLowerCase() === d) delete out[k];
      for (const [k, v] of b.set) out[k] = v;
    }
    return out;
  };
  return { headersFor, serve(pathname) {
    let target = pathname;
    for (const [from, to, status] of rewrites) if (status === '200' && from === pathname) target = to;
    let file = join(dist, normalize(decodeURIComponent(target)).replace(/^([/\\])+/, '') || 'index.html');
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    return { status: 200, headers: { ...headersFor(pathname), 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }, body: readFileSync(file) };
  } };
}
