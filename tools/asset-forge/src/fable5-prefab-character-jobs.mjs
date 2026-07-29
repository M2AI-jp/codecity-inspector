import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { FORGE_ROOT, pathsFor } from './config.mjs';
import { atomicWriteFile, atomicWriteJson, withFileLock } from './fs-safe.mjs';
import { canonicalJson, hashApprovedTree, sha256 } from './hashing.mjs';
import { readExternalImage } from './images/inspect-image.mjs';
import { assertExistingFileWithin, toPosixRelative } from './paths.mjs';
import { validateWith } from './schemas.mjs';

export const FABLE5_PREFAB_CHARACTER_JOB_VERSION = 'fable5-prefab-character-job-v1';

const LEDGER_PATH = 'art/contracts/user-provided-images.json';
const COMMON_PROMPT_PATH = 'prompts/fable5-prefab/00_common_fable5_character_sheet_style.md';
const CHARACTER_STYLE_AUTHORITY = Object.freeze({
  sourceId: 'user_character_style_authority_20260722_v1',
  canonicalPath: 'art/references/user-provided/character_style_authority_20260722_v1.png',
  sha256: '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932'
});
const ACCEPTED_DRAFT_STATUSES = Object.freeze([
  'draft-pending-generation',
  'draft-pending-review'
]);

// This command deliberately has its own, narrow asset vocabulary.  It must
// never resolve the historical `character.*` catalogs: those definitions use
// a different grid and, for the player, a rejected identity reference.
const DRAFTS = Object.freeze({
  char_player: Object.freeze({
    contractPath: 'contracts/fable5-prefab/character.player.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/character.player.prompt-draft.md',
    identityRole: 'player-direct-derivation-from-sole-character-style-authority'
  }),
  char_innkeeper: Object.freeze({
    contractPath: 'contracts/fable5-prefab/character.innkeeper.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/character.innkeeper.prompt-draft.md',
    identityRole: 'sole-character-style-authority-distinct-npc'
  }),
  char_town_clerk: Object.freeze({
    contractPath: 'contracts/fable5-prefab/character.town-clerk.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/character.town-clerk.prompt-draft.md',
    identityRole: 'sole-character-style-authority-distinct-npc'
  }),
  char_resident: Object.freeze({
    contractPath: 'contracts/fable5-prefab/character.resident.contract-draft.json',
    promptPath: 'prompts/fable5-prefab/character.resident.prompt-draft.md',
    identityRole: 'sole-character-style-authority-distinct-npc'
  })
});

const REQUIRED_SHEET = Object.freeze({
  width: 640,
  height: 512,
  frameWidth: 64,
  frameHeight: 128,
  rows: 4,
  cols: 10,
  pivotX: 32,
  pivotY: 120,
  rowOrder: Object.freeze(['south', 'west', 'east', 'north']),
  idle: Object.freeze({ cols: Object.freeze([0, 1]), fps: 4 }),
  walk: Object.freeze({ cols: Object.freeze([2, 3, 4, 5, 6, 7]), fps: 10 }),
  interact: Object.freeze({ cols: Object.freeze([8, 9]), fps: 6 })
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
    throw new Error('Fable5 prefab character jobs accept only char_player, char_innkeeper, char_town_clerk, or char_resident');
  }
  return draft;
}

function outputContractFor(contract) {
  return Object.freeze({
    kind: 'spritesheet',
    format: 'png',
    background: 'transparent',
    needsTransparency: true,
    width: contract.png.w,
    height: contract.png.h,
    nativeScale: contract.nativeScale,
    pivot: Object.freeze({ ...contract.pivot }),
    grid: Object.freeze({
      columns: contract.sheet.cols,
      rows: contract.sheet.rows,
      frameWidth: contract.sheet.frameW,
      frameHeight: contract.sheet.frameH
    }),
    animations: Object.freeze({
      rowOrder: Object.freeze([...contract.sheet.anims.rowOrder]),
      idle: Object.freeze({ ...contract.sheet.anims.idle, cols: Object.freeze([...contract.sheet.anims.idle.cols]) }),
      walk: Object.freeze({ ...contract.sheet.anims.walk, cols: Object.freeze([...contract.sheet.anims.walk.cols]) }),
      interact: Object.freeze({ ...contract.sheet.anims.interact, cols: Object.freeze([...contract.sheet.anims.interact.cols]) })
    })
  });
}

export function fable5CharacterContractProblems(contract, assetId) {
  const expectedFile = `character/${assetId}.png`;
  const problems = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return ['contract must be an object'];
  if (!ACCEPTED_DRAFT_STATUSES.includes(contract.status)) {
    problems.push(`contract must remain one of: ${ACCEPTED_DRAFT_STATUSES.join(', ')}`);
  }
  if (contract.assetId !== assetId) problems.push(`contract assetId must be ${assetId}`);
  if (contract.category !== 'character') problems.push('contract category must be character');
  if (!sameJson(contract.png, { file: expectedFile, w: REQUIRED_SHEET.width, h: REQUIRED_SHEET.height })) {
    problems.push(`contract PNG must be ${expectedFile} at 640x512`);
  }
  if (contract.nativeScale !== 1) problems.push('contract nativeScale must be 1');
  if (!sameJson(contract.pivot, { x: REQUIRED_SHEET.pivotX, y: REQUIRED_SHEET.pivotY })) {
    problems.push('contract pivot must be (32,120)');
  }
  if (!sameJson(contract.footprint, { w: 1, h: 1 })) problems.push('contract footprint must be 1x1');
  if (!Array.isArray(contract.collision) || contract.collision.length !== 0) problems.push('character collision must be an empty array');
  if (contract.layers?.base !== expectedFile) problems.push('character base layer must equal its PNG file');
  const sheet = contract.sheet;
  if (!sheet || typeof sheet !== 'object') return [...problems, 'character sheet is required'];
  if (sheet.rows !== REQUIRED_SHEET.rows || sheet.cols !== REQUIRED_SHEET.cols
    || sheet.frameW !== REQUIRED_SHEET.frameWidth || sheet.frameH !== REQUIRED_SHEET.frameHeight) {
    problems.push('character sheet must be a 4x10 grid of 64x128 frames');
  }
  if (!sameJson(sheet.anims?.rowOrder, REQUIRED_SHEET.rowOrder)) problems.push('row order must be south, west, east, north');
  for (const animation of ['idle', 'walk', 'interact']) {
    if (!sameJson(sheet.anims?.[animation], REQUIRED_SHEET[animation])) {
      problems.push(`${animation} animation does not match the Fable5 contract`);
    }
  }
  if (!sameJson(contract.allowedZoom, [1, 2, 3])) problems.push('allowedZoom must be [1,2,3]');
  const authority = assetId === 'char_player'
    ? contract.draftMeta?.identitySource
    : contract.draftMeta?.characterStyleAuthority;
  if (!sameJson({
    sourceId: authority?.sourceId,
    canonicalPath: authority?.canonicalPath,
    sha256: authority?.sha256
  }, CHARACTER_STYLE_AUTHORITY)) {
    problems.push('character draft must use the exact sole character-style authority');
  }
  return problems;
}

async function readDraftContract(assetId, forgeRoot) {
  const draft = draftFor(assetId);
  const contractPath = await assertExistingFileWithin(forgeRoot, draft.contractPath);
  let contract;
  try {
    contract = JSON.parse(await readFile(contractPath, 'utf8'));
  } catch (error) {
    throw new Error(`Fable5 character contract is not valid JSON: ${draft.contractPath}`, { cause: error });
  }
  const problems = fable5CharacterContractProblems(contract, assetId);
  if (problems.length) throw new Error(`Fable5 character contract rejected: ${problems.join('; ')}`);
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

async function verifiedLedgerReference(projectRoot, sourceId, role, expected = undefined) {
  const ledgerPath = await assertExistingFileWithin(projectRoot, LEDGER_PATH);
  let ledger;
  try {
    ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  } catch (error) {
    throw new Error('User-provided image ledger is not valid JSON', { cause: error });
  }
  const source = ledger?.sources?.find((candidate) => candidate?.sourceId === sourceId);
  if (!source) throw new Error(`Required user-provided reference is absent from the ledger: ${sourceId}`);
  if (expected && (source.canonicalPath !== expected.canonicalPath || source.sha256 !== expected.sha256)) {
    throw new Error(`Reference ledger record does not match the locked character-style authority: ${sourceId}`);
  }
  if (!hasGenerationReferenceApproval(source)) {
    throw new Error(`Reference is not approved for generation use: ${sourceId}`);
  }
  if (typeof source.canonicalPath !== 'string' || typeof source.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error(`Reference ledger record is incomplete: ${sourceId}`);
  }
  const sourcePath = await assertExistingFileWithin(projectRoot, source.canonicalPath);
  const image = await readExternalImage(sourcePath);
  const observedHash = sha256(image.buffer);
  if (observedHash !== source.sha256) throw new Error(`Reference hash mismatch: ${sourceId}`);
  if (!sameJson(source.dimensions, { width: image.metadata.width, height: image.metadata.height })) {
    throw new Error(`Reference dimensions mismatch: ${sourceId}`);
  }

  // The source hash is deliberately represented as a commitment rather than
  // copied into a Forge artifact. The user-direct identity reference remains
  // authoritative in the ledger outside this tool; this job pack records that
  // it was checked without duplicating or relabelling the original.
  return Object.freeze({
    sourceId,
    role,
    ledger: LEDGER_PATH,
    dimensions: Object.freeze({ ...source.dimensions }),
    bindingSha256: sha256(canonicalJson({
      sourceId,
      sourceSha256: source.sha256,
      dimensions: source.dimensions,
      role
    })),
    verifiedAtAssembly: true,
    copiedIntoForge: false
  });
}

async function readPrompt(forgeRoot, promptPath) {
  const safePath = await assertExistingFileWithin(forgeRoot, promptPath);
  return readFile(safePath, 'utf8');
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
    '# Fable5 character candidate intake',
    '',
    `This pack commissions a pending ${assetId} candidate; it contains no generated pixels.`,
    '',
    '1. A human resolves the two source IDs in `references.json` through the canonical project ledger. The character-style authority is the exact locked source committed by this pack; do not substitute an older candidate or reference.',
    '2. A human authorizes and runs an external, supervised generation session using `prompt.md` and `output-contract.json`.',
    '3. Keep every returned byte outside the runtime and in pending/quarantine until a Fable5-specific intake and human review have completed.',
    '',
    'Do not use the legacy `make-job`, `make-job-v2`, `import`, or `import-v2` commands for this candidate. Their historical character definitions have a different sheet contract; the historical player definition also carries a rejected identity. This pre-generation pack intentionally has no automatic import or promotion command.',
    '',
    'Historical character candidates, including earlier approved or pending sheets, are prohibited as visual references and cannot be reused as a runtime-promotion source.',
    '',
    'No API key, paid API fallback, automated approval, or runtime wiring is authorized by this pack.'
  ].join('\n').concat('\n');
}

export async function buildFable5PrefabCharacterJob({ assetId }, {
  forgeRoot = FORGE_ROOT,
  projectRoot = undefined
} = {}) {
  const canonicalForgeRoot = path.resolve(forgeRoot);
  const canonicalProjectRoot = projectRootFor(canonicalForgeRoot, projectRoot);
  const { draft, contract, contractPath } = await readDraftContract(assetId, canonicalForgeRoot);
  const [commonPrompt, characterPrompt, identityReference, townReference] = await Promise.all([
    readPrompt(canonicalForgeRoot, COMMON_PROMPT_PATH),
    readPrompt(canonicalForgeRoot, draft.promptPath),
    verifiedLedgerReference(
      canonicalProjectRoot,
      CHARACTER_STYLE_AUTHORITY.sourceId,
      draft.identityRole,
      CHARACTER_STYLE_AUTHORITY
    ),
    verifiedLedgerReference(canonicalProjectRoot, 'user_target_town_current', 'town-lighting-and-shading')
  ]);
  const outputContract = outputContractFor(contract);
  const promptText = `${commonPrompt.trimEnd()}\n\n${characterPrompt.trimEnd()}\n`;
  const promptSha256 = sha256(promptText);
  const references = Object.freeze([identityReference, townReference]);
  const provenanceKey = sha256(canonicalJson({
    format: FABLE5_PREFAB_CHARACTER_JOB_VERSION,
    assetId,
    contract: outputContract,
    promptSha256,
    referenceBindings: references.map(({ sourceId, bindingSha256, role }) => ({ sourceId, bindingSha256, role }))
  }));
  const jobId = `fable5_prefab_${assetId}_${provenanceKey.slice(0, 20)}`;
  const output = jobPackPaths(canonicalForgeRoot, jobId);
  // `assertExistingFileWithin()` resolves a physical path to reject symlinks.
  // Keep the already-validated logical Forge-relative path in the portable
  // pack so a `/var` -> `/private/var` platform alias cannot look like an
  // escape when serializing the contract location.
  const contractRelativePath = draft.contractPath;
  const job = Object.freeze({
    format: FABLE5_PREFAB_CHARACTER_JOB_VERSION,
    id: jobId,
    assetId,
    status: 'draft-job-pack',
    externalGenerationRequired: true,
    contractPath: contractRelativePath,
    promptPaths: Object.freeze([COMMON_PROMPT_PATH, draft.promptPath]),
    promptSha256,
    outputContract,
    references,
    provenanceKey,
    guards: Object.freeze({
      usesLegacyCharacterDefinitions: false,
      usesLegacyCharacterPrompts: false,
      usesRejectedPlayerIdentity: false,
      usesHistoricalCharacterCandidates: false,
      historicalCharacterRuntimePromotion: false,
      automaticImport: false,
      automaticApproval: false,
      apiKeyRequired: false,
      paidApiFallback: false
    }),
    approval: Object.freeze({
      status: 'not-yet-submitted',
      humanOnly: true
    })
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
  if (!validation.ok) throw new Error(`Invalid Fable5 character job pack: ${JSON.stringify(validation.errors)}`);
  return Object.freeze({
    status: 'dry-run',
    job,
    pack,
    promptText,
    output
  });
}

export async function writeFable5PrefabCharacterJobPack({ assetId, dryRun = false }, dependencies = {}) {
  const forgeRoot = path.resolve(dependencies.forgeRoot ?? FORGE_ROOT);
  const plan = await buildFable5PrefabCharacterJob({ assetId }, {
    forgeRoot,
    projectRoot: dependencies.projectRoot
  });
  if (dryRun) return plan;

  return withFileLock(forgeRoot, pathsFor(forgeRoot).requiredPromotionLock, async () => {
    const approvedBefore = await hashApprovedTree(forgeRoot);
    const planAfterLock = await buildFable5PrefabCharacterJob({ assetId }, {
      forgeRoot,
      projectRoot: dependencies.projectRoot
    });
    await atomicWriteJson(forgeRoot, planAfterLock.output.job, planAfterLock.job);
    await atomicWriteFile(forgeRoot, planAfterLock.output.prompt, planAfterLock.promptText);
    await atomicWriteJson(forgeRoot, planAfterLock.output.outputContract, planAfterLock.job.outputContract);
    await atomicWriteJson(forgeRoot, planAfterLock.output.references, {
      ledger: LEDGER_PATH,
      references: planAfterLock.job.references
    });
    await atomicWriteFile(forgeRoot, planAfterLock.output.importGuide, importGuide(assetId));
    await atomicWriteJson(forgeRoot, planAfterLock.output.manifest, planAfterLock.pack);
    const approvedAfter = await hashApprovedTree(forgeRoot);
    if (approvedBefore !== approvedAfter) throw new Error('Approved tree changed during Fable5 character job-pack creation');
    return Object.freeze({ ...planAfterLock, status: 'job-pack', approvedTreeSha256Before: approvedBefore, approvedTreeSha256After: approvedAfter });
  });
}
