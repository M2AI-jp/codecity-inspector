#!/usr/bin/env python3
"""Extract the user-provided dialogue crops and remove only edge-connected matte pixels."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "public/fable5-v2/assets/ui/ui_dialogue_frames.png"
OUTPUT_DIR = ROOT / "public/fable5-v2/assets/ui"
QA_PATH = ROOT / "art/production/vertical-slice/qa/ui-dialogue-transparent-v2.png"

CROPS = {
    "speech-bubble-transparent-v2.png": (15, 600, 217, 724),
    "dialogue-frame-transparent-v2.png": (497, 47, 867, 227),
}


def color_distance(left, right):
    return max(abs(left[index] - right[index]) for index in range(3))


def remove_connected_matte(image):
    pixels = image.load()
    width, height = image.size
    corner_colors = [
        pixels[0, 0],
        pixels[width - 1, 0],
        pixels[0, height - 1],
        pixels[width - 1, height - 1],
    ]
    key = tuple(round(sum(color[index] for color in corner_colors) / 4) for index in range(3))
    queue = deque()
    visited = set()

    def eligible(x, y):
        red, green, blue, alpha = pixels[x, y]
        if alpha == 0:
            return True
        return color_distance((red, green, blue), key) <= 20

    for x in range(width):
        for y in (0, height - 1):
            if eligible(x, y):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if eligible(x, y):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or not eligible(x, y):
            continue
        visited.add((x, y))
        pixels[x, y] = (0, 0, 0, 0)
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    return image, len(visited)


def checkerboard(size):
    width, height = size
    board = Image.new("RGBA", size, (28, 31, 36, 255))
    draw = ImageDraw.Draw(board)
    cell = 8
    for y in range(0, height, cell):
        for x in range(0, width, cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(57, 61, 68, 255))
    return board


def main():
    source = Image.open(SOURCE).convert("RGBA")
    outputs = []
    for filename, box in CROPS.items():
        crop, removed = remove_connected_matte(source.crop(box))
        path = OUTPUT_DIR / filename
        crop.save(path, optimize=True)
        outputs.append((path, crop, removed))

    gap = 24
    qa_width = sum(image.width for _, image, _ in outputs) + gap * (len(outputs) + 1)
    qa_height = max(image.height for _, image, _ in outputs) + gap * 2
    qa = checkerboard((qa_width, qa_height))
    x = gap
    for _, image, _ in outputs:
        qa.alpha_composite(image, (x, gap))
        x += image.width + gap
    qa.save(QA_PATH, optimize=True)

    for path, image, removed in outputs:
        transparent = sum(1 for alpha in image.getchannel("A").getdata() if alpha == 0)
        print(f"{path.relative_to(ROOT)} {image.width}x{image.height} removed={removed} transparent={transparent}")
    print(QA_PATH.relative_to(ROOT))


if __name__ == "__main__":
    main()
