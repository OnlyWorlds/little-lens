// The small worlds from the OnlyWorlds standard, vendored: reads the lens and charter profiles'
// conformance fixtures at one schema-dist release tag and writes their `worlds` to
// src/standard/worlds.json, whole. The file is this script's output: never edit it by hand, run
// the script again at a new tag. No visitor's browser fetches anything from GitHub.
//   node scripts/standard-worlds.mjs v0.33.0-dist.93   writes the file
//   node scripts/standard-worlds.mjs --check            writes the file's own tag again in memory
//                                                       and fails if a byte differs from the file
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkWorld } from './standard-check.mjs';

const REPO = 'https://github.com/OnlyWorlds/schema-dist';
const PROFILES = ['lens', 'charter'];

async function main() {
  const target = new URL('../src/standard/worlds.json', import.meta.url);
  const check = process.argv[2] === '--check';
  const tag = check ? JSON.parse(readFileSync(target, 'utf8')).tag : process.argv[2];
  if (!/^v\d+\.\d+\.\d+-dist\.\d+$/.test(tag ?? '')) {
    console.error('usage: node scripts/standard-worlds.mjs <schema-dist release tag, e.g. v0.33.0-dist.93> | --check');
    process.exit(2);
  }
  const base = `https://raw.githubusercontent.com/OnlyWorlds/schema-dist/${tag}/profiles`;
  const worlds = [];
  const ids = new Set();
  for (const profile of PROFILES) {
    const res = await fetch(`${base}/${profile}.fixture.json`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${profile}.fixture.json at ${tag}: ${res.status}`);
    const fixture = await res.json();
    if (!fixture.worlds || typeof fixture.worlds !== 'object') throw new Error(`${profile}.fixture.json at ${tag} holds no worlds`);
    for (const [key, w] of Object.entries(fixture.worlds)) {
      checkWorld(`${profile}/${key}`, w);
      if (ids.has(w.id)) throw new Error(`${profile}/${key}: world id ${w.id} seen twice`);
      ids.add(w.id);
      // The script's own two keys win over any the fixture carries.
      worlds.push({ ...w, profile, key });
    }
  }
  const serial = Number(tag.split('-dist.')[1]);
  // The commit the tag names, read from git (no API quota): a tag moved later shows on --check.
  const refs = execFileSync('git', ['ls-remote', REPO, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8', timeout: 30_000 });
  const lines = refs.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  const commit = (lines.find(([, ref]) => ref.endsWith('^{}')) ?? lines[0])?.[0];
  if (!commit) throw new Error(`no tag ${tag} at ${REPO}`);
  // No clock in the file: the same tag always writes the same bytes, so a rerun shows any drift.
  const out = `${JSON.stringify({ tag, serial, commit, worlds }, null, 1)}\n`;
  if (check) {
    if (readFileSync(target, 'utf8') !== out) {
      console.error(`src/standard/worlds.json differs from what this script writes from ${tag}: run the script again, never edit the file`);
      process.exit(1);
    }
    console.log(`src/standard/worlds.json is what ${tag} (${commit.slice(0, 7)}) writes`);
  } else {
    writeFileSync(target, out);
    console.log(`${worlds.length} worlds from ${PROFILES.join(' and ')} at ${tag} (${commit.slice(0, 7)})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`standard-worlds: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
