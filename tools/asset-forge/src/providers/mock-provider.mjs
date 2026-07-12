import { deflateSync } from 'node:zlib';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { PNG_SIGNATURE } from '../png-core.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

export function createMockPng({
  assetId,
  seed = '',
  promptHash = '',
  referenceImageHashes = [],
  outputContract = { width: 16, height: 16 }
}) {
  const width = outputContract.width ?? 16;
  const height = outputContract.height ?? 16;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 32_000_000) {
    throw new Error('Invalid mock PNG dimensions');
  }
  const digest = Buffer.from(sha256(canonicalJson({
    assetId,
    seed: String(seed),
    promptHash,
    referenceImageHashes,
    outputContract
  })), 'hex');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const value = digest[(x * 7 + y * 13) % digest.length] ^ ((x * 31 + y * 17) & 0xff);
      const visible = (value & 3) !== 0;
      raw[offset] = visible ? digest[(x + 0) % digest.length] : 0;
      raw[offset + 1] = visible ? digest[(y + 11) % digest.length] : 0;
      raw[offset + 2] = visible ? digest[(x + y + 23) % digest.length] : 0;
      raw[offset + 3] = visible ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
