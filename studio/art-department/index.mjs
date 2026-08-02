import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Art-department original custody gate.
 *
 * The registry below is the hash-bound custody record for the owner's source
 * images. It is intentionally read-only: verification reads the 22 PNGs and
 * returns evidence; it never copies, edits, or promotes an original.  The only
 * write helpers in this package target candidates/ and reports/.
 */
export const ORIGINALS_RELATIVE_ROOT = 'art/references/user-provided';
export const FACTORY_ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL_REGISTRY_VERSION = '1.0.0';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SHA256_RE = /^[a-f0-9]{64}$/i;
const RELATIVE_SEGMENT_RE = /^(?!$|\.)[^/]+$/;

/** Exact dimensions and full SHA-256 values for the 22 owner originals. */
const ORIGINALS = [
  ['character_style_authority_20260722_v1.png', 1402, 1122, '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932'],
  ['character_style_reference_sheet.png', 1536, 1024, '910e1fdc2773018882e74918d492b77891869720b3affa170fb96ec2ed7db08b'],
  ['world_visual_master.png', 1491, 1055, 'cc2e822092b0a1cff798b540c8898057841def7b4a0d7b6c954da6feb7ae7e5d'],
  ['target-town.png', 1586, 992, '39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607'],
  ['building_inn_sheet.png', 1491, 1055, '78b18d8ee84c8bd57444babe6923cdb3b16fcfcf592ebbf3411df74bd16c069a'],
  ['building_town_hall_sheet.png', 1491, 1055, 'af560250efd3d45fb00c7ba4a486e6245db5318c564bc72a8a11ba84bbbfb1c9'],
  ['building_workshop_sheet.png', 1448, 1086, 'a28070edeec7d93df772ffe856bcaa49a11ba8ec55e60ddd5af15eab56f23ac7'],
  ['building_warehouse_sheet.png', 1448, 1086, '36b9a4f7dc5c9d7693fd1346a559735a36062aadeac8483beb2992e0ca3be4bc'],
  ['building_watchtower_sheet.png', 1491, 1055, '414a38a8621c25a0b812426abbc40b46a97444923148b967be8493bc4e2a277a'],
  ['building_guild_variant_01_sheet.png', 1448, 1086, 'e6d0904d6b2ac1af8ebf8d01df1662ccab49489ead967e0e244f4db6135701c9'],
  ['building_guild_variant_02_sheet.png', 1448, 1086, '764747f9059825cde6836c8951946afb459f8eacb3441d6ac58026d76f6d1597'],
  ['building_guild_variant_03_sheet.png', 1448, 1086, 'ea65fa6023f2fa96c44a22885b1957f94b5fe923b52c3ee0edc6e66fe2b6b71d'],
  ['building_guild_variant_04_sheet.png', 1448, 1086, '4e5844615e24eba837e181cce1f23001cc2b7f7ab13fd9cd189b5e6d86f4a6b3'],
  ['building_houses_shops_ruins_sheet.png', 1536, 1024, 'ec8afeadfe709cc6ae489d3e895a2a290eff79cb598db8c1925f548fd9e14225'],
  ['field_cobblestone_roads_sheet.png', 1491, 1055, 'f732a849dd88138e3acccc24970bef9e923302fec1aa01ffac195b8195cfff3d'],
  ['field_stairs_bridges_cliffs_sheet.png', 1491, 1055, '24e899bfb25552aa96e453a74e574337fc65481791fa572accdd8758615387bd'],
  ['field_harbor_docks_tiles_sheet.png', 1536, 1024, '44f07d8922eb87d131645b5f68c8a9f6ee06f0dd78f9e2d59b854a74a0740580'],
  ['object_street_props_sheet.png', 1536, 1024, 'b8f5879728932dce2b56428b65e4531cc66029f39848d1ef831d402ca17d4d85'],
  ['object_status_markers_sheet.png', 1491, 1055, 'e3d2f177bf10bc07d1362251d8aa80d490fc6f58999d24b06a66c34a177e1d1b'],
  ['ui_dialogue_frames_sheet.png', 1448, 1086, '60a2255fe72e2e96c91f00caa93fa7f4906f57fc1f8f0332bdbe91648b9ba29d'],
  ['ui_guild_roster_sheet.png', 1536, 1024, '5104c1dc835712a3d3bd6c50dc89b19f4a9489e27c655f15dd63f3ffdbe9bc99'],
  ['ui_inspection_report_sheet.png', 1086, 1448, 'c4c14e83e5f4e5fec8f7eaea537e6befa5f2762aaed11d07a5a86c05b6294892']
].map(([file, width, height, sha256], index) => ({
  id: `original-${String(index + 1).padStart(2, '0')}`,
  file,
  relativePath: `${ORIGINALS_RELATIVE_ROOT}/${file}`,
  width,
  height,
  dimensions: { width, height },
  sha256,
  custody: 'user-direct',
  immutable: true
}));

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

export const ORIGINAL_REGISTRY = freezeDeep({
  registryVersion: ORIGINAL_REGISTRY_VERSION,
  source: 'art/references/user-provided',
  count: ORIGINALS.length,
  originals: ORIGINALS
});

export class OriginalCustodyError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = 'OriginalCustodyError';
    this.code = 'ORIGINAL_CUSTODY_FAILED';
    this.failures = Object.freeze([...failures]);
  }
}

function failure(entry, code, message, details = {}) {
  return {
    id: entry?.id,
    file: entry?.file,
    code,
    message,
    ...details
  };
}

function inspectPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { signature: false, width: null, height: null, sha256: hashBytes(bytes), byteLength: bytes.length };
  }
  const ihdrLength = bytes.readUInt32BE(8);
  const ihdrType = bytes.subarray(12, 16).toString('ascii');
  if (ihdrType !== 'IHDR' || ihdrLength < 13 || bytes.length < 16 + ihdrLength) {
    return { signature: true, width: null, height: null, sha256: hashBytes(bytes), byteLength: bytes.length };
  }
  return {
    signature: true,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: hashBytes(bytes),
    byteLength: bytes.length
  };
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function defaultRepositoryRoot() {
  return path.resolve(FACTORY_ROOT_DIRECTORY, '../..');
}

function originalDirectory(repositoryRoot) {
  return path.resolve(repositoryRoot, ORIGINALS_RELATIVE_ROOT);
}

/** Return a frozen copy so callers cannot alter the custody registry. */
export function getOriginalRegistry() {
  return ORIGINAL_REGISTRY;
}

export function findOriginal(fileOrId) {
  const entry = ORIGINAL_REGISTRY.originals.find((candidate) =>
    candidate.id === fileOrId || candidate.file === fileOrId || candidate.relativePath === fileOrId
  );
  return entry;
}

/**
 * Read-only verification of the 22 original PNGs against this custody registry.
 * No directories or files are created by this function.
 */
export function verifyOriginalRegistry({ repositoryRoot = defaultRepositoryRoot(), strictSet = true } = {}) {
  const directory = originalDirectory(repositoryRoot);
  const failures = [];
  const checked = [];
  let files = [];
  try {
    files = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return Object.freeze({
      ok: false,
      registryVersion: ORIGINAL_REGISTRY_VERSION,
      directory,
      expected: ORIGINAL_REGISTRY.count,
      checked: 0,
      failures: Object.freeze([{ code: 'ORIGINAL_DIRECTORY_MISSING', message: error.message }]),
      unexpected: Object.freeze([])
    });
  }
  const actualPngNames = new Set(files.filter((entry) => entry.name.endsWith('.png')).map((entry) => entry.name));
  const expectedNames = new Set(ORIGINAL_REGISTRY.originals.map((entry) => entry.file));
  const unexpected = [...actualPngNames].filter((name) => !expectedNames.has(name)).sort();
  if (strictSet) {
    for (const name of unexpected) failures.push({ code: 'UNEXPECTED_ORIGINAL', file: name, message: 'PNG is not listed in the immutable original registry' });
  }

  for (const entry of ORIGINAL_REGISTRY.originals) {
    const absolutePath = path.join(directory, entry.file);
    let stat;
    try {
      const linkStat = fs.lstatSync(absolutePath);
      if (linkStat.isSymbolicLink()) {
        failures.push(failure(entry, 'ORIGINAL_SYMLINK', 'registered original must be a regular file, not a symlink'));
        continue;
      }
      stat = linkStat;
    } catch (error) {
      failures.push(failure(entry, 'ORIGINAL_MISSING', error.message));
      continue;
    }
    if (!stat.isFile()) {
      failures.push(failure(entry, 'ORIGINAL_NOT_FILE', 'registered original is not a regular file'));
      continue;
    }
    let inspected;
    try {
      inspected = inspectPng(absolutePath);
    } catch (error) {
      failures.push(failure(entry, 'ORIGINAL_UNREADABLE', error.message));
      continue;
    }
    const item = {
      id: entry.id,
      file: entry.file,
      path: absolutePath,
      signature: inspected.signature,
      dimensions: inspected.width === null ? null : { width: inspected.width, height: inspected.height },
      sha256: inspected.sha256,
      expectedSha256: entry.sha256,
      expectedDimensions: { width: entry.width, height: entry.height }
    };
    checked.push(item);
    if (!inspected.signature) failures.push(failure(entry, 'PNG_SIGNATURE_INVALID', 'PNG signature does not match', { actualSha256: inspected.sha256 }));
    if (inspected.width !== entry.width || inspected.height !== entry.height) {
      failures.push(failure(entry, 'PNG_DIMENSIONS_MISMATCH', `expected ${entry.width}x${entry.height}, got ${inspected.width}x${inspected.height}`));
    }
    if (!SHA256_RE.test(inspected.sha256) || inspected.sha256 !== entry.sha256) {
      failures.push(failure(entry, 'SHA256_MISMATCH', `expected ${entry.sha256}, got ${inspected.sha256}`));
    }
  }
  return Object.freeze({
    ok: failures.length === 0 && checked.length === ORIGINAL_REGISTRY.count,
    registryVersion: ORIGINAL_REGISTRY_VERSION,
    directory,
    expected: ORIGINAL_REGISTRY.count,
    checked: checked.length,
    entries: Object.freeze(checked.map((item) => Object.freeze(item))),
    failures: Object.freeze(failures.map((item) => Object.freeze(item))),
    unexpected: Object.freeze(unexpected)
  });
}

export const verifyOriginals = verifyOriginalRegistry;

export function assertOriginalRegistry(options = {}) {
  const report = verifyOriginalRegistry(options);
  if (!report.ok) throw new OriginalCustodyError('User-provided originals failed the custody gate', report.failures);
  return report;
}

function normalizeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('factory artifact path is required');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.includes('://')) {
    throw new TypeError('factory artifact path must be relative');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || !RELATIVE_SEGMENT_RE.test(part))) {
    throw new TypeError('factory artifact path contains an unsafe segment');
  }
  return parts.join('/');
}

function assertWritePath(factoryRoot, relativePath, kind) {
  if (kind !== 'candidate' && kind !== 'report') throw new TypeError('only candidate and report writes are permitted');
  const normalized = normalizeRelative(relativePath);
  const expectedPrefix = `${kind === 'candidate' ? 'candidates' : 'reports'}/`;
  if (!normalized.startsWith(expectedPrefix) || normalized === expectedPrefix) {
    throw new TypeError(`writes are restricted to ${kind === 'candidate' ? 'candidates/' : 'reports/'} only`);
  }
  const root = path.resolve(factoryRoot);
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new TypeError('factory artifact path escapes the factory root');
  }
  return absolute;
}

function assertNoSymlinkInPath(root, absolute) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') throw new TypeError('factory root must already exist');
    throw error;
  }
  if (rootStat.isSymbolicLink()) throw new TypeError('factory root must not be a symlink');
  if (!rootStat.isDirectory()) throw new TypeError('factory root must be a directory');
  const relative = path.relative(root, absolute);
  const segments = relative.split(path.sep);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new TypeError('symlinks are not allowed in factory write paths');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function writeFactoryArtifact(factoryRoot, relativePath, data, kind, options = {}) {
  const root = path.resolve(factoryRoot);
  const absolute = assertWritePath(root, relativePath, kind);
  const parent = path.dirname(absolute);
  // Check before mkdir as well as after: a pre-existing symlink must never
  // cause directory creation or writes outside the factory root.
  assertNoSymlinkInPath(root, absolute);
  fs.mkdirSync(parent, { recursive: true });
  assertNoSymlinkInPath(root, absolute);
  const encoding = options.encoding ?? (typeof data === 'string' ? 'utf8' : undefined);
  fs.writeFileSync(absolute, data, encoding ? { encoding } : undefined);
  return Object.freeze({ kind, path: absolute, relativePath: path.relative(root, absolute).split(path.sep).join('/') });
}

/** Write a candidate only below studio/art-department/candidates/. */
export function writeCandidate(factoryRoot, relativePath, data, options = {}) {
  return writeFactoryArtifact(factoryRoot, relativePath, data, 'candidate', options);
}

/** Write a generated report only below studio/art-department/reports/. */
export function writeReport(factoryRoot, relativePath, data, options = {}) {
  return writeFactoryArtifact(factoryRoot, relativePath, data, 'report', options);
}

/** Explicitly named boundary check for callers that need to preflight writes. */
export function assertFactoryWritePath(factoryRoot, relativePath, kind) {
  return assertWritePath(factoryRoot, relativePath, kind);
}
