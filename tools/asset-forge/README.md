# CodeCity Asset Forge

Asset Forge is the game-art workshop inside CodeCity Inspector. It defines the art the game
needs and, in later phases, will create mock candidates, job packs, manual imports,
metadata, image derivatives, and approved-only game exports.

Asset Forge is not an automatic art director. It cannot decide that an image is good
enough for the game. Every generated or imported candidate remains pending until a human
approves it.

Asset Forge は自動アートディレクターではありません。候補生成、job pack、取り込み、
metadata、透過処理、sprite抽出、approved素材のexportを管理しますが、採用判断は人間だけが行います。

## Current observed scope

This directory currently contains the W1 contract layer: schemas, editable prompt
templates, the complete formally requested asset catalog, reference placeholders, and
initial tracked manifest templates. Provider implementations, the CLI implementation,
image processing, generated candidates, approval operations, exports, and runtime/browser
integration are later phases. Their package scripts are reserved command names, not a claim
that those commands have been implemented or exercised.

No package installation, test command, generation command, subscription command, import,
promotion, rejection, processing, or export is evidenced by these files.

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

Whether a safe subscription image command exists is currently unknown. Unavailability must
not cause an API fallback.

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

## References

References are provided by a human. Do not fetch them from external sites. Only approved
references are strong references by default. A pending reference, if supported later, must
require an explicit flag. Each reference needs a SHA-256 hash and `licenseNote`.

The initial reference manifest intentionally marks placeholders as `missing`.
No reference image is included by this W1 scaffold.

## Git and state boundary

Definitions, prompts, schemas, reference declarations, and approved-asset catalog data are
versioned. Job packs, generated pending candidates, rejected candidates, temporary files,
and the live generations ledger must remain local and untracked. The tracked
`generations.template.json` is only a bootstrap shape; a future runtime must copy it to an
ignored local-state path rather than update the tracked template.

Approved images and approval metadata are the only generated-image records intended for
version control. A future root integration must add ignore rules before any generation flow
is enabled. This W1 does not alter the root ignore policy.

## Human-only boundary

A future `promote` command must require explicit human authority, refuse overwrites, and
record reviewer, time, and note. Codex may implement that command but must not execute it to
approve project assets. Export must read approved assets only, default to dry-run, and
require `--write` for files.

## Anti-reward-fraud reporting

A run report must distinguish observed, inferred, and unknown state. File existence alone
is insufficient: validators must inspect schema conformance, image bytes, hashes,
determinism where promised, path containment, manifest consistency, and the unchanged
approved tree. External image generation is nondeterministic; only the mock provider is
required to be deterministic. Untested does not mean broken.

## Known content gaps

The formal catalog is complete as a requirements list, but it does not directly cover every
current runtime vocabulary item. The authoritative gap list is
`data/manifests/runtime-coverage.json`. Notable no-candidate gaps are
`TILE_TYPES: sand, rock, tree`, `NPC_ROLES: guildmaster`,
`PROP_KINDS: rubble`, and `FACILITY_KINDS: guild` as a dedicated building.
Several other runtime meanings are covered only by lossy mappings. These are pending product
decisions, not broken assets.

## Human next steps

1. Supply original, licensed reference images.
2. Record their paths, hashes, and license notes.
3. Review the runtime gap list and authorize additions beyond the formal catalog.
4. After later provider work, review pending candidates visually.
5. Decide which candidates to approve; no agent may make this decision.
