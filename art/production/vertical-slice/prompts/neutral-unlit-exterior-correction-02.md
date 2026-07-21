# Neutral unlit exterior correction 02 — surgical master edit

## Why candidate 01 failed

Candidate 01 is not a reference for layout or objects. It was rejected at 40/49, 41/49 and 23/49 because it
redrew the whole town, retained chimney smoke, replaced the inn cluster, failed the exact tower notch, made
the cobbles chalky, flattened material values and weakened the town-hall hierarchy.

## Role-labelled references

1. `boards/old-town-exterior-master-v1.png` — the only authoritative edit target and pixel-registration source.
2. `qa/old-town-master-v2-geometry-overlay.png` — coordinate audit only; never reproduce its grid, colors, labels or marks.
3. `art/references/target-town.png` — finish, material separation and value hierarchy only; never borrow its layout.

## Prompt

Perform a surgical state edit of Image 1. This is the same town with its renderer-owned lighting, weather and
smoke switched off; it is not a redraw, reinterpretation, daytime remake or new take. Image 1 linework, pixel
edges, object identities and coordinates are registration anchors. Image 2 is an audit overlay only. Image 3
defines finish quality only.

Return exactly 1536×1024 RGB pixel art at the existing native pixel density. Keep the exact crop and camera.
Outside the two repair masks below, preserve every building footprint and silhouette, roof edge, chimney,
door leaf/arch/threshold/foot, stair, road edge, cobble boundary, raised blocker, well, wall, tree, foreground
occluder, sign, cart, barrel, crate, table, stool, planter, flower cluster and apparent exit in the same position.
Non-repair landmarks and props may drift no more than 4px; all four door centerlines and feet no more than 2px.
Do not add, remove, merge, replace, restyle, resize or reorder material objects.

Apply only these global **state** changes:

- Remove every visible chimney smoke or steam plume, including the small pale puffs along the north roofline,
  inn, house, survey tower and foreground roofs. Former smoke regions contain unknown hidden background: infer a
  locally consistent continuation from immediately adjacent roof/tree/sky texture without moving any observed
  anchor. Those newly revealed pixels are inferred and excluded from master registration-drift scoring. No smoke
  pixel may remain. Smoke removal is renderer-effect cleanup, not geometry redesign or a third topology repair.
- Switch every window, streetlamp and doorway lamp fully off. Remove flame cores, amber emission, bloom, halos,
  light pools, long cast-light streaks, dusk/night grade, haze and vignette. Do not turn openings into black holes.
- Use soft neutral overcast ambient light with subtle upper-left form shading, compact contact AO and roof-overhang
  shade only. This must look like deliberate production albedo, not globally desaturated gray daylight.
- Preserve distinct material values: cool mid-gray stone with plane changes, warm brown timber/doors, deep navy
  slate, varied deeper natural green foliage, restrained purple awning and readable non-emissive glass/metal.
  Reduce cobble highlight dominance by about 15–20% while retaining crisp individual-stone detail. The road must
  remain a restrained mid-value gameplay surface. Final actor contrast is a later character-overlay/browser gate.
- Preserve non-emissive value hierarchy: town hall/clock first, inn/house/tower second, foreground roofs and trees
  third. Keep foreground, midground and background as three readable depth bands without crushing shadow detail.

The global state changes above apply everywhere, including inside both repair masks. Apply exactly two local
topology repairs inside their union masks. “Nothing else” means no other geometry, silhouette, edge coordinate,
object identity/count/order/scale/orientation change; RGB material values in both masks receive the same global
neutralization as the rest of the image.

1. In `(x=1380,y=493,w=20,h=189)`, replace only the eastern/right route-side edge of the eastern-right raised
   bed, `x=[1380,1400), y=[493,682)`, with matching adjacent cobble. Keep every other bed, rock, plant, crate,
   tower, door and path geometry/silhouette/edge coordinate unchanged; only their global neutral material values
   may change. The resulting visible tower passage is
   `x=[1380,1432)` and exactly 52px wide.
2. In union mask `(x=267,y=431,w=91,h=83)`, translate the exact same inn table/barrel cluster
   belonging to it by `(0,-18)`, from bbox `[267,449)-[358,514)` to `[267,431)-[358,496)`. Preserve identity,
   count, silhouette, internal pixel geometry, orientation, scale and ordering; do not reinterpret it as a new
   table/stool arrangement. Its RGB values receive only the same global neutralization. Restore matching cobble
   in the vacated pixels. The raw vertical passage `y=[496,544)` is exactly 48px.

Keep the hall, inn, house and survey-tower entrances readable using material/value contrast, framing, stairs and
threshold detail, never glow. Keep all main and branch routes visually open. Preserve the open-looking west,
east and south roads and north stair; honest closures are later separate alpha overlays.

Forbidden: characters, NPCs, UI, readable text, grid, colored boxes, labels, watermark, transparency, smoke,
fog, weather, glow, light pools, black voids, global gray wash, smoothed edges, cloned vegetation, changed
rooflines, new windows, new props, changed exits, changed road layout or resampling.

## Hard evaluation gate

- Exact 1536×1024 RGB; no resampling.
- Four door centerlines/feet drift ≤2px and all non-repair landmark/prop drift ≤4px against Image 1, excluding
  newly revealed inferred backfill pixels formerly hidden by smoke.
- No non-repair object identity/count/order change; major observed bbox IoU ≥0.95.
- Inn cluster preserves the same identity/silhouette/internal geometry and translates exactly `(0,-18)`, exposing
  a continuous 48px vertical slot at `y=[496,544)`; its RGB values may differ only through the global neutralization.
- Tower bed changes only in the 20×189 mask and exposes a continuous 52px passage.
- Zero visible smoke plume, emission, flame, halo, bloom, light pool, haze, cast-light streak or vignette; inferred
  smoke backfills have no seam, repetition, smear or false object edge.
- Cobble highlights are restrained; material families and three depth bands remain distinct; the hall is the first
  neutral-value landmark. Final actor contrast remains a later character-overlay/browser gate.
- Score ≥44/49 with hard failure count 0. Adoption, alpha, slicing and runtime remain separate later gates.

## Provenance

- Edit target SHA-256: `a3b33e5dcb8bd2c0475ba146888027159cb5c955eae3a5d53d58d7770a0417ce`
- Geometry overlay PNG SHA-256: `0ed406803b85e153a3e1ea24d8ce8baf082d4b485efad8fa37a3e91005cb0eda`
- Target-town SHA-256: `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`
- Candidate 01 negative-evidence SHA-256: `7592271bfcb9200a1e008fbcfe2bcc88f3e10361e3c76f82602e1fc8c8977781`
