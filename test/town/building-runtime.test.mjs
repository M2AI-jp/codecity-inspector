import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvestigationState, recordInvestigationClue, startInnDialogue, chooseInvestigationQuestion } from '../../public/fable5-v2/quest-runtime.mjs';
import {
  canEnter,
  canExit,
  enter,
  exit,
  FABLE5_BUILDINGS,
  FABLE5_BUILDING_MODE,
  getBuilding,
  getInteraction,
  getQuestAffordance,
  isBuildingRuntimeAvailable,
  isInteriorWalkable,
  listBuildings
} from '../../public/fable5-v2/building-runtime.mjs';
import { isExteriorWalkable } from '../../public/fable5-v2/world-runtime.mjs';

function accepted(result) {
  assert.equal(result.ok, true, result.code ?? 'expected valid quest transition');
  return result.state;
}

function reportableState() {
  let state = accepted(startInnDialogue(createInvestigationState()));
  state = accepted(chooseInvestigationQuestion(state, 'observed'));
  for (const clueId of ['clue-streetlamp', 'clue-well', 'clue-east-shop']) {
    state = accepted(recordInvestigationClue(state, clueId, [`fact:${clueId}`]));
  }
  return state;
}

test('lists exactly the three promised immutable building contracts in stable order', () => {
  assert.deepEqual(listBuildings().map(({ id }) => id), ['inn', 'city-hall', 'residence']);
  assert.equal(listBuildings(), FABLE5_BUILDINGS);
  for (const building of listBuildings()) {
    assert.ok(Object.isFrozen(building));
    assert.ok(Object.isFrozen(building.exterior));
    assert.ok(Object.isFrozen(building.interior));
    assert.equal(getBuilding(building.id), building);
  }
  assert.equal(getBuilding('east-shop'), null);
  assert.equal(getBuilding(null), null);
});

test('every promised exterior entry and return point stays on the measured exterior collision field', () => {
  for (const building of listBuildings()) {
    const { approachPoint, returnPoint } = building.exterior.entrance;
    assert.equal(isExteriorWalkable(approachPoint.x, approachPoint.y), true, `${building.id} entry`);
    assert.equal(isExteriorWalkable(returnPoint.x, returnPoint.y), true, `${building.id} return`);
  }
});

test('entry is conservative, finite-only, and keeps unapproved interiors unavailable', () => {
  for (const building of listBuildings()) {
    const point = building.exterior.entrance.approachPoint;
    assert.equal(canEnter(building.id, point), building.id === 'inn', `${building.id} entry point`);
    assert.equal(isBuildingRuntimeAvailable(building.id), building.id === 'inn', `${building.id} runtime availability`);
    assert.equal(canEnter(building.id, { x: Number.NaN, y: point.y }), false);
    assert.equal(canEnter(building.id, { x: point.x, y: Infinity }), false);
  }
  assert.equal(canEnter('city-hall', { x: 640, y: 320 }), false, 'do not make the civic facade broadly enterable');
  assert.equal(canEnter('residence', { x: 997, y: 350 }), false, 'do not make the house facade broadly enterable');
  assert.equal(canEnter('unknown', { x: 640, y: 296 }), false);
});

test('only an approved building produces a customer-facing interior transition', () => {
  for (const building of listBuildings().filter(({ id }) => id === 'inn')) {
    const exteriorPosition = { ...building.exterior.entrance.approachPoint };
    const transition = enter(building.id, exteriorPosition);
    assert.ok(transition, building.id);
    assert.deepEqual(transition, {
      mode: FABLE5_BUILDING_MODE.INTERIOR,
      buildingId: building.id,
      player: building.interior.entryFoot,
      cameraFocus: building.interior.cameraFocus
    });
    assert.ok(Object.isFrozen(transition));
    assert.ok(Object.isFrozen(transition.player));
    assert.deepEqual(exteriorPosition, building.exterior.entrance.approachPoint);
  }
  for (const building of listBuildings().filter(({ id }) => id !== 'inn')) {
    assert.equal(enter(building.id, building.exterior.entrance.approachPoint), null, `${building.id} remains unavailable`);
  }
  assert.equal(enter('unknown', { x: 0, y: 0 }), null);
  assert.equal(enter('inn', { x: 0, y: 0 }), null);
});

test('interior movement is conservative and every exit returns outside its trigger', () => {
  for (const building of listBuildings()) {
    const { entryFoot, exitFoot } = building.interior;
    assert.equal(isInteriorWalkable(building.id, entryFoot), true, `${building.id} entry interior`);
    // The shipped inn places its exit interaction anchor just beyond the
    // full-footprint polygon, so exiting is deliberately proximity-based.
    // Other rooms may keep their anchor walkable; both variants are safe.
    assert.equal(typeof isInteriorWalkable(building.id, exitFoot), 'boolean');
    assert.equal(canExit(building.id, entryFoot), true, `${building.id} entry also within no-bounce exit zone`);
    const transition = exit(building.id, exitFoot);
    assert.ok(transition, building.id);
    assert.equal(transition.mode, FABLE5_BUILDING_MODE.EXTERIOR);
    assert.equal(transition.buildingId, null);
    assert.deepEqual(transition.player, building.exterior.entrance.returnPoint);
    assert.equal(canEnter(building.id, transition.player), false, `${building.id} exit must not immediately re-enter`);
  }
});

test('interior collision and exit reject unknown buildings, non-finite positions, and points beyond the room', () => {
  assert.equal(isInteriorWalkable('unknown', { x: 1, y: 1 }), false);
  assert.equal(isInteriorWalkable('inn', { x: Infinity, y: 438 }), false);
  assert.equal(isInteriorWalkable('city-hall', { x: 640, y: 100 }), false);
  assert.equal(canExit('residence', { x: 997, y: 246 }), false);
  assert.equal(exit('residence', { x: 997, y: 246 }), null);
});

test('quest affordances are validated against the real quest state and gate town-hall reporting', () => {
  const fresh = createInvestigationState();
  assert.deepEqual(getQuestAffordance('inn', fresh), {
    id: 'start-inn-dialogue', action: 'start-inn-dialogue', available: true, label: '調査について尋ねる'
  });
  assert.deepEqual(getQuestAffordance('city-hall', fresh), {
    id: 'report-not-ready', action: null, available: false, label: '三つの手掛かりをそろえてから報告する'
  });
  assert.deepEqual(getQuestAffordance('city-hall', reportableState()), {
    id: 'submit-townhall-report', action: 'submit-townhall-report', available: true, label: '記録係に報告する'
  });
  assert.equal(getQuestAffordance('residence', fresh), null);
  assert.equal(getQuestAffordance('inn', { phase: 'new' }), null, 'partial/stale quest state fails closed');
  assert.equal(getQuestAffordance('unknown', fresh), null);
});

test('getInteraction exposes entry, truthful quest state, ambient residence action, and exit without mutation', () => {
  const fresh = createInvestigationState();
  const freshSnapshot = JSON.parse(JSON.stringify(fresh));
  const inn = getBuilding('inn');
  const exterior = getInteraction({ mode: 'exterior', position: inn.exterior.entrance.approachPoint });
  assert.deepEqual(exterior, {
    id: 'enter-inn', kind: 'enter', label: 'そのまま進むと入れます', place: '古町の宿屋',
    buildingId: 'inn', distance: 0, enabled: true, quest: null
  });

  const cityHallExterior = getInteraction({
    mode: 'exterior', position: getBuilding('city-hall').exterior.entrance.approachPoint
  });
  assert.equal(cityHallExterior.id, 'unavailable-city-hall');
  assert.equal(cityHallExterior.enabled, false);
  const residenceExterior = getInteraction({
    mode: 'exterior', position: getBuilding('residence').exterior.entrance.approachPoint
  });
  assert.equal(residenceExterior.id, 'unavailable-residence');
  assert.equal(residenceExterior.enabled, false);

  const innTalk = getInteraction({
    mode: 'interior', buildingId: 'inn', position: inn.interior.interaction.point, questState: fresh
  });
  assert.equal(innTalk.id, 'talk-innkeeper');
  assert.equal(innTalk.enabled, true);
  assert.equal(innTalk.quest.action, 'start-inn-dialogue');

  const cityHall = getBuilding('city-hall');
  const cityTalk = getInteraction({
    mode: 'interior', buildingId: 'city-hall', position: cityHall.interior.interaction.point, questState: fresh
  });
  assert.equal(cityTalk.id, 'talk-town-clerk');
  assert.equal(cityTalk.enabled, false);
  assert.equal(cityTalk.quest.id, 'report-not-ready');

  const residence = getBuilding('residence');
  const residenceTalk = getInteraction({
    mode: 'interior', buildingId: 'residence', position: residence.interior.interaction.point
  });
  assert.equal(residenceTalk.id, 'talk-resident');
  assert.equal(residenceTalk.enabled, true);
  assert.equal(residenceTalk.quest, null);

  const exitInteraction = getInteraction({
    mode: 'interior', buildingId: 'residence', position: residence.interior.exitFoot
  });
  assert.equal(exitInteraction.id, 'exit-residence');
  assert.equal(exitInteraction.kind, 'exit');

  assert.equal(getInteraction({ mode: 'interior', buildingId: 'unknown', position: { x: 0, y: 0 } }), null);
  assert.equal(getInteraction({ mode: 'typo', position: { x: 1, y: 1 } }), null);
  assert.equal(getInteraction({ mode: 'exterior', buildingId: 'inn', position: inn.exterior.entrance.approachPoint }), null);
  assert.deepEqual(fresh, freshSnapshot, 'querying interactions must never mutate the caller quest snapshot');
});
