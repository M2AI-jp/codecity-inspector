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

// REPLACES a withdrawn test that special-cased the inn as always enterable
// behind a "provisional-art fallback" (isBuildingRuntimeAvailable('inn')
// asserted true while city-hall/residence asserted false). The product
// owner ruled that fallback -- reopening the inn on a withdrawn character
// sheet labelled "provisional" -- a disguised-as-shipped misrepresentation
// and required it withdrawn entirely, with no replacement loophole of any
// kind. The inn's own character art is exactly as unapproved as city-hall's
// clerk and residence's occupant, so all three buildings must now assert
// identically unavailable. This is a replacement of the prior coverage for
// the inn's availability, not a deletion of it.
test('entry is conservative, finite-only, and keeps every building unavailable until its interior is approved', () => {
  for (const building of listBuildings()) {
    const point = building.exterior.entrance.approachPoint;
    assert.equal(isBuildingRuntimeAvailable(building.id), false, `${building.id} runtime availability`);
    assert.equal(canEnter(building.id, point), false, `${building.id} entry point`);
    assert.equal(canEnter(building.id, { x: Number.NaN, y: point.y }), false);
    assert.equal(canEnter(building.id, { x: point.x, y: Infinity }), false);
  }
  assert.equal(canEnter('inn', { x: 212, y: 460 }), false, 'do not make the inn frontage broadly enterable');
  assert.equal(canEnter('city-hall', { x: 640, y: 320 }), false, 'do not make the civic facade broadly enterable');
  assert.equal(canEnter('residence', { x: 997, y: 350 }), false, 'do not make the house facade broadly enterable');
  assert.equal(canEnter('unknown', { x: 640, y: 296 }), false);
});

// REPLACES 'only an approved building produces a customer-facing interior
// transition' (a test that asserted the inn alone could transition while it
// carried the withdrawn fallback). No building has an approved interior
// today, so none may transition.
test('no building produces a customer-facing interior transition while its interior remains unapproved', () => {
  for (const building of listBuildings()) {
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

// getQuestAffordance() is a pure function of quest state only. It has never
// independently re-checked the containing building's runtimeAvailability --
// city-hall's own affordance below has always worked this way, even before
// the inn's withdrawal. canEnter()/enter() are the boundary that actually
// keeps the player's mode/buildingId from ever reaching an unapproved
// building's interior in the first place (app.js's own
// enforceInteriorReleaseGate is a second, independent net on top of that),
// so a raw affordance query being "available" here never by itself lets a
// real player reach dialogue, quest-start, or a report. This test is
// unchanged by the inn's withdrawal.
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

// REPLACES 'the innkeeper accepts the report as a provisional fallback while
// city-hall remains unapproved' (a test that asserted a
// 'report-to-innkeeper-fallback' action became available once the
// investigation was complete, and that talking to the innkeeper with that
// quest state produced an enabled interaction). The product owner ruled
// that fallback a disguised substitute for the still-unbuilt city-hall
// report flow and required it withdrawn entirely -- see
// innQuestAffordance()'s own comment in building-runtime.mjs. This is a
// replacement of the prior fallback coverage with a regression guard against
// its return, not a deletion of coverage: a completed investigation must
// keep naming city hall as the only reporting route, with no NPC standing
// in for it.
test('a completed investigation has no substitute reporting route while city-hall is unapproved', () => {
  assert.equal(isBuildingRuntimeAvailable('city-hall'), false, 'fixture assumption: city-hall has no approved interior yet');
  const affordance = getQuestAffordance('inn', reportableState());
  assert.deepEqual(affordance, {
    id: 'report-ready', action: null, available: false, label: '市庁舎へ報告できる'
  });
  assert.notEqual(affordance.id, 'report-to-innkeeper-fallback');
  assert.notEqual(affordance.action, 'report-to-innkeeper-fallback');
  assert.equal(affordance.available, false, 'no NPC may accept the report on city-hall\'s behalf');
});

// REPLACES 'getInteraction exposes entry, truthful quest state, ambient
// residence action, and exit without mutation' (a test that asserted the
// inn's exterior produced an enabled 'enter-inn' interaction while
// city-hall/residence produced 'unavailable-*'). The inn's exterior now
// produces the identical honest 'unavailable' shape as city-hall and
// residence; this is a replacement of that assertion, not a deletion. The
// raw interior-branch assertions below are otherwise unchanged: they were
// never gated on building availability for any of the three buildings (see
// getInteraction()'s own comment in building-runtime.mjs for why that is
// still safe -- canEnter()/enter() are the real boundary, and this branch is
// unreachable for a blocked building through actual gameplay).
test('getInteraction reports every exterior as honestly unavailable, and truthful interior state, without mutation', () => {
  const fresh = createInvestigationState();
  const freshSnapshot = JSON.parse(JSON.stringify(fresh));
  const inn = getBuilding('inn');
  const innExterior = getInteraction({ mode: 'exterior', position: inn.exterior.entrance.approachPoint });
  assert.deepEqual(innExterior, {
    id: 'unavailable-inn',
    kind: 'unavailable',
    label: inn.runtimeAvailability.reason,
    place: inn.label,
    buildingId: 'inn',
    distance: 0,
    enabled: false,
    quest: null
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
