import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { FORGE_ROOT, pathsFor } from './config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from './fs-safe.mjs';
import { canonicalJson, hashApprovedTree, sha256 } from './hashing.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import { assertExistingFileWithin, toPosixRelative } from './paths.mjs';
import { validateWith } from './schemas.mjs';

export const FABLE5_PREFAB_INTERIOR_JOB_VERSION = 'fable5-prefab-interior-job-v1';

const LEDGER_PATH = 'art/contracts/user-provided-images.json';
const COMMON_PROMPT_PATH = 'prompts/fable5-prefab/00_common_fable5_interior_kit_style.md';

// This is deliberately a closed set. It turns the currently implemented
// building-runtime geometry into a pre-generation receipt without treating a
// runtime module, a legacy cutaway, or a flattened exterior prefab as art that
// can be installed automatically.
const DRAFTS = Object.freeze({
  'bld_m_inn.interior': Object.freeze({
    contractPath: 'contracts/fable5-prefab/interior.inn.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/interior.inn.prompt-draft.md',
    buildingReferenceId: 'user_building_inn',
    buildingReferenceRole: 'inn-exterior-material-language'
  }),
  'bld_l_town_hall.interior': Object.freeze({
    contractPath: 'contracts/fable5-prefab/interior.city-hall.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/interior.city-hall.prompt-draft.md',
    buildingReferenceId: 'user_building_town_hall',
    buildingReferenceRole: 'city-hall-exterior-material-language'
  }),
  'bld_m_house.interior': Object.freeze({
    contractPath: 'contracts/fable5-prefab/interior.residence.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/interior.residence.prompt-draft.md',
    buildingReferenceId: 'user_building_houses_shops_ruins',
    buildingReferenceRole: 'residence-exterior-material-language'
  })
});

const INTERIOR_SPECS = Object.freeze({
  'bld_m_inn.interior': Object.freeze({
    buildingId: 'inn', width: 192, height: 192, footprint: Object.freeze({ w: 3, h: 3 }),
    worldRect: Object.freeze({ x: 116, y: 258, width: 192, height: 192 }),
    worldPivot: Object.freeze({ x: 116, y: 450, anchor: 'southwest' }),
    coordinateEvidence: Object.freeze({ exterior: 'observed', interior: 'observed', authority: 'public/fable5-v2/building-runtime.mjs via INN_CONTRACT' }),
    walkPolygon: Object.freeze([[164, 382], [260, 382], [260, 420], [236, 420], [236, 450], [188, 450], [188, 420], [164, 420]].map(Object.freeze)),
    runtimeAnchors: Object.freeze({
      entryFoot: Object.freeze({ x: 212, y: 438 }), exitFoot: Object.freeze({ x: 212, y: 446 }),
      cameraFocus: Object.freeze({ x: 212, y: 300 }),
      interaction: Object.freeze({ id: 'talk-innkeeper', point: Object.freeze({ x: 224, y: 344 }), radius: 58 })
    }),
    semanticSource: Object.freeze({
      minimumOpaqueCoverage: 0.75,
      requiredOpaqueRects: Object.freeze([
        Object.freeze({ id: 'entry-floor', x: 92, y: 176, width: 8, height: 8 }),
        Object.freeze({ id: 'exit-threshold', x: 92, y: 184, width: 8, height: 8 }),
        Object.freeze({ id: 'innkeeper-floor', x: 104, y: 82, width: 8, height: 8 })
      ])
    }),
    visibleKit: Object.freeze({
      required: Object.freeze(['walkable floor', 'north-wall trim', 'fixed service counter', 'hearth-or-shelf detail', 'door threshold continuity']),
      forbidden: Object.freeze(['character', 'text', 'dialogue UI', 'baked lighting halo', 'black-hole doorway'])
    })
  }),
  'bld_l_town_hall.interior': Object.freeze({
    buildingId: 'city-hall', width: 256, height: 256, footprint: Object.freeze({ w: 4, h: 4 }),
    worldRect: Object.freeze({ x: 512, y: 136, width: 256, height: 256 }),
    worldPivot: Object.freeze({ x: 512, y: 392, anchor: 'southwest' }),
    coordinateEvidence: Object.freeze({ exterior: 'observed', interior: 'inferred', authority: 'public/fable5-v2/building-runtime.mjs' }),
    walkPolygon: Object.freeze([[552, 170], [728, 170], [728, 352], [684, 352], [684, 392], [596, 392], [596, 352], [552, 352]].map(Object.freeze)),
    runtimeAnchors: Object.freeze({
      entryFoot: Object.freeze({ x: 640, y: 380 }), exitFoot: Object.freeze({ x: 640, y: 370 }),
      cameraFocus: Object.freeze({ x: 640, y: 260 }),
      interaction: Object.freeze({ id: 'talk-town-clerk', point: Object.freeze({ x: 640, y: 242 }), radius: 58 })
    }),
    semanticSource: Object.freeze({
      minimumOpaqueCoverage: 0.75,
      requiredOpaqueRects: Object.freeze([
        Object.freeze({ id: 'entry-floor', x: 124, y: 240, width: 8, height: 8 }),
        Object.freeze({ id: 'exit-threshold', x: 124, y: 230, width: 8, height: 8 }),
        Object.freeze({ id: 'clerk-floor', x: 124, y: 102, width: 8, height: 8 })
      ])
    }),
    visibleKit: Object.freeze({
      required: Object.freeze(['walkable civic floor', 'north-wall trim', 'fixed records desk', 'shelving-or-ledger detail', 'door threshold continuity']),
      forbidden: Object.freeze(['character', 'text', 'dialogue UI', 'baked lighting halo', 'black-hole doorway'])
    })
  }),
  'bld_m_house.interior': Object.freeze({
    buildingId: 'residence', width: 256, height: 256, footprint: Object.freeze({ w: 4, h: 4 }),
    worldRect: Object.freeze({ x: 869, y: 132, width: 256, height: 256 }),
    worldPivot: Object.freeze({ x: 869, y: 388, anchor: 'southwest' }),
    coordinateEvidence: Object.freeze({ exterior: 'observed', interior: 'inferred', authority: 'public/fable5-v2/building-runtime.mjs' }),
    walkPolygon: Object.freeze([[918, 178], [1076, 178], [1076, 348], [1038, 348], [1038, 388], [956, 388], [956, 348], [918, 348]].map(Object.freeze)),
    runtimeAnchors: Object.freeze({
      entryFoot: Object.freeze({ x: 997, y: 376 }), exitFoot: Object.freeze({ x: 997, y: 366 }),
      cameraFocus: Object.freeze({ x: 997, y: 264 }),
      interaction: Object.freeze({ id: 'talk-resident', point: Object.freeze({ x: 997, y: 246 }), radius: 54 })
    }),
    semanticSource: Object.freeze({
      minimumOpaqueCoverage: 0.75,
      requiredOpaqueRects: Object.freeze([
        Object.freeze({ id: 'entry-floor', x: 124, y: 240, width: 8, height: 8 }),
        Object.freeze({ id: 'exit-threshold', x: 124, y: 230, width: 8, height: 8 }),
        Object.freeze({ id: 'resident-floor', x: 124, y: 110, width: 8, height: 8 })
      ])
    }),
    visibleKit: Object.freeze({
      required: Object.freeze(['walkable floor', 'north-wall trim', 'fixed table-or-hearth', 'storage-or-bed detail', 'door threshold continuity']),
      forbidden: Object.freeze(['character', 'text', 'dialogue UI', 'baked lighting halo', 'black-hole doorway'])
    })
  })
});

function projectRootFor(forgeRoot, projectRoot) {
  return path.resolve(projectRoot ?? path.join(forgeRoot, '..', '..'));
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function draftFor(assetId) {
  const draft = DRAFTS[assetId];
  if (!draft) {
    throw new Error('Fable5 interior jobs accept only bld_m_inn.interior, bld_l_town_hall.interior, or bld_m_house.interior');
  }
  return draft;
}

function specFor(assetId) {
  return INTERIOR_SPECS[assetId] ?? null;
}

function expectedFile(assetId) {
  return `interior/${assetId}.png`;
}

function outputContractFor(assetId) {
  const spec = specFor(assetId);
  return Object.freeze({
    kind: 'interior-kit',
    format: 'png',
    alphaChannelRequired: true,
    background: 'opaque-ground-layer-with-alpha-channel',
    width: spec.width,
    height: spec.height,
    nativeScale: 1,
    logicalTileSize: 64,
    pivot: Object.freeze({ x: 0, y: spec.height }),
    footprint: Object.freeze({ ...spec.footprint }),
    composition: Object.freeze({
      buildingId: spec.buildingId,
      layer: 'ground',
      worldRect: Object.freeze({ ...spec.worldRect }),
      worldPivot: Object.freeze({ ...spec.worldPivot }),
      coordinateEvidence: Object.freeze({ ...spec.coordinateEvidence }),
      walkPolygon: Object.freeze(spec.walkPolygon.map((point) => Object.freeze([...point]))),
      runtimeAnchors: Object.freeze({
        entryFoot: Object.freeze({ ...spec.runtimeAnchors.entryFoot }),
        exitFoot: Object.freeze({ ...spec.runtimeAnchors.exitFoot }),
        cameraFocus: Object.freeze({ ...spec.runtimeAnchors.cameraFocus }),
        interaction: Object.freeze({
          ...spec.runtimeAnchors.interaction,
          point: Object.freeze({ ...spec.runtimeAnchors.interaction.point })
        })
      }),
      semanticSource: Object.freeze({
        minimumOpaqueCoverage: spec.semanticSource.minimumOpaqueCoverage,
        requiredOpaqueRects: Object.freeze(spec.semanticSource.requiredOpaqueRects.map((rect) => Object.freeze({ ...rect })))
      }),
      visibleKit: Object.freeze({
        required: Object.freeze([...spec.visibleKit.required]),
        forbidden: Object.freeze([...spec.visibleKit.forbidden])
      })
    }),
    allowedZoom: Object.freeze([1, 2, 3])
  });
}

export function fable5InteriorContractProblems(contract, assetId) {
  const spec = specFor(assetId);
  const problems = [];
  if (!spec) return ['unknown Fable5 interior asset'];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return ['contract must be an object'];
  if (contract.status !== 'draft-pending-generation') problems.push('contract must remain draft-pending-generation');
  if (contract.assetId !== assetId) problems.push(`contract assetId must be ${assetId}`);
  if (contract.category !== 'interior') problems.push('contract category must be interior');
  if (!sameJson(contract.png, { file: expectedFile(assetId), w: spec.width, h: spec.height })) {
    problems.push(`contract PNG must be ${expectedFile(assetId)} at ${spec.width}x${spec.height}`);
  }
  if (contract.nativeScale !== 1 || contract.logicalTileSize !== 64) problems.push('interior nativeScale must be 1 and logicalTileSize must be 64');
  if (!sameJson(contract.pivot, { x: 0, y: spec.height })) problems.push(`interior pivot must be (0,${spec.height})`);
  if (!sameJson(contract.footprint, spec.footprint)) problems.push('interior footprint does not match the current building-runtime rectangle');
  if (!Array.isArray(contract.collision) || contract.collision.length !== 0) problems.push('interior collision must remain external to the painted kit');
  if (contract.layers?.base !== expectedFile(assetId) || Object.keys(contract.layers ?? {}).length !== 1) {
    problems.push('interior kit must expose exactly its base ground-layer PNG');
  }
  if (!sameJson(contract.allowedZoom, [1, 2, 3])) problems.push('allowedZoom must be [1,2,3]');
  const composition = contract.composition;
  if (!composition || typeof composition !== 'object' || Array.isArray(composition)) return [...problems, 'interior composition is required'];
  for (const field of ['buildingId', 'layer', 'worldRect', 'worldPivot', 'coordinateEvidence', 'walkPolygon', 'runtimeAnchors', 'semanticSource']) {
    if (!Object.hasOwn(composition, field)) problems.push(`interior composition is missing ${field}`);
  }
  if (composition.buildingId !== spec.buildingId || composition.layer !== 'ground') problems.push('interior building/layer binding is invalid');
  if (!sameJson(composition.worldRect, spec.worldRect) || !sameJson(composition.worldPivot, spec.worldPivot)) {
    problems.push('interior world rectangle or southwest pivot does not match building-runtime');
  }
  if (!sameJson(composition.coordinateEvidence, spec.coordinateEvidence)) problems.push('interior coordinate evidence must preserve observed/inferred status');
  if (!sameJson(composition.walkPolygon, spec.walkPolygon)) problems.push('interior walk polygon does not match building-runtime');
  if (!sameJson(composition.runtimeAnchors, spec.runtimeAnchors)) problems.push('interior entry/exit/camera/interaction anchors do not match building-runtime');
  if (!sameJson(composition.semanticSource, spec.semanticSource)) problems.push('interior semantic source bounds do not match the intake contract');
  if (!sameJson(composition.visibleKit, spec.visibleKit)) problems.push('interior visible-kit requirements do not match the approved pre-generation contract');
  return problems;
}

async function readDraftContract(assetId, forgeRoot) {
  const draft = draftFor(assetId);
  const contractPath = await assertExistingFileWithin(forgeRoot, draft.contractPath);
  let contract;
  try {
    contract = JSON.parse(await readFile(contractPath, 'utf8'));
  } catch (error) {
    throw new Error(`Fable5 interior contract is not valid JSON: ${draft.contractPath}`, { cause: error });
  }
  const problems = fable5InteriorContractProblems(contract, assetId);
  if (problems.length) throw new Error(`Fable5 interior contract rejected: ${problems.join('; ')}`);
  return { draft, contract, contractPath };
}

function hasGenerationReferenceApproval(source) {
  return source?.custody?.kind === 'user-direct'
    && source?.approval?.status === 'approved'
    && Array.isArray(source?.approval?.scope)
    && (source.approval.scope.includes('generation-reference')
      || source.approval.scope.includes('missing-frame-generation-reference'))
    && source?.runtimeUse?.generationReference === true;
}

async function verifiedLedgerReference(projectRoot, sourceId, role) {
  const ledgerPath = await assertExistingFileWithin(projectRoot, LEDGER_PATH);
  let ledger;
  try {
    ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  } catch (error) {
    throw new Error('User-provided image ledger is not valid JSON', { cause: error });
  }
  const source = ledger?.sources?.find((candidate) => candidate?.sourceId === sourceId);
  if (!source) throw new Error(`Required user-provided reference is absent from the ledger: ${sourceId}`);
  if (!hasGenerationReferenceApproval(source)) throw new Error(`Reference is not approved for generation use: ${sourceId}`);
  if (typeof source.canonicalPath !== 'string' || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error(`Reference ledger record is incomplete: ${sourceId}`);
  }
  const sourcePath = await assertExistingFileWithin(projectRoot, source.canonicalPath);
  const image = await readExternalImage(sourcePath);
  if (sha256(image.buffer) !== source.sha256) throw new Error(`Reference hash mismatch: ${sourceId}`);
  if (!sameJson(source.dimensions, { width: image.metadata.width, height: image.metadata.height })) {
    throw new Error(`Reference dimensions mismatch: ${sourceId}`);
  }
  return Object.freeze({
    sourceId,
    role,
    ledger: LEDGER_PATH,
    dimensions: Object.freeze({ ...source.dimensions }),
    bindingSha256: sha256(canonicalJson({ sourceId, sourceSha256: source.sha256, dimensions: source.dimensions, role })),
    verifiedAtAssembly: true,
    copiedIntoForge: false
  });
}

async function readPrompt(forgeRoot, promptPath) {
  return readFile(await assertExistingFileWithin(forgeRoot, promptPath), 'utf8');
}

function jobPackPaths(forgeRoot, jobId) {
  const directory = path.join(pathsFor(forgeRoot).jobs, jobId);
  return Object.freeze({
    directory,
    job: path.join(directory, 'job.json'),
    prompt: path.join(directory, 'prompt.md'),
    outputContract: path.join(directory, 'output-contract.json'),
    references: path.join(directory, 'references.json'),
    importGuide: path.join(directory, 'intake-guide.md'),
    manifest: path.join(directory, 'job-pack.json')
  });
}

function importGuide(assetId) {
  return [
    '# Fable5 interior-kit candidate intake',
    '',
    `This pack commissions a pending ${assetId} interior kit; it contains no generated pixels.`,
    '',
    '1. A human resolves the two reference IDs in `references.json` through the canonical project ledger.',
    '2. A human authorizes and supervises an external generation session using `prompt.md` and `output-contract.json`.',
    '3. Run the Fable5 interior intake only after receiving an exact RGBA PNG. It copies bytes only to pending; it never transforms, approves, exports, or installs them.',
    '4. A product owner must visually approve the cutaway, route, NPC clearance, and target-town fit before any human-only state change or runtime installation.',
    '',
    'Do not use legacy make-job/import/promotion/export routes for this asset. No API key, paid API fallback, automated approval, or runtime wiring is authorized by this pack.'
  ].join('\n').concat('\n');
}

export async function buildFable5PrefabInteriorJob({ assetId }, { forgeRoot = FORGE_ROOT, projectRoot = undefined } = {}) {
  const canonicalForgeRoot = path.resolve(forgeRoot);
  const canonicalProjectRoot = projectRootFor(canonicalForgeRoot, projectRoot);
  const { draft, contract } = await readDraftContract(assetId, canonicalForgeRoot);
  const [commonPrompt, interiorPrompt, townReference, buildingReference] = await Promise.all([
    readPrompt(canonicalForgeRoot, COMMON_PROMPT_PATH),
    readPrompt(canonicalForgeRoot, draft.promptPath),
    verifiedLedgerReference(canonicalProjectRoot, 'user_target_town_current', 'canonical-current-town-scale-and-material-authority'),
    verifiedLedgerReference(canonicalProjectRoot, draft.buildingReferenceId, draft.buildingReferenceRole)
  ]);
  const outputContract = outputContractFor(assetId);
  const promptText = `${commonPrompt.trimEnd()}\n\n${interiorPrompt.trimEnd()}\n`;
  const promptSha256 = sha256(promptText);
  const references = Object.freeze([townReference, buildingReference]);
  const provenanceKey = sha256(canonicalJson({
    format: FABLE5_PREFAB_INTERIOR_JOB_VERSION,
    assetId,
    contract: outputContract,
    promptSha256,
    referenceBindings: references.map(({ sourceId, bindingSha256, role }) => ({ sourceId, bindingSha256, role }))
  }));
  const jobId = `fable5_prefab_${assetId.replaceAll('.', '_')}_${provenanceKey.slice(0, 20)}`;
  const output = jobPackPaths(canonicalForgeRoot, jobId);
  const job = Object.freeze({
    format: FABLE5_PREFAB_INTERIOR_JOB_VERSION,
    id: jobId,
    assetId,
    status: 'draft-job-pack',
    externalGenerationRequired: true,
    contractPath: draft.contractPath,
    promptPaths: Object.freeze([COMMON_PROMPT_PATH, draft.promptPath]),
    promptSha256,
    outputContract,
    references,
    provenanceKey,
    guards: Object.freeze({
      usesLegacyInteriorDefinitions: false,
      usesFlattenedExteriorAsInterior: false,
      usesLegacyCutawayAsRuntimeSource: false,
      automaticImport: false,
      automaticApproval: false,
      runtimeInstall: false,
      apiKeyRequired: false,
      paidApiFallback: false
    }),
    approval: Object.freeze({ status: 'not-yet-submitted', humanOnly: true })
  });
  const pack = Object.freeze({
    schemaVersion: 1,
    jobId,
    assetId,
    promptPath: toPosixRelative(canonicalForgeRoot, output.prompt),
    referenceIds: Object.freeze(references.map((reference) => reference.sourceId)),
    outputContractPath: toPosixRelative(canonicalForgeRoot, output.outputContract),
    importCommandPath: toPosixRelative(canonicalForgeRoot, output.importGuide),
    status: 'job-pack'
  });
  const validation = validateWith('job-pack.schema.json', pack);
  if (!validation.ok) throw new Error(`Invalid Fable5 interior job pack: ${JSON.stringify(validation.errors)}`);
  return Object.freeze({ status: 'dry-run', job, pack, promptText, output, contract });
}

export async function writeFable5PrefabInteriorJobPack({ assetId, dryRun = false }, dependencies = {}) {
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const plan = await buildFable5PrefabInteriorJob({ assetId }, { forgeRoot, projectRoot: dependencies.projectRoot });
  if (dryRun) return plan;
  return withFileLock(forgeRoot, pathsFor(forgeRoot).requiredPromotionLock, async () => {
    const approvedBefore = await hashApprovedTree(forgeRoot);
    const rechecked = await buildFable5PrefabInteriorJob({ assetId }, { forgeRoot, projectRoot: dependencies.projectRoot });
    await atomicWriteJson(forgeRoot, rechecked.output.job, rechecked.job);
    await atomicWriteFile(forgeRoot, rechecked.output.prompt, rechecked.promptText);
    await atomicWriteJson(forgeRoot, rechecked.output.outputContract, rechecked.job.outputContract);
    await atomicWriteJson(forgeRoot, rechecked.output.references, { ledger: LEDGER_PATH, references: rechecked.job.references });
    await atomicWriteFile(forgeRoot, rechecked.output.importGuide, importGuide(assetId));
    await atomicWriteJson(forgeRoot, rechecked.output.manifest, rechecked.pack);
    const approvedAfter = await hashApprovedTree(forgeRoot);
    if (approvedBefore !== approvedAfter) throw new Error('Approved tree changed during Fable5 interior job-pack creation');
    return Object.freeze({ ...rechecked, status: 'job-pack', approvedTreeSha256Before: approvedBefore, approvedTreeSha256After: approvedAfter });
  });
}
