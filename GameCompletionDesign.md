# CodeCity Inspector — completion design

Date: 2026-07-14
Product owner and visual acceptance: Lead (`/root`)
Implementation worker: Terra (`/root/terra`)

## Completion decision

The image board remains the exact overview world. The newly remade Asset Forge
set does not replace that composition with a generated tile grid. It supplies
the moving player and seventeen playable inspection sites entered from the
authored world.

The first frame contains the board and minimal HUD only. No passive entrance
markers, player proxy, debug overlay, or Forge asset may alter it. Hover,
selection, and player layers begin only after user interaction.

## Two play scales

### World exploration

- Overview draws the verified 1491 x 1055 board aspect-contained and otherwise
  unchanged.
- The first movement input enters a native 1:1 follow camera.
- The approved `character.player` sheet replaces the temporary lantern proxy.
- Movement interpolates along the authored navigation graph. Direction selects
  the proper sprite column and movement alternates `walk1` / `walk2`; idle uses
  the idle row.
- Only the currently hovered, selected, or nearby entrance may glow. There are
  no permanent facility markers.
- Enter/Space at a nearby entrance, or an explicit site action in the evidence
  drawer, opens its inspection site.

### Inspection sites

- A site is a curated 768 x 512 native canvas (12 x 8 cells at 64 px), shown at
  1:1 or reduced to fit. It is never enlarged.
- Terrain masters render at 64 x 64. Buildings render on their transparent
  256 x 256 masters without stretching. Objects render at 64 x 64 or smaller.
  Characters render from 24 x 40 frames. Effects render from 32 x 32 frames.
- A site is a game state, not an asset gallery: the player walks on a defined
  connected route, encounters role-specific NPCs, sees environment animation,
  and can open the observed/inferred/unknown evidence for that facility.
- Escape/back returns to the same world node and camera state.
- Site data is authored and deterministic. It does not attempt to rebuild the
  board procedurally.

### Visual composition acceptance

The image board is the minimum visual bar for composition as well as for asset
quality. A site fails visual review even when every sprite is individually
approved if the assembled scene reads as a tile test, asset gallery, or empty
field.

- Buildings form a place: their doors meet a visible street, stair, dock, or
  footpath, and contextual buildings overlap the frame edges or neighboring
  depth bands instead of floating as isolated icons.
- Each site has a clear foreground, playable middle ground, and rear boundary.
  At least four authored depth bands must be visible through terrain,
  structures, props, characters, and foreground occlusion.
- No unintentional empty rectangle larger than two by two terrain cells may
  remain. Water, a training floor, a civic plaza, and an intentionally open
  snow court are the only exceptions, and each still needs a readable edge.
- Roads are continuous and visibly reach every interactive entrance. Repeated
  tiles must be broken up by authored turns, edges, props, or irregular
  occlusion; regular rows of identical vegetation are not acceptable.
- Urban sites use connected masonry frontages, elevation changes, street
  furniture, and narrow passages. Harbor sites visibly combine water, quay,
  bridge, cargo, and working characters. Woodland sites use an irregular dense
  tree perimeter, an organic footpath, undergrowth, rocks, and overlapping
  structures. The winter site uses snow for every exposed non-masonry surface
  and gray cobblestone/plaza for its routes; it contains no terrain master with
  a temperate green base, including grass, rock, wall, cliff, or stairs.
- Winter contextual buildings must be selected from the dark slate/blue-roofed
  set so the site reads as the same cold district as the board. Runtime color
  filters and painted procedural substitutes are not allowed.
- Native masters stay unscaled beyond their declared render size. Density is
  achieved by composition and occlusion, never by enlarging a weak asset.
- `field.tree` and `field.rock` are transparent 64 px feature overlays. Their
  ground cells first receive `field.grass`, then the feature master; authored
  rear/front copies may use the bounded 8 px offset grid. An opaque square
  green matte around either feature is an automatic visual failure.

## Seventeen building routes

Four residential routes share the `house` world entrance. Every other route
uses the semantically matching entrance.

| World entrance | Playable site route | Building asset |
| --- | --- | --- |
| town hall | civic hall | `building.town_hall` |
| gate | old-town gate | `building.gate` |
| guild | guild hall | `building.guild` |
| pub | tavern | `building.pub` |
| shop | market shop | `building.shop` |
| inn | travelers' inn | `building.inn` |
| dock | harbor dock | `building.dock` |
| dojo | training yard | `building.dojo` |
| well | well square | `building.well` |
| workshop | artisan workshop | `building.workshop` |
| warehouse | freight warehouse | `building.warehouse` |
| watchtower | snow watch | `building.watchtower` |
| house | small home | `building.house.small` |
| house | larger home | `building.house.medium` |
| house | woodland hut | `building.hut` |
| house | old residence | `building.old_house` |
| ruin | overgrown ruin | `building.ruin` |

The house entrance exposes its four routes as neighboring inspection stops,
not as interchangeable visual variants.

## Character placement

The role name must be legible from silhouette and carried object at native
size. The following is the minimum authored placement:

| Asset | Primary site |
| --- | --- |
| `character.player` | all exploration states |
| `character.innkeeper` | travelers' inn |
| `character.tavern_master` | tavern |
| `character.town_clerk` | civic hall |
| `character.workshop_artisan` | artisan workshop |
| `character.dojo_inspector` | training yard |
| `character.watchtower_guard` | snow watch |
| `character.dock_ferryman` | harbor dock |
| `character.warehouse_keeper` | freight warehouse |
| `character.gatekeeper` | old-town gate |
| `character.mob.townsfolk_male` | guild/market street |
| `character.mob.townsfolk_female` | well square |
| `character.mob.elder` | well square |
| `character.mob.child` | small home |
| `character.mob.traveler` | old residence |
| `character.mob.merchant` | market shop |
| `character.mob.artisan` | woodland hut |
| `character.mob.tavern_guest` | tavern |
| `character.mob.inn_guest` | travelers' inn |
| `character.mob.dock_worker` | harbor dock |
| `character.mob.delivery_person` | freight warehouse |
| `character.guildmaster` | guild hall |

## Environment coverage

Site recipes collectively bind every required field asset:

- masonry: `field.cobblestone`, `field.plaza`, `field.wall.stone`,
  `field.stairs.stone`, `field.cliff`;
- routes: `field.dirt_path`, `field.road.corner`, `field.road.edge`,
  `field.road.intersection`, `field.bridge.stone`, `field.bridge.wood`;
- waterside and winter: `field.water`, `field.river_edge`,
  `field.dock_floor`, `field.snow`;
- vegetation and boundaries: `field.grass`, `field.fence.wood`, `field.rock`,
  `field.tree`.

Site recipes also collectively bind all required object assets:

- freight and street life: `object.barrel`, `object.crate`,
  `object.stacked_crates`, `object.lamp`, `object.streetlight`,
  `object.signboard`, `object.notice_board`, `object.bench`, `object.flowerbed`,
  `object.grass_patch`, `object.well`;
- inspection state: `object.construction_sign`, `object.unverified_tag`,
  `object.warning_stake`, `object.red_flag`, `object.yellow_flag`,
  `object.blue_flag`, `object.rubble`.

`effect.water_ripple` animates only on waterside cells.
`effect.construction_dust` animates only at active repair/ruin cells.

## Manifest and usage contract

- `public/assets/forge/manifest.json` is the only Forge entry point.
- It must contain exactly the 78 Lead-approved required IDs, with
  `complete: true`, no missing assets, and no missing runtime bindings.
- Runtime site data references semantic asset IDs, never hash directories.
- A resolver maps those IDs through the manifest and rejects absent or
  unapproved entries. There is no fallback to the deleted set.
- A static usage audit unions world-player and site-recipe bindings and proves
  exact coverage of all 78 required IDs. Listing an asset in a diagnostic or
  inspector screen does not count as use.

## Evidence behavior

- Repository facts remain observed-only and originate from `/api/town`.
- Site decoration may express the model visually, but it must not invent
  repository facts.
- Facility evidence stays separated into observed, inferred, and unknown.
- A missing facility has no active entrance. Untested is never shown as broken.

## Lead acceptance

Completion requires all of the following:

1. Lead visual approval of native contact sheets for 17 buildings, 19 fields,
   22 characters, 18 objects, and 2 effects.
2. Exactly 78 new approvals and a complete public manifest; zero deleted-set
   bytes, hashes, paths, or fallback code in the shipped runtime.
3. Initial canvas pixels equal the board after normal aspect-fit drawing.
4. World keyboard/click movement, sprite direction, walk frames, facility
   entry, site movement, evidence opening, and return-to-world all work.
5. Every one of the 78 IDs is reached by an actual world or site render path.
6. Asset Forge validation/tests and repository-owned tests are green.
7. Loopback browser play shows overview and multiple sites with zero console
   errors, zero failed asset requests, and no enlargement beyond a master.
8. Lead screenshots pass the visual composition rules above for the civic,
   market, harbor, winter, woodland-home, and woodland-ruin representatives.
