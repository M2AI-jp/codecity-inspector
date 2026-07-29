#!/usr/bin/env python3
"""Shared helpers for the target-town-user-direct-v1 prefab decomposition scripts.

Every extraction script in this family (extract-target-town-terrain-plates.py,
extract-target-town-buildings.py, extract-target-town-trees.py,
extract-target-town-props.py, build-target-town-prefab-manifest.py,
verify-target-town-prefab-reconstruction.py) imports this module. It exists so
the digest/relative/mask/QA helpers first written for extract-target-town-n1.py
and extract-target-town-streetlamp.py are not copy-pasted six more times.

No new pixels are ever invented here: every helper either copies exact source
RGB under a binary alpha mask, or performs bookkeeping (hashing, JSON shaping,
diffing) on already-extracted bytes.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[4]

# The three paths that must carry the byte-identical accepted master. Every
# extraction script validates all three before reading pixels, matching the
# convention set by extract-target-town-n1.py / extract-target-town-streetlamp.py.
SOURCE = REPO / "art/references/target-town.png"
CANONICAL_SOURCE = REPO / "art/references/user-provided/target-town.png"
RUNTIME_SOURCE = REPO / "public/fable5-v2/assets/world/target-town-user-direct-v1.png"
SOURCE_SHA256 = "39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607"
SOURCE_SIZE = (1586, 992)

PREFAB_ROOT = REPO / "public/fable5-v2/assets/prefabs"
QA_DIR = REPO / "art/production/vertical-slice/qa"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relative(path: Path) -> str:
    return path.resolve().relative_to(REPO).as_posix()


def validate_exact_source() -> None:
    """Validate the three copies of the accepted master are present and byte-identical.

    Raises RuntimeError (not a silent skip) if any copy is missing, the wrong
    size, or hashes to something other than SOURCE_SHA256 -- the same hard-fail
    contract extract-target-town-n1.py uses.
    """
    for path in (SOURCE, CANONICAL_SOURCE, RUNTIME_SOURCE):
        if not path.exists():
            raise RuntimeError(f"Missing required source: {relative(path)}")
        if digest(path) != SOURCE_SHA256:
            raise RuntimeError(f"Source hash mismatch: {relative(path)}")
        with Image.open(path) as image:
            if image.size != SOURCE_SIZE:
                raise RuntimeError(f"Source dimensions mismatch: {relative(path)} {image.size}")


def load_source() -> Image.Image:
    validate_exact_source()
    return Image.open(SOURCE).convert("RGB")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["Arial Bold.ttf", "Arial.ttf"] if bold else ["Arial.ttf", "Arial Bold.ttf"]
    for name in names:
        candidate = Path("/System/Library/Fonts/Supplemental") / name
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def checkerboard(size: tuple[int, int], cell: int = 12) -> Image.Image:
    image = Image.new("RGBA", size, (33, 37, 46, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(54, 59, 70, 255))
    return image


def ellipse_polygon(cx: float, cy: float, rx: float, ry: float, sides: int = 28) -> list[tuple[int, int]]:
    """A deterministic n-gon inscribed in an ellipse, used for round/organic
    silhouettes (tree canopies, the well roof, the flower bed) where hand
    tracing every leaf cluster is neither feasible nor meaningfully more
    "exact" than a regular polygon at this pixel-art scale. No source pixels
    are read here; this only shapes the alpha mask that later selects them.
    """
    points = []
    for index in range(sides):
        angle = 2 * math.pi * index / sides
        points.append((round(cx + rx * math.cos(angle)), round(cy + ry * math.sin(angle))))
    return points


def polygon_mask(size: tuple[int, int], origin: tuple[int, int], polygons: Iterable[list[tuple[int, int]]]) -> Image.Image:
    """Binary (0/255) alpha mask, local to a crop box. `polygons` are in the
    same world-pixel coordinate space as `origin`; they get localized here.
    Matches the localize()+draw.polygon() pattern used by the existing
    extraction scripts (hard edges, no anti-aliasing, one deterministic fill
    per polygon).
    """
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        local = [(x - origin[0], y - origin[1]) for x, y in polygon]
        draw.polygon(local, fill=255)
    return mask


def crop_with_mask(source: Image.Image, box: tuple[int, int, int, int], polygons: Iterable[list[tuple[int, int]]]) -> Image.Image:
    """Exact-source-pixel RGBA crop selected by a binary polygon mask union.
    Identical method to extract-target-town-n1.py's source_object(): copy
    source.crop(box) verbatim, then zero the alpha outside the mask. No
    resampling, no recoloring.
    """
    width = box[2] - box[0]
    height = box[3] - box[1]
    mask = polygon_mask((width, height), (box[0], box[1]), polygons)
    crop = source.crop(box).convert("RGBA")
    output = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    output.paste(crop, (0, 0), mask)
    return output


def alpha_metrics(image: Image.Image) -> dict:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    histogram = alpha.histogram()
    nontransparent = sum(histogram[1:])
    partial = sum(histogram[1:255])
    hidden_rgb = 0
    for red, green, blue, opacity in image.getdata():
        if opacity == 0 and (red != 0 or green != 0 or blue != 0):
            hidden_rgb += 1
    return {
        "alphaBboxLocal": None if bbox is None else {
            "x": bbox[0], "y": bbox[1], "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]
        },
        "nontransparentPixelCount": nontransparent,
        "partialAlphaPixelCount": partial,
        "hiddenRgbPixelCount": hidden_rgb,
    }


def alpha_bbox_world(image: Image.Image, crop_origin: tuple[int, int]) -> tuple[int, int, int, int] | None:
    """The tight bounding box of non-transparent pixels, in world coordinates."""
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        return None
    left, top, right, bottom = bbox
    return (
        crop_origin[0] + left,
        crop_origin[1] + top,
        crop_origin[0] + right,
        crop_origin[1] + bottom,
    )


def save_rgba(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(path, optimize=False)


def save_rgb(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, optimize=False)


def diff_metrics(expected_rgb: Image.Image, actual_rgb: Image.Image) -> dict:
    difference = ImageChops.difference(expected_rgb, actual_rgb)
    histogram = difference.histogram()
    changed_pixels = sum(1 for pixel in difference.getdata() if pixel != (0, 0, 0))
    maximum_delta = 0
    for channel in range(3):
        channel_values = histogram[channel * 256:(channel + 1) * 256]
        nonzero = [index for index, count in enumerate(channel_values) if count]
        if nonzero:
            maximum_delta = max(maximum_delta, max(nonzero))
    return {
        "changedPixelCount": changed_pixels,
        "totalPixelCount": expected_rgb.width * expected_rgb.height,
        "maximumChannelDelta": maximum_delta,
        "pixelIdentical": changed_pixels == 0 and maximum_delta == 0,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
