#!/usr/bin/env python3
"""Extract the target-town route streetlamp as an exact source-pixel foreground object."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


REPO = Path(__file__).resolve().parents[4]
SOURCE = REPO / "art/references/target-town.png"
CANONICAL_SOURCE = REPO / "art/references/user-provided/target-town.png"
RUNTIME_SOURCE = REPO / "public/fable5-v2/assets/world/target-town-user-direct-v1.png"
PLAYER_ATLAS = REPO / "public/fable5-v2/assets/characters/player-green-4dir-v1.png"
OBJECT_DIR = REPO / "public/fable5-v2/assets/objects/target-town-streetlamp"
QA_DIR = REPO / "art/production/vertical-slice/qa"

SOURCE_SHA256 = "39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607"
SOURCE_SIZE = (1586, 992)
PLAYER_SIZE = (256, 512)

OBJECT_PATH = OBJECT_DIR / "route-streetlamp-foreground-v1.png"
LINEAGE_PATH = OBJECT_DIR / "target-town-streetlamp.lineage.json"
QA_CONTACT_PATH = QA_DIR / "target-town-streetlamp-extraction-qa-v1.png"
QA_COMPOSITE_PATH = QA_DIR / "target-town-streetlamp-same-coordinate-composite-v1.png"

# Native target-town coordinates. The lamp crosses the golden route visually, but
# its base contacts the ground well south of the route.
LAMP_BOX = (302, 464, 355, 626)
LAMP_FOOT = (327, 624)
DEPTH_SORT_FOOT_Y = 624
QA_PLAYER_FOOT = (327, 520)

LAMP_MASKS = [
    # Finial and narrow upper stem.
    [
        (324, 464), (331, 464), (332, 471), (335, 476), (335, 484),
        (332, 489), (321, 489), (319, 484), (321, 478), (321, 471),
    ],
    # Solid central cap.
    [
        (324, 481), (332, 481), (339, 489), (344, 498), (338, 504),
        (315, 504), (310, 498), (317, 489),
    ],
    # Left scrollwork upper stroke.
    [
        (318, 489), (312, 483), (307, 483), (303, 489), (306, 493),
        (312, 490), (319, 495),
    ],
    # Left scrollwork lower loop stroke.
    [
        (307, 489), (303, 493), (305, 498), (310, 501), (316, 498),
        (313, 494), (310, 497), (307, 495), (309, 492), (314, 493),
    ],
    # Right scrollwork upper stroke.
    [
        (337, 491), (345, 482), (351, 483), (354, 489), (351, 493),
        (346, 489), (340, 496),
    ],
    # Right scrollwork lower loop stroke.
    [
        (348, 489), (353, 493), (351, 498), (346, 501), (340, 498),
        (343, 494), (346, 497), (349, 495), (347, 492), (342, 493),
    ],
    # Lit lantern body.
    [
        (315, 501), (340, 501), (343, 510), (341, 527), (337, 538),
        (318, 538), (313, 527), (312, 510),
    ],
    # Ornate neck below the lantern.
    [
        (317, 533), (338, 533), (339, 545), (335, 554), (333, 558),
        (322, 558), (318, 554), (315, 545),
    ],
    # Pole.
    [
        (323, 550), (333, 550), (332, 597), (331, 601), (323, 601),
        (322, 597),
    ],
    # Ground base.
    [
        (320, 595), (335, 595), (339, 603), (340, 615), (336, 623),
        (316, 623), (313, 618), (315, 604),
    ],
]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def relative(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def font(size: int, bold: bool = False):
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


def validate_exact_source(path: Path):
    if not path.exists():
        raise RuntimeError(f"Missing required source: {relative(path)}")
    if digest(path) != SOURCE_SHA256:
        raise RuntimeError(f"Source hash mismatch: {relative(path)}")
    with Image.open(path) as image:
        if image.size != SOURCE_SIZE:
            raise RuntimeError(f"Source dimensions mismatch: {relative(path)} {image.size}")


def localize(points: list[tuple[int, int]]):
    return [(x - LAMP_BOX[0], y - LAMP_BOX[1]) for x, y in points]


def extract_lamp(source: Image.Image) -> Image.Image:
    size = (LAMP_BOX[2] - LAMP_BOX[0], LAMP_BOX[3] - LAMP_BOX[1])
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for polygon in LAMP_MASKS:
        draw.polygon(localize(polygon), fill=255)
    crop = source.crop(LAMP_BOX).convert("RGBA")

    # The open scrollwork and cage expose cobbles inside their coarse outlines.
    # Select dark metal and chromatic lamp pixels, grow that selection by one
    # source pixel to recover gray metal highlights, and constrain it to the
    # hand-measured structural mask. Output remains binary alpha.
    selected = []
    for red, green, blue, opacity in crop.getdata():
        chroma = max(red, green, blue) - min(red, green, blue)
        is_lamp_pixel = opacity and (
            max(red, green, blue) < 82
            or chroma > 45
            or (red > 130 and green > 85 and blue < 95)
        )
        selected.append(255 if is_lamp_pixel else 0)
    color_mask = Image.new("L", crop.size, 0)
    color_mask.putdata(selected)
    color_mask = color_mask.filter(ImageFilter.MaxFilter(3))
    mask = ImageChops.multiply(color_mask, mask)

    output = Image.new("RGBA", size, (0, 0, 0, 0))
    output.paste(crop, (0, 0), mask)
    return output


def alpha_metrics(image: Image.Image) -> dict:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    histogram = alpha.histogram()
    hidden_rgb = sum(
        1 for red, green, blue, opacity in image.getdata()
        if opacity == 0 and (red != 0 or green != 0 or blue != 0)
    )
    return {
        "alphaBboxLocal": None if bbox is None else {
            "x": bbox[0], "y": bbox[1], "width": bbox[2] - bbox[0], "height": bbox[3] - bbox[1]
        },
        "nontransparentPixelCount": sum(histogram[1:]),
        "partialAlphaPixelCount": sum(histogram[1:255]),
        "hiddenRgbPixelCount": hidden_rgb,
    }


def composite_and_diff(source: Image.Image, lamp: Image.Image):
    composite = source.convert("RGBA")
    composite.alpha_composite(lamp, LAMP_BOX[:2])
    difference = ImageChops.difference(source.convert("RGB"), composite.convert("RGB"))
    changed = sum(1 for pixel in difference.getdata() if pixel != (0, 0, 0))
    histogram = difference.histogram()
    maximum_delta = max(
        index
        for channel in range(3)
        for index, count in enumerate(histogram[channel * 256:(channel + 1) * 256])
        if count
    )
    metrics = {
        "changedPixelCount": changed,
        "maximumChannelDelta": maximum_delta,
        "pixelIdentical": changed == 0 and maximum_delta == 0,
    }
    return composite, metrics


def world_panel(source: Image.Image, lamp: Image.Image, player: Image.Image, corrected: bool) -> Image.Image:
    box = (250, 400, 450, 650)
    panel = source.crop(box).convert("RGBA")
    player_origin = (
        QA_PLAYER_FOOT[0] - 32 - box[0],
        QA_PLAYER_FOOT[1] - 120 - box[1],
    )
    panel.alpha_composite(player, player_origin)
    if corrected:
        panel.alpha_composite(lamp, (LAMP_BOX[0] - box[0], LAMP_BOX[1] - box[1]))
    return panel.resize((400, 500), Image.Resampling.NEAREST)


def make_qa_contact(
    source: Image.Image,
    lamp: Image.Image,
    player: Image.Image,
    diff_metrics: dict,
) -> Image.Image:
    canvas = Image.new("RGB", (1660, 950), (13, 16, 21))
    draw = ImageDraw.Draw(canvas)
    title = font(31, bold=True)
    label = font(21, bold=True)
    note = font(17)

    draw.text((30, 24), "TARGET-TOWN ROUTE STREETLAMP — EXACT SOURCE-PIXEL FOREGROUND", font=title, fill=(243, 225, 174))
    draw.text((30, 70), "Native 1586x992 coordinates / no generated pixels / no reconstruction / no resampling", font=note, fill=(200, 208, 219))

    source_box = (280, 440, 380, 650)
    source_panel = source.crop(source_box).resize((300, 630), Image.Resampling.NEAREST)
    canvas.paste(source_panel, (30, 125))
    scale = 3
    origin_x = 30 - source_box[0] * scale
    origin_y = 125 - source_box[1] * scale
    draw.rectangle((
        origin_x + LAMP_BOX[0] * scale,
        origin_y + LAMP_BOX[1] * scale,
        origin_x + LAMP_BOX[2] * scale - 1,
        origin_y + LAMP_BOX[3] * scale - 1,
    ), outline=(255, 195, 84), width=3)
    foot_x = origin_x + LAMP_FOOT[0] * scale
    foot_y = origin_y + LAMP_FOOT[1] * scale
    draw.ellipse((foot_x - 6, foot_y - 6, foot_x + 6, foot_y + 6), fill=(242, 79, 85))
    draw.text((30, 775), "crop origin world (302,464) / 53x162", font=note, fill=(255, 202, 105))
    draw.text((30, 806), "physical foot world (327,624) / local (25,160)", font=note, fill=(247, 137, 139))
    draw.text((30, 837), "depth-sort footY = 624", font=label, fill=(117, 235, 158))

    draw.text((365, 125), "EXTRACTED RGBA", font=label, fill=(255, 202, 105))
    lamp_scaled = lamp.resize((lamp.width * 4, lamp.height * 4), Image.Resampling.NEAREST)
    lamp_panel = checkerboard(lamp_scaled.size, 16)
    lamp_panel.alpha_composite(lamp_scaled)
    canvas.paste(lamp_panel.convert("RGB"), (365, 165))
    draw.text((365, 835), f"alpha bbox {alpha_metrics(lamp)['alphaBboxLocal']}", font=note, fill=(200, 208, 219))

    draw.text((610, 125), "CURRENT: PLAYER OVER LAMP — FAIL", font=label, fill=(247, 137, 139))
    canvas.paste(world_panel(source, lamp, player, corrected=False).convert("RGB"), (610, 165))
    draw.text((610, 680), "world → player", font=note, fill=(247, 137, 139))
    draw.text((610, 712), "player footY 520 < lamp footY 624", font=note, fill=(200, 208, 219))

    draw.text((1035, 125), "CORRECT: LAMP OVER PLAYER", font=label, fill=(117, 235, 158))
    canvas.paste(world_panel(source, lamp, player, corrected=True).convert("RGB"), (1035, 165))
    draw.text((1035, 680), "world → player → extracted lamp", font=note, fill=(117, 235, 158))
    draw.text((1035, 712), "route actor is north of lamp base", font=note, fill=(200, 208, 219))

    draw.text((1035, 775), f"same-coordinate changed pixels: {diff_metrics['changedPixelCount']}", font=note, fill=(117, 235, 158))
    draw.text((1035, 806), f"maximum channel delta: {diff_metrics['maximumChannelDelta']}", font=note, fill=(117, 235, 158))
    draw.text((1035, 837), "PASS: source appearance unchanged", font=label, fill=(117, 235, 158))

    draw.text((30, 912), "Observed: source RGB, crop, base contact. Inferred: binary silhouette mask. Unknown background behind the lamp was not reconstructed.", font=note, fill=(200, 208, 219))
    return canvas


def main():
    for path in (SOURCE, CANONICAL_SOURCE, RUNTIME_SOURCE):
        validate_exact_source(path)
    if not PLAYER_ATLAS.exists():
        raise RuntimeError(f"Missing QA-only player atlas: {relative(PLAYER_ATLAS)}")
    with Image.open(PLAYER_ATLAS) as atlas_probe:
        if atlas_probe.size != PLAYER_SIZE:
            raise RuntimeError(f"QA-only player atlas dimensions mismatch: {atlas_probe.size}")

    source = Image.open(SOURCE).convert("RGB")
    player_atlas = Image.open(PLAYER_ATLAS).convert("RGBA")
    player_south_idle = player_atlas.crop((0, 0, 64, 128))
    lamp = extract_lamp(source)

    OBJECT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    lamp.save(OBJECT_PATH, optimize=False)
    lamp = Image.open(OBJECT_PATH).convert("RGBA")

    composite, diff_metrics = composite_and_diff(source, lamp)
    if not diff_metrics["pixelIdentical"]:
        raise RuntimeError(f"Same-coordinate recomposite changed source pixels: {diff_metrics}")
    composite.convert("RGB").save(QA_COMPOSITE_PATH, optimize=False)
    make_qa_contact(source, lamp, player_south_idle, diff_metrics).save(QA_CONTACT_PATH, optimize=False)

    metrics = alpha_metrics(lamp)
    lineage = {
        "schemaVersion": 1,
        "assetId": "target-town-route-streetlamp-foreground-v1",
        "status": "exact-source-pixel-runtime-foreground-awaiting-runtime-wiring",
        "source": {
            "ledgerSourceId": "user_target_town_current",
            "path": relative(SOURCE),
            "protectedCanonicalPath": relative(CANONICAL_SOURCE),
            "runtimeWholeImagePath": relative(RUNTIME_SOURCE),
            "sha256": SOURCE_SHA256,
            "dimensions": {"width": SOURCE_SIZE[0], "height": SOURCE_SIZE[1]},
            "custody": "user-direct",
        },
        "runtimeObject": {
            "path": relative(OBJECT_PATH),
            "sha256": digest(OBJECT_PATH),
            "dimensions": {"width": lamp.width, "height": lamp.height},
            "cropOriginWorld": {"x": LAMP_BOX[0], "y": LAMP_BOX[1]},
            "cropBoxWorld": {"x": LAMP_BOX[0], "y": LAMP_BOX[1], "width": lamp.width, "height": lamp.height},
            "physicalFootWorld": {"x": LAMP_FOOT[0], "y": LAMP_FOOT[1]},
            "physicalFootLocal": {"x": LAMP_FOOT[0] - LAMP_BOX[0], "y": LAMP_FOOT[1] - LAMP_BOX[1]},
            "depthSortFootY": DEPTH_SORT_FOOT_Y,
            "depthRule": "draw after actors whose footY is less than 624; draw before actors whose footY is 624 or greater",
            "goldenRouteActorFootYRange": {"minimum": 491, "maximum": 551, "relation": "always north of lamp foot; lamp draws after actor"},
            "runtimeRole": "coordinate-bound foreground occluder for the n=1 spawn-to-inn route",
            **metrics,
        },
        "extraction": {
            "script": relative(Path(__file__).resolve()),
            "scriptSha256": digest(Path(__file__).resolve()),
            "method": "exact-source-rgb-copy-under-deterministic-binary-structure-and-color-mask",
            "mask": {
                "coarseStructure": "hand-measured native-pixel component polygons",
                "colorSelection": {
                    "darkMaximumRgbExclusive": 82,
                    "minimumChromaExclusive": 45,
                    "warmHighlight": {"redMinimumExclusive": 130, "greenMinimumExclusive": 85, "blueMaximumExclusive": 95},
                },
                "metalHighlightRecovery": "one-source-pixel MaxFilter(3) constrained by the coarse structure mask",
                "alpha": "binary",
            },
            "generatedPixels": False,
            "resampling": False,
            "colorTransform": False,
            "hiddenBackgroundReconstruction": False,
        },
        "qa": {
            "sameCoordinateComposite": {
                "path": relative(QA_COMPOSITE_PATH),
                "sha256": digest(QA_COMPOSITE_PATH),
                "dimensions": {"width": SOURCE_SIZE[0], "height": SOURCE_SIZE[1]},
                **diff_metrics,
            },
            "contactAndDepthProof": {
                "path": relative(QA_CONTACT_PATH),
                "sha256": digest(QA_CONTACT_PATH),
                "dimensions": {"width": 1660, "height": 950},
                "qaOnlyPlayerAtlas": {
                    "path": relative(PLAYER_ATLAS),
                    "sha256": digest(PLAYER_ATLAS),
                    "frame": "south-idle",
                    "footWorld": {"x": QA_PLAYER_FOOT[0], "y": QA_PLAYER_FOOT[1]},
                },
            },
        },
        "observed": [
            "streetlamp visual pixels cross the golden route around world x=327",
            "streetlamp base contacts the ground at target-town native pixel (327,624)",
        ],
        "inferred": [
            "binary silhouette mask selects only exact source RGB pixels",
            "route actors with footY below 624 are north of the lamp and must be drawn before it",
        ],
        "unknown": [
            "background pixels hidden behind the streetlamp",
        ],
    }
    LINEAGE_PATH.write_text(json.dumps(lineage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"streetlamp crop origin={LAMP_BOX[:2]} size={lamp.size} physical-foot={LAMP_FOOT} depth-sort-footY={DEPTH_SORT_FOOT_Y}")
    print(f"alpha metrics: {metrics}")
    print(f"same-coordinate recomposite: {diff_metrics}")
    for path in (OBJECT_PATH, LINEAGE_PATH, QA_CONTACT_PATH, QA_COMPOSITE_PATH):
        print(f"wrote {relative(path)}")


if __name__ == "__main__":
    main()
