import assert from 'node:assert/strict';
import test from 'node:test';
import { boundaryProblems, importSpecifiers, moduleNumber } from './import-boundary.mjs';

test('recognizes module ownership and import forms', () => {
  assert.equal(moduleNumber('ship/40-worldgen/generate.mjs'), '40');
  assert.equal(moduleNumber('studio/quality/check.mjs'), null);
  assert.deepEqual(importSpecifiers("import x from '../30-town-domain/index.mjs'; export { y } from './y.mjs';"), [
    '../30-town-domain/index.mjs',
    './y.mjs'
  ]);
});

test('allows declared public dependency', () => {
  assert.deepEqual(
    boundaryProblems('ship/40-worldgen/generate.mjs', "import { build } from '../30-town-domain/index.mjs';"),
    []
  );
});

test('rejects reverse and deep imports', () => {
  assert.match(
    boundaryProblems('ship/20-semantics/index.mjs', "import x from '../40-worldgen/index.mjs';")[0],
    /may not import module 40/
  );
  assert.match(
    boundaryProblems('ship/40-worldgen/generate.mjs', "import x from '../30-town-domain/internal/model.mjs';").at(-1),
    /must resolve.*index\.mjs/
  );
});

test('rejects shipping references to studio', () => {
  assert.match(
    boundaryProblems('ship/10-inspect/index.mjs', "const forbidden = '../../../studio/file.json';")[0],
    /may not reference studio/
  );
});
