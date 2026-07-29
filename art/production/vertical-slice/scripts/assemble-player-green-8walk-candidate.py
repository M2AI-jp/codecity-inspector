#!/usr/bin/env python3
"""Build an isolated high-frame walk candidate from the user-direct green sheet.

This script intentionally writes candidate/QA files only. It never touches the
active runtime atlas. Every character pixel originates in the exact user-direct
source; motion frames are deterministic cut/translate composites at native size.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


REPO = Path(__file__).resolve().parents[4]
USER_SOURCE = REPO / "art/references/user-provided/character_style_reference_sheet.png"
WORLD_SOURCE = REPO / "art/references/target-town.png"
ATLAS_OUT = REPO / "art/production/vertical-slice/boards/candidates/player-green-8walk-candidate-v1.png"
LINEAGE_OUT = REPO / "art/production/vertical-slice/boards/candidates/player-green-8walk-candidate-v1.lineage.json"
CONTACT_OUT = REPO / "art/production/vertical-slice/qa/player-green-8walk-contact-sheet-v1.png"
ROOT_GIF_OUT = REPO / "art/production/vertical-slice/qa/player-green-8walk-root-motion-v1.gif"
RUNTIME_SPEED_GIF_OUT = REPO / "art/production/vertical-slice/qa/player-green-8walk-runtime-speed-v1.gif"

FRAME_W = 64
FRAME_H = 128
FOOT_X = 32
FOOT_Y = 120
ROWS = ("south", "west", "east", "north")
PHASES = ("idle", "contact-l", "recoil-l", "pass-l", "high-l", "contact-r", "recoil-r", "pass-r", "high-r")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def grid_cell(image: Image.Image, columns: int, rows: int, column: int, row: int) -> Image.Image:
    left = round(column * image.width / columns)
    top = round(row * image.height / rows)
    right = round((column + 1) * image.width / columns)
    bottom = round((row + 1) * image.height / rows)
    return image.crop((left, top, right, bottom))


def isolate_user_sprite(cell: Image.Image) -> Image.Image:
    rgb = cell.convert("RGB")
    red, green, blue = rgb.split()
    brightness = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    seed = brightness.point(lambda value: 255 if value > 18 else 0)
    bbox = seed.getbbox()
    if bbox is None:
        raise RuntimeError("No user-source sprite found in expected cell")
    mask = seed.filter(ImageFilter.MaxFilter(7))
    crop_box = (
        max(0, bbox[0] - 4),
        max(0, bbox[1] - 4),
        min(cell.width, bbox[2] + 4),
        min(cell.height, bbox[3] + 4),
    )
    sprite = rgb.crop(crop_box).convert("RGBA")
    sprite.putalpha(mask.crop(crop_box))
    return sprite


def normalize(sprite: Image.Image, target_height: int = 60) -> Image.Image:
    bbox = sprite.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Cannot normalize an empty sprite")
    sprite = sprite.crop(bbox)
    scale = min(target_height / sprite.height, 60 / sprite.width)
    return sprite.resize(
        (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))),
        Image.Resampling.NEAREST,
    )


def frame_from_sprite(sprite: Image.Image) -> Image.Image:
    sprite = normalize(sprite)
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    frame.alpha_composite(sprite, ((FRAME_W - sprite.width) // 2, FOOT_Y - sprite.height))
    return frame


def clear(frame: Image.Image, box: tuple[int, int, int, int]) -> None:
    frame.paste((0, 0, 0, 0), box)


def move_region(
    destination: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    offset: tuple[int, int],
) -> None:
    destination.alpha_composite(source.crop(box), (box[0] + offset[0], box[1] + offset[1]))


def front_pose(
    idle: Image.Image,
    left_leg: tuple[int, int],
    right_leg: tuple[int, int],
    left_arm_y: int,
    right_arm_y: int,
) -> Image.Image:
    """Articulate front/back limbs while preserving head, face and torso."""
    bbox = idle.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Empty front/back idle")
    center = (bbox[0] + bbox[2]) // 2
    leg_top = bbox[3] - 17
    arm_top = bbox[1] + 27
    arm_bottom = leg_top + 2
    boxes = {
        "left_leg": (bbox[0] + 4, leg_top, center + 1, bbox[3]),
        "right_leg": (center - 1, leg_top, bbox[2] - 4, bbox[3]),
        "left_arm": (bbox[0], arm_top, bbox[0] + 9, arm_bottom),
        "right_arm": (bbox[2] - 9, arm_top, bbox[2], arm_bottom),
    }
    frame = idle.copy()
    for box in boxes.values():
        clear(frame, box)
    move_region(frame, idle, boxes["left_leg"], left_leg)
    move_region(frame, idle, boxes["right_leg"], right_leg)
    move_region(frame, idle, boxes["left_arm"], (0, left_arm_y))
    move_region(frame, idle, boxes["right_arm"], (0, right_arm_y))
    return frame


def front_cycle(idle: Image.Image) -> list[Image.Image]:
    # Each tuple is (left leg dx/dy, right leg dx/dy, left arm dy, right arm dy).
    # At least one foot keeps dy=0 in every phase, so the ground plane is fixed.
    poses = [
        ((-4, 0), (3, -2), 2, -2),   # left contact
        ((-3, 0), (2, -1), 1, -1),   # left recoil
        ((-1, 0), (1, -3), 0, -1),   # right passes the planted left
        ((1, 0), (3, -4), -1, 1),    # right knee/foot high
        ((-3, -2), (4, 0), -2, 2),   # right contact
        ((-2, -1), (3, 0), -1, 1),   # right recoil
        ((-1, -3), (1, 0), -1, 0),   # left passes the planted right
        ((-3, -4), (-1, 0), 1, -1),  # left knee/foot high
    ]
    return [front_pose(idle, *pose) for pose in poses]


def side_intermediate(
    idle: Image.Image,
    foot_dx: int,
    foot_dy: int,
    rear_dx: int,
    rear_dy: int,
    arm_y: int,
) -> Image.Image:
    """Make a profile pass/high pose from profile-idle source pixels."""
    bbox = idle.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Empty side idle")
    center = (bbox[0] + bbox[2]) // 2
    leg_top = bbox[3] - 16
    # The halves overlap by two pixels so the robe remains visually connected.
    forward_leg = (bbox[0] + 1, leg_top, center + 2, bbox[3])
    rear_leg = (center - 2, leg_top, bbox[2] - 1, bbox[3])
    arm = (bbox[2] - 8, bbox[1] + 29, bbox[2], leg_top + 1)
    frame = idle.copy()
    for box in (forward_leg, rear_leg, arm):
        clear(frame, box)
    move_region(frame, idle, forward_leg, (foot_dx, foot_dy))
    move_region(frame, idle, rear_leg, (rear_dx, rear_dy))
    move_region(frame, idle, arm, (0, arm_y))
    return frame


def side_recoil(contact: Image.Image, toward: int) -> Image.Image:
    """Compress a direct-source contact without moving its planted sole."""
    bbox = contact.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Empty side contact")
    frame = contact.copy()
    hand_box = (bbox[2] - 9, bbox[1] + 29, bbox[2], bbox[3] - 14)
    clear(frame, hand_box)
    move_region(frame, contact, hand_box, (toward, 1))
    # Shift a narrow swing-foot edge inward; the opposite/direct-source sole stays planted.
    swing_box = (bbox[2] - 13, bbox[3] - 14, bbox[2], bbox[3] - 1)
    clear(frame, swing_box)
    move_region(frame, contact, swing_box, (-toward, -1))
    return frame


def stabilize_side_contact(idle: Image.Image, contact: Image.Image) -> Image.Image:
    """Keep the exact profile identity while retaining a source walk's legs.

    The two source walk drawings have useful opposing contacts but a different
    upper-body silhouette. Restoring the direct profile-idle pixels above the
    leg break prevents the character from becoming wider/different mid-cycle.
    """
    frame = contact.copy()
    upper = (0, 60, FRAME_W, 104)
    clear(frame, upper)
    frame.alpha_composite(idle.crop(upper), (0, 60))
    # The source contact drawings have an intentionally theatrical 36 px
    # stride. Contract only their lower halves by two pixels each so the
    # in-game 60 px character walks rather than lunges, without inventing or
    # resampling a single character pixel.
    lower_left = (0, 104, FOOT_X, FOOT_Y)
    lower_right = (FOOT_X, 104, FRAME_W, FOOT_Y)
    clear(frame, (0, 104, FRAME_W, FOOT_Y))
    move_region(frame, contact, lower_left, (2, 0))
    move_region(frame, contact, lower_right, (-2, 0))
    return frame


def side_cycle(idle: Image.Image, contact_a: Image.Image, contact_b: Image.Image) -> list[Image.Image]:
    contact_a = stabilize_side_contact(idle, contact_a)
    contact_b = stabilize_side_contact(idle, contact_b)
    return [
        contact_a,
        side_recoil(contact_a, -1),
        side_intermediate(idle, -2, 0, 3, -3, -1),
        side_intermediate(idle, 1, 0, 5, -4, 1),
        contact_b,
        side_recoil(contact_b, 1),
        side_intermediate(idle, 3, -3, -2, 0, 1),
        side_intermediate(idle, 5, -4, 1, 0, -1),
    ]


def font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def atlas_frame(atlas: Image.Image, row: int, column: int) -> Image.Image:
    return atlas.crop((column * FRAME_W, row * FRAME_H, (column + 1) * FRAME_W, (row + 1) * FRAME_H))


def make_contact_sheet(world: Image.Image, atlas: Image.Image) -> Image.Image:
    cell_w, cell_h = 132, 156
    header_h = 58
    canvas = Image.new("RGB", (cell_w * 9, header_h + cell_h * 4), (12, 15, 20))
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 8), "GREEN PLAYER — IDLE + 8 WALK PHASES / TARGET-TOWN NATIVE 1:1", font=font(20), fill=(244, 229, 185))
    draw.text((12, 34), "Character and town pixels are unscaled. Foot pivot: (32,120).", font=font(13), fill=(184, 204, 190))
    # A road/plaza patch without the baked street character.
    world_patch = world.crop((520, 430, 652, 558)).convert("RGBA")
    for row, direction in enumerate(ROWS):
        for column, phase in enumerate(PHASES):
            x = column * cell_w
            y = header_h + row * cell_h
            tile = world_patch.copy()
            player = atlas_frame(atlas, row, column)
            tile.alpha_composite(player, (cell_w // 2 - FOOT_X, 124 - FOOT_Y))
            canvas.paste(tile.convert("RGB"), (x, y))
            draw.rectangle((x, y, x + cell_w - 1, y + 19), fill=(8, 11, 15))
            draw.text((x + 4, y + 3), f"{direction} {column}:{phase}", font=font(10), fill=(241, 225, 181))
            draw.line((x + cell_w // 2 - 3, y + 124, x + cell_w // 2 + 3, y + 124), fill=(255, 210, 79), width=1)
    return canvas


def make_root_motion_gif(
    world: Image.Image,
    atlas: Image.Image,
    output: Path,
    root_pixels_per_frame: int,
    duration_ms: int,
) -> None:
    panel_w, panel_h = 360, 250
    canvas_w, canvas_h = panel_w * 2, panel_h * 2
    crop = world.crop((430, 330, 790, 580)).convert("RGBA")
    starts = ((605, 410), (740, 500), (480, 530), (660, 560))
    velocities = (
        (0, root_pixels_per_frame),
        (-root_pixels_per_frame, 0),
        (root_pixels_per_frame, 0),
        (0, -root_pixels_per_frame),
    )
    frames: list[Image.Image] = []
    # Three complete 8-phase steps. Runtime evidence uses 5 px / 60 ms.
    for frame_index in range(24):
        phase_column = 1 + frame_index % 8
        canvas = Image.new("RGB", (canvas_w, canvas_h), (10, 13, 18))
        for row, direction in enumerate(ROWS):
            panel = crop.copy()
            start = starts[row]
            velocity = velocities[row]
            foot = (start[0] + velocity[0] * frame_index, start[1] + velocity[1] * frame_index)
            px = foot[0] - 430 - FOOT_X
            py = foot[1] - 330 - FOOT_Y
            panel.alpha_composite(atlas_frame(atlas, row, phase_column), (px, py))
            pd = ImageDraw.Draw(panel)
            pd.rectangle((0, 0, 228, 23), fill=(8, 11, 15, 220))
            pd.text(
                (7, 4),
                f"{direction}  phase {phase_column}/8  {root_pixels_per_frame}px/{duration_ms}ms",
                font=font(12),
                fill=(244, 229, 185, 255),
            )
            # Fixed world markers make root progress and any foot sliding inspectable.
            for marker in range(0, 25, 8):
                mx = start[0] + velocity[0] * marker - 430
                my = start[1] + velocity[1] * marker - 330
                pd.line((mx - 2, my, mx + 2, my), fill=(255, 210, 79, 255), width=1)
            canvas.paste(panel.convert("RGB"), ((row % 2) * panel_w, (row // 2) * panel_h))
        frames.append(canvas)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=False,
        disposal=2,
    )


def assert_candidate(atlas: Image.Image) -> dict[str, object]:
    measurements: dict[str, object] = {"rows": {}}
    for row, direction in enumerate(ROWS):
        hashes: list[str] = []
        boxes: list[list[int]] = []
        for column in range(9):
            frame = atlas_frame(atlas, row, column)
            bbox = frame.getchannel("A").getbbox()
            if bbox is None:
                raise RuntimeError(f"Empty frame {direction}/{column}")
            if bbox[1] != 60 or bbox[3] != FOOT_Y:
                raise RuntimeError(f"Ground/height drift {direction}/{column}: {bbox}")
            hashes.append(hashlib.sha256(frame.tobytes()).hexdigest())
            boxes.append(list(bbox))
        if len(set(hashes)) != 9:
            raise RuntimeError(f"Duplicated pose in {direction}: {len(set(hashes))}/9 unique")
        measurements["rows"][direction] = {
            "uniqueFrames": 9,
            "alphaBBoxes": boxes,
            "framePixelHashes": hashes,
        }
    return measurements


def main() -> None:
    user = Image.open(USER_SOURCE).convert("RGB")
    world = Image.open(WORLD_SOURCE).convert("RGB")

    south_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 0, 0)))
    north_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 1, 0)))
    west_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 2, 0)))
    east_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 3, 0)))
    west_contact_a = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 0, 1)))
    west_contact_b = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 1, 1)))
    east_contact_a = ImageOps.mirror(west_contact_a)
    east_contact_b = ImageOps.mirror(west_contact_b)

    cycles = (
        [south_idle, *front_cycle(south_idle)],
        [west_idle, *side_cycle(west_idle, west_contact_a, west_contact_b)],
        [east_idle, *side_cycle(east_idle, east_contact_a, east_contact_b)],
        [north_idle, *front_cycle(north_idle)],
    )
    atlas = Image.new("RGBA", (FRAME_W * 9, FRAME_H * 4), (0, 0, 0, 0))
    for row, frames in enumerate(cycles):
        for column, frame in enumerate(frames):
            atlas.alpha_composite(frame, (column * FRAME_W, row * FRAME_H))

    measurements = assert_candidate(atlas)
    for output in (ATLAS_OUT, LINEAGE_OUT, CONTACT_OUT, ROOT_GIF_OUT, RUNTIME_SPEED_GIF_OUT):
        output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(ATLAS_OUT, optimize=False)
    make_contact_sheet(world, atlas).save(CONTACT_OUT, optimize=False)
    make_root_motion_gif(world, atlas, ROOT_GIF_OUT, root_pixels_per_frame=3, duration_ms=80)
    make_root_motion_gif(world, atlas, RUNTIME_SPEED_GIF_OUT, root_pixels_per_frame=5, duration_ms=60)

    lineage = {
        "schemaVersion": 1,
        "status": "candidate-not-adopted",
        "candidate": str(ATLAS_OUT.relative_to(REPO)),
        "source": {
            "path": str(USER_SOURCE.relative_to(REPO)),
            "sha256": sha256(USER_SOURCE),
            "custody": "user-direct",
        },
        "worldQaSource": {
            "path": str(WORLD_SOURCE.relative_to(REPO)),
            "sha256": sha256(WORLD_SOURCE),
            "custody": "user-direct",
        },
        "derivation": {
            "script": str(Path(__file__).resolve().relative_to(REPO)),
            "scriptSha256": sha256(Path(__file__).resolve()),
            "operations": [
                "exact 4x2 source-cell crops",
                "black-field alpha isolation",
                "nearest-neighbor normalization to 60px native character height",
                "deterministic source-pixel limb cut/translate articulation",
                "direct profile-idle upper-body stabilization over user-source side contacts",
                "horizontal mirror of user-source west contacts for east contacts",
            ],
            "generatedPixelsUsed": False,
            "resampling": "nearest-neighbor",
        },
        "atlas": {
            "sha256": sha256(ATLAS_OUT),
            "size": [atlas.width, atlas.height],
            "frameSize": [FRAME_W, FRAME_H],
            "pivot": [FOOT_X, FOOT_Y],
            "rows": list(ROWS),
            "columns": list(PHASES),
        },
        "qa": {
            "contactSheet": {
                "path": str(CONTACT_OUT.relative_to(REPO)),
                "sha256": sha256(CONTACT_OUT),
                "nativeCharacterScale": True,
                "nativeTownScale": True,
            },
            "rootMotionGif": {
                "path": str(ROOT_GIF_OUT.relative_to(REPO)),
                "sha256": sha256(ROOT_GIF_OUT),
                "frames": 24,
                "durationMsPerFrame": 80,
                "rootPixelsPerFrame": 3,
            },
            "exactRuntimeSpeedGif": {
                "path": str(RUNTIME_SPEED_GIF_OUT.relative_to(REPO)),
                "sha256": sha256(RUNTIME_SPEED_GIF_OUT),
                "frames": 24,
                "durationMsPerFrame": 60,
                "rootPixelsPerFrame": 5,
                "rootPixelsPerSecond": 83.3333333333,
            },
            "mechanicalMeasurements": measurements,
            "selfEval": {
                "verdict": "pass-as-runtime-speed-eval-candidate; hold-runtime-promotion-for-independent-visual-approval",
                "identity": "pass: every visible head/face pixel is stable per direction and all sprite colors occur in the user-direct source",
                "sizeAndBob": "pass: every frame spans y=60..119 and contacts the fixed y=120 pivot plane",
                "distinctness": "pass: all 9 frames in every direction are byte-distinct; adjacent phases change visible limb pixels",
                "runtimeCadence": "pass: 8 phases at 60ms form a 480ms brisk walk cycle while the root advances exactly 5px per frame (83.33px/s)",
                "profileTransition": "pass as candidate: source contact width was contracted from 36px to 30-32px; stable profile-idle upper body removes the prior identity/size pop",
                "footSliding": "conditional: the exact-speed GIF exposes continuous 5px root motion, but this stylized cycle does not mathematically lock one identified sole to a world coordinate during every stance frame",
                "knownRisk": "independent visual review must decide whether the remaining stylized sole drift is noticeable during actual controls; uniqueness alone is not treated as approval",
            },
        },
        "adoption": {
            "activeRuntimeModified": False,
            "requiresIndependentVisualEval": True,
        },
    }
    LINEAGE_OUT.write_text(json.dumps(lineage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {ATLAS_OUT.relative_to(REPO)} {atlas.width}x{atlas.height}")
    print(f"wrote {CONTACT_OUT.relative_to(REPO)}")
    print(f"wrote {ROOT_GIF_OUT.relative_to(REPO)}")
    print(f"wrote {RUNTIME_SPEED_GIF_OUT.relative_to(REPO)}")
    print(f"wrote {LINEAGE_OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
