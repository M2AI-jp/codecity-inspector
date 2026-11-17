import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronJa, creatureVoice } from '../web/dialogue/creature-voices.js';

test('猫の時刻は日・曜日・間隔を言葉にし、時刻と分を取り違えない', () => {
  const examples = {
    '0 3 * * *': '毎日 3 時',
    '0 9 * * 1': '毎週月曜 9 時',
    '30 9 * * 7': '毎週日曜 9 時 30 分',
    '*/15 * * * *': '15 分ごと',
    '*/1 * * * *': '1 分ごと',
    '0 * * * *': '毎時 0 分',
    '17 0,6,12,18 * * 1-5': '月曜から金曜の 0 時 17 分・6 時 17 分・12 時 17 分・18 時 17 分',
  };
  for (const [cron, expected] of Object.entries(examples)) assert.equal(cronJa(cron), expected);
});

test('読み取れない式と、毎時の境界で間隔が変わる式は推測せずまとめる', () => {
  for (const cron of ['*/17 * * * *', '*/0 * * * *', '0 24 * * *', '60 3 * * *', '0 3 1 * 1', '0 3 * 2 *',
    '0 3 * * MON', '@daily', '* * * * * *', '0 3 * * 9', '', null]) {
    assert.equal(cronJa(cron), '決まった時刻に動く', String(cron));
  }
});

test('話す名前だけを短くし、根拠の完全なパスとUTCを残し、保存された根拠を変えない', () => {
  const d = {kind:'cat',meaning:'cron',name:'approve-stale-lead-maintainer-prs.yml',
    reason:'.github/workflows/approve-stale-lead-maintainer-prs.yml が決まった時間に動く（schedule・cron: 0 3 * * *）'};
  const original = structuredClone(d), voice = creatureVoice(d);
  assert.equal(voice.name, 'approve-stale-lead-main…');
  assert.equal(voice.reason, '毎日 3 時（UTC）。根拠: .github/workflows/approve-stale-lead-maintainer-prs.yml');
  assert.deepEqual(d, original);
  const fallback = creatureVoice({...d, reason:d.reason.replace('0 3 * * *','unknown')});
  assert.ok(!fallback.reason.includes('unknown'));
  assert.equal(creatureVoice({...d,name:'nightly.yaml'}).name,'nightly');
  assert.deepEqual(creatureVoice({kind:'dog',name:'bot',reason:'設定に名前がある'}),{name:'bot',reason:'設定に名前がある'});
});
