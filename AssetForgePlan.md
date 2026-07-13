# CodeCity Inspector — Asset Forge development plan

Status: implemented; required 78 assets approved/exported and integrated, owner provenance/visual sign-off recorded
Date: 2026-07-12
Lead: Codex `/root`
Middle manager: Terra `/root/terra`
Worker: Luna `/root/terra/luna`

This plan turns the attached Asset Forge requirements into an executable development program. The attached requirements are authoritative. Where they leave a technical choice open, this plan records the Lead decision and its verification gate.

## 1. Outcome and honest completion levels

The product outcome is a small playable CodeCity game whose art pipeline lives inside this repository and does not require paid OpenAI API image generation.

Completion is deliberately split into three levels:

1. **Forge engine complete**
   - mock, dry-run, job-pack, manual-import, processing, lifecycle, and approved-only export work under automated checks;
   - the Codex subscription provider is either independently verified and safely enabled, or remains an explicit unavailable stub;
   - no generated candidate is automatically approved.
2. **Human-approved content ready**
   - the required reference images and game assets have been reviewed and approved by a human;
   - hashes, license notes, prompt provenance, and approval notes are present;
   - runtime binding coverage has no missing asset used by the game.
3. **Playable game complete**
   - the Canvas renderer consumes the approved export manifest;
   - a player can move on walkable tiles with collision;
   - building inspection and the existing evidence/guild UI still work;
   - a human has performed visual and interaction review.

Level 1 alone must never be reported as “the game is complete.” Mock success must never be reported as art-direction success.

## 2. Verified baseline

### Observed

- Local HEAD and GitHub `main` both point to `c4815f277eb5a745c3817c31081cae224bfa2504`.
- GitHub Actions run `29187779319` completed successfully for that SHA. Its log reports 168 tests, 168 passed, 0 failed.
- The working tree was clean before this plan was added.
- `src/generate-town.mjs` refuses to write a layout when `layout.validation.ok` is false.
- `buildTownPayload()` currently returns the annotated layout without checking `layout.validation.ok`.
- `test/server.test.mjs` checks that `layout.validation` exists but not that `layout.validation.ok === true`.
- `public/` contains a procedural Canvas town, building selection, evidence display, and guild UI.
- README and Plans still describe the frontend as a minimal/backend-only placeholder.
- `tools/asset-forge/` does not exist.
- The formal requirements enumerate 104 minimum asset IDs:
  - character: 27
  - building: 16
  - field: 17
  - object: 29
  - UI: 8
  - effect: 7

### Inferred

- The HTTP validation gap may remain invisible while the current generator always produces valid layouts, but the documented contract is not enforced at the API boundary.
- The formal six authoring categories and the existing ten renderer categories describe different concerns and should not replace one another.
- The current procedural renderer is the safest fallback while approved art is incomplete.

### Unknown until separately verified

- Local test results for the working tree after this plan; no local tests were run during planning.
- Current browser behavior; the existing commit message’s browser claim is not CI evidence.
- A stable local Codex-subscription image-generation command, its billing boundary, automation terms, input/output contract, and exit behavior.
- The visual quality, license status, and suitability of future human-provided references and generated candidates.

## 3. Non-negotiable invariants

1. Inspected repositories remain read-only. Their source, scripts, tests, hooks, and package manager are never executed.
2. Source code and repository analysis are never uploaded. Image-generation jobs contain only art prompts, output requirements, and approved art references.
3. The server remains bound to `127.0.0.1` and keeps the Host-header and CSP protections.
4. No OpenAI API client, `openai` SDK, `OPENAI_API_KEY`, paid API fallback, or `.env`-based API setup is added.
5. Generation defaults to mock or dry-run. A subscription command requires both an explicit provider and `--yes-subscription`.
6. Every generated or imported candidate goes to `pending`; no automated operation adds to `approved`.
7. Only a human may make the approval decision. Agents must not run a successful promote command.
8. Approved inputs and outputs are immutable: no overwrite, implicit replacement, or deletion.
9. Export reads approved assets only, defaults to dry-run, and requires `--write` for changes.
10. Observed, inferred, and unknown states stay separate. Untested does not mean broken.
11. Worker claims are `pending-inspection` until the Lead independently verifies the diff and evidence.
12. Distribution and security-sensitive changes require a separate read-only reviewer.

## 4. Product and architecture decisions

### 4.1 Preserve both category systems

The formal six categories remain the canonical **authoring taxonomy**. The existing renderer vocabulary remains the canonical **runtime taxonomy**.

| Authoring category | Stored directory | Possible runtime category | Binding discriminator |
| --- | --- | --- | --- |
| `character` | `characters` | `npc`, `mob` | `npcRole`, character class |
| `building` | `buildings` | `building_exterior`, later `building_interior` | `facilityKind`, state |
| `field` | `fields` | `tile` | `tileType`, adjacency/variant |
| `object` | `objects` | primarily `prop`, explicitly `vehicle` when needed | `propKind` or explicit renderer category |
| `ui` | `ui` | `ui` | component/slot |
| `effect` | `effects` | `effect` | effect kind/state |

Every asset definition gets an explicit `gameBinding`; export must not guess from a category name. The binding contains, as applicable:

- `rendererCategory`
- `facilityKind`, `npcRole`, `propKind`, or `tileType`
- `drawLayer`
- state mapping
- direction mapping
- animation/frame mapping

This is required because mappings are not one-to-one. Examples include `barkeep` versus `tavern_master`, `up/down` versus `back/front`, and the renderer’s five building states versus the authoring specification’s eight visual states.

The 104 formal IDs are the minimum catalog. A coverage validator will compare them with `ASSET_CATEGORIES`, `TILE_TYPES`, `FACILITY_KINDS`, `NPC_ROLES`, `PROP_KINDS`, and `DRAW_LAYERS`. Missing runtime concepts such as guild assets or terrain/prop variants must be added explicitly or deliberately bound to an approved shared asset. No silent fallback counts as coverage.

### 4.2 Dependency boundary

`tools/asset-forge/` has its own `package.json` and exact lockfile. Root runtime dependencies do not grow.

- CLI parsing: Node built-ins; do not add Commander.
- Schema validation: Ajv using JSON Schema draft-07. The requirements do not need draft-2020-12 features, and draft-07 keeps the validator simpler.
- Image inspection/conversion/alpha/trim/sprite work: Sharp, exact-locked, after dependency and security review.
- Deterministic mock PNG: a small Node-core encoder, so mock byte determinism does not depend on a native Sharp/libvips build.
- No HTTP/API client dependency.

Asset Forge may require Node `>=20.9.0` because current Sharp prerequisites are stricter than the root’s broad Node 20 declaration. This applies to the development subproject, not to ordinary CodeCity inspection/runtime use.

### 4.3 Tracked and local state

| State | Git policy |
| --- | --- |
| schemas, prompts, definitions, config example, docs | tracked |
| reference catalog and approved-reference metadata | tracked |
| `references/approved/` originals and sidecars | tracked after human approval |
| jobs, pending, rejected, processed, temp, cache | ignored except directory keepers |
| runtime generations ledger | ignored/local |
| approved asset originals, sidecars, append-only approval ledger | tracked after human approval |
| approved-derived public export and export manifest | tracked when deliberately exported |
| local subscription command configuration | ignored |

This split prevents a tracked manifest from pointing at gitignored pending files. Tracked ledgers contain reference, approval, and export truth; local ledgers contain candidate-generation history.

### 4.4 Image-generation boundary

The image-generation capability available in the Codex conversation is not treated as a callable repository CLI. It can be used later to create a candidate, followed by manual import. Until a stable local subscription command is verified, `codex-subscription` remains an unavailable stub. Lack of that command does not trigger API fallback.

## 5. Roles, ownership, and escalation

### Orchestration topology, concurrency, and token budget

There is exactly **one middle manager**, Terra. Adding more managers would consume the four-agent concurrency limit without increasing independent implementation capacity.

The maximum live topology is:

```text
Lead /root (command, product decisions, integration, independent verification)
└── Terra (the sole middle manager; work packets and evidence review)
    └── Luna (implementation worker; one bounded owns set at a time)

Independent Aegis reviewer (read-only, security/distribution gates only)
```

Parallelism is organized into lanes:

- **Lead lane:** existing backend/frontend, root integration, baseline and acceptance checks.
- **Terra/Luna lane:** one non-overlapping Asset Forge module wave.
- **Reviewer lane:** activated only when a security/distribution boundary is ready; it never edits.

Implementation may proceed speculatively in parallel when file ownership and inputs do not overlap, but acceptance remains ordered. A later-phase artifact cannot be integrated or called complete until every predecessor gate it depends on has passed.

The initial total budget is **180,000 tokens across all agents**:

| Role | Budget | Purpose |
| --- | ---: | --- |
| Lead | 45,000 | integration, tests, product decisions, reporting |
| Terra | 25,000 | decomposition, management, evidence review |
| Luna | 90,000 | implementation and module-level checks |
| independent reviewer | 20,000 | security/distribution review |

At 50% usage the Lead reconciles actual progress with remaining phases. At 80% usage, scope expansion stops and the remaining budget is reserved for verification, corrections, and the technical/non-technical completion reports. Exceeding 180,000 requires a new user-approved estimate.

Irreversibility is controlled by:

- recording the base SHA and current diff before every work packet;
- preserving pre-existing/user-owned changes;
- assigning non-overlapping files and rejecting ownership drift;
- implementing one reversible module slice at a time;
- using temp fixtures and atomic/no-overwrite writes for generated state;
- running focused module checks before the full project check;
- never deleting or replacing approved/public assets automatically;
- letting only the Lead integrate, commit, or publish after independent evidence review.

### Lead — `/root`

Owns product decisions, integration, independent verification, commits, pushes, and publication.

Owned files:

- root `.gitignore`, package scripts/lock, README, Plans, Security, notices
- `.github/**`
- existing `src/**`, `test/**`, and `public/**`
- this plan
- final integration commits and release evidence

The Lead independently reruns accepted checks at the same SHA and does not accept Terra/Luna self-reports as proof.

### Terra — `/root/terra`

Acts as middle manager and does not normally edit production files.

Responsibilities:

- break each phase into a bounded work packet;
- assign an explicit `owns` list to Luna before work begins;
- inspect Luna’s diff, tests claimed, omissions, and unknowns;
- verify that outputs match the phase contract;
- return a `pending-inspection` recommendation to the Lead;
- stop work on ownership drift or a violated invariant.

### Luna — `/root/terra/luna`

Acts as the implementation worker.

Permanent boundary:

- may edit only the currently assigned files under `tools/asset-forge/**`;
- must not edit root integration, existing backend/frontend, actual approved assets, or human reference images;
- must not commit, push, publish, or run a successful promote command;
- may run only CodeCity/Asset Forge development checks explicitly assigned by Terra, never an inspected repository’s scripts or package manager;
- must report what was not tested.

### Separate read-only security reviewer

A fourth, non-implementing reviewer is required before accepting:

- Ajv/Sharp and lockfile/license changes;
- child-process execution;
- import/export path handling;
- CI and distribution changes;
- final security documentation.

The reviewer edits nothing and reports findings to the Lead.

### Human project owner

Only the human project owner may:

- provide and license reference images;
- decide visual approval/rejection;
- run the successful promote ceremony;
- authorize publication.

`--reviewer human` cannot technically prove human identity. TTY checks, explicit `--write`, a note, hashes, and an append-only approval record reduce accidental automation but do not replace human review.

## 6. Delivery phases and gates

No phase begins until the preceding gate is accepted by the Lead. Luna receives a fresh `owns` list for every wave.

### Phase 0 — Baseline truth and backend contract repair

Owner: Lead
Terra/Luna role: read-only review

Work:

1. Record local and GitHub `main` SHAs and preserve any user changes.
2. Run the existing root check locally at the recorded SHA.
3. Add an explicit `/api/town` validation gate. Invalid generated layouts are an internal generation failure, so the HTTP response is a generic 500 without source or issue-detail leakage.
4. Add a success assertion for `town.layout.validation.ok === true` and a forced failure-path test for the gate.
5. Keep the CLI’s existing non-write/nonzero behavior.
6. Update README and Plans to describe the current procedural Canvas frontend honestly.

Gate:

- root check passes at the stated SHA;
- forced invalid layout cannot be returned with HTTP 200;
- success response explicitly proves `validation.ok === true`;
- CLI and HTTP contracts agree;
- no browser claim is made without a browser check.

### Phase 1 — Contract, scaffold, and complete catalog

Luna wave 1 owns:

- `tools/asset-forge/package.json`
- `tools/asset-forge/README.md`
- `tools/asset-forge/AGENTS.md`
- config example
- `schemas/**`, `prompts/**`, `data/asset-definitions/**`
- tracked manifest templates and `references/README.md`

Lead owns the subproject lockfile decision and root integration.

Work:

1. Create the documented directory structure and safe empty-directory keepers.
2. Define strict draft-07 schemas with `additionalProperties: false` where appropriate.
3. Add all 104 formally required IDs.
4. Add explicit `gameBinding` data and any additional runtime coverage assets.
5. Add common/category prompts and character anti-drift rules.
6. Add missing human reference placeholders for each art family.
7. Add safe default and example configuration with subscription disabled.

Gate:

- every definition validates and has nonempty `promptFiles`;
- IDs are unique and the formal 104-ID checklist is complete;
- every runtime semantic ID is either explicitly bound or reported missing;
- references are `missing` placeholders with human/license fields;
- no OpenAI SDK, API key, `.env.example`, API provider, or network client exists;
- no image is generated in this phase.

### Phase 2 — Safe filesystem, schemas, and manifests

Luna wave 2 owns:

- core config/path/hash/filesystem/schema/validation modules
- `src/manifests/**`
- schema/path/manifest tests

Work:

1. Centralize all allowed roots and category/ID-to-path conversion.
2. Reject traversal, unexpected absolute output paths, NUL/backslash ambiguity, and symlink escape.
3. Use safe create/no-overwrite operations.
4. Write JSON canonically and atomically through temp-file plus rename.
5. Serialize manifest writes with a single-writer lock; reject unsafe concurrency.
6. Keep local candidate ledgers separate from tracked approval truth.
7. Add SHA-256 utilities and tree-hash utilities for approval invariants.
8. Add cross-file validation beyond JSON Schema.

Gate:

- traversal, absolute path, symlink, collision, malformed JSON, duplicate ID, missing reference, and concurrent writer tests pass;
- fault injection cannot silently leave a success record with a missing file;
- failed writes are reported as failed/unknown, never approved;
- the approved tree hash remains unchanged.

### Phase 3 — Mock vertical pipeline and core CLI

Luna wave 3 owns:

- provider registry and mock provider
- job definition/build/run/batch modules
- CLI commands `generate`, `batch`, `validate`, `list`, `doctor`
- mock, generation flow, and no-auto-approve tests

Work:

1. Default to mock; dry-run performs validation/planning without artifact writes.
2. Build jobs from definitions, prompt contents, and approved-reference hashes.
3. Generate a deterministic valid PNG from asset ID, seed, prompt hash, reference hashes, and output contract.
4. Save real mock candidates and metadata to pending only.
5. Record provider failure as failed metadata without pretending success.
6. Set batch default to 10 jobs and hard maximum to 50.
7. Make doctor distinguish configured, unavailable, and unknown states.

Gate:

- identical inputs in two different temporary roots produce byte-identical PNG and SHA-256;
- a changed prompt/reference/seed changes the provenance key;
- PNG magic, dimensions, pixel contents, metadata, and ledger agree;
- dry-run leaves the entire tree unchanged;
- generation/batch failures are visible;
- every non-promote operation leaves the approved tree hash unchanged;
- no authentication or external connection is attempted.

### Phase 4 — Job pack and manual import

Luna wave 4 owns the job-pack/manual-import providers, supporting job writers, CLI commands, and tests.

Work:

1. Produce a self-contained job pack with job JSON, prompt, approved reference copies/hashes, output contract, import command, and README.
2. Generate no image and spawn no command for a job pack.
3. Import PNG/JPEG/WEBP using file signature plus bounded image inspection, not extension alone.
4. Reject SVG and other active/unsupported formats.
5. Limit input bytes, decoded pixels, dimensions, and frame count before processing.
6. Normalize accepted imports to PNG while preserving the source file.
7. Save candidates and provenance to pending only.

Gate:

- job-pack content, prompt hash, reference hashes, and output contract are asserted;
- missing/unapproved references are rejected unless an explicitly documented pending-reference override is used;
- invalid magic, decompression-bomb dimensions, traversal, symlink, and unsupported formats are rejected;
- source hash is unchanged after import;
- pending and metadata are complete; approved is unchanged.

### Phase 5 — Processing, sprites, and rejection lifecycle

Luna wave 5 owns `src/images/**`, processing/rejection commands, and tests.

Work:

1. Implement black, white, and explicit-color alpha key with bounded tolerance and no feathering by default.
2. Implement transparent trim and nearest-neighbor normalization.
3. Implement schema-driven grid sprite extraction first.
4. Keep bounding-box and connected-component extraction optional until the grid path is complete.
5. Save every derivative under processed pending state without overwriting its source.
6. Implement reject with a mandatory reason and ledger update.
7. Implement promote guards and the human ceremony, but agents do not run a successful promote command.

Promote ceremony:

- interactive TTY;
- `--reviewer human`;
- explicit `--write`;
- nonempty approval note;
- source and destination hashes shown before confirmation;
- no destination collision;
- append-only approval record.

Gate:

- pixel-level alpha results are asserted for black/white/explicit keys;
- invalid tolerance is rejected;
- trim reduces only transparent margins;
- sprite coordinates, frame dimensions, and output pixels match the schema;
- source hashes remain unchanged;
- automated checks exercise pure transition logic and refusal paths, not a successful real-project promotion;
- all non-promote paths leave approved unchanged.

### Phase 6 — Subscription provider security gate

Luna wave 6 initially owns only an unavailable stub, its configuration schema, doctor output, and refusal tests.

Enabling command execution requires all of the following:

1. A human identifies the exact local command and confirms it does not require an API key or paid API call.
2. Input/output, exit codes, timeout behavior, and automation terms are documented.
3. Local configuration remains ignored and subscription is disabled in tracked config.
4. A separate read-only security reviewer accepts the implementation.

Adapter rules if enabled:

- require `--provider codex-subscription --yes-subscription`;
- use `spawn(command, args, { shell: false })`;
- substitute placeholders as individual argument values, never shell text;
- use a bounded working directory and controlled output path;
- enforce timeout/termination and bounded batch size;
- cap and redact stdout/stderr before metadata storage;
- never store environment, auth/session data, or raw confidential output;
- inspect the output image in a temp location before atomically moving it to pending;
- never fall back to an API.

Gate:

- unconfigured, disabled, and missing-yes paths execute nothing;
- a repository-owned harmless fake driver proves success, nonzero exit, timeout, missing output, malformed output, and log truncation behavior;
- secret markers do not appear in metadata;
- successful simulated output lands in pending only;
- security reviewer findings are resolved or the provider remains a stub.

The stub is an acceptable formal result when availability or billing cannot be proven.

### Phase 7 — Approved-only export and runtime binding

Luna wave 7 owns export modules/tests inside Asset Forge. Lead owns the actual `public/` integration.

Work:

1. Export approved assets only.
2. Default to a plan; require `--write` to write.
3. Validate every `gameBinding` against the existing runtime vocabulary.
4. Produce a versioned, hash-bearing game manifest.
5. Restrict writes to the configured generated public root.
6. Never delete or overwrite an existing public asset.
7. Fail on collision or use a deliberate content/version path.

Gate:

- pending/rejected paths are rejected;
- missing/invalid bindings are listed and block a complete export;
- collision and traversal fail safely;
- dry-run leaves public unchanged;
- write mode copies only approved content and the manifest hashes match;
- export receives a separate read-only security review.

### Phase 8 — Canvas vertical slice and small playable game

Owner: Lead for `public/**`; Luna may receive a later, non-overlapping Asset Forge data packet only.

Work:

1. Load and validate the approved export manifest.
2. Preload/cache images; missing or failed images use the current procedural renderer with a visible diagnostic, not a silent success.
3. Integrate a small approved slice first: player, core ground/path, town hall/inn or pub, a sign/prop, dialogue UI, and one light effect.
4. Add player movement with keyboard controls, walkable-tile rules, and building collision.
5. Preserve building selection, evidence classes, habitability, guild UI, CSP, and loopback behavior.
6. Do not add scoring, quests, a framework, or speculative game systems.

Gate:

- structural tests cover manifest loading, binding lookup, fallback, walkability, and collision;
- root and Forge checks pass independently;
- a human reviews the rendered slice, keyboard behavior, accessibility, and browser console;
- the browser review records SHA, environment, steps, and screenshots/notes;
- visual judgment remains human approval, not an automated pass.

### Phase 9 — Content waves

Order:

1. characters
2. buildings
3. fields/terrain
4. objects/props
5. UI and effects

Each content wave follows:

`job pack or subscription candidate -> pending -> human review -> human promote -> approved-only export -> game review`

Gate per asset:

- approved reference IDs and hashes;
- prompt hash and output contract;
- source/provider classification;
- candidate and approved SHA-256;
- license note;
- human approval note/date;
- correct binding and in-game placement;
- no missing semantic ID used by the game.

The engine can prepare job packs and import candidates, but it cannot close a content wave without human approval.

### Phase 10 — CI, documentation, independent review, and release handoff

Owner: Lead. Security reviewer is read-only.

Work:

1. Keep root runtime dependencies unchanged.
2. Add minimal root Asset Forge convenience scripts.
3. CI installs/checks the two projects separately:
   - root `npm ci` and root check;
   - `npm ci --prefix tools/asset-forge` and Asset Forge check.
4. CI runs mock/dry-run fixtures only; no subscription, manual real asset, promote, or external generation.
5. Update README, Plans, Security, third-party notices, and Asset Forge docs.
6. Obtain the separate distribution/security review.
7. Lead records the final commit SHA and macOS Actions run ID.
8. Push/release only with user authorization and never directly to `main` by default.

Gate:

- both lockfiles are exact and reproducible;
- all approved reviewer findings are resolved;
- CI is tied to the reported commit SHA;
- completion report follows the formal format and includes every unverified item;
- no `openai` dependency, API key request, hidden network call, or auto-approval path exists.

## 7. Luna work packets and file ownership

Terra reissues these boundaries before each wave; they are not cumulative permission to edit everything at once.

| Wave | Luna owns | Luna does not own |
| --- | --- | --- |
| W1 | scaffold, Asset Forge docs/rules/config example, schemas, prompts, definitions, reference docs/templates | root integration, real references/assets |
| W2 | safe core, validators, manifests, related tests | providers, root files |
| W3 | mock, jobs, core CLI, mock/generation tests | job-pack/import/process/subscription/export |
| W4 | job-pack/manual-import modules and tests | process/subscription/export |
| W5 | image processing, sprite, reject/promote guards, tests | actual promote execution or approved files |
| W6 | subscription stub/adapter and tests | local real config, credentials, actual subscription run |
| W7 | export implementation/tests inside Asset Forge | `public/**`, actual approved exports |

`tools/asset-forge/package-lock.json` is generated/accepted under Lead supervision after dependency review. Luna never commits or pushes.

## 8. Test and inspection matrix

| Concern | Automated evidence | Human/independent evidence |
| --- | --- | --- |
| backend gate | valid and forced-invalid API tests | Lead diff/contract review |
| schemas/catalog | valid/invalid fixtures, 104-ID checklist, runtime coverage | product vocabulary review |
| path safety | traversal, absolute, symlink, collision, race fixtures | security reviewer |
| mock | PNG byte/hash/pixel determinism across temp roots | none required for art quality |
| dry-run | before/after complete tree hash | Lead command review |
| job pack | full prompt/ref/output-contract assertions | usability review of instructions |
| manual import | magic, dimensions, pixels, source hash, pending metadata | source/license confirmation |
| processing | pixel-level alpha/trim/frame assertions | visual edge review |
| approval | pure transition and refusal tests | successful promote and visual decision by human only |
| subscription | refusal/fake-driver/timeout/log-redaction tests | billing/terms/security verification; real run only on request |
| export | approved-only, binding, collision, hashes | security review and game content review |
| renderer/game | manifest/fallback/movement/collision tests | browser, accessibility, and art-direction review |
| CI/release | SHA-bound root+Forge checks | separate distribution/security review |

All filesystem tests use temporary fixtures. They do not execute an inspected repository’s code, scripts, tests, hooks, or package manager.

## 9. Anti-reward-fraud acceptance protocol

For every Luna handoff:

1. Terra compares `git diff --name-only` with the assigned `owns` list.
2. Terra reports observed changes, inferred behavior, unknown behavior, and untested paths separately.
3. The Lead inspects the diff and independently reruns the accepted commands.
4. The Lead records:
   - base and tested commit SHA;
   - environment and Node versions;
   - exact commands;
   - stdout/stderr summary;
   - tests passed/failed/skipped;
   - artifacts and hashes;
   - what was not checked.
5. Every report classifies work as mock, dry-run, job-pack, manual-import, subscription-run, and API usage.
6. Before and after every non-promote operation, tests compare the complete approved-tree hash.
7. Existence alone is not success: image magic, dimensions, pixels where relevant, metadata, ledger, and hashes must agree.
8. A worker’s “done,” commit message, or browser statement is not proof.
9. CI success is reported only with a run URL/ID tied to the exact SHA.
10. Human aesthetic approval remains a separate gate even when all technical checks pass.

## 10. Primary risks and controls

| Risk | Control |
| --- | --- |
| API billing or secret leakage | no API provider/client; dependency scan; config whitelist; log redaction; no `.env` |
| arbitrary command execution | disabled-by-default adapter; explicit local config and double guard; `shell:false`; reviewer |
| path traversal/symlink escape | central containment and realpath rules; no-overwrite output; adversarial tests |
| image/decompression bomb | byte/pixel/dimension/frame caps; signature inspection; Sharp limits |
| native dependency/ABI/supply-chain | subproject lock, license/notice review, macOS CI, separate reviewer |
| manifest corruption/race | single-writer lock, temp write, atomic rename, fault-injection tests |
| tracked manifest pointing to ignored data | split local generations from tracked approval/export truth |
| automatic or fake approval | no agent promote, TTY+write+note ceremony, immutable destination, append-only hashes |
| category mismatch | explicit per-asset `gameBinding` and runtime coverage gate |
| incomplete art mistaken for game completion | three distinct completion levels and procedural fallback diagnostics |
| docs drifting from behavior | phase gates update docs with code; reports list unknowns |
| target repository execution | temp fixtures only; scanner safety regression tests; no target package manager |

## 11. Requirements traceability

| Formal requirement sections | Delivery phase |
| --- | --- |
| 0–1 anti-fraud and backend inspection | Phase 0 and acceptance protocol |
| 2–5 purpose, invariants, providers, directories | Phases 1–4 |
| 6 root integration | Phase 10 |
| 7–8 flow and CLI | Phases 2–7 |
| 9–12 providers | Phases 3, 4, 6 |
| 13 schemas/data model | Phases 1–2 |
| 14–16 asset catalog/references/character rules | Phase 1 and content waves |
| 17–18 transparency/sprites | Phase 5 |
| 19 export | Phase 7 |
| 20–21 rules/ignore/config | Phases 1 and 10 |
| 22 tests | Every phase’s gate |
| 23 documentation | Phases 1 and 10 |
| 24 implementation order | Phase sequence in this plan |
| 25 completion | Three completion levels and final gate |
| 26 report format | Acceptance protocol and final report |

The Canvas integration and minimal movement slice are explicit additions needed to reach the user’s stated “complete the game” outcome; they do not weaken or replace the formal Asset Forge requirements.

## 12. Stop conditions

Work stops and returns to the Lead when:

- an operation would write outside its assigned roots;
- target source/test/script/package-manager execution is required;
- a dependency or provider introduces an API key or paid API path;
- a subscription command’s billing/terms cannot be established;
- an approved file would be overwritten or deleted;
- Luna’s diff leaves its current `owns` list;
- the same security blocker survives three review turns;
- human approval or a human-supplied reference is the only remaining step.

These conditions are blockers to that specific action, not evidence that the untested feature is broken.
