// 修理小屋の pg_dump / pg_restore 判定が線形で、普通の入力では前と同じに当たること。
// 修理小屋のために読むファイルに合計バイト数の上限があること。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasPgDumpAndRestore, hasFlyDeployImageBack, pickWithinBudget } from '../src/facilities.mjs';
import { analyzeRepository } from '../src/analyze.mjs';

// 前の判定（先読み2つ）。短い入力でだけ比べる。
const OLD = /(?=[\s\S]*\bpg_dump\b)(?=[\s\S]*\bpg_restore\b)/i;

const NORMAL = [
  'pg_dump -Fc mydb > db.dump\npg_restore -d mydb db.dump\n',
  'pg_restore -d mydb db.dump\n# made with pg_dump earlier\n',
  'PG_DUMP "$DB" | gzip\nPG_RESTORE --clean\n',
  'run: pg_dump $DATABASE_URL > out.sql && pg_restore out.sql',
  'pg_dump only, nothing to bring it back\n',
  'pg_restore only\n',
  'pg_dumpall > all.sql\npg_restore x\n',
  'xpg_dump\npg_restore\n',
  'pg_dump\npg_restore_extra\n',
  'pg-dump and pg-restore\n',
  '/usr/bin/pg_dump db; /usr/bin/pg_restore db\n',
  '"pg_dump","pg_restore"',
  '',
  'echo hello\n',
];

test('普通の入力では前の正規表現と同じ結果になる', () => {
  for (const s of NORMAL) assert.equal(hasPgDumpAndRestore(s), OLD.test(s), JSON.stringify(s));
  assert.equal(hasPgDumpAndRestore(NORMAL[0]), true);
  assert.equal(hasPgDumpAndRestore(NORMAL[4]), false);
});

test('256KB の長い入力でもすぐ終わる（pg_dump なし・pg_dump だけ・両方が末尾）', () => {
  const filler = 'echo hello world\n'.repeat((256 << 10) / 17 | 0);
  const dumpOnly = 'pg_dump x\n'.repeat((256 << 10) / 10 | 0);
  const both = filler + 'pg_dump a\npg_restore b\n';
  const t = performance.now();
  assert.equal(hasPgDumpAndRestore(filler), false);
  assert.equal(hasPgDumpAndRestore(dumpOnly), false);
  assert.equal(hasPgDumpAndRestore(both), true);
  for (let i = 0; i < 2500; i++) hasPgDumpAndRestore(filler.slice(0, 4096));
  const ms = performance.now() - t;
  assert.ok(ms < 1000, `遅すぎる: ${ms.toFixed(0)}ms`);
});

test('上限: 件数とバイト数の中で順に選び、入らないファイルは飛ばす', () => {
  const sizes = { a: 400, b: 700, c: 300, d: 200, e: 50 };
  const pick = (max, bytes) => pickWithinBudget(Object.keys(sizes), (p) => sizes[p], max, bytes);
  assert.deepEqual(pick(10, 10000), ['a', 'b', 'c', 'd', 'e']);   // 上限の中なら全部（今までと同じ）
  assert.deepEqual(pick(10, 1000), ['a', 'c', 'd', 'e']);         // b は入らないので飛ばす
  assert.deepEqual(pick(2, 10000), ['a', 'b']);                   // 件数の上限
  assert.deepEqual(pick(10, 0), []);
});

test('街の解析: バックアップの対は同じに見つかり、長い自動化ファイルでも遅くならない', { timeout: 30000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'codecity-recovery-'));
  try {
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'package.json'), '{"name":"t","private":true}\n');
    writeFileSync(join(root, 'scripts', 'db.sh'), '#!/bin/sh\npg_dump -Fc "$DB" > db.dump\npg_restore -d "$DB" db.dump\n');
    writeFileSync(join(root, 'scripts', 'dump-only.sh'), '#!/bin/sh\npg_dump -Fc "$DB" > db.dump\n');
    writeFileSync(join(root, 'scripts', 'dumpall.sh'), '#!/bin/sh\npg_dumpall > all.sql\npg_restore all.sql\n');
    writeFileSync(join(root, 'scripts', 'long.sh'), 'echo hello world\n'.repeat((250 << 10) / 17 | 0));   // 前の正規表現では何十秒もかかる
    const t = performance.now();
    const model = analyzeRepository(root);
    const ms = performance.now() - t;
    const repair = model.facilities.find((f) => f.archetype === 'repair');
    assert.ok(repair, '修理小屋がある');
    assert.deepEqual(repair.facts.backup, [
      { path: 'scripts/db.sh', detail: '「pg_dump と pg_restore」' },
      { path: 'scripts/db.sh', detail: '「pg_dump」と「pg_restore」の両方がある' },
    ]);
    assert.ok(ms < 15000, `遅すぎる: ${ms.toFixed(0)}ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 前の flyctl の判定。flyctl? のせいで fly deploy を見落としていた。
const OLD_FLY = /\bflyctl?\s+deploy\b[^\n]*(?:--image\b[^\n]*(?:rollback|revert|previous|old|restore|戻|切り戻)|(?:rollback|revert|previous|old|restore|戻|切り戻)[^\n]*--image\b)/i;

test('fly deploy / flyctl deploy の --image での戻しを見つける（両方の綴り）', () => {
  const yes = [
    'flyctl deploy --image registry.fly.io/app:previous',
    'fly deploy --image registry.fly.io/app:old',
    'FLY DEPLOY --IMAGE app:ROLLBACK',
    'flyctl deploy --strategy immediate --image "$PREVIOUS_IMAGE"',
    'flyctl deploy --app x  # 戻す: --image を指定',
    'run: flyctl deploy --app web --image ${{ inputs.restore_image }}',
  ];
  const no = [
    'flyct deploy --image app:old',          // 前の正規表現はこれに当たっていた
    'flyctl deploy --image app:v2',
    'flyctl deploy --remote-only',
    'flyctl deploy\n--image app:old',        // 別の行
    'rollback --image x flyctl deploy',      // fly deploy より前
    'flyctl deployment --image app:old',
    '',
  ];
  for (const s of yes) assert.equal(hasFlyDeployImageBack(s), true, s);
  for (const s of no) assert.equal(hasFlyDeployImageBack(s), false, s);
  // flyctl の綴りでは前の判定と同じ
  for (const s of [...yes, ...no].filter((x) => !/\bfly\s+deploy/i.test(x) && !/flyct\s/i.test(x))) assert.equal(hasFlyDeployImageBack(s), OLD_FLY.test(s), s);
});

test('flyctl: 長い1行でもすぐ終わる', () => {
  const t = performance.now();
  const line = 'flyctl deploy --image x '.repeat((256 << 10) / 24 | 0);
  assert.equal(hasFlyDeployImageBack(line), false);
  assert.equal(hasFlyDeployImageBack(line + ' old'), true);
  assert.equal(hasFlyDeployImageBack('fly deploy '.repeat(20000)), false);
  assert.equal(hasFlyDeployImageBack('a'.repeat(256 << 10)), false);
  const ms = performance.now() - t;
  assert.ok(ms < 1000, `遅すぎる: ${ms.toFixed(0)}ms`);
});
