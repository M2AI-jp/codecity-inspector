import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectRepository } from '../../../ship/10-inspect/index.mjs';
import { inferSemanticModel } from '../../../ship/20-semantics/index.mjs';
import { buildTownModel, validateTownModel } from '../../../ship/30-town-domain/index.mjs';
import { generateWorldPlan, validateWorldPlan } from '../../../ship/40-worldgen/index.mjs';

function makeInertRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-inert-repository-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git/config'), [
    '[remote "origin"]',
    '\turl = https://person:secret@example.test/customer/town.git',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'inert-customer-town',
    private: true,
    scripts: { build: 'must-never-run', test: 'must-never-run' },
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
  return root;
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

test('read-only repository input crosses every backend contract into a valid WorldPlan', async () => {
  const root = makeInertRepository();
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
});

test('repository content changes L2 without moving its identity-derived L1 town face', async () => {
  const root = makeInertRepository();
  const firstTown = buildTownModel(inferSemanticModel(await inspectRepository(root)));
  const firstPlan = generateWorldPlan({ town: firstTown });

  fs.writeFileSync(path.join(root, 'src/worker.js'), 'export const worker = true;\n');
  const secondTown = buildTownModel(inferSemanticModel(await inspectRepository(root)));
  const secondPlan = generateWorldPlan({ town: secondTown });

  assert.equal(firstPlan.identity.key, secondPlan.identity.key);
  assert.equal(l1Snapshot(firstPlan), l1Snapshot(secondPlan));
  assert.notEqual(firstPlan.contentSeed, secondPlan.contentSeed);
});
