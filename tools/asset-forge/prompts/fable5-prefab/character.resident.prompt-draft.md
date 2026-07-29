# char_resident — Fable5 prefab sheet (review draft)

> Status: draft, not generated. Pair with
> `00_common_fable5_character_sheet_style.md` and
> `contracts/fable5-prefab/character.resident.contract-draft.json`. This is a role/style-lock
> prompt, not evidence of Asset Forge intake, human approval, or runtime permission.

## Role and identity limits

Create one adult general town resident: a non-combat local citizen with a simple, readable
daily-life silhouette. The resident is a new NPC individual, not a user identity and not a
user-direct source. It must remain distinct from the player and every other NPC.

Keep the resident distinct from the town clerk (no required civic ledger, quill, official uniform,
badge, or paperwork) and the innkeeper (no required apron, serving prop, or tavern-worker
identity). Avoid weapons, armor, a quest marker, UI, captions, readable text, or a player-like
signature costume.

## Sheet contract — fixed

Produce exactly 640x512 RGBA: four rows in `south`, `west`, `east`, `north` order and ten columns
per row. Every cell is 64x128 with the foot pivot fixed at `(32,120)`. Columns `0–1` are idle,
`2–7` are six walk phases, and `8–9` are two interact poses. Keep all 40 cells independently
readable. Draw the east row independently; do not mirror the west row.

## Style lock

The exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`) is the resident's **sole**
character-style authority. Verify the same path and digest in
`art/contracts/user-provided-images.json` before generation. Follow it and
`00_common_fable5_character_sheet_style.md` for crisp pixel clusters, stable head/body
proportions, contour weight, restrained 2–3-step shading, a clear silhouette, transparent
surroundings, and no soft anti-aliasing. Preserve the same resident across all directions and
animation phases; only facing and action phase may change.

Borrow the authority image's *construction grammar*, not its person: chibi 2.5–3 head-height
proportions, a large head relative to the body, minimal almond-shaped eyes with a single small
highlight and no rendered iris/eyebrow detail, and a continuous dark (not flat-black) contour line
around the silhouette and between major colour fields (see the fuller observed-description block in
`character.player.prompt-draft.md` if a copy of that reasoning is useful). The resident must read as
a visibly different individual from that elderly gray-haired, gray-bearded, green-robed reference —
different hair colour/style and a different, plainer garment silhouette — while matching its pixel
density, proportion system, and shading-step count exactly. Suggested (not locked) signifiers: plain
practical daily-wear such as a simple tunic/shirt and trousers or a work dress, a muted, low-contrast
colour set that still sits correctly under the twilight ambient light of `target-town-user-direct-v1.png`,
no held prop required (the interact pose can be a simple greeting/gesture instead).

Do not use any historical character candidate, generated sheet, or deployed asset as a visual
reference, comparison authority, derivation input, or runtime-promotion source. No text, UI,
labels, borders, checkerboard, watermark, or chroma-key residue may remain in the final sheet.

## Per-row content

- **south:** relaxed local idle; a grounded six-phase walk; two small daily-life or greeting
  interact poses with no profession-specific prop requirement.
- **west / east:** reproject the same person and clothing, preserving anatomical consistency;
  east is newly drawn rather than flipped.
- **north:** same idle, walk, and interact logic from behind, with the resident still legible by
  silhouette.

Formal Asset Forge intake/mechanical validation, human review, promotion, export, and runtime use
remain required for a future new candidate. No historical candidate carries forward.
