# v1 style authority (non-generative preparation)

This is a preparation record for the 22 owner-provided originals. It is not an
approval record, an asset manifest, a production order, or a claim that any
original can be shipped as-is. The preparation deliberately creates no PNG
candidate.

## Evidence states

### Observed mechanically

- The custody registry contains 22 entries. A read-only custody check at this
  checkpoint returned `ok: true`, `expected: 22`, `checked: 22`, no failures,
  and no unexpected PNG names.
- Every file is an 8-bit RGB, non-interlaced PNG. The dimensions, byte length,
  SHA-256, and count of distinct decoded RGB triples below were measured from
  the exact bytes. The distinct-color count is a measurement of the whole
  sheet, not a claimed production palette.
- The original registry hashes and dimensions are the authoritative custody
  values. The `v1/palette.json` artifact is derived from
  `world_visual_master.png` with a deterministic 48-color median-cut
  quantization (`dither: none`); it does not alter that PNG.

| original | dimensions | distinct RGB triples | bytes | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| character_style_authority_20260722_v1.png | 1402x1122 | 239,530 | 1,967,140 | 446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932 |
| character_style_reference_sheet.png | 1536x1024 | 77,045 | 636,654 | 910e1fdc2773018882e74918d492b77891869720b3affa170fb96ec2ed7db08b |
| world_visual_master.png | 1491x1055 | 342,307 | 3,552,022 | cc2e822092b0a1cff798b540c8898057841def7b4a0d7b6c954da6feb7ae7e5d |
| target-town.png | 1586x992 | 206,254 | 3,200,516 | 39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607 |
| building_inn_sheet.png | 1491x1055 | 247,935 | 2,715,883 | 78b18d8ee84c8bd57444babe6923cdb3b16fcfcf592ebbf3411df74bd16c069a |
| building_town_hall_sheet.png | 1491x1055 | 318,336 | 3,111,910 | af560250efd3d45fb00c7ba4a486e6245db5318c564bc72a8a11ba84bbbfb1c9 |
| building_workshop_sheet.png | 1448x1086 | 259,379 | 3,621,114 | a28070edeec7d93df772ffe856bcaa49a11ba8ec55e60ddd5af15eab56f23ac7 |
| building_warehouse_sheet.png | 1448x1086 | 220,175 | 3,582,929 | 36b9a4f7dc5c9d7693fd1346a559735a36062aadeac8483beb2992e0ca3be4bc |
| building_watchtower_sheet.png | 1491x1055 | 215,812 | 3,084,490 | 414a38a8621c25a0b812426abbc40b46a97444923148b967be8493bc4e2a277a |
| building_guild_variant_01_sheet.png | 1448x1086 | 209,577 | 2,948,967 | e6d0904d6b2ac1af8ebf8d01df1662ccab49489ead967e0e244f4db6135701c9 |
| building_guild_variant_02_sheet.png | 1448x1086 | 213,219 | 2,996,149 | 764747f9059825cde6836c8951946afb459f8eacb3441d6ac58026d76f6d1597 |
| building_guild_variant_03_sheet.png | 1448x1086 | 257,334 | 2,959,477 | ea65fa6023f2fa96c44a22885b1957f94b5fe923b52c3ee0edc6e66fe2b6b71d |
| building_guild_variant_04_sheet.png | 1448x1086 | 185,734 | 2,319,529 | 4e5844615e24eba837e181cce1f23001cc2b7f7ab13fd9cd189b5e6d86f4a6b3 |
| building_houses_shops_ruins_sheet.png | 1536x1024 | 296,588 | 3,334,782 | ec8afeadfe709cc6ae489d3e895a2a290eff79cb598db8c1925f548fd9e14225 |
| field_cobblestone_roads_sheet.png | 1491x1055 | 210,160 | 3,052,531 | f732a849dd88138e3acccc24970bef9e923302fec1aa01ffac195b8195cfff3d |
| field_stairs_bridges_cliffs_sheet.png | 1491x1055 | 269,156 | 3,053,096 | 24e899bfb25552aa96e453a74e574337fc65481791fa572accdd8758615387bd |
| field_harbor_docks_tiles_sheet.png | 1536x1024 | 244,799 | 3,473,534 | 44f07d8922eb87d131645b5f68c8a9f6ee06f0dd78f9e2d59b854a74a0740580 |
| object_street_props_sheet.png | 1536x1024 | 272,577 | 3,412,834 | b8f5879728932dce2b56428b65e4531cc66029f39848d1ef831d402ca17d4d85 |
| object_status_markers_sheet.png | 1491x1055 | 181,732 | 3,118,196 | e3d2f177bf10bc07d1362251d8aa80d490fc6f58999d24b06a66c34a177e1d1b |
| ui_dialogue_frames_sheet.png | 1448x1086 | 150,012 | 2,799,709 | 60a2255fe72e2e96c91f00caa93fa7f4906f57fc1f8f0332bdbe91648b9ba29d |
| ui_guild_roster_sheet.png | 1536x1024 | 174,186 | 2,308,712 | 5104c1dc835712a3d3bd6c50dc89b19f4a9489e27c655f15dd63f3ffdbe9bc99 |
| ui_inspection_report_sheet.png | 1086x1448 | 275,926 | 2,729,158 | c4c14e83e5f4e5fec8f7eaea537e6befa5f2762aaed11d07a5a86c05b6294892 |

The table's `field_harbor_docks_tiles_sheet.png` hash above is intentionally
checked against the custody registry by the gate; the registry remains the
source of truth if this prose ever drifts.

### Visual observations (human/AI inspection, not machine approval)

Representative sheets show a dense top-down/isometric pixel-art town language:
dark stepped outlines, compact tile clusters, timber-and-stone buildings,
stone roads and walls, moss/leaf greens, slate and water blues, and warm amber
windows or lamps. The world master and target-town references show multiple
climate treatments, including a cool snowy area, while retaining the same
high-contrast night-readable silhouette language.

The character references show a compact chibi actor with four facing
directions, idle and walking poses, and gesture frames. The authority sheet's
magenta field and the reference sheet's black field are presentation keys in
the supplied images; they are not automatically promoted to game-background
colors. UI sheets show dark translucent panels, thin gold/cream frames,
dialogue tails, choice markers, roster cards, and an inspection-report layout.

These observations describe visible motifs only. They do not choose a crop,
frame grid, pivot, collision box, animation timing, selector binding, or
approval decision.

### Inferred from filenames and public contracts

- Filename families provide a repeatable *reference association* for the
  selector-demand artifact (for example, `ui:guild-roster` ->
  `ui_guild_roster_sheet.png`). This is a filename-level inference, not proof
  that the sheet contains a complete candidate for that selector.
- The public WorldPlan vocabulary currently exposes finite terrain, road,
  occupancy, facility/room, NPC-role, prop, light, quest-action, and reward
  effect values. The demand tool turns only those exported values into explicit
  selectors. It does not read fixtures or customer repositories.
- The scene compiler still owns the downstream `water:default` selector. The
  demand report records it through one bounded exact public-index literal,
  `selectors.add('water:default')`, bound to the scene-compiler file SHA-256
  and literal SHA-256. This is a source-boundary trace, not a general source
  parser, and it does not prove scene composition.

### Unknown / deliberately unclaimed

- No original is an approved master; no candidate PNG, sidecar, provenance
  record, review gate, or shipping manifest exists in this preparation.
- A reference association does not prove visual completeness, crop quality,
  palette suitability, animation correctness, readable UI, collision/nav
  compatibility, owner approval, package inclusion, browser play, or KGI
  coverage.
- The exact subset of a sheet needed by each selector, the required pivots and
  frame grids, and any selector whose public vocabulary is not yet exported
  remain unknown. The finite demand list is `ready` for P1 preparation only;
  the current P4 reward-transition alignment remains a known integration
  blocker (`repository_inspected` -> `REWARD_TRANSITION_INVALID`). No machine
  may fill those gaps with a wildcard, nearest match, or fallback.
