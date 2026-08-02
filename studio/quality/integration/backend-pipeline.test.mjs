import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectRepository } from '../../../ship/10-inspect/index.mjs';
import { inferSemanticModel } from '../../../ship/20-semantics/index.mjs';
import { buildTownModel, validateTownModel } from '../../../ship/30-town-domain/index.mjs';
import { generateWorldPlan, validateWorldPlan } from '../../../ship/40-worldgen/index.mjs';

function makeInertRepository(shape = 'representative') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-inert-repository-'));
  if (shape === 'empty') return root;
  if (shape === 'small') {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'small-inert', scripts: { test: 'must-never-run' } }));
    fs.writeFileSync(path.join(root, 'trap.sh'), '#!/bin/sh\necho executed > SHOULD_NOT_EXIST\n', { mode: 0o755 });
    return root;
  }
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'legacy'), { recursive: true });
  fs.mkdirSync(path.join(root, '.husky'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git/config'), [
    '[remote "origin"]',
    '\turl = https://person:secret@example.test/customer/town.git',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'inert-customer-town',
    private: true,
    scripts: {
      preinstall: 'echo lifecycle > LIFECYCLE_EXECUTED',
      install: 'echo lifecycle > LIFECYCLE_EXECUTED',
      postinstall: 'echo lifecycle > LIFECYCLE_EXECUTED',
      build: 'echo build > BUILD_EXECUTED',
      test: 'echo test > TEST_EXECUTED',
    },
  }));
  fs.writeFileSync(path.join(root, 'src/server.js'), [
    "import { repository } from './data/repository.js';",
    'export function handler() { return repository; }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src/data/repository.js'), 'export const repository = new Map();\n');
  fs.writeFileSync(path.join(root, 'config/default.json'), '{"port":4173}\n');
  fs.writeFileSync(path.join(root, 'src/server.spec.js'), 'throw new Error("inspected tests must never execute");\n');
  fs.writeFileSync(path.join(root, 'legacy/todo.md'), 'This is visible dirt, not a missing path.\n');
  fs.writeFileSync(path.join(root, 'trap.sh'), '#!/bin/sh\necho executed > SHOULD_NOT_EXIST\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, '.husky/pre-commit'), '#!/bin/sh\necho hook > HOOK_EXECUTED\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/tool.bin'), Buffer.from([
    0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x3e, 0x00,
  ]), { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'node_modules/ignored.js'), 'throw new Error("excluded dependency must not execute");\n');
  fs.writeFileSync(path.join(root, 'dist/ignored.js'), 'throw new Error("excluded build output must not execute");\n');
  const outside = `${root}-outside`;
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside-sentinel\n');
  fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'dir');
  return root;
}

function snapshotTree(root) {
  const result = [];
  const walk = (directory, relative = '.') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      const entryRelative = relative === '.' ? entry.name : `${relative}/${entry.name}`;
      const stat = fs.lstatSync(entryPath);
      if (entry.isDirectory()) {
        result.push({ path: entryRelative, kind: 'directory', mode: stat.mode, mtimeMs: stat.mtimeMs });
        walk(entryPath, entryRelative);
      } else if (entry.isSymbolicLink()) {
        result.push({ path: entryRelative, kind: 'symlink', mode: stat.mode, mtimeMs: stat.mtimeMs, target: fs.readlinkSync(entryPath) });
      } else {
        const bytes = fs.readFileSync(entryPath);
        result.push({
          path: entryRelative,
          kind: 'file',
          mode: stat.mode,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.toString('base64'),
        });
      }
    }
  };
  walk(root);
  return result;
}

function l1Snapshot(plan) {
  return JSON.stringify({
    identity: plan.identity,
    townType: plan.townType,
    climate: plan.climate,
    terrain: plan.terrain,
    elevation: plan.elevation,
    water: plan.water,
    roads: plan.roads,
    topology: plan.topology,
    regions: plan.regions,
    plotIds: plan.plotIds,
    plots: plan.plots,
    sightlines: plan.sightlines,
    nav: plan.nav,
  });
}

test('read-only repository input crosses every backend contract into a valid WorldPlan', async (t) => {
  const root = makeInertRepository();
  const outside = `${root}-outside`;
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const before = snapshotTree(root);
  const beforeOutside = snapshotTree(outside);
  const inspection = await inspectRepository(root);

  assert.equal(inspection.schemaVersion, 1);
  assert.equal(inspection.repository.identity, 'https://example.test/customer/town.git');
  assert.equal(JSON.stringify(inspection).includes(root), false);
  assert.ok(inspection.files.some((file) => file.path === 'src/server.spec.js' && file.isTest));
  assert.ok(inspection.graph.edges.length >= 1);

  const semantics = inferSemanticModel(inspection);
  const town = buildTownModel(semantics);
  assert.deepEqual(validateTownModel(town), { ok: true, issues: [] });
  assert.equal(town.facilities.length, 14);
  assert.equal(town.facilities.find((facility) => facility.kind === 'ruin').condition, 'dirt');
  assert.equal(town.facilities.find((facility) => facility.kind === 'ruin').blocksProgress, false);

  const plan = generateWorldPlan({ town });
  assert.equal(validateWorldPlan(plan, { town }).schemaVersion, 1);
  assert.ok(plan.plots.length >= 12 && plan.plots.length <= 20);
  assert.equal(plan.occupancy.length, plan.plots.length);
  assert.equal(plan.questSites.length, town.investigations.candidates.length);
  assert.deepEqual(snapshotTree(root), before);
  assert.deepEqual(snapshotTree(outside), beforeOutside);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside-sentinel\n');
  assert.equal(fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')), false);
  assert.equal(fs.existsSync(path.join(root, 'LIFECYCLE_EXECUTED')), false);
  assert.equal(fs.existsSync(path.join(root, 'BUILD_EXECUTED')), false);
  assert.equal(fs.existsSync(path.join(root, 'TEST_EXECUTED')), false);
  assert.equal(fs.existsSync(path.join(root, 'HOOK_EXECUTED')), false);
});

test('repository content changes L2 without moving its identity-derived L1 town face', async (t) => {
  const root = makeInertRepository();
  const outside = `${root}-outside`;
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const firstTown = buildTownModel(inferSemanticModel(await inspectRepository(root)));
  const firstPlan = generateWorldPlan({ town: firstTown });

  fs.writeFileSync(path.join(root, 'src/worker.js'), 'export const worker = true;\n');
  const secondTown = buildTownModel(inferSemanticModel(await inspectRepository(root)));
  const secondPlan = generateWorldPlan({ town: secondTown });

  assert.equal(firstPlan.identity.key, secondPlan.identity.key);
  assert.equal(l1Snapshot(firstPlan), l1Snapshot(secondPlan));
  assert.notEqual(firstPlan.contentSeed, secondPlan.contentSeed);
});

// T4 obligation: prevent the customer repository from being executed,
// mutated, or made nondeterministic across empty/small/representative inert
// roots. It evidences the owner requirement that 10->40 yield exactly three
// truthful sites and one observed inspection transition. Passing does not
// prove art approval, scene compiler/runtime behavior, browser acquisition,
// package contents, persistence, or the full KGI journey.
test('T4 yields deterministic three-site plans for empty, small, and representative inert repositories', async (t) => {
  for (const shape of ['empty', 'small', 'representative']) {
    const root = makeInertRepository(shape);
    const outside = `${root}-outside`;
    t.after(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    });
    const before = snapshotTree(root);
    const beforeOutside = fs.existsSync(outside) ? snapshotTree(outside) : null;
    if (shape === 'representative') {
      assert.equal(fs.lstatSync(path.join(root, 'linked-outside')).isSymbolicLink(), true);
      assert.deepEqual(fs.readFileSync(path.join(root, 'bin/tool.bin')).subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
      assert.equal(fs.statSync(path.join(root, '.husky/pre-commit')).mode & 0o111, 0o111);
      assert.equal(fs.existsSync(path.join(root, 'node_modules/ignored.js')), true);
      assert.equal(fs.existsSync(path.join(root, 'dist/ignored.js')), true);
    }
    const firstInspection = await inspectRepository(root);
    const firstTown = buildTownModel(inferSemanticModel(firstInspection));
    const firstPlan = generateWorldPlan({ town: firstTown });
    const secondInspection = await inspectRepository(root);
    const secondTown = buildTownModel(inferSemanticModel(secondInspection));
    const secondPlan = generateWorldPlan({ town: secondTown });

    assert.equal(firstInspection.evidence.observed.some((entry) => entry.id === 'repository.inspection.completed'), true);
    assert.equal(firstTown.investigations.candidates.length, 3);
    assert.equal(firstPlan.questSites.length, 3);
    assert.equal(new Set(firstPlan.questSites.map((site) => site.plotId)).size, 3);
    assert.deepEqual(firstPlan.rewardBindings, [{
      id: 'repository_inspected',
      event: 'repository_inspected',
      transition: 'repository_inspected',
      facilityKind: 'town_hall',
      effect: 'town_hall_lantern_lit',
    }]);
    assert.equal(JSON.stringify(secondInspection), JSON.stringify(firstInspection));
    assert.equal(JSON.stringify(secondPlan), JSON.stringify(firstPlan));
    assert.deepEqual(snapshotTree(root), before);
    if (beforeOutside) {
      assert.deepEqual(snapshotTree(outside), beforeOutside);
      assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside-sentinel\n');
    }
    assert.equal(fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')), false);
    assert.equal(fs.existsSync(path.join(root, 'LIFECYCLE_EXECUTED')), false);
    assert.equal(fs.existsSync(path.join(root, 'BUILD_EXECUTED')), false);
    assert.equal(fs.existsSync(path.join(root, 'TEST_EXECUTED')), false);
    assert.equal(fs.existsSync(path.join(root, 'HOOK_EXECUTED')), false);
  }
});
