# char_innkeeper — Fable5 prefab sheet (draft prompt)

> Status: draft, not generated. Pair with `00_common_fable5_character_sheet_style.md` and the
> contract at `tools/asset-forge/contracts/fable5-prefab/character.innkeeper.contract-draft.json`.
> No v2 art-direction entry for an innkeeper currently exists in
> `data/v2/art-direction/characters.json` (only `character.player`, `character.town_clerk`,
> `character.gatekeeper`, `character.dojo_inspector`, `character.mob.townsfolk_male/female`,
> `character.dojo_student` do). This is new authoring, not a rewrite of an existing wrong entry.

## Identity: a different person, sharing one rendering language

`docs/user-provided-image-policy.md` section 7: "NPCは別人にできますが、原画のpixel density、
頭身、輪郭、陰影の言語を共有します" (an NPC may be a different person, but shares the reference
art's pixel density, head-to-body proportions, outline weight, and shading language). So:

- The innkeeper does **not** have to wear the player's green tunic or match hair color.
- The innkeeper **must** match the player identity/character-style reference sheet under
  `art/references/user-provided/` on: pixel density (same apparent resolution of detail, not
  smoother or blockier), head-to-body ratio, silhouette weight/slimness, line/contour weight, and
  the 2–3-step shading language described in `00_common_fable5_character_sheet_style.md`. (Ledger
  `sourceId`: `user_character_style_reference` in `art/contracts/user-provided-images.json` — see
  `character.player.prompt-draft.md`'s "Identity source" section for why this file's exact
  basename/hash is deliberately not restated here.)
- Suggested role signifiers (adjust freely, these are not locked): apron over practical tavern
  clothing, warm neutral palette that still reads correctly under the twilight ambient light of
  `target-town-user-direct-v1.png`, a towel/rag or tankard as an optional interact-row prop held
  in one consistent hand across all four directions.

### Existing innkeeper images are not an identity source

`public/fable5-v2/assets/characters/innkeeper-4dir-v1.png` (256x512, idle-only, no walk cycle)
and `innkeeper-talk-4frame-v2.png` (384x64, a separate small talk strip at a different frame
height) are the currently-deployed innkeeper art. Neither has a `.lineage.json` and neither
appears in `art/contracts/user-provided-images.json`'s source ledger — their origin is
**unverified** by the current provenance system, unlike the player's fully-chained
`player-green-8walk-v4.lineage.json`. Do not treat them as an approved identity to preserve
pixel-for-pixel. They may be used only as loose, non-binding continuity reference (e.g., if the
project owner likes the existing hair color or apron color) and must be named explicitly as such
in any new candidate's provenance record — never as `user-provided` or `user source` per
`docs/user-provided-image-policy.md` section 5 ("派生物を `user source`、`user original`、
`user-provided` と表示しません").

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

No player identity bleed (do not accidentally reuse the green tunic/hair described in the
player prompt unless the project owner asks for a family/uniform resemblance). No modern
clothing, no chibi/large-eye styling, no multiple characters in frame, no baked UI or text,
no 3/4 angle standing in for a missing direction.

## Route to a real candidate

Identical mechanism to the player prompt file's "Route to a real candidate" section: this tool
writes job-packs and imports externally-produced results; it does not call an image API itself.
See that section rather than duplicating it here.

## npcSpot context (informational only)

`tools/asset-forge/contracts/asset-contract.sample.json`'s `bld_m_inn` entry already declares
`"npcSpots": [{ "x": 1, "y": 0, "role": "innkeeper" }]`. This prompt does not change building
placement; it only informs the pose/scale sanity check (the innkeeper should read as standing at
a counter, not mid-stride, when composited near that spot at native scale).
