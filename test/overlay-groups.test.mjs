import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { globMatch, applyGroups } from '../src/overlay/groups.mjs';
import { resolveAt } from '../src/overlay/resolve.mjs';
import { defaultManifest } from '../src/overlay/place.mjs';
import { analyzeOverlayModel, groupOverlayModel } from '../src/overlay/model.mjs';
import { fixture, simpleTown, parsed } from './helpers/overlay-fixtures.mjs';

const manifest = defaultManifest();

test('overlay: glob **, *, ?, literal punctuation, first matching group and complete file ownership', (t) => {
  for (const [pattern, path, expected] of [
    ['src/**', 'src', true], ['src/**', 'src/a/b.js', true], ['src/**/*.js', 'src/a.js', true],
    ['src/*.js', 'src/a/b.js', false], ['web/?.js', 'web/字.js', true], ['web/?.js', 'web/ab.js', false],
    ['a[1].js', 'a[1].js', true], ['a[1].js', 'a1.js', false], ['**/x', 'x', true],
  ]) assert.equal(globMatch(pattern, path), expected, `${pattern} -> ${path}`);
  const dir = fixture(t);
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (let i = 0; i < 12; i++) writeFileSync(join(dir, `src/file${i}.js`), 'line\n'.repeat(20 - i));
  const model = analyzeOverlayModel(dir);
  const ov = parsed({ groups: [{ id: 'first', paths: ['src/file11.js'] }, { id: 'second', paths: ['src/**'] }] });
  assert.equal(groupOverlayModel(model, ov).modules.find((m) => m.path === 'src').group, 'first');
  assert.equal(model.modules[0].group, undefined, 'does not mutate the repository facts');
  assert.equal(applyGroups(model, [{ id: 'none', paths: ['missing/**'] }]).modules[0].group, undefined);
});

test('overlay: deepest absorbed module, group and landmark fallbacks', () => {
  const town = simpleTown();
  town.buildings[0].module.merged = ['src/deep'];
  town.buildings[1].module.path = 'src/deepest';
  assert.equal(resolveAt(town, { path: 'src/deep/file.mjs' }).building.id, 'b1');
  assert.equal(resolveAt(town, { path: 'src/deepest/file.mjs' }).building.id, 'b2');
  assert.deepEqual(resolveAt(town, { path: 'unknown/path' }), { ...town.spawn, plaza: true });
  town.landmarks.push({ archetype: 'well', x: 14, y: 12 });
  assert.deepEqual(resolveAt(town, { landmark: 'gate' }), { x: 14, y: 12, plaza: true });
  town.buildings[1].archetype = 'town_hall';
  assert.equal(resolveAt(town, { path: 'unknown/path' }).building.id, 'b2');
  assert.equal(resolveAt(town, { group: 'empty' }, { kind: 'board' }).plaza, true);
  assert.equal(resolveAt(town, { group: 'empty' }, { kind: 'person' }).plaza, true);
  assert.equal(resolveAt(town, { group: 'empty' }, { kind: 'record' }).reason, 'group has no building');
  assert.equal(resolveAt(town, { marker: 'unplaced' }, { kind: 'person' }).reason, 'marker not placed');
});
