import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_LIMITS } from '../config.mjs';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_RIFF = Buffer.from('RIFF');
const WEBP_MAGIC = Buffer.from('WEBP');
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function detectImageFormat(buffer) {
  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (buffer.subarray(0, 3).equals(JPEG_MAGIC)) return 'jpeg';
  if (buffer.subarray(0, 4).equals(WEBP_RIFF) && buffer.subarray(8, 12).equals(WEBP_MAGIC)) return 'webp';
  throw new Error('Unsupported image signature; only PNG, JPEG, and WEBP are accepted');
}

export async function readExternalImage(filePath, { limits = IMAGE_LIMITS } = {}) {
  if (typeof filePath !== 'string' || filePath.includes('\0')) throw new Error('Invalid source path');
  const requested = path.resolve(filePath);
  const before = await lstat(requested, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('Source must be a regular non-symlink file');
  if (before.size < 1n || before.size > BigInt(limits.maxInputBytes)) throw new Error('Image input byte limit exceeded');
  const handle = await open(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
  let buffer;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error('Source changed while it was being opened');
    }
    const bounded = Buffer.allocUnsafe(limits.maxInputBytes + 1);
    let offset = 0;
    while (offset < bounded.length) {
      const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > limits.maxInputBytes) throw new Error('Image input byte limit exceeded while reading');
    const after = await handle.stat({ bigint: true });
    if (after.size !== BigInt(offset) || after.dev !== opened.dev || after.ino !== opened.ino
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
      throw new Error('Source changed while it was being read');
    }
    buffer = bounded.subarray(0, offset);
  } finally {
    await handle.close();
  }
  const sourceFormat = detectImageFormat(buffer);
  const image = sharp(buffer, {
    animated: false,
    failOn: 'error',
    limitInputPixels: limits.maxInputPixels,
    sequentialRead: true
  });
  const metadata = await image.metadata();
  const frames = metadata.pages ?? 1;
  if (!metadata.width || !metadata.height || metadata.width > limits.maxWidth || metadata.height > limits.maxHeight
    || metadata.width * metadata.height > limits.maxInputPixels || frames > limits.maxFrames
    || !metadata.channels || metadata.channels > limits.maxChannels) {
    throw new Error('Decoded image limits exceeded');
  }
  if (metadata.format !== sourceFormat) throw new Error('Image signature does not match decoded format');
  // A real decode is required; metadata parsing alone is not acceptance.
  await image.clone().raw().toBuffer({ resolveWithObject: true });
  return {
    actualPath: requested,
    buffer,
    sourceFormat,
    metadata: {
      format: sourceFormat,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      frames,
      bytes: buffer.length
    }
  };
}

export async function normalizeImportedImage(buffer, outputContract, { limits = IMAGE_LIMITS } = {}) {
  if (!Number.isInteger(outputContract.width) || !Number.isInteger(outputContract.height)
    || outputContract.width < 1 || outputContract.height < 1
    || outputContract.width > limits.maxWidth || outputContract.height > limits.maxHeight
    || outputContract.width * outputContract.height > limits.maxInputPixels) {
    throw new Error('Output contract exceeds image limits');
  }
  const fit = outputContract.needsTrim ? 'contain' : 'fill';
  return sharp(buffer, { failOn: 'error', limitInputPixels: limits.maxInputPixels, animated: false })
    .ensureAlpha()
    .resize(outputContract.width, outputContract.height, {
      fit,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: outputContract.nearestNeighbor ? sharp.kernel.nearest : sharp.kernel.lanczos3
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}
