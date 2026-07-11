import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanRepository } from '../src/scanner.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecity-scan-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  return root;
}

test('scans static local JS/TS links without executing or returning source bodies', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ main: './src/index.js' }));
  await writeFile(path.join(root, 'src', 'index.js'), `
    import './util.js';
    import { value } from './value.ts';
    export { later } from './later.js';
    const lazy = import('./lazy.js', { with: { type: 'javascript' } });
    const text = "require('./not-real.js')";
    const pattern = /import '.\\/ghost.js'/;
    obj.require('./also-ghost.js');
    const template = \`import './template-ghost.js'; require('./template-ghost-two.js')\`;
    // require('./comment.js')
    /* import './comment-two.js' */
    export const secret = 'TOP_SECRET_SOURCE_BODY';
  `);
  for (const name of ['util.js', 'value.ts', 'later.js', 'lazy.js']) {
    await writeFile(path.join(root, 'src', name), 'export const value = 1;\n');
  }

  const scan = await scanRepository(root);
  assert.equal(scan.summary.filesScanned, 5);
  assert.deepEqual(scan.entrypoints, [{ path: 'src/index.js', evidence: 'package.json:main' }]);
  assert.deepEqual(
    scan.edges.map(({ from, to, kind, status }) => ({ from, to, kind, status })),
    [
      { from: 'src/index.js', to: 'src/util.js', kind: 'import', status: 'resolved' },
      { from: 'src/index.js', to: 'src/value.ts', kind: 'import', status: 'resolved' },
      { from: 'src/index.js', to: 'src/later.js', kind: 'export', status: 'resolved' },
      { from: 'src/index.js', to: 'src/lazy.js', kind: 'dynamic-import', status: 'resolved' }
    ]
  );
  assert.equal(JSON.stringify(scan).includes('TOP_SECRET_SOURCE_BODY'), false);
  assert.equal(JSON.stringify(scan).includes('not-real.js'), false);
  assert.equal(JSON.stringify(scan).includes('ghost.js'), false);
});

test('skips regex literals after control headers without hiding imports in division expressions', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'src', 'index.js'), `
    if (true) /import '.\\/ghost.js'/.test('x');
    if ((true)) /require\\('.\\/nested-ghost.js'\\)/.test('x');
    while (false) /import\\('.\\/while-ghost.js'\\)/.test('x');
    for (; false;) /export .* from '.\\/for-ghost.js'/.test('x');
    import './real.js';
    const ratio = 10 / import('./ratio.js');
    const memberRatio = object.if(true) / import('./member-ratio.js');
  `);
  await writeFile(path.join(root, 'src', 'member-ratio.js'), 'export const memberRatio = true;\n');
  await writeFile(path.join(root, 'src', 'real.js'), 'export const real = true;\n');
  await writeFile(path.join(root, 'src', 'ratio.js'), 'export const ratio = true;\n');

  const scan = await scanRepository(root);
  assert.deepEqual(
    scan.edges.map(({ from, to, kind, status }) => ({ from, to, kind, status })),
    [
      { from: 'src/index.js', to: 'src/real.js', kind: 'import', status: 'resolved' },
      { from: 'src/index.js', to: 'src/ratio.js', kind: 'dynamic-import', status: 'resolved' },
      { from: 'src/index.js', to: 'src/member-ratio.js', kind: 'dynamic-import', status: 'resolved' }
    ]
  );
  assert.equal(JSON.stringify(scan).includes('ghost.js'), false);
});

test('does not read an object key named import as a static import statement', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'src', 'index.js'), `
    const options = { import: { from: './ghost.js' } };
    import './real.js';
  `);
  await writeFile(path.join(root, 'src', 'real.js'), 'export const real = true;\n');

  const scan = await scanRepository(root);
  assert.deepEqual(
    scan.edges.map(({ from, to, kind, status }) => ({ from, to, kind, status })),
    [{ from: 'src/index.js', to: 'src/real.js', kind: 'import', status: 'resolved' }]
  );
  assert.equal(JSON.stringify(scan).includes('ghost.js'), false);
});

test('parses JSX, TS, TSX, ESM, and CommonJS without reading dependency-like text', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'src', 'common.cjs'), "const real = require('./cjs-real.js'); obj.require('./member-ghost.js');\n");
  await writeFile(path.join(root, 'src', 'cjs-real.js'), 'module.exports = true;\n');
  await writeFile(path.join(root, 'src', 'jsx-real.js'), 'export const jsxReal = true;\n');
  await writeFile(path.join(root, 'src', 'model.ts'), 'export const model: string = "ok";\n');
  await writeFile(path.join(root, 'src', 'module.mjs'), "export { mjsReal } from './mjs-real.js';\n");
  await writeFile(path.join(root, 'src', 'mjs-real.js'), 'export const mjsReal = true;\n');
  await writeFile(path.join(root, 'src', 'panel.tsx'), "import { model } from './model.ts'; export const Panel = () => <section>{model}</section>;\n");
  await writeFile(path.join(root, 'src', 'types.ts'), "import type { Model } from './model.ts'; export type ViewModel = Model;\n");
  await writeFile(path.join(root, 'src', 'view.jsx'), `
    if (true) {} /import '.\\/block-ghost.js'/.test('x'); export function View(){ return <div>import './jsx-ghost.js'</div>; }
    import './jsx-real.js';
  `);

  const scan = await scanRepository(root);
  assert.deepEqual(
    scan.edges.map(({ from, to, kind, status }) => ({ from, to, kind, status })),
    [
      { from: 'src/common.cjs', to: 'src/cjs-real.js', kind: 'require', status: 'resolved' },
      { from: 'src/module.mjs', to: 'src/mjs-real.js', kind: 'export', status: 'resolved' },
      { from: 'src/panel.tsx', to: 'src/model.ts', kind: 'import', status: 'resolved' },
      { from: 'src/types.ts', to: 'src/model.ts', kind: 'import', status: 'resolved' },
      { from: 'src/view.jsx', to: 'src/jsx-real.js', kind: 'import', status: 'resolved' }
    ]
  );
  assert.equal(JSON.stringify(scan).includes('ghost.js'), false);
});

test('records parser failures and bounded AST walks as unknown instead of broken links', async () => {
  const parseRoot = await fixture();
  await writeFile(path.join(parseRoot, 'src', 'broken.js'), 'import {\n');

  const parseFailure = await scanRepository(parseRoot);
  assert.equal(parseFailure.edges.length, 0);
  assert.equal(parseFailure.nodes.some((node) => node.path === 'src/broken.js'), true);
  assert.equal(parseFailure.skipCounts['parse-error-or-unsupported-syntax'], 1);
  assert.equal(parseFailure.summary.truncated, true);
  assert.equal(parseFailure.summary.truncation.analysis, true);

  const limitedRoot = await fixture();
  await writeFile(path.join(limitedRoot, 'src', 'index.js'), "import './real.js';\n");
  await writeFile(path.join(limitedRoot, 'src', 'real.js'), 'export const real = true;\n');

  const limited = await scanRepository(limitedRoot, { maxAstNodes: 1 });
  assert.equal(limited.edges.length, 0);
  assert.equal(limited.skipCounts['max-ast-nodes'], 2);
  assert.equal(limited.summary.astNodesVisited, 1);
  assert.equal(limited.summary.truncation.analysis, true);
});

test('reports unresolved, outside-root, ignored, and symlinked paths without following them', async () => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'codecity-outside-'));
  await writeFile(path.join(outside, 'outside.js'), 'throw new Error("must never run");\n');
  await writeFile(path.join(root, 'src', 'index.js'), `
    import './missing.js';
    import '../../outside.js';
  `);
  await symlink(path.join(outside, 'outside.js'), path.join(root, 'src', 'linked.js'));
  await mkdir(path.join(root, 'node_modules', 'bad'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'bad', 'index.js'), 'throw new Error("must never scan");\n');

  const scan = await scanRepository(root);
  assert.deepEqual(scan.edges.map((edge) => edge.status), ['unresolved', 'outside-root']);
  assert.equal(scan.skipCounts['symbolic-link'], 1);
  assert.equal(scan.skipCounts['ignored-directory'], 1);
  assert.equal(scan.nodes.some((node) => node.path.includes('node_modules')), false);
  assert.equal(scan.nodes.some((node) => node.path.endsWith('linked.js')), false);
});

test('enforces file and byte limits and distinguishes an existing unscanned target', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'src', 'a.js'), "import './b.js';\n");
  await writeFile(path.join(root, 'src', 'b.js'), 'export const b = true;\n');

  const fileLimited = await scanRepository(root, { maxFiles: 1 });
  assert.equal(fileLimited.summary.truncated, true);
  assert.equal(fileLimited.summary.filesScanned, 1);
  assert.equal(fileLimited.summary.omittedFiles, 1);
  assert.equal(fileLimited.edges[0].status, 'not-scanned');
  assert.equal(fileLimited.skipCounts['max-files'], 1);

  const byteLimited = await scanRepository(root, { maxBytes: 10, maxFileBytes: 100 });
  assert.equal(byteLimited.summary.filesScanned, 0);
  assert.equal(byteLimited.summary.omittedFiles, 2);
  assert.equal(byteLimited.skipCounts['max-total-bytes'], 2);
});

test('classifies non-resolvable dependencies as unknown without calling them broken', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'src', 'index.js'), `
    import './missing.js';
    import '../../outside.js';
    import '@/configured-alias.js';
    import 'third-party-package';
    import 'node:fs';
    import './settings.json';
    import(runtimeTarget);
    require(runtimeTarget);
  `);

  const scan = await scanRepository(root);
  assert.deepEqual(scan.edges.map((edge) => edge.status), [
    'unresolved',
    'outside-root',
    'alias-unknown',
    'external-or-alias',
    'unsupported',
    'unsupported',
    'runtime-unknown',
    'runtime-unknown'
  ]);
  assert.equal(scan.edges.filter((edge) => edge.status === 'unresolved').length, 1);
});

test('bounds directory traversal, entry discovery, and recorded dependency edges', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), "import './one.js'; import './two.js'; import './three.js';\n");
  await writeFile(path.join(root, 'src', 'b.js'), 'export const b = true;\n');
  await writeFile(path.join(root, 'src', 'nested', 'c.js'), 'export const c = true;\n');

  const directoryLimited = await scanRepository(root, { maxDirectories: 1 });
  assert.equal(directoryLimited.summary.truncated, true);
  assert.equal(directoryLimited.summary.truncation.traversal, true);
  assert.equal(directoryLimited.skipCounts['max-directories'], 1);

  const entryLimited = await scanRepository(root, { maxEntries: 1 });
  assert.equal(entryLimited.summary.truncated, true);
  assert.equal(entryLimited.summary.truncation.discovery, true);
  assert.equal(entryLimited.skipCounts['max-entries'], 1);

  const edgeLimited = await scanRepository(root, { maxEdges: 2 });
  assert.equal(edgeLimited.edges.length, 2);
  assert.equal(edgeLimited.summary.edgesOmitted, 1);
  assert.equal(edgeLimited.summary.truncated, true);
  assert.equal(edgeLimited.summary.truncation.edges, true);
});
