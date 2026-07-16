// src/town/index.mjs
//
// Public API of the "habitable town" subsystem (src/town/**). This barrel is
// the one module every consumer (src/server.mjs, tests, future render
// adapters) imports from, so no caller reaches into an individual sibling and
// the internal file layout can change without breaking anyone.
//
// It re-exports the shared vocabulary and helpers (./schema.mjs), read-only
// signal collection (./signals.mjs), facility / TownModel derivation
// (./detect.mjs), and habitability scoring (./habitability.mjs), and adds one
// orchestrator — buildTown — that runs the full observe -> model -> assess
// pipeline in order.
//
// buildTown is async ONLY because collectSignals reads files from disk; that
// read is best-effort and read-only. The target repository's code, scripts,
// hooks, and package manager are NEVER executed here (or anywhere downstream),
// and no Date.now / Math.random / new Date() is used, so the same repository
// state plus the same inspection yield a structurally identical result. A
// missing / unreadable signal surfaces as "signal absent", never a crash.
//
// EVIDENCE SEPARATION is preserved end to end: every fact the pipeline
// surfaces stays tagged observed (statically read), inferred (derived), or
// unknown (needs runtime / not scanned). "Untested" / "not reached" is
// UNKNOWN, never a synonym for "broken".

// Imported for buildTown()'s orchestration below; each is also re-exported.
import { collectSignals } from './signals.mjs';
import { buildTownModel } from './detect.mjs';
import { assessHabitability } from './habitability.mjs';

// The legacy TownLayout imports remain available to this barrel while the CLI
// artifact path is retired separately; the server payload below uses WorldPlan.
import { repoFingerprint, defaultSeed } from './rng.mjs';
import { generateLayout } from './generator.mjs';
import { annotateLayout } from './validator.mjs';
import { GENERATOR_VERSION } from './schema.mjs';
import { generateWorldPlan } from './world-plan-generator.mjs';
import { annotateWorldPlan } from './world-plan-validator.mjs';

// --- re-exported public surface ---------------------------------------------

// Shared vocabulary, contracts, and helpers (source-of-truth for the whole
// subsystem). Ordered as declared in ./schema.mjs.
export {
  deepFreeze,
  EVIDENCE_CLASSES,
  FACILITY_LABELS,
  FACILITY_KINDS,
  isFacilityKind,
  HABITABILITY_LEVELS,
  ASSET_CATEGORIES,
  DRAW_LAYERS,
  GUILD_TABS,
  makeEvidence
} from './schema.mjs';

// Read-only repository signal collection.
export { collectSignals, signalDefaults } from './signals.mjs';

// Facility / TownModel derivation from one inspection + one signals bag.
export { isConnectionBuilding, buildTownModel } from './detect.mjs';

// Habitability scoring of a TownModel.
export { assessHabitability } from './habitability.mjs';
export { validateWorldPlan } from './world-plan-validator.mjs';

// --- orchestrator -----------------------------------------------------------

/**
 * Run the full town pipeline for one repository: collect read-only signals,
 * fold them together with the AST inspection into a TownModel, then assess the
 * model's habitability. Async only because signal collection reads files; the
 * target repository is never executed, so the result is deterministic for a
 * given repository state and inspection. collectSignals never throws (every
 * missing / unreadable source degrades to an absent signal), and buildTownModel
 * tolerates a missing / malformed `inspection` by degrading to an empty town,
 * so this orchestrator does not add its own error handling.
 *
 * @param {string} repoPath - path to the repository root (read only, never executed)
 * @param {object} inspection - src/inspector.mjs buildInspection(scan) output (schemaVersion 2)
 * @returns {Promise<{ model: import('./schema.mjs').TownModel, habitability: import('./schema.mjs').Habitability, signals: import('./signals.mjs').RepoSignals }>}
 */
export async function buildTown(repoPath, inspection) {
  const signals = await collectSignals(repoPath);
  const model = buildTownModel(inspection, signals);
  const habitability = assessHabitability(model);
  return { model, habitability, signals };
}

// --- server payload assembler -----------------------------------------------

/**
 * Assemble GET /api/town v2 for one already-inspected repository. The payload
 * intentionally contains only what the renderer consumes: repository identity,
 * habitability, structured facts, and one fully resolved WorldPlan. TownModel is
 * an input to generation rather than a second competing frontend data model.
 *
 * The caller supplies an inspection it already produced (src/server.mjs shares
 * one inspection between /api/city and /api/town), so the read-only target
 * repository is not scanned twice and its code is never executed. Generation
 * and validation are pure and deterministic, so identical inputs produce a
 * byte-identical payload.
 *
 * @param {string} repoPath - repository root (read only, never executed); used
 *   only to re-collect read-only signals inside buildTown.
 * @param {object} inspection - src/inspector.mjs buildInspection(scan) output (schemaVersion 2)
 * @param {{ seed?: string|null }} [options] - `seed` overrides the stable
 *   repository-name world seed; omit for the deterministic default.
 * @returns {Promise<{schemaVersion: 2, repository: {name: string}, habitability: object, facts: object[], worldPlan: object}>}
 */
export async function buildTownPayload(repoPath, inspection, options = {}) {
  const { model, habitability } = await buildTown(repoPath, inspection);
  const worldPlan = annotateWorldPlan(generateWorldPlan({
    inspection,
    model,
    ...(options.seed == null ? {} : { seed: String(options.seed) })
  }), { inspection });
  if (worldPlan.validation?.ok !== true) {
    throw new Error('Generated WorldPlan failed validation');
  }
  return {
    schemaVersion: 2,
    repository: { name: inspection?.repository?.name ?? '' },
    habitability,
    facts: worldPlan.facts,
    worldPlan
  };
}
