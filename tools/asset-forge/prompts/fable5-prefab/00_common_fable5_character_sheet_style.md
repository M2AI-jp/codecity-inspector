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

### Exactly what the pivot check tests (read this before drawing feet)

`tools/asset-forge/src/fable5-prefab-character-intake.mjs` (`inspectFable5PrefabCharacterCandidate`,
function `pivotProblem`) is the real mechanical gate every candidate must clear on import. Per
64x128 cell it does two independent things, both on the lower **16-pixel band, y=112..127 of that
cell**:

1. Requires at least one opaque (alpha>0) pixel exactly on row **y=120**. A frame where the
   drawn sole sits at y=118 or y=122 — very common in a mid-stride "foot lifted" walk phase, or
   after a naive resize shifts everything by a pixel — has **zero** opaque pixels at y=120 and is
   rejected with "no opaque sole pixels at the pivot row", independent of how good the frame looks.
2. Computes the mean x of every opaque pixel in that same y=112..127 band and requires it to fall
   within **32±2 (x=30..34)**. This is a centroid over the whole lower-leg/foot silhouette, not a
   single point — a wide stance, a trailing back foot, or a foot that has drifted sideways during a
   walk-phase redraw all pull this number away from 32.

This is not a theoretical risk: **every one of the four historical candidate sheets already sitting
in this repo failed this exact check when run through the real `import-fable5-character` command**
(evidence in the "Failure evidence from this repo's own history" section below). Draw every frame
with the standing/contact foot's sole deliberately centered under x=32 and touching y=120, then
check it — do not eyeball it after the fact.

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
- **East is never a mirror of west, and east is never the same silhouette as west facing the same
  way either.** Draw it as its own pass, actually turned to face the opposite direction. Two
  distinct failure shapes have both been observed from real generations against this exact spec
  (see evidence below): (a) a horizontally-flipped west strip, which puts tool/prop hands and
  asymmetric costume details on the wrong side; (b) an **unflipped duplicate** — west and east
  both still facing left/west — which is arguably the more common failure in practice and is
  *not* reliably caught by the mechanical "exact mirror" check (that check only fires on a
  byte-perfect horizontal flip; an unflipped duplicate, or a redraw that merely resembles one,
  passes it while still being completely wrong). After generating, a human must look at row 2
  (east) directly and confirm the character's nose/torso/lead foot actually point right/east —
  do not infer this from "the mechanical check passed."

### The style-authority reference image itself has this exact defect — do not copy its row 2

`art/references/user-provided/character_style_authority_20260722_v1.png` is the sole style/identity
authority (see the per-character prompt for how strictly), but its own row 2 (the position that
would be "east" in a 4-row south/west/east/north sheet) is **not** an independently-drawn or even
mirrored east pose — it is, by direct visual and pixel comparison, the same west-facing silhouette
as row 1, not turned around. Do not treat that row as an example of what east should look like, and
do not let a generation session "match the reference" by reusing that row's content or direction
for the east row of a new sheet. Row 0 (south) and row 3 (north) in the reference are fine to use
as directional examples; row 2 is not.

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
- `target-town-user-direct-v1.png` also contains a few tiny human figures painted directly into the
  scene (e.g. near the well/plaza). Those are environment dressing at a much softer, smaller, far
  less outlined rendering than the character-style authority — they are not an alternate style
  authority and must not be imitated. Match that background's *light direction and shading-step
  density* only; keep the character's own crisp bold-contour chibi construction from the style
  authority image.

## Generation-image mechanics (not the finished asset)

- Request a flat, uniform, high-saturation chroma-key background (or true alpha transparency if
  the provider supports it) so each frame can be isolated. This chroma background is scaffolding
  for post-processing, not part of the style brief above.
- Explicitly excluded: text, watermark, sheet border, checkerboard, ruler, caption, frame numbers,
  UI chrome, or any second character/figure sharing a frame — anywhere in the image.
- Nearest-neighbor-safe pixel art: hard edges, no soft anti-aliased gradients, no photographic
  texture.

### Output size vs. the exact 640x512 requirement

`inspectFable5PrefabCharacterCandidate` (same file as the pivot check) hard-rejects any candidate
whose PNG is not **pixel-exact 640x512** — `candidate dimensions must be 640x512` — with no resize
step of its own. Most image-generation tools (including built-in `image_gen`-style tools) offer a
fixed menu of output sizes rather than an arbitrary WxH, and none of the common presets are exactly
the 640:512 (5:4) ratio this sheet needs. Plan for a **separate, explicit resize step before
import**, not as an afterthought:

1. Generate at the largest size available whose aspect ratio is closest to 5:4 (1.25) landscape.
2. If that size is not exactly 5:4, pad (letterbox) to 5:4 first — do not crop into the character
   and do not stretch non-uniformly. A non-uniform stretch changes the character's proportions
   against the style authority and will visibly fail human review even if it happens to pass the
   mechanical checks.
3. Resize the padded image down to exactly 640x512 with a single uniform scale factor, using
   nearest-neighbor or box filtering (not bicubic/lanczos — those blur hard pixel edges and can
   shift the foot silhouette off the exact y=120 pivot row described above).
4. Re-measure the result before importing: it must be exactly 640 wide and 512 tall, RGBA, with
   real alpha (not just visually-transparent-looking pixels — see the next section).

### Transparency has to be real alpha, not "looks transparent"

The same mechanical check also requires all four sheet corners to be fully transparent
(alpha=0) and rejects any pixel that is still opaque *and* exactly chroma magenta (R255 G0 B255).
A soft/anti-aliased chroma-key removal that leaves a faint magenta or gray fringe around limbs will
often still pass this narrow byte-exact check (the fringe pixels are rarely exactly 255,0,255) while
looking visibly wrong — so, again, do not rely on the mechanical pass alone; look at the edges of a
few frames at 400%+ zoom for keying residue before treating a candidate as ready for review.

## Failure evidence from this repo's own history (read before your first generation)

This is not a hypothetical checklist — it is the outcome of literally running this repo's real
mechanical validator (`inspectFable5PrefabCharacterCandidate`) against the four candidate sheets
already sitting in `tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/`
(`char_player-alpha.png`, `char_innkeeper-alpha.png`, `char_town_clerk-alpha.png`,
`char_resident-alpha.png` — built against this exact style authority, still `pending-human-review`,
never approved, never promoted):

- **4 of 4 failed the pivot check**, each with 9–13 failing cells out of 40. Columns 8 and 9 (the
  interact pose) failed on nearly every one of the four sheets — a reaching/gesture pose shifts
  weight off-center far more easily than a neutral idle or a mid-walk stride does. A few walk-cycle
  columns failed too, from the mid-stride "foot briefly airborne" phase landing no opaque pixel on
  y=120. **Budget real attention for the interact pose's foot placement specifically** — it is the
  single most common failure across every historical attempt.
- **3 of 3 real `image_gen`-produced NPC candidates (innkeeper, town clerk, resident — the player
  candidate was a direct crop of the authority image, not a fresh generation) reproduced the
  west/east duplication defect** described above: their raw generation output's row 2 read as the
  same facing direction as row 1, not independently turned. By the time those raw outputs were
  cropped/resized into the final 640x512 candidates, the west/east relationship had shifted to read
  closer to a mirror instead — still wrong, just wrong in the other, mechanically-checked way. Don't
  assume a resize/crop pass will fix a directionally-wrong east row; get it right at generation time.
- **The historical innkeeper candidate failed identity distinctiveness**: it is, by direct visual
  comparison, essentially the same face/beard/hair/robe as the style-authority image (i.e., the same
  person as the player), not a distinct individual using the authority only for pixel density,
  proportion, and shading language. The town-clerk and resident candidates from the same batch did
  keep a distinct identity (different hair, face, and costume from the player), so this is an
  avoidable, not inherent, failure — see `character.innkeeper.prompt-draft.md` for the specific
  guard against it.

None of these four historical candidates are promoted, approved, or usable as a reference — they
remain `pending-human-review` quarantined evidence. They are cited here only as ground truth for
what to avoid; do not import, promote, or visually copy from them.

## Boundary reminder

A generated image produced from this prompt is a **pending candidate only**. It is not approved,
not identity-verified, and not game-ready until a human inspects it against the identity source,
runs it through the Fable5-specific job/intake commands below, and it clears human review. Do not
claim completion from generation alone.

All `npm run <fable5-*>` commands referenced by the per-character prompt files must be run from
inside `tools/asset-forge/` — e.g. `cd tools/asset-forge && npm run make-fable5-character-job --
--asset char_player --dry-run`, or equivalently `npm --prefix tools/asset-forge run
make-fable5-character-job -- --asset char_player --dry-run` from the repository root. There is no
script of that name in the repository-root `package.json`; running it from the repo root without
`--prefix` fails with `npm error Missing script`. (Verified by actually running both forms.)
