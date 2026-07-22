#!/usr/bin/env python3
"""Split target-town-user-direct-v1.png into full-coverage terrain plates and
alpha-cut road segments.

Terrain plates are a clean grid (town_prefab_geometry.TERRAIN_GRID_COLS x
_ROWS) that tiles the *entire* 1586x992 canvas with zero gaps and zero
overlap. They are saved as opaque RGB (no alpha channel needed: this is the
deepest/bottom draw pass, nothing needs to show through it) and are exact,
unresampled crops of the accepted master.

Road segments are alpha-selected on top of that (same source pixels, a
different catalogued layer -- see the module docstring in
town_prefab_geometry.py for why the redundant coverage is intentional and
harmless).

No new pixels are invented or generated anywhere in this script. This script
only writes PNG files; build-target-town-prefab-manifest.py is the single
place that re-reads them (plus town_prefab_geometry.py) to assemble the
catalogued manifest, so there is exactly one source of truth for coordinates
(town_prefab_geometry.py) and exactly one place that hashes/measures
finished bytes (the manifest builder).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import town_prefab_geometry as geo
from _town_prefab_common import PREFAB_ROOT, crop_with_mask, load_source, relative, save_rgb, save_rgba

TERRAIN_DIR = PREFAB_ROOT / "terrain"
ROAD_DIR = PREFAB_ROOT / "road"


def main() -> None:
    source = load_source()
    TERRAIN_DIR.mkdir(parents=True, exist_ok=True)
    ROAD_DIR.mkdir(parents=True, exist_ok=True)

    plates = geo.terrain_plate_boxes()
    cols, rows = geo.TERRAIN_GRID_COLS, geo.TERRAIN_GRID_ROWS
    assert cols[0] == 0 and cols[-1] == geo.WORLD_SIZE[0], "terrain grid columns must span the full canvas width"
    assert rows[0] == 0 and rows[-1] == geo.WORLD_SIZE[1], "terrain grid rows must span the full canvas height"
    assert all(cols[i] < cols[i + 1] for i in range(len(cols) - 1)), "terrain grid columns must be strictly increasing"
    assert all(rows[i] < rows[i + 1] for i in range(len(rows) - 1)), "terrain grid rows must be strictly increasing"
    assert len(plates) == (len(cols) - 1) * (len(rows) - 1)

    for plate in plates:
        crop = source.crop(plate["box"])  # exact pixels, RGB, no resampling
        path = TERRAIN_DIR / f"{plate['id']}.png"
        save_rgb(crop, path)
        print(f"wrote {relative(path)} origin=({plate['box'][0]},{plate['box'][1]}) size={crop.size}")

    for segment in geo.ROAD_SEGMENTS:
        box = segment["box"]
        cut = crop_with_mask(source, box, segment["polygons"])
        path = ROAD_DIR / f"{segment['id']}.png"
        save_rgba(cut, path)
        print(f"wrote {relative(path)} origin=({box[0]},{box[1]}) size={cut.size}")

    print(f"terrain plates: {len(plates)} ({len(cols) - 1}x{len(rows) - 1} grid, full canvas coverage proven by construction)")
    print(f"road segments: {len(geo.ROAD_SEGMENTS)}")


if __name__ == "__main__":
    main()
