import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Load only the artwork selected by the caller's world plan. Unselected
 * manifest/provenance entries and asset files are not startup dependencies.
 */
const ASSET_MANIFEST_SCHEMA_VERSION = 2;
const ASSET_MANIFEST_FORMAT = 'codecity.asset-manifest';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SHA256_RE = /^[a-f0-9]{64}$/i;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const USAGE_KINDS = new Set(['terrain', 'water', 'road', 'building', 'room', 'character', 'prop', 'light', 'quest', 'ui', 'effect']);
const USAGE_LAYERS = new Set(['ground', 'object', 'actor', 'foreground', 'ui', 'effect']);
const DIRECTIONS = new Set(['north', 'south', 'east', 'west']);
const MAX_MANIFEST_ASSETS = 8_192;
const MAX_STRING_LENGTH = 4_096;
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const MAX_ASSET_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_MANIFEST_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ANIMATION_STATES = 16;
const MAX_ANIMATION_FRAMES = 64;

class AssetContractError extends Error {
  constructor(message, { code = 'ASSET_CONTRACT_INVALID', issues = [] } = {}) {
    super(message);
    this.name = 'AssetContractError';
    this.code = code;
    this.issues = Object.freeze([...issues]);
  }
}

function issue(pathname, message, code = 'INVALID_FIELD') {
  return { path: pathname, message, code };
}

function fail(message, options) {
  throw new AssetContractError(message, options);
}

function isObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSemver(value, field, issues) {
  if (typeof value !== 'string' || !SEMVER_RE.test(value)) {
    issues.push(issue(field, 'must be a semantic version such as 1.0.0', 'INVALID_VERSION'));
  }
}

function assertNonEmptyString(value, field, issues) {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(issue(field, 'must be a non-empty string', 'MISSING_FIELD'));
  } else if (value.length > MAX_STRING_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    issues.push(issue(field, 'must be bounded and contain no control characters', 'INVALID_STRING'));
  }
}

function assertPositiveInteger(value, field, issues) {
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(issue(field, 'must be a positive integer', 'INVALID_NUMBER'));
  }
}

function assertInteger(value, field, issues) {
  if (!Number.isInteger(value)) issues.push(issue(field, 'must be an integer', 'INVALID_NUMBER'));
}

function assertExactKeys(value, keys, field, issues, code = 'INVALID_FIELD') {
  if (!isObject(value)) return;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(issue(field, `must contain exactly ${keys.join(', ')}`, code));
  }
}

function assertRect(rect, field, issues, bounds = null) {
  if (!isObject(rect)) {
    issues.push(issue(field, 'x, y, width, and height are required', 'INVALID_RECT'));
    return;
  }
  assertExactKeys(rect, ['x', 'y', 'width', 'height'], field, issues, 'INVALID_RECT');
  for (const key of ['x', 'y']) assertInteger(rect[key], `${field}.${key}`, issues);
  for (const key of ['width', 'height']) {
    assertInteger(rect[key], `${field}.${key}`, issues);
    if (Number.isInteger(rect[key]) && rect[key] <= 0) {
      issues.push(issue(`${field}.${key}`, 'must be a positive integer', 'INVALID_RECT'));
    }
  }
  if (bounds && Number.isInteger(rect.x) && Number.isInteger(rect.y) && Number.isInteger(rect.width) && Number.isInteger(rect.height) &&
      (rect.x < 0 || rect.y < 0 || rect.x + rect.width > bounds.width || rect.y + rect.height > bounds.height)) {
    issues.push(issue(field, 'rectangle must remain inside one frame', 'RECT_OUT_OF_BOUNDS'));
  } else if (Number.isInteger(rect.x) && Number.isInteger(rect.y) && (rect.x < 0 || rect.y < 0)) {
    issues.push(issue(field, 'rectangle coordinates must be non-negative', 'RECT_OUT_OF_BOUNDS'));
  }
}

function assertUsage(usage, dimensions, field, issues) {
  if (!isObject(usage)) {
    issues.push(issue(field, 'kind, layer, frame, and collision are required', 'MISSING_USAGE'));
    return;
  }
  assertNoFallback(usage, field, issues);
  const usageKeys = usage.kind === 'character'
    ? ['kind', 'layer', 'frame', 'collision', 'animations']
    : ['kind', 'layer', 'frame', 'collision'];
  assertExactKeys(usage, usageKeys, field, issues, 'INVALID_USAGE_FIELDS');
  if (!USAGE_KINDS.has(usage.kind)) issues.push(issue(`${field}.kind`, 'unknown runtime usage kind', 'INVALID_USAGE_KIND'));
  if (!USAGE_LAYERS.has(usage.layer)) issues.push(issue(`${field}.layer`, 'unknown runtime usage layer', 'INVALID_USAGE_LAYER'));
  if (!isObject(usage.frame)) {
    issues.push(issue(`${field}.frame`, 'width, height, columns, and rows are required', 'INVALID_FRAME'));
  } else {
    assertExactKeys(usage.frame, ['width', 'height', 'columns', 'rows'], `${field}.frame`, issues, 'INVALID_FRAME');
    for (const key of ['width', 'height', 'columns', 'rows']) assertPositiveInteger(usage.frame[key], `${field}.frame.${key}`, issues);
    if (Number.isInteger(usage.frame.width) && Number.isInteger(usage.frame.columns) && usage.frame.columns > 0 && usage.frame.width * usage.frame.columns !== dimensions.width) {
      issues.push(issue(`${field}.frame.columns`, 'frame columns must tile declared width exactly', 'FRAME_TILING_MISMATCH'));
    }
    if (Number.isInteger(usage.frame.height) && Number.isInteger(usage.frame.rows) && usage.frame.rows > 0 && usage.frame.height * usage.frame.rows !== dimensions.height) {
      issues.push(issue(`${field}.frame.rows`, 'frame rows must tile declared height exactly', 'FRAME_TILING_MISMATCH'));
    }
  }

  if (!isObject(usage.collision)) {
    issues.push(issue(`${field}.collision`, 'collision must be a none, rect, or rects discriminator', 'INVALID_COLLISION'));
  } else if (usage.collision.kind === 'none') {
    assertExactKeys(usage.collision, ['kind'], `${field}.collision`, issues, 'INVALID_COLLISION');
  } else if (usage.collision.kind === 'rect') {
    const { kind: _kind, ...collisionRect } = usage.collision;
    assertRect(collisionRect, `${field}.collision`, issues, isObject(usage.frame) ? usage.frame : null);
  } else if (usage.collision.kind === 'rects') {
    assertExactKeys(usage.collision, ['kind', 'rects'], `${field}.collision`, issues, 'INVALID_COLLISION');
    if (!Array.isArray(usage.collision.rects) || usage.collision.rects.length === 0) {
      issues.push(issue(`${field}.collision.rects`, 'must contain one or more authored solid rectangles', 'INVALID_COLLISION'));
    } else {
      usage.collision.rects.forEach((rect, index) => assertRect(rect, `${field}.collision.rects[${index}]`, issues, isObject(usage.frame) ? usage.frame : null));
    }
  } else {
    issues.push(issue(`${field}.collision.kind`, 'must be exactly none, rect, or rects', 'INVALID_COLLISION'));
  }

  if (usage.kind === 'character') {
    if (!isObject(usage.animations) || Object.keys(usage.animations).length === 0) {
      issues.push(issue(`${field}.animations`, 'character assets require at least one animation state', 'MISSING_ANIMATIONS'));
    } else if (Object.keys(usage.animations).length > MAX_ANIMATION_STATES) {
      issues.push(issue(`${field}.animations`, `must contain at most ${MAX_ANIMATION_STATES} states`, 'ANIMATIONS_TOO_LARGE'));
    } else if (isObject(usage.frame)) {
      const frameCount = usage.frame.columns * usage.frame.rows;
      for (const [state, directions] of Object.entries(usage.animations)) {
        if (!isObject(directions) || Object.keys(directions).length === 0) {
          issues.push(issue(`${field}.animations.${state}`, 'state must contain direction entries', 'INVALID_ANIMATIONS'));
          continue;
        }
        for (const [direction, animation] of Object.entries(directions)) {
          if (!DIRECTIONS.has(direction)) {
            issues.push(issue(`${field}.animations.${state}.${direction}`, 'unknown direction', 'INVALID_ANIMATION_DIRECTION'));
            continue;
          }
          if (!isObject(animation)) {
            issues.push(issue(`${field}.animations.${state}.${direction}`, 'frames and fps are required', 'INVALID_ANIMATIONS'));
            continue;
          }
          assertExactKeys(animation, ['frames', 'fps'], `${field}.animations.${state}.${direction}`, issues, 'INVALID_ANIMATIONS');
          if (!Array.isArray(animation.frames) || animation.frames.length === 0) {
            issues.push(issue(`${field}.animations.${state}.${direction}.frames`, 'must be a non-empty frame index array', 'INVALID_ANIMATIONS'));
          } else if (animation.frames.length > MAX_ANIMATION_FRAMES) {
            issues.push(issue(`${field}.animations.${state}.${direction}.frames`, `must contain at most ${MAX_ANIMATION_FRAMES} frame indices`, 'ANIMATIONS_TOO_LARGE'));
          } else {
            for (const [frameIndex, frame] of animation.frames.entries()) {
              if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
                issues.push(issue(`${field}.animations.${state}.${direction}.frames[${frameIndex}]`, 'frame index is outside the declared sheet', 'ANIMATION_FRAME_OUT_OF_RANGE'));
              }
            }
          }
          if (typeof animation.fps !== 'number' || !Number.isFinite(animation.fps) || animation.fps <= 0 || animation.fps > 240) {
            issues.push(issue(`${field}.animations.${state}.${direction}.fps`, 'must be a finite number from 0 (exclusive) through 240', 'INVALID_ANIMATION_FPS'));
          }
        }
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(usage, 'animations')) {
    issues.push(issue(`${field}.animations`, 'animations are only valid for character assets', 'INVALID_USAGE_FIELDS'));
  }

}

function assertRelativeAssetPath(value, field, issues) {
  assertNonEmptyString(value, field, issues);
  if (typeof value !== 'string' || value.trim() === '') return;
  if (value !== value.trim() || value.includes('\\') || value.includes('?') || value.includes('#') || value.includes('%')) {
    issues.push(issue(field, 'must be a canonical relative PNG path without escapes, query, or fragment', 'UNSAFE_PATH'));
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    issues.push(issue(field, 'must be relative to the asset root', 'UNSAFE_PATH'));
  }
  if (normalized.split('/').some((part) => part === '..')) {
    issues.push(issue(field, 'must not escape the asset root', 'UNSAFE_PATH'));
  }
  if (normalized.includes('://')) {
    issues.push(issue(field, 'must be a local relative path, not a URL', 'UNSAFE_PATH'));
  }
  if (path.posix.normalize(normalized) === '.') {
    issues.push(issue(field, 'must point to a file', 'UNSAFE_PATH'));
  }
  if (path.posix.normalize(normalized) !== normalized || path.posix.extname(normalized).toLowerCase() !== '.png') {
    issues.push(issue(field, 'must be a normalized .png path', 'UNSAFE_PATH'));
  }
}

function assertLocalAssetUrl(value, assetPath, field, issues) {
  assertNonEmptyString(value, field, issues);
  if (typeof value !== 'string' || value.trim() === '') return;
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value) || value.includes('\\') || value.includes('?') || value.includes('#') || value.includes('%')) {
    issues.push(issue(field, 'must be a canonical local PNG path', 'REMOTE_URL_FORBIDDEN'));
    return;
  }
  const normalized = value.startsWith('/') ? value.slice(1) : value;
  if (value.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) || normalized.split('/').some((part) => !part || part === '.' || part === '..') || path.posix.normalize(normalized) !== normalized) {
    issues.push(issue(field, 'must not be remote, traverse, or name a non-canonical endpoint', 'REMOTE_URL_FORBIDDEN'));
  }
  if (typeof assetPath === 'string' && normalized !== assetPath && normalized !== `assets/${assetPath}`) {
    issues.push(issue(field, 'must be path or /assets/path for the same hash-verified bytes', 'URL_PATH_MISMATCH'));
  }
}

function assertNoFallback(value, field, issues) {
  if (!isObject(value)) return;
  for (const key of ['fallback', 'fallbackAsset', 'fallbackAssetId', 'fallbackPath', 'default', 'defaultAssetId', 'placeholder', 'placeholderAssetId']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push(issue(`${field}.${key}`, 'fallbacks are forbidden by the asset contract', 'FALLBACK_FORBIDDEN'));
    }
  }
}

function validateAssetShape(asset, index) {
  const issues = [];
  const field = `assets[${index}]`;
  if (!isObject(asset)) {
    issues.push(issue(field, 'must be an object', 'INVALID_ASSET'));
    return issues;
  }
  const allowedAssetKeys = ['id', 'version', 'path', 'url', 'sha256', 'dimensions', 'pivot', 'usage'];
  for (const key of Object.keys(asset)) if (!allowedAssetKeys.includes(key)) issues.push(issue(`${field}.${key}`, 'unknown asset field', 'INVALID_ASSET_FIELD'));
  assertNoFallback(asset, field, issues);
  assertNonEmptyString(asset.id, `${field}.id`, issues);
  assertSemver(asset.version, `${field}.version`, issues);
  assertRelativeAssetPath(asset.path, `${field}.path`, issues);
  if (asset.url !== undefined) assertLocalAssetUrl(asset.url, asset.path, `${field}.url`, issues);
  if (typeof asset.sha256 !== 'string' || !SHA256_RE.test(asset.sha256)) {
    issues.push(issue(`${field}.sha256`, 'must be a 64-character SHA-256', 'INVALID_HASH'));
  }

  if (!isObject(asset.dimensions)) {
    issues.push(issue(`${field}.dimensions`, 'width and height are required', 'MISSING_DIMENSIONS'));
  } else {
    assertExactKeys(asset.dimensions, ['width', 'height'], `${field}.dimensions`, issues, 'INVALID_DIMENSIONS');
    assertPositiveInteger(asset.dimensions.width, `${field}.dimensions.width`, issues);
    assertPositiveInteger(asset.dimensions.height, `${field}.dimensions.height`, issues);
    if (asset.dimensions.width > MAX_IMAGE_DIMENSION || asset.dimensions.height > MAX_IMAGE_DIMENSION || asset.dimensions.width * asset.dimensions.height > MAX_IMAGE_PIXELS) issues.push(issue(`${field}.dimensions`, 'image dimensions exceed the shipping budget', 'DIMENSIONS_TOO_LARGE'));
  }
  assertUsage(asset.usage, isObject(asset.dimensions) ? asset.dimensions : {}, `${field}.usage`, issues);
  if (!isObject(asset.pivot)) {
    issues.push(issue(`${field}.pivot`, 'x and y are required', 'MISSING_PIVOT'));
  } else {
    assertExactKeys(asset.pivot, ['x', 'y'], `${field}.pivot`, issues, 'INVALID_PIVOT');
    assertInteger(asset.pivot.x, `${field}.pivot.x`, issues);
    assertInteger(asset.pivot.y, `${field}.pivot.y`, issues);
    if (isObject(asset.dimensions) && Number.isInteger(asset.dimensions.width) &&
        Number.isInteger(asset.pivot.x) &&
        (asset.pivot.x < 0 || asset.pivot.x >= asset.dimensions.width)) {
      issues.push(issue(`${field}.pivot.x`, 'must lie inside the declared width', 'INVALID_PIVOT'));
    }
    if (isObject(asset.dimensions) && Number.isInteger(asset.dimensions.height) &&
        Number.isInteger(asset.pivot.y) &&
        (asset.pivot.y < 0 || asset.pivot.y >= asset.dimensions.height)) {
      issues.push(issue(`${field}.pivot.y`, 'must lie inside the declared height', 'INVALID_PIVOT'));
    }
    if (isObject(asset.usage?.frame) && Number.isInteger(asset.usage.frame.width)
      && Number.isInteger(asset.pivot.x) && asset.pivot.x >= asset.usage.frame.width) {
      issues.push(issue(`${field}.pivot.x`, 'must lie inside one authored frame', 'INVALID_FRAME_PIVOT'));
    }
    if (isObject(asset.usage?.frame) && Number.isInteger(asset.usage.frame.height)
      && Number.isInteger(asset.pivot.y) && asset.pivot.y >= asset.usage.frame.height) {
      issues.push(issue(`${field}.pivot.y`, 'must lie inside one authored frame', 'INVALID_FRAME_PIVOT'));
    }
  }
  return issues;
}

const CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
}));

function crc32(parts) {
  let crc = 0xffffffff;
  for (const bytes of parts) for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePngBytes(bytes, label) {
  const invalid = (code, message) => fail(`PNG validation failed: ${label}`, { code, issues: [issue(label, message, code)] });
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid('PNG_SIGNATURE_INVALID', 'PNG signature is missing or invalid');
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let sawPalette = false;
  let dataEnded = false;
  let bitDepth = 0;
  let colorType = -1;
  const compressedParts = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid('PNG_CHUNK_INVALID', 'PNG contains a truncated chunk');
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) invalid('PNG_CHUNK_INVALID', 'PNG chunk length exceeds the file');
    const typeBytes = bytes.subarray(typeStart, dataStart);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(type)) invalid('PNG_CHUNK_INVALID', 'PNG chunk type is invalid');
    if (crc32([typeBytes, bytes.subarray(dataStart, dataEnd)]) !== bytes.readUInt32BE(dataEnd)) invalid('PNG_CRC_INVALID', `PNG ${type} chunk CRC is invalid`);
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) invalid('PNG_IHDR_INVALID', 'IHDR must be the first chunk and exactly 13 bytes');
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      if (width === 0 || height === 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) invalid('PNG_DIMENSIONS_INVALID', 'PNG dimensions exceed the shipping bounds');
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filter = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowedDepths[colorType]?.includes(bitDepth) || compression !== 0 || filter !== 0 || interlace !== 0) invalid('PNG_IHDR_INVALID', 'PNG must use a supported non-interlaced color format');
      sawHeader = true;
    } else if (type === 'IHDR') invalid('PNG_IHDR_INVALID', 'PNG must contain exactly one IHDR chunk');
    if (type === 'PLTE') {
      if (sawData || length === 0 || length % 3 !== 0 || length > 768) invalid('PNG_PALETTE_INVALID', 'PLTE must precede IDAT and contain 1 through 256 RGB entries');
      sawPalette = true;
    }
    if (type === 'IDAT') {
      if (dataEnded || length === 0) invalid('PNG_DATA_INVALID', 'IDAT chunks must be non-empty and consecutive');
      sawData = true;
      compressedParts.push(bytes.subarray(dataStart, dataEnd));
    } else if (sawData && type !== 'IEND') {
      dataEnded = true;
    }
    if (type === 'IEND') {
      if (length !== 0) invalid('PNG_IEND_INVALID', 'IEND must be empty');
      if (chunkEnd !== bytes.length) invalid('PNG_TRAILING_DATA', 'PNG must not contain trailing bytes after IEND');
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawHeader || !sawData || !sawEnd) invalid('PNG_STRUCTURE_INVALID', 'PNG requires IHDR, IDAT, and IEND chunks');
  if (colorType === 3 && !sawPalette) invalid('PNG_PALETTE_INVALID', 'indexed-color PNG requires a PLTE chunk');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expectedInflatedBytes = height * (rowBytes + 1);
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(compressedParts), { maxOutputLength: expectedInflatedBytes });
  } catch {
    invalid('PNG_DATA_INVALID', 'IDAT data must inflate to complete scanlines within the image budget');
  }
  if (inflated.length !== expectedInflatedBytes) invalid('PNG_DATA_INVALID', 'inflated IDAT length does not match declared dimensions');
  for (let row = 0; row < height; row += 1) if (inflated[row * (rowBytes + 1)] > 4) invalid('PNG_FILTER_INVALID', 'scanline filter must be in the PNG range 0 through 4');
  return Object.freeze({ width, height, byteLength: bytes.length });
}

function readOpenedBytes(descriptor, stat, label, maxBytes = MAX_ASSET_FILE_BYTES) {
  if (!stat.isFile()) fail(`Asset is not a regular file: ${label}`, { code: 'ASSET_FILE_INVALID', issues: [issue(label, 'must be a regular file', 'ASSET_FILE_INVALID')] });
  if (stat.size > maxBytes) fail(`Asset exceeds byte budget: ${label}`, { code: 'ASSET_FILE_TOO_LARGE', issues: [issue(label, `must be at most ${maxBytes} bytes`, 'ASSET_FILE_TOO_LARGE')] });
  const bytes = Buffer.alloc(stat.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) fail(`Asset changed while reading: ${label}`, { code: 'ASSET_FILE_CHANGED', issues: [issue(label, 'file ended during the bounded read', 'ASSET_FILE_CHANGED')] });
    offset += count;
  }
  const finalStat = fs.fstatSync(descriptor);
  if (finalStat.dev !== stat.dev || finalStat.ino !== stat.ino || finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) fail(`Asset changed while reading: ${label}`, { code: 'ASSET_FILE_CHANGED', issues: [issue(label, 'file metadata changed during validation', 'ASSET_FILE_CHANGED')] });
  return bytes;
}

function readRegularFile(filePath, maxBytes = MAX_ASSET_FILE_BYTES) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    return readOpenedBytes(descriptor, fs.fstatSync(descriptor), filePath, maxBytes);
  } catch (error) {
    if (error instanceof AssetContractError) throw error;
    fail(`Asset cannot be opened safely: ${filePath}`, { code: 'ASSET_FILE_INVALID', issues: [issue(filePath, 'file cannot be opened without following a symlink', 'ASSET_FILE_INVALID')] });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function resolveInsideRoot(assetRoot, relativePath) {
  const root = path.resolve(assetRoot);
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    fail(`Asset path escapes the asset root: ${relativePath}`, {
      code: 'UNSAFE_ASSET_PATH',
      issues: [issue(relativePath, 'resolved path escapes asset root', 'UNSAFE_PATH')]
    });
  }
  return absolute;
}

function rejectSymlinkComponents(root, absolute, asset) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    fail(`Asset root cannot be inspected: ${asset.path}`, {
      code: 'ASSET_ROOT_INVALID',
      issues: [issue(`assets.${asset.id}.path`, error.code === 'ENOENT' ? 'asset root does not exist' : 'asset root cannot be inspected', 'ASSET_ROOT_INVALID')]
    });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail(`Asset root must be a regular directory: ${asset.path}`, {
      code: 'ASSET_ROOT_INVALID',
      issues: [issue(`assets.${asset.id}.path`, 'asset root must be a regular non-symlink directory', 'ASSET_ROOT_INVALID')]
    });
  }
  let current = root;
  const relative = path.relative(root, absolute);
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      fail(`Shipping asset path must not contain symlinks: ${asset.path}`, {
        code: 'ASSET_FILE_INVALID',
        issues: [issue(`assets.${asset.id}.path`, 'symlink path components are forbidden for shipping assets', 'ASSET_SYMLINK_FORBIDDEN')]
      });
    }
  }
}

function verifyAssetFile(asset, assetRoot) {
  const absolute = resolveInsideRoot(assetRoot, asset.path);
  rejectSymlinkComponents(path.resolve(assetRoot), absolute, asset);
  let descriptor;
  try {
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    fail(`Shipping asset file is missing: ${asset.path}`, {
      code: 'ASSET_FILE_MISSING',
      issues: [issue(`assets.${asset.id}.path`, error.code === 'ENOENT' ? 'file does not exist' : 'file cannot be opened without following a symlink', 'ASSET_FILE_MISSING')]
    });
  }
  try {
    const openedStat = fs.fstatSync(descriptor);
    const realRoot = fs.realpathSync(path.resolve(assetRoot));
    const realAsset = fs.realpathSync(absolute);
    const canonicalStat = fs.lstatSync(realAsset);
    if (realAsset !== realRoot && !realAsset.startsWith(`${realRoot}${path.sep}`)) fail(`Shipping asset resolves outside the asset root: ${asset.path}`, { code: 'UNSAFE_ASSET_PATH', issues: [issue(`assets.${asset.id}.path`, 'opened file resolves outside the asset root', 'UNSAFE_PATH')] });
    if (!canonicalStat.isFile() || canonicalStat.dev !== openedStat.dev || canonicalStat.ino !== openedStat.ino) fail(`Shipping asset changed during validation: ${asset.path}`, { code: 'ASSET_FILE_CHANGED', issues: [issue(`assets.${asset.id}.path`, 'opened descriptor no longer matches the canonical path', 'ASSET_FILE_CHANGED')] });
    const bytes = readOpenedBytes(descriptor, openedStat, `assets.${asset.id}.path`);
    const dimensions = parsePngBytes(bytes, `assets.${asset.id}.path`);
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const issues = [];
    if (actualSha256.toLowerCase() !== asset.sha256.toLowerCase()) issues.push(issue(`assets.${asset.id}.sha256`, `expected ${asset.sha256}, got ${actualSha256}`, 'SHA256_MISMATCH'));
    if (dimensions.width !== asset.dimensions.width || dimensions.height !== asset.dimensions.height) issues.push(issue(`assets.${asset.id}.dimensions`, `expected ${asset.dimensions.width}x${asset.dimensions.height}, got ${dimensions.width}x${dimensions.height}`, 'DIMENSIONS_MISMATCH'));
    if (issues.length > 0) fail(`Shipping asset bytes do not match the manifest: ${asset.id}`, { code: 'ASSET_FILE_MISMATCH', issues });
    return Object.freeze({ dimensions, sha256: actualSha256, byteLength: bytes.length });
  } catch (error) {
    if (error instanceof AssetContractError) throw error;
    fail(`Shipping asset path cannot be resolved safely: ${asset.path}`, { code: 'ASSET_FILE_INVALID', issues: [issue(`assets.${asset.id}.path`, 'asset path changed or cannot be resolved safely', 'ASSET_REALPATH_INVALID')] });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/** Return metadata for exactly requiredIds, checking only their PNG bytes,
 * geometry and SHA-linked provenance. Source art is never opened or executed. */
export function loadAssets({ manifestPath, provenancePath, assetRoot, requiredIds } = {}) {
  if (typeof assetRoot !== 'string' || assetRoot.trim() === '') {
    fail('assetRoot is required', {
      code: 'ASSET_ROOT_REQUIRED',
      issues: [issue('assetRoot', 'must be a non-empty directory path', 'ASSET_ROOT_REQUIRED')]
    });
  }
  if (!Array.isArray(requiredIds) || requiredIds.length > MAX_MANIFEST_ASSETS
      || requiredIds.some(id => typeof id !== 'string' || !id.trim())) {
    fail('Explicit required asset IDs are required', { code: 'ASSET_IDS_REQUIRED' });
  }
  const ids = [...new Set(requiredIds)];
  if (!ids.length) return [];
  const readJson = file => {
    try {
      return JSON.parse(readRegularFile(file, MAX_MANIFEST_FILE_BYTES).toString('utf8'));
    } catch (error) {
      if (error instanceof AssetContractError) throw error;
      fail(`Asset metadata JSON is invalid: ${file}`, { code: 'INVALID_ASSET_JSON' });
    }
  };
  const manifest = readJson(manifestPath);
  const provenance = readJson(provenancePath);
  if (manifest?.format !== ASSET_MANIFEST_FORMAT
      || manifest.schemaVersion !== ASSET_MANIFEST_SCHEMA_VERSION || !Array.isArray(manifest.assets)) {
    fail('Expected an asset manifest v2', { code: 'INVALID_MANIFEST' });
  }
  if (provenance?.format !== 'codecity.asset-provenance'
      || provenance.schemaVersion !== 1 || !Array.isArray(provenance.assets)) {
    fail('Expected asset provenance v1', { code: 'INVALID_PROVENANCE' });
  }
  const selected = ids.map(id => {
    const matches = manifest.assets.filter(asset => asset?.id === id);
    if (!matches.length) fail(`Required asset is missing: ${id}`, { code: 'ASSET_NOT_FOUND' });
    if (matches.length !== 1) fail(`Required asset ID is duplicated: ${id}`, { code: 'DUPLICATE_ID' });
    const asset = matches[0];
    const issues = validateAssetShape(asset, id);
    if (issues.length) fail(`Required asset metadata is invalid: ${id}`, { code: 'INVALID_ASSET', issues });
    const records = provenance.assets.filter(record => typeof record?.assetSha256 === 'string'
      && record.assetSha256.toLowerCase() === asset.sha256.toLowerCase());
    if (!records.length) fail(`Required asset provenance is missing: ${id}`, { code: 'PROVENANCE_NOT_FOUND' });
    for (const record of records) {
      const recordIssues = [];
      assertNonEmptyString(record.source, `provenance.${id}.source`, recordIssues);
      assertNonEmptyString(record.kind, `provenance.${id}.kind`, recordIssues);
      if (!SHA256_RE.test(record.sourceSha256 ?? '')) recordIssues.push(issue(`provenance.${id}.sourceSha256`, 'must be a SHA-256 digest'));
      if (recordIssues.length) fail(`Required asset provenance is invalid: ${id}`, { code: 'INVALID_PROVENANCE', issues: recordIssues });
    }
    return asset;
  });
  let totalBytes = 0;
  const countedPaths = new Set();
  for (const asset of selected) {
    const file = verifyAssetFile(asset, assetRoot);
    if (!countedPaths.has(asset.path)) {
      totalBytes += file.byteLength;
      countedPaths.add(asset.path);
    }
    if (totalBytes > MAX_ASSET_TOTAL_BYTES) fail('Shipping assets exceed the shipping budget', { code: 'ASSET_TOTAL_TOO_LARGE', issues: [issue('$.assets', `unique files must total at most ${MAX_ASSET_TOTAL_BYTES} bytes`, 'ASSET_TOTAL_TOO_LARGE')] });
  }
  return selected;
}
