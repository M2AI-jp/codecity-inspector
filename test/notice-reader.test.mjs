import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeRegion, wideNoticeRegion } from '../web/notice-reader.js';
import { dojoNotice, dojoSigns } from '../web/notices.js';

test('dojo notices select native signs from the current world, excluding overlay records', () => {
  const prop = (type, overlayId) => ({ type, data: { overlayId } });
  const plain = prop('sign-unverified');
  const native = ['passed', 'failed', 'unverified'].map((state, i) => prop(`sign-${state}`, `native:dojo:${i}`));
  const records = ['passed', 'failed', 'unverified'].map((state) => prop(`sign-${state}`, `marker:${state}`));
  const world = { props: [plain, ...native, ...records, prop('noticeboard', 'native:dojo:3')] };
  assert.deepEqual(dojoSigns(world), [plain, ...native]);
  // Live overlay apply replaces the prop array; old sign objects must not remain readable.
  world.props = records;
  assert.deepEqual(dojoSigns(world), []);
  const restored = prop('sign-unverified', 'native:dojo:0');
  world.props = [...records, restored];
  assert.deepEqual(dojoSigns(world), [restored]);
});

test('wide notices keep non-overlapping rectangles, including horizontally separated README boxes', () => {
  const player = { x: 618, y: 393, w: 96, h: 96 };
  for (const panel of [
    { x: 460, y: 18, w: 520, h: 116 },
    { x: 460, y: 766, w: 520, h: 116 },
    { x: 14, y: 350, w: 604, h: 532 },
    { x: 714, y: 350, w: 620, h: 532 },
  ]) assert.equal(wideNoticeRegion(panel, player, 900), null);
});

test('wide notices flip only on collision and fit the opposite side of the whole sprite', () => {
  for (const edges of [{ top: 18, bottom: 18 }, { top: 32, bottom: 18 }]) {
    for (const top of [true, false]) {
      const panel = { x: 460, y: top ? edges.top : 900 - edges.bottom - 426, w: 520, h: 426 };
      for (let y = 180; y <= 600; y++) {
        const player = { x: 618, y, w: 96, h: 96 };
        const region = wideNoticeRegion(panel, player, 900, edges);
        const collides = panel.y < y + 96 && panel.y + panel.h > y;
        assert.equal(!!region, collides);
        if (!region) continue;
        assert.equal(region.top, !top);
        assert.ok(region.height > 0 && region.height <= panel.h);
        const py = region.top ? edges.top : 900 - edges.bottom - region.height;
        assert.ok(py >= edges.top && py + region.height <= 900 - edges.bottom);
        assert.ok(py + region.height <= y - 8 || py >= y + 96 + 8);
      }
    }
  }
});

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
