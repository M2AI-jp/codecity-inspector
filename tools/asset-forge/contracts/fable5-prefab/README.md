# Fable5 prefab contracts (characters and three building interiors)

The contracts and prompts remain draft-only, but five candidate byte sets have now been generated
and mechanically imported as **pending**. Their committed review-only copies, job receipts, and
reproducible mechanical verifier are under
`../../review/fable5-runtime-assets/pending-evidence/20260722/`. This is not approval, promotion,
export, or runtime installation; the only current terminal decision is still “not yet submitted”.

## What exists

| File | What it is |
|---|---|
| `character.player.contract-draft.json` | Target Fable5PrefabSpec section 7 contract for `char_player` (640x512 sheet, 64x128 frames, footPivot 32,120) |
| `character.innkeeper.contract-draft.json` | Same, newly authored for `char_innkeeper` (no prior entry existed) |
| `interior.inn.contract-draft.json` | 192×192 / 3×3 inn ground-layer kit, locked to the observed inn runtime anchors |
| `interior.city-hall.contract-draft.json` | 256×256 / 4×4 city-hall ground-layer kit, locked to inferred runtime geometry |
| `interior.residence.contract-draft.json` | 256×256 / 4×4 residence ground-layer kit; 4×4 prevents clipping the current inferred entry/interaction geometry |
| `../../prompts/fable5-prefab/00_common_fable5_character_sheet_style.md` | Shared sheet/lighting spec both prompts include |
| `../../prompts/fable5-prefab/character.player.prompt-draft.md` | Player generation prompt, identity anchored on the green reference sheet |
| `../../prompts/fable5-prefab/character.innkeeper.prompt-draft.md` | Innkeeper generation prompt, distinct person / shared rendering language |
| `../../prompts/fable5-prefab/00_common_fable5_interior_kit_style.md` | Shared no-character/no-UI interior ground-layer constraints |
| `../../prompts/fable5-prefab/interior.*.prompt-draft.md` | Building-specific inn / city-hall / residence interior prompts |
| `../../review/provenance/fable5-character-candidate-provenance.template.json` | Blank origin/custody/approval/protection + derivation fill-in form |
| `../../review/provenance/character.player.candidate-provenance-draft.json` | Same form, pre-filled with what's known for the player |
| `../../review/provenance/character.innkeeper.candidate-provenance-draft.json` | Same form, pre-filled with what's known for the innkeeper |
| `../../review/fable5-runtime-assets/pending-evidence/20260722/index.json` | Commit-backed copies and receipts for the five pending candidates; recheck with `node tools/qa/fable5-pending-runtime-evidence.mjs` from the repository root |

## Why a fresh draft instead of reusing this tool's existing character.player entry

`data/v2/art-direction/characters.json` and `data/asset-definitions/characters.json` both still
define `character.player` around the navy-coat/scarf/satchel/badge identity and point at
`character_visual_master.png`. `docs/user-provided-image-policy.md` (2026-07-19) records that
identity as a Codex-generated image the project owner has since rejected for player identity and
runtime use. Running this tool's existing definitions as-is would regenerate the wrong person.
These drafts intentionally do not touch those existing definition files (out of scope for this
pass) and instead anchor identity on the current user-provided character-style reference sheet
under `art/references/user-provided/` (ledger `sourceId`: `user_character_style_reference` in
`art/contracts/user-provided-images.json`). Its exact basename and SHA-256 are deliberately not
spelled out in this directory: `../../test/reference-integrity.test.mjs`
(`RETIRED_CHARACTER_REFERENCE`) asserts that specific basename/hash must not appear anywhere
inside `tools/asset-forge`, so every draft here resolves it from the external ledger instead.

The frame grid also differs from every existing definition in this tool: legacy `data/
asset-definitions/characters.json` uses 96x120/4x3/24x40px frames; the existing v2 `character.
player` prose describes 48x96 frames with an idle2+walk4+talk2+work2 split. Neither matches
`Fable5PrefabSpec.md` section 6 (64x128 frames, 640x512 sheet, idle2+walk6+interact2,
footPivot fixed at 32,120), which is the contract these drafts target.

## Three-building interior kit route

The product needs a distinct inn, city hall, and residence cutaway. Each `*.interior` contract
models the Fable5PrefabSpec building `.interior` layer: exact native RGBA dimensions, 64px
footprint, southwest pivot, world composition rectangle, walk polygon, entry/exit/camera/NPC
anchors, and source bounds that must stay opaque. The contracts use the current
`public/fable5-v2/building-runtime.mjs` coordinates. Inn geometry is marked observed there; city
hall and residence geometry is explicitly marked inferred, not visually proven.

The 256×256 residence contract is intentional. The current residence walk polygon is 210px tall,
so silently retaining the old 4×3/192px provisional canvas would cut off a required anchor. This
does not approve a visual footprint; a human visual review remains required before runtime use.

For each asset, use:

1. `npm run make-fable5-interior-job -- --asset <asset-id> --dry-run` to validate its draft,
   canonical current-town reference, and building reference without writing a pack.
2. Run the same command without `--dry-run` to create a portable pre-generation job pack.
3. Have a human supervise a generation session, then run
   `npm run import-fable5-interior -- --asset <asset-id> --file /absolute/path/candidate.png
   --job-pack generated/jobs/<job-id>/job-pack.json`.

The intake accepts only exact-size RGBA PNG bytes. It rejects chroma-key residue, insufficient
opaque ground coverage, and any transparent entry/exit/NPC source bound. It copies accepted
mechanical candidates only to `generated/interiors/pending/`; it does not resize, transform,
approve, export, move to runtime, or make a visual-quality claim.

The three accepted IDs are `bld_m_inn.interior`, `bld_l_town_hall.interior`, and
`bld_m_house.interior`. A human owner must separately review cutaway continuity, actual
player/NPC clearance, visual fit to the current town, and then record terminal approval before a
runtime asset ledger can allow any of them.

## Lifecycle and remaining human gates

1. Run `npm run make-fable5-character-job -- --asset char_player --dry-run` (and then
   `char_innkeeper`) to validate the draft contract, common/per-character prompt pair, and the
   two user-direct generation references without writing a pack. The command verifies the
   canonical ledger and source bytes but writes no image, candidate, approval, or runtime asset.
2. After that preflight passes, run the same command **without** `--dry-run` to write a portable
   job-pack under `generated/jobs/`. It deliberately uses only these Fable5 draft contracts;
   it does not load `data/asset-definitions/characters.json` or
   `data/v2/art-direction/characters.json`.
3. Do **not** use legacy `make-job`, `make-job-v2`, `import`, or `import-v2` for these two
   candidates. Their historical player identity and 24×40 / 48×96 sheet contracts are not valid
   for this Fable5 route. The special job-pack is pre-generation only and intentionally does not
   expose an automatic importer or promotion command.
4. Run an external, human-supervised generation session against that job-pack. This tool has no
   built-in path to do this step — see the root-level report for why.
5. Use `npm run import-fable5-character -- --asset char_player --file /absolute/path/candidate.png
   --job-pack generated/jobs/<job-id>/job-pack.json` to copy an externally supplied PNG to the
   Fable5 **pending** area. It re-verifies the matching pack and ledger commitments and rejects
   wrong PNG dimensions, alpha/chroma failures, empty cells, pivot drift, exact mirrored east
   rows, and repeated walk cells. It does not transform, approve, export, or wire an image into
   runtime. `--dry-run` performs the same checks without writing a candidate.
6. Only a human may make a terminal `approved` or `rejected` decision. For a terminal decision,
   retain the candidate and its metadata in the matching `generated/characters/approved/` or
   `generated/characters/rejected/` state directory, then fill a provenance record under
   `review/provenance/`. The record must bind the exact artifact path and SHA-256 and contain a
   non-empty human `approvedBy`, `decisionRef`, and `runtime-use` scope. A **character** must also
   include `character-style-lock` after a nearest-neighbour paired review against the user
   reference and the player sheet; the runtime ledger rejects a character approval without it.
   No Forge command creates that record, changes a candidate's state, or treats a generated image
   as approved.
7. After a human-approved asset has been copied byte-for-byte to its intended runtime path, make
   a human-maintained inventory under `review/fable5-runtime-assets/` and run
   `npm run freeze-fable5-runtime-ledger -- --inventory review/fable5-runtime-assets/<name>.json`.
   The inventory has exactly this shape per asset:

   ```json
   {
     "format": "fable5-runtime-asset-inventory-v1",
     "assets": [{
       "assetId": "char_player",
       "category": "character",
       "state": "approved",
       "artifactPath": "generated/characters/approved/<stem>.png",
       "metadataPath": "generated/characters/approved/<stem>.json",
       "contractPath": "contracts/fable5-prefab/character.player.contract-draft.json",
       "jobPackPath": "generated/jobs/<job-id>/job-pack.json",
       "approvalRecordPath": "review/provenance/<human-review>.json",
       "runtimePath": "public/fable5-v2/assets/characters/<runtime-name>.png"
     }]
   }
   ```

   A pending asset must use `pending-inspection` plus the `pending/` paths and both terminal
   paths set to `null`; a rejected asset uses `rejected` plus a human record but a `null`
   `runtimePath`. The freeze command only records and verifies those facts. It writes a
   content-addressed ledger under `generated/fable5-runtime-ledgers/`, never writes to an
   approved directory, and refuses a runtime file whose SHA-256 differs from the approved source.
   Re-check a frozen ledger with
   `npm run verify-fable5-runtime-ledger -- --ledger generated/fable5-runtime-ledgers/<sha256>.json`.
8. Fill in the matching `review/provenance/*.candidate-provenance-draft.json` record as each fact
   in steps 1–5 becomes real, instead of writing a new record from scratch.
