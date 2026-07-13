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
processing, rejection, guarded human-only promotion, and approved-only export. The Canvas
runtime consumes the export manifest and visibly falls back when approved art is absent.
When multiple approved assets target the same runtime binding or semantic, the manifest keeps
every variant. The runtime uses explicit deterministic rules for road topology, water edges,
bridge style/orientation, house state/size, resident/townsfolk identity, plants, and flags.
Character and effect sheets are cropped from validated frame metadata; they are never shrunk
as whole sheets into one tile.

The catalog contains 110 definitions: 78 are required by the current game and 32 are optional
future enhancements. The required 78 have approval-ledger entries and are exported through the
complete schema v2 game manifest; the optional 32 remain outside the required export. Content
readiness is not a claim that automated checks decided visual quality, licensing, or art direction.

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

# Accepts image bytes by signature; result remains pending
npm run import -- --asset character.player --file /absolute/path/candidate.png

# Local processing of a pending candidate
npm run process -- --generation GEN_ID --alpha-key black --tolerance 0 --trim

# Rejection requires a reason
npm run reject -- --generation GEN_ID --reason "human review note"

# Promotion refuses non-TTY/automation and requires reviewer, note, write, hash confirmation
npm run promote -- --generation GEN_ID --reviewer human --note "human decision" --write

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

References are provided by a human. Do not fetch them from external sites. Only approved
references are strong references by default. A pending reference, if supported later, must
require an explicit flag. Each reference needs a SHA-256 hash and `licenseNote`.

The initial reference manifest intentionally marks placeholders as `missing`.
No reference image is included.

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
work state; it does not make a Forge tarball publishable. In particular, the tracked pending
reference sheets remain outside the game distribution and require a separate rights-cleared
snapshot if Asset Forge itself is ever archived or distributed.

## Human-only boundary

The `promote` command requires an interactive TTY, `--reviewer human`, `--write`, a nonempty
note, and confirmation after displaying source/destination hashes. Codex may implement and
test refusal/pure transition paths but must not execute a successful project promotion.
Export reads approved assets only, defaults to dry-run, and requires `--write` for files.

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
one runtime meaning; the runtime selector resolves those mappings from stable game context.

Export schema v2 carries render kind, logical size, tile size, sprite axes/frames, states, and
variant tags. Approved spritesheets are rejected when the PNG dimensions do not equal their
declared frame grid. Its sorted `missingAssets` inventory lists every required definition that
lacks approved art; `complete` is true only when both that inventory and `missingBindings` are
empty. Legacy v1 manifests remain readable but are always reported as partial because they do
not carry these guarantees. Road corners/edges, river edges, and bridges also state the
canonical unrotated direction used by the renderer.

## Remaining human decisions

1. Confirm the source and usage rights recorded outside automated inspection.
2. Review the exported 78 assets in the game and in the manifest-backed asset inspector.
3. Keep the optional 32 future assets outside the required completion gate unless product scope changes.
4. Regenerate, reapprove, or re-export an approved asset only after an explicit product decision.
