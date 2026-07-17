import { deepFreeze } from './schema.mjs';

export const PREFAB_IDS = deepFreeze([
  'prefab.service.inn.enterable',
  'prefab.module.closed-unreached'
]);

export const PREFAB_CATALOG = deepFreeze({
  'prefab.service.inn.enterable': {
    id: 'prefab.service.inn.enterable',
    assetId: 'building.inn',
    buildingClass: 'L',
    facilityKind: 'inn',
    interactionVerb: 'talk-innkeeper',
    speakerRole: 'keeper.inn',
    animationSetId: 'animation.building.cutaway.fade',
    behaviorId: 'behavior.building.enterable-service',
    visual: {
      state: 'open',
      overlayAssetIds: []
    },
    collision: {
      exterior: 'solid-footprint',
      entrance: 'door',
      interior: 'walkable'
    },
    access: 'enterable',
    cutaway: {
      animationDurationMs: 460,
      easing: 'ease-in-out-cubic'
    },
    labelMode: 'proximity',
    soundSetId: 'sound.building.inn.entry',
    eventIds: [
      'event.facility.approach',
      'event.facility.enter',
      'event.facility.talk-keeper',
      'event.facility.exit'
    ]
  },
  'prefab.module.closed-unreached': {
    id: 'prefab.module.closed-unreached',
    assetId: 'building.house_old',
    buildingClass: 'M',
    facilityKind: null,
    interactionVerb: 'inspect-closure-sign',
    speakerRole: null,
    animationSetId: 'animation.building.closed.idle',
    behaviorId: 'behavior.building.closed-evidence-sign',
    visual: {
      state: 'closed-unverified',
      overlayAssetIds: ['overlay.ivy.m']
    },
    collision: {
      exterior: 'solid-footprint',
      entrance: 'blocked',
      interior: 'none'
    },
    access: 'closed',
    cutaway: {
      animationDurationMs: 0,
      easing: 'linear'
    },
    labelMode: 'proximity',
    soundSetId: 'sound.building.closed-sign',
    eventIds: [
      'event.facility.approach',
      'event.facility.inspect-closure-sign'
    ]
  }
});

export function getPrefab(prefabId) {
  return PREFAB_CATALOG[prefabId] ?? null;
}
