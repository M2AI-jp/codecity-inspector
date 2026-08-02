import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import test from 'node:test';
import {
  PixelArtGateError,
  assertPixelArtGate,
  formatPixelArtGateReport,
  runPixelArtGate
} from './index.mjs';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function rgbaPng(width, height, pixelAt) {
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) raw.push(...pixelAt(x, y));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.from(raw))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const LIGHT = [30, 20, 20, 255];
const DARK = [10, 15, 20, 255];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-pixel-gate-'));
  const candidates = path.join(root, 'candidates');
  fs.mkdirSync(candidates, { recursive: true });
  const colors = ['#1E1414', '#0A0F14'];
  for (let index = colors.length; index < 32; index += 1) {
    const value = (index + 20).toString(16).padStart(2, '0');
    colors.push(`#${value}3038`);
  }
  const palettePath = path.join(root, 'palette.json');
  fs.writeFileSync(palettePath, JSON.stringify({ id: 'test-palette', colors }, null, 2));
  return { root, candidates, palettePath };
}

function writeBuilding(workspace, name = 'building') {
  const pngPath = path.join(workspace.candidates, `${name}.png`);
  const specPath = path.join(workspace.candidates, `${name}.json`);
  fs.writeFileSync(pngPath, rgbaPng(4, 4, (x, y) => (x < 2 && y < 2 ? LIGHT : DARK)));
  fs.writeFileSync(specPath, JSON.stringify({ id: `${name}-v1`, kind: 'building', dimensions: { width: 4, height: 4 }, paletteId: 'test-palette' }, null, 2));
  return { pngPath, specPath };
}

test('a fully specified building candidate passes without changing candidate bytes', () => {
  const workspace = makeWorkspace();
  const { pngPath } = writeBuilding(workspace);
  const before = fs.readFileSync(pngPath);
  const beforeHash = crypto.createHash('sha256').update(before).digest('hex');
  const report = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath });
  assert.equal(report.ok, true);
  assert.equal(report.status, 'passed');
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].ok, true);
  assert.deepEqual(report.candidates[0].unknown, []);
  assert.equal(report.candidates[0].observed.sha256, beforeHash);
  assert.deepEqual(fs.readFileSync(pngPath), before);
  assert.equal(Object.prototype.hasOwnProperty.call(report, 'approval'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report.candidates[0], 'approval'), false);
});

test('absent or empty candidate trees are idle and do not read a palette', () => {
  const workspace = makeWorkspace();
  const report = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: path.join(workspace.root, 'missing-palette.json') });
  assert.equal(report.ok, false);
  assert.equal(report.status, 'idle');
  assert.equal(report.assetPass, false);
  assert.equal(report.submitted, false);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.unknown, []);
  assert.equal(report.palette.required, false);
  assert.equal(report.palette.state, 'not-required');
  assert.match(formatPixelArtGateReport(report), /no candidate PNG work item was submitted/);

  const absent = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: path.join(workspace.root, 'absent-candidates'), palettePath: path.join(workspace.root, 'missing-palette.json') });
  assert.equal(absent.status, 'idle');
  assert.deepEqual(absent.failures, []);
  assert.equal(absent.observed.inspectedCandidateCount, 0);
});

test('a submitted PNG requires the explicit palette before asset inspection can pass', () => {
  const workspace = makeWorkspace();
  writeBuilding(workspace, 'submitted');
  const report = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: path.join(workspace.root, 'missing-palette.json') });
  assert.equal(report.ok, false);
  assert.equal(report.status, 'failed');
  assert.equal(report.submitted, true);
  assert.equal(report.assetPass, false);
  assert.equal(report.palette.required, true);
  assert.equal(report.palette.state, 'unknown');
  assert.ok(report.failures.some(({ code }) => code === 'PALETTE_READ_FAILED'));
  assert.equal(report.candidates.length, 1);
  assert.ok(report.candidates[0].failures.some(({ code }) => code === 'G1_PALETTE_OUTSIDE'));
});

test('missing or ambiguous sidecar metadata fails closed and preserves observed byte evidence', () => {
  const workspace = makeWorkspace();
  const { pngPath } = writeBuilding(workspace, 'orphan');
  fs.unlinkSync(path.join(workspace.candidates, 'orphan.json'));
  const report = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(({ code }) => code === 'SPEC_MISSING'));
  assert.equal(typeof report.candidates[0].observed.sha256, 'string');
  assert.ok(report.candidates[0].unknown.some(({ code }) => code === 'G2_UNKNOWN'));

  fs.writeFileSync(path.join(workspace.candidates, 'orphan.spec.json'), JSON.stringify({ id: 'orphan-v1', kind: 'building', dimensions: { width: 4, height: 4 }, paletteId: 'test-palette' }));
  fs.writeFileSync(path.join(workspace.candidates, 'spec.json'), JSON.stringify({ id: 'orphan-v1', kind: 'building', dimensions: { width: 4, height: 4 }, paletteId: 'test-palette' }));
  const ambiguous = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath });
  assert.ok(ambiguous.failures.some(({ code }) => code === 'SPEC_AMBIGUOUS'));
  assert.equal(fs.existsSync(pngPath), true);
});

test('G1/G3/G4/G5/G7/G9 reject byte-level violations', () => {
  const workspace = makeWorkspace();
  const pngPath = path.join(workspace.candidates, 'bad.png');
  fs.writeFileSync(pngPath, rgbaPng(3, 2, (x, y) => x === 0 && y === 0 ? [0, 0, 0, 255] : x === 1 && y === 0 ? [255, 255, 255, 255] : x === 2 && y === 0 ? [220, 10, 220, 255] : [30, 20, 20, x === 1 && y === 1 ? 128 : 255]));
  fs.writeFileSync(path.join(workspace.candidates, 'bad.json'), JSON.stringify({ id: 'bad-v1', kind: 'building', dimensions: { width: 4, height: 4 }, paletteId: 'test-palette' }));
  const report = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath });
  const candidate = report.candidates[0];
  assert.equal(report.ok, false);
  for (const code of ['G1_PALETTE_OUTSIDE', 'G3_SEMITRANSPARENT', 'G4_PURE_BLACK', 'G5_PURE_WHITE', 'G7_PINK_RESIDUE', 'G9_DIMENSIONS']) assert.ok(candidate.failures.some((failure) => failure.code === code), code);
});

test('character and tile metadata are required for C1-C6 and G10; unknown is not promoted', () => {
  const workspace = makeWorkspace();
  writeBuilding(workspace, 'character');
  const characterSpec = path.join(workspace.candidates, 'character.json');
  fs.writeFileSync(characterSpec, JSON.stringify({ id: 'character-v1', kind: 'character', dimensions: { width: 4, height: 4 }, paletteId: 'test-palette' }));
  const report = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath });
  const character = report.candidates.find(({ path: candidatePath }) => candidatePath === 'character.png');
  assert.equal(character.ok, false);
  assert.ok(character.failures.some(({ code }) => code === 'CHARACTER_SPEC_MISSING' || code === 'CHARACTER_FRAME_SPEC_MISSING'));
  assert.ok(character.unknown.some(({ code }) => code === 'C1_UNKNOWN'));

  writeBuilding(workspace, 'tile');
  fs.writeFileSync(path.join(workspace.candidates, 'tile.json'), JSON.stringify({ id: 'tile-v1', kind: 'tile', dimensions: { width: 4, height: 4 }, paletteId: 'test-palette' }));
  const tileReport = runPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath });
  const tile = tileReport.candidates.find(({ path: candidatePath }) => candidatePath === 'tile.png');
  assert.ok(tile.failures.some(({ code }) => code === 'TILE_SEAM_SPEC_MISSING'));
  assert.ok(tile.unknown.some(({ code }) => code === 'G10_UNKNOWN'));
});

test('assertPixelArtGate exposes the report but never turns a failed gate into approval', () => {
  const workspace = makeWorkspace();
  assert.throws(() => assertPixelArtGate({ repositoryRoot: workspace.root, candidatesRoot: workspace.candidates, palettePath: workspace.palettePath }), (error) => {
    assert.ok(error instanceof PixelArtGateError);
    assert.equal(error.code, 'PIXEL_ART_GATE_FAILED');
    assert.equal(error.report.ok, false);
    return true;
  });
  assert.equal(fs.readdirSync(workspace.candidates).length, 0);
});

test('CLI returns zero for idle candidate inspection and supports machine-readable evidence', () => {
  const workspace = makeWorkspace();
  const cliPath = path.resolve('studio/quality/gates/check-pixel-art.mjs');
  const result = spawnSync(process.execPath, [cliPath, '--root', workspace.root, '--candidates', workspace.candidates, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.status, 'idle');
  assert.equal(report.assetPass, false);
  assert.deepEqual(report.failures, []);
  assert.equal(report.palette.state, 'not-required');
});
