import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultManifest } from '../src/overlay/place.mjs';
import { analyzeOverlayModel } from '../src/overlay/model.mjs';
import { layoutTown } from '../src/layout.mjs';
import { checkSeed, fuzzSeeds } from '../tools/seed-fuzz.mjs';
import { fixture, parsed } from './helpers/overlay-fixtures.mjs';

const manifest = defaultManifest();

test('overlay: seed is layout-only and seed-fuzz changes it without changing HEAD or facts', (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test', 'sample.test.mjs'), "import {test} from 'node:test'; test('sample',()=>{});");
  const model = analyzeOverlayModel(dir);
  const original = JSON.stringify(model), heads = [], seeds = [];
  const overlay = parsed({ seed: 'stable', title: { text: 'first' } });
  const report = fuzzSeeds(model, manifest, { count: 2, overlay, layout(repo, opts) {
    heads.push(repo.head); seeds.push(opts.seed); return layoutTown(repo, opts);
  } });
  assert.equal(report.failed, 0, JSON.stringify(report.results));
  assert.ok(heads.every((head) => head === model.head)); assert.equal(new Set(seeds).size, 2);
  assert.equal(JSON.stringify(model), original);
  assert.equal(JSON.stringify(checkSeed(model, manifest, { overlay }).town.buildings),
    JSON.stringify(checkSeed(model, manifest, { overlay: { ...overlay, title: { text: 'renamed' } } }).town.buildings));
});
