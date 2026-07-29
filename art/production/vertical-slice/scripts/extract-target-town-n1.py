#!/usr/bin/env python3
"""Extract the n=1 target-town inn objects without inventing source pixels."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


REPO = Path(__file__).resolve().parents[4]
SOURCE = REPO / "art/references/target-town.png"
CANONICAL_SOURCE = REPO / "art/references/user-provided/target-town.png"
RUNTIME_SOURCE = REPO / "public/fable5-v2/assets/world/target-town-user-direct-v1.png"
OBJECT_DIR = REPO / "public/fable5-v2/assets/objects/target-town-inn"
QA_DIR = REPO / "art/production/vertical-slice/qa"

SOURCE_SHA256 = "39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607"
SOURCE_SIZE = (1586, 992)

BARTENDER_PATH = OBJECT_DIR / "bartender-source-visible-v1.png"
FOREGROUND_PATH = OBJECT_DIR / "entrance-foreground-v1.png"
LINEAGE_PATH = OBJECT_DIR / "target-town-inn-n1.lineage.json"
QA_CONTACT_PATH = QA_DIR / "target-town-inn-extraction-qa-v1.png"
QA_COMPOSITE_PATH = QA_DIR / "target-town-inn-same-coordinate-composite-v1.png"

# Coordinates are native target-town pixels, never legacy 1536x1024 pixels.
BARTENDER_BOX = (202, 255, 247, 310)
BARTENDER_VISIBLE_MASK = [
    (218, 258), (231, 257), (237, 261), (241, 268), (242, 277),
    (238, 285), (235, 289), (239, 291), (243, 297), (246, 303),
    (242, 308), (235, 309), (229, 305), (218, 305), (212, 309),
    (205, 305), (202, 299), (205, 291), (210, 284), (211, 279),
    (208, 274), (210, 266), (214, 261),
]
BARTENDER_VISIBLE_FOOT = (224, 309)

FOREGROUND_BOX = (145, 397, 296, 486)
FOREGROUND_MASKS = [
    # West low wall.
    [
        (145, 418), (180, 418), (184, 424), (184, 460), (145, 460),
    ],
    # West doorway post.
    [
        (181, 408), (184, 402), (190, 399), (195, 402), (198, 408),
        (199, 463), (194, 469), (186, 470), (181, 463),
    ],
    # East doorway post.
    [
        (228, 409), (231, 403), (236, 400), (242, 403), (246, 410),
        (246, 461), (241, 468), (233, 470), (228, 462),
    ],
    # Barrel planter, foliage, and the adjoining wall cap; the interior chair is excluded.
    [
        (244, 421), (254, 415), (269, 416), (278, 422), (296, 414),
        (296, 451), (282, 456), (276, 465), (265, 473), (252, 477),
        (241, 470), (238, 459),
    ],
]
DOOR_FOOT = (212, 470)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def relative(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def localize(points: list[tuple[int, int]], box: tuple[int, int, int, int]):
    return [(x - box[0], y - box[1]) for x, y in points]


def source_object(
    source: Image.Image,
    box: tuple[int, int, int, int],
    polygons: list[list[tuple[int, int]]],
) -> Image.Image:
    width = box[2] - box[0]
    height = box[3] - box[1]
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        draw.polygon(localize(polygon, box), fill=255)

    crop = source.crop(box).convert("RGBA")
    output = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    output.paste(crop, (0, 0), mask)
    return output


def checkerboard(size: tuple[int, int], cell: int = 12) -> Image.Image:
    image = Image.new("RGBA", size, (33, 37, 46, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(54, 59, 70, 255))
    return image


def font(size: int, bold: bool = False):
    names = ["Arial Bold.ttf", "Arial.ttf"] if bold else ["Arial.ttf", "Arial Bold.ttf"]
    for name in names:
        candidate = Path("/System/Library/Fonts/Supplemental") / name
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


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


def same_coordinate_composite(
    source: Image.Image,
    assets: list[tuple[Image.Image, tuple[int, int]]],
) -> tuple[Image.Image, dict]:
    composite = source.convert("RGBA")
    for asset, origin in assets:
        composite.alpha_composite(asset, origin)
    difference = ImageChops.difference(source.convert("RGB"), composite.convert("RGB"))
    histogram = difference.histogram()
    changed_pixels = sum(
        1 for pixel in difference.getdata() if pixel != (0, 0, 0)
    )
    maximum_delta = 0
    for channel in range(3):
        channel_values = histogram[channel * 256:(channel + 1) * 256]
        maximum_delta = max(maximum_delta, max(index for index, count in enumerate(channel_values) if count))
    return composite, {
        "changedPixelCount": changed_pixels,
        "maximumChannelDelta": maximum_delta,
        "pixelIdentical": changed_pixels == 0 and maximum_delta == 0,
    }


def make_qa_contact(
    source: Image.Image,
    bartender: Image.Image,
    foreground: Image.Image,
    composite: Image.Image,
    diff_metrics: dict,
) -> Image.Image:
    canvas = Image.new("RGB", (1680, 960), (13, 16, 21))
    draw = ImageDraw.Draw(canvas)
    title = font(32, bold=True)
    label = font(22, bold=True)
    note = font(18)

    draw.text((34, 24), "TARGET-TOWN N=1 INN — EXACT SOURCE-PIXEL OBJECT EXTRACTION", font=title, fill=(243, 225, 174))
    draw.text((34, 72), "Source: user-direct 1586x992 / SHA-256 39102cba… / no generated pixels / no resampling", font=note, fill=(200, 208, 219))

    overview_box = (140, 225, 420, 510)
    overview = source.crop(overview_box).resize((560, 570), Image.Resampling.NEAREST)
    canvas.paste(overview, (34, 125))
    scale = 2
    origin_x, origin_y = 34 - overview_box[0] * scale, 125 - overview_box[1] * scale
    draw.rectangle(
        (
            origin_x + BARTENDER_BOX[0] * scale,
            origin_y + BARTENDER_BOX[1] * scale,
            origin_x + BARTENDER_BOX[2] * scale - 1,
            origin_y + BARTENDER_BOX[3] * scale - 1,
        ),
        outline=(85, 224, 137), width=3,
    )
    draw.rectangle(
        (
            origin_x + FOREGROUND_BOX[0] * scale,
            origin_y + FOREGROUND_BOX[1] * scale,
            origin_x + FOREGROUND_BOX[2] * scale - 1,
            origin_y + FOREGROUND_BOX[3] * scale - 1,
        ),
        outline=(255, 190, 81), width=3,
    )
    foot_x = origin_x + DOOR_FOOT[0] * scale
    foot_y = origin_y + DOOR_FOOT[1] * scale
    draw.ellipse((foot_x - 6, foot_y - 6, foot_x + 6, foot_y + 6), fill=(239, 79, 85))
    draw.text((34, 725), "GREEN: bartender crop  (202,255) 45x55", font=note, fill=(117, 235, 158))
    draw.text((34, 757), "GOLD: entrance foreground crop  (145,397) 151x89", font=note, fill=(255, 202, 105))
    draw.text((34, 789), "RED: observed doorway foot  world (212,470) / foreground local (67,73)", font=note, fill=(247, 137, 139))

    draw.text((670, 125), "BARTENDER — visible upper body only", font=label, fill=(117, 235, 158))
    bartender_scaled = bartender.resize((bartender.width * 6, bartender.height * 6), Image.Resampling.NEAREST)
    bartender_panel = checkerboard(bartender_scaled.size, 18)
    bartender_panel.alpha_composite(bartender_scaled)
    canvas.paste(bartender_panel.convert("RGB"), (670, 168))
    draw.text((670, 475), "crop origin: (202,255) / visible lower bound: (224,309)", font=note, fill=(211, 216, 225))
    draw.text((670, 507), "physical feet: UNKNOWN (bar-occluded)", font=note, fill=(255, 190, 105))

    draw.text((670, 555), "ENTRANCE FOREGROUND — OCCLUSION PLATE", font=label, fill=(255, 202, 105))
    foreground_scaled = foreground.resize((foreground.width * 3, foreground.height * 3), Image.Resampling.NEAREST)
    foreground_panel = checkerboard(foreground_scaled.size, 18)
    foreground_panel.alpha_composite(foreground_scaled)
    canvas.paste(foreground_panel.convert("RGB"), (670, 595))

    proof_crop = composite.convert("RGB").crop((140, 250, 340, 500)).resize((400, 500), Image.Resampling.NEAREST)
    canvas.paste(proof_crop, (1240, 155))
    draw.text((1240, 125), "SAME-COORDINATE RECOMPOSITE", font=label, fill=(155, 196, 243))
    draw.text((1240, 675), f"changed pixels: {diff_metrics['changedPixelCount']}", font=note, fill=(117, 235, 158))
    draw.text((1240, 707), f"maximum channel delta: {diff_metrics['maximumChannelDelta']}", font=note, fill=(117, 235, 158))
    draw.text((1240, 739), "PASS: source appearance unchanged", font=label, fill=(117, 235, 158))

    draw.text((34, 915), "Observed and copied: source RGB pixels, crop positions, visible lower bounds. Inferred: binary object masks. No hidden background was reconstructed.", font=note, fill=(200, 208, 219))
    return canvas


def validate_source(path: Path):
    if not path.exists():
        raise RuntimeError(f"Missing required source: {relative(path)}")
    if digest(path) != SOURCE_SHA256:
        raise RuntimeError(f"Source hash mismatch: {relative(path)}")
    with Image.open(path) as image:
        if image.size != SOURCE_SIZE:
            raise RuntimeError(f"Source dimensions mismatch: {relative(path)} {image.size}")


def main():
    for path in (SOURCE, CANONICAL_SOURCE, RUNTIME_SOURCE):
        validate_source(path)

    source = Image.open(SOURCE).convert("RGB")
    bartender = source_object(source, BARTENDER_BOX, [BARTENDER_VISIBLE_MASK])
    foreground = source_object(source, FOREGROUND_BOX, FOREGROUND_MASKS)

    OBJECT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    bartender.save(BARTENDER_PATH, optimize=False)
    foreground.save(FOREGROUND_PATH, optimize=False)

    # Reload the runtime files so QA validates serialized bytes, not only in-memory images.
    bartender = Image.open(BARTENDER_PATH).convert("RGBA")
    foreground = Image.open(FOREGROUND_PATH).convert("RGBA")
    composite, diff_metrics = same_coordinate_composite(source, [
        (bartender, BARTENDER_BOX[:2]),
        (foreground, FOREGROUND_BOX[:2]),
    ])
    if not diff_metrics["pixelIdentical"]:
        raise RuntimeError(f"Same-coordinate recomposite changed source pixels: {diff_metrics}")

    composite.convert("RGB").save(QA_COMPOSITE_PATH, optimize=False)
    make_qa_contact(source, bartender, foreground, composite, diff_metrics).save(QA_CONTACT_PATH, optimize=False)

    bartender_metrics = alpha_metrics(bartender)
    foreground_metrics = alpha_metrics(foreground)
    lineage = {
        "schemaVersion": 1,
        "assetSetId": "target-town-inn-n1",
        "status": "exact-source-pixel-runtime-objects-awaiting-runtime-wiring",
        "source": {
            "ledgerSourceId": "user_target_town_current",
            "path": relative(SOURCE),
            "protectedCanonicalPath": relative(CANONICAL_SOURCE),
            "runtimeWholeImagePath": relative(RUNTIME_SOURCE),
            "sha256": SOURCE_SHA256,
            "dimensions": {"width": SOURCE_SIZE[0], "height": SOURCE_SIZE[1]},
            "custody": "user-direct",
        },
        "extraction": {
            "script": relative(Path(__file__).resolve()),
            "scriptSha256": digest(Path(__file__).resolve()),
            "coordinateSpace": {"width": SOURCE_SIZE[0], "height": SOURCE_SIZE[1]},
            "method": "exact-source-rgb-copy-under-binary-alpha-mask",
            "generatedPixels": False,
            "resampling": False,
            "colorTransform": False,
            "hiddenBackgroundReconstruction": False,
        },
        "assets": [
            {
                "assetId": "target-town-inn-bartender-source-visible-v1",
                "path": relative(BARTENDER_PATH),
                "sha256": digest(BARTENDER_PATH),
                "dimensions": {"width": bartender.width, "height": bartender.height},
                "cropOriginWorld": {"x": BARTENDER_BOX[0], "y": BARTENDER_BOX[1]},
                "cropBoxWorld": {"x": BARTENDER_BOX[0], "y": BARTENDER_BOX[1], "width": bartender.width, "height": bartender.height},
                "visibleLowerBoundWorld": {"x": BARTENDER_VISIBLE_FOOT[0], "y": BARTENDER_VISIBLE_FOOT[1]},
                "visibleLowerBoundLocal": {"x": BARTENDER_VISIBLE_FOOT[0] - BARTENDER_BOX[0], "y": BARTENDER_VISIBLE_FOOT[1] - BARTENDER_BOX[1]},
                "physicalFoot": {"status": "unknown", "reason": "lower body and feet are occluded by the baked bar"},
                "runtimeRole": "coordinate-bound static visible bartender fragment and dialogue anchor evidence",
                **bartender_metrics,
            },
            {
                "assetId": "target-town-inn-entrance-foreground-v1",
                "path": relative(FOREGROUND_PATH),
                "sha256": digest(FOREGROUND_PATH),
                "dimensions": {"width": foreground.width, "height": foreground.height},
                "cropOriginWorld": {"x": FOREGROUND_BOX[0], "y": FOREGROUND_BOX[1]},
                "cropBoxWorld": {"x": FOREGROUND_BOX[0], "y": FOREGROUND_BOX[1], "width": foreground.width, "height": foreground.height},
                "doorFootWorld": {"x": DOOR_FOOT[0], "y": DOOR_FOOT[1]},
                "doorFootLocal": {"x": DOOR_FOOT[0] - FOREGROUND_BOX[0], "y": DOOR_FOOT[1] - FOREGROUND_BOX[1]},
                "runtimeRole": "coordinate-bound foreground occlusion plate around the n=1 inn entrance",
                **foreground_metrics,
            },
        ],
        "qa": {
            "sameCoordinateComposite": {
                "path": relative(QA_COMPOSITE_PATH),
                "sha256": digest(QA_COMPOSITE_PATH),
                "dimensions": {"width": SOURCE_SIZE[0], "height": SOURCE_SIZE[1]},
                **diff_metrics,
            },
            "contactSheet": {
                "path": relative(QA_CONTACT_PATH),
                "sha256": digest(QA_CONTACT_PATH),
                "dimensions": {"width": 1680, "height": 960},
            },
        },
        "observed": [
            "bartender visible upper body is baked behind the bar",
            "doorway foot is at target-town native pixel (212,470)",
            "entrance foreground consists of low wall, doorway posts, barrel planter, foliage, and wall cap",
        ],
        "inferred": [
            "binary silhouette and occlusion masks select only source pixels",
            "bartender visible lower bound is an occlusion anchor, not a physical foot pivot",
        ],
        "unknown": [
            "bartender physical feet and hidden lower body",
            "background pixels behind the bartender and entrance foreground",
        ],
    }
    LINEAGE_PATH.write_text(json.dumps(lineage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"bartender crop origin={BARTENDER_BOX[:2]} size={bartender.size} visible-lower-bound={BARTENDER_VISIBLE_FOOT} physical-foot=unknown")
    print(f"entrance foreground crop origin={FOREGROUND_BOX[:2]} size={foreground.size} door-foot={DOOR_FOOT} local-foot={(DOOR_FOOT[0] - FOREGROUND_BOX[0], DOOR_FOOT[1] - FOREGROUND_BOX[1])}")
    print(f"same-coordinate recomposite: {diff_metrics}")
    for path in (BARTENDER_PATH, FOREGROUND_PATH, LINEAGE_PATH, QA_CONTACT_PATH, QA_COMPOSITE_PATH):
        print(f"wrote {relative(path)}")


if __name__ == "__main__":
    main()
