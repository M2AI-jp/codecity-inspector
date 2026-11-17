import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTown } from '../src/layout.mjs';
import { parseReadme } from '../src/analyze/readme.mjs';

test('空白や画像だけのREADMEは表示する中身がない', () => {
  for (const text of ['', ' \n ', '![logo](logo.png)\n', '<!-- comment -->\n']) {
    assert.equal(parseReadme('/repo', [{ path: 'README.md' }], () => text), null);
  }
  assert.deepEqual(parseReadme('/repo', [{ path: 'README.md' }], () => '# 案内\n\n街の説明'),
    { title: '案内', excerpt: '街の説明' });
});

test('掲示板は見せるREADMEの題名か本文がある場合だけ置く', () => {
  const repo = { name: 'noticeboard', head: '1234567', modules: [], facilities: [] };
  for (const readme of [null, undefined, { title: '', excerpt: ' \n ' }]) {
    assert.equal(layoutTown({ ...repo, readme }).props.some((p) => p.type === 'noticeboard'), false);
  }
  for (const readme of [{ title: '案内', excerpt: '' }, { title: '', excerpt: 'この街の説明です。' }]) {
    assert.equal(layoutTown({ ...repo, readme }).props.filter((p) => p.type === 'noticeboard').length, 1);
  }
});
