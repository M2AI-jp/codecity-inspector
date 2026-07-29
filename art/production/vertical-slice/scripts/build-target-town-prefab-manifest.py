#!/usr/bin/env python3
"""Assemble public/fable5-v2/assets/prefabs/manifest.json and the matching
town-master-decomposition.lineage.json from the PNG files the four
extract-target-town-{terrain-plates,buildings,trees,props}.py scripts wrote,
plus the three already-extracted inn/streetlamp prefabs from earlier work.

This is the single place that hashes/measures finished bytes: it re-opens
every PNG from disk (never trusts an in-memory image from another process)
and re-derives crop origin, pivot, and z-index purely from
town_prefab_geometry.py + the file's own alpha channel. If an extraction
script has not been run yet, this script fails loudly (missing file) rather
than silently skipping an asset.

Run order: extract-target-town-terrain-plates.py, extract-target-town-buildings.py,
extract-target-town-trees.py, extract-target-town-props.py, then this script,
then verify-target-town-prefab-reconstruction.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

import town_prefab_geometry as geo
from _town_prefab_common import (
    PREFAB_ROOT,
    REPO,
    SOURCE_SHA256,
    SOURCE_SIZE,
    alpha_bbox_world,
    alpha_metrics,
    digest,
    read_json,
    relative,
    validate_exact_source,
    write_json,
)

MANIFEST_PATH = PREFAB_ROOT / "manifest.json"
LINEAGE_PATH = PREFAB_ROOT / "town-master-decomposition.lineage.json"

LAYERS = ("terrain", "road", "building", "prop", "foreground")

EXTRACTION_SCRIPTS = [
    "art/production/vertical-slice/scripts/extract-target-town-terrain-plates.py",
    "art/production/vertical-slice/scripts/extract-target-town-buildings.py",
    "art/production/vertical-slice/scripts/extract-target-town-trees.py",
    "art/production/vertical-slice/scripts/extract-target-town-props.py",
]

# inn-counter-clean-plate-v1.png is deliberately excluded: per its own lineage
# it is a hidden-background *repair* plate ("removes the baked source
# bartender before the runtime NPC is drawn", site-runtime.mjs) representing
# an alternate/clean state, not a piece of the master's actually-baked
# content. Compositing it in would make the reconstruction diverge from the
# accepted master, not match it.
EXCLUDED_ASSETS = [
    {
        "path": "public/fable5-v2/assets/objects/target-town-inn/inn-counter-clean-plate-v1.png",
        "reason": (
            "Alternate-state hidden-background repair plate (removes the baked bartender for "
            "runtime NPC animation); compositing it would not reproduce the accepted master's "
            "baked bartender pixels, so it is out of scope for a same-state master decomposition."
        ),
    },
]


def terrain_record(plate: dict) -> dict:
    box = plate["box"]
    path = PREFAB_ROOT / "terrain" / f"{plate['id']}.png"
    if not path.exists():
        raise RuntimeError(f"Missing terrain plate (run extract-target-town-terrain-plates.py first): {relative(path)}")
    with Image.open(path) as image:
        dimensions = {"width": image.width, "height": image.height}
        if image.size != (box[2] - box[0], box[3] - box[1]):
            raise RuntimeError(f"Terrain plate size mismatch: {relative(path)}")
    return {
        "assetId": plate["id"],
        "category": "terrain",
        "layer": "terrain",
        "path": relative(path),
        "sha256": digest(path),
        "dimensions": dimensions,
        "cropOriginWorld": {"x": box[0], "y": box[1]},
        "cropBoxWorld": {"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
        "alpha": False,
        "pivot": {"x": box[0], "y": box[1], "anchor": "full-cell-top-left"},
        "zIndex": 0,
        "gridRow": plate["row"],
        "gridCol": plate["col"],
        "materialProfile": geo.TERRAIN_PLATE_MATERIAL.get(plate["id"], "mixed"),
        "provenance": "this-manifest",
        "extractionScript": EXTRACTION_SCRIPTS[0],
        "notes": plate["notes"],
    }


def alpha_record(entry: dict, directory: str, category: str, layer: str, script: str, extra: dict | None = None) -> dict:
    box = entry["box"]
    path = PREFAB_ROOT / directory / f"{entry['id']}.png"
    if not path.exists():
        raise RuntimeError(f"Missing prefab (run {script} first): {relative(path)}")
    with Image.open(path) as raw:
        image = raw.convert("RGBA")
        dimensions = {"width": image.width, "height": image.height}
        if image.size != (box[2] - box[0], box[3] - box[1]):
            raise RuntimeError(f"Prefab size mismatch: {relative(path)}")
        metrics = alpha_metrics(image)
        bbox_world = alpha_bbox_world(image, (box[0], box[1]))

    if bbox_world is None:
        raise RuntimeError(f"Prefab has no opaque pixels at all (empty mask): {relative(path)}")

    if layer == "building":
        pivot = {"x": bbox_world[0], "y": bbox_world[3], "anchor": "sw-corner"}
    else:
        pivot = {"x": round((bbox_world[0] + bbox_world[2]) / 2), "y": bbox_world[3], "anchor": "bottom-center"}

    if layer == "foreground":
        z_index = 100_000 + pivot["y"]
    elif layer == "road":
        z_index = 1
    else:
        z_index = 100 + pivot["y"]

    record = {
        "assetId": entry["id"],
        "category": category,
        "layer": layer,
        "path": relative(path),
        "sha256": digest(path),
        "dimensions": dimensions,
        "cropOriginWorld": {"x": box[0], "y": box[1]},
        "cropBoxWorld": {"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
        "alpha": True,
        "alphaBboxWorld": {"x": bbox_world[0], "y": bbox_world[1], "width": bbox_world[2] - bbox_world[0], "height": bbox_world[3] - bbox_world[1]},
        "pivot": pivot,
        "zIndex": z_index,
        "provenance": "this-manifest",
        "extractionScript": script,
        "notes": entry["notes"],
        **metrics,
    }
    if extra:
        record.update(extra)
    return record


def existing_asset_record(entry: dict) -> dict:
    lineage_path = REPO / entry["lineage"]
    lineage = read_json(lineage_path)
    asset = None
    if "assets" in lineage:
        asset = next((a for a in lineage["assets"] if a["assetId"] == entry["lineageAssetId"]), None)
    if asset is None and lineage.get("assetId") == entry["lineageAssetId"]:
        asset = lineage.get("runtimeObject", lineage)
    if asset is None:
        raise RuntimeError(f"Could not find {entry['lineageAssetId']} inside {relative(lineage_path)}")

    path = REPO / entry["path"]
    if not path.exists():
        raise RuntimeError(f"Missing pre-existing prefab referenced by lineage: {relative(path)}")
    on_disk_sha256 = digest(path)
    if on_disk_sha256 != asset["sha256"]:
        raise RuntimeError(
            f"Pre-existing prefab {relative(path)} sha256 {on_disk_sha256} no longer matches "
            f"its lineage record {asset['sha256']} in {relative(lineage_path)}"
        )

    crop_origin = asset.get("cropOriginWorld") or {"x": 0, "y": 0}
    dimensions = asset["dimensions"]
    box = (crop_origin["x"], crop_origin["y"], crop_origin["x"] + dimensions["width"], crop_origin["y"] + dimensions["height"])

    foot = asset.get("doorFootWorld") or asset.get("physicalFootWorld") or asset.get("visibleLowerBoundWorld")
    if entry["layer"] == "building":
        pivot = {"x": box[0], "y": box[3], "anchor": "sw-corner"}
    elif foot is not None:
        pivot = {"x": foot["x"], "y": foot["y"], "anchor": "documented-foot-point"}
    else:
        pivot = {"x": round((box[0] + box[2]) / 2), "y": box[3], "anchor": "bottom-center"}

    z_index = (100_000 + pivot["y"]) if entry["layer"] == "foreground" else (100 + pivot["y"])

    return {
        "assetId": entry["id"],
        "category": entry["category"],
        "layer": entry["layer"],
        "path": entry["path"],
        "sha256": on_disk_sha256,
        "dimensions": dimensions,
        "cropOriginWorld": crop_origin,
        "cropBoxWorld": {"x": box[0], "y": box[1], "width": box[2] - box[0], "height": box[3] - box[1]},
        "alpha": True,
        "pivot": pivot,
        "zIndex": z_index,
        "provenance": "pre-existing",
        "extractionScript": entry["extractionScript"],
        "lineagePath": entry["lineage"],
        "notes": f"Already extracted and lineage-tracked prior to this decomposition pass ({entry['lineageAssetId']}).",
    }


def build_prefabs() -> list[dict]:
    prefabs: list[dict] = []
    for plate in geo.terrain_plate_boxes():
        prefabs.append(terrain_record(plate))
    for segment in geo.ROAD_SEGMENTS:
        prefabs.append(alpha_record(segment, "road", "road", "road", EXTRACTION_SCRIPTS[0]))
    for building in geo.BUILDINGS:
        prefabs.append(alpha_record(
            building, "buildings", "building", "building", EXTRACTION_SCRIPTS[1],
            extra={"landmark": building["landmark"], "kit": building["kit"]},
        ))
    for tree in geo.TREES:
        prefabs.append(alpha_record(tree, "trees", "tree", "prop", EXTRACTION_SCRIPTS[2]))
    for prop in geo.PROPS:
        prefabs.append(alpha_record(prop, "props", "prop", "prop", EXTRACTION_SCRIPTS[3]))
    for fg in geo.FOREGROUND:
        prefabs.append(alpha_record(fg, "foreground", "foreground", "foreground", EXTRACTION_SCRIPTS[3]))
    for existing in geo.EXISTING_ASSETS:
        prefabs.append(existing_asset_record(existing))
    return prefabs


def main() -> None:
    validate_exact_source()
    prefabs = build_prefabs()
    prefabs.sort(key=lambda record: (LAYERS.index(record["layer"]), record["zIndex"], record["assetId"]))

    by_layer: dict[str, int] = {layer: 0 for layer in LAYERS}
    for record in prefabs:
        by_layer[record["layer"]] += 1

    script_hashes = {relative(REPO / script): digest(REPO / script) for script in EXTRACTION_SCRIPTS}
    script_hashes[relative(Path(__file__).resolve())] = digest(Path(__file__).resolve())

    manifest = {
        "schemaVersion": 1,
        "manifestId": "target-town-master-prefab-decomposition-v1",
        "status": "extracted-reconstruction-verification-pending",
        "purpose": (
            "HG-03/A1 remediation (docs/qa/evidence-matrix.md): catalogue every visible element of the "
            "accepted target-town master as a source/crop/pivot/layer/sha256-tracked prefab so a future "
            "renderer pass can reconstruct the scene from prefabs+effects only, never by loading the "
            "master/target/mask PNG directly. This manifest is decomposition-only: public/fable5-v2/app.js, "
            "world-runtime.mjs, site-runtime.mjs, index.html, and styles.css are unmodified by this pass; "
            "runtime rewiring is a later phase."
        ),
        "source": {
            "ledgerSourceId": "user_target_town_current",
            "path": "public/fable5-v2/assets/world/target-town-user-direct-v1.png",
            "canonicalPath": "art/references/user-provided/target-town.png",
            "activeAlias": "art/references/target-town.png",
            "sha256": SOURCE_SHA256,
            "dimensions": {"width": SOURCE_SIZE[0], "height": SOURCE_SIZE[1]},
            "custody": "user-direct",
        },
        "layers": list(LAYERS),
        "drawOrder": {
            "sequence": ["terrain", "road", "building+prop (ascending zIndex)", "foreground"],
            "rule": (
                "Composite terrain plates first (zIndex 0, full canvas coverage), then road segments "
                "(zIndex 1), then every building/tree/prop record in ascending zIndex order (zIndex = "
                "100 + pivot.y, i.e. PlacementGuide's world-pass y-sort by foot anchor -- an object with a "
                "greater pivot.y draws after, and therefore visually in front of, one with a smaller "
                "pivot.y), then foreground occluders last (zIndex = 100000 + pivot.y, always after "
                "everything else, matching the existing runtime's bartender/player/entrance-foreground "
                "draw order)."
            ),
        },
        "coverageProof": {
            "terrainGridCols": geo.TERRAIN_GRID_COLS,
            "terrainGridRows": geo.TERRAIN_GRID_ROWS,
            "claim": (
                "The terrain grid alone tiles the full 1586x992 canvas with zero gaps and zero overlaps "
                "(consecutive edges are shared, first edge is 0, last edge is the canvas width/height). "
                "Every other prefab is an additional, possibly-overlapping, unmodified sub-crop of the same "
                "source pixels layered on top, so reconstruction fidelity does not depend on any alpha "
                "mask's silhouette precision -- see verify-target-town-prefab-reconstruction.py."
            ),
        },
        "extraction": {
            "scripts": script_hashes,
            "generatedPixels": False,
            "resampling": False,
            "colorTransform": False,
            "hiddenBackgroundReconstruction": False,
            "buildingKitScope": (
                "Each building is a single flattened alpha-cut silhouette (roofline + wall mass), not the "
                "full 5-layer .base/.roof/.door/.interior/.shadow kit from Fable5PrefabSpec.md S3. Splitting "
                "into that full kit would author new part boundaries the flattened master does not visually "
                "separate; it is deliberately out of scope for this decomposition-only pass. Every building "
                "record's \"kit\" field says \"flattened-silhouette\" or \"flattened-roof-and-chimney-shell\"."
            ),
        },
        "prefabCounts": by_layer,
        "prefabCountTotal": len(prefabs),
        "excludedAssets": EXCLUDED_ASSETS,
        "prefabs": prefabs,
    }

    write_json(MANIFEST_PATH, manifest)
    print(f"wrote {relative(MANIFEST_PATH)} ({len(prefabs)} prefabs: {by_layer})")

    lineage = {
        "schemaVersion": 1,
        "assetSetId": "target-town-master-prefab-decomposition-v1",
        "status": "extracted-reconstruction-verification-pending",
        "manifestPath": relative(MANIFEST_PATH),
        "source": manifest["source"],
        "extraction": {
            "scripts": list(script_hashes.keys()),
            "method": "exact-source-rgb-copy-under-binary-alpha-mask-or-opaque-grid-crop",
            "generatedPixels": False,
            "resampling": False,
            "colorTransform": False,
            "hiddenBackgroundReconstruction": False,
        },
        "assetIds": [record["assetId"] for record in prefabs],
        "observed": [
            "target-town-user-direct-v1.png bakes every visible building, tree, prop, and terrain feature "
            "into one flattened 1586x992 RGB image; there is no separate background/foreground layer data.",
            "The terrain grid (4 cols x 3 rows, town_prefab_geometry.TERRAIN_GRID_COLS/_ROWS) tiles the full "
            "canvas with shared edges (0..1586 horizontally, 0..992 vertically), verified by "
            "extract-target-town-terrain-plates.py's assertions before any file is written.",
            "Three prefabs (bartender, entrance foreground, route streetlamp) were already extracted and "
            "lineage-tracked by earlier scripts (extract-target-town-n1.py, extract-target-town-streetlamp.py); "
            "this pass reuses them by reference (provenance=pre-existing) instead of re-deriving them.",
        ],
        "inferred": [
            "Building alpha masks are hand-measured polygons tracing each roofline/wall mass at a level of "
            "detail appropriate to pixel art (whole gables and eaves, not brick-by-brick); tree/well/flower-bed "
            "masks are deterministic ellipse polygons inscribed in a measured bounding box, not hand-traced "
            "leaf clusters.",
            "zIndex assignments encode PlacementGuide S2.1's world-pass y-sort rule (ascending pivot.y) plus "
            "a fixed foreground-always-last rule; they have not been rendered through the live runtime, only "
            "proven correct against the static master in verify-target-town-prefab-reconstruction.py.",
        ],
        "unknown": [
            "Whether every alpha mask's silhouette is tight enough for artifact-free reuse once these prefabs "
            "are repositioned into a *different* WorldPlan layout (a later-phase renderer concern); this pass "
            "only proves byte-exact reconstruction of the *current* master's own layout.",
            "Runtime integration behavior (public/fable5-v2/app.js etc. are unmodified by this pass).",
        ],
    }
    write_json(LINEAGE_PATH, lineage)
    print(f"wrote {relative(LINEAGE_PATH)}")


if __name__ == "__main__":
    main()
