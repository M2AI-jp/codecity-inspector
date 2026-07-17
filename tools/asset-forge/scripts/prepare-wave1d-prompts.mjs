import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FORGE_ROOT } from '../src/config.mjs';

const ROOT = path.join(FORGE_ROOT, 'review', 'prompts', 'wave1d-objects-effects');

const OBJECTS = Object.freeze([
  ['object.notice_board', 'notice_board', 'a freestanding late-medieval wooden public notice board with a compact blue-green cap, two sturdy posts, and a few small blank parchment rectangles pinned to its face'],
  ['object.signboard', 'signboard', 'a compact late-medieval hanging wooden shop sign on a dark timber post with a curled iron bracket, a plain round dark-ochre plaque, and a small stone foot; no word, letter, number, crest, or modern symbol'],
  ['object.construction_sign', 'construction_sign', 'a weathered late-medieval timber sawhorse repair barricade with muted red-and-cream painted diagonal boards, one small crossed-hammer repair emblem, iron brackets, and mossy stone feet; no black or yellow safety stripe and no writing'],
  ['object.unverified_tag', 'unverified_tag', 'one oversized hanging inspection tag made of weathered parchment and cord, bearing a single dark question-mark symbol but no words'],
  ['object.warning_stake', 'warning_stake', 'a short planted wooden warning stake with one small ochre diamond-shaped caution plaque and a stone-weighted base; no writing'],
  ['object.red_flag', 'red_flag', 'one small muted brick-red cloth status flag on a short dark wooden pole planted in a compact stone base; plain fabric with no crest'],
  ['object.yellow_flag', 'yellow_flag', 'one small muted ochre-yellow cloth status flag on a short dark wooden pole planted in a compact stone base; plain fabric with no crest'],
  ['object.blue_flag', 'blue_flag', 'one small muted deep-blue cloth status flag on a short dark wooden pole planted in a compact stone base; plain fabric with no crest']
]);

const EFFECTS = Object.freeze([
  ['effect.construction_dust', 'construction_dust', 'a four-frame construction dust puff animation made from crisp opaque stone-gray and warm-brown pixel clusters', 'frame 1 is a small ground puff, frame 2 expands upward and outward, frame 3 is the widest broken cloud, frame 4 dissipates into fewer small clusters'],
  ['effect.water_ripple', 'water_ripple', 'a four-frame water ripple animation made from crisp opaque muted blue and blue-green pixel arcs', 'frame 1 is a small tight ellipse, frame 2 expands, frame 3 is the widest broken ring, frame 4 dissipates into shorter faint-color arcs while remaining fully opaque']
]);

function objectPrompt(assetId, subject) {
  return `Use case: stylized-concept
Asset type: production map-scale pixel-art prop source for ${assetId}
Input images: Image 1 is the global CodeCity world style and map-scale reference; Image 2 is the approved primary subject reference for this exact asset. Use both images directly for palette, material, silhouette, and visual vocabulary, while authoring one clean standalone prop.

Primary request: create exactly one ${subject}.
Style/medium: authentic compact late-medieval pixel art with deliberate hard-edged pixel clusters, controlled shading, readable silhouette, and no antialiasing.
Composition/framing: one complete prop centered on the canvas, upright and viewed from the same slightly elevated map perspective as the references, with generous empty padding on all four sides.
Color palette: restrained CodeCity blue-green, warm brown, stone gray, charcoal, and only the requested status accent.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local removal.

Production contract: the subject will be chroma-removed and nearest-neighbor downscaled without enlargement into a 64x64 transparent sprite. Use crisp fully opaque subject pixels. The background must be one uniform #ff00ff color with no shadow, gradient, texture, reflection, floor plane, or lighting variation. No cast shadow, contact shadow, scenery, ground patch, frame, border, divider, label, readable word, logo, watermark, or signature. Do not use #ff00ff anywhere in the subject.
Avoid: additional props; alternate variants; cropped subject; oversized detail; soft blur; semi-transparent edge; smooth vector curves; painterly texture; modern materials; people; creatures.`;
}

function effectPrompt(assetId, subject, sequence) {
  return `Use case: stylized-concept
Asset type: production pixel-art effect spritesheet source for ${assetId}
Input images: Image 1 is the global CodeCity world style and map-scale reference; Image 2 is the approved primary subject reference for this exact effect. Use both images directly for palette and pixel-cluster treatment.

Primary request: create exactly ${subject} in one horizontal four-frame spritesheet.
Animation sequence: ${sequence}.
Style/medium: authentic compact pixel art with deliberate hard-edged opaque clusters, controlled two-to-four-step palette, no antialiasing, and no blur.
Layout contract: exactly four equal columns and one row. Each cell contains exactly one centered state of the same effect. Keep a stable center and comparable bounds so animation does not jitter. Leave generous flat magenta separation around every state. Do not draw panel borders, dividers, grid lines, or labels.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local removal.

Production contract: the source will be chroma-removed, split into four cells, and nearest-neighbor downscaled without enlargement into four 32x32 transparent frames assembled as exactly 128x32. Use only fully opaque effect pixels; imply fading by fewer clusters or darker palette colors, never transparency. The background must be one uniform #ff00ff color with no shadow, gradient, texture, reflection, floor plane, or lighting variation. No scenery, ground tile, text, letter, number, logo, watermark, or signature. Do not use #ff00ff anywhere in the effect.
Avoid: additional objects or characters; missing frames; duplicate frames; cropped effect; soft smoke blur; translucent pixels; smooth vector curves; painterly texture; baked scene background.`;
}

await mkdir(ROOT, { recursive: true });
for (const [assetId, stem, subject] of OBJECTS) {
  await writeFile(path.join(ROOT, `${stem}.txt`), `${objectPrompt(assetId, subject)}\n`);
}
for (const [assetId, stem, subject, sequence] of EFFECTS) {
  await writeFile(path.join(ROOT, `${stem}.txt`), `${effectPrompt(assetId, subject, sequence)}\n`);
}

console.log(JSON.stringify({ promptRoot: ROOT, objectPrompts: OBJECTS.length, effectPrompts: EFFECTS.length, total: OBJECTS.length + EFFECTS.length }, null, 2));
