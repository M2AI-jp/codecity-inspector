# Fable5 character-sprite handoff

## Status

**Generation is not authorized and has not been performed.** This handoff records only the
draft contract and review route for eventual `char_player` and `char_innkeeper` candidates.
No image, job-pack, imported candidate, runtime wiring, or approval exists as a result of this
document.

## Observed facts

- The player and innkeeper contracts and prompts are draft-only and are not wired to an
  asset-forge job or runtime path.
- `char_player` is a replacement of the stale player identity. Its identity authority is the
  current user-direct character-style reference identified by
  `user_character_style_reference` in `art/contracts/user-provided-images.json`. Resolve the
  exact path and SHA-256 from that ledger at handoff time; do not invent or substitute one.
- The player must remain the same person as that reference: gray-to-light-purple hair and beard,
  deep-green tunic with ochre trim, cream sleeves, white-to-light-gray lower garment, dark shoes,
  and unchanged face, apparent age, head/body proportions, palette, and silhouette.
- The navy-coat/scarf/satchel/badge identity and its `character_visual_master.png` reference are
  stale Codex-generated material. They are rejected for current player identity and runtime use;
  they are not an alternate variant and must not enter a prompt, candidate, or comparison set.
- `char_innkeeper` is new authoring. The innkeeper may be a different person, but must share the
  player reference's pixel density, head-to-body proportions, contour weight, and 2–3-step
  shading language. The deployed innkeeper sheets have unverified provenance and may be used
  only as explicitly recorded, loose continuity references—not as an identity or user-provided
  source.
- Both characters use the user-direct target-town reference only for twilight upper-left lighting,
  shading density, and contrast. It is not a crop, composition, or recolor source.

## Inferences

None. This document does not infer a provider, a candidate's origin, an approval, or a runtime
outcome from the existence of these draft contracts and prompts.

## Unknown or unconfirmed

- Whether and when a human will authorize either generation session.
- The external generation provider/session, candidate bytes, candidate hash, dimensions after
  intake, processing method, and comparison evidence.
- Every pending mechanical check and every approval decision. The provenance drafts record these
  as `unknown`, `null`, or `not-yet-submitted` until the corresponding event actually occurs.

## Required generation input

Provide an eventual, human-supervised external generation session with all of the following:

1. The common sheet specification:
   `tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md`.
2. The matching prompt and contract draft:
   `character.player.*` for the player or `character.innkeeper.*` for the innkeeper under
   `tools/asset-forge/{prompts,contracts}/fable5-prefab/`.
3. The exact, ledger-resolved character reference and target-town reference, with their SHA-256
   values checked before use. Preserve the distinction between origin, custody, approval, and
   protection; a generated derivative does not become `user-direct` because it used a
   user-direct reference.
4. A flat high-saturation chroma-key background or true alpha (if supported) for extraction.
   The finished candidate must contain no chroma background, labels, rulers, borders,
   checkerboard, captions, or watermarks. Use crisp nearest-neighbor-safe pixel art—no soft
   antialiasing or photographic texture.

For the innkeeper, an apron/practical tavern clothing and a towel, rag, or tankard are optional
role signifiers. If a prop is used, keep it in the same anatomical hand in all directions.

## Output contract — applies to each character

| Requirement | Required value |
|---|---|
| Asset IDs / files | `char_player` → `character/char_player.png`; `char_innkeeper` → `character/char_innkeeper.png` |
| PNG sheet | 640×512 pixels; one sheet, no gaps |
| Grid | 4 rows × 10 columns = 40 independently extractable 64×128 cells |
| Row order | south, west, east, north |
| Columns in every row | 0–1: idle (2, 4 fps); 2–7: walk (6, 10 fps); 8–9: interact (2, 6 fps) |
| Pivot | Foot pivot `(32, 120)` in every frame, without exception |
| Other contract fields | category `character`; native scale 1; logical tile size 64; 1×1 footprint; no collision; base layer is the same PNG; allowed zoom 1/2/3 |

The two interact frames are shared by the runtime for talk and work; do not reserve separate
talk/work poses. East must be drawn independently—not mirrored from west. Every cell must retain
the same individual, costume asymmetries, and palette; only direction and animation phase may
change. The innkeeper still requires a complete walk cycle, despite its usual counter role.

Player palette/district contract: `common`; `old_town`, `port`, `snow`, `forest`.
Innkeeper palette/district contract: `district_old_town`; `old_town`.

## Required human approval and asset-forge route

1. A human first authorizes a generation session and resolves the reference paths and hashes from
   the canonical ledger. Before making a player job, rewrite the existing player art-direction
   entry away from the rejected identity; before making an innkeeper job, add its missing
   art-direction entry.
2. Use asset-forge `make-job`/`make-job-v2` to create a job-pack. This creates a prompt/reference/
   output-contract bundle, **not pixels**.
3. A human runs the external, human-supervised image-generation session. Asset-forge has no
   built-in paid image-generation API; its mock output is only a deterministic test placeholder.
4. Import the returned PNG as a hash-verified pending candidate with `import`/`import-v2`, then
   run `process` as needed. Record the actual tool/session, method, output hash, dimensions,
   derivation sources, and comparison evidence in the matching provenance draft. Unknown facts
   remain `unknown` or `null`; do not infer them.
5. A human project owner or authorized reviewer inspects the candidate side-by-side with its
   source and verifies all mechanical checks, especially all-frame pivot alignment, 40-cell
   extraction, east-not-mirrored, identity continuity, and target-town shading compatibility.
6. Only that human may complete asset-forge's interactive `promote`/`promote-required` review
   with the required reviewer/write/note ceremony. Until then, the candidate is unapproved and
   must not be exported or referenced by runtime. Export remains dry-run by default; a write is
   considered only after the manifest is complete.

Rejected or superseded candidates remain quarantined with their provenance and comparison
evidence. Do not overwrite, delete, or label them as user-provided.

## Explicit non-goals

- This handoff does not authorize or perform image generation, importing, processing, promotion,
  export, runtime changes, staging, committing, or publishing.
- It does not change existing player or innkeeper definitions, the deployed innkeeper art, or
  building placement. The inn `npcSpot` is only future pose/scale context.
- It does not approve a candidate, assert an origin, or collapse origin/custody/approval/
  protection into one label.
- It does not revive or reconcile the rejected navy player identity.

## Source of record

- `tools/asset-forge/contracts/fable5-prefab/README.md`
- `tools/asset-forge/contracts/fable5-prefab/character.player.contract-draft.json`
- `tools/asset-forge/contracts/fable5-prefab/character.innkeeper.contract-draft.json`
- `tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md`
- `tools/asset-forge/prompts/fable5-prefab/character.player.prompt-draft.md`
- `tools/asset-forge/prompts/fable5-prefab/character.innkeeper.prompt-draft.md`
- `tools/asset-forge/review/provenance/fable5-character-candidate-provenance.template.json`
- `tools/asset-forge/review/provenance/character.player.candidate-provenance-draft.json`
- `tools/asset-forge/review/provenance/character.innkeeper.candidate-provenance-draft.json`
- `docs/user-provided-image-policy.md`
