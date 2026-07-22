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
