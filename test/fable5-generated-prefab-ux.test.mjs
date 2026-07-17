import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { inspectRepository } from '../src/inspector.mjs';
import { buildTownModel } from '../src/town/detect.mjs';
import { generateWorldPlan } from '../src/town/world-plan-generator.mjs';

const [source, html, css] = await Promise.all([
  readFile(new URL('../public/fable5-v2/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/fable5-v2/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/fable5-v2/styles.css', import.meta.url), 'utf8')
]);

test('generated city exposes an accessible, default-on local sound control', () => {
  assert.match(html, /id="sound-toggle"[^>]*aria-pressed="false"[^>]*aria-label="効果音をミュートする"/);
  assert.match(source, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(source, /createOscillator\(\)/);
  assert.match(source, /'sound\.building\.inn\.entry'/);
  assert.match(source, /'sound\.building\.closed-sign'/);
  assert.match(source, /'event\.facility\.enter': 'enter'/);
  assert.match(source, /'event\.facility\.exit': 'exit'/);
  assert.match(source, /'event\.facility\.talk-keeper': 'interact'/);
  assert.match(source, /'event\.facility\.inspect-closure-sign': 'interact'/);
  assert.match(source, /function playPrefabEvent\(building, eventId\)/);
  assert.match(source, /const cue = program\.soundEvents\[eventId\]/);
  assert.doesNotMatch(source, /function buildingHasSound/);
  assert.match(source, /void sound\.prime\(\)/);
  assert.doesNotMatch(source, /new Audio\s*\(|\.mp3|\.wav|\.ogg/);
});

test('generated city labels facilities only through the proximity prompt', () => {
  assert.match(html, /id="nearby-prompt"[^>]*hidden/);
  assert.match(html, /id="nearby-note"/);
  assert.match(source, /nearestInteraction\(state\.runtime, state\.player\.x, state\.player\.y\)/);
  assert.match(source, /elements\.nearbyPrompt\.hidden = true/);
  assert.match(source, /\$\{displayBuildingName\(nearby\.building\)\} · 入れる/);
  assert.match(source, /function drawEntranceAffordances\(timestamp\)/);
  assert.match(source, /buildingAccess\(building\) !== 'enterable'/);
  assert.match(source, /'behavior\.building\.enterable-service'/);
  assert.match(source, /entrance === 'door'/);
  assert.match(source, /interior === 'walkable'/);
  assert.doesNotMatch(source, /fillText\(displayBuildingName/);
});

test('closed prefabs cannot trigger cutaway and are described without claiming dead code', () => {
  assert.match(source, /buildingAllowsCutaway\(cutawayCandidate\) \? cutawayCandidate : null/);
  assert.match(source, /'behavior\.building\.closed-evidence-sign'/);
  assert.match(source, /entrance === 'blocked'/);
  assert.match(source, /interior === 'none'/);
  assert.match(source, /閉鎖 · 未到達／要確認/);
  assert.match(source, /死んだコードとは断定していません/);
  assert.match(source, /閉鎖看板を調べる/);
  assert.match(html, /壊れた閉鎖看板/);
  assert.match(html, /実行時に未使用、削除可能、または故障しているとは断定しません/);
  assert.match(css, /\.nearby-prompt\[data-access="closed"\]/);
});

test('roof cutaway uses prefab duration, cubic easing, and continuity-preserving reversal', () => {
  assert.match(source, /const CUTAWAY_TRANSITION_MS = 460/);
  assert.match(source, /function easeInOutCubic\(progress\)/);
  assert.match(source, /'animation\.building\.cutaway\.fade'/);
  assert.match(source, /prefab\.cutawayDurationMs === animation\.durationMs/);
  assert.match(source, /prefab\.cutawayEasing === animation\.easingId/);
  assert.match(source, /transition\.from \+ \(transition\.to - transition\.from\) \* transition\.easing\(progress\)/);
  assert.match(source, /animation\.durationMs \* Math\.abs\(target - current\)/);
  assert.match(source, /\{ from: current, to: target, startedAt: timestamp, duration, easing: animation\.easing \}/);
  assert.match(source, /state\.reducedMotion/);
});

test('prefab behavior dispatch fails closed on mismatched program fields and names the inn keeper', () => {
  assert.match(source, /const PREFAB_BEHAVIOR_REGISTRY/);
  assert.match(source, /PREFAB_BEHAVIOR_REGISTRY\[prefab\?\.behaviorId\]/);
  assert.match(source, /sameEventIds\(prefab\.eventIds, behavior\.eventIds\)/);
  assert.match(source, /prefab\.collision\?\.exterior === behavior\.collision\.exterior/);
  assert.match(source, /prefab\.interactionVerb === behavior\.interactionVerb/);
  assert.match(source, /const program = matches \? Object\.freeze/);
  assert.match(source, /const invalidPrefab = declaredPrefab && !program/);
  assert.match(source, /!invalidPrefab && state\.assetsComplete/);
  assert.match(source, /function dispatchPrefabInteraction\(nearby, program\)/);
  assert.match(source, /if \(!enterable && !closed\) return false/);
  assert.match(source, /hasPrefabDeclaration\(state\.nearby\.building\) && !program/);
  assert.match(source, /Prefabの動作宣言が一致しないため、この施設は操作できません/);
  assert.match(source, /prefabProgram\(building\)\?\.speakerRole === 'keeper\.inn'/);
  assert.match(source, /return '宿の主人'/);
  assert.match(css, /\.nearby-prompt\[data-access="invalid"\]/);
});

test('bundled sample legacy interiors receive the existing-program entry affordance without prefab fallback', async () => {
  const samplePath = fileURLToPath(new URL('../sample/tiny-town/', import.meta.url));
  const inspection = await inspectRepository(samplePath);
  const plan = generateWorldPlan({ inspection, model: buildTownModel(inspection), seed: 'legacy-entry-affordance' });
  const nodeById = new Map(plan.nav.nodes.map((node) => [node.id, node]));
  const legacyInteriors = plan.buildings.filter((building) => !building.prefabId
    && building.class !== 'S'
    && building.rooms.some((room) => room.floorNavNodeIds.some((nodeId) => (
      nodeById.get(nodeId)?.space === 'interior'
    )))
    && plan.nav.edges.some((edge) => edge.kind === 'door'
      && building.rooms.some((room) => room.floorNavNodeIds.includes(edge.from) || room.floorNavNodeIds.includes(edge.to))));
  assert.ok(legacyInteriors.length > 0, 'sample must exercise no-prefab buildings with real interior door navigation');
  assert.match(source, /const LEGACY_ENTERABLE_PROGRAM/);
  assert.match(source, /function legacyEnterableProgram\(building\)/);
  assert.match(source, /node\?\.space === 'interior' && node\.buildingId === building\.id/);
  assert.match(source, /edge\.kind === 'door'/);
  assert.match(source, /return legacyEnterableProgram\(building\)\?\.access \?\? null/);
  assert.match(source, /if \(!hasPrefabDeclaration\(building\)\) return Boolean\(legacyEnterableProgram\(building\)\)/);
  assert.match(source, /if \(!building \|\| hasPrefabDeclaration\(building\)/);
});
