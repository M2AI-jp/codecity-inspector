import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null) throw new Error(`Invalid option near ${key ?? '<end>'}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

const args = options(process.argv.slice(2));
const width = Number(args.width);
const height = Number(args.height);
const alphaThreshold = Number(args['alpha-threshold'] ?? 128);
const palette = Number(args.palette ?? 64);

if (!args.input || !args.output) throw new Error('--input and --output are required');
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
  throw new Error('--width and --height must be positive integers');
}
if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) {
  throw new Error('--alpha-threshold must be an integer from 0 to 255');
}
if (!Number.isInteger(palette) || palette < 2 || palette > 256) {
  throw new Error('--palette must be an integer from 2 to 256');
}

const resized = await sharp(args.input, { animated: false, failOn: 'error' })
  .ensureAlpha()
  .resize(width, height, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.nearest
  })
  .raw()
  .toBuffer({ resolveWithObject: true });

const pixels = Buffer.from(resized.data);
for (let offset = 0; offset < pixels.length; offset += resized.info.channels) {
  pixels[offset + 3] = pixels[offset + 3] >= alphaThreshold ? 255 : 0;
  if (pixels[offset + 3] === 0) {
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
  }
}

await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
await sharp(pixels, {
  raw: { width, height, channels: resized.info.channels }
})
  .png({
    compressionLevel: 9,
    adaptiveFiltering: false,
    palette: true,
    colours: palette,
    dither: 0
  })
  .toFile(args.output);

const result = await sharp(args.output).metadata();
process.stdout.write(`${JSON.stringify({
  output: path.resolve(args.output),
  width: result.width,
  height: result.height,
  channels: result.channels,
  palette,
  alphaThreshold
})}\n`);
