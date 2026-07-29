# char_player — Fable5 prefab sheet (draft prompt)

> Status: draft, not generated. Pair with `00_common_fable5_character_sheet_style.md` and the
> contract at `tools/asset-forge/contracts/fable5-prefab/character.player.contract-draft.json`.

## Sole identity and style authority (must not drift)

The only permitted player identity and character-style authority is the exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`). The job pack must verify
the same path and digest in `art/contracts/user-provided-images.json` before generation.

`char_player` must be a direct visual derivation of that exact image. Preserve the same individual,
visible identity, face, apparent age, proportions, silhouette, pixel density, contour language,
palette logic, and shading language across all 40 cells. Only the required camera direction
(south/west/east/north) and idle/walk/interact phase may be invented; the person must not change.

Do not use a prior player, NPC, generated sheet, deployed asset, candidate, or prompt as a visual
reference, comparison authority, derivation input, or runtime-promotion source. Historical
candidates remain quarantined records only; they are not alternate variants to reconcile.

### What the authority image actually shows (observed directly, useful if the reference can't be attached, or as a cross-check against it)

An elderly man, chibi/SD proportions (roughly 2.5–3 heads tall, oversized head, short limbs).
Silver-gray hair in a short, slightly tousled/uneven coif, and a full gray beard covering the whole
lower face and jaw (no visible mouth). Pale skin. Eyes are minimal: simple dark almond shapes with
one small light highlight dot each, no rendered pupil/iris detail or eyebrow linework. Clothing: a
sage/forest-green robe with long sleeves, a mustard-gold trim/piping running down the V-shaped front
opening and at the sleeve cuffs, worn open over a cream/off-white under-layer that shows at the
center front like an apron and hangs to roughly mid-thigh; a gold/tan belt or sash at the waist with
a small dark pouch or tool hanging at the hip; navy-blue trousers visible below the robe hem; dark
brown/near-black shoes. A continuous dark (near-black, slightly warm, not flat #000) contour line
separates the whole silhouette from the background and separates major colour fields (hair/skin,
robe/under-layer) from each other. Shading reads as roughly three tonal steps per surface
(highlight/base/shadow) rather than a smooth gradient, softened by some anti-aliasing rather than
hard 1px pixel-art edges — match that same softness, do not sharpen it into crisper pixel blocks
than the reference actually has. No baked drop/contact shadow under the feet. Background in the
reference is flat chroma-key magenta — ignore it, it is scaffolding, not part of the character.

The reference sheet's own row 2 (what would be "east") is not usable as a directional example —
see `00_common_fable5_character_sheet_style.md`, "The style-authority reference image itself has
this exact defect". Rows 0 (south) and 3 (north) are fine to study directly.

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

No sword, combat armor, hood hiding the face, baked exclamation/quest marker, UI frame, text,
multiple characters in one frame, 3/4/isometric-only substitute for a required direction, or
chroma-key residue. The final sheet must have true transparent surroundings, with no labels,
rulers, borders, checkerboard, captions, or watermark.

## Route to a real candidate (no built-in API call)

This tool does not call an image-generation API itself (see `tools/asset-forge/README.md`,
"No paid API path"). To turn this prompt into a candidate (run from inside `tools/asset-forge/`,
or prefix each command with `npm --prefix tools/asset-forge` from the repo root — there is no
`make-fable5-character-job` script in the repository-root `package.json`):

1. `npm run make-fable5-character-job -- --asset char_player --dry-run` validates the exact
   sole authority, prompt pair, and output contract without creating pixels or a candidate.
2. Run the same command without `--dry-run` to write a portable prompt/reference/output-contract
   bundle under `generated/jobs/`. No image is produced by this step.
3. A human (or an external, human-supervised session — Codex CLI's own built-in image
   generation, or a signed-in ChatGPT session) runs that prompt outside this tool and produces
   PNG bytes. Nothing in `tools/asset-forge` performs this step automatically.
4. Use only the Fable5-specific intake route to bring the result in as a new pending candidate;
   do not import, promote, or reuse historical candidates.
5. A human performs the required review and separately authorizes any later runtime installation.

Steps 1, 2, and 4 are this tool's job. Step 3 is the "都度生成セッション" (case-by-case
generation session) the product owner named as the fallback — in this tool's actual design it is
not a fallback path, it is the only path that produces real pixels; `mock` only produces
deterministic placeholder test images.
