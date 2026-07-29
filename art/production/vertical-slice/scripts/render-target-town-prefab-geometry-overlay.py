#!/usr/bin/env python3
"""Render a debug overlay of every manifest prefab's crop box, alpha bbox,
and pivot on top of the accepted master, color-coded by layer. This is
read-only documentation/QA evidence (not used by the reconstruction proof)
that makes the manifest's z-order (drawOrder.rule in manifest.json) and
per-prefab pivot placement visually auditable in one image, per the task's
"z-orderの妥当性...もマニフェストのレイヤー値で表現すること" requirement.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw

from _town_prefab_common import QA_DIR, REPO, SOURCE, font, relative, validate_exact_source, write_json

MANIFEST_PATH = REPO / "public/fable5-v2/assets/prefabs/manifest.json"
OUT_PATH = QA_DIR / "town-master-prefab-geometry-overlay-v1.png"

LAYER_COLORS = {
    "terrain": (70, 100, 220),
    "road": (225, 180, 50),
    "building": (240, 60, 60),
    "prop": (255, 40, 220),
    "foreground": (40, 230, 230),
}


def main() -> None:
    validate_exact_source()
    import json
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    image = Image.open(SOURCE).convert("RGB")
    draw = ImageDraw.Draw(image)
    label_font = font(11, bold=True)

    counts = {}
    for record in manifest["prefabs"]:
        layer = record["layer"]
        counts[layer] = counts.get(layer, 0) + 1
        color = LAYER_COLORS[layer]
        box = record["cropBoxWorld"]
        rect = (box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"])
        draw.rectangle(rect, outline=color, width=1)
        pivot = record.get("pivot")
        if pivot:
            px, py = pivot["x"], pivot["y"]
            draw.ellipse((px - 3, py - 3, px + 3, py + 3), outline=(255, 255, 255), fill=color, width=1)

    legend_y = 10
    draw.rectangle((6, 4, 260, 8 + 16 * (len(LAYER_COLORS) + 1)), fill=(10, 12, 16))
    for layer, color in LAYER_COLORS.items():
        draw.rectangle((12, legend_y, 26, legend_y + 10), fill=color)
        draw.text((32, legend_y - 2), f"{layer} (n={counts.get(layer, 0)})", font=label_font, fill=(235, 235, 240))
        legend_y += 16
    draw.text((12, legend_y), f"dot = pivot   total prefabs = {len(manifest['prefabs'])}", font=label_font, fill=(200, 205, 215))

    QA_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_PATH, optimize=False)
    print(f"wrote {relative(OUT_PATH)}")


if __name__ == "__main__":
    main()
