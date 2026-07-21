#!/usr/bin/env python3
"""Assemble imagegen candidates into fixed runtime contracts and QA previews."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[4]
CANDIDATES = ROOT / "art/production/vertical-slice/boards/candidates"
PLAYER_SOURCE_DIR = CANDIDATES / "player-green-imagegen-8walk-v3"
NPC_SOURCE = CANDIDATES / "innkeeper-imagegen-talk-v1-rgba.png"
ROOF_SOURCE = CANDIDATES / "target-town-inn-exterior-closed-v1-rgba.png"
COUNTER_CLEAN_SOURCE = CANDIDATES / "inn-counter-clean-background-imagegen-v1-source.png"
WORLD_SOURCE = ROOT / "art/references/target-town.png"

PLAYER_OUTPUT = ROOT / "public/fable5-v2/assets/characters/player-green-8walk-v4.png"
NPC_OUTPUT = ROOT / "public/fable5-v2/assets/characters/innkeeper-talk-4frame-v2.png"
ROOF_OUTPUT = ROOT / "public/fable5-v2/assets/objects/target-town-inn/inn-exterior-closed-v1.png"
COUNTER_CLEAN_OUTPUT = ROOT / "public/fable5-v2/assets/objects/target-town-inn/inn-counter-clean-plate-v1.png"

QA_DIR = ROOT / "art/production/vertical-slice/qa"
PLAYER_CONTACT_QA = QA_DIR / "player-green-imagegen-8walk-v4-contact.png"
PLAYER_RUNTIME_QA = QA_DIR / "player-green-imagegen-8walk-v4-runtime.gif"
NPC_QA = QA_DIR / "innkeeper-player-style-match-v2.png"
ROOF_QA = QA_DIR / "target-town-inn-closed-open-v1.png"
COUNTER_EDIT_SOURCE = CANDIDATES / "inn-counter-with-baked-npc-edit-source.png"
COUNTER_CLEAN_QA = QA_DIR / "inn-counter-clean-plate-composite-v1.png"

FRAME_WIDTH = 64
FRAME_HEIGHT = 128
FOOT_X = 32
FOOT_Y = 120
DIRECTIONS = ("south", "west", "east", "north")
RUNTIME_FRAME_MS = 70
RUNTIME_SPEED = 75
RUNTIME_FOOT_OFFSETS_Y = tuple((0,) * 9 for _ in DIRECTIONS)
RUNTIME_TARGET_TOPS = (61, 60, 61, 60, 61, 60, 61, 60, 61)


def crisp_alpha(image, threshold=128):
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            pixels[x, y] = (red, green, blue, 255) if alpha >= threshold else (0, 0, 0, 0)
    return image


def keep_largest_component(image):
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    pixels = alpha.load()
    visited = set()
    components = []
    for y in range(image.height):
        for x in range(image.width):
            if pixels[x, y] == 0 or (x, y) in visited:
                continue
            stack = [(x, y)]
            visited.add((x, y))
            component = []
            while stack:
                px, py = stack.pop()
                component.append((px, py))
                for ny in range(max(0, py - 1), min(image.height, py + 2)):
                    for nx in range(max(0, px - 1), min(image.width, px + 2)):
                        if pixels[nx, ny] and (nx, ny) not in visited:
                            visited.add((nx, ny))
                            stack.append((nx, ny))
            components.append(component)
    if not components:
        raise RuntimeError("frame has no visible component")
    keep = set(max(components, key=len))
    output = Image.new("RGBA", image.size, (0, 0, 0, 0))
    source = image.load()
    target = output.load()
    for x, y in keep:
        target[x, y] = source[x, y]
    return output


def split_equal_strip(path, count):
    strip = crisp_alpha(Image.open(path))
    frames = []
    for index in range(count):
        left = round(index * strip.width / count)
        right = round((index + 1) * strip.width / count)
        segment = keep_largest_component(strip.crop((left, 0, right, strip.height)))
        bbox = segment.getchannel("A").getbbox()
        if bbox is None:
            raise RuntimeError(f"empty frame {index}: {path}")
        frames.append(segment.crop(bbox))
    return frames


def normalize_full_character(image, target_height=60, maximum_width=60):
    width = max(1, round(image.width * target_height / image.height))
    if width > maximum_width:
        raise RuntimeError(f"character frame too wide after normalization: {width}px")
    return image.resize((width, target_height), Image.Resampling.NEAREST)


def player_cell(image):
    normalized = normalize_full_character(image, 60)
    cell = Image.new("RGBA", (FRAME_WIDTH, FRAME_HEIGHT), (0, 0, 0, 0))
    x = FOOT_X - normalized.width // 2
    y = FOOT_Y - normalized.height
    cell.alpha_composite(normalized, (x, y))
    return cell


def player_cells_from_common_strip(path, count=8):
    """Scale one whole direction strip once and preserve every source offset.

    Per-frame tight-crop normalization erased the generated planted-foot
    travel by forcing every sole to FOOT_Y. Here all eight source bands share
    one scale and one strip-space origin, so head, body bob, and foot travel
    survive assembly exactly as generated.
    """
    strip = crisp_alpha(Image.open(path))
    segments = []
    bboxes = []
    for index in range(count):
        left = round(index * strip.width / count)
        right = round((index + 1) * strip.width / count)
        segment = keep_largest_component(strip.crop((left, 0, right, strip.height)))
        bbox = segment.getchannel("A").getbbox()
        if bbox is None:
            raise RuntimeError(f"empty player frame {index}: {path}")
        segments.append(segment)
        bboxes.append(bbox)

    maximum_height = max(bottom - top for _, top, _, bottom in bboxes)
    scale = 60 / maximum_height
    cells = []
    for segment in segments:
        resized = segment.resize(
            (max(1, round(segment.width * scale)), max(1, round(segment.height * scale))),
            Image.Resampling.NEAREST,
        )
        alpha = resized.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise RuntimeError(f"empty resized player frame: {path}")
        left, top, right, bottom = bbox
        head_bottom = top + max(1, round((bottom - top) * 0.44))
        alpha_pixels = alpha.load()
        head_pixels = [
            (x, y)
            for y in range(top, head_bottom)
            for x in range(left, right)
            if alpha_pixels[x, y]
        ]
        if not head_pixels:
            raise RuntimeError(f"missing head anchor pixels: {path}")
        head_x = sum(x for x, _ in head_pixels) / len(head_pixels)
        head_y = sum(y for _, y in head_pixels) / len(head_pixels)
        origin_x = round(FOOT_X - head_x)
        origin_y = round(75 - head_y)
        cell = Image.new("RGBA", (FRAME_WIDTH, FRAME_HEIGHT), (0, 0, 0, 0))
        cell.alpha_composite(resized, (origin_x, origin_y))
        cells.append(cell)
    return cells


def warp_planted_lower_body(cell, direction, phase):
    """Hold the planted foot for each two-frame contact pair.

    The actor root still advances 5px every phase. Only the lower 20px are
    deformed 5px against travel on the second phase of each pair; the upper
    body remains continuous, avoiding both skating and whole-body freezes.
    """
    if phase % 2 == 0:
        return cell
    split_y = 108 if direction in ("south", "north") else 104
    travel = 3
    if direction == "west":
        travel = {1: 2, 3: 0, 5: 2, 7: 3}[phase]
    elif direction == "east":
        travel = {1: 4, 3: -3, 5: 4, 7: 3}[phase]
    output = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    output.alpha_composite(cell.crop((0, 0, FRAME_WIDTH, split_y)), (0, 0))

    if direction in ("south", "north"):
        delta = -travel if direction == "south" else travel
        # Preserve native pixels. South omits three seam rows to shorten the
        # planted leg; north repeats them to extend it. No 25% band scaling.
        source_y = split_y - delta
        lower = cell.crop((0, source_y, FRAME_WIDTH, FOOT_Y + 1))
        output.alpha_composite(lower, (0, split_y))
    else:
        delta = travel if direction == "west" else -travel
        for y in range(split_y, FRAME_HEIGHT):
            factor = min(1, (y - split_y) / max(1, FOOT_Y - split_y))
            shift = round(delta * factor)
            output.alpha_composite(cell.crop((0, y, FRAME_WIDTH, y + 1)), (shift, y))
    return output


def normalize_runtime_height(cell, target_top):
    """Normalize head height while keeping the physical sole at y=120.

    Direction strips were generated independently, so their tight heights
    differ by up to five pixels after sole alignment. A vertical-only nearest
    neighbour correction inside the opaque bbox preserves every source colour,
    x silhouette, and the physical foot while giving all directions the same
    one-pixel walk bob rhythm.
    """
    bbox = cell.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("cannot normalize an empty player frame")
    left, top, right, bottom = bbox
    target_height = FOOT_Y - target_top + 1
    content = cell.crop(bbox).resize((right - left, target_height), Image.Resampling.NEAREST)
    output = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    output.alpha_composite(content, (left, target_top))
    return keep_largest_component(output)


def checkerboard(size, cell=8):
    board = Image.new("RGBA", size, (25, 28, 33, 255))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(53, 58, 66, 255))
    return board


def assemble_player():
    atlas = Image.new("RGBA", (FRAME_WIDTH * 9, FRAME_HEIGHT * 4), (0, 0, 0, 0))
    rows = {}
    for row, direction in enumerate(DIRECTIONS):
        raw = player_cells_from_common_strip(PLAYER_SOURCE_DIR / f"{direction}-strip-rgba.png")
        if direction in ("west", "east"):
            raw = [raw[0], raw[1], raw[3], raw[2], raw[4], raw[5], raw[7], raw[7]]
        generated = [
            keep_largest_component(warp_planted_lower_body(cell, direction, phase))
            for phase, cell in enumerate(raw)
        ]
        # The final generated phase is the neutral passing pose. Reusing it as
        # idle removes the visible user-source -> generated-detail snap while
        # preserving the user-provided character's identity and palette.
        idle = generated[-1].copy()
        cells = [
            normalize_runtime_height(cell, RUNTIME_TARGET_TOPS[column])
            for column, cell in enumerate([idle, *generated])
        ]
        rows[direction] = cells
        for column, cell in enumerate(cells):
            atlas.alpha_composite(cell, (column * FRAME_WIDTH, row * FRAME_HEIGHT))
    atlas.save(PLAYER_OUTPUT, optimize=True)

    scale = 2
    label_height = 22
    qa = checkerboard((9 * FRAME_WIDTH * scale, 4 * (FRAME_HEIGHT * scale + label_height)), 16)
    draw = ImageDraw.Draw(qa)
    for row, direction in enumerate(DIRECTIONS):
        y = row * (FRAME_HEIGHT * scale + label_height)
        draw.rectangle((0, y, qa.width, y + label_height), fill=(8, 11, 16, 255))
        draw.text((8, y + 5), f"{direction}: idle + 8 walk phases", fill=(255, 239, 188, 255))
        for column, cell in enumerate(rows[direction]):
            enlarged = cell.resize((FRAME_WIDTH * scale, FRAME_HEIGHT * scale), Image.Resampling.NEAREST)
            qa.alpha_composite(enlarged, (column * FRAME_WIDTH * scale, y + label_height))
    qa.save(PLAYER_CONTACT_QA, optimize=True)

    world = Image.open(WORLD_SOURCE).convert("RGBA")
    panel = world.crop((430, 360, 790, 600)).resize((360, 240), Image.Resampling.NEAREST)
    gif_frames = []
    for phase in range(24):
        frame = Image.new("RGBA", (720, 480), (8, 11, 16, 255))
        for row, direction in enumerate(DIRECTIONS):
            panel_x = (row % 2) * 360
            panel_y = (row // 2) * 240
            frame.alpha_composite(panel, (panel_x, panel_y))
            walk_phase = phase % 8
            column = walk_phase + 1
            sprite = atlas.crop((column * 64, row * 128, (column + 1) * 64, (row + 1) * 128))
            root_delta = round(phase * RUNTIME_SPEED * RUNTIME_FRAME_MS / 1000)
            if direction == "west":
                root_x, root_y = 280 - root_delta, 176
            elif direction == "east":
                root_x, root_y = 60 + root_delta, 176
            elif direction == "north":
                root_x, root_y = 180, 205 - root_delta
            else:
                root_x, root_y = 180, 75 + root_delta
            frame.alpha_composite(
                sprite,
                (
                    panel_x + root_x - FOOT_X,
                    panel_y + root_y - FOOT_Y + RUNTIME_FOOT_OFFSETS_Y[row][column],
                ),
            )
            ImageDraw.Draw(frame).text(
                (panel_x + 8, panel_y + 8),
                f"{direction} 75px/s · 70ms phase {walk_phase + 1}/8",
                fill=(255, 239, 188, 255),
            )
        gif_frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=255))
    gif_frames[0].save(
        PLAYER_RUNTIME_QA,
        save_all=True,
        append_images=gif_frames[1:],
        duration=RUNTIME_FRAME_MS,
        loop=0,
        disposal=2,
    )
    return atlas


def assemble_npc():
    source_frames = split_equal_strip(NPC_SOURCE, 4)
    cell_width = 96
    cell_height = 64
    atlas = Image.new("RGBA", (cell_width * 4, cell_height), (0, 0, 0, 0))
    cells = []
    for index, source in enumerate(source_frames):
        full = normalize_full_character(source, 70, maximum_width=88)
        visible = full.crop((0, 0, full.width, min(56, full.height)))
        cell = Image.new("RGBA", (cell_width, cell_height), (0, 0, 0, 0))
        cell.alpha_composite(visible, ((cell_width - visible.width) // 2, 4))
        atlas.alpha_composite(cell, (index * cell_width, 0))
        cells.append(cell)
    atlas.save(NPC_OUTPUT, optimize=True)

    world = Image.open(WORLD_SOURCE).convert("RGBA")
    world.crop((150, 210, 300, 380)).save(COUNTER_EDIT_SOURCE, optimize=True)
    crop = world.crop((150, 210, 300, 380)).resize((300, 340), Image.Resampling.NEAREST)
    qa = checkerboard((300 + 4 * 192, 340), 16)
    qa.alpha_composite(crop, (0, 0))
    for index, cell in enumerate(cells):
        qa.alpha_composite(cell.resize((192, 128), Image.Resampling.NEAREST), (300 + index * 192, 106))
    ImageDraw.Draw(qa).text((8, 8), "source NPC | generated same-style NPC frames", fill=(255, 239, 188, 255))
    qa.save(NPC_QA, optimize=True)
    return atlas


def assemble_roof():
    source = crisp_alpha(Image.open(ROOF_SOURCE))
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("closed inn candidate is empty")
    building = source.crop(bbox).resize((397, 402), Image.Resampling.NEAREST)
    building = crisp_alpha(building)
    building.save(ROOF_OUTPUT, optimize=True)

    world = Image.open(WORLD_SOURCE).convert("RGBA")
    exterior = world.copy()
    exterior.alpha_composite(building, (8, 72))
    open_crop = world.crop((0, 50, 430, 532))
    closed_crop = exterior.crop((0, 50, 430, 532))
    qa = Image.new("RGBA", (860, 514), (8, 11, 16, 255))
    qa.alpha_composite(closed_crop, (0, 32))
    qa.alpha_composite(open_crop, (430, 32))
    draw = ImageDraw.Draw(qa)
    draw.text((8, 8), "EXTERIOR: CLOSED ROOF", fill=(158, 244, 207, 255))
    draw.text((438, 8), "INTERIOR: OPEN CUTAWAY", fill=(255, 217, 132, 255))
    qa.save(ROOF_QA, optimize=True)
    return building


def assemble_counter_clean_plate(npc_atlas):
    # Imagegen returns a square edit. Restore the exact source-crop aspect,
    # then retain only Terra's measured old-NPC repair rectangle (world
    # x=200..249, y=255..312). The rest of the exact user background remains
    # untouched, so this cannot become a replacement interior painting.
    clean_crop = Image.open(COUNTER_CLEAN_SOURCE).convert("RGBA").resize((150, 170), Image.Resampling.NEAREST)
    patch = clean_crop.crop((50, 45, 99, 102))
    patch.save(COUNTER_CLEAN_OUTPUT, optimize=True)

    world = Image.open(WORLD_SOURCE).convert("RGBA")
    source = world.crop((150, 210, 300, 380))
    cleaned = source.copy()
    cleaned.alpha_composite(patch, (50, 45))
    integrated = cleaned.copy()
    npc = npc_atlas.crop((2 * 96, 0, 3 * 96, 64))
    integrated.alpha_composite(npc, (26, 50))
    qa = Image.new("RGBA", (900, 340), (8, 11, 16, 255))
    for index, image in enumerate((source, cleaned, integrated)):
        qa.alpha_composite(image.resize((300, 340), Image.Resampling.NEAREST), (index * 300, 0))
    draw = ImageDraw.Draw(qa)
    draw.text((8, 8), "SOURCE: baked NPC", fill=(255, 217, 132, 255))
    draw.text((308, 8), "CLEAN: 49x57 patch", fill=(158, 244, 207, 255))
    draw.text((608, 8), "INTEGRATED: new NPC", fill=(158, 244, 207, 255))
    qa.save(COUNTER_CLEAN_QA, optimize=True)
    return patch


def main():
    player = assemble_player()
    npc = assemble_npc()
    roof = assemble_roof()
    counter = assemble_counter_clean_plate(npc)
    print(f"{PLAYER_OUTPUT.relative_to(ROOT)} {player.width}x{player.height}")
    print(f"{NPC_OUTPUT.relative_to(ROOT)} {npc.width}x{npc.height}")
    print(f"{ROOF_OUTPUT.relative_to(ROOT)} {roof.width}x{roof.height}")
    print(f"{COUNTER_CLEAN_OUTPUT.relative_to(ROOT)} {counter.width}x{counter.height}")
    for path in (PLAYER_CONTACT_QA, PLAYER_RUNTIME_QA, NPC_QA, ROOF_QA, COUNTER_CLEAN_QA):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
