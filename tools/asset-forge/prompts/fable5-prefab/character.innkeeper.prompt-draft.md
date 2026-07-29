# char_innkeeper — Fable5 prefab sheet (draft prompt)

> Status: draft, not generated. Pair with `00_common_fable5_character_sheet_style.md` and the
> contract at `tools/asset-forge/contracts/fable5-prefab/character.innkeeper.contract-draft.json`.
> No v2 art-direction entry for an innkeeper currently exists in
> `data/v2/art-direction/characters.json` (only `character.player`, `character.town_clerk`,
> `character.gatekeeper`, `character.dojo_inspector`, `character.mob.townsfolk_male/female`,
> `character.dojo_student` do). This is new authoring, not a rewrite of an existing wrong entry.

## Sole style authority: a different person

The exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`) is the innkeeper's **sole**
character-style authority. Verify the same path and digest in
`art/contracts/user-provided-images.json` before generation.

- The innkeeper must be a distinct person from the player: invent a different face, hair, costume,
  and role silhouette; do not copy player-specific visible traits.
- Use the exact authority only for pixel density (same apparent resolution of detail, not smoother
  or blockier), head-to-body ratio, silhouette weight/slimness, line/contour weight, and the
  2–3-step shading language described in `00_common_fable5_character_sheet_style.md`. For what
  those traits look like in the authority image concretely — chibi 2.5–3 head-height proportions,
  minimal almond-shaped eyes, a continuous dark contour line, softly-antialiased 3-tone shading —
  see the equivalent observed-description block in `character.player.prompt-draft.md`. Copy that
  *grammar*, not the elderly gray-haired-and-bearded person it describes.
- Suggested role signifiers (adjust freely, these are not locked): apron over practical tavern
  clothing, warm neutral palette that still reads correctly under the twilight ambient light of
  `target-town-user-direct-v1.png`, a towel/rag or tankard as an optional interact-row prop held
  in one consistent hand across all four directions.

### A previous generation attempt against this exact authority already failed this specific rule

`tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_innkeeper-alpha.png`
(still `pending-human-review`, never approved — not a reference, cited only as a documented failure)
is, by direct visual comparison, essentially the *same person* as the style-authority image: same
gray hair, same gray beard, same face, same sage-green robe with gold trim over a cream under-layer.
That is a style-authority *identity* clone, not a distinct innkeeper who merely shares its pixel
density and shading language. Concretely avoid this by changing at minimum: hair colour and style,
facial hair (or its absence), and the specific garment silhouette/colour — while keeping the same
chibi proportions, contour weight, and shading-step count. A useful gut check before finalizing a
candidate: if you covered the clothing and only compared the face/hair silhouette against the
authority image, could you tell them apart? If not, it will fail review again for the same reason.

### Historical candidates are prohibited

Do not use any previous innkeeper, player, NPC, generated sheet, deployed asset, or candidate as
a visual reference, comparison authority, derivation input, or runtime-promotion source. They are
quarantined historical records only. The exact image above is the sole character-style authority.

## Sheet

Same as the player: 640x512, 4 rows (south/west/east/north) x 10 columns (idle x2, walk x6,
interact x2), 64x128 cells, foot pivot fixed at (32,120). The innkeeper needs a real walk cycle
(the current deployed art has none) even though most in-game time will show it idle/interact
behind the inn counter — `Fable5PrefabSpec.md` section 6 does not carve out a reduced grid for
stationary NPCs, and a future scene may want the innkeeper mobile.

## Per-row content

- **south:** idle = standing attentive behind/near the counter; walk = six-phase stride matching
  the common walk-cycle description (reuse the same phase logic as the player prompt, different
  costume); interact = a serving/wiping-the-counter gesture pair, usable at runtime for both
  talk and work states per the shared-interact rule.
- **west / east:** same content reprojected; draw east independently, do not mirror west.
- **north:** same content from behind.

## Negative constraints

No player identity bleed, modern clothing, oversized sparkly/glossy anime eyes beyond the
authority's own minimal almond-shaped eye style (the required chibi 2.5–3 head-height proportions
themselves are *not* a negative constraint — see "Sole style authority" above; do not undersize
the head to avoid them), multiple characters in frame, baked UI/text, 3/4 angle standing in for a
missing direction, or chroma-key residue. The final sheet must have true transparent surroundings,
with no labels, rulers, borders, checkerboard, captions, or watermark.

> Editorial note (2026-07-29): an earlier version of this list excluded "chibi/large-eye styling"
> outright, which contradicted this same file's style-authority section — the current sole
> authority image *is* chibi-proportioned with large heads. That was very likely a leftover from
> an earlier, different style authority (before the 2026-07-22 authority swap recorded in
> `docs/current-state.md`) and has been corrected above rather than silently carried forward.

## Route to a real candidate

Identical mechanism to the player prompt file's "Route to a real candidate" section: this tool
writes job-packs and imports externally-produced results; it does not call an image API itself.
See that section rather than duplicating it here.

## npcSpot context (informational only)

`tools/asset-forge/contracts/asset-contract.sample.json`'s `bld_m_inn` entry already declares
`"npcSpots": [{ "x": 1, "y": 0, "role": "innkeeper" }]`. This prompt does not change building
placement; it only informs the pose/scale sanity check (the innkeeper should read as standing at
a counter, not mid-stride, when composited near that spot at native scale).
