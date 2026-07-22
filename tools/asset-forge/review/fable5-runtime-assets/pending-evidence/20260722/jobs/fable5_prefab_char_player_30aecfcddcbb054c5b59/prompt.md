# Fable5 prefab character sheet — common spec (draft)

> Status: draft, not wired into any asset-forge job yet. This file exists so a future
> `make-job` / `make-job-v2` prompt assembly, or a manually-run external generation session,
> has one canonical text to include. It supersedes `prompts/v2/characters/animated-character.md`
> (48x96 frame, idle2+walk4+talk2+work2) for any character that must match the current
> `Fable5PrefabSpec.md` section 6/7 contract. It does not delete or edit that older file.

Authority: `Fable5PrefabSpec.md` section 6 (Character) and section 7 (Asset Contract), repo root.

## Canvas and pivot

- Frame canvas: **64x128** pixels. Visible body height: about **72px**, vertically placed so the
  character reads as standing on the frame's own baseline.
- Foot pivot: **(32, 120) in every frame of every character, with no exception.** This is
  `Fable5PrefabSpec.md`'s N6 acceptance check. If a generated frame's sole does not land on
  that pixel after processing, the frame fails, full stop — do not average, do not "close enough".

## Sheet layout

One character = one PNG, **640x512**, laid out as a strict 4-row x 10-column grid of 64x128
cells with no gaps, borders, labels, or frame numbers baked in:

| row | direction | col 0–1 | col 2–7 | col 8–9 |
|---|---|---|---|---|
| 0 | south (facing the viewer) | idle x2 | walk x6 | interact x2 |
| 1 | west | idle x2 | walk x6 | interact x2 |
| 2 | east | idle x2 | walk x6 | interact x2 |
| 3 | north (facing away) | idle x2 | walk x6 | interact x2 |

- idle plays at 4fps, walk at 10fps.
- interact's 2 frames are shared: the runtime reuses the same pair for talking and for working
  poses. Do not draw two different sub-poses hoping to split them later — the contract only
  reserves 2 columns for this row segment.
- **East is never a mirror of west.** Draw it as its own pass. A horizontally-flipped west strip
  puts tool/prop hands and asymmetric costume details on the wrong side and is rejected on sight,
  not just on pixel-diff.

## Identity discipline

- Every direction and every frame of one character must read as the same individual: same face,
  age, head size, hair, palette, silhouette, and any carried object or costume asymmetry.
- Only camera angle and walk/idle/interact phase may change between cells. Do not let the
  generator "improve" the proportions, add accessories, or drift the palette between directions —
  that is the single most common way a multi-call generation session fails identity continuity.
- Which reference image supplies that identity, and how strictly, is asset-specific — see the
  per-character prompt file, not this shared one.

## Matching the world

- Lighting and material language must match `target-town-user-direct-v1.png`
  (`public/fable5-v2/assets/world/target-town-user-direct-v1.png`, byte-identical to
  `art/references/user-provided/target-town.png`, SHA-256
  `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`): light from the upper-left
  at twilight, charcoal / slate-blue / desaturated moss-green / weathered-brown / cold-stone
  ambient tones, restrained warm-amber accents only at light sources. Use 2–3 shading steps per
  material, crisp pixel clusters, and a 1px dark contour where the silhouette needs separation
  from that background. A correctly-shaded character dropped onto that exact background should
  not look like it was lit from a different scene.
- This is a density/contrast match, not a recolor: keep the character's own identity palette
  (see the per-character prompt) and adjust shading *steps*, not hue, to sit in the same light.

## Generation-image mechanics (not the finished asset)

- Request a flat, uniform, high-saturation chroma-key background (or true alpha transparency if
  the provider supports it) so each frame can be isolated. This chroma background is scaffolding
  for post-processing, not part of the style brief above.
- No text, watermark, sheet border, checkerboard, ruler, or caption anywhere in the image.
- Nearest-neighbor-safe pixel art: hard edges, no soft anti-aliased gradients, no photographic
  texture.

## Boundary reminder

A generated image produced from this prompt is a **pending candidate only**. It is not approved,
not identity-verified, and not game-ready until a human inspects it against the identity source,
runs it through `process`/`import`, and it clears the interactive `promote` review in
`tools/asset-forge`. Do not claim completion from generation alone.

# char_player — Fable5 prefab sheet (draft prompt)

> Status: draft, not generated. Pair with `00_common_fable5_character_sheet_style.md` and the
> contract at `tools/asset-forge/contracts/fable5-prefab/character.player.contract-draft.json`.

## Identity source (must not drift)

Single identity authority: the player identity/character-style reference sheet under
`art/references/user-provided/`, 1536x1024, custody `user-direct` (project owner attached this
file directly). Read the identity language from `docs/user-provided-image-policy.md` section 7;
resolve the exact filename and SHA-256 from `art/contracts/user-provided-images.json` →
`sources[]` where `sourceId == "user_character_style_reference"`.

This prompt deliberately does not restate that file's basename or digest inline.
`tools/asset-forge/test/reference-integrity.test.mjs` (`RETIRED_CHARACTER_REFERENCE`) asserts
that exact basename/hash must not appear anywhere inside `tools/asset-forge` — the corrective
work behind the current policy moved this image's provenance authority entirely outside this
tool. Look it up from the ledger each time a job actually needs the path, rather than copying it
into more files.

Keep, unchanged from that sheet, across all 40 cells:

- Gray-to-light-purple hair and a beard.
- Deep green tunic with ochre/mustard trim.
- Cream sleeves.
- White-to-light-gray lower garment.
- Dark shoes.
- Face, apparent age, head size, and body proportions.

Only camera direction (south/west/east/north) and walk/idle/interact phase may be invented beyond
what the reference sheet directly shows; the person must not change.

**Explicitly excluded:** the long navy field coat, cream knit scarf, cross-body leather satchel,
brass lapel badge, and teal-tabbed notebook described in this tool's own
`data/v2/art-direction/characters.json` entry for `character.player`, and the
`character_visual_master.png` reference it points to. That identity was produced by Codex image
generation, was never user-provided, and `docs/user-provided-image-policy.md` section 7 records it
as rejected for current player identity and runtime use ("現在のプレイヤー同一性とruntime用途では
不採用"). If a generation session has that older description in context, override it — it is
stale, not a variant to reconcile with.

## Sheet

Follow `00_common_fable5_character_sheet_style.md` exactly: 640x512, 4 rows (south/west/east/
north) x 10 columns (idle x2, walk x6, interact x2), 64x128 cells, foot pivot fixed at (32,120).

## Per-row content

- **south (row 0):** idle = calm standing weight settled evenly, hands relaxed; walk = a
  six-phase natural stride cycle with alternating planted foot, no foot-sliding shadow, arms
  countering the opposite leg; interact = one attentive listening/speaking gesture pair usable
  for both a conversation prompt and a "working" beat (e.g., a small hand raise into a settled
  hand-at-chest follow-through). No prop is required; if one is added it must stay in the same
  hand across every other direction.
- **west / east:** same idle/walk/interact content as south, reprojected to a true side view.
  Draw east independently — do not flip west. If any asymmetric detail exists (hair part, tunic
  trim knot, a held object), keep it on the same anatomical side in both rows.
- **north (row 3):** same idle/walk/interact content, back view. Hair and tunic trim silhouette
  must still read as the same person from behind.

## Negative constraints

No sword, no combat armor, no hood hiding the face, no baked exclamation/quest marker, no
added satchel or badge, no UI frame, no text, no multiple characters in one frame, no 3/4 or
isometric-only angle standing in for a missing direction.

## Route to a real candidate (no built-in API call)

This tool does not call an image-generation API itself (see `tools/asset-forge/README.md`,
"No paid API path"). To turn this prompt into a candidate:

1. `node src/cli.mjs generate --asset character.player --provider job-pack --dry-run` style job
   (once `character.player`'s v2 definition is rewritten to this contract — see the contract
   draft's `$comment`) writes a portable prompt/reference/output-contract bundle under
   `generated/jobs/`. No image is produced by this step.
2. A human (or an external, human-supervised session — Codex CLI's own built-in image
   generation, or a signed-in ChatGPT session) runs that prompt outside this tool and produces
   PNG bytes. Nothing in `tools/asset-forge` performs this step automatically.
3. `node src/cli.mjs import --asset character.player --file <path> --job-pack <job-pack.json>
   --recipe <recipe.json> --materialize-source` brings the result back in as a hash-verified
   pending candidate.
4. A human runs `process`, then the interactive `promote` (or `promote-required` for a batch),
   before anything is exported to the game.

Steps 1, 3, and 4 are this tool's job. Step 2 is the "都度生成セッション" (case-by-case
generation session) the product owner named as the fallback — in this tool's actual design it is
not a fallback path, it is the only path that produces real pixels; `mock` only produces
deterministic placeholder test images.
