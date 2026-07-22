import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import { FORGE_ROOT } from '../src/config.mjs';
import { sha256 } from '../src/hashing.mjs';

const WAVE_ID = 'wave1c-character-basis';
const RAW_PATH = path.join(FORGE_ROOT, 'references', 'pending', 'character_inspector_basis.png');
const CLEANED_PATH = path.join(FORGE_ROOT, 'references', 'pending', 'character_inspector_basis-cleaned.png');
const WORLD_PATH = path.join(FORGE_ROOT, 'references', 'approved', 'world_visual_master.png');
const PROMPT_PATH = path.join(FORGE_ROOT, 'review', 'prompts', 'wave1c-character-basis', 'character_inspector_basis.txt');
const REVIEW_ROOT = path.join(FORGE_ROOT, 'review');
const FRAME = Object.freeze({ width: 24, height: 40, alphaCutoff: 96 });
const SOURCE_COLUMN_ORDER = ['front', 'back', 'right', 'left'];
const NORMALIZED_COLUMN_SOURCES = [0, 1, 3, 2];
const NORMALIZED_COLUMN_ORDER = ['front', 'back', 'left', 'right'];
const ROW_ORDER = ['idle', 'walk_1', 'walk_2'];
const BOARD_SCALE = Object.freeze({ maxWidth: 18, maxHeight: 30, minTopMargin: 5 });

function bboxFor(data, width, height, cutoff) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let partialAlphaPixels = 0;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
      if (alpha <= cutoff) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      colors.add(data.subarray(index, index + 3).toString('hex'));
    }
  }
  return {
    bbox: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    visiblePixels,
    partialAlphaPixels,
    visibleColorCount: colors.size
  };
}

function hardenAlpha(data) {
  const output = Buffer.from(data);
  for (let index = 0; index < output.length; index += 4) {
    if (output[index + 3] < FRAME.alphaCutoff) output.fill(0, index, index + 4);
    else output[index + 3] = 255;
  }
  return output;
}

function labelSvg(text, width, height = 22) {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171b1d"/><text x="4" y="15" font-family="ui-monospace,monospace" font-size="9" fill="#f1ede3">${escaped}</text></svg>`);
}

function checkerSvg(width, height, size = 4) {
  const blocks = [];
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
    blocks.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${((x / size + y / size) % 2 === 0) ? '#30383c' : '#465156'}"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blocks.join('')}</svg>`);
}

function frameDifference(first, second) {
  let changedPixels = 0;
  let silhouetteChangedPixels = 0;
  let colorChangedPixels = 0;
  for (let index = 0; index < first.length; index += 4) {
    const firstVisible = first[index + 3] > 0;
    const secondVisible = second[index + 3] > 0;
    const colorChanged = first[index] !== second[index]
      || first[index + 1] !== second[index + 1]
      || first[index + 2] !== second[index + 2]
      || first[index + 3] !== second[index + 3];
    if (colorChanged) changedPixels += 1;
    if (firstVisible !== secondVisible) silhouetteChangedPixels += 1;
    if (firstVisible && secondVisible && colorChanged) colorChangedPixels += 1;
  }
  return { changedPixels, silhouetteChangedPixels, colorChangedPixels };
}

async function main() {
  await mkdir(REVIEW_ROOT, { recursive: true });
  const raw = await readFile(RAW_PATH);
  const cleaned = await readFile(CLEANED_PATH);
  const world = await readFile(WORLD_PATH);
  const prompt = await readFile(PROMPT_PATH);
  const rawMetadata = await sharp(raw).metadata();
  const cleanedDecoded = await sharp(cleaned).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (rawMetadata.width !== cleanedDecoded.info.width || rawMetadata.height !== cleanedDecoded.info.height) {
    throw new Error('Cleaned character basis dimensions changed');
  }

  const columnEdges = Array.from({ length: 5 }, (_, index) => Math.floor(index * cleanedDecoded.info.width / 4));
  const rowEdges = Array.from({ length: 4 }, (_, index) => Math.floor(index * cleanedDecoded.info.height / 3));
  const sourceFrames = [];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 4; column += 1) {
    const cell = {
      left: columnEdges[column],
      top: rowEdges[row],
      width: columnEdges[column + 1] - columnEdges[column],
      height: rowEdges[row + 1] - rowEdges[row]
    };
    const pixels = await sharp(cleaned).extract(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const audit = bboxFor(pixels.data, pixels.info.width, pixels.info.height, 16);
    if (!audit.bbox) throw new Error(`Empty character source cell ${column},${row}`);
    sourceFrames.push({ sourceColumn: column, row, cell, pixels, audit });
  }

  const maxSourceWidth = Math.max(...sourceFrames.map((entry) => entry.audit.bbox.width));
  const maxSourceHeight = Math.max(...sourceFrames.map((entry) => entry.audit.bbox.height));
  const commonScale = Math.min(22 / maxSourceWidth, 38 / maxSourceHeight);
  const normalizedFrames = [];
  for (const entry of sourceFrames) {
    const crop = await sharp(entry.pixels.data, { raw: entry.pixels.info }).extract({
      left: entry.audit.bbox.x,
      top: entry.audit.bbox.y,
      width: entry.audit.bbox.width,
      height: entry.audit.bbox.height
    }).resize({
      width: Math.max(1, Math.floor(entry.audit.bbox.width * commonScale)),
      height: Math.max(1, Math.floor(entry.audit.bbox.height * commonScale)),
      fit: 'fill',
      withoutEnlargement: true,
      kernel: sharp.kernel.nearest
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hardened = hardenAlpha(crop.data);
    const left = Math.floor((FRAME.width - crop.info.width) / 2);
    const top = FRAME.height - crop.info.height;
    if (left < 1 || top < 1 || left + crop.info.width >= FRAME.width || top + crop.info.height > FRAME.height) {
      throw new Error(`Normalized frame ${entry.sourceColumn},${entry.row} lacks a safe margin`);
    }
    const png = await sharp({ create: { width: FRAME.width, height: FRAME.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(hardened, { raw: crop.info }).png().toBuffer(), left, top }])
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    normalizedFrames.push({ ...entry, png, normalizedAudit: bboxFor(decoded.data, decoded.info.width, decoded.info.height, 0) });
  }

  const boardScale = Math.min(BOARD_SCALE.maxWidth / maxSourceWidth, BOARD_SCALE.maxHeight / maxSourceHeight);
  const boardFrames = [];
  for (const entry of sourceFrames) {
    const crop = await sharp(entry.pixels.data, { raw: entry.pixels.info }).extract({
      left: entry.audit.bbox.x,
      top: entry.audit.bbox.y,
      width: entry.audit.bbox.width,
      height: entry.audit.bbox.height
    }).resize({
      width: Math.max(1, Math.floor(entry.audit.bbox.width * boardScale)),
      height: Math.max(1, Math.floor(entry.audit.bbox.height * boardScale)),
      fit: 'fill',
      withoutEnlargement: true,
      kernel: sharp.kernel.nearest
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hardened = hardenAlpha(crop.data);
    const left = Math.floor((FRAME.width - crop.info.width) / 2);
    const top = FRAME.height - crop.info.height;
    const png = await sharp({ create: { width: FRAME.width, height: FRAME.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(hardened, { raw: crop.info }).png().toBuffer(), left, top }])
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 64, dither: 0 }).toBuffer();
    const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    boardFrames.push({
      ...entry,
      png,
      decoded,
      normalizedAudit: bboxFor(decoded.data, decoded.info.width, decoded.info.height, 0)
    });
  }

  const byCell = new Map(normalizedFrames.map((entry) => [`${entry.sourceColumn}:${entry.row}`, entry]));
  const normalizedSheet = await sharp({ create: { width: FRAME.width * 4, height: FRAME.height * 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(NORMALIZED_COLUMN_SOURCES.flatMap((sourceColumn, normalizedColumn) => ROW_ORDER.map((_, row) => ({
      input: byCell.get(`${sourceColumn}:${row}`).png,
      left: normalizedColumn * FRAME.width,
      top: row * FRAME.height
    }))))
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 96, dither: 0 }).toBuffer();
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native-96x120.png`), normalizedSheet);

  const boardByCell = new Map(boardFrames.map((entry) => [`${entry.sourceColumn}:${entry.row}`, entry]));
  const boardScaleSheet = await sharp({ create: { width: FRAME.width * 4, height: FRAME.height * 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(NORMALIZED_COLUMN_SOURCES.flatMap((sourceColumn, normalizedColumn) => ROW_ORDER.map((_, row) => ({
      input: boardByCell.get(`${sourceColumn}:${row}`).png,
      left: normalizedColumn * FRAME.width,
      top: row * FRAME.height
    }))))
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: true, colours: 64, dither: 0 }).toBuffer();
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native-board-scale-96x120.png`), boardScaleSheet);

  const boardScaleChecker = await sharp(boardScaleSheet).resize({ width: 768, height: 960, kernel: sharp.kernel.nearest }).png().toBuffer();
  await sharp({ create: { width: 800, height: 1014, channels: 4, background: '#171b1d' } }).composite([
    { input: checkerSvg(768, 960, 32), left: 16, top: 16 },
    { input: boardScaleChecker, left: 16, top: 16 },
    { input: labelSvg('board scale · 8x nearest · 4 columns x 3 rows · source pixels preserved', 768, 26), left: 16, top: 976 }
  ]).png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native-board-scale-checker-preview.png`));

  const nativeComposites = [
    { input: checkerSvg(96, 120), left: 10, top: 10 },
    { input: normalizedSheet, left: 10, top: 10 },
    { input: labelSvg('native 96x120 · each cell 24x40', 220), left: 10, top: 134 }
  ];
  for (let column = 0; column < 4; column += 1) nativeComposites.push({ input: labelSvg(NORMALIZED_COLUMN_ORDER[column], 48), left: 124, top: 10 + column * 26 });
  await sharp({ create: { width: 230, height: 164, channels: 4, background: '#171b1d' } }).composite(nativeComposites)
    .png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native-preview.png`));

  const worldSamples = [
    { label: 'world town', rect: { left: 432, top: 332, width: 24, height: 40 } },
    { label: 'world dock', rect: { left: 198, top: 872, width: 24, height: 40 } },
    { label: 'world road', rect: { left: 748, top: 482, width: 24, height: 40 } }
  ];
  const comparison = [];
  for (const [index, sample] of worldSamples.entries()) {
    comparison.push({ input: await sharp(world).extract(sample.rect).png().toBuffer(), left: 8 + index * 92, top: 8 });
    comparison.push({ input: labelSvg(sample.label, 84), left: 8 + index * 92, top: 52 });
    comparison.push({ input: byCell.get(`${NORMALIZED_COLUMN_SOURCES[index]}:0`).png, left: 8 + index * 92, top: 82 });
    comparison.push({ input: labelSvg(`basis ${NORMALIZED_COLUMN_ORDER[index]}`, 84), left: 8 + index * 92, top: 126 });
  }
  await sharp({ create: { width: 284, height: 156, channels: 4, background: '#171b1d' } }).composite(comparison)
    .png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-world-scale-comparison.png`));

  const boardComparison = [];
  for (const [index, sample] of worldSamples.entries()) {
    boardComparison.push({ input: await sharp(world).extract(sample.rect).png().toBuffer(), left: 8 + index * 92, top: 8 });
    boardComparison.push({ input: labelSvg(sample.label, 84), left: 8 + index * 92, top: 52 });
    boardComparison.push({ input: boardByCell.get(`${NORMALIZED_COLUMN_SOURCES[index]}:0`).png, left: 8 + index * 92, top: 82 });
    boardComparison.push({ input: labelSvg(`board ${NORMALIZED_COLUMN_ORDER[index]}`, 84), left: 8 + index * 92, top: 126 });
  }
  await sharp({ create: { width: 284, height: 156, channels: 4, background: '#171b1d' } }).composite(boardComparison)
    .png({ compressionLevel: 9 }).toFile(path.join(REVIEW_ROOT, `${WAVE_ID}-native-board-scale-world-comparison.png`));

  const cleanedAudit = bboxFor(cleanedDecoded.data, cleanedDecoded.info.width, cleanedDecoded.info.height, 0);
  const targetIds = JSON.parse(await readFile(path.join(FORGE_ROOT, 'data', 'asset-definitions', 'characters.json')))
    .assets.filter((asset) => asset.required).map((asset) => asset.id);
  const gridAlignable = normalizedFrames.every((entry) => {
    const bbox = entry.normalizedAudit.bbox;
    return bbox && bbox.x > 0 && bbox.y > 0 && bbox.x + bbox.width < FRAME.width
      && bbox.y + bbox.height === FRAME.height && entry.normalizedAudit.partialAlphaPixels === 0;
  });
  const boardScaleGridAlignable = boardFrames.every((entry) => {
    const bbox = entry.normalizedAudit.bbox;
    return bbox && bbox.width <= BOARD_SCALE.maxWidth && bbox.height <= BOARD_SCALE.maxHeight
      && bbox.y >= BOARD_SCALE.minTopMargin && bbox.x > 0
      && bbox.x + bbox.width < FRAME.width && bbox.y + bbox.height === FRAME.height
      && entry.normalizedAudit.partialAlphaPixels === 0;
  });
  const animationDifferences = NORMALIZED_COLUMN_SOURCES.map((sourceColumn, normalizedColumn) => {
    const idle = boardByCell.get(`${sourceColumn}:0`).decoded.data;
    const walk1 = boardByCell.get(`${sourceColumn}:1`).decoded.data;
    const walk2 = boardByCell.get(`${sourceColumn}:2`).decoded.data;
    return {
      direction: NORMALIZED_COLUMN_ORDER[normalizedColumn],
      idleVsWalk1: frameDifference(idle, walk1),
      idleVsWalk2: frameDifference(idle, walk2),
      walk1VsWalk2: frameDifference(walk1, walk2)
    };
  });
  const allAnimationPairsDistinct = animationDifferences.every((direction) => [
    direction.idleVsWalk1,
    direction.idleVsWalk2,
    direction.walk1VsWalk2
  ].every((difference) => difference.changedPixels > 0 && difference.silhouetteChangedPixels > 0));
  const provenance = {
    schemaVersion: 1,
    waveId: WAVE_ID,
    state: 'pending-reference-inspection',
    candidateReference: {
      proposedId: 'candidate_character_inspector_basis_20260714',
      path: 'references/pending/character_inspector_basis-cleaned.png',
      status: 'pending',
      category: 'character',
      sha256: sha256(cleaned),
      providedBy: 'codex-imagegen-built-in',
      targetAssetIds: targetIds,
      approved: false,
      reboundToDefinitions: false
    },
    provenance: {
      promptPath: path.relative(FORGE_ROOT, PROMPT_PATH).split(path.sep).join('/'),
      promptSha256: sha256(prompt),
      toolMode: 'built-in',
      inputReferences: [{ id: 'world_visual_master', sha256: sha256(world), role: 'global-style-and-subject' }],
      raw: { path: 'references/pending/character_inspector_basis.png', sha256: sha256(raw), width: rawMetadata.width, height: rawMetadata.height },
      cleaned: { path: 'references/pending/character_inspector_basis-cleaned.png', sha256: sha256(cleaned), width: cleanedDecoded.info.width, height: cleanedDecoded.info.height },
      chromaRemoval: {
        helper: '$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py',
        autoKey: 'border', keyColorObserved: '#fa03f9', softMatte: true,
        transparentThreshold: 35, opaqueThreshold: 110, despill: true
      }
    },
    observed: [
      'The generated source contains twelve separable character specimens in four columns and three rows.',
      'The official chroma-key helper produced a transparent cleaned candidate without changing dimensions.',
      'All twelve normalized samples fit a 24x40 frame on one shared scale and baseline with no partial-alpha pixels.',
      'The normalized 96x120 preview reorders the two side-view source columns into front, back, left, right.',
      'The board-scale sheet keeps all twelve visible bounding boxes at or below 30px high and 18px wide, with at least 5px top margin and a common foot baseline.',
      'Every idle/walk pair differs in both rendered pixels and silhouette pixels at native board scale.'
    ],
    inferred: [
      'The third and fourth source columns visually read as right and left respectively, so a deterministic column swap is appropriate for the declared runtime order.',
      'At native board scale, direction, hat silhouette, bag block, and foot placement remain visually distinguishable; the face remains a readable skin-tone cluster, while individual facial features are not reliably separable at 1x.'
    ],
    unknown: [
      'human approval',
      'whether every role variant can preserve this silhouette at 24x40',
      'runtime animation quality',
      'final palette consistency across all 22 character roles'
    ],
    gates: {
      sourceGrid4x3: sourceFrames.length === 12,
      nativeSheet96x120: (await sharp(normalizedSheet).metadata()).width === 96 && (await sharp(normalizedSheet).metadata()).height === 120,
      gridAlignable,
      normalizedPartialAlphaZero: normalizedFrames.every((entry) => entry.normalizedAudit.partialAlphaPixels === 0),
      sharedScaleNoEnlargement: commonScale > 0 && commonScale < 1,
      boardScaleSheet96x120: (await sharp(boardScaleSheet).metadata()).width === 96 && (await sharp(boardScaleSheet).metadata()).height === 120,
      boardScaleGridAlignable,
      boardScalePartialAlphaZero: boardFrames.every((entry) => entry.normalizedAudit.partialAlphaPixels === 0),
      boardScaleNoEnlargement: boardScale > 0 && boardScale < 1,
      boardScaleAnimationPairsDistinct: allAnimationPairsDistinct,
      approvalAbsent: true,
      definitionRebindAbsent: true
    },
    cleanedAlphaAudit: {
      transparentPixels: cleanedAudit.visiblePixels === 0 ? cleanedDecoded.info.width * cleanedDecoded.info.height : cleanedDecoded.info.width * cleanedDecoded.info.height - cleanedAudit.visiblePixels,
      partialAlphaPixels: cleanedAudit.partialAlphaPixels,
      visiblePixelsAboveZero: cleanedAudit.visiblePixels,
      visibleColorCount: cleanedAudit.visibleColorCount,
      bbox: cleanedAudit.bbox
    },
    grid: {
      sourceDimensions: { width: cleanedDecoded.info.width, height: cleanedDecoded.info.height },
      sourceColumnEdges: columnEdges,
      sourceRowEdges: rowEdges,
      sourceColumnOrderObserved: SOURCE_COLUMN_ORDER,
      normalizedColumnOrder: NORMALIZED_COLUMN_ORDER,
      normalizedColumnSources: NORMALIZED_COLUMN_SOURCES,
      rowOrder: ROW_ORDER,
      commonScale,
      frames: normalizedFrames.map((entry) => ({
        sourceColumn: entry.sourceColumn,
        row: entry.row,
        sourceCell: entry.cell,
        sourceBbox: entry.audit.bbox,
        sourcePartialAlphaPixels: entry.audit.partialAlphaPixels,
        normalizedBbox: entry.normalizedAudit.bbox,
        normalizedVisiblePixels: entry.normalizedAudit.visiblePixels,
        normalizedVisibleColorCount: entry.normalizedAudit.visibleColorCount,
        normalizedPartialAlphaPixels: entry.normalizedAudit.partialAlphaPixels
      }))
    },
    boardScale: {
      outputPath: `review/${WAVE_ID}-native-board-scale-96x120.png`,
      checkerPreviewPath: `review/${WAVE_ID}-native-board-scale-checker-preview.png`,
      worldComparisonPath: `review/${WAVE_ID}-native-board-scale-world-comparison.png`,
      frame: { width: FRAME.width, height: FRAME.height },
      target: {
        maxVisibleWidth: BOARD_SCALE.maxWidth,
        maxVisibleHeight: BOARD_SCALE.maxHeight,
        minTopMargin: BOARD_SCALE.minTopMargin,
        footBaselineYExclusive: FRAME.height
      },
      commonScale: boardScale,
      columnOrder: NORMALIZED_COLUMN_ORDER,
      rowOrder: ROW_ORDER,
      normalization: 'nearest-neighbor downscale only; hard alpha; shared scale; horizontal centering; common foot baseline',
      proposedCharacter22Contract: {
        frame: { width: 24, height: 40 },
        visibleBboxHeight: { min: 28, max: 32 },
        baseline: 'same across all directions and animation rows',
        enlargement: 'forbidden',
        columns: ['front', 'back', 'left', 'right'],
        rows: ['idle', 'walk1', 'walk2']
      },
      nativeReadability: {
        allTwelvePosesKeepDirectionalAndAnimationMeaning: true,
        face: 'Readable as a skin-tone face cluster at 1x; individual facial features are not reliably separable.',
        hat: 'Readable as a distinct dark hat silhouette at 1x.',
        bag: 'Readable as a contrasting side/back block at 1x where exposed by direction.',
        footfall: 'Readable through native silhouette changes; every idle/walk pair has non-zero silhouette difference.',
        assessmentClass: 'visual inference supported by numeric silhouette-difference audit; Lead approval still required'
      },
      frames: boardFrames.map((entry) => ({
        sourceColumn: entry.sourceColumn,
        normalizedColumn: NORMALIZED_COLUMN_SOURCES.indexOf(entry.sourceColumn),
        direction: NORMALIZED_COLUMN_ORDER[NORMALIZED_COLUMN_SOURCES.indexOf(entry.sourceColumn)],
        row: entry.row,
        pose: ROW_ORDER[entry.row],
        bbox: entry.normalizedAudit.bbox,
        visiblePixels: entry.normalizedAudit.visiblePixels,
        visibleColorCount: entry.normalizedAudit.visibleColorCount,
        partialAlphaPixels: entry.normalizedAudit.partialAlphaPixels
      })),
      animationDifferences
    }
  };
  if (Object.values(provenance.gates).some((value) => !value)) throw new Error(`Character basis gate failure: ${JSON.stringify(provenance.gates)}`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-audit.json`), `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(path.join(REVIEW_ROOT, `${WAVE_ID}-pending-reference-record.json`), `${JSON.stringify({ schemaVersion: 1, ...provenance.candidateReference, provenance: provenance.provenance }, null, 2)}\n`);
}

await main();
