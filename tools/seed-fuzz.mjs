#!/usr/bin/env node
// node tools/seed-fuzz.mjs <repo | model.json> [...] [--count 200] [--start 0]
//   [--layout path/to/layout.mjs] [--out compare/fuzz] [--manifest path]
// Parse each repository once. Only head changes: 0000000, 0000001, ... (hex).
// A saved model.json lets different layout revisions consume identical input.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeRepository } from '../src/analyze.mjs';
import { layoutTown, loadArt, loadProps, loadGround } from '../src/layout.mjs';
import { hash32 } from '../src/layout/util.mjs';
import { visibleLawn, largestRectangle } from '../src/lawn.mjs';
import { checkAscii } from './check-ascii.mjs';
import { checkPlay } from './check-play.mjs';

export const fuzzHead = (index) => index.toString(16).padStart(7, '0');

export function checkSeed(repo, manifest, { layout = layoutTown } = {}) {
  const options = { art: loadArt(manifest), props: loadProps(manifest), ground: loadGround(manifest) };
  const town = layout(repo, options);
  const ascii = checkAscii(town, manifest, { repo, regenerate: () => layout(repo, options) });
  const lawn = largestRectangle(visibleLawn(town, manifest.archetypes, options.props), town.cols, town.rows)?.a ?? 0;
  const play = checkPlay(town, manifest, { repo });
  const problems = [
    ...ascii.problems.map((p) => `ascii: ${p}`),
    ...(lawn > 8 ? [`lawn: maximum ${lawn} exceeds 8`] : []),
    ...play.problems.map((p) => `play: ${p.trim()}`),
  ];
  return { town, ascii, lawn, play, problems };
}

export function fuzzSeeds(repo, manifest, {
  count = 200, start = 0, layout = layoutTown, onResult = () => {},
} = {}) {
  const results = [];
  for (let index = start; index < start + count; index++) {
    const head = fuzzHead(index), model = { ...repo, head };
    const result = { index, head, seed: hash32(`${model.name}@${head}`), problems: [] };
    let checks;
    try {
      checks = checkSeed(model, manifest, { layout });
      Object.assign(result, {
        problems: checks.problems, lawn: checks.lawn,
        terraces: checks.town.terraces.length, stairs: checks.town.stairs.length,
        ...(checks.ascii.groups.length ? { groups: checks.ascii.groups.map((g) => ({
          group: g.group, pieces: g.pieces, buildings: g.buildings,
          unplaced: (checks.town.unplaced || []).filter((u) => u.archetype === 'group' && u.group === g.group),
        })) } : {}),
      });
    } catch (e) {
      result.problems.push(`exception: ${e.stack || e}`);
    }
    results.push(result);
    onResult(result, checks);
  }
  return { name: repo.name, start, count, failed: results.filter((r) => r.problems.length).length, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), targets = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (['--count', '--start', '--layout', '--out', '--manifest'].includes(args[i])) {
      options[args[i].slice(2)] = args[++i];
    } else if (args[i].startsWith('-')) {
      throw new Error(`Unknown option: ${args[i]}`);
    } else targets.push(args[i]);
  }
  const count = Number(options.count ?? 200), start = Number(options.start ?? 0);
  if (!targets.length || !Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(start) || start < 0) {
    console.error('Usage: node tools/seed-fuzz.mjs <repo | model.json> [...] [--count 200] [--start 0] [--layout file] [--out dir] [--manifest file]');
    process.exitCode = 2;
  } else {
    const manifest = JSON.parse(readFileSync(options.manifest || new URL('../art/game/manifest.json', import.meta.url), 'utf8'));
    const layout = options.layout ? (await import(pathToFileURL(resolve(options.layout)))).layoutTown : layoutTown;
    for (const target of targets) {
      const repo = target.endsWith('.json') ? JSON.parse(readFileSync(target, 'utf8')) : analyzeRepository(resolve(target));
      const out = options.out && join(resolve(options.out), repo.name);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'model.json'), JSON.stringify(repo, null, 2));
      }
      const report = fuzzSeeds(repo, manifest, { count, start, layout, onResult(result, checks) {
        if (result.problems.length) {
          console.log(`${repo.name} head=${result.head} seed=${result.seed} FAIL\n  ${result.problems.join('\n  ')}`);
          if (out && checks) {
            writeFileSync(join(out, `${result.head}.town.json`), JSON.stringify(checks.town, null, 1));
            writeFileSync(join(out, `${result.head}.checks.log`), [...checks.ascii.lines, `lawn: ${checks.lawn}`, ...checks.play.lines].join('\n') + '\n');
          }
        }
        if ((result.index - start + 1) % 20 === 0) console.log(`${repo.name}: ${result.index - start + 1}/${count}`);
      } });
      if (out) writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`${repo.name}: ${count - report.failed}/${count} passed, ${report.failed} failed (heads ${fuzzHead(start)}..${fuzzHead(start + count - 1)})`);
      const grouped = report.results.filter((r) => r.groups);
      if (grouped.length) {
        const connected = grouped.filter((r) => r.groups.every((g) => g.pieces === 1 && !g.unplaced.length)).length;
        const accounted = grouped.filter((r) => r.groups.every((g) => g.pieces === 1 || g.unplaced.some((u) => u.reason?.trim()))).length;
        console.log(`groups: ${connected}/${count} all connected without unplaced; ${accounted}/${count} one piece or reason in unplaced`);
      }
      if (report.failed) process.exitCode = 1;
    }
  }
}
