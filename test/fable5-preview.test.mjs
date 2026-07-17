import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectRepository } from '../src/inspector.mjs';
import { buildTownPayload } from '../src/town/index.mjs';
import {
  CUTAWAY_TRANSITION_MS,
  FACILITY_LABEL_DISTANCE,
  NAV_EDGES,
  NAV_NODES,
  SOUND_CUES,
  TEMPLATE_GAME_BUNDLE,
  bindTemplateTour,
  cutawayOpacity,
  facilityLabelFor,
  shortestRoute
} from '../public/fable5-v2/preview.js';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('repository-driven scene-template game keeps its art, controls, and evidence separation', async () => {
  const [html, css, source] = await Promise.all([
    read('public/fable5-v2/preview.html'), read('public/fable5-v2/preview.css'), read('public/fable5-v2/preview.js')
  ]);
  assert.match(html, /REPOSITORY-DRIVEN SEEDED SCENE-TEMPLATE GAME/);
  assert.match(html, /四地区を歩くゲーム画面/);
  assert.match(html, /seed で決定的/);
  assert.match(html, /地形・構図・アートは4地区の固定テンプレート/);
  assert.match(html, /ゲームプログラムも含みます/);
  assert.match(source, /assets\/backplates\/old-town-v1\.png/);
  assert.match(source, /assets\/backplates\/old-town-inn-cutaway-v1\.png/);
  assert.match(source, /assets\/backplates\/harbor-day-v1\.png/);
  assert.match(source, /assets\/backplates\/snow-day-v1\.png/);
  assert.match(source, /assets\/backplates\/woodland-day-v1\.png/);
  assert.match(source, /assets\/backplates\/old-town-night-v1\.png/);
  assert.match(source, /assets\/characters\/player-inspector-idle-v1\.png/);
  assert.doesNotMatch(source, /manifest|forge\/|old-v1/i);
  assert.match(source, /NAV_NODES/); assert.match(source, /NAV_EDGES/); assert.match(source, /shortestRoute/); assert.match(source, /directionalTarget/);
  assert.match(source, /bindTemplateTour/);
  assert.match(source, /TEMPLATE_GAME_BUNDLE/);
  assert.match(source, /inn-doorstep/); assert.match(source, /inn-threshold/); assert.match(source, /inn-counter/);
  assert.match(source, /扉の奥をタップ/); assert.match(source, /カウンターをタップして奥へ/);
  assert.match(source, /宿の主人/); assert.match(source, /宿屋のカウンター/); assert.match(source, /宿の主人と話す/);
  assert.match(source, /state\.innFade/); assert.match(source, /context\.globalAlpha = state\.innFade/);
  assert.match(source, /CUTAWAY_TRANSITION_MS/); assert.match(source, /setInnOpen/); assert.match(source, /sound\.play\(open \? 'enter' : 'exit'\)/);
  assert.match(source, /openDialogue/); assert.match(source, /closeDialogue/); assert.match(source, /Escape/);
  assert.match(html, /id="dialogue"/); assert.match(html, /id="dialogue-close"/);
  assert.match(html, /id="sound-toggle"/); assert.match(html, /aria-pressed="false"/); assert.match(source, /SOUND_CUES/);
  assert.match(source, /閉鎖看板/); assert.match(source, /壊れているとは断定できません/);
  assert.match(source, /DISTRICTS/); assert.match(source, /TRAVELS/); assert.match(source, /transitionTo/);
  assert.match(source, /港の荷役人/); assert.match(source, /雪原の観測者/); assert.match(source, /森の案内人/);
  assert.match(source, /old-exit/); assert.match(source, /harbor-exit/); assert.match(source, /snow-exit/); assert.match(source, /woodland-return/);
  assert.match(source, /nightReturn/); assert.match(source, /旧市街の夜/);
  assert.match(source, /state\.finished/); assert.match(source, /4地区の巡回を完了した/);
  assert.match(html, /id="scene-overlay"/);
  assert.match(source, /ArrowUp/); assert.match(source, /\bw:\s*\[0, -1\]/); assert.match(source, /pointerdown/); assert.match(source, /\['e', 'Enter', ' '\]/);
  assert.match(source, /separateFacts/); assert.match(source, /observed.*inferred.*unknown/s);
  assert.match(source, /humanizeEvidence\(sentence\)/); assert.match(source, /静的検査で、街への入口として直接確認しました/);
  assert.match(source, /imageSmoothingEnabled = false/);
  assert.match(source, /fetch\('\/api\/town'\)/);
  assert.match(source, /Promise\.all\(\[assetsReady, loadTourBinding\(\)\]\)/);
  assert.doesNotMatch(source, /Math\.random|https?:\/\//);
  assert.match(css, /aspect-ratio: 16 \/ 10/);
});

function repositoryFact(id, type, evidenceKind, path) {
  return {
    id,
    type,
    params: { path },
    evidence: {
      observed: evidenceKind === 'observed' ? [`inspection.fixture.${id}.observed`] : [],
      inferred: evidenceKind === 'inferred' ? [`inspection.fixture.${id}.inferred`] : [],
      unknown: evidenceKind === 'unknown' ? [`inspection.fixture.${id}.unknown`] : []
    },
    sayings: { primary: `${path.split('/').at(-1)}の検査記録です。`, reflect: [] }
  };
}

function repositoryBuilding(id, path, factId, verb, extra = {}) {
  return {
    id,
    assetId: 'building.house_s',
    files: [path],
    rooms: [{ file: path, props: [], npcId: null }],
    interaction: { verb, factRefs: [factId] },
    ...extra
  };
}

function makeRepositoryPayload(seed = 'seed-a') {
  const records = [
    ['hall', 'entrypoint', 'observed', 'src/main.mjs'],
    ['inn', 'facility_present', 'observed', 'src/service.mjs'],
    ['closed', 'unreached', 'inferred', 'src/legacy.mjs'],
    ['alpha', 'unresolved', 'observed', 'src/alpha.mjs'],
    ['beta', 'cycle', 'inferred', 'src/beta.mjs'],
    ['gamma', 'runtime_unknown', 'unknown', 'src/gamma.mjs'],
    ['delta', 'test_association', 'inferred', 'src/delta.mjs'],
    ['epsilon', 'unverified', 'unknown', 'src/epsilon.mjs'],
    ['zeta', 'entrypoint', 'observed', 'src/zeta.mjs'],
    ['eta', 'unresolved', 'observed', 'src/eta.mjs']
  ];
  const facts = records.map(([id, type, kind, path]) => repositoryFact(`fact.${id}`, type, kind, path));
  const hall = repositoryBuilding('building.hall', 'src/main.mjs', 'fact.hall', 'receive-journal', { facilityKind: 'town_hall' });
  const inn = repositoryBuilding('building.inn', 'src/service.mjs', 'fact.inn', 'talk-innkeeper', {
    facilityKind: 'inn', prefabId: 'prefab.service.inn.enterable', access: 'enterable',
    behaviorId: 'behavior.building.enterable-service', animationSetId: 'animation.building.cutaway.fade',
    cutawayDurationMs: 460, cutawayEasing: 'ease-in-out-cubic', soundSetId: 'sound.building.inn.entry',
    labelMode: 'proximity', collisionExterior: 'solid-footprint', collisionEntrance: 'door', collisionInterior: 'walkable',
    eventIds: ['event.facility.approach', 'event.facility.enter', 'event.facility.talk-keeper', 'event.facility.exit'],
    speakerRole: 'keeper.inn'
  });
  const closed = repositoryBuilding('building.closed', 'src/legacy.mjs', 'fact.closed', 'inspect-closure-sign', {
    prefabId: 'prefab.module.closed-unreached', access: 'closed',
    behaviorId: 'behavior.building.closed-evidence-sign', animationSetId: 'animation.building.closed.idle',
    cutawayDurationMs: 0, cutawayEasing: 'linear', soundSetId: 'sound.building.closed-sign',
    labelMode: 'proximity', collisionExterior: 'solid-footprint', collisionEntrance: 'blocked', collisionInterior: 'none',
    eventIds: ['event.facility.approach', 'event.facility.inspect-closure-sign']
  });
  closed.rooms[0].props = ['prop.closed-sign'];
  const verbs = ['inspect-entry-tags', 'watch-forms', 'talk-neighbor', 'use-telescope', 'read-away-sign', 'inspect-field-notice', 'inspect-entry-tags'];
  const witnesses = records.slice(3).map(([id, , , path], index) => repositoryBuilding(`building.${id}`, path, `fact.${id}`, verbs[index]));
  return {
    repository: { name: 'fixture-repository' },
    worldPlan: {
      seed, facts, buildings: [hall, inn, closed, ...witnesses],
      npcs: [{ id: 'npc.innkeeper', home: inn.id, role: 'keeper.inn' }],
      props: [{ id: 'prop.closed-sign', assetId: 'structure.signpost_broken', kind: 'closed-unreached-needs-confirmation', factRef: 'fact.closed' }]
    }
  };
}

function reachable(edges, start, target) {
  const queue = [start], seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === target) return true;
    for (const [left, right] of edges) {
      const next = left === current ? right : right === current ? left : null;
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}

test('WorldPlan binding is byte-stable for a seed and changes equivalent witness ties with another seed', () => {
  const payload = makeRepositoryPayload('seed-a');
  const first = bindTemplateTour(payload);
  const second = bindTemplateTour(payload);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const reordered = structuredClone(payload);
  reordered.worldPlan.buildings.reverse();
  reordered.worldPlan.facts.reverse();
  assert.deepEqual(bindTemplateTour(reordered), first);

  const alternate = bindTemplateTour(makeRepositoryPayload('seed-b'));
  const dynamic = (binding) => binding.zones.filter(({ id }) => !['hall', 'inn', 'closed-sign'].includes(id)).map(({ id, buildingId }) => [id, buildingId]);
  assert.notDeepEqual(dynamic(alternate), dynamic(first));
  assert.equal(first.assetBundle, TEMPLATE_GAME_BUNDLE);
});

test('every repository-mode zone binds a real building, canonical fact, and evidence class', () => {
  const payload = makeRepositoryPayload(), binding = bindTemplateTour(payload);
  const buildingIds = new Set(payload.worldPlan.buildings.map(({ id }) => id));
  const factIds = new Set(payload.worldPlan.facts.map(({ id }) => id));
  assert.equal(binding.mode, 'repository');
  assert.ok(binding.zones.some(({ id }) => id === 'closed-sign'));
  for (const zone of binding.zones) {
    assert.ok(buildingIds.has(zone.buildingId), zone.id);
    assert.ok(factIds.has(zone.factId), zone.id);
    assert.ok(['observed', 'inferred', 'unknown'].includes(zone.evidenceKind), zone.id);
    const building = payload.worldPlan.buildings.find(({ id }) => id === zone.buildingId);
    assert.ok(building.files.some((path) => zone.place.includes(path.split('/').at(-1))), zone.id);
    assert.match(zone.evidence, /^(?:観測|推定|不明)：/);
  }
  assert.equal(binding.inn.cutawayDurationMs, 460);
  assert.equal(binding.inn.cutawayEasing, 'ease-in-out-cubic');
  assert.equal(binding.inn.collisionEntrance, 'door');
  assert.ok(binding.inn.eventIds.includes('event.facility.enter'));
  assert.equal(binding.closed.signId, 'prop.closed-sign');
  assert.equal(binding.closed.collisionEntrance, 'blocked');
  assert.ok(binding.closed.eventIds.includes('event.facility.inspect-closure-sign'));
  assert.equal(binding.zones.find(({ id }) => id === 'inn').speaker, '宿の主人');
  const verbFor = (slotId) => payload.worldPlan.buildings.find(({ id }) => id === binding.zones.find((zone) => zone.id === slotId).buildingId).interaction.verb;
  assert.equal(verbFor('well'), 'use-telescope');
  assert.ok(['inspect-entry-tags', 'read-away-sign', 'inspect-field-notice'].includes(verbFor('shop')));
  assert.equal(verbFor('harbor-witness'), 'inspect-entry-tags');
  assert.equal(verbFor('snow-witness'), 'watch-forms');
  assert.equal(verbFor('woodland-witness'), 'talk-neighbor');
});

test('missing prefab contracts remove inn entry and closed sign without blocking the four-scene route', () => {
  const payload = makeRepositoryPayload();
  payload.worldPlan.buildings.find(({ id }) => id === 'building.inn').prefabId = 'prefab.not-supported';
  payload.worldPlan.buildings.find(({ id }) => id === 'building.closed').rooms[0].props = [];
  payload.worldPlan.props = [];
  const binding = bindTemplateTour(payload);
  assert.equal(binding.mode, 'repository');
  assert.equal(binding.inn, null);
  assert.equal(binding.closed, null);
  assert.ok(!binding.zones.some(({ id }) => id === 'inn' || id === 'closed-sign'));
  assert.ok(!binding.edgesByDistrict['old-town'].some(([from, to]) => from === 'inn-doorstep' && to === 'inn-threshold'));
  for (const [district, start, exit] of [
    ['old-town', 'start', 'old-exit'], ['harbor', 'harbor-start', 'harbor-exit'],
    ['snow', 'snow-start', 'snow-exit'], ['woodland', 'woodland-start', 'woodland-return']
  ]) assert.equal(reachable(binding.edgesByDistrict[district], start, exit), true, district);
});

test('the read-only tiny-town sample maps semantically matching files to each painted scene slot', async () => {
  const repoPath = fileURLToPath(new URL('../sample/tiny-town', import.meta.url));
  const inspection = await inspectRepository(repoPath);
  const payload = await buildTownPayload(repoPath, inspection);
  const binding = bindTemplateTour(payload);
  const buildingById = new Map(payload.worldPlan.buildings.map((building) => [building.id, building]));
  const fileFor = (slotId) => buildingById.get(binding.zones.find(({ id }) => id === slotId)?.buildingId)?.files?.[0];

  assert.equal(fileFor('well'), 'src/well.js');
  assert.equal(fileFor('shop'), 'src/market.js');
  assert.equal(fileFor('harbor-witness'), 'src/harbor.js');
  assert.equal(fileFor('snow-witness'), 'src/watchtower.js');
  assert.equal(fileFor('woodland-witness'), 'test/inn.test.js');
});

test('inn cutaway uses a bounded eased transition instead of an abrupt swap', () => {
  assert.equal(CUTAWAY_TRANSITION_MS, 460);
  assert.equal(cutawayOpacity(0, 1, -10), 0);
  assert.equal(cutawayOpacity(0, 1, CUTAWAY_TRANSITION_MS / 2), .5);
  assert.equal(cutawayOpacity(0, 1, CUTAWAY_TRANSITION_MS), 1);
  assert.equal(cutawayOpacity(1, 0, CUTAWAY_TRANSITION_MS), 0);
  assert.ok(cutawayOpacity(0, 1, 100) < cutawayOpacity(0, 1, 300));
});

test('facility labels are proximity-only while enterability and unknown closure stay explicit', () => {
  assert.equal(facilityLabelFor(FACILITY_LABEL_DISTANCE + 1, { name: '宿屋', enterable: true }), '');
  assert.equal(facilityLabelFor(FACILITY_LABEL_DISTANCE, { name: '宿屋', enterable: true }), '宿屋 · 入れる');
  assert.equal(facilityLabelFor(30, { name: '商店' }), '');
  assert.equal(facilityLabelFor(30, { name: '商店', active: true }), '商店');
  assert.equal(facilityLabelFor(30, { name: '閉鎖', status: 'unreached' }), '閉鎖 · 未到達・要確認');
});

test('the optional closed-building spur does not replace the inn threshold route', () => {
  const route = shortestRoute('start', 'inn-counter', NAV_NODES, NAV_EDGES).map(({ id }) => id);
  assert.deepEqual(route, ['start', 'west-road', 'inn-turn', 'inn-doorstep', 'inn-threshold', 'inn-floor', 'inn-counter']);
  assert.ok(NAV_EDGES.some(([a, b]) => a === 'west-road' && b === 'dead-sign'));
});

test('sound cues are local procedural envelopes with short, subtle durations', async () => {
  const source = await read('public/fable5-v2/preview.js');
  assert.deepEqual(Object.keys(SOUND_CUES).sort(), ['enter', 'exit', 'interact']);
  for (const cue of Object.values(SOUND_CUES)) for (const note of cue) {
    assert.ok(note.frequency > 0 && note.endFrequency > 0);
    assert.ok(note.duration > 0 && note.duration <= .2);
    assert.ok(note.gain > 0 && note.gain <= .04);
  }
  assert.match(source, /AudioContext/);
  assert.doesNotMatch(source, /new Audio\(|\.mp3|\.wav|\.ogg/i);
});
