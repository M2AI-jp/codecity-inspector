import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSelectorDemand,
  deriveSelectorDemand,
} from '../../art-department/v1/selector-demand.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const staticArtifactPath = path.join(repositoryRoot, 'studio/art-department/v1/selector-demand.json');
const palettePath = path.join(repositoryRoot, 'studio/art-department/v1/palette.json');
const expectedSelectors = [
  'building:dock', 'building:dojo', 'building:gate', 'building:guild',
  'building:house', 'building:inn', 'building:pub', 'building:ruin',
  'building:shop', 'building:town_hall', 'building:warehouse',
  'building:watchtower', 'building:well', 'building:workshop',
  'effect:town_hall_lantern_lit', 'light:lit', 'light:unknown', 'light:unlit',
  'npc:external-api', 'npc:http', 'npc:llm', 'npc:storage', 'npc:townsperson',
  'npc:unknown', 'npc:webhook', 'player:default', 'plot:occupied',
  'plot:vacant', 'prop:lamp', 'prop:sign', 'prop:tree', 'prop:well',
  'quest:inspect', 'road:branch', 'road:dead-end', 'road:main', 'room:dock',
  'room:dojo', 'room:gate', 'room:guild', 'room:house', 'room:inn', 'room:pub',
  'room:ruin', 'room:shop', 'room:town_hall', 'room:warehouse',
  'room:watchtower', 'room:well', 'room:workshop', 'terrain:basin',
  'terrain:coast', 'terrain:meadow', 'terrain:plain', 'terrain:terrace',
  'ui:choice', 'ui:dialogue', 'ui:guild-roster', 'ui:inspection-report',
  'water:default',
];

/*
 * T5 test obligations (declared before execution):
 *
 * - customer failure prevented: a required selector is absent, duplicated,
 *   wildcarded, or silently assigned to an unnecessary art request;
 * - owner requirement evidenced: the minimum finite selector gap has a public
 *   source trace, and the 22 original custody set remains observed;
 * - repository harm prevented: this gate reads only shipping contracts and
 *   immutable originals; it does not read, execute, mutate, or upload a
 *   customer repository and it creates no candidate bytes;
 * - observable pass/fail: sorted unique finite selectors, source trace per
 *   selector, explicit status, 22/22 custody, and zero candidate PNGs;
 * - passing does not prove candidate visual quality, owner approval, shipping,
 *   browser playability, package acquisition, or the KGI journey.
 */

test('T5 selector demand is finite, traced, and explicitly bounded', async () => {
  const report = await deriveSelectorDemand({ repositoryRoot });
  const repeat = await deriveSelectorDemand({ repositoryRoot });
  assert.equal(JSON.stringify(report), JSON.stringify(repeat), 'demand derivation must be byte-stable');
  assertSelectorDemand(report);
  assert.equal(report.status, 'ready');
  assert.equal(report.derivation.kind, 'boundedPublicIndexLiteralRead');
  assert.equal(report.derivation.sourceReadPolicy, 'bounded-exact-public-index-literal-only');
  assert.equal(report.derivation.noWildcardOrFallback, true);
  assert.deepEqual(report.derivation.missingFamilies, []);
  assert.deepEqual(report.selectors.map(({ selector }) => selector), expectedSelectors);
  assert.equal(report.selectorCount, 60);
  assert.ok(report.selectors.some(({ selector }) => selector === 'water:default'));
  assert.ok(report.selectors.some(({ selector }) => selector === 'effect:town_hall_lantern_lit'));
  assert.equal(report.derivation.boundedWater.matchCount, 1);
  assert.equal(report.derivation.boundedWater.literal, "selectors.add('water:default')");
  assert.equal(report.derivation.boundedWater.policy, 'exact-single-literal; wildcard/fallback/unknown rejected');
  assert.match(report.derivation.boundedWater.fileSha256, /^[a-f0-9]{64}$/u);
  assert.match(report.derivation.boundedWater.literalDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(report.derivation.integrationBlockers, [{
    id: 'p4-scene-reward-transition-alignment',
    state: 'known',
    owner: 'P4',
    source: 'ship/60-scene-compiler/index.mjs#REWARD_CHANGES',
    transition: 'repository_inspected',
    effectSelector: 'effect:town_hall_lantern_lit',
    expectedError: 'REWARD_TRANSITION_INVALID',
    limitation: 'selector demand proves finite asset identity and custody only; it does not prove WorldPlan-to-SceneBundle composition or reward-transition acceptance',
  }]);
  assert.equal(report.custody.ok, true);
  assert.equal(report.custody.expected, 22);
  assert.equal(report.custody.checked, 22);
  assert.equal(report.custody.originals.length, 22);
  assert.ok(report.custody.originals.every(({ immutable, observed }) => immutable === true && observed === true));
  assert.deepEqual(report.custody.failures, []);
  assert.deepEqual(report.custody.unexpected, []);
  assert.equal(report.candidatePngCount, 0);
  assert.equal(report.limits.selectorsSortedUnique, true);
  assert.equal(report.limits.sourceTracePerSelector, true);
  assert.equal(report.limits.wildcardOrFallbackPresent, false);
  assert.equal(report.selectors.length, 60);
  const selectors = report.selectors.map(({ selector }) => selector);
  assert.deepEqual(selectors, [...selectors].sort());
  assert.equal(new Set(selectors).size, selectors.length);
  const traceIds = new Set(report.sourceTraces.map(({ id }) => id));
  for (const entry of report.selectors) {
    assert.ok(entry.sourceTraceIds.length > 0, `${entry.selector} has no finite source trace`);
    for (const traceId of entry.sourceTraceIds) assert.ok(traceIds.has(traceId), `${entry.selector} references unknown trace ${traceId}`);
    assert.ok(['reference-available', 'reference-gap'].includes(entry.originalCoverage.status));
    assert.equal(entry.candidate.state, 'none');
    assert.equal(entry.candidate.path, null);
    assert.equal(entry.candidate.sha256, null);
  }

  const artifact = JSON.parse(fs.readFileSync(staticArtifactPath, 'utf8'));
  assert.deepEqual(artifact, report, 'checked-in selector-demand artifact must equal fresh deterministic derivation');
});

test('T5 static demand and palette artifacts retain non-generative custody limits', () => {
  const artifact = JSON.parse(fs.readFileSync(staticArtifactPath, 'utf8'));
  assert.equal(artifact.format, 'codecity.v1-selector-demand');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.candidatePngCount, 0);
  assert.equal(artifact.custody.ok, true);
  assert.equal(artifact.custody.expected, 22);
  assert.equal(artifact.custody.checked, 22);
  assert.equal(artifact.status, 'ready');
  assert.equal(artifact.selectorCount, 60);
  assert.deepEqual(artifact.selectors.map(({ selector }) => selector), expectedSelectors);
  assert.equal(artifact.custody.originals.length, 22);
  assert.deepEqual(artifact.custody.failures, []);
  assert.deepEqual(artifact.custody.unexpected, []);
  assertSelectorDemand(artifact);

  const palette = JSON.parse(fs.readFileSync(palettePath, 'utf8'));
  assert.equal(palette.id, 'palette-v2');
  assert.ok(Array.isArray(palette.colors));
  assert.ok(palette.colors.length >= 32 && palette.colors.length <= 48);
  assert.equal(new Set(palette.colors).size, palette.colors.length);
  assert.ok(palette.colors.every((color) => /^#[0-9a-f]{6}$/u.test(color)));
});
