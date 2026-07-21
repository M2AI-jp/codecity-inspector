import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const ledgerPath = path.join(repositoryRoot, 'art/contracts/user-provided-images.json');
const registryPath = path.join(repositoryRoot, 'art/contracts/source-registry.json');
const productionManifestPath = path.join(repositoryRoot, 'art/production/vertical-slice/manifest.json');
const expectedTown = {
  sourceId: 'src_quality_town_current',
  ledgerSourceId: 'user_target_town_current',
  path: 'art/references/target-town.png',
  canonicalPath: 'art/references/user-provided/target-town.png',
  sha256: '39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607',
  dimensions: { width: 1586, height: 992 },
  method: 'direct-whole-image-native',
};
const expectedCharacterSha256 = '910e1fdc2773018882e74918d492b77891869720b3affa170fb96ec2ed7db08b';
const generatedHashes = new Set([
  '78436f089e03ae6fb15605ccaeae12513cd9393dd0e3355d4ef6df04bfb430ea',
  'e88b18da60d9c314ecc83c30573d6423129525fb684ce57496c240c1dbf19535',
]);
const allowedOriginKinds = new Set(['unknown', 'external-chatgpt-pro-output-as-supplied', 'codex-imagegen', 'derived']);
const allowedCustodyKinds = new Set(['user-direct', 'agent-generated-not-user-direct', 'unknown', 'byte-identical-worktree-copy']);
const allowedApprovalStatuses = new Set(['approved', 'rejected', 'pending', 'unknown', 'superseded']);
const runtimeUseKeys = ['directWholeImageRender', 'fixedCropInput', 'nineSliceInput', 'generationReference', 'fullSheetRender'];

const fail = (message) => { throw new Error(message); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameDimensions = (a, b) => a?.width === b?.width && a?.height === b?.height;

function assertSafeRelativePath(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    fail(`${label}: expected a non-empty repository-relative path`);
  }
  if (relativePath.split(/[\\/]/u).includes('..')) {
    fail(`${label}: parent traversal is forbidden`);
  }
  if (path.posix.normalize(relativePath) !== relativePath) {
    fail(`${label}: path must already be normalized`);
  }
}

function isInside(realRoot, realTarget) {
  const relative = path.relative(realRoot, realTarget);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pngDimensions(bytes, relativePath) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) fail(`${relativePath}: expected PNG bytes`);
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') fail(`${relativePath}: PNG has no leading IHDR chunk`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function verifiedFile(relativePath, expectedSha256, expectedDimensions, requiredRealRoot = null) {
  assertSafeRelativePath(relativePath, relativePath);
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  const repositoryRealRoot = await realpath(repositoryRoot);
  const fileRealPath = await realpath(absolutePath);
  if (!isInside(repositoryRealRoot, fileRealPath)) fail(`${relativePath}: resolves outside repository`);
  if (requiredRealRoot && !isInside(requiredRealRoot, fileRealPath)) fail(`${relativePath}: resolves outside canonical root`);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${relativePath}: must be a regular non-symlink file`);
  const bytes = await readFile(absolutePath);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) fail(`${relativePath}: SHA-256 mismatch; expected ${expectedSha256}, observed ${actualSha256}`);
  const actualDimensions = pngDimensions(bytes, relativePath);
  if (!sameDimensions(actualDimensions, expectedDimensions)) {
    fail(`${relativePath}: dimensions mismatch; expected ${expectedDimensions.width}x${expectedDimensions.height}, observed ${actualDimensions.width}x${actualDimensions.height}`);
  }
  return { bytes: bytes.length, sha256: actualSha256, dimensions: actualDimensions };
}

function verifiedGitBlob(blob, expectedSha256, label) {
  if (!/^[0-9a-f]{40}$/u.test(blob)) fail(`${label}: invalid Git blob id`);
  let bytes;
  try {
    bytes = execFileSync('git', ['cat-file', 'blob', blob], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch {
    fail(`${label}: Git blob ${blob} is unavailable`);
  }
  if (sha256(bytes) !== expectedSha256) fail(`${label}: historical Git blob bytes do not match source SHA-256`);
}

function assertRuntimeUse(runtimeUse, label) {
  if (!runtimeUse || typeof runtimeUse !== 'object' || Array.isArray(runtimeUse)) fail(`${label}: missing structured runtimeUse`);
  for (const key of runtimeUseKeys) if (typeof runtimeUse[key] !== 'boolean') fail(`${label}: runtimeUse.${key} must be boolean`);
  for (const key of Object.keys(runtimeUse)) if (!runtimeUseKeys.includes(key)) fail(`${label}: unsupported runtimeUse key ${key}`);
}

function assertScopedApproval(approval, label) {
  if (!approval || typeof approval !== 'object') fail(`${label}: missing approval`);
  if (approval.decisions) {
    if (!Array.isArray(approval.decisions) || approval.decisions.length === 0) fail(`${label}: approval.decisions must not be empty`);
    for (const [index, decision] of approval.decisions.entries()) assertScopedApproval(decision, `${label}.decisions[${index}]`);
    return;
  }
  if (!allowedApprovalStatuses.has(approval.status)) fail(`${label}: unsupported approval status ${approval.status}`);
  if (!Array.isArray(approval.scope)) fail(`${label}: approval.scope must be an array`);
}

function allObjects(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) allObjects(child, visit);
}

async function main() {
  const [ledger, registry, productionManifest] = await Promise.all([
    readFile(ledgerPath, 'utf8').then(JSON.parse),
    readFile(registryPath, 'utf8').then(JSON.parse),
    readFile(productionManifestPath, 'utf8').then(JSON.parse),
  ]);
  if (ledger.schemaVersion !== 2) fail('user image ledger schemaVersion must be 2');
  if (registry.schemaVersion !== 3) fail('source registry schemaVersion must be 3');
  if (!Array.isArray(ledger.sources) || ledger.sources.length === 0) fail('ledger.sources must not be empty');
  assertSafeRelativePath(ledger.canonicalRoot, 'ledger.canonicalRoot');
  const canonicalRealRoot = await realpath(path.resolve(repositoryRoot, ledger.canonicalRoot));
  const evidenceIds = new Set(Object.keys(ledger.evidenceRecords ?? {}));
  const ledgerIds = new Set();
  const canonicalPaths = new Set();
  const ledgerById = new Map();
  const results = [];

  for (const source of ledger.sources) {
    if (ledgerIds.has(source.sourceId)) fail(`duplicate ledger sourceId ${source.sourceId}`);
    if (canonicalPaths.has(source.canonicalPath)) fail(`duplicate canonicalPath ${source.canonicalPath}`);
    ledgerIds.add(source.sourceId);
    canonicalPaths.add(source.canonicalPath);
    ledgerById.set(source.sourceId, source);
    assertSafeRelativePath(source.canonicalPath, `${source.sourceId}.canonicalPath`);
    if (source.custody?.kind !== 'user-direct') fail(`${source.sourceId}: direct ledger custody must be user-direct`);
    if (!allowedOriginKinds.has(source.origin?.kind)) fail(`${source.sourceId}: unsupported origin kind ${source.origin?.kind}`);
    assertScopedApproval(source.approval, `${source.sourceId}.approval`);
    if (source.approval.status !== 'approved' || source.approval.approvedBy !== 'user' || !source.approval.decisionRef) fail(`${source.sourceId}: user-direct source requires scoped user approval evidence`);
    if (source.protection?.state !== 'worktree-protected-pending-versioning' || source.protection.canonicalCopyTracked !== false) fail(`${source.sourceId}: current protection state must truthfully remain pending versioning`);
    assertRuntimeUse(source.runtimeUse, source.sourceId);
    for (const evidenceRef of source.custody.evidenceRefs ?? []) if (!evidenceIds.has(evidenceRef)) fail(`${source.sourceId}: unknown evidenceRef ${evidenceRef}`);
    if (source.custody.gitBlob) verifiedGitBlob(source.custody.gitBlob, source.sha256, source.sourceId);
    const verified = await verifiedFile(source.canonicalPath, source.sha256, source.dimensions, canonicalRealRoot);
    if (source.activeAlias) await verifiedFile(source.activeAlias, source.sha256, source.dimensions);
    results.push({ sourceId: source.sourceId, canonicalPath: source.canonicalPath, ...verified });
  }

  if (!Array.isArray(ledger.tombstones) || !ledger.tombstones.some((item) => item.sourceId === 'user_target_town_previous_missing' && item.protection?.state === 'missing-unconfirmed')) {
    fail('missing independent tombstone for the unavailable previous target-town bytes');
  }

  const nonUserById = new Map();
  for (const record of ledger.nonUserDirectRecords ?? []) {
    if (nonUserById.has(record.recordId)) fail(`duplicate non-user record ${record.recordId}`);
    nonUserById.set(record.recordId, record);
    if (!allowedOriginKinds.has(record.origin?.kind) || record.origin.kind === 'unknown') fail(`${record.recordId}: generated record requires explicit origin`);
    if (!allowedCustodyKinds.has(record.custody?.kind) || record.custody.kind === 'user-direct') fail(`${record.recordId}: generated record may not have user-direct custody`);
    assertScopedApproval(record.approval, `${record.recordId}.approval`);
    if (record.custody.gitBlob) verifiedGitBlob(record.custody.gitBlob, record.sha256, record.recordId);
    if (record.path === 'art/references/target-cutaway.png') await verifiedFile(record.path, record.sha256, record.dimensions);
  }

  const registryIds = new Set();
  const registryPaths = new Set();
  for (const source of registry.sources ?? []) {
    if (registryIds.has(source.sourceId)) fail(`duplicate registry sourceId ${source.sourceId}`);
    if (registryPaths.has(source.path)) fail(`duplicate registry path ${source.path}`);
    registryIds.add(source.sourceId);
    registryPaths.add(source.path);
    assertRuntimeUse(source.runtimeUse, source.sourceId);
    await verifiedFile(source.path, source.sha256, source.dimensions);
    const ledgerSourceId = source.custody?.ledgerSourceId;
    if (ledgerSourceId) {
      const ledgerSource = ledgerById.get(ledgerSourceId);
      if (!ledgerSource) fail(`${source.sourceId}: invalid ledgerSourceId ${ledgerSourceId}`);
      for (const field of ['origin', 'custody', 'approval', 'protection']) {
        if (source[field]?.ledgerSourceId !== ledgerSourceId || source[field]?.field !== field) fail(`${source.sourceId}: ${field} must independently reference ${ledgerSourceId}`);
      }
      const allowedPaths = new Set([ledgerSource.canonicalPath, ledgerSource.activeAlias].filter(Boolean));
      if (!allowedPaths.has(source.path) || source.sha256 !== ledgerSource.sha256 || !sameDimensions(source.dimensions, ledgerSource.dimensions)) fail(`${source.sourceId}: registry bytes do not match ledger authority`);
      if (JSON.stringify(source.runtimeUse) !== JSON.stringify(ledgerSource.runtimeUse)) fail(`${source.sourceId}: registry runtimeUse differs from scoped ledger approval`);
    } else {
      if (!allowedOriginKinds.has(source.origin?.kind) || source.origin.kind === 'unknown') fail(`${source.sourceId}: non-ledger source requires explicit origin`);
      if (!allowedCustodyKinds.has(source.custody?.kind) || source.custody.kind === 'user-direct') fail(`${source.sourceId}: generated source may not claim user-direct custody`);
      assertScopedApproval(source.approval, `${source.sourceId}.approval`);
    }
    if (generatedHashes.has(source.sha256) && source.custody?.ledgerSourceId) fail(`${source.sourceId}: generated hash was laundered through user-direct ledger authority`);
  }

  const character = (registry.sources ?? []).find((source) => source.sourceId === 'src_character_inspector');
  if (!character || character.sha256 !== expectedCharacterSha256 || character.custody?.ledgerSourceId !== 'user_character_style_reference') fail('active character authority must be the protected green user source');
  const town = (registry.sources ?? []).find((source) => source.sourceId === expectedTown.sourceId);
  if (!town || town.path !== expectedTown.path || town.sha256 !== expectedTown.sha256 || !sameDimensions(town.dimensions, expectedTown.dimensions) || !town.runtimeUse.directWholeImageRender) fail('active town authority must be the exact user-provided image');
  for (const source of registry.sources ?? []) if (source.sourceId !== expectedTown.sourceId && source.runtimeUse.directWholeImageRender) fail(`${source.sourceId}: whole-image background approval is limited to target-town`);
  const exception = registry.authority?.exactRuntimeBackgroundException;
  if (!exception || exception.sourceId !== expectedTown.sourceId || exception.path !== expectedTown.path || exception.sha256 !== expectedTown.sha256 || exception.method !== expectedTown.method || !sameDimensions(exception.dimensions, expectedTown.dimensions)) fail('registry exact background exception is missing or over-broad');

  const runtimeBackground = productionManifest.output?.runtimeBackground;
  if (!runtimeBackground || runtimeBackground.path !== expectedTown.path || runtimeBackground.protectedCanonicalPath !== expectedTown.canonicalPath || runtimeBackground.protectedSourceId !== expectedTown.ledgerSourceId || runtimeBackground.sha256 !== expectedTown.sha256 || !sameDimensions(runtimeBackground.dimensions, expectedTown.dimensions) || runtimeBackground.method !== expectedTown.method || runtimeBackground.resampleAllowed !== false) fail('production manifest runtime background must be the exact native user target-town image');
  const targetBoard = (productionManifest.boards ?? []).find((board) => board.boardId === 'user-target-town-runtime-background-v1');
  if (!targetBoard || targetBoard.pngPath !== expectedTown.path || targetBoard.sha256 !== expectedTown.sha256 || targetBoard.runtimeDisposition !== 'authorized-exact-background-no-resample') fail('target-town board authority is incomplete');
  const generatedBoard = (productionManifest.boards ?? []).find((board) => board.boardId === 'old-town-exterior-master-v1');
  if (!generatedBoard || !String(generatedBoard.runtimeDisposition).includes('never-runtime-load')) fail('generated candidate03 must remain non-runtime evidence');
  let cutawayUsedByProduction = false;
  allObjects(productionManifest, (object) => { if (Array.isArray(object.sourceIds) && object.sourceIds.includes('src_quality_cutaway_current')) cutawayUsedByProduction = true; });
  if (cutawayUsedByProduction) fail('unapproved cutaway remains a production source');

  const requireRuntime = process.argv.includes('--require-runtime');
  const implementationGates = {
    greenPlayerDerivative: 'pending-runtime-asset-and-lineage-verification',
    targetTownGeometry: runtimeBackground.geometryStatus,
  };
  if (requireRuntime && Object.values(implementationGates).some((value) => String(value).startsWith('pending') || String(value).includes('required'))) fail('runtime implementation gates are not yet complete');

  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    observed: {
      directSourceCount: results.length,
      directSourceBytes: results.reduce((sum, item) => sum + item.bytes, 0),
      canonicalHashesAndDimensionsMatch: true,
      originCustodyApprovalProtectionSeparated: true,
      canonicalProtectionClaim: 'worktree-protected-pending-versioning',
      historicalGitBlobsMatchWhereRecorded: true,
      generatedSourcesNotRelabeledUserDirect: true,
      exactTownBackgroundAuthority: true,
      generatedBackgroundAuthorityRejected: true,
      cutawayProductionAuthorityRejected: true,
    },
    implementationGates,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`user-provided-image verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
