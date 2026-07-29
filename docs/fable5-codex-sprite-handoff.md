# Fable5 character-sprite handoff

> **2026-07-29 update:** for a ready-to-run execution brief — exact spec, the four characters'
> identity requirements, complete copy-paste `image_gen` prompt text for each, failure evidence
> gathered by actually running this repo's own validator against the real historical candidates
> named below, and the verified (corrected) intake commands — see
> `docs/fable5-codex-sprite-generation-brief.md`. This file remains the shorter observed/inferred/
> unknown status ledger; it is not superseded, just extended.

## Active authority and status

All active Fable5 character drafts are retargeted to one user-provided source of truth:

- Source ID: `user_character_style_authority_20260722_v1`
- Canonical source: `art/references/user-provided/character_style_authority_20260722_v1.png`
- SHA-256: `446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`

The player is a direct visual derivation of this exact image. The innkeeper, town clerk, and
resident are distinct people; for each of them, this exact image is the sole character-style
authority for pixel density, proportions, contour weight, silhouette language, and shading.

Historical character candidates, generated sheets, and deployed character art are quarantined
records only. They must not be used as a visual reference, derivation input, comparison authority,
or runtime-promotion source. This handoff neither generates pixels nor approves, promotes,
exports, or wires a runtime asset.

## Observed state

- The active job route covers `char_player`, `char_innkeeper`, `char_town_clerk`, and
  `char_resident`. It binds the exact source ID, canonical path, and SHA-256 above against the
  canonical user-provided-image ledger before it creates a job pack.
- Every character draft requires one 640×512 RGBA sheet: 4 rows × 10 columns, 40 cells of
  64×128 pixels, with a `(32,120)` foot pivot in every frame.
- Required row order is south, west, east, north. Each row has idle in columns 0–1, a six-phase
  walk in 2–7, and interact in 8–9. East is independently drawn and must not mirror west.
- The final candidate requires true transparent surroundings. Chroma-key residue, text, labels,
  rulers, borders, checkerboard, captions, watermarks, and baked UI are prohibited.
- The user-direct target-town image remains a lighting/shading reference only; it is not a
  character-identity or character-style authority.

## Inferences

None. This document does not infer a generation provider, source origin beyond the ledger record,
candidate provenance, mechanical pass, approval, or runtime outcome.

## Unknown or unconfirmed

- Whether or when a human authorizes a new generation session for any of the four characters.
- The external generation provider/session, new candidate bytes and hash, intake result, and
  visual comparison evidence.
- Every human review, terminal approval/rejection decision, runtime installation, and browser
  acceptance outcome.

## Required generation input

Provide a human-supervised external generation session with all of the following:

1. `tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md`.
2. The matching character prompt and contract under
   `tools/asset-forge/{prompts,contracts}/fable5-prefab/`.
3. The exact sole character authority listed above, verified against
   `art/contracts/user-provided-images.json` before use, plus the target-town reference for
   lighting/shading only.
4. A flat high-saturation chroma-key background or true alpha only while generating/extracting.
   The completed candidate must have true alpha and none of the prohibited residue or text.

For `char_player`, retain the same individual from the exact authority across all 40 cells; only
required facing and animation phase may vary. For `char_innkeeper`, `char_town_clerk`, and
`char_resident`, create a distinct individual for the stated role without borrowing player-specific
identity traits or any historical character candidate.

## Output contract — applies to every active character

| Requirement | Required value |
|---|---|
| Assets | `char_player`, `char_innkeeper`, `char_town_clerk`, `char_resident` |
| PNG sheet | 640×512 pixels; one gap-free RGBA sheet |
| Grid | 4 rows × 10 columns = 40 independently extractable 64×128 cells |
| Row order | south, west, east, north |
| Columns in every row | 0–1 idle at 4 fps; 2–7 walk at 10 fps; 8–9 interact at 6 fps |
| Pivot | Foot pivot `(32,120)` in every frame, without exception |
| Direction rule | Draw east independently; do not mirror west |
| Presentation | Transparent surroundings, no chroma residue, text, UI, labels, borders, captions, rulers, checkerboard, or watermark |
| Other fields | category `character`; native scale 1; logical tile size 64; 1×1 footprint; no collision; base layer is the same PNG; allowed zoom 1/2/3 |

## Required human route

1. Run `npm run make-fable5-character-job -- --asset <asset-id> --dry-run` for one of the four
   active IDs, **from inside `tools/asset-forge/`** (or `npm --prefix tools/asset-forge run
   make-fable5-character-job -- --asset <asset-id> --dry-run` from the repo root — there is no
   script of that name in the repository-root `package.json`; verified by running both forms).
   It verifies the locked authority and output contract without writing pixels.
2. Run the same command without `--dry-run` to create a portable pre-generation job pack under
   `generated/jobs/`.
3. A human runs an external, supervised generation session from that pack. Asset Forge has no
   built-in real-pixel generation path.
4. Use the Fable5-specific intake route for the returned new PNG. Do not import or recover a
   historical candidate.
5. A human verifies the fixed sheet contract, all-frame pivot alignment, east-not-mirrored rule,
   player identity continuity or distinct-NPC style consistency, chroma/alpha result, and
   target-town shading compatibility.
6. Only a human may record a terminal decision and then separately authorize any runtime
   installation. A historical candidate can never be the promotion source.

## Source of record

- `art/contracts/user-provided-images.json`
- `tools/asset-forge/contracts/fable5-prefab/README.md`
- `tools/asset-forge/contracts/fable5-prefab/character.*.contract-draft.json`
- `tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md`
- `tools/asset-forge/prompts/fable5-prefab/character.*.prompt-draft.md`
