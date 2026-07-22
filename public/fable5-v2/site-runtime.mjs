import { PRODUCTION_ASSETS } from './runtime-asset-manifest.mjs';

export { PRODUCTION_ASSETS } from './runtime-asset-manifest.mjs';

export class AssetContractError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'AssetContractError';
    this.issues = Object.freeze([...issues]);
  }
}

// HG-03/A1 (docs/qa/evidence-matrix.md): the runtime must reconstruct the
// town from accepted prefabs + effects only, and must never load the
// master/target/mask PNG directly. target-town-user-direct-v1.png (the
// flattened 1586x992 master) is therefore intentionally absent from this
// contract table -- see WORLD_PREFABS below, which replaces it with the 45
// individually-verified prefab crops from
// public/fable5-v2/assets/prefabs/manifest.json. The master PNG file itself
// still exists on disk (it remains the read-only ground truth the prefabs
// were cut from, and art/production/vertical-slice/scripts/
// verify-target-town-prefab-reconstruction.py still reads it for offline
// proof), it is simply never fetched by the browser runtime anymore.
// The 45 prefab crops that reconstruct the town scene (public/fable5-v2/
// assets/prefabs/manifest.json, HG-03/A1 in docs/qa/evidence-matrix.md).
// Every placement/integrity field below was independently re-derived from
// manifest.json and the PNG files on disk (see
// test/town/world-prefabs-runtime-contract.test.mjs, which re-hashes every
// file and cross-checks those fields against the manifest so this table can
// never silently drift from it). `role` is deliberately separate: it is a
// human-readable runtime explanation, not a manifest field.
//   - id/url/width/height/sha256 come straight from the matching manifest
//     "prefabs[]" record (url = "/" + record.path with the leading "public/"
//     stripped, matching every other PRODUCTION_ASSETS entry's convention).
//   - bytes is each PNG's actual on-disk size (stat), verified against the
//     server's Content-Length the same way test/server.test.mjs already
//     checks every PRODUCTION_ASSETS contract.
//   - x/y is the manifest's cropOriginWorld -- every prefab is an unresampled
//     sub-crop of the master's own pixels (manifest.extraction.resampling ===
//     false), so drawing it unscaled at cropOriginWorld reproduces the
//     master's own pixels exactly; no destination scaling is ever applied.
//   - layer/zIndex are copied verbatim from the manifest record.
//
// Draw order: this array is pre-sorted ascending by (zIndex, id), matching
// manifest.json's own drawOrder.rule prose verbatim -- "terrain plates
// first (zIndex 0) ... then road segments (zIndex 1) ... then every
// building/tree/prop record in ascending zIndex order (zIndex = 100 +
// pivot.y) ... then foreground occluders last (zIndex = 100000 + pivot.y)".
// zIndex's bands (terrain=0 < road=1 < building/prop=[100,99999] <
// foreground=[100000,)) make one flat ascending sort produce exactly that:
// terrain, then road, then building+prop interleaved by y (a real building/
// tree/prop Y-sort, not buildings-as-a-block-then-props-as-a-block), then
// foreground always last. drawWorldPrefabs() below walks this array in order
// and draws each resolved image at its (x, y) -- see
// art/production/vertical-slice/scripts/verify-target-town-prefab-reconstruction.py
// for the independent pixel-diff proof of the complete 48-prefab source
// reconstruction. The three documented dynamic exceptions below retain their
// existing state-specific draw path in app.js.
//
// 3 of the master decomposition's 48 manifest prefabs are deliberately
// absent from this array (they carry "provenance": "pre-existing" in
// manifest.json because an earlier pass already extracted and wired them
// into this same runtime, with mode-conditional/y-sorted draw logic this
// pass must not disturb -- see app.js's drawWorld()):
//   - target-town-route-streetlamp-foreground-v1: already loaded as
//     PRODUCTION_ASSETS.routeStreetlamp (identical url/width/height/sha256)
//     and drawn with its own playerBehindStreetlamp y-sort against the live
//     player sprite, which a flat prefab-array draw cannot express.
//   - target-town-inn-entrance-foreground-v1: already loaded as
//     PRODUCTION_ASSETS.entranceForeground (identical url/width/height/
//     sha256) and drawn only in interior mode, after the live bartender/
//     player, matching the existing cutaway draw order.
//   - target-town-inn-bartender-source-visible-v1 (the master's baked
//     bartender pixels): not loaded at all. Its full footprint
//     (202,255)-(247,310) is always repainted immediately afterward, in
//     both modes, by the existing inn-open/close patch --
//     PRODUCTION_ASSETS.innExteriorClosed at (8,72) sized 397x402 in
//     exterior mode, or PRODUCTION_ASSETS.innCounterClean at (200,255)
//     sized 49x57 (fully containing that footprint) plus the live animated
//     bartender NPC in interior mode -- so drawing this baked crop would be
//     immediately and completely overpainted either way.
export const WORLD_PREFABS = Object.freeze([
  Object.freeze({
    id: 'ter_plate_r0c0',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r0c0.png',
    width: 397,
    height: 331,
    bytes: 257326,
    sha256: '8d3f59ff73efc7a0551fc55fe2ef40e851c635d0d83ca620b172d073652dd516',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 0,
    y: 0
  }),
  Object.freeze({
    id: 'ter_plate_r0c1',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r0c1.png',
    width: 396,
    height: 331,
    bytes: 265704,
    sha256: '5d69c1bc196bc887837a1382146a7eab1c3cc431afaf5c79c1b39c959bd6aae2',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 397,
    y: 0
  }),
  Object.freeze({
    id: 'ter_plate_r0c2',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r0c2.png',
    width: 397,
    height: 331,
    bytes: 263888,
    sha256: '8e3c64299f078e1270d426f20b63d51b26bb6011406dad3ae675dafe4327d33e',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 793,
    y: 0
  }),
  Object.freeze({
    id: 'ter_plate_r0c3',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r0c3.png',
    width: 396,
    height: 331,
    bytes: 245207,
    sha256: '0a3022291887776e12c800970ef5b9e7f363a5acf26dfab9cdbafb926d4971e8',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 1190,
    y: 0
  }),
  Object.freeze({
    id: 'ter_plate_r1c0',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r1c0.png',
    width: 397,
    height: 330,
    bytes: 264495,
    sha256: 'f2c5ff1c322722d204dd1368b97ab99a066ee5c2743cefea41155fc1a1ca23ea',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 0,
    y: 331
  }),
  Object.freeze({
    id: 'ter_plate_r1c1',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r1c1.png',
    width: 396,
    height: 330,
    bytes: 270810,
    sha256: '262d07a7559d69926d3eaa4cc7d8ea0e65570731fb71a998a3ce8d0359f268ad',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 397,
    y: 331
  }),
  Object.freeze({
    id: 'ter_plate_r1c2',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r1c2.png',
    width: 397,
    height: 330,
    bytes: 264292,
    sha256: '935ba93262ab126d1f8a81cc9c6a91fddcaae8cde0e0752ed180759ced4ace13',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 793,
    y: 331
  }),
  Object.freeze({
    id: 'ter_plate_r1c3',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r1c3.png',
    width: 396,
    height: 330,
    bytes: 258610,
    sha256: '4d03b57e67cf03bb664ecaaf3f00e10b5dcdd64a823c9365de801cf3f6e3ebf6',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 1190,
    y: 331
  }),
  Object.freeze({
    id: 'ter_plate_r2c0',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r2c0.png',
    width: 397,
    height: 331,
    bytes: 256910,
    sha256: 'c605b60381b895f1ce0930784e2992b2a71031d2f5a5125bfb7ca89b2cea2be2',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 0,
    y: 661
  }),
  Object.freeze({
    id: 'ter_plate_r2c1',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r2c1.png',
    width: 396,
    height: 331,
    bytes: 259499,
    sha256: '8b99917cc9af2ed4b8a5beb33efdad3956758beb014a2f3fb1bc13e53baa5a1b',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 397,
    y: 661
  }),
  Object.freeze({
    id: 'ter_plate_r2c2',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r2c2.png',
    width: 397,
    height: 331,
    bytes: 260627,
    sha256: '1f3e978402872324181da9849702f3b77083b2526e8afd8ed965886ac27011f5',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 793,
    y: 661
  }),
  Object.freeze({
    id: 'ter_plate_r2c3',
    url: '/fable5-v2/assets/prefabs/terrain/ter_plate_r2c3.png',
    width: 396,
    height: 331,
    bytes: 240883,
    sha256: 'c3be478bfd458bdb511c1615d494abf1269603e5eca09f050afbc6b2fac1ed9e',
    role: 'opaque base-ground plate; dominant surface noted per-plate below',
    layer: 'terrain',
    zIndex: 0,
    x: 1190,
    y: 661
  }),
  Object.freeze({
    id: 'road_path_east_branch',
    url: '/fable5-v2/assets/prefabs/road/road_path_east_branch.png',
    width: 324,
    height: 206,
    bytes: 70666,
    sha256: 'e8174000cd52d8fb31a318274cd6481b85248e5f96c3bf7ddb4593cee600b3dd',
    role: 'east branch path near the south-east housing row',
    layer: 'road',
    zIndex: 1,
    x: 978,
    y: 456
  }),
  Object.freeze({
    id: 'road_path_plaza_south',
    url: '/fable5-v2/assets/prefabs/road/road_path_plaza_south.png',
    width: 204,
    height: 406,
    bytes: 111441,
    sha256: 'fe42040e0b7d4de2b29d260dd301114ec438bad57d7f6aa281127efe3f645a09',
    role: 'main plaza-to-south winding dirt path',
    layer: 'road',
    zIndex: 1,
    x: 598,
    y: 456
  }),
  Object.freeze({
    id: 'tree_backdrop_nw',
    url: '/fable5-v2/assets/prefabs/trees/tree_backdrop_nw.png',
    width: 300,
    height: 175,
    bytes: 119075,
    sha256: 'ff24f9c2bafbb673621ce3923360bab7efc6e6df6b8cf1aaa02ad24e5838af56',
    role: 'North-west corner background canopy mass, canvas-edge-clipped.',
    layer: 'prop',
    zIndex: 275,
    x: 0,
    y: 0
  }),
  Object.freeze({
    id: 'bld_inn_shell',
    url: '/fable5-v2/assets/prefabs/buildings/bld_inn_shell.png',
    width: 260,
    height: 100,
    bytes: 52972,
    sha256: '1a89a2fce478f242e90a3cf27a0969478e89f488a48431c77855bc1d560de9e4',
    role: 'Roof + chimney silhouette only. The interior (bar, shelves) and the entrance foreground are already extracted and lineage-tracked by extract-target-town-n1.py; this prefab is the missing building envelope that the existing crops sit inside of.',
    layer: 'building',
    zIndex: 350,
    x: 40,
    y: 150
  }),
  Object.freeze({
    id: 'tree_backdrop_ne',
    url: '/fable5-v2/assets/prefabs/trees/tree_backdrop_ne.png',
    width: 486,
    height: 270,
    bytes: 273821,
    sha256: '07de0c252ee747c667e8b5373d664878e856f5ed59626c17b15a69ab374e6836',
    role: 'North-east / east-edge background canopy mass behind the civic row and market.',
    layer: 'prop',
    zIndex: 370,
    x: 1100,
    y: 0
  }),
  Object.freeze({
    id: 'bld_civic_row_east',
    url: '/fable5-v2/assets/prefabs/buildings/bld_civic_row_east.png',
    width: 282,
    height: 300,
    bytes: 120489,
    sha256: 'c64ec80c8299afc2bf5aa4741983a685f7db5e4de35b71b6b20691f8b0cc936f',
    role: 'Connected row of dormered wings east of the town hall, toward the market.',
    layer: 'building',
    zIndex: 400,
    x: 800,
    y: 0
  }),
  Object.freeze({
    id: 'bld_civic_row_west',
    url: '/fable5-v2/assets/prefabs/buildings/bld_civic_row_west.png',
    width: 158,
    height: 300,
    bytes: 88392,
    sha256: '7cd55abe53d00a460fb13f0b663b8666eea828f9a22157ba12d087b5afb61934',
    role: 'Timber-frame gabled house west of the town hall (flower box, banner, bench in front).',
    layer: 'building',
    zIndex: 400,
    x: 438,
    y: 0
  }),
  Object.freeze({
    id: 'bld_town_hall',
    url: '/fable5-v2/assets/prefabs/buildings/bld_town_hall.png',
    width: 204,
    height: 300,
    bytes: 119281,
    sha256: '7cce178eaaa0036c3af66cc1045a1b7b2837b94c46248cf59fb2c708b6c295f6',
    role: 'Clock tower + main civic facade + entrance door/steps. North-clipped by the canvas edge (matches PrefabSpec town_hall draft note).',
    layer: 'building',
    zIndex: 400,
    x: 596,
    y: 0
  }),
  Object.freeze({
    id: 'prop_bench_plaza_a',
    url: '/fable5-v2/assets/prefabs/props/prop_bench_plaza_a.png',
    width: 103,
    height: 47,
    bytes: 10743,
    sha256: 'fb28e370293fdcab5baccc74ea55d8e7798600cde2e920b13ce398c93d9a9940',
    role: 'Upper plaza bench near the town hall steps.',
    layer: 'prop',
    zIndex: 412,
    x: 483,
    y: 266
  }),
  Object.freeze({
    id: 'prop_barrels_market_a',
    url: '/fable5-v2/assets/prefabs/props/prop_barrels_market_a.png',
    width: 44,
    height: 74,
    bytes: 7183,
    sha256: '01fd01f97d3c8c48d24cb42103c427505f0d1ea395b5d9fab583cb163694a3aa',
    role: 'Barrels beside market shop A.',
    layer: 'prop',
    zIndex: 431,
    x: 1058,
    y: 258
  }),
  Object.freeze({
    id: 'tree_market_gap',
    url: '/fable5-v2/assets/prefabs/trees/tree_market_gap.png',
    width: 100,
    height: 202,
    bytes: 37023,
    sha256: '46732498a113a115047882549fbeefe78238a74e00d03381ef1b6c75d631277a',
    role: 'Trees filling the gap between the two market shops.',
    layer: 'prop',
    zIndex: 446,
    x: 1262,
    y: 150
  }),
  Object.freeze({
    id: 'prop_streetlamp_plaza_west',
    url: '/fable5-v2/assets/prefabs/props/prop_streetlamp_plaza_west.png',
    width: 40,
    height: 110,
    bytes: 6550,
    sha256: '3afcae7b6e6b23357e22ea494a6a78b7a4fcd3cca902acc524ff44d96033de59',
    role: 'Second plaza streetlamp (west side, distinct from the already-extracted route streetlamp).',
    layer: 'prop',
    zIndex: 485,
    x: 423,
    y: 283
  }),
  Object.freeze({
    id: 'prop_bench_plaza_b',
    url: '/fable5-v2/assets/prefabs/props/prop_bench_plaza_b.png',
    width: 121,
    height: 58,
    bytes: 16437,
    sha256: '27d964f748f7b4c15b6d689f76b7651ab6367ecf498dd4e30a1ae1c50f786314',
    role: 'Lower plaza bench.',
    layer: 'prop',
    zIndex: 498,
    x: 505,
    y: 341
  }),
  Object.freeze({
    id: 'prop_flower_bed',
    url: '/fable5-v2/assets/prefabs/props/prop_flower_bed.png',
    width: 180,
    height: 118,
    bytes: 40257,
    sha256: 'dfb7eaa8f36679f3a0d48f9ec95c22b5591c307581f34163902b0f8607ba22db',
    role: 'Circular raised flower bed, plaza center.',
    layer: 'prop',
    zIndex: 511,
    x: 516,
    y: 296
  }),
  Object.freeze({
    id: 'prop_well',
    url: '/fable5-v2/assets/prefabs/props/prop_well.png',
    width: 93,
    height: 126,
    bytes: 23078,
    sha256: '3a3ca7a0e7438b2d7d69df61702ed82991b731b8bdb5a83e33a55a79c2fb5bb1',
    role: 'Wood-roofed stone well, plaza center-east.',
    layer: 'prop',
    zIndex: 514,
    x: 815,
    y: 288
  }),
  Object.freeze({
    id: 'prop_barrels_well',
    url: '/fable5-v2/assets/prefabs/props/prop_barrels_well.png',
    width: 45,
    height: 55,
    bytes: 5896,
    sha256: 'b538d4f931402040a67ac39efb6ffe19d2c623f01e98431e7f9cbf533e1674a4',
    role: 'Barrel pair beside the well (west side).',
    layer: 'prop',
    zIndex: 527,
    x: 783,
    y: 373
  }),
  Object.freeze({
    id: 'prop_barrels_market_b',
    url: '/fable5-v2/assets/prefabs/props/prop_barrels_market_b.png',
    width: 74,
    height: 64,
    bytes: 10694,
    sha256: 'c925471a63ad7db151143ea3bd94fa0ea322bc166382e8648c72b6814b0f6640',
    role: 'Barrels in front of market shop B.',
    layer: 'prop',
    zIndex: 556,
    x: 1393,
    y: 393
  }),
  Object.freeze({
    id: 'bld_market_shop_a',
    url: '/fable5-v2/assets/prefabs/buildings/bld_market_shop_a.png',
    width: 120,
    height: 312,
    bytes: 62050,
    sha256: '8cc693f1b908acf529217a05519a450249afda3cf3e3b8afb3d7df3e02acb56c',
    role: 'West twin of the east-market shop pair (striped awning, barrels).',
    layer: 'building',
    zIndex: 562,
    x: 1148,
    y: 150
  }),
  Object.freeze({
    id: 'bld_market_shop_b',
    url: '/fable5-v2/assets/prefabs/buildings/bld_market_shop_b.png',
    width: 122,
    height: 320,
    bytes: 64755,
    sha256: 'eaef315e1338740c8cb1cc38456f852ae9c65337e0f5e2f16956a683ce6a8981',
    role: 'East twin of the east-market shop pair.',
    layer: 'building',
    zIndex: 570,
    x: 1348,
    y: 150
  }),
  Object.freeze({
    id: 'prop_streetlamp_market_mid',
    url: '/fable5-v2/assets/prefabs/props/prop_streetlamp_market_mid.png',
    width: 28,
    height: 88,
    bytes: 4176,
    sha256: 'd1a46260c3566be0809131ac6112022ec5f5864960cab949ccd56cc46a09ca02',
    role: 'Streetlamp between the two market shops.',
    layer: 'prop',
    zIndex: 579,
    x: 1288,
    y: 393
  }),
  Object.freeze({
    id: 'prop_barrels_inn_yard',
    url: '/fable5-v2/assets/prefabs/props/prop_barrels_inn_yard.png',
    width: 89,
    height: 65,
    bytes: 11927,
    sha256: 'dbb9b29d5675fd3c19b1eb50b222e5b40dab88d62ab9afef9a004bbc9e3a8c4a',
    role: 'Fence + barrel cluster in the inn\'s west yard (outside the existing entrance-foreground crop).',
    layer: 'prop',
    zIndex: 599,
    x: 55,
    y: 435
  }),
  Object.freeze({
    id: 'tree_ruins_side',
    url: '/fable5-v2/assets/prefabs/trees/tree_ruins_side.png',
    width: 144,
    height: 139,
    bytes: 35849,
    sha256: '8b59567d9068516da464245de03442b03775af59cc1b1b04c3a6e7278dd98600',
    role: 'Tree beside/behind the ruins spire.',
    layer: 'prop',
    zIndex: 722,
    x: 718,
    y: 483
  }),
  Object.freeze({
    id: 'tree_center_path',
    url: '/fable5-v2/assets/prefabs/trees/tree_center_path.png',
    width: 245,
    height: 184,
    bytes: 73480,
    sha256: '22554122e8128115100b1f3cea9c5b1d74a97cff0fb699f6ac576a5ce405ede5',
    role: 'Prominent standalone tree overhanging the south path; occludes the road when reassembled.',
    layer: 'prop',
    zIndex: 743,
    x: 410,
    y: 478
  }),
  Object.freeze({
    id: 'tree_gate_left',
    url: '/fable5-v2/assets/prefabs/trees/tree_gate_left.png',
    width: 112,
    height: 192,
    bytes: 46677,
    sha256: '8a2b91bfe856cc2b7785dac72ea13664f7aaacc55eb4a5e473db24152c8f8579',
    role: 'Trees flanking the south-west gate wall, canvas-edge-clipped on the west side.',
    layer: 'prop',
    zIndex: 760,
    x: 0,
    y: 468
  }),
  Object.freeze({
    id: 'tree_gate_right_cluster',
    url: '/fable5-v2/assets/prefabs/trees/tree_gate_right_cluster.png',
    width: 114,
    height: 117,
    bytes: 24643,
    sha256: '24695e030c8872e90e839246cbecb81d983247590e06f1de83fda4cac46c83ec',
    role: 'Small cluster east of the gate wall.',
    layer: 'prop',
    zIndex: 762,
    x: 368,
    y: 545
  }),
  Object.freeze({
    id: 'tree_south_center_left',
    url: '/fable5-v2/assets/prefabs/trees/tree_south_center_left.png',
    width: 94,
    height: 104,
    bytes: 18656,
    sha256: '96adad65e5b41053ceca584422cc8a6b8cf809cae238017eb4cfb9e0f3d0d4f5',
    role: 'Tree left of the south-center house.',
    layer: 'prop',
    zIndex: 802,
    x: 878,
    y: 598
  }),
  Object.freeze({
    id: 'bld_ruins',
    url: '/fable5-v2/assets/prefabs/buildings/bld_ruins.png',
    width: 240,
    height: 325,
    bytes: 119889,
    sha256: '9e5aec96464be65cc47cc79fee3b267cab2f99657412c22c894cff2a371f7b15',
    role: 'Broken timber-frame ivy ruin south of the plaza.',
    layer: 'building',
    zIndex: 963,
    x: 730,
    y: 540
  }),
  Object.freeze({
    id: 'bld_south_west_house',
    url: '/fable5-v2/assets/prefabs/buildings/bld_south_west_house.png',
    width: 412,
    height: 262,
    bytes: 207477,
    sha256: 'd7abc378ebad4e5f570515b66b3c474a6f45449fa0a7aa4d79f67eb7ccfdfac5',
    role: 'South-west housing cluster (two conjoined gables + chimney), west of the ruins.',
    layer: 'building',
    zIndex: 968,
    x: 0,
    y: 606
  }),
  Object.freeze({
    id: 'bld_south_center_house',
    url: '/fable5-v2/assets/prefabs/buildings/bld_south_center_house.png',
    width: 204,
    height: 290,
    bytes: 113679,
    sha256: '8728be3e2783fe4c6c12358647e8e789890ff9306ab26429c70c7299d7337f09',
    role: 'Single gabled house between the ruins and the south-east row.',
    layer: 'building',
    zIndex: 1040,
    x: 948,
    y: 650
  }),
  Object.freeze({
    id: 'bld_south_east_row',
    url: '/fable5-v2/assets/prefabs/buildings/bld_south_east_row.png',
    width: 438,
    height: 290,
    bytes: 238684,
    sha256: 'cd037fa55b8736a1bd3a8f1e0907afde03d4cdd1522ff1195330fd7336083b27',
    role: 'South-east housing row, canvas-edge-clipped on the east side.',
    layer: 'building',
    zIndex: 1040,
    x: 1148,
    y: 650
  }),
  Object.freeze({
    id: 'tree_bottom_right_cluster',
    url: '/fable5-v2/assets/prefabs/trees/tree_bottom_right_cluster.png',
    width: 438,
    height: 147,
    bytes: 128508,
    sha256: '0f675a2afa08a54fbd0a26dd90b3d89b37429c1c3b39ba088b3302103ff72f68',
    role: 'Bottom-edge canopy mass along the south-east row, canvas-edge-clipped.',
    layer: 'prop',
    zIndex: 1092,
    x: 1148,
    y: 845
  }),
  Object.freeze({
    id: 'tree_sw_yard',
    url: '/fable5-v2/assets/prefabs/trees/tree_sw_yard.png',
    width: 272,
    height: 144,
    bytes: 77571,
    sha256: 'b2d2abcef19a0dd93a10f231293158fc94fa88ed15ee46f2f6df07fb1bfc8297',
    role: 'Yard trees/bushes south of the south-west house, canvas-edge-clipped.',
    layer: 'prop',
    zIndex: 1092,
    x: 148,
    y: 848
  }),
  Object.freeze({
    id: 'fg_gate_wall_sw',
    url: '/fable5-v2/assets/prefabs/foreground/fg_gate_wall_sw.png',
    width: 462,
    height: 147,
    bytes: 139249,
    sha256: '92fd04c5db656a7ecd9a2927e7950fbbbdc40a11d11fe80f51083facd6c44e5f',
    role: 'Low stone wall / archway south of the plaza; foreground occluder for the south-west approach.',
    layer: 'foreground',
    zIndex: 100700,
    x: 0,
    y: 553
  })
]);

export const DIALOGUE_CROPS = Object.freeze({
  frame: Object.freeze({
    x: 497,
    y: 47,
    width: 370,
    height: 180,
    safeInsets: Object.freeze({ left: 24, top: 22, right: 24, bottom: 40 })
  }),
  speechBubble: Object.freeze({
    x: 15,
    y: 600,
    width: 202,
    height: 124,
    safeInsets: Object.freeze({ left: 20, top: 18, right: 20, bottom: 36 })
  }),
  choicePointer: Object.freeze({ x: 29, y: 542, width: 32, height: 24 }),
  continueMarker: Object.freeze({ x: 449, y: 549, width: 24, height: 13 })
});

function decodeImage(contract, sourceUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback(value);
    };
    const timer = window.setTimeout(() => {
      finish(reject, new AssetContractError(
        `${contract.id} の読み込みが時間内に完了しませんでした。`,
        [`${contract.url} — expected ${contract.width}×${contract.height}`]
      ));
    }, timeoutMs);
    image.onload = () => {
      if (image.naturalWidth !== contract.width || image.naturalHeight !== contract.height) {
        finish(reject, new AssetContractError(
          `${contract.id} の寸法がasset contractと一致しません。`,
          [`${contract.url}: actual ${image.naturalWidth}×${image.naturalHeight}, expected ${contract.width}×${contract.height}`]
        ));
        return;
      }
      finish(resolve, image);
    };
    image.onerror = () => finish(reject, new AssetContractError(
      `${contract.id} を読み込めませんでした。代替画像では続行しません。`,
      [`missing or unreadable: ${contract.url}`, `${contract.role}; ${contract.width}×${contract.height}`]
    ));
    image.decoding = 'async';
    image.src = sourceUrl;
  });
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifiedImagePromise(contract, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AssetContractError('画像照合の制限時間が不正です。', [`timeoutMs: ${timeoutMs}`]);
  }
  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(contract.url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new AssetContractError(`${contract.id} を読み込めませんでした。`, [
        `${contract.url}: HTTP ${response.status}`
      ]);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(contentLength) || contentLength !== contract.bytes) {
      throw new AssetContractError(`${contract.id} の容量が承認済み画像と一致しません。`, [
        `${contract.url}: actual Content-Length ${response.headers.get('content-length') ?? 'missing'}`,
        `expected bytes ${contract.bytes}`
      ]);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== contract.bytes) {
      throw new AssetContractError(`${contract.id} の実データ容量が一致しません。`, [
        `${contract.url}: actual bytes ${bytes.byteLength}, expected ${contract.bytes}`
      ]);
    }
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== contract.sha256) {
      throw new AssetContractError(`${contract.id} の内容が承認済み画像と一致しません。`, [
        `${contract.url}: actual SHA-256 ${actualSha256}`,
        `expected SHA-256 ${contract.sha256}`
      ]);
    }
    const objectUrl = URL.createObjectURL(new Blob(
      [bytes],
      { type: response.headers.get('content-type') ?? 'image/png' }
    ));
    try {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new AssetContractError(`${contract.id} の照合が時間内に完了しませんでした。`, [contract.url]);
      }
      return await decodeImage(contract, objectUrl, remainingMs);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    if (error instanceof AssetContractError) throw error;
    throw new AssetContractError(`${contract.id} の照合に失敗しました。`, [
      `${contract.url}: ${error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error)}`
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loadProductionAssets({ timeoutMs = 15000 } = {}) {
  // Treat the manifest-driven world prefabs exactly like every other
  // production image: fetch the bytes, require the declared Content-Length,
  // hash them, and decode at their declared native dimensions before a frame
  // can render. The special inn/lamp prefabs intentionally remain in
  // PRODUCTION_ASSETS because app.js gives them state- and actor-dependent
  // draw order; WORLD_PREFABS contains only the 45 static scene layers.
  const productionEntries = Object.entries(PRODUCTION_ASSETS);
  const prefabEntries = WORLD_PREFABS.map((contract) => [contract.id, contract]);
  const entries = [...productionEntries, ...prefabEntries];
  const settled = await Promise.allSettled(entries.map(([, contract]) => verifiedImagePromise(contract, timeoutMs)));
  const failures = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    const contract = entries[index][1];
    const details = Array.isArray(result.reason?.issues) ? result.reason.issues : [String(result.reason?.message ?? result.reason)];
    return [`${contract.id}: ${details.join(' / ')}`];
  });
  if (failures.length > 0) {
    throw new AssetContractError('production画像アセットが揃っていないため、ゲームを開始できません。', failures);
  }
  const productionAssets = Object.fromEntries(
    productionEntries.map(([key], index) => [key, settled[index].value])
  );
  // Key decoded images by immutable prefab ID while leaving draw order in
  // WORLD_PREFABS. This avoids duplicating order or coordinates in a second
  // runtime collection that could drift or be reordered.
  const worldPrefabs = Object.freeze(Object.fromEntries(
    WORLD_PREFABS.map((contract, index) => [
      contract.id,
      settled[productionEntries.length + index].value
    ])
  ));
  return Object.freeze({ ...productionAssets, worldPrefabs });
}

// Native-coordinate prefab rendering is deliberately the only world draw
// primitive exported by this module. Keeping both the asset bytes and their
// crop origins in one verified record prevents a hidden whole-scene fallback
// or a scaled composite from creeping back into the runtime.
export function drawWorldPrefabs(context, prefabImages) {
  for (const prefab of WORLD_PREFABS) {
    context.drawImage(prefabImages[prefab.id], prefab.x, prefab.y);
  }
}

export function drawCharacterFrame(context, image, frame, foot, { alpha = 1 } = {}) {
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(
    image,
    frame.sx,
    frame.sy,
    frame.sw,
    frame.sh,
    Math.round(foot.x - 32 + (frame.offsetX ?? 0)),
    Math.round(foot.y - 120 + (frame.offsetY ?? 0)),
    64,
    128
  );
  context.restore();
}

// Crops are always drawn at their native source dimensions. Supplying a
// destination size is intentionally unsupported so gold borders cannot stretch.
export function drawNativeCrop(context, image, crop, destinationX, destinationY) {
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    Math.round(destinationX),
    Math.round(destinationY),
    crop.width,
    crop.height
  );
}
