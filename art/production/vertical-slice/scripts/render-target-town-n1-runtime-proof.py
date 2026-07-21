#!/usr/bin/env python3
"""Render a static visual-layout proof from the current target-town runtime contract.

This is intentionally not a browser screenshot. It reproduces the canvas draw
order, native asset crops, camera clamping, and zoom-2 nearest-neighbour layout
used by public/fable5-v2/app.js without executing the site runtime.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO = Path(__file__).resolve().parents[4]
WORLD_RUNTIME = REPO / "public/fable5-v2/world-runtime.mjs"
SITE_RUNTIME = REPO / "public/fable5-v2/site-runtime.mjs"
APP_RUNTIME = REPO / "public/fable5-v2/app.js"

WORLD_PATH = REPO / "public/fable5-v2/assets/world/target-town-user-direct-v1.png"
PLAYER_PATH = REPO / "public/fable5-v2/assets/characters/player-green-4dir-v1.png"
BARTENDER_PATH = REPO / "public/fable5-v2/assets/objects/target-town-inn/bartender-source-visible-v1.png"
FOREGROUND_PATH = REPO / "public/fable5-v2/assets/objects/target-town-inn/entrance-foreground-v1.png"
DIALOGUE_PATH = REPO / "public/fable5-v2/assets/ui/ui_dialogue_frames.png"
USER_DIALOGUE_PATH = REPO / "art/references/user-provided/ui_dialogue_frames_sheet.png"
OUTPUT_PATH = REPO / "art/production/vertical-slice/qa/target-town-n1-runtime-proof-v1.png"

WORLD_SIZE = (1586, 992)
PLAYER_SIZE = (256, 512)
BARTENDER_SIZE = (45, 55)
FOREGROUND_SIZE = (151, 89)
DIALOGUE_SIZE = (1448, 1086)

VIEWPORT = (1200, 540)
ZOOM = 2
ACTOR_FRAME = (64, 128)
ACTOR_PIVOT = (32, 120)
SPAWN_FOOT = (650, 520)
INTERIOR_FOCUS = (212, 345)
ENTRY_FOOT = (212, 438)
NEAR_NPC_FOOT = (224, 400)
NPC_INTERACTION_POINT = (224, 344)
NPC_DIALOGUE_ANCHOR = (224, 309)
NPC_UI_CONNECTOR_ANCHOR = (202, 285)
BARTENDER_ORIGIN = (202, 255)
FOREGROUND_ORIGIN = (145, 397)

DIALOGUE_FRAME = (497, 47, 370, 180)
DIALOGUE_FRAME_INSETS = (24, 22, 24, 40)
SPEECH_BUBBLE = (15, 600, 202, 124)
SPEECH_BUBBLE_INSETS = (20, 18, 20, 36)
CONTINUE_MARKER = (449, 549, 24, 13)

CANVAS_WIDTH = 1248
CANVAS_HEIGHT = 1930
PANEL_X = 24
PANEL_WIDTH = VIEWPORT[0]
PANEL_HEIGHT = VIEWPORT[1]
PANEL_TITLE_HEIGHT = 34
PANEL_GAP = 20
FIRST_PANEL_Y = 104

BACKGROUND = (10, 14, 20, 255)
PANEL_BORDER = (91, 105, 122, 255)
GOLD = (235, 207, 126, 255)
MUTED = (178, 190, 205, 255)
WHITE = (242, 245, 249, 255)


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def relative(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def require_contract_fragments(path: Path, fragments: tuple[str, ...]) -> None:
    source = path.read_text(encoding="utf-8")
    missing = [fragment for fragment in fragments if fragment not in source]
    if missing:
        details = "\n".join(f"  - {fragment}" for fragment in missing)
        raise RuntimeError(
            f"Runtime contract changed; update this proof renderer before use: {relative(path)}\n{details}"
        )


def validate_contracts() -> None:
    require_contract_fragments(
        WORLD_RUNTIME,
        (
            "export const WORLD_WIDTH = 1586;",
            "export const WORLD_HEIGHT = 992;",
            "export const GAMEPLAY_ZOOM = 2;",
            "frameWidth: 64,",
            "frameHeight: 128,",
            "footPivotX: 32,",
            "footPivotY: 120,",
            "spawn: Object.freeze({ x: 650, y: 520 })",
            "bartenderOrigin: Object.freeze({ x: 202, y: 255 })",
            "entranceForegroundOrigin: Object.freeze({ x: 145, y: 397 })",
            "entryFoot: Object.freeze({ x: 212, y: 438 })",
            "cameraFocus: Object.freeze({ x: 212, y: 345 })",
            "npcInteractionPoint: Object.freeze({ x: 224, y: 344 })",
            "npcDialogueAnchor: Object.freeze({ x: 224, y: 309 })",
            "npcUiConnectorAnchor: Object.freeze({ x: 202, y: 285 })",
            "directionRows: Object.freeze({ south: 0, west: 1, east: 2, north: 3 })",
        ),
    )
    require_contract_fragments(
        SITE_RUNTIME,
        (
            "x: 497,",
            "y: 47,",
            "width: 370,",
            "height: 180,",
            "x: 15,",
            "y: 600,",
            "width: 202,",
            "height: 124,",
            "choicePointer: Object.freeze({ x: 29, y: 542, width: 32, height: 24 })",
            "continueMarker: Object.freeze({ x: 449, y: 549, width: 24, height: 13 })",
        ),
    )
    require_contract_fragments(
        APP_RUNTIME,
        (
            "const gap = 46;",
            "const gap = 70;",
            "const preferredX = rightX + frame.width <= state.viewport.width - 8",
            "const preferredX = rightX + bubble.width <= state.viewport.width - 8",
            "speaker.y - frame.height / 2",
            "speaker.y - bubble.height / 2",
            "function drawSpeakerConnector(speaker, tail)",
            "const gutterY = Math.round(tail.y + 12);",
            "context.lineTo(Math.round(tail.x), gutterY);",
            "context.lineTo(Math.round(speaker.x), gutterY);",
            "context.lineTo(Math.round(speaker.x), Math.round(speaker.y));",
            "context.strokeStyle = 'rgba(8, 10, 12, 0.94)';",
            "context.lineWidth = 7;",
            "context.strokeStyle = '#d8cc67';",
            "context.lineWidth = 3;",
            "context.fillRect(Math.round(speaker.x) - 2, Math.round(speaker.y) - 2, 5, 5);",
            "const connectorAnchor = worldToScreen(state.camera, INN_CONTRACT.interior.npcUiConnectorAnchor);",
        ),
    )


def load_asset(path: Path, expected_size: tuple[int, int], mode: str) -> Image.Image:
    if not path.exists():
        raise RuntimeError(f"Missing required asset: {relative(path)}")
    image = Image.open(path)
    image.load()
    if image.size != expected_size:
        raise RuntimeError(
            f"Asset dimensions changed: {relative(path)} actual={image.size} expected={expected_size}"
        )
    return image.convert(mode)


def font(size: int, *, unicode_text: bool = False, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = []
    if unicode_text:
        candidates.extend(
            (
                Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
                Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
            )
        )
    if bold:
        candidates.append(Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"))
    candidates.extend(
        (
            Path("/System/Library/Fonts/SFNS.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        )
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    raise RuntimeError("No suitable system font is available for the QA proof")


def create_camera(focus: tuple[int, int]) -> tuple[int, int]:
    visible_width = VIEWPORT[0] / ZOOM
    visible_height = VIEWPORT[1] / ZOOM
    maximum_x = max(0, WORLD_SIZE[0] - visible_width)
    maximum_y = max(0, WORLD_SIZE[1] - visible_height)
    camera_x = round(max(0, min(maximum_x, focus[0] - visible_width / 2)))
    camera_y = round(max(0, min(maximum_y, focus[1] - visible_height / 2)))
    return camera_x, camera_y


def world_to_screen(camera: tuple[int, int], point: tuple[int, int]) -> tuple[int, int]:
    return (
        round((point[0] - camera[0]) * ZOOM),
        round((point[1] - camera[1]) * ZOOM),
    )


def paste_rgba(destination: Image.Image, source: Image.Image, origin: tuple[int, int]) -> None:
    destination.alpha_composite(source, origin)


def player_frame(atlas: Image.Image, facing: str = "north", column: int = 0) -> Image.Image:
    rows = {"south": 0, "west": 1, "east": 2, "north": 3}
    row = rows[facing]
    left = column * ACTOR_FRAME[0]
    top = row * ACTOR_FRAME[1]
    return atlas.crop((left, top, left + ACTOR_FRAME[0], top + ACTOR_FRAME[1]))


def compose_world(
    world_master: Image.Image,
    bartender: Image.Image,
    foreground: Image.Image,
    frame: Image.Image,
    player_foot: tuple[int, int],
) -> Image.Image:
    # app.js draw order: world, bartender, player, entrance foreground.
    world = world_master.copy()
    paste_rgba(world, bartender, BARTENDER_ORIGIN)
    player_origin = (
        player_foot[0] - ACTOR_PIVOT[0],
        player_foot[1] - ACTOR_PIVOT[1],
    )
    paste_rgba(world, frame, player_origin)
    paste_rgba(world, foreground, FOREGROUND_ORIGIN)
    return world


def render_viewport(world: Image.Image, focus: tuple[int, int]) -> tuple[Image.Image, tuple[int, int]]:
    camera = create_camera(focus)
    visible = (VIEWPORT[0] // ZOOM, VIEWPORT[1] // ZOOM)
    crop = world.crop(
        (
            camera[0],
            camera[1],
            camera[0] + visible[0],
            camera[1] + visible[1],
        )
    )
    return crop.resize(VIEWPORT, Image.Resampling.NEAREST), camera


def crop_native(sheet: Image.Image, crop: tuple[int, int, int, int]) -> Image.Image:
    x, y, width, height = crop
    return sheet.crop((x, y, x + width, y + height))


def text_width(draw: ImageDraw.ImageDraw, value: str, selected_font: ImageFont.ImageFont) -> float:
    box = draw.textbbox((0, 0), value, font=selected_font)
    return box[2] - box[0]


def wrap_canvas_text(
    draw: ImageDraw.ImageDraw,
    value: str,
    selected_font: ImageFont.ImageFont,
    maximum_width: int,
) -> list[str]:
    lines: list[str] = []
    line = ""
    for character in str(value):
        candidate = f"{line}{character}"
        if line and text_width(draw, candidate, selected_font) > maximum_width:
            lines.append(line)
            line = character
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def javascript_round(value: float) -> int:
    return math.floor(value + 0.5)


def draw_speaker_connector(
    viewport: Image.Image,
    speaker: tuple[int, int],
    tail: tuple[float, float],
) -> None:
    tail_point = (javascript_round(tail[0]), javascript_round(tail[1]))
    speaker_point = (javascript_round(speaker[0]), javascript_round(speaker[1]))
    gutter_y = javascript_round(tail[1] + 12)
    points = (
        tail_point,
        (tail_point[0], gutter_y),
        (speaker_point[0], gutter_y),
        speaker_point,
    )

    # The black 94%-opaque under-stroke is composited before the opaque gold
    # stroke, matching drawSpeakerConnector in app.js.
    underlay = Image.new("RGBA", viewport.size, (0, 0, 0, 0))
    underlay_draw = ImageDraw.Draw(underlay)
    underlay_draw.line(points, fill=(8, 10, 12, 240), width=7)
    viewport.alpha_composite(underlay)

    draw = ImageDraw.Draw(viewport)
    draw.line(points, fill=(216, 204, 103, 255), width=3)
    draw.rectangle(
        (
            speaker_point[0] - 2,
            speaker_point[1] - 2,
            speaker_point[0] + 2,
            speaker_point[1] + 2,
        ),
        fill=(255, 241, 162, 255),
    )


def draw_speech_prompt(
    viewport: Image.Image,
    sheet: Image.Image,
    camera: tuple[int, int],
) -> None:
    bubble = crop_native(sheet, SPEECH_BUBBLE)
    speaker_x, speaker_y = world_to_screen(camera, NPC_DIALOGUE_ANCHOR)
    width, height = SPEECH_BUBBLE[2], SPEECH_BUBBLE[3]
    gap = 70
    right_x = speaker_x + gap
    preferred_x = right_x if right_x + width <= VIEWPORT[0] - 8 else speaker_x - width - gap
    x = max(8, min(VIEWPORT[0] - width - 8, preferred_x))
    y = max(8, min(VIEWPORT[1] - height - 8, speaker_y - height / 2))
    paste_rgba(viewport, bubble, (round(x), round(y)))
    connector_anchor = world_to_screen(camera, NPC_UI_CONNECTOR_ANCHOR)
    draw_speaker_connector(
        viewport,
        connector_anchor,
        (x + width / 2, y + height - 5),
    )

    draw = ImageDraw.Draw(viewport)
    label_font = font(14, unicode_text=True)
    action_font = font(13, unicode_text=True)
    left, top, _, _ = SPEECH_BUBBLE_INSETS
    draw.text((x + left, y + top), "宿帳係", font=label_font, fill=(255, 249, 220, 255))
    draw.text(
        (x + left, y + top + 25),
        "Enter / E で話す",
        font=action_font,
        fill=(216, 204, 145, 255),
    )


def draw_dialogue(
    viewport: Image.Image,
    sheet: Image.Image,
    camera: tuple[int, int],
) -> None:
    dialogue = crop_native(sheet, DIALOGUE_FRAME)
    speaker_x, speaker_y = world_to_screen(camera, NPC_DIALOGUE_ANCHOR)
    width, height = DIALOGUE_FRAME[2], DIALOGUE_FRAME[3]
    gap = 46
    right_x = speaker_x + gap
    preferred_x = right_x if right_x + width <= VIEWPORT[0] - 8 else speaker_x - width - gap
    x = max(8, min(VIEWPORT[0] - width - 8, preferred_x))
    y = max(8, min(VIEWPORT[1] - height - 8, speaker_y - height / 2))
    x, y = round(x), round(y)
    paste_rgba(viewport, dialogue, (x, y))
    connector_anchor = world_to_screen(camera, NPC_UI_CONNECTOR_ANCHOR)
    draw_speaker_connector(
        viewport,
        connector_anchor,
        (x + width / 2, y + height - 5),
    )

    draw = ImageDraw.Draw(viewport)
    left, _, right, _ = DIALOGUE_FRAME_INSETS
    text_x = x + left
    text_width_limit = width - left - right
    label_font = font(15, unicode_text=True)
    body_font = font(16, unicode_text=True)
    control_font = font(12, unicode_text=True)
    draw.text(
        (text_x, y + 24),
        "宿帳係　｜　観測",
        font=label_font,
        fill=(158, 244, 207, 255),
    )
    body = (
        "CodeCity Inspector という町名は確認できました。"
        "ファイル総数は、この検査結果だけでは確定していません。"
    )
    lines = wrap_canvas_text(draw, body, body_font, text_width_limit)[:3]
    for index, line in enumerate(lines):
        draw.text(
            (text_x, y + 54 + index * 22),
            line,
            font=body_font,
            fill=(255, 249, 220, 255),
        )
    draw.text(
        (text_x, y + 124),
        "Enter / Space：続ける　Esc：閉じる",
        font=control_font,
        fill=(216, 204, 145, 255),
    )
    marker = crop_native(sheet, CONTINUE_MARKER)
    marker_x = x + width - right - CONTINUE_MARKER[2]
    paste_rgba(viewport, marker, (marker_x, y + 143))


def foreground_overlap_pixels(
    frame: Image.Image,
    foreground: Image.Image,
    player_foot: tuple[int, int],
) -> int:
    player_origin = (
        player_foot[0] - ACTOR_PIVOT[0],
        player_foot[1] - ACTOR_PIVOT[1],
    )
    player_alpha = frame.getchannel("A")
    foreground_alpha = foreground.getchannel("A")
    overlap = 0
    for world_y in range(
        max(player_origin[1], FOREGROUND_ORIGIN[1]),
        min(player_origin[1] + frame.height, FOREGROUND_ORIGIN[1] + foreground.height),
    ):
        for world_x in range(
            max(player_origin[0], FOREGROUND_ORIGIN[0]),
            min(player_origin[0] + frame.width, FOREGROUND_ORIGIN[0] + foreground.width),
        ):
            player_value = player_alpha.getpixel((world_x - player_origin[0], world_y - player_origin[1]))
            foreground_value = foreground_alpha.getpixel(
                (world_x - FOREGROUND_ORIGIN[0], world_y - FOREGROUND_ORIGIN[1])
            )
            if player_value > 0 and foreground_value > 0:
                overlap += 1
    return overlap


def add_entry_occlusion_inset(spawn_view: Image.Image, entry_view: Image.Image, overlap: int) -> None:
    # This is an explicitly labelled second runtime crop inside panel 01, not a
    # claim that the entrance is visible from the exterior spawn camera.
    source_box = (280, 100, 620, 500)
    inset = entry_view.crop(source_box)
    destination = (840, 120)
    draw = ImageDraw.Draw(spawn_view)
    draw.rectangle(
        (destination[0] - 4, destination[1] - 34, destination[0] + inset.width + 3, destination[1] + inset.height + 3),
        fill=(7, 10, 14, 235),
        outline=GOLD,
        width=2,
    )
    draw.text(
        (destination[0] + 8, destination[1] - 27),
        f"ENTRY FOOT {ENTRY_FOOT} · foreground overlap {overlap}px",
        font=font(13, bold=True),
        fill=GOLD,
    )
    spawn_view.alpha_composite(inset, destination)
    draw.rectangle(
        (destination[0] - 1, destination[1] - 1, destination[0] + inset.width, destination[1] + inset.height),
        outline=GOLD,
        width=1,
    )


def paste_panel(
    proof: Image.Image,
    viewport: Image.Image,
    index: int,
    title: str,
) -> None:
    y = FIRST_PANEL_Y + index * (PANEL_TITLE_HEIGHT + PANEL_HEIGHT + PANEL_GAP)
    draw = ImageDraw.Draw(proof)
    draw.text((PANEL_X, y), title, font=font(17, bold=True), fill=WHITE)
    image_y = y + PANEL_TITLE_HEIGHT
    proof.alpha_composite(viewport, (PANEL_X, image_y))
    draw.rectangle(
        (PANEL_X - 1, image_y - 1, PANEL_X + PANEL_WIDTH, image_y + PANEL_HEIGHT),
        outline=PANEL_BORDER,
        width=1,
    )


def main() -> None:
    validate_contracts()

    if digest(DIALOGUE_PATH) != digest(USER_DIALOGUE_PATH):
        raise RuntimeError(
            "Runtime dialogue sheet is not byte-identical to the user-provided dialogue sheet"
        )

    world_master = load_asset(WORLD_PATH, WORLD_SIZE, "RGBA")
    atlas = load_asset(PLAYER_PATH, PLAYER_SIZE, "RGBA")
    bartender = load_asset(BARTENDER_PATH, BARTENDER_SIZE, "RGBA")
    foreground = load_asset(FOREGROUND_PATH, FOREGROUND_SIZE, "RGBA")
    dialogue_sheet = load_asset(DIALOGUE_PATH, DIALOGUE_SIZE, "RGBA")
    north_idle = player_frame(atlas, "north", 0)

    spawn_world = compose_world(
        world_master,
        bartender,
        foreground,
        north_idle,
        SPAWN_FOOT,
    )
    spawn_view, spawn_camera = render_viewport(spawn_world, SPAWN_FOOT)

    entry_world = compose_world(
        world_master,
        bartender,
        foreground,
        north_idle,
        ENTRY_FOOT,
    )
    entry_view, entry_camera = render_viewport(entry_world, INTERIOR_FOCUS)
    entry_overlap = foreground_overlap_pixels(north_idle, foreground, ENTRY_FOOT)
    add_entry_occlusion_inset(spawn_view, entry_view, entry_overlap)

    near_world = compose_world(
        world_master,
        bartender,
        foreground,
        north_idle,
        NEAR_NPC_FOOT,
    )
    prompt_view, interior_camera = render_viewport(near_world, INTERIOR_FOCUS)
    draw_speech_prompt(prompt_view, dialogue_sheet, interior_camera)

    dialogue_view, dialogue_camera = render_viewport(near_world, INTERIOR_FOCUS)
    draw_dialogue(dialogue_view, dialogue_sheet, dialogue_camera)

    proof = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(proof)
    draw.text(
        (24, 20),
        "TARGET-TOWN N=1 — RUNTIME VISUAL LAYOUT PROOF",
        font=font(27, bold=True),
        fill=GOLD,
    )
    draw.text(
        (24, 58),
        "Static compositor of current contracts · NOT A BROWSER CAPTURE · viewport 1200×540 · zoom 2 · nearest-neighbour",
        font=font(15),
        fill=MUTED,
    )
    draw.text(
        (24, 80),
        "Draw order: target-town → bartender → green atlas → entrance foreground → native UI crop → L-connector → text",
        font=font(14),
        fill=MUTED,
    )

    distance = math.dist(NEAR_NPC_FOOT, NPC_INTERACTION_POINT)
    paste_panel(
        proof,
        spawn_view,
        0,
        f"01  EXTERIOR SPAWN   foot={SPAWN_FOOT}   camera={spawn_camera}   facing=north",
    )
    paste_panel(
        proof,
        prompt_view,
        1,
        (
            "02  INN / NPC PROXIMITY + SPEECH BUBBLE   "
            f"foot={NEAR_NPC_FOOT}   camera={interior_camera}   gap=70px   NPC distance={distance:.0f}px ≤ 58px"
        ),
    )
    paste_panel(
        proof,
        dialogue_view,
        2,
        f"03  DIALOGUE FRAME   camera={dialogue_camera}   gap=46px   native 370×180 crop   observed-page layout fixture",
    )

    near_overlap = foreground_overlap_pixels(north_idle, foreground, NEAR_NPC_FOOT)
    footer_y = CANVAS_HEIGHT - 39
    draw.text(
        (24, footer_y),
        (
            f"Observed: current assets + contracts; entry camera={entry_camera}; foreground overlap entry={entry_overlap}px / NPC-near={near_overlap}px.  "
            "Inferred: rasterized system font approximates browser system-ui.  Unknown: DOM/CSS/timing behavior."
        ),
        font=font(13),
        fill=MUTED,
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    proof.convert("RGB").save(OUTPUT_PATH, optimize=False)
    print(f"wrote {relative(OUTPUT_PATH)} {proof.size[0]}x{proof.size[1]}")
    print(f"dialogue-sheet sha256 {digest(DIALOGUE_PATH)}")
    print(f"foreground-over-player overlap entry={entry_overlap}px npc-near={near_overlap}px")


if __name__ == "__main__":
    main()
