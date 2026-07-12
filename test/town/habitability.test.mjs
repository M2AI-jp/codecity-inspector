// test/town/habitability.test.mjs
//
// Coverage for src/town/habitability.mjs: turning a TownModel into a
// Habitability verdict. Exercises the ladder (Lv.0..Lv.5), the single
// blocker rule ("no gate but something to enter" => canLive:false), the
// non-blocking warnings ("dirt" never lowers the level or blocks canLive),
// external contractor self-reports (always pending-inspection, NEVER
// rewarded with a higher level), evidence-separation honesty (an absent /
// unknown safeguard flag never false-fires a warning), tolerance of
// malformed input, and deep-freeze of the result.
//
// Two grounding shapes are used throughout: a hand-built TownModel (full
// control over every facility, so the ladder/blocker/warning rules can be
// pinned down exactly) and the real sample/tiny-town repository, run
// through the actual inspectRepository -> collectSignals -> buildTownModel
// pipeline. Both are static-only: inspectRepository and collectSignals only
// read files from disk (AST-parse / lstat / JSON-parse); the sample repo's
// own code, scripts, and tests are never executed by this test.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assessHabitability } from '../../src/town/habitability.mjs';
import { buildTownModel } from '../../src/town/detect.mjs';
import { collectSignals } from '../../src/town/signals.mjs';
import { FACILITY_KINDS, HABITABILITY_LEVELS, GUILD_TABS } from '../../src/town/schema.mjs';
import { inspectRepository } from '../../src/inspector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, '..', '..', 'sample', 'tiny-town');

const HEADLINE = 'このままだと誰も住めません！';
const GUILD_STATE_TAB = GUILD_TABS[GUILD_TABS.length - 1]; // 'じょうたい'

// --- hand-built fixture helpers ---------------------------------------------

/** One Facility fixture with sane, overridable defaults. */
function facility(kind, { present = true, count = 1, observed, inferred = [], unknown = [], details } = {}) {
  return {
    kind,
    present,
    count,
    evidence: {
      observed: observed ?? (present ? [`${kind}: observed for fixture`] : []),
      inferred,
      unknown: unknown.length > 0 ? unknown : (present || observed || inferred.length > 0 ? unknown : [`${kind}: no signal (fixture)`])
    },
    ...(details !== undefined ? { details } : {})
  };
}

/** One TownModel fixture; unspecified facility kinds default to absent. */
function town({ facilities = [], guild = {}, contractorReports = [] } = {}) {
  return {
    repository: { name: 'fixture-town' },
    facilities,
    guild,
    external: { contractorReports },
    summary: {}
  };
}

const townHall = () => facility('town_hall', { count: 1 });

// --- general shape / invariants ---------------------------------------------

test('return shape matches the Habitability contract for every scenario below', () => {
  const scenarios = [
    town(),
    town({ facilities: [townHall()] }),
    town({ facilities: [townHall(), facility('house')] }),
    town({ facilities: [townHall(), facility('gate'), facility('inn')] })
  ];
  for (const model of scenarios) {
    const result = assessHabitability(model);
    assert.deepEqual(Object.keys(result).sort(), [
      'blockers', 'canLive', 'level', 'levelName', 'pendingInspections', 'reasons', 'warnings'
    ].sort());
    assert.ok(Number.isInteger(result.level) && result.level >= 0 && result.level <= 5);
    assert.equal(result.levelName, HABITABILITY_LEVELS[result.level].name);
    assert.equal(typeof result.canLive, 'boolean');
    // MUST be false whenever blockers is non-empty; warnings never affect it.
    assert.equal(result.canLive, result.blockers.length === 0);
    for (const list of [result.blockers, result.warnings, result.pendingInspections, result.reasons]) {
      assert.ok(Array.isArray(list));
      assert.ok(list.every((line) => typeof line === 'string'));
    }
  }
});

test('the result is deep-frozen: top level and every nested list reject mutation', () => {
  const result = assessHabitability(town({ facilities: [townHall(), facility('gate'), facility('inn')] }));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
  assert.ok(Object.isFrozen(result.warnings));
  assert.ok(Object.isFrozen(result.pendingInspections));
  assert.ok(Object.isFrozen(result.reasons));
  assert.throws(() => { result.level = 5; }, TypeError);
  assert.throws(() => { result.warnings.push('x'); }, TypeError);
});

// --- never throws on malformed / absent input -------------------------------

test('never throws on null, undefined, or structurally malformed input; degrades to Lv.0 empty town', () => {
  for (const bad of [null, undefined, {}, { facilities: 'not-an-array' }, { facilities: null }, 42, 'town']) {
    let result;
    assert.doesNotThrow(() => { result = assessHabitability(bad); });
    assert.equal(result.level, 0);
    assert.equal(result.canLive, true); // no facility at all present => nothing to block on
    assert.deepEqual(result.blockers, []);
  }
});

test('unrecognized facility kinds are dropped silently, never thrown on', () => {
  const model = town({
    facilities: [townHall(), { kind: 'castle', present: true, count: 1, evidence: { observed: ['x'], inferred: [], unknown: [] } }]
  });
  let result;
  assert.doesNotThrow(() => { result = assessHabitability(model); });
  // town_hall is the only recognized present facility => Lv.0, not Lv.1
  assert.equal(result.level, 0);
});

test('duplicate facility entries for the same kind are merged (present OR-ed), not dropped', () => {
  const model = town({
    facilities: [
      townHall(),
      { kind: 'gate', present: false, count: 0, evidence: { observed: [], inferred: [], unknown: ['first pass found nothing'] } },
      { kind: 'gate', present: true, count: 1, evidence: { observed: ['entrypoint resolved'], inferred: [], unknown: [] } },
      facility('inn')
    ]
  });
  const result = assessHabitability(model);
  // gate ends up present (OR-ed), so with inn present too this clears Lv.2, not just Lv.1
  assert.equal(result.canLive, true);
  assert.equal(result.level, 2);
});

// --- blocker rule: "no gate but something to enter" -------------------------

test('a present facility beyond town_hall/gate/ruin without a gate blocks habitability at Lv.1', () => {
  const model = town({ facilities: [townHall(), facility('house')] });
  const result = assessHabitability(model);
  assert.equal(result.canLive, false);
  assert.equal(result.level, 1); // capped
  assert.equal(result.blockers.length, 1);
  assert.match(result.blockers[0], /入口がありません/);
  assert.equal(result.reasons[0], HEADLINE);
});

test('ruin (dirt) alone never triggers the no-gate blocker', () => {
  const model = town({ facilities: [townHall(), facility('ruin')] });
  const result = assessHabitability(model);
  assert.equal(result.canLive, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.level, 1); // still a real facility beyond town_hall, just not a blocker
});

test('town_hall and gate alone (no other facility) never trigger the blocker', () => {
  const model = town({ facilities: [townHall(), facility('gate')] });
  const result = assessHabitability(model);
  assert.equal(result.canLive, true);
  assert.deepEqual(result.blockers, []);
});

test('the blocker fires for a pub-only town missing a gate too, not just inn', () => {
  const model = town({ facilities: [townHall(), facility('pub')] });
  const result = assessHabitability(model);
  assert.equal(result.canLive, false);
  assert.equal(result.level, 1);
});

// --- ladder: Lv.0 through Lv.5, cumulative ----------------------------------

test('Lv.0: nothing beyond town_hall', () => {
  const result = assessHabitability(town({ facilities: [townHall()] }));
  assert.equal(result.level, 0);
  assert.equal(result.levelName, '設計図だけの街');
  assert.equal(result.canLive, true);
});

test('Lv.1: a facility exists beyond town_hall, but no gate + inn/pub yet', () => {
  const result = assessHabitability(town({ facilities: [townHall(), facility('gate')] }));
  assert.equal(result.level, 1);
  assert.equal(result.levelName, '通電した開拓地');
});

test('Lv.2: gate + inn (or pub) gives the main road through a small village', () => {
  const withInn = assessHabitability(town({ facilities: [townHall(), facility('gate'), facility('inn')] }));
  assert.equal(withInn.level, 2);
  assert.equal(withInn.levelName, '主要動線が通る小村');

  const withPub = assessHabitability(town({ facilities: [townHall(), facility('gate'), facility('pub')] }));
  assert.equal(withPub.level, 2);
});

test('Lv.2 stays capped when warehouse/well are missing, with warnings naming both', () => {
  const result = assessHabitability(town({ facilities: [townHall(), facility('gate'), facility('inn')] }));
  assert.equal(result.level, 2);
  assert.ok(result.warnings.some((w) => /倉庫/.test(w)));
  assert.ok(result.warnings.some((w) => /井戸/.test(w)));
});

test('Lv.3: adding warehouse + well clears the "住める街" life-infra bar', () => {
  const result = assessHabitability(town({
    facilities: [townHall(), facility('gate'), facility('inn'), facility('warehouse'), facility('well')]
  }));
  assert.equal(result.level, 3);
  assert.equal(result.levelName, '住める街');
  assert.equal(result.warnings.length, 0);
});

test('Lv.4: adding dojo + watchtower makes it a lively town', () => {
  const result = assessHabitability(town({
    facilities: [
      townHall(), facility('gate'), facility('inn'), facility('warehouse'), facility('well'),
      facility('dojo'), facility('watchtower')
    ]
  }));
  assert.equal(result.level, 4);
  assert.equal(result.levelName, 'にぎわう街');
});

test('Lv.5: adding dock with zero warnings makes it worth showing off', () => {
  const result = assessHabitability(town({
    facilities: [
      townHall(), facility('gate'), facility('inn'), facility('warehouse'), facility('well'),
      facility('dojo'), facility('watchtower'), facility('dock')
    ]
  }));
  assert.equal(result.level, 5);
  assert.equal(result.levelName, '見せたくなる街');
  assert.equal(result.canLive, true);
  assert.deepEqual(result.warnings, []);
});

test('Lv.5 is denied when every facility is present but a warning remains outstanding', () => {
  // Same as the Lv.5 fixture, except inn is backed only by unknown-class
  // evidence ("not lit up yet"), which raises a warning and caps the ladder
  // at Lv.4 even though every required facility kind is present.
  const result = assessHabitability(town({
    facilities: [
      townHall(), facility('gate'),
      facility('inn', { observed: [], inferred: [], unknown: ['reachability could not be resolved'] }),
      facility('warehouse'), facility('well'), facility('dojo'), facility('watchtower'), facility('dock')
    ]
  }));
  assert.equal(result.level, 4);
  assert.ok(result.warnings.length > 0);
  assert.equal(result.canLive, true); // still a blocker-free town, just not "showable"
});

// --- warnings: dirt / soft notes never affect canLive -----------------------

test('inn backed only by unknown evidence warns "not lit up yet" without blocking canLive', () => {
  const model = town({
    facilities: [townHall(), facility('gate'), facility('inn', { observed: [], inferred: [], unknown: ['reachability unknown'] })]
  });
  const result = assessHabitability(model);
  assert.equal(result.canLive, true);
  assert.ok(result.warnings.some((w) => /灯りがついていません/.test(w)));
});

test('inn backed by observed evidence does not trigger the "not lit up" warning', () => {
  const model = town({
    facilities: [townHall(), facility('gate'), facility('inn', { observed: ['a web-server dependency was observed'] })]
  });
  const result = assessHabitability(model);
  assert.ok(!result.warnings.some((w) => /灯りがついていません/.test(w)));
});

test('pub safeguard flags read false from pub.details fire the matching warning', () => {
  const model = town({
    facilities: [
      townHall(), facility('gate'),
      facility('pub', { details: { costControl: false, auth: false, logging: false } }),
      facility('warehouse'), facility('well')
    ]
  });
  const result = assessHabitability(model);
  assert.ok(result.warnings.some((w) => /コスト制限/.test(w)));
  assert.ok(result.warnings.some((w) => /認証なし/.test(w)));
  assert.ok(result.warnings.some((w) => /ログなし/.test(w)));
});

test('pub safeguard flags read false from the guild じょうたい tab also fire the warning', () => {
  const model = town({
    facilities: [townHall(), facility('gate'), facility('pub'), facility('warehouse'), facility('well')],
    guild: { [GUILD_STATE_TAB]: { hasAuth: false } }
  });
  const result = assessHabitability(model);
  assert.ok(result.warnings.some((w) => /認証なし/.test(w)));
});

test('an absent/unknown pub safeguard flag never false-fires a warning (evidence separation)', () => {
  const model = town({
    facilities: [townHall(), facility('gate'), facility('pub'), facility('warehouse'), facility('well')]
    // no costControl/auth/logging flag anywhere: unknown, not "missing"
  });
  const result = assessHabitability(model);
  assert.ok(!result.warnings.some((w) => /コスト制限/.test(w)));
  assert.ok(!result.warnings.some((w) => /認証なし/.test(w)));
  assert.ok(!result.warnings.some((w) => /ログなし/.test(w)));
  assert.equal(result.canLive, true);
});

test('a true safeguard flag (safeguard present) never fires a warning', () => {
  const model = town({
    facilities: [
      townHall(), facility('gate'),
      facility('pub', { details: { costControl: true, auth: true, logging: true } }),
      facility('warehouse'), facility('well')
    ]
  });
  const result = assessHabitability(model);
  assert.equal(result.warnings.length, 0);
});

// --- external contractor self-reports: pending, never a reward --------------

test('contractor self-reports surface in pendingInspections and never raise the level or unblock canLive', () => {
  const bare = town({ facilities: [townHall(), facility('house')] }); // Lv.1-capped, canLive:false
  const withReports = town({
    facilities: [townHall(), facility('house')],
    contractorReports: [{ source: 'claude-code', subject: '入口を実装し、テストも完了しました', status: 'pending-inspection' }]
  });

  const bareResult = assessHabitability(bare);
  const reportedResult = assessHabitability(withReports);

  assert.equal(bareResult.level, reportedResult.level);
  assert.equal(bareResult.canLive, reportedResult.canLive);
  assert.deepEqual(bareResult.blockers, reportedResult.blockers);
  assert.deepEqual(bareResult.pendingInspections, []);
  assert.equal(reportedResult.pendingInspections.length, 1);
  assert.match(reportedResult.pendingInspections[0], /claude-code工務店の完成報告があります/);
  assert.match(reportedResult.pendingInspections[0], /道場（検査）はまだ通っていません/);
  assert.match(reportedResult.pendingInspections[0], /入口を実装し、テストも完了しました/);
});

test('a contractor report never raises an already-healthy town past its earned level', () => {
  const healthyModel = town({
    facilities: [townHall(), facility('gate'), facility('inn'), facility('warehouse'), facility('well')],
    contractorReports: [{ source: 'codex', subject: 'ダッシュボードを完成させました', status: 'pending-inspection' }]
  });
  const result = assessHabitability(healthyModel);
  assert.equal(result.level, 3); // exactly what the facilities earn, not bumped by the self-report
  assert.equal(result.pendingInspections.length, 1);
});

test('malformed contractor report entries are dropped without throwing; well-formed ones still surface', () => {
  const model = town({
    facilities: [townHall()],
    contractorReports: [null, 42, 'a string is not a report', { source: 123, subject: null }, { source: 'codex', subject: 'did x' }]
  });
  let result;
  assert.doesNotThrow(() => { result = assessHabitability(model); });
  // null/number/string entries are dropped; the two remaining plain objects survive
  assert.equal(result.pendingInspections.length, 2);
  // non-string source defaults to '外部' rather than throwing or fabricating a name
  assert.ok(result.pendingInspections.some((line) => /外部工務店の完成報告があります/.test(line)));
  assert.ok(result.pendingInspections.some((line) => /codex工務店の完成報告があります/.test(line) && /did x/.test(line)));
});

// --- grounding: the real sample/tiny-town repository ------------------------
//
// inspectRepository and collectSignals are static-only (AST parse, lstat,
// JSON.parse of package.json / .git/logs/HEAD); neither ever executes any
// file inside sample/tiny-town.

test('assessHabitability on the real sample/tiny-town town: Lv.1, canLive, no blockers/warnings', async () => {
  const inspection = await inspectRepository(SAMPLE_REPO);
  const signals = await collectSignals(SAMPLE_REPO);
  const model = buildTownModel(inspection, signals);
  const result = assessHabitability(model);

  // Grounded in the real facility set: tiny-town's files all sit directly
  // under src/ with plain names (inn.js, harbor.js, ...) that never match the
  // server/api/routes path pattern scanner.mjs requires for kind:'service',
  // so no inn/pub is actually detected -- only a resolved entrypoint (gate),
  // a test file + "test" script (dojo), and ordinary modules (house).
  const presentKinds = new Set(model.facilities.filter((f) => f.present).map((f) => f.kind));
  assert.ok(presentKinds.has('town_hall'));
  assert.ok(presentKinds.has('gate'));
  assert.ok(presentKinds.has('dojo'));
  assert.ok(presentKinds.has('house'));
  assert.ok(!presentKinds.has('inn'), 'a file merely named inn.js must not be detected as the inn facility');
  assert.ok(!presentKinds.has('pub'));

  assert.equal(result.canLive, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.level, 1); // gate is present, but no inn/pub => Lv.2's bar is not cleared
  assert.equal(result.levelName, '通電した開拓地');
});

test('assessHabitability is deterministic across repeated runs on the real sample town', async () => {
  const inspection = await inspectRepository(SAMPLE_REPO);
  const signals = await collectSignals(SAMPLE_REPO);

  const first = assessHabitability(buildTownModel(inspection, signals));
  const second = assessHabitability(buildTownModel(inspection, signals));

  assert.deepEqual(first, second);
});

test('injecting a contractor report onto the real sample town model adds a pending inspection but never changes the level', async () => {
  const inspection = await inspectRepository(SAMPLE_REPO);
  const signals = await collectSignals(SAMPLE_REPO);
  const model = buildTownModel(inspection, signals);

  const baseline = assessHabitability(model);
  const withReport = assessHabitability({
    ...model,
    external: {
      contractorReports: [{ source: 'claude-code', subject: '宿屋を実装しました。すべて完璧です', status: 'pending-inspection' }]
    }
  });

  assert.equal(withReport.level, baseline.level);
  assert.equal(withReport.canLive, baseline.canLive);
  assert.equal(withReport.pendingInspections.length, 1);
  assert.match(withReport.pendingInspections[0], /claude-code工務店の完成報告があります/);
});

// --- FACILITY_KINDS coverage: every kind is individually recognized --------

test('every FACILITY_KINDS id is individually recognized as "present beyond town_hall" for the Lv.1 check', () => {
  for (const kind of FACILITY_KINDS) {
    if (kind === 'town_hall') continue;
    const result = assessHabitability(town({ facilities: [townHall(), facility(kind)] }));
    assert.ok(result.level >= 1, `facility kind "${kind}" should raise the town beyond Lv.0`);
  }
});
