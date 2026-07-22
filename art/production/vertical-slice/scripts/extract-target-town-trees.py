#!/usr/bin/env python3
"""Extract the ten tree prefabs from target-town-user-direct-v1.png.

Canopies are alpha-selected with a deterministic ellipse polygon inscribed in
a measured bounding box (see _town_prefab_common.ellipse_polygon) rather than
hand-traced leaf clusters. Every pixel copied is an exact, unresampled source
pixel; only the (reproducible, parameter-driven) mask shape is generated.

This script only writes PNG files -- see extract-target-town-terrain-plates.py
for why metadata assembly lives solely in build-target-town-prefab-manifest.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import town_prefab_geometry as geo
from _town_prefab_common import PREFAB_ROOT, crop_with_mask, ellipse_polygon, load_source, relative, save_rgba

TREES_DIR = PREFAB_ROOT / "trees"


def main() -> None:
    source = load_source()
    TREES_DIR.mkdir(parents=True, exist_ok=True)

    for tree in geo.TREES:
        box = tree["box"]
        ellipse = tree["ellipse"]
        polygon = ellipse_polygon(ellipse["cx"], ellipse["cy"], ellipse["rx"], ellipse["ry"])
        cut = crop_with_mask(source, box, [polygon])
        path = TREES_DIR / f"{tree['id']}.png"
        save_rgba(cut, path)
        print(f"wrote {relative(path)} origin=({box[0]},{box[1]}) size={cut.size}")

    print(f"trees: {len(geo.TREES)}")


if __name__ == "__main__":
    main()
