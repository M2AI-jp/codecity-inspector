import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import sharp from 'sharp';

const FRAME = Object.freeze({ width: 64, height: 128, rows: 4, columns: 10, pivotX: 32, pivotY: 120 });
const EXPECTED_COMPONENTS = FRAME.rows * FRAME.columns;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function componentSummary(indices, width) {
  let minX = width;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }
  return Object.freeze({
    indices: Object.freeze(indices),
    pixels: indices.length,
    bbox: Object.freeze({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }),
    center: Object.freeze({ x: sumX / indices.length, y: sumY / indices.length })
  });
}

function opaqueComponents(rgba, width, height, alphaCutoff) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const neighbors = [-1, 0, 1];
  for (let seed = 0; seed < width * height; seed += 1) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    if (rgba[seed * 4 + 3] < alphaCutoff) continue;
    const stack = [seed];
    const indices = [];
    while (stack.length) {
      const current = stack.pop();
      indices.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      for (const dy of neighbors) for (const dx of neighbors) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (visited[next]) continue;
        visited[next] = 1;
        if (rgba[next * 4 + 3] >= alphaCutoff) stack.push(next);
      }
    }
    components.push(componentSummary(indices, width));
  }
  return components;
}

function orderGrid(components, sourceWidth, sourceHeight) {
  assert(components.length === EXPECTED_COMPONENTS,
    `expected exactly ${EXPECTED_COMPONENTS} separated sprite components, found ${components.length}`);
  const byY = [...components].sort((left, right) => left.center.y - right.center.y || left.center.x - right.center.x);
  const rows = Array.from({ length: FRAME.rows }, (_, row) => byY.slice(row * FRAME.columns, (row + 1) * FRAME.columns)
    .sort((left, right) => left.center.x - right.center.x));
  for (const [rowIndex, row] of rows.entries()) {
    assert(row.length === FRAME.columns, `source row ${rowIndex} does not contain ${FRAME.columns} sprites`);
    const maxYSpread = Math.max(...row.map((entry) => entry.center.y)) - Math.min(...row.map((entry) => entry.center.y));
    assert(maxYSpread < sourceHeight / 7, `source row ${rowIndex} is not geometrically coherent`);
    for (let column = 1; column < row.length; column += 1) {
      assert(row[column - 1].center.x < row[column].center.x, `source row ${rowIndex} has overlapping or unordered sprite centers`);
    }
  }
  for (let row = 1; row < rows.length; row += 1) {
    const previous = rows[row - 1];
    const current = rows[row];
    assert(Math.max(...previous.map((entry) => entry.center.y)) < Math.min(...current.map((entry) => entry.center.y)),
      `source rows ${row - 1} and ${row} overlap vertically`);
  }
  const grid = rows.flat();
  assert(grid.every((entry) => entry.bbox.x >= 0 && entry.bbox.y >= 0
    && entry.bbox.x + entry.bbox.width <= sourceWidth && entry.bbox.y + entry.bbox.height <= sourceHeight),
  'source component is outside image bounds');
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function orderUniformGrid(source, alphaCutoff) {
  // Some generators preserve the requested 4×10 sheet layout but render a
  // sprite as several disconnected pixel islands (hair highlights, held props,
  // outlines). In that case component counting is intentionally fail-closed,
  // but the declared grid gives us an equally deterministic boundary. This
  // path is opt-in: callers must explicitly assert that the source is a 4×10
  // uniformly partitioned grid.
  const rows = [];
  for (let row = 0; row < FRAME.rows; row += 1) {
    const top = Math.floor(row * source.height / FRAME.rows);
    const bottom = Math.floor((row + 1) * source.height / FRAME.rows);
    const entries = [];
    for (let column = 0; column < FRAME.columns; column += 1) {
      const left = Math.floor(column * source.width / FRAME.columns);
      const right = Math.floor((column + 1) * source.width / FRAME.columns);
      const indices = [];
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
        const index = y * source.width + x;
        if (source.rgba[index * 4 + 3] >= alphaCutoff) indices.push(index);
      }
      assert(indices.length >= 32, `uniform-grid cell ${row},${column} has no usable opaque sprite pixels`);
      entries.push(componentSummary(indices, source.width));
    }
    rows.push(Object.freeze(entries));
  }
  return Object.freeze(rows);
}

function mergeComponentGroup(group, sourceWidth) {
  return componentSummary(group.flatMap((component) => component.indices), sourceWidth);
}

function splitFragmentedStrip(components, sourceWidth) {
  const maxInternalGap = Math.max(16, Math.floor(sourceWidth / 100));
  const groups = [];
  for (const component of [...components].sort((left, right) => left.bbox.x - right.bbox.x || left.bbox.y - right.bbox.y)) {
    const current = groups.at(-1);
    if (!current || component.bbox.x > current.maxX + maxInternalGap) {
      groups.push({ components: [component], maxX: component.bbox.x + component.bbox.width - 1 });
      continue;
    }
    current.components.push(component);
    current.maxX = Math.max(current.maxX, component.bbox.x + component.bbox.width - 1);
  }
  return groups.map((group) => mergeComponentGroup(group.components, sourceWidth));
}

function orderStrip(components, sourceWidth, sourceHeight, stripIndex) {
  // A generator can render a held mug or a trailing hand as a detached pixel
  // island. That does not turn it into a second animation frame. Accept only
  // the unambiguous case where horizontally-local fragments reconstruct into
  // ten groups; any other count still fails closed.
  const grouped = components.length === FRAME.columns
    ? components
    : splitFragmentedStrip(components, sourceWidth);
  assert(grouped.length === FRAME.columns,
    `strip ${stripIndex} must contain exactly ${FRAME.columns} separated sprite groups, found ${grouped.length} from ${components.length} components`);
  const row = [...grouped].sort((left, right) => left.center.x - right.center.x || left.center.y - right.center.y);
  const maxYSpread = Math.max(...row.map((entry) => entry.center.y)) - Math.min(...row.map((entry) => entry.center.y));
  assert(maxYSpread < sourceHeight / 4, `strip ${stripIndex} is not a coherent horizontal sprite row`);
  for (let column = 1; column < row.length; column += 1) {
    assert(row[column - 1].center.x < row[column].center.x, `strip ${stripIndex} has overlapping or unordered sprite centers`);
  }
  return Object.freeze(row);
}

function componentRaster(component, sourceRgba, sourceWidth) {
  const { bbox } = component;
  const output = Buffer.alloc(bbox.width * bbox.height * 4);
  for (const index of component.indices) {
    const x = index % sourceWidth;
    const y = Math.floor(index / sourceWidth);
    const sourceOffset = index * 4;
    const destinationOffset = ((y - bbox.y) * bbox.width + (x - bbox.x)) * 4;
    output[destinationOffset] = sourceRgba[sourceOffset];
    output[destinationOffset + 1] = sourceRgba[sourceOffset + 1];
    output[destinationOffset + 2] = sourceRgba[sourceOffset + 2];
    output[destinationOffset + 3] = 255;
  }
  return output;
}

function lowerBandCentroid(rgba, width, height) {
  let pixels = 0;
  let sumX = 0;
  for (let y = Math.max(0, height - 9); y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rgba[(y * width + x) * 4 + 3] === 0) continue;
    pixels += 1;
    sumX += x;
  }
  assert(pixels > 0, 'resized component has no opaque lower-band pixels');
  return sumX / pixels;
}

function bottomOpaqueRow(rgba, width, height) {
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > 0) return y;
    }
  }
  throw new Error('resized component has no opaque pixels');
}

async function normalizeComponent(component, sourceRgba, sourceWidth, targetVisibleHeight) {
  const source = componentRaster(component, sourceRgba, sourceWidth);
  const sourceWidthPixels = component.bbox.width;
  const sourceHeightPixels = component.bbox.height;
  const scaledWidth = Math.max(1, Math.round(sourceWidthPixels * targetVisibleHeight / sourceHeightPixels));
  if (scaledWidth > 60) return null;
  const decoded = await sharp(source, {
    raw: { width: sourceWidthPixels, height: sourceHeightPixels, channels: 4 }
  }).resize({
    width: scaledWidth,
    height: targetVisibleHeight,
    fit: 'fill',
    kernel: sharp.kernel.nearest
  }).raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(decoded.data);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) pixels.fill(0, offset, offset + 4);
    else pixels[offset + 3] = 255;
  }
  const centroid = lowerBandCentroid(pixels, decoded.info.width, decoded.info.height);
  const soleRow = bottomOpaqueRow(pixels, decoded.info.width, decoded.info.height);
  const left = FRAME.pivotX - Math.round(centroid);
  // Nearest-neighbour downscaling can leave the bottom raster row transparent
  // for a single frame. Align the actual opaque sole row, not the input box,
  // so every frame satisfies the common foot-pivot contract.
  const top = FRAME.pivotY - soleRow;
  if (left < 0 || left + decoded.info.width > FRAME.width || top < 0 || top + decoded.info.height > FRAME.height) return null;
  return Object.freeze({
    png: await sharp(pixels, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer(),
    left,
    top,
    visible: Object.freeze({ width: decoded.info.width, height: decoded.info.height }),
    lowerBandCentroid: centroid
  });
}

async function decodeSource(input, alphaCutoff) {
  const decoded = await sharp(input, { animated: false, failOn: 'error' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return Object.freeze({
    rgba: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    components: opaqueComponents(decoded.data, decoded.info.width, decoded.info.height, alphaCutoff)
      .filter((component) => component.pixels >= 32)
  });
}

async function assembleEntries(entries, sourceReport, {
  alphaCutoff,
  targetVisibleHeight
}) {
  assert(entries.length === EXPECTED_COMPONENTS, `expected ${EXPECTED_COMPONENTS} component entries`);
  let selectedHeight = null;
  let normalizedComponents = null;
  for (let visibleHeight = targetVisibleHeight; visibleHeight >= 32; visibleHeight -= 1) {
    const trial = await Promise.all(entries.map(({ component, source }) => normalizeComponent(
      component,
      source.rgba,
      source.width,
      visibleHeight
    )));
    if (trial.every(Boolean)) {
      selectedHeight = visibleHeight;
      normalizedComponents = trial;
      break;
    }
  }
  assert(normalizedComponents, 'no common visible height from 32 through the requested target can fit all sprites without clipping');
  const composites = [];
  const placements = [];
  for (const [componentIndex, entry] of entries.entries()) {
    const { component } = entry;
    const rowIndex = Math.floor(componentIndex / FRAME.columns);
    const columnIndex = componentIndex % FRAME.columns;
    const normalized = normalizedComponents[componentIndex];
    composites.push({
      input: normalized.png,
      left: columnIndex * FRAME.width + normalized.left,
      top: rowIndex * FRAME.height + normalized.top
    });
    placements.push(Object.freeze({
      row: rowIndex,
      column: columnIndex,
      source: Object.freeze({ pixels: component.pixels, bbox: component.bbox, center: component.center }),
    target: Object.freeze({ left: normalized.left, top: normalized.top, visible: normalized.visible, lowerBandCentroid: normalized.lowerBandCentroid })
    }));
  }
  const output = await sharp({
    create: { width: FRAME.width * FRAME.columns, height: FRAME.height * FRAME.rows, channels: 4, background: '#00000000' }
  }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  return Object.freeze({
    output,
    report: Object.freeze({
      format: 'fable5-character-sheet-assembly-v1',
      source: sourceReport,
      output: Object.freeze({ width: FRAME.width * FRAME.columns, height: FRAME.height * FRAME.rows, frame: FRAME, targetVisibleHeight: selectedHeight }),
      placements: Object.freeze(placements)
    })
  });
}

/**
 * Deterministically turns a chroma-removed, visually separated 4×10 source
 * into the exact Fable5 640×512 sheet. This is an assembly step only: it
 * never approves, exports, or installs the resulting candidate.
 */
export async function assembleFable5CharacterSheet(input, {
  alphaCutoff = 180,
  targetVisibleHeight = 72,
  sourceLayout = 'components'
} = {}) {
  assert(Buffer.isBuffer(input), 'input must be a PNG buffer');
  assert(Number.isInteger(alphaCutoff) && alphaCutoff >= 1 && alphaCutoff <= 255, 'alphaCutoff must be an integer from 1 to 255');
  assert(Number.isInteger(targetVisibleHeight) && targetVisibleHeight >= 32 && targetVisibleHeight <= FRAME.pivotY,
    'targetVisibleHeight must be an integer from 32 through 120');
  assert(['components', 'uniform-grid'].includes(sourceLayout), "sourceLayout must be 'components' or 'uniform-grid'");
  const source = await decodeSource(input, alphaCutoff);
  const rows = sourceLayout === 'components'
    ? orderGrid(source.components, source.width, source.height)
    : orderUniformGrid(source, alphaCutoff);
  return assembleEntries(rows.flat().map((component) => ({ component, source })), Object.freeze({
    width: source.width,
    height: source.height,
    components: source.components.length,
    alphaCutoff,
    layout: sourceLayout
  }), { alphaCutoff, targetVisibleHeight });
}

/**
 * Variant for four independently generated direction strips. It enforces ten
 * disconnected sprites in every source strip before assembling their rows in
 * the supplied order (south, west, east, north).
 */
export async function assembleFable5CharacterSheetFromStrips(inputs, {
  alphaCutoff = 180,
  targetVisibleHeight = 72
} = {}) {
  assert(Array.isArray(inputs) && inputs.length === FRAME.rows && inputs.every(Buffer.isBuffer),
    'inputs must contain exactly four PNG buffers ordered south, west, east, north');
  assert(Number.isInteger(alphaCutoff) && alphaCutoff >= 1 && alphaCutoff <= 255, 'alphaCutoff must be an integer from 1 to 255');
  assert(Number.isInteger(targetVisibleHeight) && targetVisibleHeight >= 32 && targetVisibleHeight <= FRAME.pivotY,
    'targetVisibleHeight must be an integer from 32 through 120');
  const sources = await Promise.all(inputs.map((input) => decodeSource(input, alphaCutoff)));
  const entries = sources.flatMap((source, stripIndex) => orderStrip(source.components, source.width, source.height, stripIndex)
    .map((component) => ({ component, source })));
  return assembleEntries(entries, Object.freeze({
    strips: Object.freeze(sources.map((source, index) => Object.freeze({
      index,
      width: source.width,
      height: source.height,
      components: source.components.length,
      groups: orderStrip(source.components, source.width, source.height, index).length,
      alphaCutoff
    })))
  }), { alphaCutoff, targetVisibleHeight });
}

function parseOptions(argv) {
  const parsed = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value == null || Object.hasOwn(parsed, key.slice(2))) throw new Error(`Invalid option near ${key ?? '<end>'}`);
    parsed[key.slice(2)] = value;
  }
  const unexpected = Object.keys(parsed).filter((key) => !['input', 'inputs', 'output', 'report', 'alpha-cutoff', 'target-visible-height', 'source-layout'].includes(key));
  if (unexpected.length) throw new Error(`Unsupported option --${unexpected[0]}`);
  if ((Boolean(parsed.input) === Boolean(parsed.inputs)) || !parsed.output || !parsed.report) {
    throw new Error('provide exactly one of --input or --inputs, plus --output and --report');
  }
  return parsed;
}

async function runCli() {
  const args = parseOptions(process.argv.slice(2));
  const options = {
    alphaCutoff: args['alpha-cutoff'] == null ? undefined : Number(args['alpha-cutoff']),
    targetVisibleHeight: args['target-visible-height'] == null ? undefined : Number(args['target-visible-height']),
    sourceLayout: args['source-layout']
  };
  if (args.inputs && args['source-layout']) throw new Error('--source-layout applies only to a single --input sheet');
  const assembled = args.input
    ? await assembleFable5CharacterSheet(await readFile(args.input), options)
    : await assembleFable5CharacterSheetFromStrips(await Promise.all(args.inputs.split(',').map((entry) => readFile(entry))), options);
  await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await mkdir(path.dirname(path.resolve(args.report)), { recursive: true });
  await writeFile(args.output, assembled.output);
  await writeFile(args.report, `${JSON.stringify(assembled.report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(args.output), report: path.resolve(args.report), ...assembled.report.output })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
