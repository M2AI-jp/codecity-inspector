// Loading of the town, the art manifest and images. Nothing here is fatal except a missing town.
// Keep the public entry point stable while implementation follows each responsibility.
export { DEFAULT_PLAYER_SRC, DEFAULT_PLAYER_ANIMS } from './assets/defaults.js';
export { warnOnce } from './assets/warnings.js';
export { loadJSON, loadImage } from './assets/loading.js';
export { toCanvas, cleanMagenta } from './assets/canvas.js';
export { buildSheet } from './assets/sheet.js';
export { loadArt } from './assets/manifest.js';
