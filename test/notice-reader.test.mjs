import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeRegion } from '../web/notice-reader.js';
import { dojoNotice } from '../web/notices.js';

test('narrow notices fit half the viewport and avoid the whole player sprite', () => {
  for (const height of [320, 568, 844, 900]) {
    for (const h of [64, 96]) {
      for (let y = -h / 2; y <= height - h / 2; y++) {
        const region = noticeRegion({ y, h }, height);
        const top = region.top ? 8 : height - 8 - region.height;
        const bottom = top + region.height;
        assert.ok(region.height > 0 && region.height <= height / 2);
        assert.ok(top >= 8 && bottom <= height - 8);
        assert.ok(bottom <= y - 8 || top >= y + h + 8);
      }
    }
  }
});

test('dojo signs use recorded facts and never promote an unverified or failed result', () => {
  assert.equal(dojoNotice({ buildings: [] }), null);
  const notice = (facts) => dojoNotice({ buildings: [{ facility: { archetype: 'dojo', facts } }] });
  const unverified = notice({ state: 'unverified' });
  assert.equal(unverified.title, '未確認');
  assert.ok(unverified.lines.some((line) => line.includes('記録が見当たりません')));
  const failed = notice({ state: 'failed', latestRecord: { tool: 'node --test', failures: 3 } });
  assert.equal(failed.title, '壊れている');
  assert.ok(failed.lines.some((line) => line.includes('3件が通っていません')));
  const passed = notice({ state: 'passed', latestRecord: { tool: 'node --test', failures: 0 } });
  assert.equal(passed.title, '検査通過済み');
  assert.ok(passed.lines.some((line) => line.includes('失敗0件')));
});
