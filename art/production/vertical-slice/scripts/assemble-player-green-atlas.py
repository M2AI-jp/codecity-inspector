#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


REPO = Path(__file__).resolve().parents[4]
USER_SOURCE = REPO / "art/references/user-provided/character_style_reference_sheet.png"
GENERATED_RGBA = REPO / "art/production/vertical-slice/boards/candidates/player-green-4x4-imagegen-candidate-01-rgba.png"
ATLAS_OUT = REPO / "public/fable5-v2/assets/characters/player-green-4dir-v1.png"
COMPARISON_OUT = REPO / "art/production/vertical-slice/qa/player-green-source-vs-runtime-v1.png"
WORLD_SOURCE = REPO / "art/references/target-town.png"
WORLD_PROOF_OUT = REPO / "art/production/vertical-slice/qa/player-green-target-town-native-composite-v2.png"
WORLD_LOOPS_OUT = REPO / "art/production/vertical-slice/qa/player-green-target-town-walk-loops-v2.gif"

FRAME_W = 64
FRAME_H = 128
FOOT_Y = 120


def grid_cell(image, columns, rows, column, row):
    left = round(column * image.width / columns)
    top = round(row * image.height / rows)
    right = round((column + 1) * image.width / columns)
    bottom = round((row + 1) * image.height / rows)
    return image.crop((left, top, right, bottom))


def isolate_user_sprite(cell):
    rgb = cell.convert("RGB")
    red, green, blue = rgb.split()
    brightness = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    seed = brightness.point(lambda value: 255 if value > 18 else 0)
    bbox = seed.getbbox()
    if bbox is None:
        raise RuntimeError("No user-source sprite found in expected cell")
    mask = seed.filter(ImageFilter.MaxFilter(7))
    left = max(0, bbox[0] - 4)
    top = max(0, bbox[1] - 4)
    right = min(cell.width, bbox[2] + 4)
    bottom = min(cell.height, bbox[3] + 4)
    sprite = rgb.crop((left, top, right, bottom)).convert("RGBA")
    sprite.putalpha(mask.crop((left, top, right, bottom)))
    return sprite


def isolate_generated_sprite(cell):
    alpha = cell.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("No generated sprite found in expected cell")
    left = max(0, bbox[0] - 1)
    top = max(0, bbox[1] - 1)
    right = min(cell.width, bbox[2] + 1)
    bottom = min(cell.height, bbox[3] + 1)
    return cell.crop((left, top, right, bottom))


def normalize(sprite, target_height=60):
    bbox = sprite.getchannel("A").getbbox()
    sprite = sprite.crop(bbox)
    scale = target_height / sprite.height
    if sprite.width * scale > 60:
        scale = 60 / sprite.width
    width = max(1, round(sprite.width * scale))
    height = max(1, round(sprite.height * scale))
    return sprite.resize((width, height), Image.Resampling.NEAREST)


def frame_from_sprite(sprite):
    sprite = normalize(sprite)
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    x = (FRAME_W - sprite.width) // 2
    y = FOOT_Y - sprite.height
    frame.alpha_composite(sprite, (x, y))
    return frame


def place_frame(atlas, frame, column, row):
    atlas.alpha_composite(frame, (column * FRAME_W, row * FRAME_H))


def passing_frame(idle):
    """Direct-source neutral weight-transfer pose with a fixed ground contact."""
    return idle.copy()


def _clear(frame, box):
    frame.paste((0, 0, 0, 0), box)


def _move_region(frame, source, box, offset):
    crop = source.crop(box)
    frame.alpha_composite(crop, (box[0] + offset[0], box[1] + offset[1]))


def front_back_contact(idle, phase):
    """Build opposite front/back contact poses from direct source pixels.

    Only arms and the bottom 15 px move. Hair, face, beard, vest, belt and the
    upper garment remain byte-for-byte in their source-derived position.
    """
    bbox = idle.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Cannot derive a walk frame from an empty idle")
    leg_top = bbox[3] - 15
    center = (bbox[0] + bbox[2]) // 2
    left_leg = (bbox[0], leg_top, center + 1, bbox[3])
    right_leg = (center - 1, leg_top, bbox[2], bbox[3])
    arm_top = bbox[1] + 27
    arm_bottom = leg_top + 2
    left_arm = (bbox[0], arm_top, bbox[0] + 9, arm_bottom)
    right_arm = (bbox[2] - 9, arm_top, bbox[2], arm_bottom)
    frame = idle.copy()
    for region in (left_leg, right_leg, left_arm, right_arm):
        _clear(frame, region)
    if phase < 0:
        _move_region(frame, idle, left_leg, (-3, 0))
        _move_region(frame, idle, right_leg, (2, -2))
        _move_region(frame, idle, left_arm, (0, 2))
        _move_region(frame, idle, right_arm, (0, -2))
    else:
        _move_region(frame, idle, left_leg, (-2, -2))
        _move_region(frame, idle, right_leg, (3, 0))
        _move_region(frame, idle, left_arm, (0, -2))
        _move_region(frame, idle, right_arm, (0, 2))
    return frame


def checkerboard(width, height, size=12):
    image = Image.new("RGBA", (width, height), (35, 39, 48, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, height, size):
        for x in range(0, width, size):
            if (x // size + y // size) % 2:
                draw.rectangle((x, y, x + size - 1, y + size - 1), fill=(52, 57, 68, 255))
    return image


def contain(image, max_width, max_height):
    scale = min(max_width / image.width, max_height / image.height)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.NEAREST)


def font(size):
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def make_comparison(user_source, generated, atlas):
    canvas = Image.new("RGB", (1800, 1150), (14, 17, 22))
    draw = ImageDraw.Draw(canvas)
    title_font = font(34)
    label_font = font(24)
    note_font = font(19)
    draw.text((50, 28), "PLAYER IDENTITY CHECK — SOURCE FIRST, GENERATED CANDIDATE REJECTED", font=title_font, fill=(242, 224, 173))
    draw.text((50, 82), "USER-DIRECT SOURCE (exact bytes, SHA-256 910e…)", font=label_font, fill=(164, 221, 177))
    draw.text((950, 82), "REJECTED GENERATED CANDIDATE (failure evidence)", font=label_font, fill=(237, 164, 171))

    left = contain(user_source, 800, 540)
    right = contain(generated, 800, 800)
    canvas.paste(left, (50 + (800 - left.width) // 2, 125), left if left.mode == "RGBA" else None)
    generated_bg = checkerboard(right.width, right.height)
    generated_bg.alpha_composite(right.convert("RGBA"))
    canvas.paste(generated_bg.convert("RGB"), (950 + (800 - right.width) // 2, 125))

    draw.text((50, 690), "FINAL RUNTIME IDLES — direct crops from the user source", font=label_font, fill=(164, 221, 177))
    idle_strip = Image.new("RGBA", (FRAME_W * 4, FRAME_H), (0, 0, 0, 0))
    for row in range(4):
        idle_strip.alpha_composite(atlas.crop((0, row * FRAME_H, FRAME_W, (row + 1) * FRAME_H)), (row * FRAME_W, 0))
    idle_strip = idle_strip.resize((FRAME_W * 4 * 3, FRAME_H * 3), Image.Resampling.NEAREST)
    idle_bg = checkerboard(idle_strip.width, idle_strip.height, 24)
    idle_bg.alpha_composite(idle_strip)
    canvas.paste(idle_bg.convert("RGB"), (50, 735))
    draw.text((950, 955), "Rows: south / west / east / north", font=note_font, fill=(210, 214, 222))
    draw.text((950, 992), "Idle frames: direct source crops", font=note_font, fill=(210, 214, 222))
    draw.text((950, 1029), "Walk frames: direct source poses + deterministic pixel motion", font=note_font, fill=(210, 214, 222))
    draw.text((950, 1066), "No blue cap, coat, satchel, or notebook", font=note_font, fill=(210, 214, 222))
    return canvas


def atlas_frame(atlas, row, column):
    return atlas.crop((column * FRAME_W, row * FRAME_H, (column + 1) * FRAME_W, (row + 1) * FRAME_H))


def world_panel(world, atlas, row, column, label, foot=(650, 520), start_marker=None):
    crop_box = (440, 280, 860, 600)
    panel = world.crop(crop_box).convert("RGBA")
    player = atlas_frame(atlas, row, column)
    panel.alpha_composite(player, (foot[0] - FRAME_W // 2 - crop_box[0], foot[1] - FOOT_Y - crop_box[1]))
    draw = ImageDraw.Draw(panel)
    if start_marker is not None:
        marker_x = start_marker[0] - crop_box[0]
        marker_y = start_marker[1] - crop_box[1]
        draw.line((marker_x - 3, marker_y, marker_x + 3, marker_y), fill=(255, 212, 92, 255), width=1)
        draw.line((marker_x, marker_y - 3, marker_x, marker_y + 3), fill=(255, 212, 92, 255), width=1)
    draw.rectangle((0, 0, 250, 30), fill=(10, 13, 18, 220))
    draw.text((10, 5), label, font=font(18), fill=(244, 229, 185, 255))
    return panel


def make_world_proof(world, atlas):
    canvas = Image.new("RGB", (860, 700), (12, 15, 20))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 15), "NATIVE 1:1 TARGET-TOWN COMPOSITE — no background/player resampling", font=font(20), fill=(242, 224, 173))
    panels = [
        world_panel(world, atlas, 0, 0, "south idle — direct source"),
        world_panel(world, atlas, 1, 1, "west walk — direct source"),
        world_panel(world, atlas, 2, 1, "east walk — source mirror"),
        world_panel(world, atlas, 3, 1, "north walk — source pixels"),
    ]
    for index, panel in enumerate(panels):
        x = 10 + (index % 2) * 425
        y = 50 + (index // 2) * 325
        canvas.paste(panel.convert("RGB"), (x, y))
    return canvas


def make_world_loops(world, atlas):
    # Runtime holds each pose for 120 ms while requestAnimationFrame moves the
    # actor continuously. Two 60 ms proof frames per pose reproduce that motion.
    sequence = [1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 2, 2, 3, 3, 2, 2]
    # 5 world px per 60 ms frame is ~83 px/s, matching the runtime gait speed.
    starts = [(650, 470), (690, 520), (610, 520), (650, 550)]
    velocities = [(0, 5), (-5, 0), (5, 0), (0, -5)]
    frames = []
    for frame_index, column in enumerate(sequence):
        canvas = Image.new("RGB", (840, 640), (12, 15, 20))
        for row in range(4):
            start = starts[row]
            velocity = velocities[row]
            foot = (start[0] + velocity[0] * frame_index, start[1] + velocity[1] * frame_index)
            panel = world_panel(
                world,
                atlas,
                row,
                column,
                ["south — 5 px / 60 ms", "west — 5 px / 60 ms", "east — 5 px / 60 ms", "north — 5 px / 60 ms"][row],
                foot=foot,
                start_marker=start,
            )
            x = (row % 2) * 420
            y = (row // 2) * 320
            canvas.paste(panel.convert("RGB"), (x, y))
        frames.append(canvas)
    frames[0].save(WORLD_LOOPS_OUT, save_all=True, append_images=frames[1:], duration=60, loop=0, optimize=False, disposal=2)


def main():
    user = Image.open(USER_SOURCE).convert("RGB")
    generated = Image.open(GENERATED_RGBA).convert("RGBA")
    world = Image.open(WORLD_SOURCE).convert("RGB")
    atlas = Image.new("RGBA", (FRAME_W * 4, FRAME_H * 4), (0, 0, 0, 0))

    south_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 0, 0)))
    west_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 2, 0)))
    east_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 3, 0)))
    north_idle = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 1, 0)))
    west_step_a = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 0, 1)))
    west_step_b = frame_from_sprite(isolate_user_sprite(grid_cell(user, 4, 2, 1, 1)))
    east_step_a = ImageOps.mirror(west_step_a)
    east_step_b = ImageOps.mirror(west_step_b)

    rows = [
        [south_idle, front_back_contact(south_idle, -1), passing_frame(south_idle), front_back_contact(south_idle, 1)],
        [west_idle, west_step_a, passing_frame(west_idle), west_step_b],
        [east_idle, east_step_a, passing_frame(east_idle), east_step_b],
        [north_idle, front_back_contact(north_idle, -1), passing_frame(north_idle), front_back_contact(north_idle, 1)],
    ]
    for row, frames in enumerate(rows):
        for column, frame in enumerate(frames):
            place_frame(atlas, frame, column, row)

    ATLAS_OUT.parent.mkdir(parents=True, exist_ok=True)
    COMPARISON_OUT.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(ATLAS_OUT, optimize=False)
    make_comparison(user, generated, atlas).save(COMPARISON_OUT, optimize=False)
    make_world_proof(world, atlas).save(WORLD_PROOF_OUT, optimize=False)
    make_world_loops(world, atlas)
    print(f"Wrote {ATLAS_OUT.relative_to(REPO)} {atlas.width}x{atlas.height}")
    print(f"Wrote {COMPARISON_OUT.relative_to(REPO)} 1800x1150")
    print(f"Wrote {WORLD_PROOF_OUT.relative_to(REPO)} 860x700")
    print(f"Wrote {WORLD_LOOPS_OUT.relative_to(REPO)} 840x640 animated GIF")


if __name__ == "__main__":
    main()
