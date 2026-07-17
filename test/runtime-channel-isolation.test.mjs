import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { inspectRepository } from '../src/inspector.mjs';
import { isValidLegacyTownPayload } from '../src/server.mjs';
import { buildLegacyTownPayload, buildTownPayload } from '../src/town/index.mjs';
import {
  FORGE_MANIFEST_URL as LEGACY_MANIFEST_URL,
  REQUIRED_ASSET_IDS,
  auditRuntimeAssetUsage,
  auditSiteRecipes,
  validateForgeManifest as validateLegacyManifest
} from '../public/site-runtime.mjs';
import { auditWorldMap } from '../public/world-runtime.mjs';
import {
  FORGE_MANIFEST_URL as FABLE5_MANIFEST_URL,
  WAVE_A_ASSET_IDS
} from '../public/fable5-v2/site-runtime.mjs';

const ROOT = new URL('..', import.meta.url);

async function text(relativePath) {
  return readFile(new URL(relativePath, ROOT), 'utf8');
}

function fetchedPaths(source) {
  return [...source.matchAll(/fetch\('([^']+)'/g)].map((match) => match[1]);
}

test('legacy root and Fable5 v2 use exclusive API, asset, and module channels', async () => {
  const [legacyApp, legacyIndex, legacySite, fable5App, fable5Index, fable5Site] = await Promise.all([
    text('public/app.js'),
    text('public/index.html'),
    text('public/site-runtime.mjs'),
    text('public/fable5-v2/app.js'),
    text('public/fable5-v2/index.html'),
    text('public/fable5-v2/site-runtime.mjs')
  ]);

  assert.deepEqual(fetchedPaths(legacyApp), ['/api/town/legacy']);
  assert.deepEqual(fetchedPaths(fable5App), ['/api/town']);
  assert.equal(LEGACY_MANIFEST_URL, '/assets/forge/manifest.json');
  assert.equal(FABLE5_MANIFEST_URL, '/assets/forge/v3/manifest.json');
  assert.doesNotMatch(legacySite, /\/assets\/forge\/v3\//);
  assert.doesNotMatch(fable5Site, /FORGE_MANIFEST_URL = '\/assets\/forge\/manifest\.json'/);

  assert.match(legacyIndex, /src="\/app\.js"/);
  assert.match(legacyIndex, /href="\/styles\.css"/);
  assert.doesNotMatch(legacyIndex, /fable5-v2/);
  assert.match(fable5Index, /src="\/fable5-v2\/app\.js"/);
  assert.match(fable5Index, /href="\/fable5-v2\/styles\.css"/);
});

test('the restored release channel accepts and meaningfully binds only the frozen approved 78', async () => {
  const manifest = JSON.parse(await text('public/assets/forge/manifest.json'));
  const validation = validateLegacyManifest(manifest);
  const usage = auditRuntimeAssetUsage();
  const sites = auditSiteRecipes();
  const world = auditWorldMap();

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.complete, true);
  assert.deepEqual(validation, {
    ok: true,
    issues: [],
    assetCount: 78,
    missing: [],
    unexpected: [],
    categoryCounts: { building: 17, character: 22, effect: 2, field: 19, object: 18 }
  });
  assert.equal(REQUIRED_ASSET_IDS.length, 78);
  assert.deepEqual(usage, { ok: true, used: REQUIRED_ASSET_IDS, missing: [], unexpected: [] });
  assert.equal(sites.ok, true);
  assert.equal(sites.routeCount, 17);
  assert.equal(world.ok, true);
  assert.deepEqual(world.usage, REQUIRED_ASSET_IDS);
});

test('legacy and WorldPlan payload builders remain deterministic and structurally exclusive', async () => {
  const repoPath = new URL('../sample/tiny-town', import.meta.url).pathname;
  const inspection = await inspectRepository(repoPath);
  const [legacy, legacyRepeat, fable5] = await Promise.all([
    buildLegacyTownPayload(repoPath, inspection),
    buildLegacyTownPayload(repoPath, inspection),
    buildTownPayload(repoPath, inspection)
  ]);

  assert.equal(JSON.stringify(legacy), JSON.stringify(legacyRepeat));
  assert.deepEqual(Object.keys(legacy), [
    'schemaVersion', 'repository', 'generatorVersion', 'seed', 'habitability', 'model', 'layout'
  ]);
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(legacy.layout.validation.ok, true);
  assert.equal(isValidLegacyTownPayload(legacy), true);
  assert.equal(Object.hasOwn(legacy, 'worldPlan'), false);
  assert.equal(Object.hasOwn(legacy, 'facts'), false);

  assert.deepEqual(Object.keys(fable5), [
    'schemaVersion', 'repository', 'habitability', 'facts', 'worldPlan'
  ]);
  assert.equal(fable5.schemaVersion, 2);
  assert.equal(fable5.worldPlan.validation.ok, true);
  assert.equal(Object.hasOwn(fable5, 'layout'), false);
  assert.equal(Object.hasOwn(fable5, 'model'), false);

  const forgedVerdict = structuredClone(legacy);
  forgedVerdict.layout.buildings[1].x = forgedVerdict.layout.buildings[0].x;
  forgedVerdict.layout.buildings[1].y = forgedVerdict.layout.buildings[0].y;
  assert.equal(forgedVerdict.layout.validation.ok, true);
  assert.equal(isValidLegacyTownPayload(forgedVerdict), false);

  const mixedTopLevel = structuredClone(legacy);
  mixedTopLevel.worldPlan = fable5.worldPlan;
  assert.equal(isValidLegacyTownPayload(mixedTopLevel), false);
  const mixedModel = structuredClone(legacy);
  mixedModel.model.worldPlan = fable5.worldPlan;
  assert.equal(isValidLegacyTownPayload(mixedModel), false);
  const mixedLayout = structuredClone(legacy);
  mixedLayout.layout.worldPlan = fable5.worldPlan;
  assert.equal(isValidLegacyTownPayload(mixedLayout), false);
});

test('legacy and Fable5 asset vocabularies are separate required sets', () => {
  assert.equal(REQUIRED_ASSET_IDS.length, 78);
  assert.equal(WAVE_A_ASSET_IDS.length, 109);
  assert.equal(REQUIRED_ASSET_IDS.includes('field.grass'), true);
  assert.equal(REQUIRED_ASSET_IDS.includes('terrain.grass'), false);
  assert.equal(WAVE_A_ASSET_IDS.includes('terrain.grass'), true);
  assert.equal(WAVE_A_ASSET_IDS.includes('field.grass'), false);
});

test('recursive legacy allowlist rejects v2 data hidden in every nested payload family', async () => {
  const repoPath = new URL('../sample/tiny-town', import.meta.url).pathname;
  const inspection = await inspectRepository(repoPath);
  const canonical = await buildLegacyTownPayload(repoPath, inspection);
  assert.equal(isValidLegacyTownPayload(canonical), true);

  const injections = [
    ['habitability', (value) => { value.habitability.worldPlan = {}; }],
    ['facility', (value) => { value.model.facilities[0].worldPlan = {}; }],
    ['unknown facility kind', (value) => { value.model.facilities[0].kind = 'worldPlan'; }],
    ['missing facility', (value) => { value.model.facilities.pop(); }],
    ['facility evidence', (value) => { value.model.facilities[0].evidence.facts = []; }],
    ['facility details', (value) => {
      value.model.facilities.find((facility) => facility.details).details.worldPlan = {};
    }],
    ['guild item', (value) => { value.model.guild.じょうたい[0].facts = []; }],
    ['guild empty collection entity', (value) => {
      value.model.guild.なかま.push({ name: 'x', type: 'llm-sdk', evidenceClass: 'observed', worldPlan: {} });
    }],
    ['external report', (value) => {
      value.model.external.contractorReports.push({
        source: 'worker', subject: 'claim', status: 'pending-inspection', facts: []
      });
    }],
    ['model summary', (value) => { value.model.summary.worldPlan = {}; }],
    ['map', (value) => { value.layout.map.worldPlan = {}; }],
    ['terrain cell object', (value) => { value.layout.map.terrain[0][0] = { facts: [] }; }],
    ['district', (value) => { value.layout.districts[0].worldPlan = {}; }],
    ['building', (value) => { value.layout.buildings[0].facts = []; }],
    ['building footprint', (value) => { value.layout.buildings[0].footprint.worldPlan = {}; }],
    ['building entrance', (value) => { value.layout.buildings[0].entrance.facts = []; }],
    ['road', (value) => { value.layout.roads[0].worldPlan = {}; }],
    ['road tile object', (value) => { value.layout.roads[0].tiles[0] = { 0: 1, 1: 2, facts: [] }; }],
    ['npc', (value) => { value.layout.npcs[0].facts = []; }],
    ['prop', (value) => { value.layout.props[0].worldPlan = {}; }],
    ['connection', (value) => {
      value.layout.connections.push({ from: 'town', to: 'outside', kind: 'route', facts: [] });
    }],
    ['embedded validation', (value) => { value.layout.validation.worldPlan = {}; }],
    ['validation issue', (value) => {
      value.layout.validation.issues.push({ code: 'X', message: 'x', severity: 'info', facts: [] });
    }]
  ];

  for (const [label, inject] of injections) {
    const candidate = structuredClone(canonical);
    inject(candidate);
    assert.equal(isValidLegacyTownPayload(candidate), false, label);
  }
});
