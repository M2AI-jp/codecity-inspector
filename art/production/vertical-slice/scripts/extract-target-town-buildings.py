#!/usr/bin/env python3
"""Extract the ten building-shell prefabs from target-town-user-direct-v1.png.

Each building is a single flattened alpha-cut silhouette (roofline + wall
mass; see town_prefab_geometry.BUILDINGS docstring for why this is a
deliberate scope cut from Fable5PrefabSpec.md's full 5-layer kit). Every
pixel is an exact, unresampled copy of the source; only the alpha mask
(a hand-measured polygon per building) differs between buildings.

This script only writes PNG files -- see extract-target-town-terrain-plates.py
for why metadata assembly lives solely in build-target-town-prefab-manifest.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import town_prefab_geometry as geo
from _town_prefab_common import PREFAB_ROOT, crop_with_mask, load_source, relative, save_rgba

BUILDINGS_DIR = PREFAB_ROOT / "buildings"


def main() -> None:
    source = load_source()
    BUILDINGS_DIR.mkdir(parents=True, exist_ok=True)

    for building in geo.BUILDINGS:
        box = building["box"]
        cut = crop_with_mask(source, box, building["polygons"])
        path = BUILDINGS_DIR / f"{building['id']}.png"
        save_rgba(cut, path)
        landmark = " [landmark]" if building["landmark"] else ""
        print(f"wrote {relative(path)} origin=({box[0]},{box[1]}) size={cut.size}{landmark}")

    print(f"buildings: {len(geo.BUILDINGS)}")


if __name__ == "__main__":
    main()
