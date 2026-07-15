# CodeCity Inspector — Reference-First Game Design

Status: implementation baseline (2026-07-14)

## Product decision

The image board is the visual source of truth. The default game must not try to
approximate it by arranging the legacy 16 px Asset Forge tiles. The first
playable vertical slice uses the verified 1491×1055 image board itself as the
world layer, then adds navigation, the player, facility interaction, and the
inspection UI as independent layers.

This is intentional: first make one screen whose composition and art direction
are exactly right; only then decompose that screen into replaceable native game
assets without allowing the result to drift.

## Observed difference from the rejected build

| Dimension | Image-board target | Rejected legacy build |
| --- | --- | --- |
| Composition | One dense, authored town with old city, snow quarter, harbor, and woodland | Uniform procedural grid |
| Architecture | Layered multi-storey roofs, alleys, terraces, waterfronts, courtyards | Repeated 2–4 tile isolated buildings |
| Ground | Irregular cobble, moss, stairs, walls, piers, water edges | Repeating square floor tiles |
| Light | Dark ambient value with warm windows and lamps as focal points | Flat global tint and tiny unrelated markers |
| Population | Small varied figures embedded in the street scene | Repeated oversized character sheets in rows |
| Density | Built environment and set dressing occupy most of the frame | Large exposed ground regions |
| Interface | The town is the screen; information is secondary | Inspector controls competed with the town |
| Asset lineage | One coherent authored visual reference | 78 separately generated assets with no shared non-character style reference |

The old screen can pass data, loading, and reachability tests while still
failing every important visual requirement. Asset count is therefore never a
visual acceptance metric again.

Measured evidence from the rejected path:

- The original 15×15 scene contained 4 buildings, 7 NPCs, and 6 props; 62.7%
  of its terrain was undecorated grass.
- Only 28 of the 78 published assets were selected by that screen.
- The attempted density patch raised the counts but retained the same regular
  grid, legacy art, repeated floor texture, and incompatible category styles.
  More instances of the wrong visual system did not reduce the reference gap.

## World contract

- Native world size: 1491×1055 pixels.
- Initial state: full-world overview, aspect-contained, no crop.
- Districts:
  - `old_town`: dense civic and residential core.
  - `snow_quarter`: cold elevated northeast settlement.
  - `harbor`: southwest waterfront, ship, pier, and warehouses.
  - `woodland`: southeast wooded settlement and industrial edge.
- The source image is drawn without filters, recoloring, pixel enlargement, or
  permanent overlays.
- The legacy Forge manifest is not loaded during initial game startup and no
  legacy sprite is part of the default render path.

## Player and navigation

The board is an authored environment rather than a regular tile map. Movement
therefore follows a connected waypoint graph traced along visible streets,
bridges, stairs, docks, snow paths, and woodland paths.

- At least 35 world-space waypoints connect all four districts.
- Arrow/WASD input chooses the connected waypoint with the strongest positive
  dot product in the requested direction.
- Clicking the world moves to the nearest reachable waypoint.
- The first input switches from overview to player-follow mode.
- Player-follow mode uses a clamped camera and never enlarges the board past
  native 1:1 pixels.
- Escape or the overview control returns to the full-board composition.
- Until a board-matched character sheet is approved, the player is a subtle
  warm lantern halo and foot point. A legacy character sprite is forbidden.

## Repository inspection mapping

The scanned repository remains read-only. `/api/town` supplies the model and
habitability facts, but its procedural tile layout does not determine the visual
world. Present facilities activate fixed anchors on real locations visible in
the board; absent facilities do not receive an interactive marker.

Anchor highlights appear only on hover, selection, or player proximity. The
board must never be covered in permanent rectangles, labels, debug doors, or
facility icons.

Suggested semantic locations:

| Facility | World location |
| --- | --- |
| town hall | central civic building |
| gate | northwest old-town arch |
| inn / pub / guild / shop | northeast old-town market and tavern block |
| dock | southwest harbor pier |
| dojo | southern training yard |
| well | southeast-center stone well |
| workshop / warehouse | eastern industrial block |
| watchtower | snow-quarter tower |
| house | woodland residence |
| ruin | far-southeast overgrown structure |

Selecting an anchor opens the town record drawer. It presents observed,
inferred, and unknown evidence separately. The drawer never changes the world
art and starts closed.

## Render order

1. Reference world image.
2. Selection/proximity halo (only when active).
3. Player layer.
4. Minimal HUD.
5. Optional town record drawer/modal.

If the world image cannot load, the game shows a clear textual fallback. It must
not silently substitute the visually incompatible legacy Asset Forge scene.

## Acceptance gates

- The first frame reproduces the image board exactly apart from aspect-fit
  scaling and the minimal HUD.
- The town occupies at least 85% of the available game stage.
- All four districts are visible in overview.
- All navigation nodes and facility anchors lie inside 1491×1055.
- The waypoint graph is one connected component.
- Every facility kind has an anchor; only present kinds are interactive.
- Keyboard and click movement work; follow camera is clamped; overview restores
  the original composition.
- No `/assets/forge/manifest.json` request occurs during initial startup.
- No legacy tile, building, character, prop, or effect is drawn in the default
  game.
- Repository data remains observed-only, local-only, and read-only.

## Next visual phase (after this baseline passes)

The board may later be decomposed into a background atlas, foreground roofs,
walkable masks, water/light effects, and board-matched character sheets. Each
replacement must be compared against this exact baseline. A replacement is
accepted only if it preserves composition, palette, density, scale, and mood;
technical loading success alone is insufficient.
