import { inflateSync } from 'node:zlib';
import { IMAGE_LIMITS } from './config.mjs';

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function channelsForColorType(colorType) {
  return { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function inspectPng(buffer, limits = IMAGE_LIMITS) {
  if (!Buffer.isBuffer(buffer)) throw new Error('PNG input must be a Buffer');
  if (buffer.length > limits.maxInputBytes) throw new Error('PNG exceeds maximum input bytes');
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid PNG signature');
  const ihdrLength = buffer.readUInt32BE(8);
  if (ihdrLength !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG must begin with IHDR');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const compression = buffer[26];
  const filter = buffer[27];
  const interlace = buffer[28];
  const channels = channelsForColorType(colorType);
  if (!width || !height || width > limits.maxWidth || height > limits.maxHeight) throw new Error('PNG dimensions exceed limits');
  if (width * height > limits.maxInputPixels) throw new Error('PNG decoded pixel count exceeds limits');
  if (!channels || channels > limits.maxChannels) throw new Error('Unsupported PNG color type');
  if (bitDepth !== 8 || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) {
    throw new Error('Unsupported PNG encoding');
  }
  let offset = 8;
  let sawIend = false;
  let idatBytes = 0;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > buffer.length) throw new Error('Truncated PNG chunk');
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const observedCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
    if (observedCrc !== expectedCrc) throw new Error(`Invalid PNG chunk CRC: ${type}`);
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('Animated PNG is not supported');
    if (type === 'IDAT') idatBytes += length;
    if (type === 'IEND') {
      if (length !== 0) throw new Error('Invalid IEND chunk');
      sawIend = true;
      if (next !== buffer.length) throw new Error('Trailing bytes after PNG IEND');
    }
    offset = next;
  }
  if (!sawIend || idatBytes === 0) throw new Error('Incomplete PNG');
  return { format: 'png', width, height, channels, frames: 1, bytes: buffer.length };
}

export function decodeUnfilteredRgbaPng(buffer) {
  const inspection = inspectPng(buffer);
  if (inspection.channels !== 4 || buffer[28] !== 0) throw new Error('Expected non-interlaced RGBA PNG');
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const expectedLength = (inspection.width * 4 + 1) * inspection.height;
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: expectedLength });
  const stride = inspection.width * 4;
  if (raw.length !== (stride + 1) * inspection.height) throw new Error('Unexpected PNG scanline length');
  const pixels = Buffer.alloc(stride * inspection.height);
  for (let y = 0; y < inspection.height; y += 1) {
    const row = y * (stride + 1);
    if (raw[row] !== 0) throw new Error('Expected unfiltered mock PNG scanlines');
    raw.copy(pixels, y * stride, row + 1, row + 1 + stride);
  }
  return { ...inspection, pixels };
}
