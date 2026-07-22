import { canonicalJson, sha256 } from '../hashing.mjs';

export const CHARACTER_DIRECTION_STRIP_MODE = 'character-direction-strips';
export const CHARACTER_DIRECTION_STRIP_VERSION = 'character-direction-strip-layout-v1';
export const CHARACTER_DIRECTION_STRIP_ALGORITHM =
  'character-direction-strip/exact-10x1-portrait-row-v1';
export const CHARACTER_DIRECTION_STRIP_DIRECTIONS = Object.freeze([
  'front', 'back', 'left', 'right'
]);
export const CHARACTER_DIRECTION_STRIP_COLUMNS = 10;

const CONFIG = Object.freeze({
  schemaVersion: 1,
  originKind: 'provider-generation-guidance',
  version: CHARACTER_DIRECTION_STRIP_VERSION,
  algorithm: CHARACTER_DIRECTION_STRIP_ALGORITHM,
  stripCount: 4,
  contentAspectRatio: '5:1',
  columnsPerStrip: CHARACTER_DIRECTION_STRIP_COLUMNS,
  rowsPerStrip: 1,
  cellAspectRatio: '1:2',
  uniformContiguousCells: true,
  gapsAllowed: false,
  maximumSubjectWidthPermille: 800,
  maximumSubjectHeightPermille: 880,
  fullOuterKeyMarginRequired: true,
  directionOrder: CHARACTER_DIRECTION_STRIP_DIRECTIONS,
  directionPolicy: 'axis-locked-all-frames-including-work-no-profile-or-three-quarter',
  providerInvocationEvidence: 'unverified-no-provider-receipt'
});

export const CHARACTER_DIRECTION_STRIP_CONFIG_SHA256 = sha256(canonicalJson(CONFIG));

export function characterDirectionStripPlanFor(asset, generationMode) {
  if (asset.category !== 'character' || generationMode !== CHARACTER_DIRECTION_STRIP_MODE) {
    throw new Error(
      `${CHARACTER_DIRECTION_STRIP_VERSION} is available only for Wave A character direction-strip jobs`
    );
  }
  return {
    ...structuredClone(CONFIG),
    configSha256: CHARACTER_DIRECTION_STRIP_CONFIG_SHA256
  };
}
