#!/usr/bin/env node
// Headless play check using the browser's world, collision boxes and Player physics.
// node tools/check-play.mjs <repo | town.json> [...] [--overlay file]
//   [--manifest art/game/manifest.json] [--town-out path (1 target)] [-v]
// Exit 1 on unreachable floors, keepers, terraces, stairs, decks or overlay objects,
// or failed keyboard/click building entry, gate/bridge crossings, walker routes or creature placement/talk.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOverlay } from '../src/overlay/read.mjs';
import { townFor } from './check-play/town.mjs';
import { checkPlay } from './check-play/check.mjs';

export { checkPlay } from './check-play/check.mjs';
export { artFrom, buildWorld } from '../src/overlay/geometry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v');
  const mi = args.indexOf('--manifest');
  const ti = args.indexOf('--town-out');
  const oi = args.indexOf('--overlay');
  const manifestPath = resolve(mi >= 0 ? args[mi + 1] : `${ROOT}/art/game/manifest.json`);
  const targets = args.filter((a, i) => !a.startsWith('-') && !['--manifest', '--town-out', '--overlay'].includes(args[i - 1]));
  if (!targets.length || (ti >= 0 && (!args[ti + 1] || targets.length !== 1))) {
    console.error('使い方: node tools/check-play.mjs <repo | town.json> [...] [--overlay file (repo only)] [--manifest path] [--town-out path (1 target)] [-v]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let overlay;
  try { if (oi >= 0) overlay = readOverlay(args[oi + 1]); }
  catch (e) { console.error(e.message); process.exit(1); }
  let failed = 0;
  for (const target of targets) {
    const t0 = performance.now();
    const { town, repo, warnings = [] } = await townFor(target, manifest, overlay);
    for (const warning of warnings) console.warn(`warn: ${warning}`);
    if (ti >= 0) writeFileSync(resolve(args[ti + 1]), JSON.stringify(town, null, 1));
    const result = checkPlay(town, manifest, { repo, verbose, target, t0 });
    for (const line of result.lines) console.log(line);
    failed += result.failed;
  }
  process.exitCode = failed ? 1 : 0;
}
