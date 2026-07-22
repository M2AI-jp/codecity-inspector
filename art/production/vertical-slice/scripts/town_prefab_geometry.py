#!/usr/bin/env python3
"""Measured geometry for the target-town-user-direct-v1 (1586x992) prefab
decomposition. This is the single source of truth for every crop box /
alpha-selection polygon used by the extract-target-town-{terrain-plates,
buildings,trees,props}.py scripts, build-target-town-prefab-manifest.py, and
verify-target-town-prefab-reconstruction.py.

Coordinates were read directly off the accepted master
(public/fable5-v2/assets/world/target-town-user-direct-v1.png, SHA-256
39102cba...e212) using a ruler-grid overlay tool, not estimated from memory or
invented. They trace each object's visible silhouette (roofline peaks/eaves,
canopy extent, footprint) at a level of detail appropriate to pixel art: whole
gables and canopy masses, not brick-by-brick or leaf-by-leaf tracing.

Reconstruction correctness does NOT depend on how tightly a given polygon
hugs its object: every crop --terrain plate, building, tree, or prop-- is an
unmodified sub-crop of the very same master PNG, so wherever two crops
overlap they necessarily agree pixel-for-pixel. Precision here is a quality/
reusability property (how cleanly a prefab could be repositioned in a future
scene), not a correctness requirement for reassembling *this* master. See
verify-target-town-prefab-reconstruction.py for the proof this holds.

All coordinates are world pixels in the master's own coordinate space
(origin top-left, x right, y down) -- never legacy 1536x1024 or 24x16
coordinates from earlier (superseded) master boards.
"""

from __future__ import annotations

WORLD_SIZE = (1586, 992)

# --- 1. Terrain plates ------------------------------------------------------
# A clean 4x3 grid tiling the *entire* canvas with zero gaps and zero overlap.
# This is the deepest ("terrain") pass: every prefab above it is drawn on top,
# so full coverage here is what guarantees the reconstructed composite can
# never have a missing/transparent pixel, independent of every other prefab's
# polygon precision.
TERRAIN_GRID_COLS = [0, 397, 793, 1190, 1586]
TERRAIN_GRID_ROWS = [0, 331, 661, 992]


def terrain_plate_boxes() -> list[dict]:
    plates = []
    for row in range(len(TERRAIN_GRID_ROWS) - 1):
        for col in range(len(TERRAIN_GRID_COLS) - 1):
            x0, x1 = TERRAIN_GRID_COLS[col], TERRAIN_GRID_COLS[col + 1]
            y0, y1 = TERRAIN_GRID_ROWS[row], TERRAIN_GRID_ROWS[row + 1]
            plates.append({
                "id": f"ter_plate_r{row}c{col}",
                "box": (x0, y0, x1, y1),
                "row": row,
                "col": col,
                "notes": "opaque base-ground plate; dominant surface noted per-plate below",
            })
    return plates


# Dominant visible surface per plate, purely descriptive (materialProfile hint
# per Fable5PrefabSpec.md S7); does not change extraction, only manifest text.
TERRAIN_PLATE_MATERIAL = {
    "ter_plate_r0c0": "mountain-backdrop+tree-canopy",
    "ter_plate_r0c1": "cobble-plaza+civic-facade-ground",
    "ter_plate_r0c2": "cobble-plaza+tree-canopy",
    "ter_plate_r0c3": "tree-canopy-backdrop",
    "ter_plate_r1c0": "cobble-yard+dirt-fringe",
    "ter_plate_r1c1": "cobble-plaza",
    "ter_plate_r1c2": "cobble-plaza+dirt-path",
    "ter_plate_r1c3": "tree-canopy+cobble-yard",
    "ter_plate_r2c0": "cobble-yard+grass",
    "ter_plate_r2c1": "dirt-path+grass+ruins-ground",
    "ter_plate_r2c2": "dirt-path+grass",
    "ter_plate_r2c3": "cobble-yard+grass",
}

# --- 2. Road segments --------------------------------------------------------
# The visually distinct tan dirt path is additionally catalogued as its own
# "road" layer, drawn immediately above the terrain plates (redundantly
# reproducing the same source pixels -- see module docstring).
ROAD_SEGMENTS = [
    {
        "id": "road_path_plaza_south",
        "box": (598, 456, 802, 862),
        "polygons": [[
            (662, 456), (744, 456), (762, 520), (744, 560), (762, 600),
            (744, 650), (700, 690), (722, 740), (700, 800), (662, 860),
            (610, 860), (632, 800), (610, 740), (632, 690), (600, 650),
            (626, 600), (602, 560), (626, 520), (610, 480),
        ]],
        "notes": "main plaza-to-south winding dirt path",
    },
    {
        "id": "road_path_east_branch",
        "box": (978, 456, 1302, 662),
        "polygons": [[
            (1030, 456), (1122, 456), (1162, 480), (1222, 470), (1282, 456),
            (1302, 456), (1302, 500), (1240, 520), (1180, 540), (1120, 560),
            (1060, 600), (1020, 650), (980, 660), (980, 600), (1010, 550),
            (1040, 510), (1000, 480),
        ]],
        "notes": "east branch path near the south-east housing row",
    },
]

# --- 3. Buildings ------------------------------------------------------------
# Single flattened alpha-cut silhouette per building (roofline + wall mass).
# This is a deliberate scope cut from Fable5PrefabSpec.md S3's full 5-layer
# kit (.base/.roof/.door/.interior/.shadow): that full split is authoring new
# per-part boundaries the flattened master doesn't visually separate, and is
# out of scope for a decomposition-only pass ahead of the (later-phase)
# renderer replacement. Every entry says so explicitly in its "kit" field.
BUILDINGS = [
    {
        "id": "bld_inn_shell",
        "box": (40, 150, 300, 250),
        "polygons": [[
            (45, 158), (100, 150), (150, 90), (165, 90), (230, 150),
            (260, 148), (295, 200), (295, 250), (45, 250),
        ]],
        "landmark": False,
        "kit": "flattened-roof-and-chimney-shell",
        "notes": (
            "Roof + chimney silhouette only. The interior (bar, shelves) and "
            "the entrance foreground are already extracted and lineage-tracked "
            "by extract-target-town-n1.py; this prefab is the missing building "
            "envelope that the existing crops sit inside of."
        ),
    },
    {
        "id": "bld_civic_row_west",
        "box": (438, 0, 596, 300),
        "polygons": [[
            (438, 105), (478, 42), (560, 58), (596, 112), (596, 300), (438, 300),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "Timber-frame gabled house west of the town hall (flower box, banner, bench in front).",
    },
    {
        "id": "bld_town_hall",
        "box": (596, 0, 800, 300),
        "polygons": [[
            (596, 116), (615, 60), (645, 6), (676, 55), (700, 58), (731, 40),
            (766, 55), (800, 96), (800, 300), (596, 300),
        ]],
        "landmark": True,
        "kit": "flattened-silhouette",
        "notes": "Clock tower + main civic facade + entrance door/steps. North-clipped by the canvas edge (matches PrefabSpec town_hall draft note).",
    },
    {
        "id": "bld_civic_row_east",
        "box": (800, 0, 1082, 300),
        "polygons": [[
            (800, 96), (856, 0), (882, 0), (882, 90), (940, 146), (970, 190),
            (1000, 160), (1046, 196), (1082, 206), (1082, 300), (800, 300),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "Connected row of dormered wings east of the town hall, toward the market.",
    },
    {
        "id": "bld_market_shop_a",
        "box": (1148, 150, 1268, 462),
        "polygons": [[
            (1148, 346), (1151, 256), (1180, 150), (1202, 150), (1212, 256),
            (1264, 346), (1264, 462), (1148, 462),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "West twin of the east-market shop pair (striped awning, barrels).",
    },
    {
        "id": "bld_market_shop_b",
        "box": (1348, 150, 1470, 470),
        "polygons": [[
            (1348, 346), (1351, 256), (1380, 150), (1402, 150), (1412, 256),
            (1464, 346), (1464, 470), (1348, 470),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "East twin of the east-market shop pair.",
    },
    {
        "id": "bld_ruins",
        "box": (730, 540, 970, 865),
        "polygons": [[
            (760, 545), (782, 545), (782, 620), (850, 615), (886, 585),
            (902, 620), (952, 660), (966, 700), (966, 782), (932, 862),
            (770, 862), (758, 782), (752, 700), (752, 640), (760, 600),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "Broken timber-frame ivy ruin south of the plaza.",
    },
    {
        "id": "bld_south_west_house",
        "box": (0, 606, 412, 868),
        "polygons": [[
            (0, 700), (20, 690), (60, 640), (150, 615), (190, 655), (230, 630),
            (258, 606), (298, 606), (298, 650), (330, 613), (362, 652),
            (400, 700), (412, 868), (0, 868),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "South-west housing cluster (two conjoined gables + chimney), west of the ruins.",
    },
    {
        "id": "bld_south_center_house",
        "box": (948, 650, 1152, 940),
        "polygons": [[
            (948, 752), (985, 700), (1045, 658), (1102, 700), (1152, 752),
            (1152, 940), (948, 940),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "Single gabled house between the ruins and the south-east row.",
    },
    {
        "id": "bld_south_east_row",
        "box": (1148, 650, 1586, 940),
        "polygons": [[
            (1148, 762), (1170, 700), (1230, 655), (1280, 700), (1312, 668),
            (1362, 650), (1412, 690), (1452, 660), (1502, 690), (1552, 668),
            (1586, 700), (1586, 940), (1148, 940),
        ]],
        "landmark": False,
        "kit": "flattened-silhouette",
        "notes": "South-east housing row, canvas-edge-clipped on the east side.",
    },
]

# --- 4. Trees ----------------------------------------------------------------
# Round/organic canopies are generated as a deterministic ellipse polygon
# inscribed in a measured bounding box (see _town_prefab_common.ellipse_polygon)
# rather than hand-traced leaf clusters -- both are equally "invented" at the
# silhouette-vertex level for foliage; the ellipse is reproducible from three
# numbers instead of dozens of eyeballed points.
TREES = [
    {"id": "tree_backdrop_nw", "box": (0, 0, 300, 175), "ellipse": {"cx": 150, "cy": 60, "rx": 260, "ry": 200},
     "notes": "North-west corner background canopy mass, canvas-edge-clipped."},
    {"id": "tree_backdrop_ne", "box": (1100, 0, 1586, 270), "ellipse": {"cx": 1340, "cy": 80, "rx": 340, "ry": 220},
     "notes": "North-east / east-edge background canopy mass behind the civic row and market."},
    {"id": "tree_center_path", "box": (410, 478, 655, 662), "ellipse": {"cx": 532, "cy": 560, "rx": 118, "ry": 82},
     "notes": "Prominent standalone tree overhanging the south path; occludes the road when reassembled."},
    {"id": "tree_ruins_side", "box": (718, 483, 862, 622), "ellipse": {"cx": 790, "cy": 555, "rx": 68, "ry": 68},
     "notes": "Tree beside/behind the ruins spire."},
    {"id": "tree_gate_left", "box": (0, 468, 112, 660), "ellipse": {"cx": 30, "cy": 560, "rx": 95, "ry": 110},
     "notes": "Trees flanking the south-west gate wall, canvas-edge-clipped on the west side."},
    {"id": "tree_gate_right_cluster", "box": (368, 545, 482, 662), "ellipse": {"cx": 425, "cy": 605, "rx": 58, "ry": 58},
     "notes": "Small cluster east of the gate wall."},
    {"id": "tree_market_gap", "box": (1262, 150, 1362, 352), "ellipse": {"cx": 1312, "cy": 245, "rx": 52, "ry": 100},
     "notes": "Trees filling the gap between the two market shops."},
    {"id": "tree_south_center_left", "box": (878, 598, 972, 702), "ellipse": {"cx": 925, "cy": 650, "rx": 48, "ry": 52},
     "notes": "Tree left of the south-center house."},
    {"id": "tree_bottom_right_cluster", "box": (1148, 845, 1586, 992), "ellipse": {"cx": 1370, "cy": 900, "rx": 250, "ry": 110},
     "notes": "Bottom-edge canopy mass along the south-east row, canvas-edge-clipped."},
    {"id": "tree_sw_yard", "box": (148, 848, 420, 992), "ellipse": {"cx": 285, "cy": 910, "rx": 140, "ry": 85},
     "notes": "Yard trees/bushes south of the south-west house, canvas-edge-clipped."},
]

# --- 5. Props ------------------------------------------------------------
PROPS = [
    {
        "id": "prop_well", "box": (815, 288, 908, 414),
        "polygons": [[(860, 290), (905, 332), (905, 414), (818, 414), (818, 332)]],
        "notes": "Wood-roofed stone well, plaza center-east.",
    },
    {
        "id": "prop_flower_bed", "box": (516, 296, 696, 414),
        "ellipse": {"cx": 606, "cy": 354, "rx": 88, "ry": 56},
        "notes": "Circular raised flower bed, plaza center.",
    },
    {
        "id": "prop_bench_plaza_a", "box": (483, 266, 586, 313),
        "polygons": [[(484, 268), (585, 268), (585, 311), (484, 311)]],
        "notes": "Upper plaza bench near the town hall steps.",
    },
    {
        "id": "prop_bench_plaza_b", "box": (505, 341, 626, 399),
        "polygons": [[(506, 343), (624, 343), (624, 397), (506, 397)]],
        "notes": "Lower plaza bench.",
    },
    {
        "id": "prop_barrels_well", "box": (783, 373, 828, 428),
        "polygons": [[(785, 375), (826, 375), (826, 426), (785, 426)]],
        "notes": "Barrel pair beside the well (west side).",
    },
    {
        "id": "prop_barrels_inn_yard", "box": (55, 435, 144, 500),
        "polygons": [[(57, 455), (90, 437), (120, 440), (142, 455), (142, 498), (57, 498)]],
        "notes": "Fence + barrel cluster in the inn's west yard (outside the existing entrance-foreground crop).",
    },
    {
        "id": "prop_barrels_market_a", "box": (1058, 258, 1102, 332),
        "polygons": [[(1060, 260), (1100, 260), (1100, 330), (1060, 330)]],
        "notes": "Barrels beside market shop A.",
    },
    {
        "id": "prop_barrels_market_b", "box": (1393, 393, 1467, 457),
        "polygons": [[(1395, 395), (1465, 395), (1465, 455), (1395, 455)]],
        "notes": "Barrels in front of market shop B.",
    },
    {
        "id": "prop_streetlamp_plaza_west", "box": (423, 283, 463, 393),
        "polygons": [[(440, 284), (450, 284), (454, 310), (454, 384), (430, 384), (430, 310)]],
        "notes": "Second plaza streetlamp (west side, distinct from the already-extracted route streetlamp).",
    },
    {
        "id": "prop_streetlamp_market_mid", "box": (1288, 393, 1316, 481),
        "polygons": [[(1298, 395), (1308, 395), (1312, 420), (1312, 478), (1292, 478), (1292, 420)]],
        "notes": "Streetlamp between the two market shops.",
    },
]

# --- 6. Foreground occluders --------------------------------------------------
FOREGROUND = [
    {
        "id": "fg_gate_wall_sw", "box": (0, 553, 462, 700),
        "polygons": [[
            (0, 575), (60, 558), (120, 555), (180, 562), (230, 575), (260, 585),
            (300, 568), (340, 562), (400, 566), (462, 560), (462, 700), (0, 700),
        ]],
        "notes": "Low stone wall / archway south of the plaza; foreground occluder for the south-west approach.",
    },
]

# --- 7. Pre-existing prefabs (already extracted by earlier scripts) ----------
# Referenced (not re-extracted) so the manifest is a *complete* parts list.
# Each entry names the lineage file that is authoritative for its hash/crop.
EXISTING_ASSETS = [
    {
        "id": "target-town-inn-bartender-source-visible-v1",
        "path": "public/fable5-v2/assets/objects/target-town-inn/bartender-source-visible-v1.png",
        "lineage": "public/fable5-v2/assets/objects/target-town-inn/target-town-inn-n1.lineage.json",
        "lineageAssetId": "target-town-inn-bartender-source-visible-v1",
        "category": "interior", "layer": "building",
        "extractionScript": "art/production/vertical-slice/scripts/extract-target-town-n1.py",
    },
    {
        "id": "target-town-inn-entrance-foreground-v1",
        "path": "public/fable5-v2/assets/objects/target-town-inn/entrance-foreground-v1.png",
        "lineage": "public/fable5-v2/assets/objects/target-town-inn/target-town-inn-n1.lineage.json",
        "lineageAssetId": "target-town-inn-entrance-foreground-v1",
        "category": "foreground", "layer": "foreground",
        "extractionScript": "art/production/vertical-slice/scripts/extract-target-town-n1.py",
    },
    {
        "id": "target-town-route-streetlamp-foreground-v1",
        "path": "public/fable5-v2/assets/objects/target-town-streetlamp/route-streetlamp-foreground-v1.png",
        "lineage": "public/fable5-v2/assets/objects/target-town-streetlamp/target-town-streetlamp.lineage.json",
        "lineageAssetId": "target-town-route-streetlamp-foreground-v1",
        "category": "prop", "layer": "prop",
        "extractionScript": "art/production/vertical-slice/scripts/extract-target-town-streetlamp.py",
    },
]
