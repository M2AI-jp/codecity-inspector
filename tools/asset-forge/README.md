# CodeCity Asset Forge

Asset Forge is the game-art workshop inside CodeCity Inspector. It defines the art the game
needs and creates mock candidates, job packs, manual imports,
metadata, image derivatives, and approved-only game exports.

Asset Forge is not an automatic art director. It cannot decide that an image is good
enough for the game. Every generated or imported candidate remains pending until a human
approves it.

Asset Forge は自動アートディレクターではありません。候補生成、job pack、取り込み、
metadata、透過処理、sprite抽出、approved素材のexportを管理しますが、採用判断は人間だけが行います。

## Current observed scope

The Forge engine is implemented: strict schemas and path boundaries, the complete catalog,
deterministic mock generation, dry-run, job packs, bounded PNG/JPEG/WEBP import, alpha/trim/grid
processing, rejection, guarded interactive promotion under the human-review policy, and
approved-only export. The Canvas
runtime consumes the export manifest and fails closed with a visible error when approved art
is absent; it does not substitute mock, legacy, or procedural art.
When multiple approved assets target the same runtime binding or semantic, the manifest keeps
every variant. The current game runtime uses fixed authored world structures, props, residents,
and sites, plus deterministic ground transforms and navigation. It does not currently generate
repository-specific geography from those variants.
Character and effect sheets are cropped from validated frame metadata; they are never shrunk
as whole sheets into one tile.

The catalog contains 110 v1 definitions: 78 formed the legacy v1 runtime gate and 32 were optional
future enhancements. The previous low-quality approved/public production set was removed;
the replacement 78 were explicitly approved and exported for that legacy runtime. This is immutable
approval history, not a claim that the Fable5 redesign has enough art or is complete. The project owner
has explicitly judged that 78-set insufficient in quantity and variety and that the old runtime used the
available material badly. Each legacy required definition is
paired with exactly two approved input references: `world_visual_master` plus one directly
targeted primary sheet. The optional 32 remain outside the required export. Reference readiness
is not a claim that automated checks decided final candidate quality, licensing, or art direction.
The current `field.cobblestone`, `field.rock`, and `field.tree` definitions contain semantic
conflicts with their approved recipes/runtime use and must be corrected before recommissioning.
Existing approved IDs now have an explicit supersede workflow: a new pending candidate goes
through the same interactive human promotion ceremony before the current pointer can change.
Previous approved bytes and approval records remain immutable, connected by an append-only
supersession record. Historical wave scripts are still not incremental remake tools. The
`manual-import` CLI can attach a production recipe, verify a job pack, and materialize the
persistent original source snapshot into pending provenance. Only the same interactive human
promotion ceremony may copy that exact snapshot into `approved/` and switch the approved metadata
to the immutable approved path. The public
`process` command exposes alpha key/tolerance, trim, and grid extraction, not general nearest
resize or universal hard-alpha/seam rejection.

The current production-recipe and character-contract schemas still describe the legacy 24×40,
four-direction/three-row v1 sprite sheets. The approved Fable5 contract (48×96 and ten actions)
belongs to the later Phase 0-B schema/catalog migration and is not delivered by this Phase 0-A
replacement-lifecycle slice.

## No paid API path

This subproject must not call the OpenAI API, add the `openai` SDK, require
`OPENAI_API_KEY`, or silently fall back to paid API generation.

The intended modes are:

- `mock`: deterministic local test images
- `dry-run`: report a plan without generating an image
- `job-pack`: write a portable prompt/reference/output contract; generate no image
- `manual-import`: inspect and copy an externally produced image to pending
- `codex-subscription`: optional local adapter, unavailable unless explicitly configured and
  guarded by `--yes-subscription`

No safe subscription image command has been independently established, so
`codex-subscription` is an unavailable stub. It starts no child process and never falls back
to an API.

## Commands

```sh
npm run check
npm run validate
npm run dry-run

# Requires approved human-provided references
npm run make-job -- --asset character.player

# Recipe-aware incremental import; result remains pending
npm run import -- --asset character.player --file /absolute/path/candidate.png \
  --job-pack generated/jobs/JOB_DIRECTORY/job-pack.json \
  --recipe review/recipes/character_player.json --materialize-source

# Retry source snapshot materialization without re-importing candidate bytes
node src/cli.mjs persist-source --generation GEN_ID

# Local processing of a pending candidate
npm run process -- --generation GEN_ID --alpha-key black --tolerance 0 --trim

# Rejection requires a reason
npm run reject -- --generation GEN_ID --reason "human review note"

# Promotion refuses non-TTY/automation and requires reviewer, note, write, hash confirmation
npm run promote -- --generation GEN_ID --reviewer human --note "human decision" --write

# A replacement names the current generation inside the same human ceremony
npm run promote -- --generation NEW_GEN_ID --supersedes CURRENT_GEN_ID \
  --reviewer human --note "approved replacement" --write

# One interactive operator review for the complete required 78; approval only, never export
npm run promote-required

# Approved-only export is dry-run unless --write is present
npm run export
npm run export -- --write
```

## Catalog and game bindings

The six authoring categories are `character`, `building`, `field`, `object`, `ui`,
and `effect`. They describe how art is commissioned. They are intentionally separate from
the renderer categories used by the current game model.

Every asset definition includes an explicit `gameBinding`:

- `rendererCategory`: renderer-facing class such as `tile`, `npc`, or `prop`
- `semanticKind`: stable visual meaning used by an export adapter
- `drawLayer`: current layout draw order
- `runtimeBindings`: zero or more links to observed runtime vocabularies
- `coverage`: `exact`, `mapped`, or `future`

This avoids changing the current town schema merely to fit the authoring taxonomy.
`data/manifests/runtime-coverage.json` records incomplete and lossy mappings explicitly.
Its current `uncovered` list is empty. `coverage: future` definitions remain available without
blocking MVP art completion unless their image is already consumed by the runtime (the player,
water ripple, and construction dust are the current exceptions).

## References

References are provided by the project owner. Do not fetch them from external sites. The current
manifest contains 19 approved subject/category sheets plus the approved
`world_visual_master`. Every present reference has a verified SHA-256 hash, a `licenseNote`, and
explicit target asset IDs. Required jobs always require their two declared approved references;
`--allow-pending-reference` cannot bypass that rule. Build, import, processing, promotion,
validation, and export reject missing files, hash drift, target mismatches, or missing/tampered
generation reference IDs and hashes.

Every required candidate must also carry a verified production recipe and a persistent original
source snapshot before it can enter promotion. Promotion, repository validation, and export decode
the actual PNG bytes again: the file hash and all six recorded inspection fields (`format`,
`width`, `height`, `channels`, `frames`, and `bytes`) must match, and decoded dimensions must match
the asset definition's production output contract. Updating metadata to agree with a wrong-sized
file does not make that file promotable or exportable.

Snapshot materialization itself writes only under
`generated/<category>/pending/sources/`; it must leave the approved tree byte-for-byte unchanged.
Promotion verifies that pending snapshot and copies it content-addressed under
`generated/<category>/approved/` inside the human-only write boundary. Retry paths accept only
byte-identical files and exact journal/ledger state.

Recipe and job-pack paths accepted by the operator CLI are Forge-relative, bounded, non-symlink
files. The packed prompt, output contract, reference IDs/hashes, and generation job are rechecked
against the current definition before candidate bytes are written. Candidate images retain the
existing signature-based bounded decode and symlink refusal.

## Git and state boundary

Definitions, prompts, schemas, reference declarations, and approved-asset catalog data are
versioned. Job packs, generated pending candidates, rejected candidates, temporary files,
and the live generations ledger must remain local and untracked. The tracked
`generations.template.json` is only a bootstrap shape; the runtime creates and updates the
ignored `data/local/generations.json` ledger instead of changing the tracked template.

Approved images and approval metadata are the only generated-image records intended for
version control. Root ignore rules exclude jobs, pending, rejected, processed, and local
ledgers. The package is marked `private` and is a repository-internal development tool, not a
standalone release artifact. Its `.npmignore` is a defence against accidentally packing local
work state; it does not make a Forge tarball publishable. Approved reference sheets remain
outside the game distribution and require a separate rights-reviewed snapshot if Asset Forge
itself is ever archived or distributed.

## Interactive review boundary

The `promote` command requires an interactive TTY, `--reviewer human`, `--write`, a nonempty
note, and confirmation after displaying source/destination hashes. These checks reduce
accidental approval and ordinary unattended automation; they do not prove a person's identity.
Codex may implement and test refusal/pure transition paths but must not execute a successful
project promotion. Crash-recovery tests may exercise a complete transition only in isolated
temporary roots with synthetic candidates; they do not call the production CLI or alter project
approval state. `promote-required` applies the same review policy to the complete required
set. It first validates
all 78 definitions, candidates, recipes, references, files, hashes, and ledgers twice; prints
the canonical asset-ID-sorted plan and its SHA-256 digest; and accepts only the exact phrase
`APPROVE REQUIRED 78 <digest>` through an interactive stdin/stdout TTY. The production CLI has
no confirmation flag or environment-variable confirmation path, and an ordinary pipe is
rejected because it is not a TTY. A partial failure can be resumed only when the
same plan reconstructs the same digest, including already-approved entries from that batch.
The preflight records an exact pending/approved generation partition. Execution skips the
already-approved partition and invokes promotion only for generations that were pending in the
confirmed preflight; an all-approved retry is therefore a no-op. A crash-recovery generation that
is still pending remains in the pending partition and is completed through its lifecycle journal.
The command approves candidates but never writes the public export.

TTY presence is not cryptographic human proof. Code running as the same operating-system user
can drive a pseudo-terminal and can pre-seed its input; without an external signature or OS
authentication ceremony, Asset Forge cannot distinguish that from an operator typing. The
project's operating rule therefore forbids PTY automation and requires the authorized human
operator to review the displayed 78-item plan and type the phrase. Lead, Codex, and Terra do not
type it. The exported `executeRequiredPromotion` dependency injection exists for temp-root tests;
the production CLI does not expose that injection path. This is an error-prevention and ordinary
automation boundary, not an identity or adversarial same-user security boundary.

`--supersedes` does not weaken that boundary. It is accepted only by the same interactive
promotion ceremony and must identify the generation currently selected by the asset manifest.
Promotion verifies the former approved hash, appends the replacement approval and supersession
records, and then changes the current pointer. It never overwrites or removes the former PNG,
metadata, or approval entry. Export remains current-pointer-only; superseded versions are
immutable provenance history, not runtime variants.

The required batch holds one outer lock for its full execution. Generation, manual import,
source-snapshot materialization, processing, and job-pack creation acquire that same lock before
their first filesystem write and hold it through their inner generation-ledger update. Direct
generation-ledger append and write-mode export use it too. All of these operations fail immediately and without output,
metadata, job-pack, or ledger mutation when a required batch is running; the caller can retry the
same operation after the batch releases the lock without first removing orphan files. Lock
acquisition order is required batch lock, then lifecycle lock for promotion/export, or required
batch lock, then generation lock for ledger update. A standalone promote or reject uses the
lifecycle lock but not the required batch lock, so an operator can still make it interleave; if
that changes a confirmed batch item, the batch reports a partial failure and must be
re-preflighted/resumed rather than guessing state.

Export reads approved assets only and defaults to dry-run. A partial dry-run remains useful for
reporting `missingAssets` and `missingBindings`, but `--write` refuses unless the v2 manifest is
complete. That refusal happens before the public directory or any public file is created. A
successful required promotion never triggers export automatically; export is a separate explicit
operation.

## Anti-reward-fraud reporting

A run report must distinguish observed, inferred, and unknown state. File existence alone
is insufficient: validators must inspect schema conformance, image bytes, hashes,
determinism where promised, path containment, manifest consistency, and the unchanged
approved tree. External image generation is nondeterministic; only the mock provider is
required to be deterministic. Untested does not mean broken.

## Runtime coverage

Every current runtime vocabulary item has at least one formal candidate. The former gaps for
`sand`, `rock`, `tree`, `guildmaster`, `rubble`, and the dedicated `guild` building now have
exact definitions. Lossy mappings remain explicit where several authored variants implement
one runtime meaning. They are recorded in metadata, but the current fixed world/site runtime
does not select those variants from repository context.

Export schema v2 carries render kind, logical size, tile size, sprite axes/frames, states, and
variant tags. Approved spritesheets are rejected when the PNG dimensions do not equal their
declared frame grid. Its sorted `missingAssets` inventory lists every required definition that
lacks approved art; `complete` is true only when both that inventory and `missingBindings` are
empty. Legacy v1 manifests remain readable but are always reported as partial because they do
not carry these guarantees. Road corners/edges, river edges, and bridges also state the
canonical unrotated direction used by the renderer.

## Recorded owner decision

1. On 2026-07-14, the project owner identified the 19 subject/category sheets and the world visual board as owner-provided ChatGPT Pro-generated references and approved them as production inputs.
2. Independent legal/license verification was not performed; the owner remains responsible for third-party input rights, applicable law, and release suitability.
3. Keep the optional 32 future assets outside the required completion gate unless product scope changes.
4. The current required 78 received explicit interactive promotion under the human-review policy. Any replacement candidate requires a new, separate approval; reference approval alone is not candidate approval.
5. On 2026-07-15, the project owner judged the legacy 78 materially insufficient and poorly used in the old game. Those approvals remain provenance history only; they are not the Fable5 required set or evidence of game completion.
