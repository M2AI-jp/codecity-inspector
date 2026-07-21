import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLUE_INTERACTIONS,
  buildInvestigation
} from '../public/fable5-v2/world-runtime.mjs';

// Evidence class each site reports, keyed by clue id. Read from the fixed
// geometry so the test tracks CLUE_INTERACTIONS rather than duplicating it.
const SITE_CLASS = Object.fromEntries(
  CLUE_INTERACTIONS.map((clue) => [clue.id, clue.evidenceClass])
);
const CLASS_LABEL = Object.freeze({
  observed: '観測の手掛かり',
  inferred: '推定の手掛かり',
  unknown: '不明の手掛かり'
});

function fact(type, params, evidenceClass) {
  const evidence = { observed: [], inferred: [], unknown: [] };
  evidence[evidenceClass] = [`fixture.${type}.${evidenceClass}`];
  return { type, params, evidence };
}

function factCarriesClass(chosen, evidenceClass) {
  return (chosen?.evidence?.[evidenceClass]?.length ?? 0) > 0;
}

// Two repositories whose facts differ in every relevant field.
const ALPHA = {
  repository: { name: 'alpha-town' },
  facts: [
    fact('entrypoint', { path: 'src/main.js', source: 'package.json:main' }, 'observed'),
    fact('cycle', { members: ['src/cycle-a.js', 'src/cycle-b.js'] }, 'inferred'),
    fact('unverified', { path: 'src/well.js', kind: 'module' }, 'unknown')
  ]
};
const BETA = {
  repository: { name: 'beta-town' },
  facts: [
    fact('entrypoint', { path: 'bin/cli.js', source: 'package.json:bin' }, 'observed'),
    fact('cycle', { members: ['lib/left.js', 'lib/right.js'] }, 'inferred'),
    fact('unverified', { path: 'lib/lonely.js', kind: 'module' }, 'unknown')
  ]
};

test('different repositories produce different investigation content', () => {
  const alpha = buildInvestigation(ALPHA);
  const beta = buildInvestigation(BETA);

  assert.notEqual(alpha.repository, beta.repository);
  for (const clue of CLUE_INTERACTIONS) {
    assert.notEqual(
      alpha.sites[clue.id].pages[0].body,
      beta.sites[clue.id].pages[0].body,
      `${clue.id} body should change between repositories`
    );
  }
  // The request and the report both weave in the repository name, so they differ.
  assert.notDeepEqual(alpha.intro, beta.intro);
  assert.notDeepEqual(alpha.report, beta.report);
  assert.match(alpha.intro.at(-1).body, /alpha-town/);
  assert.match(beta.intro.at(-1).body, /beta-town/);

  // Repository-specific values actually reach the prose.
  assert.match(alpha.sites['clue-streetlamp'].pages[0].body, /src\/main\.js/);
  assert.match(alpha.sites['clue-well'].pages[0].body, /src\/cycle-a\.js/);
  assert.match(alpha.sites['clue-east-shop'].pages[0].body, /src\/well\.js/);
});

test('each site label matches the evidence class of the fact it uses', () => {
  const investigation = buildInvestigation(ALPHA);
  for (const site of Object.values(investigation.sites)) {
    assert.equal(site.evidenceClass, SITE_CLASS[site.id]);
    assert.equal(site.evidenceLabel, CLASS_LABEL[site.evidenceClass]);
    assert.ok(site.fact, `${site.id} should have selected a fact`);
    assert.ok(
      factCarriesClass(site.fact, site.evidenceClass),
      `${site.id} fact must actually carry ${site.evidenceClass} evidence`
    );
    assert.equal(site.pages[0].className, site.evidenceClass);
  }
});

test('alternative fact types still resolve to the correct class per site', () => {
  // No entrypoint/cycle/unverified: force the fallback fact types and confirm
  // the site still reports the same class and label from a different fact.
  const payload = {
    repository: { name: 'gamma-town' },
    facts: [
      fact('unresolved', { from: 'src/a.js', targetHint: 'src/missing.js', kind: 'import' }, 'observed'),
      fact('test_association', { source: 'src/inn.js', test: 'test/inn.test.js', method: 'direct' }, 'inferred'),
      fact('runtime_unknown', { from: 'src/net.js', targetHint: 'remote', kind: 'call' }, 'unknown')
    ]
  };
  const investigation = buildInvestigation(payload);

  assert.equal(investigation.sites['clue-streetlamp'].fact.type, 'unresolved');
  assert.equal(investigation.sites['clue-streetlamp'].evidenceLabel, '観測の手掛かり');
  assert.match(investigation.sites['clue-streetlamp'].pages[0].body, /src\/missing\.js/);

  assert.equal(investigation.sites['clue-well'].fact.type, 'test_association');
  assert.equal(investigation.sites['clue-well'].evidenceLabel, '推定の手掛かり');
  assert.match(investigation.sites['clue-well'].pages[0].body, /test\/inn\.test\.js/);

  assert.equal(investigation.sites['clue-east-shop'].fact.type, 'runtime_unknown');
  assert.equal(investigation.sites['clue-east-shop'].evidenceLabel, '不明の手掛かり');
  assert.match(investigation.sites['clue-east-shop'].pages[0].body, /src\/net\.js/);

  // Class labels are never mismatched to a fact of another class.
  for (const site of Object.values(investigation.sites)) {
    assert.ok(factCarriesClass(site.fact, site.evidenceClass));
  }
});

test('missing facts never fabricate a finding', () => {
  const investigation = buildInvestigation({ repository: { name: 'empty-town' }, facts: [] });

  for (const site of Object.values(investigation.sites)) {
    assert.equal(site.fact, null, `${site.id} must not invent a fact`);
    // No quoted fact token can appear when there is nothing to quote.
    assert.equal(site.pages[0].body.includes('「'), false, `${site.id} must not quote invented data`);
    // The class/label are still assigned by geometry, so honesty is per-site.
    assert.equal(site.evidenceLabel, CLASS_LABEL[site.evidenceClass]);
  }
  assert.match(investigation.sites['clue-streetlamp'].pages[0].body, /残っていません/);
  assert.match(investigation.sites['clue-well'].pages[0].body, /立っていません/);
  assert.match(investigation.sites['clue-east-shop'].pages[0].body, /残っていません/);

  // The report honestly states that nothing was found on each axis.
  assert.match(investigation.report[0].body, /ありませんでした/);
  assert.match(investigation.report[1].body, /立ちませんでした/);
  assert.match(investigation.report[2].body, /残っていません/);
  assert.match(investigation.report[2].body, /故障を意味しません/);
});

test('a partial repository reports found and honest-empty sites side by side', () => {
  // Only an observed fact exists; the inferred and unknown axes stay empty.
  const investigation = buildInvestigation({
    repository: { name: 'partial-town' },
    facts: [fact('entrypoint', { path: 'src/only.js', source: 'package.json:main' }, 'observed')]
  });

  assert.ok(investigation.sites['clue-streetlamp'].fact);
  assert.match(investigation.sites['clue-streetlamp'].pages[0].body, /src\/only\.js/);
  assert.equal(investigation.sites['clue-well'].fact, null);
  assert.equal(investigation.sites['clue-east-shop'].fact, null);
  assert.match(investigation.sites['clue-well'].pages[0].body, /立っていません/);
  assert.match(investigation.sites['clue-east-shop'].pages[0].body, /残っていません/);

  assert.match(investigation.report[0].body, /控えました/);
  assert.match(investigation.report[1].body, /立ちませんでした/);
});

test('buildInvestigation degrades safely on malformed payloads', () => {
  for (const bad of [null, undefined, {}, { facts: 'nope' }, { repository: 5 }]) {
    const investigation = buildInvestigation(bad);
    assert.equal(investigation.repository, '名称未設定のリポジトリ');
    assert.equal(Object.keys(investigation.sites).length, 3);
    for (const site of Object.values(investigation.sites)) {
      assert.equal(site.fact, null);
      assert.ok(site.pages[0].body.length > 0);
    }
    assert.ok(investigation.intro.length >= 1);
    assert.equal(investigation.report.length, 3);
  }
});
