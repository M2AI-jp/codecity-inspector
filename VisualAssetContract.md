# CodeCity Inspector — production visual contract

Date: 2026-07-14
Owner: Lead (`/root`)
Implementation worker: Terra (`/root/terra`)

## Source of truth

The 1491 x 1055 image board and the approved category sheets are the visual
source of truth. A generated asset is invalid unless its immutable provenance
contains both:

1. `world_visual_master` and its verified SHA-256; and
2. one directly relevant approved category sheet and its verified SHA-256.

An asset definition, generation result, approval, export, or runtime manifest
must not claim completion while either reference is missing, pending, mismatched,
or unrelated to the asset ID.

## Art direction

- Dense late-medieval top-down pixel art, matching the image board's scale,
  masonry detail, warm windows, deep blue-green roofs, moss, vegetation, and
  lived-in clutter.
- Coherent three-quarter/top-down perspective. Entrances face the walkable
  foreground and footprints remain readable.
- Fine, crisp pixel clusters at native display size. No smooth vector look,
  flat placeholder icons, modern chibi proportions, giant character heads, or
  enlarged 16 px mock art.
- Transparent masters for buildings, characters, objects, and effects. Base
  terrain stays opaque and seamless. `field.tree` and `field.rock` are feature
  overlays: their tree/stone silhouettes use real alpha and render over the
  opaque `field.grass` base. No baked labels, square color matte,
  specimen-sheet background, or neighboring examples may remain.
- Procedurally drawn mock pixels may be used only in tests. They are forbidden
  as a production candidate.

## Production dimensions

These replace the rejected 16 px / 48 px production contract.

| Category | Production master | Runtime intent |
|---|---:|---|
| terrain | 64 x 64 per tile | native or reduced, never enlarged |
| building | 256 x 256 transparent canvas | preserve detail; render by footprint without stretching |
| character | 24 x 40 per frame; 4 x 3 grid = 96 x 120 | small map-scale silhouette |
| object | 64 x 64 transparent canvas | native or reduced, never enlarged |
| effect | 32 x 32 per frame; 4 x 1 grid = 128 x 32 | short stable animation |

Downsampling uses nearest-neighbor only after the source subject has been
isolated cleanly. Upscaling a smaller candidate to satisfy these dimensions is
forbidden.

## Production methods

- Prefer a lossless/reference-derived crop when the approved sheet already
  contains a clean, complete example of the requested asset.
- Use image generation for missing role/state/direction variants. The prompt
  must identify the world board as the global style reference and the primary
  category sheet as the subject reference.
- Every crop or generated image enters Asset Forge as a pending candidate with
  source bytes, prompt hash, reference IDs/hashes, output contract, and method.
- No automatic approval. Terra prepares candidates; the Lead performs the
  visual decision and records approval only after inspection.

## Automated rejection gates

Reject a candidate when any of the following is true:

- output dimensions, spritesheet grid, alpha/background, or hash are wrong;
- required references are absent from provenance;
- the source is smaller than the output contract and was enlarged;
- transparent assets contain a large opaque rectangular sheet background;
- opaque base-terrain edges fail the repeat/seam test;
- `field.tree` or `field.rock` contains an opaque square ground matte instead
  of a clean transparent feature silhouette;
- a character frame is empty, clipped, duplicated across roles, or drifts
  between animation cells;
- a production candidate is byte-identical to the rejected asset set;
- the public manifest does not cover all 78 required IDs and runtime bindings.

## Lead visual acceptance

Terra must provide native-size contact sheets grouped as 17 buildings,
22 characters, 19 terrain tiles, 18 objects, and 2 effects. The Lead compares
them beside the image board and category sheets. Approval requires:

- matching palette, lighting, perspective, density, and pixel scale;
- recognizable semantic role at native size;
- consistent scale within a category;
- clean transparency/seams and no specimen-sheet residue;
- no visibly lower-quality outlier.

Automated success is necessary but never sufficient. Any failed visual group is
regenerated or re-extracted before export.

## Runtime acceptance

- The initial overview remains byte-identical to the image board.
- The game loads only the newly approved manifest; rejected assets and the old
  renderer are absent.
- New character, facility, terrain, object, and effect assets must each be used
  by an observable game path, not merely listed in an inspector.
- Rendering never enlarges an asset beyond its production master and never
  falls back to the rejected visual set.
- Final acceptance requires root tests, Asset Forge tests, manifest validation,
  loopback browser play, zero console errors, and Lead screenshots at overview
  and native follow-camera scale.
