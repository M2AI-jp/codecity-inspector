#!/usr/bin/env python3
"""Extract the small-prop and foreground-occluder prefabs from
target-town-user-direct-v1.png: the well, flower bed, benches, barrel
clusters, two additional streetlamps, and the south-west gate wall.

Every pixel copied is an exact, unresampled source pixel selected by either a
hand-measured polygon or (for the circular flower bed) a deterministic
ellipse polygon -- see extract-target-town-trees.py.

This script only writes PNG files -- see extract-target-town-terrain-plates.py
for why metadata assembly lives solely in build-target-town-prefab-manifest.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import town_prefab_geometry as geo
from _town_prefab_common import PREFAB_ROOT, crop_with_mask, ellipse_polygon, load_source, relative, save_rgba

PROPS_DIR = PREFAB_ROOT / "props"
FOREGROUND_DIR = PREFAB_ROOT / "foreground"


def mask_polygons(entry: dict) -> list[list[tuple[int, int]]]:
    if "ellipse" in entry:
        ellipse = entry["ellipse"]
        return [ellipse_polygon(ellipse["cx"], ellipse["cy"], ellipse["rx"], ellipse["ry"])]
    return entry["polygons"]


def main() -> None:
    source = load_source()
    PROPS_DIR.mkdir(parents=True, exist_ok=True)
    FOREGROUND_DIR.mkdir(parents=True, exist_ok=True)

    for prop in geo.PROPS:
        box = prop["box"]
        cut = crop_with_mask(source, box, mask_polygons(prop))
        path = PROPS_DIR / f"{prop['id']}.png"
        save_rgba(cut, path)
        print(f"wrote {relative(path)} origin=({box[0]},{box[1]}) size={cut.size}")

    for fg in geo.FOREGROUND:
        box = fg["box"]
        cut = crop_with_mask(source, box, mask_polygons(fg))
        path = FOREGROUND_DIR / f"{fg['id']}.png"
        save_rgba(cut, path)
        print(f"wrote {relative(path)} origin=({box[0]},{box[1]}) size={cut.size}")

    print(f"props: {len(geo.PROPS)}")
    print(f"foreground occluders: {len(geo.FOREGROUND)}")


if __name__ == "__main__":
    main()
