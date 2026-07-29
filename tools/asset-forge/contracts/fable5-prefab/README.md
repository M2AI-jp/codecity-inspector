# Fable5 prefab contracts (characters and three building interiors)

The character contracts and prompts are new-generation inputs, not approvals, promotion records,
or runtime authorization. All four active character drafts use one exact user-provided character
style authority: `art/references/user-provided/character_style_authority_20260722_v1.png`, ledger
`sourceId` `user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`.

Historical character candidates, generated sheets, and deployed character art are quarantined
records only. They must not be supplied as a visual reference, derivation input, comparison
authority, or runtime-promotion source.

> Every `npm run <fable5-*>` command below is a script in **this package's**
> `tools/asset-forge/package.json`, not the repository-root one. Run it from inside
> `tools/asset-forge/`, or prefix it from the repo root: `npm --prefix tools/asset-forge run
> make-fable5-character-job -- --asset char_player --dry-run`. Running `npm run
> make-fable5-character-job` from the repository root fails with `npm error Missing script`
> (verified by actually running both forms on 2026-07-29).

## What exists

| File | What it is |
|---|---|
| `character.player.contract-draft.json` | Target Fable5PrefabSpec section 7 contract for `char_player` (640x512 sheet, 64x128 frames, footPivot 32,120) |
| `character.innkeeper.contract-draft.json` | New-generation Fable5PrefabSpec section 7 contract for distinct NPC `char_innkeeper` |
| `character.town-clerk.contract-draft.json` | New-generation Fable5PrefabSpec section 7 contract for distinct NPC `char_town_clerk` |
| `character.resident.contract-draft.json` | New-generation Fable5PrefabSpec section 7 contract for distinct NPC `char_resident` |
| `interior.inn.contract-draft.json` | 192×192 / 3×3 inn ground-layer kit, locked to the observed inn runtime anchors |
| `interior.city-hall.contract-draft.json` | 256×256 / 4×4 city-hall ground-layer kit, locked to inferred runtime geometry |
| `interior.residence.contract-draft.json` | 256×256 / 4×4 residence ground-layer kit; 4×4 prevents clipping the current inferred entry/interaction geometry |
| `../../prompts/fable5-prefab/00_common_fable5_character_sheet_style.md` | Shared sheet/lighting spec both prompts include |
| `../../prompts/fable5-prefab/character.player.prompt-draft.md` | Player prompt: direct visual derivation from the sole authority |
| `../../prompts/fable5-prefab/character.innkeeper.prompt-draft.md` | Innkeeper prompt: distinct person, sole authority for style only |
| `../../prompts/fable5-prefab/character.town-clerk.prompt-draft.md` | Town-clerk prompt: distinct person, sole authority for style only |
| `../../prompts/fable5-prefab/character.resident.prompt-draft.md` | Resident prompt: distinct person, sole authority for style only |
| `../../prompts/fable5-prefab/00_common_fable5_interior_kit_style.md` | Shared no-character/no-UI interior ground-layer constraints |
| `../../prompts/fable5-prefab/interior.*.prompt-draft.md` | Building-specific inn / city-hall / residence interior prompts |
| `../../review/provenance/fable5-character-candidate-provenance.template.json` | Blank origin/custody/approval/protection + derivation fill-in form |
| `../../review/provenance/character.player.candidate-provenance-draft.json` | Same form, pre-filled with what's known for the player |
| `../../review/provenance/character.innkeeper.candidate-provenance-draft.json` | Same form, pre-filled with what's known for the innkeeper |

## Character source authority and fixed sheet requirements

Before a character job pack is assembled, the job route checks that the canonical ledger record
has the exact path and SHA-256 above. `char_player` is a direct visual derivation of that exact
image: the same individual and visible identity must remain intact, with only required direction
and animation phase invented. `char_innkeeper`, `char_town_clerk`, and `char_resident` must remain
distinct people; the exact image is their sole authority for pixel density, proportions, contour
weight, silhouette language, and shading language.

No older character reference, candidate, generated sheet, or deployed art is eligible to fill any
of those roles. A historical artifact cannot be imported, promoted, or selected as the source for
runtime installation through this route.

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

1. For a new character candidate, run `npm run make-fable5-character-job -- --asset <asset-id>
   --dry-run` for `char_player`, `char_innkeeper`, `char_town_clerk`, or `char_resident`. It
   validates the draft contract, common/per-character prompt pair, exact sole character authority,
   and target-town reference without writing a pack, image, candidate, approval, or runtime asset.
2. After that preflight passes, run the same command **without** `--dry-run` to write a portable
   job-pack under `generated/jobs/`. It deliberately uses only these Fable5 draft contracts;
   it does not load `data/asset-definitions/characters.json` or
   `data/v2/art-direction/characters.json`.
3. Do **not** use legacy `make-job`, `make-job-v2`, `import`, or `import-v2` for these Fable5
   candidates. Their historical character definitions have different sheet contracts and are not
   valid sources for this Fable5 route. The special job-pack is pre-generation only and
   intentionally does not expose an automatic importer or promotion command.
4. Run an external, human-supervised generation session against that job-pack. This tool has no
   built-in path to do this step — see the root-level report for why.
5. Use `npm run import-fable5-character -- --asset <asset-id> --file /absolute/path/candidate.png
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
   include `character-style-lock` after a nearest-neighbour paired review against the exact sole
   authority and, for an NPC, the new player candidate; the runtime ledger rejects a character
   approval without it.
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
