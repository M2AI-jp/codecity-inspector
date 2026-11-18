// PNG image helpers: keep filesystem access and blank-image allocation at the API boundary.
import fs from 'node:fs';
import { decodePNG } from './decode.mjs';
import { encodePNG } from './encode.mjs';

export const readPNG = (path) => decodePNG(fs.readFileSync(path));
export const writePNG = (path, img, opts) => fs.writeFileSync(path, encodePNG(img, opts));
export const createImage = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
