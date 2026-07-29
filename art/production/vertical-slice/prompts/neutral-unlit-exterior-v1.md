# Neutral unlit exterior v1 — imagegen production prompt

## Role-labelled references

1. `boards/old-town-exterior-master-v1.png` — authoritative edit target, composition and object identity.
2. `qa/old-town-master-v2-geometry-overlay.png` — coordinate annotation only; never reproduce grid, boxes, labels or colors.
3. `art/references/target-town.png` — material richness, density and finish quality only; do not copy its layout.
4. `/private/tmp/codecity-world-support-contact.png` — approved world material/projection support.
5. `/private/tmp/codecity-building-support-contact.png` — approved timber/stone/roof material support.

## Prompt

Use case: lighting/weather neutralization with exactly two explicitly masked topology repairs.
Asset type: non-runtime whole-world unlit composite registration board. This is not the later object-removed
clean foundation plate.

Image 1 is the authoritative 1536×1024 composition and edit target. Image 2 is a QA annotation of the
same image: use it only to preserve the 24×16, native-64px geometry, four door centerlines, walking routes,
raised blockers and building silhouettes. Do not draw any annotation. Image 3 defines the required visual
finish and material density, not layout. Images 4 and 5 provide approved projection and material vocabulary.

Convert Image 1 into a neutral, unlit material-state exterior. Preserve the exact 1536×1024 framing and the
position, silhouette and identity of every building, roof, doorway, road edge, plaza, stair, raised garden,
well, wall, foreground house, tree and prop. Outside the two exact repair masks below, major anchors and props
may move by at most 4px; door centerlines and feet may move by at most 2px. Inside those masks, the two numbered
repair instructions take precedence over the general drift and object-movement prohibitions; no other exception exists.

Use neutral overcast material-preview lighting with gentle, consistent form shading only. Switch every
window, streetlamp and doorway lamp fully off. Remove amber emission, halos, ground light pools, long cast
shadows, dusk/night color grade, every visible smoke plume, smoke glow, atmospheric haze and vignette. Restore
the newly revealed chimney/roof/background pixels consistently; smoke is renderer-owned and must not remain baked. Keep rich stone, timber, blue
slate, moss, flower and cobble texture; do not wash out, flatten or simplify the accepted town.

Keep the raised circular garden and the three lower planted beds visibly raised and blocking, with exactly
two exact exceptions:

1. Inside pixel mask `(x=1380,y=493,w=20,h=189)`, trim only the **eastern/right route-side edge** of the
eastern-right raised bed from `x=1400` back to `x=1380` and continue the already adjacent cobbles. This must open the declared tower corridor
`x=[1380,1432), y=[493,704)` without moving the tower door, crates, tower silhouette or any other bed edge.
2. Inside the union mask `(x=267,y=431,w=91,h=83)`, move the same inn courtyard table/barrel cluster
exactly 18px north, from bbox `[267,449)-[358,514)` to `[267,431)-[358,496)`. Preserve its object count,
identity, scale and orientation, and restore matching cobble in the vacated pixels. This creates the exact
48px passage `[496,544)` before the inn wall. Do not move the inn door, planters, walls or stair.

Keep the
hall door, inn door, house door and survey-tower door clearly readable. Keep the east/west road, central
connector, southern route and four approaches visually open. Do not invent, remove, merge or relocate
material objects outside those two exact repair masks. Removing renderer-owned smoke is a global state change,
not an object deletion. Do not widen or redesign doors in this pass. Preserve the
open-looking west/east/south roads and north stair in this base board; their honest closed treatments are
separate later alpha overlays, not baked into this derivation.

Output one exact 1536×1024 RGB pixel-art image. Three-quarter square-grid projection, native pixel density,
no rescaling. No characters, UI, text, readable signage, selection marks, status symbols, grid, colored
boxes, labels, watermark or transparency.

Avoid black door holes, gray fog, low-contrast wash, cloned vegetation, smeared cobbles, new windows,
changed rooflines, changed routes, merged foreground silhouettes, baked global illumination and any
remaining visible emission.

## Hard evaluation gate

- Exact 1536×1024; no resampling.
- Major observed bboxes IoU ≥0.95; landmark/prop registration drift ≤4px outside the repair masks; inside them only the two exact declared deltas are accepted.
- Four door centerlines and feet drift ≤2px.
- No new/removed apparent exits; route-clearance masks unchanged except the exact tower notch and inn cluster shift.
- The tower approach visibly contains a continuous 52px corridor after the 20px trim.
- The inn courtyard visibly contains a continuous 48px cobbled passage between shifted cluster and wall.
- No visible yellow/orange emission in windows or lamps; no light pools, smoke plume, haze, smoke glow or vignette.
- Material detail and exploration appeal remain target-level; neutral does not mean flat or unfinished.
- Master, this derived board and all QA overlays remain runtime-forbidden.
