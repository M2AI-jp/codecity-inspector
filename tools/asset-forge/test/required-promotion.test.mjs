import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from '../src/hashing.mjs';
import {
  REQUIRED_PROMOTION_COUNT,
  REQUIRED_PLAN_KEYS,
  beginRequiredPromotion,
  buildRequiredPromotionPlan,
  canonicalRequiredPlan,
  executeRequiredPromotion,
  isExactRequiredPromotionAnswer,
  requiredPromotionNote,
  requiredPromotionPhrase,
  selectRequiredGenerations
} from '../src/jobs/required-promotion.mjs';

const FIXED_TIME = '2026-07-15T00:00:00.000Z';

function idAt(index) {
  return `field.required_${String(index).padStart(3, '0')}`;
}

function generationIdAt(index) {
  return `gen_required_${String(index).padStart(3, '0')}`;
}

function syntheticDefinitions() {
  return Array.from({ length: REQUIRED_PROMOTION_COUNT }, (_, index) => ({
    id: idAt(index), category: 'field', required: true
  }));
}

function syntheticGenerations() {
  return Array.from({ length: REQUIRED_PROMOTION_COUNT }, (_, index) => ({
    id: generationIdAt(index), assetId: idAt(index), category: 'field', status: 'pending'
  }));
}

function syntheticPlan() {
  return Array.from({ length: REQUIRED_PROMOTION_COUNT }, (_, index) => {
    const assetId = idAt(index);
    const digest = sha256(assetId);
    return {
      assetId,
      generationId: generationIdAt(index),
      sourcePath: `generated/fields/pending/field_required_${String(index).padStart(3, '0')}.png`,
      sourceSha256: digest,
      approvedPath: `generated/fields/approved/field_required_${digest.slice(0, 16)}.png`,
      approvedSha256: digest
    };
  });
}

function syntheticPreflight(canonical = canonicalRequiredPlan(syntheticPlan()), approvedAssetIds = new Set()) {
  const approvedGenerationIds = canonical.plan
    .filter((item) => approvedAssetIds.has(item.assetId))
    .map((item) => item.generationId);
  const pendingGenerationIds = canonical.plan
    .filter((item) => !approvedAssetIds.has(item.assetId))
    .map((item) => item.generationId);
  return {
    count: REQUIRED_PROMOTION_COUNT,
    pendingCount: pendingGenerationIds.length,
    approvedCount: approvedGenerationIds.length,
    pendingGenerationIds,
    approvedGenerationIds,
    plan: canonical.plan,
    digest: canonical.digest
  };
}

async function tempRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, 'data', 'manifests'), { recursive: true });
  await writeFile(path.join(root, 'sentinel.txt'), 'unchanged');
  return root;
}

function assetManifest() {
  return {
    schemaVersion: 1,
    assets: syntheticDefinitions().map((definition) => ({
      assetId: definition.id,
      category: definition.category,
      status: 'missing',
      pendingGenerationIds: [],
      rejectedGenerationIds: [],
      lastUpdated: null
    }))
  };
}

async function writeManifests(root, assets = assetManifest(), approvals = { schemaVersion: 1, approvals: [] }) {
  await writeFile(path.join(root, 'data', 'manifests', 'assets.json'), JSON.stringify(assets));
  await writeFile(path.join(root, 'data', 'manifests', 'approvals.json'), JSON.stringify(approvals));
}

function successfulValidator() {
  return { ok: true, requiredAssetCount: REQUIRED_PROMOTION_COUNT, issues: [] };
}

test('non-TTY required promotion refuses before preflight and leaves its temp root unchanged', async () => {
  const root = await tempRoot('forge-required-nontty-');
  let planned = false;
  await assert.rejects(
    () => beginRequiredPromotion({ input: { isTTY: false }, output: { isTTY: true } }, {
      root,
      planBuilder: async () => { planned = true; throw new Error('must not run'); }
    }),
    /stdin and stdout.*interactive TTYs/
  );
  assert.equal(planned, false);
  assert.equal(await readFile(path.join(root, 'sentinel.txt'), 'utf8'), 'unchanged');
});

test('required selection rejects count, missing, duplicate, and wrong states without mutating inputs', async () => {
  await tempRoot('forge-required-selection-');
  const definitions = syntheticDefinitions();
  const generations = syntheticGenerations();
  const originalDefinitions = structuredClone(definitions);
  const originalGenerations = structuredClone(generations);

  assert.throws(() => selectRequiredGenerations(definitions.slice(1), generations), /exactly 78 required definitions/);
  assert.throws(() => selectRequiredGenerations(definitions, generations.slice(1)), /candidate is missing/);
  assert.throws(() => selectRequiredGenerations(definitions, [
    ...generations,
    { ...generations[0], id: 'gen_duplicate' }
  ]), /candidate is duplicated/);
  for (const status of ['rejected', 'exported', 'failed']) {
    const changed = structuredClone(generations);
    changed[0].status = status;
    assert.throws(() => selectRequiredGenerations(definitions, changed), /disallowed state/);
  }
  const categoryMismatch = structuredClone(generations);
  categoryMismatch[0].category = 'object';
  assert.throws(() => selectRequiredGenerations(definitions, categoryMismatch), /category mismatches/);
  const withOptional = [
    ...generations,
    { id: 'gen_optional', assetId: 'field.optional', category: 'field', status: 'pending' }
  ];
  assert.equal(selectRequiredGenerations(definitions, withOptional).length, REQUIRED_PROMOTION_COUNT);
  assert.deepEqual(definitions, originalDefinitions);
  assert.deepEqual(generations, originalGenerations);
});

test('canonical required digest is deterministic and independent of input order', async () => {
  await tempRoot('forge-required-digest-');
  const forward = syntheticPlan();
  const reverse = [...forward].reverse();
  const first = canonicalRequiredPlan(forward);
  const second = canonicalRequiredPlan(reverse);
  assert.deepEqual(first, second);
  assert.deepEqual(first.plan.map((item) => item.assetId), [...first.plan.map((item) => item.assetId)].sort());
  assert.match(first.digest, /^[a-f0-9]{64}$/);
});

test('every canonical plan item has exactly the six required keys and exact values', async () => {
  await tempRoot('forge-required-shape-');
  const source = syntheticPlan();
  const { plan } = canonicalRequiredPlan(source);
  for (let index = 0; index < plan.length; index += 1) {
    assert.deepEqual(Object.keys(plan[index]).sort(), [...REQUIRED_PLAN_KEYS].sort());
    assert.deepEqual(plan[index], source[index]);
  }
  const extra = structuredClone(source);
  extra[0].confirmed = true;
  assert.throws(() => canonicalRequiredPlan(extra), /exactly the six public keys/);
});

test('confirmation parser accepts only the byte-exact required phrase', async () => {
  await tempRoot('forge-required-phrase-');
  const digest = canonicalRequiredPlan(syntheticPlan()).digest;
  const phrase = requiredPromotionPhrase(digest);
  assert.equal(phrase, `APPROVE REQUIRED 78 ${digest}`);
  assert.equal(isExactRequiredPromotionAnswer(phrase, digest), true);
  for (const changed of [
    ` ${phrase}`, `${phrase} `, phrase.toLowerCase(), phrase.replace('APPROVE', 'Approve'),
    phrase.replace('78', '078'), `${phrase}\n`, '', null, undefined
  ]) assert.equal(isExactRequiredPromotionAnswer(changed, digest), false);
});

test('pending and same-batch approved reconstruction keep one canonical plan and digest', async () => {
  const root = await tempRoot('forge-required-reconstruction-');
  const definitions = syntheticDefinitions();
  const generations = syntheticGenerations();
  const previews = syntheticPlan();
  const assets = assetManifest();
  const approvals = { schemaVersion: 1, approvals: [] };
  await writeManifests(root, assets, approvals);
  const dependencies = {
    readDefinitions: async () => definitions,
    readGenerations: async () => ({ results: generations }),
    previewer: async ({ generationId }) => previews.find((item) => item.generationId === generationId),
    validator: async () => successfulValidator()
  };
  const pending = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  assert.equal(pending.pendingCount, 78);
  assert.equal(pending.approvedCount, 0);
  assert.deepEqual(pending.pendingGenerationIds, previews.map((item) => item.generationId));
  assert.deepEqual(pending.approvedGenerationIds, []);

  const item = previews[0];
  const bytes = Buffer.from('same bytes for pending and approved');
  const bytesHash = sha256(bytes);
  item.sourceSha256 = bytesHash;
  item.approvedSha256 = bytesHash;
  await mkdir(path.join(root, path.dirname(item.sourcePath)), { recursive: true });
  await mkdir(path.join(root, path.dirname(item.approvedPath)), { recursive: true });
  await writeFile(path.join(root, item.sourcePath), bytes);
  await writeFile(path.join(root, item.approvedPath), bytes);
  const updatedPending = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  const note = requiredPromotionNote(updatedPending.digest);
  generations[0] = {
    ...generations[0],
    status: 'approved',
    outputPath: item.approvedPath,
    outputSha256: bytesHash,
    approval: {
      reviewer: 'human', note, approvedAt: FIXED_TIME,
      approvedPath: item.approvedPath, approvedSha256: bytesHash
    }
  };
  assets.assets[0] = {
    ...assets.assets[0], status: 'approved', approvedPath: item.approvedPath, lastUpdated: FIXED_TIME
  };
  approvals.approvals.push({
    generationId: item.generationId,
    assetId: item.assetId,
    reviewer: 'human', note, approvedAt: FIXED_TIME,
    sourcePath: item.sourcePath, sourceSha256: bytesHash,
    approvedPath: item.approvedPath, approvedSha256: bytesHash
  });
  await writeManifests(root, assets, approvals);
  const resumed = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  assert.equal(resumed.pendingCount, 77);
  assert.equal(resumed.approvedCount, 1);
  assert.deepEqual(resumed.approvedGenerationIds, [item.generationId]);
  assert.equal(resumed.pendingGenerationIds.includes(item.generationId), false);
  assert.deepEqual(resumed.plan, updatedPending.plan);
  assert.equal(resumed.digest, updatedPending.digest);
});

test('a journaled lifecycle crash window remains read-only preflightable and resumes to the same digest', async () => {
  const root = await tempRoot('forge-required-journal-resume-');
  const definitions = syntheticDefinitions();
  const generations = syntheticGenerations();
  const previews = syntheticPlan();
  const assets = assetManifest();
  const approvals = { schemaVersion: 1, approvals: [] };
  const item = previews[0];
  const bytes = Buffer.from('journaled promotion bytes');
  const bytesHash = sha256(bytes);
  item.sourceSha256 = bytesHash;
  item.approvedSha256 = bytesHash;
  await writeManifests(root, assets, approvals);
  const validator = async () => {
    if (generations[0].status === 'pending' && assets.assets[0].status === 'approved'
      && approvals.approvals.length === 0) {
      return {
        ok: false,
        requiredAssetCount: 78,
        issues: [{
          code: 'INVALID_APPROVED_ASSET',
          id: item.assetId,
          message: 'approval ledger record is missing'
        }]
      };
    }
    return successfulValidator();
  };
  const dependencies = {
    readDefinitions: async () => definitions,
    readGenerations: async () => ({ results: generations }),
    previewer: async ({ generationId }) => previews.find((candidate) => candidate.generationId === generationId),
    validator
  };
  const beforeCrash = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  const note = requiredPromotionNote(beforeCrash.digest);
  const journal = {
    schemaVersion: 1,
    kind: 'promote',
    generationId: item.generationId,
    assetId: item.assetId,
    category: 'field',
    sourcePath: item.sourcePath,
    sourceSha256: bytesHash,
    destinationPath: item.approvedPath,
    note,
    transitionAt: FIXED_TIME,
    status: 'preparing'
  };
  await mkdir(path.join(root, path.dirname(item.sourcePath)), { recursive: true });
  await mkdir(path.join(root, path.dirname(item.approvedPath)), { recursive: true });
  await mkdir(path.join(root, 'data', 'local', 'lifecycle'), { recursive: true });
  await writeFile(path.join(root, item.sourcePath), bytes);
  await writeFile(path.join(root, item.approvedPath), bytes);
  await writeFile(path.join(root, item.approvedPath.replace(/\.png$/, '.json')), JSON.stringify({
    id: item.generationId,
    assetId: item.assetId,
    category: 'field',
    status: 'approved',
    outputPath: item.approvedPath,
    outputSha256: bytesHash,
    approval: {
      reviewer: 'human', note, approvedAt: FIXED_TIME,
      approvedPath: item.approvedPath, approvedSha256: bytesHash
    }
  }));
  await writeFile(path.join(root, 'data', 'local', 'lifecycle', `${item.generationId}.json`), JSON.stringify(journal));
  assets.assets[0] = {
    ...assets.assets[0], status: 'approved', approvedPath: item.approvedPath, lastUpdated: FIXED_TIME
  };
  await writeManifests(root, assets, approvals);

  const recoverable = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  assert.equal(recoverable.pendingCount, 78);
  assert.equal(recoverable.approvedCount, 0);
  assert.deepEqual(recoverable.plan, beforeCrash.plan);
  assert.equal(recoverable.digest, beforeCrash.digest);

  approvals.approvals.push({
    generationId: item.generationId,
    assetId: item.assetId,
    reviewer: 'human', note, approvedAt: FIXED_TIME,
    sourcePath: item.sourcePath, sourceSha256: bytesHash,
    approvedPath: item.approvedPath, approvedSha256: bytesHash
  });
  await writeManifests(root, assets, approvals);
  const ledgerAdvanced = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  assert.equal(ledgerAdvanced.pendingCount, 78);
  assert.deepEqual(ledgerAdvanced.plan, beforeCrash.plan);
  assert.equal(ledgerAdvanced.digest, beforeCrash.digest);

  generations[0] = {
    ...generations[0],
    status: 'approved',
    outputPath: item.approvedPath,
    outputSha256: bytesHash,
    approval: {
      reviewer: 'human', note, approvedAt: FIXED_TIME,
      approvedPath: item.approvedPath, approvedSha256: bytesHash
    }
  };
  journal.status = 'complete';
  await writeManifests(root, assets, approvals);
  await writeFile(path.join(root, 'data', 'local', 'lifecycle', `${item.generationId}.json`), JSON.stringify(journal));
  const resumed = await buildRequiredPromotionPlan({ root, forgeRoot: root }, dependencies);
  assert.equal(resumed.pendingCount, 77);
  assert.equal(resumed.approvedCount, 1);
  assert.deepEqual(resumed.plan, beforeCrash.plan);
  assert.equal(resumed.digest, beforeCrash.digest);
});

test('partial failure resumes with the same plan, digest, and deterministic promotion arguments', async () => {
  const root = await tempRoot('forge-required-resume-');
  const canonical = canonicalRequiredPlan(syntheticPlan());
  const approved = new Set();
  let failOnce = true;
  const failedAssetId = canonical.plan[10].assetId;
  const planBuilder = async ({ root: observedRoot }) => {
    assert.equal(observedRoot, root);
    return syntheticPreflight(canonical, approved);
  };
  const promoter = async (options, context) => {
    assert.equal(context.root, root);
    const item = canonical.plan.find((candidate) => candidate.generationId === options.generationId);
    assert.ok(item);
    assert.deepEqual(options, {
      generationId: item.generationId,
      reviewer: 'human',
      note: requiredPromotionNote(canonical.digest),
      write: true,
      confirmed: true,
      expectedSourceSha256: item.sourceSha256,
      expectedApprovedPath: item.approvedPath
    });
    if (item.assetId === failedAssetId && failOnce) {
      failOnce = false;
      throw new Error('injected partial failure');
    }
    const resumed = approved.has(item.assetId);
    approved.add(item.assetId);
    return { status: 'approved', resumed };
  };
  const initial = await planBuilder({ root });
  const answer = requiredPromotionPhrase(canonical.digest);
  const partial = await executeRequiredPromotion(initial, answer, { root, forgeRoot: root, planBuilder, promoter });
  assert.deepEqual(partial, {
    status: 'partial-failure',
    digest: canonical.digest,
    count: 78,
    approvedCount: 10,
    remainingCount: 68,
    failedAssetId,
    error: 'injected partial failure'
  });
  const resumedPlan = await planBuilder({ root });
  assert.equal(resumedPlan.digest, initial.digest);
  assert.deepEqual(resumedPlan.plan, initial.plan);
  const completed = await executeRequiredPromotion(resumedPlan, answer, { root, forgeRoot: root, planBuilder, promoter });
  assert.deepEqual(completed, {
    status: 'approved',
    digest: canonical.digest,
    count: 78,
    approvedCount: 78,
    resumedCount: 10,
    newlyApprovedCount: 68,
    exported: false
  });
  assert.equal(approved.size, 78);
  assert.equal(await readFile(path.join(root, 'sentinel.txt'), 'utf8'), 'unchanged');
});

test('failed recovery preflight skips already-approved items and never double-counts them', async () => {
  const root = await tempRoot('forge-required-resumed-count-');
  const canonical = canonicalRequiredPlan(syntheticPlan());
  const initiallyApproved = new Set(canonical.plan.slice(0, 10).map((item) => item.assetId));
  const preflight = syntheticPreflight(canonical, initiallyApproved);
  let planBuilds = 0;
  let promoterCalls = 0;
  const planBuilder = async () => {
    planBuilds += 1;
    if (planBuilds === 1) return preflight;
    throw new Error('injected recovery preflight failure');
  };
  const promoter = async () => {
    promoterCalls += 1;
    throw new Error('injected promotion failure after approved skips');
  };
  const result = await executeRequiredPromotion(
    preflight,
    requiredPromotionPhrase(canonical.digest),
    { root, forgeRoot: root, planBuilder, promoter }
  );
  assert.equal(promoterCalls, 1);
  assert.deepEqual(result, {
    status: 'partial-failure',
    digest: canonical.digest,
    count: 78,
    approvedCount: null,
    remainingCount: null,
    failedAssetId: canonical.plan[10].assetId,
    error: 'injected promotion failure after approved skips'
  });
});

test('an all-approved same-batch retry is a journal-free no-op', async () => {
  const root = await tempRoot('forge-required-noop-');
  const canonical = canonicalRequiredPlan(syntheticPlan());
  const approved = new Set(canonical.plan.map((item) => item.assetId));
  const preflight = syntheticPreflight(canonical, approved);
  let promoterCalls = 0;
  const result = await executeRequiredPromotion(
    preflight,
    requiredPromotionPhrase(canonical.digest),
    {
      root,
      forgeRoot: root,
      planBuilder: async () => preflight,
      promoter: async () => { promoterCalls += 1; }
    }
  );
  assert.equal(promoterCalls, 0);
  assert.deepEqual(result, {
    status: 'approved', digest: canonical.digest, count: 78, approvedCount: 78,
    resumedCount: 78, newlyApprovedCount: 0, exported: false
  });
});

test('required execution rejects duplicated, unknown, and noncanonical status partitions', async () => {
  const root = await tempRoot('forge-required-partition-');
  const canonical = canonicalRequiredPlan(syntheticPlan());
  const valid = syntheticPreflight(canonical);
  for (const changed of [
    {
      ...valid,
      pendingGenerationIds: [...valid.pendingGenerationIds.slice(0, -1), valid.pendingGenerationIds[0]]
    },
    {
      ...valid,
      pendingGenerationIds: [...valid.pendingGenerationIds.slice(0, -1), 'gen_unknown']
    },
    {
      ...valid,
      pendingGenerationIds: [valid.pendingGenerationIds[1], valid.pendingGenerationIds[0], ...valid.pendingGenerationIds.slice(2)]
    }
  ]) {
    await assert.rejects(
      () => executeRequiredPromotion(changed, requiredPromotionPhrase(canonical.digest), { root }),
      /status partition/
    );
  }
});

test('an exact answer cannot authorize a plan that changes before mutation', async () => {
  const root = await tempRoot('forge-required-swap-');
  const first = canonicalRequiredPlan(syntheticPlan());
  const changedItems = structuredClone(first.plan);
  changedItems[0].sourceSha256 = 'f'.repeat(64);
  changedItems[0].approvedSha256 = 'f'.repeat(64);
  const changed = canonicalRequiredPlan(changedItems);
  let promoted = 0;
  await assert.rejects(
    () => executeRequiredPromotion(syntheticPreflight(first), requiredPromotionPhrase(first.digest), {
      root,
      forgeRoot: root,
      planBuilder: async () => syntheticPreflight(changed),
      promoter: async () => { promoted += 1; }
    }),
    /plan changed after interactive confirmation/
  );
  assert.equal(promoted, 0);
  assert.equal(await readFile(path.join(root, 'sentinel.txt'), 'utf8'), 'unchanged');
});
