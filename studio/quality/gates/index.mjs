import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/**
 * Pixel-art acceptance gates from MASTER.md §10/§14 (G1-G10 and C1-C6).
 *
 * This module is deliberately a read-only verifier.  It reads candidate PNG
 * bytes and explicit JSON metadata, and returns evidence.  It never writes,
 * copies, promotes, approves, or mutates an asset.
 */

export const PIXEL_ART_GATE_VERSION = '1.0.0';
export const DEFAULT_CANDIDATES_RELATIVE_ROOT = 'studio/art-department/candidates';
export const DEFAULT_PALETTE_RELATIVE_PATH = 'studio/art-department/authority/palette-v1.json';

export const DEFAULT_GATE_LIMITS = Object.freeze({
  paletteMinColors: 32,
  paletteMaxColors: 48,
  characterMaxColors: 16,
  buildingMaxColors: 24,
  tileMaxColors: 16,
  isolatedPixelRatio: 0.02,
  characterHeadRatio: Object.freeze({ min: 2.7, max: 3.2 }),
  runSilhouetteChange: Object.freeze({ min: 0.25, max: 0.45 }),
  walkSilhouetteChange: Object.freeze({ min: 0.20, max: 0.30 }),
  runHeadTopChange: 0.10,
  walkHeadTopChange: 0.05
});

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_BYTES = 64 * 1024 * 1024;
const MAX_PNG_DIMENSION = 8192;
const MAX_PNG_PIXELS = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const RELATIVE_PATH_RE = /^(?!$)(?![/.])[^/]+(?:\/[^/]+)*$/;

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = PNG_CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeLimits(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...DEFAULT_GATE_LIMITS,
    ...source,
    characterHeadRatio: { ...DEFAULT_GATE_LIMITS.characterHeadRatio, ...(source.characterHeadRatio ?? {}) },
    runSilhouetteChange: { ...DEFAULT_GATE_LIMITS.runSilhouetteChange, ...(source.runSilhouetteChange ?? {}) },
    walkSilhouetteChange: { ...DEFAULT_GATE_LIMITS.walkSilhouetteChange, ...(source.walkSilhouetteChange ?? {}) }
  };
}

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function issue(code, message, field = '$', severity = 'error', details = {}) {
  return { code, message, field, severity, ...details };
}

class PngGateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PngGateError';
    this.code = code;
    Object.assign(this, details);
  }
}

function readChunk(bytes, offset) {
  if (offset + 12 > bytes.length) throw new PngGateError('PNG_TRUNCATED', 'PNG chunk header is truncated');
  const length = bytes.readUInt32BE(offset);
  if (length > MAX_PNG_BYTES || offset + 12 + length > bytes.length) throw new PngGateError('PNG_TRUNCATED', 'PNG chunk exceeds the byte boundary');
  const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
  const data = bytes.subarray(offset + 8, offset + 8 + length);
  const expected = bytes.readUInt32BE(offset + 8 + length);
  const actual = crc32(bytes.subarray(offset + 4, offset + 8 + length));
  if (expected !== actual) throw new PngGateError('PNG_CRC_INVALID', `PNG ${type} CRC does not match`);
  return { type, data, next: offset + 12 + length };
}

function channelsForColorType(colorType) {
  return ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType] ?? null;
}

function validBitDepth(colorType, bitDepth) {
  return ({
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  })[colorType]?.includes(bitDepth) ?? false;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilterRows(inflated, rowBytes, bytesPerPixel, height) {
  const expected = height * (rowBytes + 1);
  if (inflated.length !== expected) throw new PngGateError('PNG_DATA_INVALID', 'inflated PNG data has an unexpected length');
  const rows = [];
  let offset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[offset];
    offset += 1;
    const encoded = inflated.subarray(offset, offset + rowBytes);
    offset += rowBytes;
    const decoded = Buffer.alloc(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= bytesPerPixel ? decoded[index - bytesPerPixel] : 0;
      const above = previous[index] ?? 0;
      const aboveLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      const value = encoded[index];
      if (filter === 0) decoded[index] = value;
      else if (filter === 1) decoded[index] = (value + left) & 0xff;
      else if (filter === 2) decoded[index] = (value + above) & 0xff;
      else if (filter === 3) decoded[index] = (value + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) decoded[index] = (value + paeth(left, above, aboveLeft)) & 0xff;
      else throw new PngGateError('PNG_FILTER_INVALID', `unsupported PNG filter ${filter}`);
    }
    rows.push(decoded);
    previous = decoded;
  }
  return rows;
}

function sampleFromPacked(row, index, bitDepth) {
  const bit = index * bitDepth;
  const byte = row[Math.floor(bit / 8)];
  const shift = 8 - bitDepth - (bit % 8);
  return (byte >>> shift) & ((1 << bitDepth) - 1);
}

function sampleScale(value, bitDepth) {
  if (bitDepth === 8) return value;
  if (bitDepth === 16) return Math.round(value / 257);
  return Math.round((value * 255) / ((1 << bitDepth) - 1));
}

function parsePngBytes(bytes, source = '<bytes>') {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const byteLength = bytes.length;
  const base = { source, byteLength, sha256: hashBytes(bytes) };
  if (bytes.length > MAX_PNG_BYTES) throw new PngGateError('PNG_TOO_LARGE', 'PNG exceeds the 64 MiB inspection budget', base);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new PngGateError('PNG_SIGNATURE_INVALID', 'PNG signature is invalid', base);
  let offset = 8;
  let ihdr = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  let sawIend = false;
  while (offset < bytes.length) {
    const chunk = readChunk(bytes, offset);
    offset = chunk.next;
    if (!ihdr && chunk.type !== 'IHDR') throw new PngGateError('PNG_STRUCTURE_INVALID', 'PNG IHDR must be the first chunk', base);
    if (chunk.type === 'IHDR') {
      if (ihdr) throw new PngGateError('PNG_STRUCTURE_INVALID', 'PNG contains more than one IHDR', base);
      if (chunk.data.length !== 13) throw new PngGateError('PNG_STRUCTURE_INVALID', 'PNG IHDR length is invalid', base);
      ihdr = {
        width: chunk.data.readUInt32BE(0),
        height: chunk.data.readUInt32BE(4),
        bitDepth: chunk.data[8],
        colorType: chunk.data[9],
        compression: chunk.data[10],
        filter: chunk.data[11],
        interlace: chunk.data[12]
      };
    } else if (chunk.type === 'PLTE') palette = Buffer.from(chunk.data);
    else if (chunk.type === 'tRNS') transparency = Buffer.from(chunk.data);
    else if (chunk.type === 'IDAT') idat.push(chunk.data);
    else if (chunk.type === 'IEND') {
      if (chunk.data.length !== 0) throw new PngGateError('PNG_STRUCTURE_INVALID', 'PNG IEND must be empty', base);
      sawIend = true;
      if (offset !== bytes.length) throw new PngGateError('PNG_TRAILING_DATA', 'PNG contains bytes after IEND', base);
      break;
    }
  }
  if (!ihdr || !sawIend) throw new PngGateError('PNG_STRUCTURE_INVALID', 'PNG must contain IHDR and IEND', base);
  if (!Number.isInteger(ihdr.width) || ihdr.width <= 0 || !Number.isInteger(ihdr.height) || ihdr.height <= 0 || ihdr.width > MAX_PNG_DIMENSION || ihdr.height > MAX_PNG_DIMENSION || ihdr.width * ihdr.height > MAX_PNG_PIXELS) throw new PngGateError('PNG_DIMENSIONS_INVALID', 'PNG dimensions are outside the inspection budget', { ...base, ...ihdr });
  const channels = channelsForColorType(ihdr.colorType);
  if (!channels || !validBitDepth(ihdr.colorType, ihdr.bitDepth)) throw new PngGateError('PNG_FORMAT_UNSUPPORTED', 'PNG color type and bit depth combination is unsupported', { ...base, ...ihdr });
  if (ihdr.compression !== 0 || ihdr.filter !== 0) throw new PngGateError('PNG_FORMAT_UNSUPPORTED', 'PNG compression or filter method is unsupported', { ...base, ...ihdr });
  if (ihdr.interlace !== 0) throw new PngGateError('PNG_INTERLACE_UNSUPPORTED', 'interlaced PNGs are not accepted by the byte gate', { ...base, ...ihdr });
  if (ihdr.colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) throw new PngGateError('PNG_PALETTE_MISSING', 'indexed PNG is missing a valid PLTE chunk', { ...base, ...ihdr });
  if (idat.length === 0) throw new PngGateError('PNG_DATA_MISSING', 'PNG contains no IDAT data', { ...base, ...ihdr });
  const rowBytes = Math.ceil((ihdr.width * channels * ihdr.bitDepth) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil((channels * ihdr.bitDepth) / 8));
  const expectedInflated = ihdr.height * (rowBytes + 1);
  if (expectedInflated > MAX_PNG_BYTES * 2) throw new PngGateError('PNG_TOO_LARGE', 'PNG scanlines exceed the inspection budget', { ...base, ...ihdr });
  let inflated;
  try { inflated = zlib.inflateSync(Buffer.concat(idat)); } catch (error) { throw new PngGateError('PNG_DATA_INVALID', `PNG IDAT could not be inflated: ${error.message}`, { ...base, ...ihdr }); }
  const rows = unfilterRows(inflated, rowBytes, bytesPerPixel, ihdr.height);
  const pixels = new Array(ihdr.width * ihdr.height);
  const maxPaletteEntries = palette ? Math.floor(palette.length / 3) : 0;
  const trnsGray = transparency && transparency.length >= 2 ? transparency.readUInt16BE(0) : null;
  const trnsRgb = transparency && transparency.length >= 6 ? [transparency.readUInt16BE(0), transparency.readUInt16BE(2), transparency.readUInt16BE(4)] : null;
  const scale = ihdr.bitDepth === 16 ? 2 : 1;
  for (let y = 0; y < ihdr.height; y += 1) {
    const row = rows[y];
    let byteOffset = 0;
    for (let x = 0; x < ihdr.width; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 255;
      if (ihdr.colorType === 0) {
        const raw = ihdr.bitDepth < 8 ? sampleFromPacked(row, x, ihdr.bitDepth) : ihdr.bitDepth === 8 ? row[byteOffset] : row.readUInt16BE(byteOffset);
        byteOffset += scale;
        const gray = sampleScale(raw, ihdr.bitDepth);
        r = gray; g = gray; b = gray;
        if (trnsGray !== null && raw === trnsGray) a = 0;
      } else if (ihdr.colorType === 2) {
        const rawR = ihdr.bitDepth === 8 ? row[byteOffset] : row.readUInt16BE(byteOffset);
        const rawG = ihdr.bitDepth === 8 ? row[byteOffset + scale] : row.readUInt16BE(byteOffset + 2);
        const rawB = ihdr.bitDepth === 8 ? row[byteOffset + scale * 2] : row.readUInt16BE(byteOffset + 4);
        byteOffset += scale * 3;
        r = sampleScale(rawR, ihdr.bitDepth); g = sampleScale(rawG, ihdr.bitDepth); b = sampleScale(rawB, ihdr.bitDepth);
        if (trnsRgb && rawR === trnsRgb[0] && rawG === trnsRgb[1] && rawB === trnsRgb[2]) a = 0;
      } else if (ihdr.colorType === 3) {
        const paletteIndex = ihdr.bitDepth < 8 ? sampleFromPacked(row, x, ihdr.bitDepth) : row[byteOffset++];
        if (paletteIndex >= maxPaletteEntries) throw new PngGateError('PNG_PALETTE_INDEX_INVALID', 'indexed PNG references a palette entry that does not exist', { ...base, ...ihdr });
        r = palette[paletteIndex * 3]; g = palette[paletteIndex * 3 + 1]; b = palette[paletteIndex * 3 + 2];
        if (transparency && paletteIndex < transparency.length) a = transparency[paletteIndex];
      } else if (ihdr.colorType === 4) {
        const rawGray = ihdr.bitDepth === 8 ? row[byteOffset] : row.readUInt16BE(byteOffset);
        const rawAlpha = ihdr.bitDepth === 8 ? row[byteOffset + scale] : row.readUInt16BE(byteOffset + 2);
        byteOffset += scale * 2;
        r = sampleScale(rawGray, ihdr.bitDepth); g = r; b = r; a = sampleScale(rawAlpha, ihdr.bitDepth);
      } else if (ihdr.colorType === 6) {
        const rawR = ihdr.bitDepth === 8 ? row[byteOffset] : row.readUInt16BE(byteOffset);
        const rawG = ihdr.bitDepth === 8 ? row[byteOffset + scale] : row.readUInt16BE(byteOffset + 2);
        const rawB = ihdr.bitDepth === 8 ? row[byteOffset + scale * 2] : row.readUInt16BE(byteOffset + 4);
        const rawA = ihdr.bitDepth === 8 ? row[byteOffset + scale * 3] : row.readUInt16BE(byteOffset + 6);
        byteOffset += scale * 4;
        r = sampleScale(rawR, ihdr.bitDepth); g = sampleScale(rawG, ihdr.bitDepth); b = sampleScale(rawB, ihdr.bitDepth); a = sampleScale(rawA, ihdr.bitDepth);
      }
      pixels[y * ihdr.width + x] = { r, g, b, a };
    }
  }
  return { ...base, ...ihdr, pixels };
}

function parseJsonFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > MAX_METADATA_BYTES) throw new Error(`metadata exceeds ${MAX_METADATA_BYTES} bytes`);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`metadata JSON is invalid: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata must be a JSON object');
  return value;
}

function regularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  return stat;
}

function normalizedRoot(root, label) {
  const absolute = path.resolve(root);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory`);
  return absolute;
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function relativeMetadataPath(root, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || !RELATIVE_PATH_RE.test(value)) throw new Error('metadata path must be a safe relative POSIX path');
  const absolute = path.resolve(root, value);
  if (!insideRoot(root, absolute)) throw new Error('metadata path escapes the candidates root');
  return absolute;
}

function canonicalKind(rawKind) {
  const kind = typeof rawKind === 'string' ? rawKind.trim().toLowerCase() : '';
  if (['character', 'player', 'npc', 'actor'].includes(kind)) return 'character';
  if (['building', 'room', 'structure'].includes(kind)) return 'building';
  if (['tile', 'terrain', 'water', 'road', 'ground'].includes(kind)) return 'tile';
  if (['ui', 'interface'].includes(kind)) return 'ui';
  if (['prop', 'object', 'effect', 'light'].includes(kind)) return 'prop';
  return null;
}

function readDimensions(spec) {
  const dimensions = spec?.dimensions && typeof spec.dimensions === 'object' ? spec.dimensions : spec;
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null;
  return { width, height };
}

function normalizePalette(value, source = '<palette>') {
  const failures = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { palette: null, failures: [issue('PALETTE_INVALID', 'palette metadata must be an object', '$')] };
  if (typeof value.id !== 'string' || value.id.trim() === '') failures.push(issue('PALETTE_ID_MISSING', 'palette.id is required', 'id'));
  if (!Array.isArray(value.colors)) failures.push(issue('PALETTE_COLORS_MISSING', 'palette.colors is required', 'colors'));
  const colors = Array.isArray(value.colors) ? value.colors.map((color, index) => {
    if (typeof color !== 'string' || !HEX_COLOR_RE.test(color)) {
      failures.push(issue('PALETTE_COLOR_INVALID', 'palette colors must be #RRGGBB strings', `colors[${index}]`));
      return null;
    }
    return color.toUpperCase();
  }).filter(Boolean) : [];
  const unique = new Set(colors);
  if (unique.size !== colors.length) failures.push(issue('PALETTE_DUPLICATE_COLOR', 'palette colors must be unique', 'colors'));
  if (colors.length < DEFAULT_GATE_LIMITS.paletteMinColors || colors.length > DEFAULT_GATE_LIMITS.paletteMaxColors) failures.push(issue('PALETTE_CARDINALITY', `palette must contain ${DEFAULT_GATE_LIMITS.paletteMinColors}-${DEFAULT_GATE_LIMITS.paletteMaxColors} colors`, 'colors', 'error', { actual: colors.length }));
  const pureBlack = colors.includes('#000000');
  const pureWhite = colors.includes('#FFFFFF');
  if (pureBlack) failures.push(issue('PALETTE_PURE_BLACK', 'palette must not contain pure black', 'colors'));
  if (pureWhite) failures.push(issue('PALETTE_PURE_WHITE', 'palette must not contain pure white', 'colors'));
  return {
    palette: freezeDeep({ id: typeof value.id === 'string' ? value.id : null, colors, source }),
    failures
  };
}

function normalizeSpec(value, source = '<spec>') {
  const failures = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { spec: null, failures: [issue('SPEC_INVALID', 'candidate metadata must be an object', '$')] };
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : null;
  const kind = canonicalKind(value.kind ?? value.type ?? value.role);
  const dimensions = readDimensions(value);
  const paletteId = typeof value.paletteId === 'string' && value.paletteId.trim() ? value.paletteId.trim() : null;
  if (!id) failures.push(issue('SPEC_ID_MISSING', 'candidate spec.id is required', 'id'));
  if (!kind) failures.push(issue('SPEC_KIND_MISSING', 'candidate spec.kind must identify a supported asset kind', 'kind'));
  if (!dimensions) failures.push(issue('SPEC_DIMENSIONS_MISSING', 'candidate dimensions.width and dimensions.height are required', 'dimensions'));
  if (!paletteId) failures.push(issue('SPEC_PALETTE_MISSING', 'candidate spec.paletteId is required', 'paletteId'));
  if (Object.prototype.hasOwnProperty.call(value, 'maxColors') && (!Number.isInteger(value.maxColors) || value.maxColors <= 0)) failures.push(issue('SPEC_MAX_COLORS_INVALID', 'spec.maxColors must be a positive integer when supplied', 'maxColors'));
  const normalized = {
    id, kind, width: dimensions?.width ?? null, height: dimensions?.height ?? null,
    paletteId, maxColors: Number.isInteger(value.maxColors) && value.maxColors > 0 ? value.maxColors : null,
    character: value.character ?? null, tile: value.tile ?? null,
    source, asset: typeof value.asset === 'string' ? value.asset : null
  };
  if (kind === 'character') {
    if (!value.character || typeof value.character !== 'object' || Array.isArray(value.character)) failures.push(issue('CHARACTER_SPEC_MISSING', 'character metadata is required for C1-C6', 'character'));
    else {
      const frame = value.character.frame;
      if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || !Number.isInteger(frame.columns) || !Number.isInteger(frame.rows) || frame.width <= 0 || frame.height <= 0 || frame.columns <= 0 || frame.rows <= 0) failures.push(issue('CHARACTER_FRAME_SPEC_MISSING', 'character.frame width/height/columns/rows are required', 'character.frame'));
      const animations = value.character.animations;
      if (!animations || typeof animations !== 'object' || !Array.isArray(animations.walk?.rows) || !Array.isArray(animations.run?.rows)) failures.push(issue('CHARACTER_ANIMATION_SPEC_MISSING', 'character.animations.walk.rows and run.rows are required', 'character.animations'));
    }
  }
  if (kind === 'tile') {
    const neighbors = value.tile?.neighbors ?? value.seamNeighbors;
    if (!Array.isArray(neighbors) || neighbors.length === 0) failures.push(issue('TILE_SEAM_SPEC_MISSING', 'tile.neighbors is required for G10 seam inspection', 'tile.neighbors'));
  }
  return { spec: freezeDeep(normalized), failures };
}

function rgbaKey(pixel) { return `${pixel.r},${pixel.g},${pixel.b},${pixel.a}`; }
function rgbKey(pixel) { return `${pixel.r},${pixel.g},${pixel.b}`; }
function brightness(pixel) { return pixel.r * 0.299 + pixel.g * 0.587 + pixel.b * 0.114; }

function inspectGenericChecks(parsed, spec, palette, limits = DEFAULT_GATE_LIMITS) {
  const observed = {
    dimensions: parsed ? { width: parsed.width, height: parsed.height } : null,
    byteLength: parsed?.byteLength ?? null,
    sha256: parsed?.sha256 ?? null,
    colors: null,
    transparentPixels: null,
    semiTransparentPixels: null,
    pureBlackPixels: null,
    pureWhitePixels: null,
    paletteOutsidePixels: null,
    pinkPixels: null,
    isolatedPixels: null,
    opaquePixels: null,
    lightTopLeftAverage: null,
    lightBottomRightAverage: null
  };
  const inferred = { kind: spec?.kind ?? null, limits: null };
  const unknown = [];
  const failures = [];
  const checks = [];
  const check = (id, state, message, details = {}) => checks.push({ id, state, message, ...details });
  if (!parsed) {
    for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9']) {
      unknown.push(issue(`${id}_UNKNOWN`, 'PNG bytes could not be decoded', id, 'unknown'));
      check(id, 'unknown', 'PNG bytes could not be decoded');
    }
    if (spec?.kind === 'tile') { unknown.push(issue('G10_UNKNOWN', 'tile seam bytes could not be inspected', 'G10', 'unknown')); check('G10', 'unknown', 'tile seam bytes could not be inspected'); }
    return { observed, inferred, unknown, failures, checks };
  }
  const pixels = parsed.pixels;
  const paletteSet = new Set((palette?.colors ?? []).map((hex) => hex.slice(1).match(/../g).map((value) => parseInt(value, 16)).join(',')));
  const colors = new Set();
  let transparent = 0; let semi = 0; let black = 0; let white = 0; let outside = 0; let pink = 0; let opaque = 0; let isolated = 0;
  let topLeftBrightness = 0; let bottomRightBrightness = 0; let topLeftCount = 0; let bottomRightCount = 0;
  const halfWidth = parsed.width / 2; const halfHeight = parsed.height / 2;
  for (let y = 0; y < parsed.height; y += 1) {
    for (let x = 0; x < parsed.width; x += 1) {
      const pixel = pixels[y * parsed.width + x];
      if (pixel.a === 0) { transparent += 1; continue; }
      opaque += 1;
      colors.add(rgbKey(pixel));
      if (pixel.a > 0 && pixel.a < 255) semi += 1;
      if (pixel.r === 0 && pixel.g === 0 && pixel.b === 0) black += 1;
      if (pixel.r === 255 && pixel.g === 255 && pixel.b === 255) white += 1;
      if (!paletteSet.has(rgbKey(pixel))) outside += 1;
      if (pixel.r > 200 && pixel.g < 80 && pixel.b > 200) pink += 1;
      if (x < halfWidth && y < halfHeight) { topLeftBrightness += brightness(pixel); topLeftCount += 1; }
      if (x >= halfWidth && y >= halfHeight) { bottomRightBrightness += brightness(pixel); bottomRightCount += 1; }
    }
  }
  for (let y = 0; y < parsed.height; y += 1) for (let x = 0; x < parsed.width; x += 1) {
    const pixel = pixels[y * parsed.width + x];
    if (pixel.a === 0) continue;
    const same = (nx, ny) => nx >= 0 && nx < parsed.width && ny >= 0 && ny < parsed.height && rgbaKey(pixels[ny * parsed.width + nx]) === rgbaKey(pixel);
    if (!same(x - 1, y) && !same(x + 1, y) && !same(x, y - 1) && !same(x, y + 1)) isolated += 1;
  }
  observed.colors = colors.size;
  observed.transparentPixels = transparent;
  observed.semiTransparentPixels = semi;
  observed.pureBlackPixels = black;
  observed.pureWhitePixels = white;
  observed.paletteOutsidePixels = outside;
  observed.pinkPixels = pink;
  observed.isolatedPixels = isolated;
  observed.opaquePixels = opaque;
  observed.lightTopLeftAverage = topLeftCount > 0 ? topLeftBrightness / topLeftCount : null;
  observed.lightBottomRightAverage = bottomRightCount > 0 ? bottomRightBrightness / bottomRightCount : null;
  const colorLimit = spec?.maxColors ?? (spec?.kind === 'character' ? limits.characterMaxColors : spec?.kind === 'building' ? limits.buildingMaxColors : spec?.kind === 'tile' ? limits.tileMaxColors : null);
  inferred.limits = { colorLimit, isolatedPixelRatio: limits.isolatedPixelRatio };
  if (outside === 0 && palette) { check('G1', 'pass', 'all opaque pixels are in the declared palette', { observed: outside }); }
  else { failures.push(issue('G1_PALETTE_OUTSIDE', 'opaque pixels use colors outside the declared palette', 'G1', 'error', { observed: outside })); check('G1', 'fail', 'opaque pixels use colors outside the declared palette', { observed: outside }); }
  if (colorLimit !== null && observed.colors <= colorLimit) check('G2', 'pass', `opaque color count is at most ${colorLimit}`, { observed: observed.colors, limit: colorLimit });
  else if (colorLimit === null) { unknown.push(issue('G2_UNKNOWN', 'color-count limit is not defined for this asset kind', 'G2', 'unknown')); check('G2', 'unknown', 'color-count limit is not defined for this asset kind'); }
  else { failures.push(issue('G2_COLOR_COUNT', `opaque color count exceeds ${colorLimit}`, 'G2', 'error', { observed: observed.colors, limit: colorLimit })); check('G2', 'fail', `opaque color count exceeds ${colorLimit}`, { observed: observed.colors, limit: colorLimit }); }
  if (semi === 0) check('G3', 'pass', 'all alpha values are binary', { observed: semi });
  else { failures.push(issue('G3_SEMITRANSPARENT', 'semi-transparent pixels are forbidden', 'G3', 'error', { observed: semi })); check('G3', 'fail', 'semi-transparent pixels are forbidden', { observed: semi }); }
  if (black === 0) check('G4', 'pass', 'pure black is absent', { observed: black });
  else { failures.push(issue('G4_PURE_BLACK', 'pure black pixels are forbidden', 'G4', 'error', { observed: black })); check('G4', 'fail', 'pure black pixels are forbidden', { observed: black }); }
  if (white === 0) check('G5', 'pass', 'pure white is absent', { observed: white });
  else { failures.push(issue('G5_PURE_WHITE', 'pure white pixels are forbidden', 'G5', 'error', { observed: white })); check('G5', 'fail', 'pure white pixels are forbidden', { observed: white }); }
  if (topLeftCount > 0 && bottomRightCount > 0) {
    if (observed.lightTopLeftAverage > observed.lightBottomRightAverage) check('G6', 'pass', 'left/top light is brighter than right/bottom', { observed: { topLeft: observed.lightTopLeftAverage, bottomRight: observed.lightBottomRightAverage } });
    else { failures.push(issue('G6_LIGHT_DIRECTION', 'left/top light must be brighter than right/bottom', 'G6', 'error', { observed: { topLeft: observed.lightTopLeftAverage, bottomRight: observed.lightBottomRightAverage } })); check('G6', 'fail', 'left/top light must be brighter than right/bottom'); }
  } else { unknown.push(issue('G6_UNKNOWN', 'light-direction quarters contain no opaque pixels', 'G6', 'unknown')); check('G6', 'unknown', 'light-direction quarters contain no opaque pixels'); }
  if (pink === 0) check('G7', 'pass', 'pink background residue is absent', { observed: pink });
  else { failures.push(issue('G7_PINK_RESIDUE', 'pink background residue is forbidden', 'G7', 'error', { observed: pink })); check('G7', 'fail', 'pink background residue is forbidden', { observed: pink }); }
  if (opaque > 0) {
    const ratio = isolated / opaque;
    observed.isolatedPixelRatio = ratio;
    if (ratio <= limits.isolatedPixelRatio) check('G8', 'pass', 'isolated pixel ratio is within the limit', { observed: ratio, limit: limits.isolatedPixelRatio });
    else { failures.push(issue('G8_ISOLATED_PIXELS', `isolated pixel ratio exceeds ${limits.isolatedPixelRatio * 100}%`, 'G8', 'error', { observed: ratio, limit: limits.isolatedPixelRatio })); check('G8', 'fail', 'isolated pixel ratio exceeds the limit', { observed: ratio, limit: limits.isolatedPixelRatio }); }
  } else { unknown.push(issue('G8_UNKNOWN', 'PNG has no opaque pixels', 'G8', 'unknown')); check('G8', 'unknown', 'PNG has no opaque pixels'); }
  if (spec?.width === parsed.width && spec?.height === parsed.height) check('G9', 'pass', 'PNG dimensions match the explicit spec', { observed: { width: parsed.width, height: parsed.height } });
  else { failures.push(issue('G9_DIMENSIONS', 'PNG dimensions do not match the explicit spec', 'G9', 'error', { observed: { width: parsed.width, height: parsed.height }, expected: { width: spec?.width ?? null, height: spec?.height ?? null } })); check('G9', 'fail', 'PNG dimensions do not match the explicit spec'); }
  if (spec?.kind !== 'tile') check('G10', 'not_applicable', 'seam gate applies only to tiles');
  return { observed, inferred, unknown, failures, checks };
}

function framePixels(parsed, frame, index) {
  const column = index % frame.columns;
  const row = Math.floor(index / frame.columns);
  const pixels = [];
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
    const source = parsed.pixels[(row * frame.height + y) * parsed.width + column * frame.width + x];
    pixels.push(source);
  }
  return { width: frame.width, height: frame.height, pixels };
}

function opaqueBounds(frame) {
  let left = frame.width; let top = frame.height; let right = -1; let bottom = -1;
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) if (frame.pixels[y * frame.width + x].a > 0) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function maskKey(frame) { return frame.pixels.map((pixel) => pixel.a > 0 ? '1' : '0').join(''); }

function inspectCharacterChecks(parsed, spec, limits = DEFAULT_GATE_LIMITS) {
  const observed = {};
  const inferred = {};
  const unknown = [];
  const failures = [];
  const checks = [];
  const check = (id, state, message, details = {}) => checks.push({ id, state, message, ...details });
  const character = spec?.character;
  const frame = character?.frame;
  const animations = character?.animations;
  if (!frame || !animations || !Array.isArray(animations.walk?.rows) || !Array.isArray(animations.run?.rows)) {
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) { unknown.push(issue(`${id}_UNKNOWN`, 'explicit character frame/animation metadata is missing', id, 'unknown')); check(id, 'unknown', 'explicit character frame/animation metadata is missing'); }
    return { observed, inferred, unknown, failures, checks };
  }
  const expectedWidth = frame.width * frame.columns;
  const expectedHeight = frame.height * frame.rows;
  if (expectedWidth !== parsed.width || expectedHeight !== parsed.height || frame.width <= 0 || frame.height <= 0 || frame.columns <= 0 || frame.rows <= 0) {
    const detail = { expected: { width: expectedWidth, height: expectedHeight }, observed: { width: parsed.width, height: parsed.height } };
    failures.push(issue('C_FRAME_TILING', 'character frame grid does not tile the PNG', 'character.frame', 'error', detail));
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) { unknown.push(issue(`${id}_UNKNOWN`, 'character frame grid is invalid', id, 'unknown')); check(id, 'unknown', 'character frame grid is invalid'); }
    return { observed, inferred, unknown, failures, checks };
  }
  const totalFrames = frame.columns * frame.rows;
  const frames = Array.from({ length: totalFrames }, (_, index) => framePixels(parsed, frame, index));
  const bounds = frames.map(opaqueBounds);
  if (bounds.some((bound) => !bound)) {
    unknown.push(issue('C_FRAMES_EMPTY', 'every character frame needs opaque pixels', 'character.frame', 'unknown'));
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) check(id, 'unknown', 'one or more character frames are empty');
    return { observed, inferred, unknown, failures, checks };
  }
  const headHeights = bounds.map((bound, index) => {
    const explicit = character.headHeight ?? character.headBox?.height;
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const current = frames[index];
    let firstGap = -1;
    for (let y = bound.y + 1; y < bound.y + bound.height; y += 1) {
      let any = false;
      for (let x = bound.x; x < bound.x + bound.width; x += 1) if (current.pixels[y * current.width + x].a > 0) { any = true; break; }
      if (!any) { firstGap = y; break; }
    }
    return firstGap > bound.y ? firstGap - bound.y : Math.max(1, Math.round(bound.height / 3));
  });
  const headRatios = bounds.map((bound, index) => bound.height / headHeights[index]);
  observed.headRatios = headRatios;
  inferred.headHeightSource = Number.isFinite(character.headHeight ?? character.headBox?.height) ? 'declared' : 'row-gap-inference';
  const badHeadRatio = headRatios.find((ratio) => ratio < limits.characterHeadRatio.min || ratio > limits.characterHeadRatio.max);
  if (badHeadRatio === undefined) check('C1', 'pass', 'head ratio is within 2.7-3.2', { observed: headRatios, limit: limits.characterHeadRatio });
  else { failures.push(issue('C1_HEAD_RATIO', 'head ratio is outside 2.7-3.2', 'C1', 'error', { observed: headRatios, limit: limits.characterHeadRatio })); check('C1', 'fail', 'head ratio is outside 2.7-3.2', { observed: headRatios }); }
  const face = character.faceBox && typeof character.faceBox === 'object' ? character.faceBox : null;
  const eyeBoxes = Array.isArray(character.eyeBoxes) && character.eyeBoxes.length === 2 ? character.eyeBoxes : null;
  const eyeCounts = [];
  for (const [index, bound] of bounds.entries()) {
    const current = frames[index];
    if (eyeBoxes) {
      const eyePixels = eyeBoxes.map((box) => {
        if (!box || !Number.isInteger(box.x) || !Number.isInteger(box.y) || !Number.isInteger(box.width) || !Number.isInteger(box.height) || box.width <= 0 || box.height <= 0) return 0;
        let count = 0;
        for (let y = box.y; y < box.y + box.height; y += 1) for (let x = box.x; x < box.x + box.width; x += 1) if (x >= 0 && y >= 0 && x < current.width && y < current.height && current.pixels[y * current.width + x].a > 0 && brightness(current.pixels[y * current.width + x]) <= 80) count += 1;
        return count;
      });
      eyeCounts.push(eyePixels.filter((count) => count >= 2).length);
      continue;
    }
    const faceBox = face ? { x: face.x, y: face.y, width: face.width, height: face.height } : { x: bound.x, y: bound.y, width: bound.width, height: Math.max(1, Math.ceil(bound.height * 0.45)) };
    const dark = new Set();
    const threshold = 80;
    for (let y = faceBox.y; y < faceBox.y + faceBox.height; y += 1) for (let x = faceBox.x; x < faceBox.x + faceBox.width; x += 1) {
      if (x >= 0 && y >= 0 && x < current.width && y < current.height) {
        const pixel = current.pixels[y * current.width + x];
        if (pixel.a > 0 && brightness(pixel) <= threshold) dark.add(`${x},${y}`);
      }
    }
    // Count connected dark components of at least two pixels.  A component's
    // centroid is used only to verify that two eye-like marks are side by side.
    const components = [];
    while (dark.size) {
      const start = dark.values().next().value; dark.delete(start);
      const queue = [start]; const points = [];
      while (queue.length) {
        const value = queue.pop(); const [x, y] = value.split(',').map(Number); points.push({ x, y });
        for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) if (dark.delete(neighbor)) queue.push(neighbor);
      }
      if (points.length >= 2) components.push(points);
    }
    eyeCounts.push(components.filter((component) => component.length >= 2).length);
  }
  observed.eyeComponentCounts = eyeCounts;
  if (eyeCounts.every((count) => count >= 2)) check('C2', 'pass', 'each frame contains at least two dark eye marks', { observed: eyeCounts });
  else { failures.push(issue('C2_EYES', 'each frame needs two dark eye marks of at least two pixels', 'C2', 'error', { observed: eyeCounts })); check('C2', 'fail', 'each frame needs two dark eye marks of at least two pixels', { observed: eyeCounts }); }
  const footRows = bounds.map((bound) => bound.y + bound.height - 1);
  observed.footRows = footRows;
  if (new Set(footRows).size === 1) check('C3', 'pass', 'all frames share one foot row', { observed: footRows[0] });
  else { failures.push(issue('C3_FOOT_ROW', 'all frames must share one foot row', 'C3', 'error', { observed: footRows })); check('C3', 'fail', 'all frames must share one foot row', { observed: footRows }); }
  const animationRows = { walk: [...new Set(animations.walk.rows)], run: [...new Set(animations.run.rows)] };
  const animationChanges = {};
  const headTopChanges = {};
  for (const [name, rows] of Object.entries(animationRows)) {
    const indices = rows.flatMap((row) => Array.from({ length: frame.columns }, (_, column) => row * frame.columns + column)).filter((index) => index < totalFrames);
    const changes = [];
    for (let index = 1; index < indices.length; index += 1) {
      const previousMask = frames[indices[index - 1]].pixels.map((pixel) => pixel.a > 0);
      const currentMask = frames[indices[index]].pixels.map((pixel) => pixel.a > 0);
      let union = 0; let difference = 0;
      for (let pixel = 0; pixel < previousMask.length; pixel += 1) { if (previousMask[pixel] || currentMask[pixel]) union += 1; if (previousMask[pixel] !== currentMask[pixel]) difference += 1; }
      changes.push(union > 0 ? difference / union : 0);
    }
    animationChanges[name] = changes;
    const tops = indices.map((index) => bounds[index].y);
    headTopChanges[name] = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
  }
  observed.silhouetteChange = animationChanges;
  observed.headTopChange = headTopChanges;
  const ranges = { walk: limits.walkSilhouetteChange, run: limits.runSilhouetteChange };
  for (const name of ['walk', 'run']) {
    const changes = animationChanges[name];
    if (!changes?.length) { unknown.push(issue(`C4_${name.toUpperCase()}_UNKNOWN`, `${name} animation needs at least two frames`, `C4.${name}`, 'unknown')); check('C4', 'unknown', `${name} animation needs at least two frames`); continue; }
    const range = ranges[name];
    if (changes.every((value) => value >= range.min && value <= range.max)) check(`C4_${name.toUpperCase()}`, 'pass', `${name} silhouette change is within the declared range`, { observed: changes, limit: range });
    else { failures.push(issue(`C4_${name.toUpperCase()}`, `${name} silhouette change is outside the declared range`, `C4.${name}`, 'error', { observed: changes, limit: range })); check(`C4_${name.toUpperCase()}`, 'fail', `${name} silhouette change is outside the declared range`, { observed: changes, limit: range }); }
  }
  const masks = frames.map(maskKey);
  const duplicates = [];
  for (let left = 0; left < masks.length; left += 1) for (let right = left + 1; right < masks.length; right += 1) if (masks[left] === masks[right]) duplicates.push([left, right]);
  observed.duplicateSilhouettePairs = duplicates;
  if (duplicates.length === 0) check('C5', 'pass', 'no two frames share an identical silhouette');
  else { failures.push(issue('C5_DUPLICATE_SILHOUETTE', 'identical silhouette frame pairs are forbidden', 'C5', 'error', { observed: duplicates })); check('C5', 'fail', 'identical silhouette frame pairs are forbidden', { observed: duplicates }); }
  let headTopFail = false;
  for (const name of ['walk', 'run']) {
    const rows = animationRows[name];
    const threshold = (name === 'run' ? limits.runHeadTopChange : limits.walkHeadTopChange) * frame.height;
    if (!animationChanges[name]?.length) continue;
    if (headTopChanges[name] < threshold) headTopFail = true;
  }
  if (headTopFail) { failures.push(issue('C6_HEAD_TOP_CHANGE', 'head top must move by the required animation threshold', 'C6', 'error', { observed: headTopChanges })); check('C6', 'fail', 'head top must move by the required animation threshold', { observed: headTopChanges }); }
  else if (Object.values(animationChanges).some((values) => values.length)) check('C6', 'pass', 'head top movement meets the animation threshold', { observed: headTopChanges });
  else { unknown.push(issue('C6_UNKNOWN', 'head top movement could not be measured', 'C6', 'unknown')); check('C6', 'unknown', 'head top movement could not be measured'); }
  return { observed, inferred, unknown, failures, checks };
}

function inspectTileSeams(parsed, spec, candidatesRoot, pngPath) {
  const unknown = []; const failures = []; const observed = { seams: [] }; const checks = [];
  const check = (state, message, details = {}) => checks.push({ id: 'G10', state, message, ...details });
  const neighbors = spec?.tile?.neighbors ?? spec?.seamNeighbors;
  if (!Array.isArray(neighbors) || neighbors.length === 0) { unknown.push(issue('G10_UNKNOWN', 'tile.neighbors metadata is required', 'G10', 'unknown')); check('unknown', 'tile.neighbors metadata is required'); return { observed, unknown, failures, checks }; }
  for (const [index, neighbor] of neighbors.entries()) {
    if (!neighbor || typeof neighbor !== 'object' || !['left', 'right', 'top', 'bottom'].includes(neighbor.side) || typeof neighbor.path !== 'string') { failures.push(issue('G10_NEIGHBOR_SPEC', 'each tile neighbor needs side and path', `G10.neighbors[${index}]`)); continue; }
    let neighborPath;
    try { neighborPath = relativeMetadataPath(candidatesRoot, neighbor.path); } catch (error) { failures.push(issue('G10_NEIGHBOR_PATH', error.message, `G10.neighbors[${index}].path`)); continue; }
    if (!insideRoot(candidatesRoot, neighborPath)) { failures.push(issue('G10_NEIGHBOR_PATH', 'tile neighbor must remain below candidates root', `G10.neighbors[${index}].path`)); continue; }
    if (path.resolve(neighborPath) === path.resolve(pngPath)) { failures.push(issue('G10_SELF_REFERENCE', 'tile seam neighbor must not reference the candidate itself', `G10.neighbors[${index}].path`)); continue; }
    try { regularFile(neighborPath, 'tile neighbor'); } catch (error) { failures.push(issue('G10_NEIGHBOR_MISSING', error.message, `G10.neighbors[${index}].path`)); continue; }
    let neighborPng;
    try { neighborPng = parsePngBytes(fs.readFileSync(neighborPath), neighbor.path); } catch (error) { failures.push(issue('G10_NEIGHBOR_INVALID', error.message, `G10.neighbors[${index}].path`)); continue; }
    const mismatch = [];
    if (neighborPng.width !== parsed.width || neighborPng.height !== parsed.height) mismatch.push('dimensions');
    else if (neighbor.side === 'right') for (let y = 0; y < parsed.height; y += 1) if (rgbaKey(parsed.pixels[y * parsed.width + parsed.width - 1]) !== rgbaKey(neighborPng.pixels[y * neighborPng.width])) mismatch.push(`y${y}`);
    else if (neighbor.side === 'left') for (let y = 0; y < parsed.height; y += 1) if (rgbaKey(parsed.pixels[y * parsed.width]) !== rgbaKey(neighborPng.pixels[y * neighborPng.width + neighborPng.width - 1])) mismatch.push(`y${y}`);
    else if (neighbor.side === 'bottom') for (let x = 0; x < parsed.width; x += 1) if (rgbaKey(parsed.pixels[(parsed.height - 1) * parsed.width + x]) !== rgbaKey(neighborPng.pixels[x])) mismatch.push(`x${x}`);
    else if (neighbor.side === 'top') for (let x = 0; x < parsed.width; x += 1) if (rgbaKey(parsed.pixels[x]) !== rgbaKey(neighborPng.pixels[(neighborPng.height - 1) * neighborPng.width + x])) mismatch.push(`x${x}`);
    observed.seams.push({ side: neighbor.side, path: neighbor.path, mismatches: mismatch.length });
    if (mismatch.length) failures.push(issue('G10_SEAM_MISMATCH', 'tile seam boundary differs from its declared neighbor', `G10.neighbors[${index}]`, 'error', { observed: mismatch }));
  }
  if (failures.length === 0 && observed.seams.length > 0) check('pass', 'all declared tile seams match exactly', { observed: observed.seams });
  else if (failures.length > 0) check('fail', 'one or more declared tile seams differ', { observed: observed.seams });
  return { observed, unknown, failures, checks };
}

function findSpecFiles(candidatesRoot, pngPath) {
  const basename = path.basename(pngPath, path.extname(pngPath));
  const directory = path.dirname(pngPath);
  const candidates = [
    path.join(directory, `${basename}.json`),
    path.join(directory, `${basename}.spec.json`),
    path.join(directory, 'spec.json'),
    path.join(directory, 'candidate.json')
  ];
  const existing = [];
  for (const candidate of candidates) {
    if (!insideRoot(candidatesRoot, candidate)) continue;
    try { regularFile(candidate, 'candidate metadata'); existing.push(candidate); } catch (error) { if (error.code !== 'ENOENT') existing.push({ path: candidate, error }); }
  }
  return existing;
}

function inspectCandidateFile({ pngPath, candidatesRoot, palette, limits }) {
  const relativePath = path.relative(candidatesRoot, pngPath).split(path.sep).join('/');
  const observed = { path: relativePath, byteLength: null, sha256: null };
  const failures = []; const unknown = []; let parsed = null; let spec = null; let metadataPath = null;
  try { regularFile(pngPath, 'candidate PNG'); const bytes = fs.readFileSync(pngPath); observed.byteLength = bytes.length; observed.sha256 = hashBytes(bytes); parsed = parsePngBytes(bytes, relativePath); } catch (error) { failures.push(issue(error.code ?? 'PNG_READ_FAILED', error.message, relativePath)); }
  const specFiles = findSpecFiles(candidatesRoot, pngPath);
  if (specFiles.length === 0) failures.push(issue('SPEC_MISSING', 'candidate PNG has no explicit sidecar spec JSON', relativePath));
  else if (specFiles.length > 1) failures.push(issue('SPEC_AMBIGUOUS', 'candidate PNG has more than one possible sidecar spec JSON', relativePath, 'error', { paths: specFiles.map((entry) => typeof entry === 'string' ? path.relative(candidatesRoot, entry).split(path.sep).join('/') : entry.path) }));
  else if (typeof specFiles[0] === 'object') failures.push(issue('SPEC_READ_FAILED', specFiles[0].error.message, relativePath));
  else {
    metadataPath = specFiles[0];
    try { const normalized = normalizeSpec(parseJsonFile(metadataPath), path.relative(candidatesRoot, metadataPath).split(path.sep).join('/')); spec = normalized.spec; failures.push(...normalized.failures); } catch (error) { failures.push(issue('SPEC_READ_FAILED', error.message, path.relative(candidatesRoot, metadataPath).split(path.sep).join('/'))); }
  }
  if (spec?.asset && spec.asset !== relativePath) failures.push(issue('SPEC_ASSET_MISMATCH', `spec.asset ${spec.asset} does not identify this PNG`, 'asset', 'error', { observed: relativePath }));
  const generic = parsed && spec ? inspectGenericChecks(parsed, spec, palette, limits) : inspectGenericChecks(parsed, spec, palette, limits);
  failures.push(...generic.failures); unknown.push(...generic.unknown);
  if (spec && palette && spec.paletteId !== palette.id) failures.push(issue('PALETTE_ID_MISMATCH', `candidate paletteId ${spec.paletteId} does not match palette ${palette.id}`, 'paletteId'));
  if (spec?.kind === 'character' && parsed) {
    const character = inspectCharacterChecks(parsed, spec, limits); failures.push(...character.failures); unknown.push(...character.unknown); generic.checks.push(...character.checks); generic.observed.character = character.observed; generic.inferred.character = character.inferred;
  }
  if (spec?.kind === 'tile' && parsed) {
    const seams = inspectTileSeams(parsed, spec, candidatesRoot, pngPath); failures.push(...seams.failures); unknown.push(...seams.unknown); generic.checks.push(...seams.checks); generic.observed.seams = seams.observed;
  }
  return {
    path: relativePath,
    metadataPath: metadataPath ? path.relative(candidatesRoot, metadataPath).split(path.sep).join('/') : null,
    id: spec?.id ?? null,
    kind: spec?.kind ?? null,
    ok: failures.length === 0 && unknown.length === 0,
    observed: { ...observed, ...generic.observed },
    inferred: generic.inferred,
    unknown,
    failures,
    checks: generic.checks
  };
}

function listPngFiles(root) {
  const output = [];
  const visit = (directory) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) { throw new Error(`cannot read candidates directory: ${error.message}`); }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`candidate tree contains a symlink: ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) output.push(absolute);
    }
  };
  visit(root);
  return output;
}

function loadPalette(palettePath) {
  try {
    regularFile(palettePath, 'palette metadata');
    const normalized = normalizePalette(parseJsonFile(palettePath), palettePath);
    return { ...normalized, path: palettePath };
  } catch (error) {
    return { palette: null, failures: [issue('PALETTE_READ_FAILED', error.message, palettePath, 'error', { cause: error.code ?? null })] };
  }
}

function defaultRepositoryRoot() { return path.resolve(fileURLToPath(new URL('../../../', import.meta.url))); }

/** Inspect all candidate PNGs below a read-only candidate tree. */
export function runPixelArtGate({ repositoryRoot = defaultRepositoryRoot(), candidatesRoot, candidateRoot: candidateRootOption, palettePath, palette, limits = DEFAULT_GATE_LIMITS } = {}) {
  limits = normalizeLimits(limits);
  const report = {
    gateVersion: PIXEL_ART_GATE_VERSION,
    ok: false,
    status: 'failed',
    policy: 'read-only; no approval or promotion is performed',
    palette: null,
    candidates: [],
    observed: {},
    inferred: { limits },
    unknown: [],
    failures: []
  };
  let candidateRoot;
  try { candidateRoot = normalizedRoot(candidatesRoot ?? candidateRootOption ?? path.join(repositoryRoot, DEFAULT_CANDIDATES_RELATIVE_ROOT), 'candidates root'); }
  catch (error) { report.failures.push(issue('CANDIDATES_MISSING', error.message, 'candidatesRoot')); report.unknown.push(issue('CANDIDATES_UNKNOWN', 'candidate tree is unavailable', 'candidatesRoot', 'unknown')); return freezeDeep(report); }
  const paletteResult = palette
    ? normalizePalette(palette, '<inline palette>')
    : loadPalette(palettePath ?? path.join(repositoryRoot, DEFAULT_PALETTE_RELATIVE_PATH));
  report.palette = { path: path.relative(repositoryRoot, paletteResult.path ?? palettePath ?? '').split(path.sep).join('/'), id: paletteResult.palette?.id ?? null, colors: paletteResult.palette?.colors?.length ?? null, observed: Boolean(paletteResult.palette), failures: paletteResult.failures };
  report.failures.push(...(paletteResult.failures ?? []));
  if (!paletteResult.palette) report.unknown.push(issue('PALETTE_UNKNOWN', 'palette metadata is unavailable or invalid', 'palette', 'unknown'));
  let pngFiles;
  try { pngFiles = listPngFiles(candidateRoot); } catch (error) { report.failures.push(issue('CANDIDATES_READ_FAILED', error.message, 'candidatesRoot')); return freezeDeep(report); }
  if (pngFiles.length === 0) { report.failures.push(issue('CANDIDATES_EMPTY', 'no candidate PNGs were found; an empty tree is not a passing gate', 'candidatesRoot')); report.unknown.push(issue('CANDIDATES_UNKNOWN', 'there are no candidate PNG bytes to inspect', 'candidatesRoot', 'unknown')); return freezeDeep(report); }
  for (const pngPath of pngFiles) {
    const candidate = inspectCandidateFile({ pngPath, candidatesRoot: candidateRoot, palette: paletteResult.palette, limits });
    report.candidates.push(candidate);
    report.failures.push(...candidate.failures.map((entry) => ({ ...entry, candidate: candidate.path })));
    report.unknown.push(...candidate.unknown.map((entry) => ({ ...entry, candidate: candidate.path })));
  }
  report.observed.candidateCount = report.candidates.length;
  report.observed.passingCandidateCount = report.candidates.filter((candidate) => candidate.ok).length;
  report.ok = Boolean(paletteResult.palette) && report.candidates.length > 0 && report.candidates.every((candidate) => candidate.ok) && report.failures.length === 0 && report.unknown.length === 0;
  report.status = report.ok ? 'passed' : 'failed';
  return freezeDeep(report);
}

export const inspectPixelArtCandidates = runPixelArtGate;
export const inspectPixelArt = runPixelArtGate;

export class PixelArtGateError extends Error {
  constructor(report) {
    super('Pixel-art quality gate failed');
    this.name = 'PixelArtGateError';
    this.code = 'PIXEL_ART_GATE_FAILED';
    this.report = report;
  }
}

export function assertPixelArtGate(options = {}) {
  const report = runPixelArtGate(options);
  if (!report.ok) throw new PixelArtGateError(report);
  return report;
}

export function formatPixelArtGateReport(report) {
  const lines = [`pixel-art gate ${report.status} (v${report.gateVersion})`, `palette: ${report.palette?.id ?? 'unknown'} (${report.palette?.colors ?? 'unknown'} colors)`];
  if (report.candidates.length === 0) lines.push('candidates: none (not a pass)');
  else for (const candidate of report.candidates) lines.push(`${candidate.ok ? 'PASS' : 'FAIL'} ${candidate.path}${candidate.id ? ` [${candidate.id}]` : ''}: ${candidate.failures.length} failure(s), ${candidate.unknown.length} unknown(s)`);
  for (const failure of report.failures) lines.push(`ERROR ${failure.code} ${failure.candidate ? `${failure.candidate}: ` : ''}${failure.message}`);
  for (const unknown of report.unknown) lines.push(`UNKNOWN ${unknown.code} ${unknown.candidate ? `${unknown.candidate}: ` : ''}${unknown.message}`);
  return lines.join('\n');
}

export { parsePngBytes as inspectPngBytes };
