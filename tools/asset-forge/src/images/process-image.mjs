import sharp from 'sharp';
import { IMAGE_LIMITS, PROCESS_LIMITS } from '../config.mjs';

const NAMED_KEYS = Object.freeze({ black: [0, 0, 0], white: [255, 255, 255] });

export function parseAlphaKey(value) {
  if (!value || value === 'none') return null;
  if (NAMED_KEYS[value]) return NAMED_KEYS[value];
  const match = /^#([a-f0-9]{6})$/i.exec(value);
  if (!match) throw new Error('Alpha key must be black, white, none, or #rrggbb');
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function trimBox(pixels, width, height, channels) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * channels + 3] === 0) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return { left: 0, top: 0, width: 1, height: 1 };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export async function processImageBuffer(buffer, {
  alphaKey = null,
  tolerance = 0,
  trim = false,
  width,
  height
} = {}) {
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) throw new Error('Tolerance must be an integer from 0 to 255');
  const key = Array.isArray(alphaKey) ? alphaKey : parseAlphaKey(alphaKey);
  const decoded = await sharp(buffer, { failOn: 'error', limitInputPixels: IMAGE_LIMITS.maxInputPixels, animated: false })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(decoded.data);
  const info = decoded.info;
  if (key) {
    for (let offset = 0; offset < pixels.length; offset += info.channels) {
      const matches = Math.abs(pixels[offset] - key[0]) <= tolerance
        && Math.abs(pixels[offset + 1] - key[1]) <= tolerance
        && Math.abs(pixels[offset + 2] - key[2]) <= tolerance;
      if (matches) pixels[offset + 3] = 0;
    }
  }
  let pipeline = sharp(pixels, { raw: { width: info.width, height: info.height, channels: info.channels } });
  let processedWidth = info.width;
  let processedHeight = info.height;
  if (trim) {
    const box = trimBox(pixels, info.width, info.height, info.channels);
    pipeline = pipeline.extract(box);
    processedWidth = box.width;
    processedHeight = box.height;
  }
  if (width != null || height != null) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Width and height must be positive integers together');
    pipeline = pipeline.resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest });
    processedWidth = width;
    processedHeight = height;
  }
  return {
    png: await pipeline.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer(),
    width: processedWidth,
    height: processedHeight
  };
}

export async function extractGridFrames(buffer, grid) {
  for (const field of ['columns', 'rows', 'frameWidth', 'frameHeight']) {
    if (!Number.isInteger(grid?.[field]) || grid[field] < 1) throw new Error(`Invalid grid ${field}`);
  }
  const frameCount = grid.columns * grid.rows;
  if (!Number.isSafeInteger(frameCount) || frameCount > PROCESS_LIMITS.maxExtractedFrames) {
    throw new Error(`Sprite grid exceeds ${PROCESS_LIMITS.maxExtractedFrames} frames`);
  }
  const metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: IMAGE_LIMITS.maxInputPixels }).metadata();
  if (metadata.width !== grid.columns * grid.frameWidth || metadata.height !== grid.rows * grid.frameHeight) {
    throw new Error('Sprite grid does not match image dimensions');
  }
  const frames = [];
  let totalOutputBytes = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const frame = await sharp(buffer, { failOn: 'error', limitInputPixels: IMAGE_LIMITS.maxInputPixels, animated: false }).extract({
        left: column * grid.frameWidth,
        top: row * grid.frameHeight,
        width: grid.frameWidth,
        height: grid.frameHeight
      }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
      totalOutputBytes += frame.length;
      if (totalOutputBytes > PROCESS_LIMITS.maxFrameOutputBytes) throw new Error('Sprite frame outputs exceed byte limit');
      frames.push(frame);
    }
  }
  return frames;
}
