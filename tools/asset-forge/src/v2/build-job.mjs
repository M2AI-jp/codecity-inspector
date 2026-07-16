import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FORGE_ROOT, pathsFor } from '../config.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { validateWith } from '../schemas.mjs';
import { resolveWaveAAssetReferences } from './reference-authorization.mjs';
import {
  enumerateWaveAGenerationUnits,
  GENERATION_MODES_V2,
  UNIT_EXPECTATIONS_V2
} from './generation-units.mjs';
import { terrainCompositionPlanFor } from './compose-terrain-atlas.mjs';

export const FABLE5_REQUIRED_SET_ID = 'fable5-v2';
export const FABLE5_WAVE_A_ID = 'A';
export const CURRENT_BACKGROUND_REMOVAL_METHOD = 'auto-border-soft-matte-v3';
export const WAVE_A_SOURCE_LIMITS = Object.freeze({
  maxSourcePixels: 4_194_304,
  maxUniqueSourcePixels: 67_108_864,
  maxUniqueSourceBytes: 209_715_200
});

const HISTORICAL_BACKGROUND_REMOVAL_METHODS = new Set([
  null,
  'auto-border-soft-matte-v1',
  'auto-border-soft-matte-v2',
  CURRENT_BACKGROUND_REMOVAL_METHOD
]);

function extensionFor(reference) {
  const extension = path.extname(reference.absolutePath).slice(1).toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    throw new Error(`Wave A reference has an unsupported extension: ${reference.id}`);
  }
  return extension;
}

function artifactContractsFor(asset) {
  if (asset.category === 'building') {
    const layers = asset.buildingLayerContract?.artifacts ?? [];
    if (layers.length !== 2 || layers[0]?.role !== 'base' || layers[1]?.role !== 'roof') {
      throw new Error(`Wave A building does not declare an ordered base/roof pair: ${asset.id}`);
    }
    return layers.map((artifact) => ({
      role: artifact.role,
      fileSuffix: `.${artifact.role}.png`,
      outputSize: structuredClone(artifact.outputSize),
      anchor: structuredClone(artifact.anchor)
    }));
  }
  return [{
    role: 'primary',
    fileSuffix: '.png',
    outputSize: structuredClone(asset.outputSize),
    anchor: structuredClone(asset.pivot)
  }];
}

function boundReferences(referenceImages) {
  return referenceImages.map(({ id, sha256: digest, role }) => ({ id, sha256: digest, role }));
}

function identityMasterPrompt(asset, definitionSha256, promptSha256, referenceImages) {
  return [
    '# Canonical auxiliary character identity master',
    '',
    `Asset ID: ${asset.id}`,
    `Canonical AssetDefinition SHA-256: ${definitionSha256}`,
    `Canonical full-asset prompt SHA-256: ${promptSha256}`,
    'Canonical import target: one exact 192x96 transparent PNG containing four 48x96 neutral identity views.',
    'Generate at the provider native size on exact flat #FF00FF with a centered 2:1 crop-safe composition;',
    'the importer performs the declared crop, exact chroma removal, nearest downscale, and hard alpha.',
    'Cell order is front, back, left, right. This is an auxiliary consistency input, not a semantic',
    'runtime cell, not an approved game asset, and not evidence that any of the 40 runtime cells exists.',
    'Keep outfit, anatomical left/right details, height, hands, role tool, material palette, and baseline',
    'identical across all four views. No labels, scene, soft shadow, or content outside the 2:1 crop.',
    '',
    'Authorized reference bindings:',
    canonicalJson(boundReferences(referenceImages)).trimEnd(),
    '',
    'Authoritative character definition:',
    canonicalJson(asset).trimEnd(),
    ''
  ].join('\n');
}

function buildIdentityMasterPlan(asset, binding, referenceImages) {
  if (asset.category !== 'character') return null;
  const promptText = identityMasterPrompt(
    asset,
    binding.definitionSha256,
    binding.promptSha256,
    referenceImages
  );
  const promptSha256 = sha256(promptText);
  return {
    planId: `identity_${promptSha256.slice(0, 20)}`,
    kind: 'identity-master',
    auxiliary: true,
    semanticCell: false,
    approvedAsset: false,
    outputSize: { width: 192, height: 96 },
    cellSize: { width: 48, height: 96 },
    directions: ['front', 'back', 'left', 'right'],
    promptText,
    promptSha256,
    inputReferences: boundReferences(referenceImages)
  };
}

function exactUnitPrompt(asset, unit, {
  definitionSha256,
  promptSha256,
  referenceImages,
  generationMode,
  identityMasterPlan,
  terrainCompositionPlan
}) {
  const generationInstruction = unit.sourceRequired
    ? (generationMode === 'terrain-composed-atlas'
        ? [
            'Do not generate this semantic cell as a standalone provider image. It is a deterministic-derived output of the terrain composer from an explicit ordered set of fully opaque provider-original material crops.',
            `Input contract: ${terrainCompositionPlan.baseInputs.minimum}..${terrainCompositionPlan.baseInputs.maximum} base crop(s) and ${terrainCompositionPlan.waterMotionInputs.minimum}..${terrainCompositionPlan.waterMotionInputs.maximum} water-motion crop(s). terrain.cliff is excluded until a directional face-input contract exists.`,
            `Composer: ${terrainCompositionPlan.composerVersion}; config SHA-256: ${terrainCompositionPlan.configSha256}; canonical mask-set SHA-256: ${terrainCompositionPlan.maskSetSha256}.`,
            'Generate only the provider-original material inputs declared by the composition request. The importer performs downscale-only nearest normalization, shared seam-band construction, canonical masking, hard alpha, hidden-RGB zeroing, and byte-replay.'
          ]
        : generationMode === 'monolithic-atlas' && asset.category === 'character'
        ? [
            `This is one formal cell contract inside a single identity-bound 10-column x 4-row monolithic character atlas. Do not invoke this unit prompt by itself; the identity binding issued after the identity master supplies the sole atlas-level generation instruction and the importer produces the exact ${unit.targetRect.width}x${unit.targetRect.height} cell.`,
            'Use exact flat #FF00FF as removable background inside this cell. No anti-aliasing, caption,',
            'comparison panel, alternate pose, scene, or baked checkerboard.'
          ]
        : [
            `Generate exactly one semantic unit, centered in a crop-safe ${unit.targetRect.width}:${unit.targetRect.height} aspect region of the provider-native raster; the importer produces the exact ${unit.targetRect.width}x${unit.targetRect.height} cell.`,
            'Use exact flat #FF00FF as removable background. No anti-aliasing. No crop, caption, grid,',
            'comparison panel, neighboring frame, alternate pose, scene, or baked checkerboard.'
          ])
    : [
        'Do not generate source pixels for this cell. Its only legal output is zero RGBA.',
        'No image generation call and no source file may be submitted for this transparent contract cell.'
      ];
  return [
    '# Canonical Fable5 Wave A generation unit',
    '',
    `Asset ID: ${asset.id}`,
    `Generation mode: ${generationMode}`,
    `Unit ID: ${unit.unitId}`,
    `Artifact role: ${unit.artifactRole}`,
    `Frame ID: ${unit.frameId}`,
    ...(unit.direction ? [`Direction: ${unit.direction}`] : []),
    `Semantic role: ${unit.semanticRole}`,
    `Expectation: ${unit.expectation}`,
    `Source required: ${unit.sourceRequired}`,
    `Target rect: ${unit.targetRect.x},${unit.targetRect.y},${unit.targetRect.width},${unit.targetRect.height}`,
    `Canonical AssetDefinition SHA-256: ${definitionSha256}`,
    `Canonical full-asset prompt SHA-256: ${promptSha256}`,
    ...(identityMasterPlan ? [
      `Required identity consistency plan: ${identityMasterPlan.planId}`,
      `Identity prompt SHA-256: ${identityMasterPlan.promptSha256}`
    ] : []),
    '',
    generationInstruction[0],
    `Exact visual content: ${unit.visualContent}`,
    ...generationInstruction.slice(1),
    '',
    'Authorized reference bindings:',
    canonicalJson(boundReferences(referenceImages)).trimEnd(),
    '',
    'The complete canonical AssetDefinition below remains authoritative for scale, palette, silhouette,',
    'projection, lighting, contacts, animation continuity, exclusions, and runtime meaning:',
    canonicalJson(asset).trimEnd(),
    ''
  ].join('\n');
}

function bindGenerationUnits(
  asset,
  binding,
  referenceImages,
  generationMode,
  identityMasterPlan,
  terrainCompositionPlan
) {
  const units = enumerateWaveAGenerationUnits(asset).map((unit) => {
    const unitPromptText = exactUnitPrompt(asset, unit, {
      definitionSha256: binding.definitionSha256,
      promptSha256: binding.promptSha256,
      referenceImages,
      generationMode,
      identityMasterPlan,
      terrainCompositionPlan
    });
    return {
      ...unit,
      generationMode,
      unitPromptText,
      unitPromptSha256: sha256(unitPromptText),
      inputReferences: boundReferences(referenceImages),
      ...(identityMasterPlan ? { consistencyPlanId: identityMasterPlan.planId } : {})
    };
  });
  return {
    units,
    unitSetSha256: sha256(canonicalJson(units)),
    expectations: Object.fromEntries(UNIT_EXPECTATIONS_V2.map((expectation) => [
      expectation,
      units.filter((unit) => unit.expectation === expectation).length
    ]))
  };
}

export function assetSpecificPrompt(asset, {
  generationMode = 'per-unit',
  terrainCompositionPlan = null
} = {}) {
  if (generationMode === 'terrain-composed-atlas') {
    if (!terrainCompositionPlan) {
      throw new Error('Terrain-composed prompt requires its deterministic composition plan');
    }
    return [
      '# Exact Fable5 Wave A terrain material-input instruction',
      '',
      `Required set: ${FABLE5_REQUIRED_SET_ID}`,
      `Wave: ${FABLE5_WAVE_A_ID}`,
      `Asset ID: ${asset.id}`,
      `Display name: ${asset.displayName}`,
      `Game meaning: ${asset.gameMeaning}`,
      `Final runtime artifact (do not generate directly): ${asset.outputSize.width}x${asset.outputSize.height} PNG`,
      'Provider deliverable: one material crop image for the requested input role, not a 5x5 atlas, contact sheet, transition mask, or transparent cutout.',
      'Accepted provider source formats: PNG, JPEG, or WebP. The selected crop must be square, at least 64x64 pixels, fully opaque at every source pixel, and contain no exact #FF00FF pixel.',
      'Do not add transparency, alpha padding, a magenta key, labels, borders, mockup framing, characters, props, or lighting gradients across the material.',
      `Input roles: base ${terrainCompositionPlan.baseInputs.minimum}..${terrainCompositionPlan.baseInputs.maximum}; water motion ${terrainCompositionPlan.waterMotionInputs.minimum}..${terrainCompositionPlan.waterMotionInputs.maximum}. terrain.cliff is excluded until a directional face-input contract exists.`,
      `Composer: ${terrainCompositionPlan.composerVersion}; config SHA-256: ${terrainCompositionPlan.configSha256}; mask-set SHA-256: ${terrainCompositionPlan.maskSetSha256}.`,
      `Scale class: ${asset.scaleClass}`,
      `Placement space: pixels=${asset.placementSpace.pixels}; tiles=${asset.placementSpace.tiles}`,
      '',
      'The earlier terrain-autotile brief and exact AssetDefinition below describe the final visual and gameplay contract. For this job mode they do not authorize provider generation of the final sheet. The importer alone performs nearest downscale, shared-seam construction, canonical masking, transparent-cell zeroing, hard alpha, atlas assembly, and byte replay.',
      '',
      '```json',
      canonicalJson(asset).trimEnd(),
      '```',
      ''
    ].join('\n');
  }
  return [
    '# Exact Fable5 Wave A asset instruction',
    '',
    `Required set: ${FABLE5_REQUIRED_SET_ID}`,
    `Wave: ${FABLE5_WAVE_A_ID}`,
    `Asset ID: ${asset.id}`,
    `Display name: ${asset.displayName}`,
    `Game meaning: ${asset.gameMeaning}`,
    `Native output: ${asset.outputSize.width}x${asset.outputSize.height} PNG`,
    `Scale class: ${asset.scaleClass}`,
    `Placement space: pixels=${asset.placementSpace.pixels}; tiles=${asset.placementSpace.tiles}`,
    `Pivot: (${asset.pivot.x}, ${asset.pivot.y}); baseline edge: ${asset.baseline.edgeY}`,
    'Generation background key: exact flat #FF00FF; import tolerance 0; hard-alpha threshold 127.',
    '',
    'The exact AssetDefinition below is authoritative. It includes the sheet/grid, placement, collision,',
    'occlusion, entrance, base/roof, technical inspection gates, constraints, review acceptance, and',
    'gameplay binding. Generate this asset only; do not turn it into a scene, label, contact sheet,',
    'mockup, or substitute asset.',
    '',
    '```json',
    canonicalJson(asset).trimEnd(),
    '```',
    ''
  ].join('\n');
}

async function renderPrompt(asset, forgeRoot, promptOptions = {}) {
  const promptRoot = pathsFor(forgeRoot).prompts;
  const parts = [];
  for (const relativePath of asset.promptFiles) {
    if (!relativePath.startsWith('prompts/v2/')) {
      throw new Error(`Wave A prompt path is outside prompts/v2: ${relativePath}`);
    }
    const absolutePath = await assertExistingFileWithin(
      promptRoot,
      relativePath.slice('prompts/'.length)
    );
    parts.push(`<!-- source: ${relativePath} -->\n${await readFile(absolutePath, 'utf8')}`.trimEnd());
  }
  parts.push(assetSpecificPrompt(asset, promptOptions).trimEnd());
  return `${parts.join('\n\n')}\n`;
}

export function definitionBindingSnapshot(asset, promptSha256) {
  // A definition digest has one meaning throughout v2 authoring and v3 export:
  // the canonical AssetDefinition bytes, and nothing else.  Prompt provenance
  // is deliberately bound by its own digest so changing prose cannot masquerade
  // as changing the runtime/placement contract.
  const definitionSha256 = sha256(canonicalJson(asset));
  return {
    snapshot: structuredClone(asset),
    assetDefinitionSha256: definitionSha256,
    definitionSha256,
    promptSha256
  };
}

export function definitionBindingSha256(asset, promptSha256) {
  return definitionBindingSnapshot(asset, promptSha256).definitionSha256;
}

export async function buildWaveAJob({ assetId, seed = '', generationMode = 'per-unit' }, {
  forgeRoot = FORGE_ROOT,
  backgroundRemovalMethod = CURRENT_BACKGROUND_REMOVAL_METHOD
} = {}) {
  if (!HISTORICAL_BACKGROUND_REMOVAL_METHODS.has(backgroundRemovalMethod)) {
    throw new Error(`Unsupported Wave A background-removal method: ${backgroundRemovalMethod}`);
  }
  if (!GENERATION_MODES_V2.includes(generationMode)) {
    throw new Error(`Unsupported Wave A generation mode: ${generationMode}`);
  }
  const { asset, references, warnings, authorization: effectiveAuthorization } =
    await resolveWaveAAssetReferences(assetId, { root: forgeRoot });
  if (asset.visualContractVersion !== 2 || !asset.tags?.includes('wave-a')) {
    throw new Error(`Asset is not an explicit Fable5 Wave A v2 definition: ${assetId}`);
  }
  if (asset.defaultReferenceIds.includes('cutaway_interior_visual_reference')) {
    throw new Error(`Pending cutaway reference is forbidden in Wave A: ${assetId}`);
  }
  if (generationMode === 'terrain-composed-atlas' && asset.category !== 'terrain') {
    throw new Error('terrain-composed-atlas mode is available only for Wave A terrain assets');
  }
  const terrainCompositionPlan = generationMode === 'terrain-composed-atlas'
    ? terrainCompositionPlanFor(asset)
    : null;
  const promptText = await renderPrompt(asset, forgeRoot, {
    generationMode,
    terrainCompositionPlan
  });
  const promptSha256 = sha256(promptText);
  const binding = definitionBindingSnapshot(asset, promptSha256);
  const referenceAuthorizationSha256 = sha256(canonicalJson(effectiveAuthorization));
  const independentReviewPath = await assertExistingFileWithin(
    forgeRoot,
    effectiveAuthorization.independentReview.reviewPath
  );
  const independentReviewBytes = await readFile(independentReviewPath);
  if (sha256(independentReviewBytes) !== effectiveAuthorization.independentReview.reviewSha256) {
    throw new Error('Wave A independent reference review changed after authorization');
  }
  const independentReviewSha256 = sha256(independentReviewBytes);
  const referenceImages = references.map((reference, index) => ({
    id: reference.id,
    sha256: reference.sha256,
    role: index === 0 ? 'global-style' : 'primary-subject',
    extension: extensionFor(reference)
  }));
  if (referenceImages.length !== 2
    || referenceImages[0].id !== 'world_visual_master'
    || referenceImages[0].role !== 'global-style'
    || referenceImages[1].role !== 'primary-subject') {
    throw new Error(`Wave A requires exactly one global-style and one primary-subject input: ${assetId}`);
  }
  const artifactContracts = artifactContractsFor(asset);
  const identityMasterPlan = buildIdentityMasterPlan(asset, binding, referenceImages);
  const generation = bindGenerationUnits(
    asset,
    binding,
    referenceImages,
    generationMode,
    identityMasterPlan,
    terrainCompositionPlan
  );
  const stableProvenance = {
    requiredSetId: FABLE5_REQUIRED_SET_ID,
    waveId: FABLE5_WAVE_A_ID,
    visualContractVersion: 2,
    assetId,
    category: asset.category,
    seed: String(seed),
    assetDefinitionSha256: binding.assetDefinitionSha256,
    definitionSha256: binding.definitionSha256,
    promptSha256,
    referenceAuthorizationSha256,
    independentReviewSha256,
    referenceImages,
    artifactContracts,
    generationMode,
    ...(terrainCompositionPlan ? { terrainCompositionPlan } : {}),
    generationUnitSetSha256: generation.unitSetSha256,
    generationExpectations: generation.expectations,
    identityMasterPlanSha256: identityMasterPlan
      ? sha256(canonicalJson(identityMasterPlan))
      : null,
    technicalGates: {
      inspectionGates: asset.inspectionGates,
      inputPolicy: terrainCompositionPlan ? {
        format: 'png-jpeg-webp',
        nativeOutputSize: false,
        resizeKernel: 'nearest',
        allowEnlargement: false,
        allowImportMutation: false,
        expectedGenerator: 'codex-imagegen-built-in',
        chromaKeyColor: null,
        chromaKeyTolerance: null,
        sourceLimits: structuredClone(WAVE_A_SOURCE_LIMITS),
        hardAlphaThreshold: null,
        hiddenRgbPolicy: 'not-applicable-fully-opaque-input',
        transparentUnitPolicy: 'zero-rgba',
        assemblyKernel: terrainCompositionPlan.algorithm,
        terrainMaterialInputs: {
          acceptedFormats: ['png', 'jpeg', 'webp'],
          cropShape: 'square',
          minimumCropSize: terrainCompositionPlan.tileSize,
          sourceAlpha: 'fully-opaque',
          forbiddenOpaqueRgb: '#FF00FF',
          outputOrigin: 'deterministic-derived',
          providerInvocationEvidence: 'unverified-no-provider-receipt'
        }
      } : {
        format: 'png',
        nativeOutputSize: true,
        resizeKernel: 'nearest',
        allowEnlargement: false,
        allowImportMutation: false,
        expectedGenerator: 'codex-imagegen-built-in',
        chromaKeyColor: '#FF00FF',
        chromaKeyTolerance: 0,
        ...(backgroundRemovalMethod ? {
          canonicalBackgroundRemoval: {
          method: backgroundRemovalMethod,
          expectedKeyColor: '#FF00FF',
          colorDistance: 'chebyshev-rgb',
          borderMode: 'source-border',
          borderBandMax: 6,
          borderSampleStrideDivisor: 256,
          rounding: 'nearest-ties-to-even',
          expectedKeyMaxDistance: 16,
          borderInlierDistance: 12,
          minimumBorderInlierPermille: 750,
          keyLikeDistance: 32,
          transparentDistance: 12,
          opaqueDistance: 220,
          keyDominanceThreshold: 16,
          spillChannelDelta: 16,
          spillChannelMinimum: 128,
          alphaNoiseFloor: 8,
          despill: true,
          despillOpaqueFloor: 252,
          despillAnchorOffset: 1,
          hiddenRgbPolicy: 'zero',
          resizeKernel: 'nearest',
          hardAlphaThreshold: 127
          },
          ...(backgroundRemovalMethod === CURRENT_BACKGROUND_REMOVAL_METHOD ? {
            sourceLimits: structuredClone(WAVE_A_SOURCE_LIMITS)
          } : {})
        } : {}),
        hardAlphaThreshold: 127,
        hiddenRgbPolicy: 'zero',
        transparentUnitPolicy: 'zero-rgba',
        assemblyKernel: 'raw-copy'
      }
    }
  };
  const provenanceKey = sha256(canonicalJson(stableProvenance));
  const job = {
    schemaVersion: 2,
    requiredSetId: FABLE5_REQUIRED_SET_ID,
    waveId: FABLE5_WAVE_A_ID,
    visualContractVersion: 2,
    id: `job_v2_${provenanceKey.slice(0, 20)}`,
    assetId,
    category: asset.category,
    provider: 'job-pack',
    seed: String(seed),
    assetDefinition: structuredClone(asset),
    assetDefinitionSha256: binding.assetDefinitionSha256,
    definitionSha256: binding.definitionSha256,
    promptText,
    promptSha256,
    promptFiles: [...asset.promptFiles],
    referenceAuthorizationSha256,
    independentReviewSha256,
    referenceImages,
    artifactContracts,
    generationMode,
    ...(terrainCompositionPlan ? { terrainCompositionPlan } : {}),
    generationUnits: generation.units,
    generationUnitSetSha256: generation.unitSetSha256,
    generationExpectations: generation.expectations,
    identityMasterPlan,
    technicalGates: stableProvenance.technicalGates,
    provenanceKey,
    createdBy: 'codex'
  };
  const validation = validateWith('generation-job-v2.schema.json', job);
  if (!validation.ok) {
    throw new Error(`Invalid Fable5 Wave A generation job: ${JSON.stringify(validation.errors)}`);
  }
  return {
    asset,
    job,
    references,
    definitionSnapshot: binding.snapshot,
    authorization: effectiveAuthorization,
    independentReviewBytes,
    warnings
  };
}
