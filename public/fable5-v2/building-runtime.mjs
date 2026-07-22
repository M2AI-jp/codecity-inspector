import {
  ACTOR_CONTRACT,
  INN_CONTRACT,
  isExteriorWalkable,
  pointInPolygon
} from './world-runtime.mjs';
import { serializeInvestigationState } from './quest-runtime.mjs';

// Building navigation is intentionally a small, data-only boundary between
// the town scene and the UI.  app.js owns rendering and transition animation;
// this module owns only which of the three promised buildings can be entered,
// where an actor arrives/leaves, and which quest action is currently honest.
// A design contract can exist before its artwork is approved; that is never
// permission to expose its inferred interior as a customer-facing route.
//
// Coordinate evidence:
// - inn is copied from the already-shipped INN_CONTRACT without changing its
//   trigger, interior walk polygon, or camera framing.
// - city-hall and residence exterior entry points are the conservative,
//   verified-walkable approach points previously recorded as closed entrances
//   in world-runtime.mjs: (640,296) and (997,296).  Their narrow trigger
//   radii deliberately avoid treating an entire facade as a door.
// - the two new interior polygons are design-space gameplay geometry.  They
//   are explicitly labelled `inferred` below so a renderer must not present
//   them as photographic/painted evidence before its approved interior art
//   exists.  The contract is nevertheless complete enough to keep movement,
//   entry/exit, camera, and quest code deterministic now.

export const FABLE5_BUILDING_MODE = Object.freeze({
  EXTERIOR: 'exterior',
  INTERIOR: 'interior'
});

function point(x, y) {
  return Object.freeze({ x, y });
}

function polygon(vertices) {
  return Object.freeze(vertices.map(([x, y]) => Object.freeze([x, y])));
}

function freezeBuilding(building) {
  return Object.freeze(building);
}

const INN_BUILDING = freezeBuilding({
  id: 'inn',
  label: '古町の宿屋',
  exteriorEvidence: 'observed',
  interiorEvidence: 'observed',
  runtimeAvailability: Object.freeze({ state: 'available', reason: null }),
  exterior: Object.freeze({
    // Retain the live inn trigger byte-for-byte as a rectangle so existing
    // approach/auto-transition behavior remains compatible.
    entrance: Object.freeze({
      shape: 'rect',
      x: INN_CONTRACT.door.triggerRect.x,
      y: INN_CONTRACT.door.triggerRect.y,
      width: INN_CONTRACT.door.triggerRect.width,
      height: INN_CONTRACT.door.triggerRect.height,
      approachPoint: INN_CONTRACT.door.approachPoint,
      returnPoint: INN_CONTRACT.door.returnPoint
    })
  }),
  interior: Object.freeze({
    walkPolygon: INN_CONTRACT.interior.walkPolygon,
    entryFoot: INN_CONTRACT.interior.entryFoot,
    exitFoot: INN_CONTRACT.interior.exitFoot,
    exitRadius: 42,
    cameraFocus: INN_CONTRACT.interior.cameraFocus,
    interaction: Object.freeze({
      id: 'talk-innkeeper',
      kind: 'quest',
      label: '宿帳係と話す',
      point: INN_CONTRACT.interior.npcInteractionPoint,
      radius: 58
    })
  })
});

const CITY_HALL_BUILDING = freezeBuilding({
  id: 'city-hall',
  label: '古町の市庁舎',
  exteriorEvidence: 'observed',
  interiorEvidence: 'inferred',
  runtimeAvailability: Object.freeze({
    state: 'blocked-pending-approved-interior',
    reason: '内装・小物・記録係の承認済み素材を準備中です'
  }),
  exterior: Object.freeze({
    entrance: Object.freeze({
      shape: 'circle',
      point: point(640, 296),
      radius: 16,
      approachPoint: point(640, 296),
      // The north plaza only has a thin measured walkable strip at the civic
      // door.  Returning east along that strip is the nearest safe point
      // outside the 16px trigger, rather than inventing paving through the
      // flowerbed south of the steps.
      returnPoint: point(688, 296)
    })
  }),
  interior: Object.freeze({
    walkPolygon: polygon([
      [552, 170], [728, 170], [728, 352], [684, 352],
      [684, 392], [596, 392], [596, 352], [552, 352]
    ]),
    entryFoot: point(640, 380),
    exitFoot: point(640, 370),
    exitRadius: 42,
    cameraFocus: point(640, 260),
    interaction: Object.freeze({
      id: 'talk-town-clerk',
      kind: 'quest',
      label: '市庁舎の記録係に報告する',
      point: point(640, 242),
      radius: 58
    })
  })
});

const RESIDENCE_BUILDING = freezeBuilding({
  id: 'residence',
  label: '古町の住宅',
  exteriorEvidence: 'observed',
  interiorEvidence: 'inferred',
  runtimeAvailability: Object.freeze({
    state: 'blocked-pending-approved-interior',
    reason: '内装・小物・住人の承認済み素材を準備中です'
  }),
  exterior: Object.freeze({
    entrance: Object.freeze({
      shape: 'circle',
      point: point(997, 296),
      radius: 18,
      approachPoint: point(997, 296),
      returnPoint: point(997, 336)
    })
  }),
  interior: Object.freeze({
    walkPolygon: polygon([
      [918, 178], [1076, 178], [1076, 348], [1038, 348],
      [1038, 388], [956, 388], [956, 348], [918, 348]
    ]),
    entryFoot: point(997, 376),
    exitFoot: point(997, 366),
    exitRadius: 42,
    cameraFocus: point(997, 264),
    interaction: Object.freeze({
      id: 'talk-resident',
      kind: 'ambient',
      label: '住人に挨拶する',
      point: point(997, 246),
      radius: 54
    })
  })
});

export const FABLE5_BUILDINGS = Object.freeze([
  INN_BUILDING,
  CITY_HALL_BUILDING,
  RESIDENCE_BUILDING
]);

const BUILDINGS_BY_ID = new Map(FABLE5_BUILDINGS.map((building) => [building.id, building]));

/** Returns the immutable three-building product contract in stable order. */
export function listBuildings() {
  return FABLE5_BUILDINGS;
}

/** Returns an immutable building contract, or null for an unknown ID. */
export function getBuilding(buildingId) {
  return typeof buildingId === 'string' ? BUILDINGS_BY_ID.get(buildingId) ?? null : null;
}

/** True only for a building whose customer-facing interior inputs are approved. */
export function isBuildingRuntimeAvailable(buildingId) {
  return getBuilding(buildingId)?.runtimeAvailability.state === 'available';
}

/**
 * True only when a finite, actually walkable exterior position is inside the
 * building's deliberately narrow entrance trigger.  Unknown IDs and invalid
 * positions fail closed.
 */
export function canEnter(buildingId, position) {
  const building = getBuilding(buildingId);
  if (!building || !isBuildingRuntimeAvailable(buildingId)
    || !isFinitePoint(position) || !isExteriorWalkable(position.x, position.y)) return false;
  return entranceContains(building.exterior.entrance, position);
}

/**
 * Produces the complete immutable state fragment for an exterior -> interior
 * switch, or null when entry is not allowed.  It never changes caller state.
 */
export function enter(buildingId, position) {
  const building = getBuilding(buildingId);
  if (!building || !canEnter(buildingId, position)) return null;
  return freezeTransition({
    mode: FABLE5_BUILDING_MODE.INTERIOR,
    buildingId: building.id,
    player: building.interior.entryFoot,
    cameraFocus: building.interior.cameraFocus
  });
}

/**
 * Tests a building-local interior position against the same full actor-foot
 * sample used by world-runtime's inn.  This is intentionally separate from
 * the rendering layer, so a missing image cannot make collision permissive.
 */
export function isInteriorWalkable(buildingId, position) {
  const building = getBuilding(buildingId);
  if (!building || !isFinitePoint(position)) return false;
  return actorSamplePoints(position).every(({ x, y }) => pointInPolygon(x, y, building.interior.walkPolygon));
}

/** True only when an actor is in the named interior and within its exit area. */
export function canExit(buildingId, position) {
  const building = getBuilding(buildingId);
  // Keep the inn's shipped behavior compatible: its `exitFoot` is an
  // interaction anchor immediately below the narrow walk polygon, so the
  // legacy runtime intentionally checks proximity rather than requiring the
  // full actor footprint to fit there.  Movement itself must still use
  // isInteriorWalkable(); this check only decides whether the doorway fires.
  if (!building || !isFinitePoint(position)) return false;
  return distanceBetween(position, building.interior.exitFoot) <= building.interior.exitRadius;
}

/**
 * Produces the complete immutable state fragment for an interior -> exterior
 * switch, or null when exit is not allowed.  Return points are rechecked
 * against measured exterior collision to prevent a stale contract from
 * spawning the actor into scenery.
 */
export function exit(buildingId, position) {
  const building = getBuilding(buildingId);
  if (!building || !canExit(buildingId, position)) return null;
  const returnPoint = building.exterior.entrance.returnPoint;
  if (!isExteriorWalkable(returnPoint.x, returnPoint.y)) return null;
  return freezeTransition({
    mode: FABLE5_BUILDING_MODE.EXTERIOR,
    buildingId: null,
    player: returnPoint,
    cameraFocus: returnPoint
  });
}

/**
 * Returns the immutable quest affordance that is honest for a validated
 * investigation snapshot.  A malformed/stale quest state is never guessed
 * from: it returns null rather than enabling an action.
 */
export function getQuestAffordance(buildingId, questState) {
  const building = getBuilding(buildingId);
  if (!building) return null;
  const normalized = serializeInvestigationState(questState);
  if (!normalized.ok) return null;

  if (building.id === 'inn') return innQuestAffordance(normalized.state.phase);
  if (building.id === 'city-hall') return townHallQuestAffordance(normalized.state.phase);
  return null;
}

/**
 * Finds one actionable/visible building interaction without mutating state.
 * Exterior callers pass `{ mode: 'exterior', position }`; interior callers
 * additionally pass the exact `buildingId` and a validated quest snapshot.
 * Invalid modes, positions, and building IDs return null.
 */
export function getInteraction({ mode, buildingId = null, position, questState } = {}) {
  if (!isFinitePoint(position)) return null;
  if (mode === FABLE5_BUILDING_MODE.EXTERIOR) {
    if (buildingId !== null) return null;
    const building = FABLE5_BUILDINGS.find((candidate) => isExteriorWalkable(position.x, position.y)
      && entranceContains(candidate.exterior.entrance, position));
    if (!building) return null;
    const distance = entranceDistance(building.exterior.entrance, position);
    if (!isBuildingRuntimeAvailable(building.id)) {
      return freezeInteraction({
        id: `unavailable-${building.id}`,
        kind: 'unavailable',
        label: building.runtimeAvailability.reason,
        place: building.label,
        buildingId: building.id,
        distance,
        enabled: false,
        quest: null
      });
    }
    return freezeInteraction({
      id: `enter-${building.id}`,
      kind: 'enter',
      label: 'そのまま進むと入れます',
      place: building.label,
      buildingId: building.id,
      distance,
      enabled: true,
      quest: null
    });
  }
  if (mode !== FABLE5_BUILDING_MODE.INTERIOR) return null;

  const building = getBuilding(buildingId);
  // Interaction anchors may sit at the visual edge of a room (notably the
  // already-shipped inn exit), while collision remains enforced by movement.
  // Do not silently break those anchors by demanding a full footprint here.
  if (!building) return null;
  const interaction = building.interior.interaction;
  if (distanceBetween(position, interaction.point) <= interaction.radius) {
    const quest = interaction.kind === 'quest' ? getQuestAffordance(building.id, questState) : null;
    return freezeInteraction({
      ...interaction,
      place: building.label,
      buildingId: building.id,
      distance: distanceBetween(position, interaction.point),
      enabled: interaction.kind !== 'quest' || Boolean(quest?.available),
      quest
    });
  }
  if (canExit(building.id, position)) {
    return freezeInteraction({
      id: `exit-${building.id}`,
      kind: 'exit',
      label: 'そのまま進むと出られます',
      place: building.label,
      buildingId: building.id,
      distance: distanceBetween(position, building.interior.exitFoot),
      enabled: true,
      quest: null
    });
  }
  return null;
}

function innQuestAffordance(phase) {
  if (phase === 'new') return freezeQuest({
    id: 'start-inn-dialogue', action: 'start-inn-dialogue', available: true,
    label: '調査について尋ねる'
  });
  if (phase === 'inn-dialogue') return freezeQuest({
    id: 'choose-investigation-question', action: 'choose-investigation-question', available: true,
    label: '問いを選ぶ'
  });
  if (phase === 'investigating') return freezeQuest({
    id: 'investigation-in-progress', action: null, available: false,
    label: '町で手掛かりを集める'
  });
  if (phase === 'reportable') return freezeQuest({
    id: 'report-ready', action: null, available: false,
    label: '市庁舎へ報告できる'
  });
  return freezeQuest({
    id: 'case-completed', action: null, available: false,
    label: '記録は市庁舎に保管された'
  });
}

function townHallQuestAffordance(phase) {
  if (phase === 'reportable') return freezeQuest({
    id: 'submit-townhall-report', action: 'submit-townhall-report', available: true,
    label: '記録係に報告する'
  });
  if (phase === 'completed') return freezeQuest({
    id: 'report-filed', action: null, available: false,
    label: '報告は記録済み'
  });
  return freezeQuest({
    id: 'report-not-ready', action: null, available: false,
    label: '三つの手掛かりをそろえてから報告する'
  });
}

function freezeQuest(value) {
  return Object.freeze(value);
}

function freezeInteraction(value) {
  return Object.freeze(value);
}

function freezeTransition({ mode, buildingId, player, cameraFocus }) {
  return Object.freeze({
    mode,
    buildingId,
    player: point(player.x, player.y),
    cameraFocus: point(cameraFocus.x, cameraFocus.y)
  });
}

function isFinitePoint(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y);
}

function entranceContains(entrance, position) {
  if (entrance.shape === 'rect') {
    return position.x >= entrance.x && position.x <= entrance.x + entrance.width
      && position.y >= entrance.y && position.y <= entrance.y + entrance.height;
  }
  return distanceBetween(position, entrance.point) <= entrance.radius;
}

function entranceDistance(entrance, position) {
  if (entrance.shape === 'circle') return distanceBetween(position, entrance.point);
  const nearestX = Math.max(entrance.x, Math.min(position.x, entrance.x + entrance.width));
  const nearestY = Math.max(entrance.y, Math.min(position.y, entrance.y + entrance.height));
  return Math.hypot(position.x - nearestX, position.y - nearestY);
}

function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function actorSamplePoints(position) {
  const samples = [point(position.x, position.y)];
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    samples.push(point(
      position.x + Math.cos(angle) * ACTOR_CONTRACT.radiusX,
      position.y + Math.sin(angle) * ACTOR_CONTRACT.radiusY
    ));
  }
  return samples;
}
