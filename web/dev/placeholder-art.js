// DEBUG ONLY (?debug=1&art=placeholder). Procedural stand-in art so the runtime's art code paths (archetype origins,
// exterior/cutaway cross-fade, blockers, lights, smoke, props, ground textures, resident
// sprites) can be exercised before the real art exists. Never loaded in normal mode.
// These images are deliberately plain and are not game assets.

// Keep the debug entry point stable while each kind of drawing lives in its own module.
export { placeholderManifest } from './placeholder-art/manifest.js';
