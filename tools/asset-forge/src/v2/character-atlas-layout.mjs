import { canonicalJson, sha256 } from '../hashing.mjs';

export const CHARACTER_ATLAS_LAYOUT_VERSION = 'character-atlas-layout-v1';
export const CHARACTER_ATLAS_LAYOUT_ALGORITHM =
  'character-atlas-layout/exact-5x4-portrait-grid-v1';

const CONFIG = Object.freeze({
  schemaVersion: 1,
  originKind: 'provider-generation-guidance',
  version: CHARACTER_ATLAS_LAYOUT_VERSION,
  algorithm: CHARACTER_ATLAS_LAYOUT_ALGORITHM,
  overallContentGridAspectRatio: '5:4',
  columns: 10,
  rows: 4,
  cellAspectRatio: '1:2',
  uniformContiguousGrid: true,
  gapsAllowed: false,
  maximumSubjectWidthPermille: 800,
  maximumSubjectHeightPermille: 880,
  fullOuterKeyMarginRequired: true,
  directionRows: Object.freeze(['front', 'back', 'left', 'right']),
  frontBackDirectionPolicy: 'axis-locked-all-frames-including-walk-no-profile-or-three-quarter',
  leftRightDirectionPolicy: 'fixed-row-direction',
  providerInvocationEvidence: 'unverified-no-provider-receipt'
});

export const CHARACTER_ATLAS_LAYOUT_CONFIG_SHA256 = sha256(canonicalJson(CONFIG));

export function characterAtlasLayoutPlanFor(asset, generationMode) {
  if (asset.category !== 'character' || generationMode !== 'monolithic-atlas') {
    throw new Error(
      `${CHARACTER_ATLAS_LAYOUT_VERSION} is available only for Wave A character monolithic-atlas jobs`
    );
  }
  return {
    ...structuredClone(CONFIG),
    configSha256: CHARACTER_ATLAS_LAYOUT_CONFIG_SHA256
  };
}
