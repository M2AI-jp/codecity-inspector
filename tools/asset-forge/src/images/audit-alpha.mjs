import sharp from 'sharp';
import { IMAGE_LIMITS } from '../config.mjs';

export async function auditTransparentPng(buffer, { alphaThreshold = 0 } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Image audit input must be a Buffer');
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) {
    throw new Error('alphaThreshold must be an integer from 0 to 255');
  }
  const decoded = await sharp(buffer, {
    animated: false,
    failOn: 'error',
    limitInputPixels: IMAGE_LIMITS.maxInputPixels,
    sequentialRead: true
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let opaquePixels = 0;
  let partialAlphaPixels = 0;
  let borderVisiblePixels = 0;
  const alphaValues = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const alpha = decoded.data[pixel * channels + 3];
      alphaValues[pixel] = alpha;
      if (alpha <= alphaThreshold) continue;
      visiblePixels += 1;
      if (alpha === 255) opaquePixels += 1;
      else partialAlphaPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) borderVisiblePixels += 1;
    }
  }
  const cornerAlpha = [
    alphaValues[0],
    alphaValues[width - 1],
    alphaValues[(height - 1) * width],
    alphaValues[height * width - 1]
  ];
  return {
    width,
    height,
    visiblePixels,
    opaquePixels,
    partialAlphaPixels,
    transparentPixels: width * height - visiblePixels,
    visibleCoverage: visiblePixels / (width * height),
    borderVisiblePixels,
    cornerAlpha,
    subjectBbox: visiblePixels === 0 ? null : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }
  };
}
