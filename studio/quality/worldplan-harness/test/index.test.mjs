import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHarnessViewModel, HARNESS_CONTRACT, validateWorldPlan } from '../public/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '../fixtures/worldplan-v1.test-only.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('test-only fixture satisfies WorldPlan v1 and preserves tri-state evidence', () => {
  const result = validateWorldPlan(fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  const view = createHarnessViewModel(fixture);
  assert.equal(view.ok, true);
  assert.deepEqual(view.view.counts, {
    terrain: 96,
    roads: 5,
    plots: 12,
    occupiedPlots: 1,
    npcs: 1,
    quests: 1
  });
  assert.equal(view.view.evidence.observed.length > 0, true);
  assert.equal(view.view.evidence.inferred.length > 0, true);
  assert.equal(view.view.evidence.unknown.length > 0, true);
  assert.equal(Object.isFrozen(view.view), true);
});

test('malformed JSON is a visible schema error, not an empty town', () => {
  const result = createHarnessViewModel('{"schemaVersion":');
  assert.equal(result.ok, false);
  assert.equal(result.view, null);
  assert.equal(result.errors[0].code, 'JSON_PARSE');
});

test('missing and invented fields fail closed', () => {
  const invalid = { ...fixture, schemaVersion: 2, terrain: [], npcs: [{ id: 'n', name: 'N' }] };
  const result = validateWorldPlan(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(({ path, code }) => path === '$.schemaVersion' && code === 'SCHEMA_VERSION'));
  assert.ok(result.errors.some(({ path }) => path === '$.npcs[0].plotId'));
  assert.equal(result.value, null);
});

test('town domain state is required and canonical guild tabs are preserved', () => {
  const withoutTownState = { ...fixture };
  delete withoutTownState.townState;
  const missing = validateWorldPlan(withoutTownState);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(({ path }) => path === '$.townState'));

  const inventedTabs = structuredClone(fixture);
  inventedTabs.townState.guild.tabs[0].label = 'scores';
  const invalid = validateWorldPlan(inventedTabs);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(({ code }) => code === 'INVALID_GUILD_TABS'));
});

test('contract exposes only logical kinds and evidence states', () => {
  assert.deepEqual(HARNESS_CONTRACT.evidenceStates, ['observed', 'inferred', 'unknown']);
  assert.ok(HARNESS_CONTRACT.worldPlanFields.includes('plots'));
  assert.equal(HARNESS_CONTRACT.format, 'codecity.world-plan');
});

test('browser renderer consumes the public grid shape rather than an invented bounds field', () => {
  const appSource = fs.readFileSync(path.join(here, '../public/app.js'), 'utf8');
  assert.doesNotMatch(appSource, /view\.bounds/u);
  assert.match(appSource, /view\.grid\.columns/u);
  assert.match(appSource, /view\.grid\.rows/u);
});
