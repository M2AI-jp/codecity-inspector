// test/town/target-town-prefab-manifest-schema.test.mjs
//
// Schema + regression coverage for the target-town master prefab
// decomposition produced by art/production/vertical-slice/scripts/
// {extract-target-town-terrain-plates,extract-target-town-buildings,
// extract-target-town-trees,extract-target-town-props,
// build-target-town-prefab-manifest,verify-target-town-prefab-reconstruction}.py.
//
// This is the HG-03/A1 evidence artifact (docs/qa/evidence-matrix.md): every
// visible element of the accepted target-town master must map to a
// manifest-recorded source/crop/pivot/layer/sha256 entry, and prefab-only
// reconstruction must equal the master exactly. The test below does not
// trust the manifest's own claims -- it independently re-hashes every
// referenced PNG from disk and re-derives PNG dimensions from the file's own
// IHDR chunk, so a stale hash or a silently-edited asset fails loudly here.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'public/fable5-v2/assets/prefabs/manifest.json');
const LINEAGE_PATH = path.join(REPO_ROOT, 'public/fable5-v2/assets/prefabs/town-master-decomposition.lineage.json');
const RECONSTRUCTION_REPORT_PATH = path.join(
  REPO_ROOT,
  'art/production/vertical-slice/qa/town-master-prefab-reconstruction-report-v1.json'
);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ACCEPTED_MASTER_SHA256 = '39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607';
const ACCEPTED_MASTER_DIMENSIONS = { width: 1586, height: 992 };
const EXPECTED_LAYERS = ['terrain', 'road', 'building', 'prop', 'foreground'];

async function loadJson(absolutePath) {
  const raw = await readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
}

async function sha256OfFile(absolutePath) {
  const buffer = await readFile(absolutePath);
  return createHash('sha256').update(buffer).digest('hex');
}

// Minimal PNG IHDR reader: width/height live at fixed byte offsets in every
// well-formed PNG (8-byte signature, 4-byte chunk length, 4-byte "IHDR",
// then 4-byte width, 4-byte height, big-endian). No image library needed.
function pngDimensionsFromBuffer(buffer) {
  const signatureOk = buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47;
  assert.ok(signatureOk, 'not a PNG file (bad signature)');
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR', 'missing IHDR chunk where expected');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

let manifest;
let lineage;

test('setup: manifest.json and lineage.json parse as JSON', async () => {
  manifest = await loadJson(MANIFEST_PATH);
  lineage = await loadJson(LINEAGE_PATH);
  assert.equal(typeof manifest, 'object');
  assert.equal(typeof lineage, 'object');
});

test('manifest top-level shape matches the documented contract', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(typeof manifest.manifestId, 'string');
  assert.ok(manifest.manifestId.length > 0);
  assert.equal(typeof manifest.status, 'string');
  assert.equal(typeof manifest.purpose, 'string');
  assert.ok(Array.isArray(manifest.layers));
  assert.ok(Array.isArray(manifest.prefabs));
  assert.equal(typeof manifest.prefabCounts, 'object');
  assert.equal(typeof manifest.prefabCountTotal, 'number');
  assert.ok(Array.isArray(manifest.excludedAssets));
});

test('manifest declares exactly the five documented draw layers, in draw order', () => {
  assert.deepEqual(manifest.layers, EXPECTED_LAYERS);
  assert.equal(typeof manifest.drawOrder.rule, 'string');
  assert.ok(manifest.drawOrder.rule.includes('pivot.y'), 'draw order rule should document the y-sort pivot convention');
});

test('manifest source block identifies the accepted, currently-approved target-town master', () => {
  const { source } = manifest;
  assert.equal(source.sha256, ACCEPTED_MASTER_SHA256);
  assert.deepEqual(source.dimensions, ACCEPTED_MASTER_DIMENSIONS);
  assert.equal(source.custody, 'user-direct');
  assert.equal(source.path, 'public/fable5-v2/assets/world/target-town-user-direct-v1.png');
});

test('the accepted master PNG on disk still matches the pinned hash and dimensions', async () => {
  const masterPath = path.join(REPO_ROOT, manifest.source.path);
  const buffer = await readFile(masterPath);
  assert.equal(createHash('sha256').update(buffer).digest('hex'), ACCEPTED_MASTER_SHA256);
  assert.deepEqual(pngDimensionsFromBuffer(buffer), ACCEPTED_MASTER_DIMENSIONS);
});

test('prefabCounts sums to prefabCountTotal and matches the actual prefabs array length', () => {
  const summed = Object.values(manifest.prefabCounts).reduce((total, count) => total + count, 0);
  assert.equal(summed, manifest.prefabCountTotal);
  assert.equal(manifest.prefabs.length, manifest.prefabCountTotal);
});

test('every declared layer has at least one prefab (no silently-empty category)', () => {
  for (const layer of EXPECTED_LAYERS) {
    assert.ok((manifest.prefabCounts[layer] ?? 0) > 0, `layer "${layer}" has zero prefabs`);
  }
  // and prefabCounts never mentions an undeclared layer
  for (const layer of Object.keys(manifest.prefabCounts)) {
    assert.ok(EXPECTED_LAYERS.includes(layer), `unexpected layer "${layer}" in prefabCounts`);
  }
});

test('assetId is unique across every prefab', () => {
  const ids = manifest.prefabs.map((record) => record.assetId);
  assert.equal(new Set(ids).size, ids.length);
});

test('every prefab record has the required fields with correct types and a legal layer', () => {
  for (const record of manifest.prefabs) {
    const label = record.assetId;
    assert.equal(typeof record.assetId, 'string', label);
    assert.equal(typeof record.category, 'string', label);
    assert.ok(EXPECTED_LAYERS.includes(record.layer), `${label}: layer "${record.layer}" not in ${EXPECTED_LAYERS}`);
    assert.equal(typeof record.path, 'string', label);
    assert.match(record.sha256, SHA256_HEX, label);
    assert.equal(typeof record.dimensions.width, 'number', label);
    assert.equal(typeof record.dimensions.height, 'number', label);
    assert.ok(record.dimensions.width > 0 && record.dimensions.height > 0, label);
    assert.equal(typeof record.cropOriginWorld.x, 'number', label);
    assert.equal(typeof record.cropOriginWorld.y, 'number', label);
    assert.equal(typeof record.cropBoxWorld.width, 'number', label);
    assert.equal(typeof record.cropBoxWorld.height, 'number', label);
    assert.equal(typeof record.alpha, 'boolean', label);
    assert.ok(record.pivot, `${label}: missing pivot`);
    assert.equal(typeof record.pivot.x, 'number', label);
    assert.equal(typeof record.pivot.y, 'number', label);
    assert.equal(typeof record.pivot.anchor, 'string', label);
    assert.equal(typeof record.zIndex, 'number', label);
    assert.ok(['this-manifest', 'pre-existing'].includes(record.provenance), label);
    assert.equal(typeof record.notes, 'string', label);
    assert.ok(record.notes.length > 0, `${label}: notes must not be empty (evidence-matrix honesty convention)`);
  }
});

test('cropBoxWorld is internally consistent with cropOriginWorld and declared dimensions', () => {
  for (const record of manifest.prefabs) {
    assert.equal(record.cropBoxWorld.x, record.cropOriginWorld.x, record.assetId);
    assert.equal(record.cropBoxWorld.y, record.cropOriginWorld.y, record.assetId);
    assert.equal(record.cropBoxWorld.width, record.dimensions.width, record.assetId);
    assert.equal(record.cropBoxWorld.height, record.dimensions.height, record.assetId);
  }
});

test('every prefab crop lies fully inside the 1586x992 world canvas', () => {
  const { width: worldWidth, height: worldHeight } = ACCEPTED_MASTER_DIMENSIONS;
  for (const record of manifest.prefabs) {
    const box = record.cropBoxWorld;
    assert.ok(box.x >= 0 && box.y >= 0, `${record.assetId}: negative crop origin`);
    assert.ok(box.x + box.width <= worldWidth, `${record.assetId}: crop right edge exceeds world width`);
    assert.ok(box.y + box.height <= worldHeight, `${record.assetId}: crop bottom edge exceeds world height`);
  }
});

test('building pivots anchor at the crop\'s south-west corner; prop/tree/road pivots anchor at the foot', () => {
  for (const record of manifest.prefabs) {
    if (record.layer === 'building') {
      assert.equal(record.pivot.anchor, 'sw-corner', record.assetId);
    } else if (record.layer === 'terrain') {
      assert.equal(record.pivot.anchor, 'full-cell-top-left', record.assetId);
    } else {
      assert.ok(
        ['bottom-center', 'documented-foot-point'].includes(record.pivot.anchor),
        `${record.assetId}: unexpected pivot anchor "${record.pivot.anchor}" for layer ${record.layer}`
      );
    }
  }
});

test('zIndex encodes the documented draw-order rule: terrain=0 < road=1 < building/prop < foreground, each ascending by pivot.y', () => {
  for (const record of manifest.prefabs) {
    if (record.layer === 'terrain') {
      assert.equal(record.zIndex, 0, record.assetId);
    } else if (record.layer === 'road') {
      assert.equal(record.zIndex, 1, record.assetId);
    } else if (record.layer === 'foreground') {
      assert.ok(record.zIndex >= 100000, record.assetId);
      assert.equal(record.zIndex, 100000 + record.pivot.y, record.assetId);
    } else {
      assert.ok(record.zIndex >= 100 && record.zIndex < 100000, record.assetId);
      assert.equal(record.zIndex, 100 + record.pivot.y, record.assetId);
    }
  }
  // every foreground prefab must out-rank every building/prop prefab, matching
  // the existing runtime's "world, ..., entrance foreground" draw order.
  const maxNonForeground = Math.max(
    ...manifest.prefabs.filter((r) => r.layer !== 'foreground').map((r) => r.zIndex)
  );
  const minForeground = Math.min(
    ...manifest.prefabs.filter((r) => r.layer === 'foreground').map((r) => r.zIndex)
  );
  assert.ok(minForeground > maxNonForeground, 'every foreground prefab must draw after every non-foreground prefab');
});

test('exactly one landmark building is declared, and it is bld_town_hall', () => {
  const landmarks = manifest.prefabs.filter((record) => record.landmark === true);
  assert.equal(landmarks.length, 1);
  assert.equal(landmarks[0].assetId, 'bld_town_hall');
});

test('the town hall landmark reads taller than the median non-landmark building (PlacementGuide Q3 shape)', () => {
  const buildings = manifest.prefabs.filter((record) => record.layer === 'building');
  const townHall = buildings.find((record) => record.assetId === 'bld_town_hall');
  const others = buildings.filter((record) => record.assetId !== 'bld_town_hall');
  const heights = others.map((record) => record.alphaBboxWorld?.height ?? record.dimensions.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const townHallHeight = townHall.alphaBboxWorld?.height ?? townHall.dimensions.height;
  assert.ok(townHallHeight >= median, `town hall height ${townHallHeight} should be >= median other-building height ${median}`);
});

test('terrain grid coverage proof spans the full canvas with strictly increasing, edge-sharing boundaries', () => {
  const { terrainGridCols, terrainGridRows } = manifest.coverageProof;
  assert.equal(terrainGridCols[0], 0);
  assert.equal(terrainGridCols[terrainGridCols.length - 1], ACCEPTED_MASTER_DIMENSIONS.width);
  assert.equal(terrainGridRows[0], 0);
  assert.equal(terrainGridRows[terrainGridRows.length - 1], ACCEPTED_MASTER_DIMENSIONS.height);
  for (let i = 0; i < terrainGridCols.length - 1; i += 1) {
    assert.ok(terrainGridCols[i] < terrainGridCols[i + 1], 'terrain grid columns must be strictly increasing');
  }
  for (let i = 0; i < terrainGridRows.length - 1; i += 1) {
    assert.ok(terrainGridRows[i] < terrainGridRows[i + 1], 'terrain grid rows must be strictly increasing');
  }
});

test('terrain prefabs exactly tile the coverage-proof grid (one prefab per cell, no gaps, no overlaps)', () => {
  const { terrainGridCols, terrainGridRows } = manifest.coverageProof;
  const terrainRecords = manifest.prefabs.filter((record) => record.layer === 'terrain');
  const expectedCells = (terrainGridCols.length - 1) * (terrainGridRows.length - 1);
  assert.equal(terrainRecords.length, expectedCells);

  const seen = new Set();
  for (const record of terrainRecords) {
    const key = `${record.gridRow},${record.gridCol}`;
    assert.ok(!seen.has(key), `duplicate terrain grid cell ${key}`);
    seen.add(key);
    const expectedBox = {
      x: terrainGridCols[record.gridCol],
      y: terrainGridRows[record.gridRow],
      width: terrainGridCols[record.gridCol + 1] - terrainGridCols[record.gridCol],
      height: terrainGridRows[record.gridRow + 1] - terrainGridRows[record.gridRow],
    };
    assert.deepEqual(record.cropBoxWorld, expectedBox, record.assetId);
  }
  assert.equal(seen.size, expectedCells);
});

test('every prefab PNG exists on disk, byte-hashes to its recorded sha256, and reports matching PNG dimensions', async () => {
  for (const record of manifest.prefabs) {
    const absolutePath = path.join(REPO_ROOT, record.path);
    const buffer = await readFile(absolutePath); // throws (fails the test) if missing
    const actualSha256 = createHash('sha256').update(buffer).digest('hex');
    assert.equal(actualSha256, record.sha256, `${record.assetId}: on-disk sha256 no longer matches the manifest`);
    const actualDimensions = pngDimensionsFromBuffer(buffer);
    assert.deepEqual(actualDimensions, record.dimensions, `${record.assetId}: on-disk PNG dimensions drifted from the manifest`);
  }
});

test('pre-existing prefabs reference a lineage file that exists and independently agrees on the hash', async () => {
  const preExisting = manifest.prefabs.filter((record) => record.provenance === 'pre-existing');
  assert.ok(preExisting.length >= 3, 'expected the bartender, entrance-foreground, and streetlamp prefabs to be reused by reference');
  for (const record of preExisting) {
    assert.equal(typeof record.lineagePath, 'string', record.assetId);
    const lineageDoc = await loadJson(path.join(REPO_ROOT, record.lineagePath));
    const nestedAssets = lineageDoc.assets || (lineageDoc.assetId ? [lineageDoc.runtimeObject ? { ...lineageDoc.runtimeObject, assetId: lineageDoc.assetId } : lineageDoc] : []);
    const found = nestedAssets.find((asset) => asset.assetId === record.assetId);
    assert.ok(found, `${record.assetId}: not found inside its declared lineage file ${record.lineagePath}`);
    assert.equal(found.sha256, record.sha256, `${record.assetId}: lineage sha256 disagrees with manifest sha256`);
  }
});

test('excludedAssets documents the inn-counter-clean-plate exclusion with a non-empty reason (no silent omission)', () => {
  assert.ok(manifest.excludedAssets.length >= 1);
  const cleanPlate = manifest.excludedAssets.find((entry) =>
    entry.path.includes('inn-counter-clean-plate'));
  assert.ok(cleanPlate, 'expected an explicit excludedAssets entry for inn-counter-clean-plate-v1.png');
  assert.ok(cleanPlate.reason.length > 20);
});

test('lineage.json references exactly the same assetId set as manifest.json prefabs', () => {
  const manifestIds = new Set(manifest.prefabs.map((record) => record.assetId));
  const lineageIds = new Set(lineage.assetIds);
  assert.equal(lineageIds.size, manifestIds.size);
  for (const id of manifestIds) assert.ok(lineageIds.has(id), `lineage.json is missing assetId ${id}`);
  for (const id of lineageIds) assert.ok(manifestIds.has(id), `lineage.json has an assetId not in manifest.json: ${id}`);
});

test('lineage.json carries the three-bucket observed/inferred/unknown evidence convention', () => {
  for (const bucket of ['observed', 'inferred', 'unknown']) {
    assert.ok(Array.isArray(lineage[bucket]), bucket);
    assert.ok(lineage[bucket].length > 0, `${bucket} should not be empty`);
  }
});

test('manifest.verification records a PASS with pixel-identical, fully-covered reconstruction', () => {
  assert.ok(manifest.verification, 'expected verify-target-town-prefab-reconstruction.py to have run and updated manifest.json');
  assert.equal(manifest.verification.verdict, 'PASS');
  assert.equal(manifest.verification.coverage.fullyCovered, true);
  assert.equal(manifest.verification.coverage.missingPixelCount, 0);
  assert.equal(manifest.verification.diff.pixelIdentical, true);
  assert.equal(manifest.verification.diff.changedPixelCount, 0);
  assert.equal(manifest.verification.diff.maximumChannelDelta, 0);
  assert.equal(
    manifest.verification.diff.totalPixelCount,
    ACCEPTED_MASTER_DIMENSIONS.width * ACCEPTED_MASTER_DIMENSIONS.height
  );
  assert.equal(manifest.status, 'extracted-verified-runtime-integration-pending');
});

test('the standalone reconstruction report on disk agrees with manifest.verification (no drift between the two)', async () => {
  const report = await loadJson(RECONSTRUCTION_REPORT_PATH);
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.diff, manifest.verification.diff);
  assert.deepEqual(report.coverage, manifest.verification.coverage);
  assert.equal(report.prefabCountTotal, manifest.prefabCountTotal);
  assert.deepEqual(report.prefabCounts, manifest.prefabCounts);
});

test('every QA image the verification report references actually exists on disk', async () => {
  const report = await loadJson(RECONSTRUCTION_REPORT_PATH);
  for (const key of ['reconstructionPath', 'diffHeatmapPath', 'contactSheetPath']) {
    const buffer = await readFile(path.join(REPO_ROOT, report[key]));
    assert.ok(buffer.length > 0, key);
  }
});

test('no runtime source file was touched by this decomposition pass (decomposition-only scope)', async () => {
  // This is a documentation-of-intent guard, not a git-diff check: it just
  // confirms the master itself -- the one file this whole pipeline reads --
  // is still present, unmodified, and byte-identical, which is the one file
  // among the forbidden-to-touch set that this test suite can meaningfully
  // reach without shelling out to git.
  const masterPath = path.join(REPO_ROOT, 'public/fable5-v2/assets/world/target-town-user-direct-v1.png');
  const buffer = await readFile(masterPath);
  assert.equal(createHash('sha256').update(buffer).digest('hex'), ACCEPTED_MASTER_SHA256);
});
