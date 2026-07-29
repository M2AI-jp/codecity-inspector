#!/usr/bin/env python3
"""Reconstruct target-town-user-direct-v1.png from the prefab manifest ALONE
(never by loading the master as a drawing input) and prove the result is
pixel-identical to the accepted master.

Two-phase design, kept visibly separate so the proof cannot fool itself:

  Phase 1 (build): start from a fully transparent 1586x992 canvas and
  alpha-composite every prefab in public/fable5-v2/assets/prefabs/manifest.json
  at its recorded cropOriginWorld, in layer/zIndex order. The master PNG is
  NOT opened anywhere in this phase.

  Phase 2 (grade): only now load the master, purely as read-only ground
  truth for a pixel diff against the phase-1 composite. This mirrors what
  HG-03/A1 actually requires of the runtime (prefab-only reconstruction) while
  still letting this tooling report an exact, numeric pass/fail against the
  accepted image.

Why this is expected to be pixel-perfect (not a coincidence): every prefab in
the manifest is an unmodified sub-crop of the master's own pixels (no
resampling, no recoloring -- see each extraction script). Terrain plates
alone already tile the canvas with zero gaps (coverageProof in the manifest).
Wherever two prefabs' opaque pixels overlap, they necessarily agree, because
they were cut from the same source at the same coordinates. So correctness
follows from (a) full terrain coverage and (b) every crop being unresampled,
independent of how tightly any individual alpha mask hugs its object's true
silhouette. This script checks (a) explicitly (terrain-only coverage) before
checking the full composite, so a coverage regression and a mask-precision
issue are never conflated in the report.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw

from _town_prefab_common import (
    PREFAB_ROOT,
    QA_DIR,
    REPO,
    SOURCE,
    SOURCE_SIZE,
    diff_metrics,
    digest,
    font,
    relative,
    validate_exact_source,
    write_json,
)

MANIFEST_PATH = PREFAB_ROOT / "manifest.json"
RECON_PATH = QA_DIR / "town-master-prefab-reconstruction-v1.png"
DIFF_PATH = QA_DIR / "town-master-prefab-reconstruction-diff-v1.png"
CONTACT_PATH = QA_DIR / "town-master-prefab-reconstruction-contact-v1.png"
REPORT_PATH = QA_DIR / "town-master-prefab-reconstruction-report-v1.json"

LAYER_ORDER = ("terrain", "road", "building", "prop", "foreground")


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        raise RuntimeError(
            f"Missing {relative(MANIFEST_PATH)}; run build-target-town-prefab-manifest.py first"
        )
    import json
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def ordered(prefabs: list[dict]) -> list[dict]:
    return sorted(prefabs, key=lambda record: (LAYER_ORDER.index(record["layer"]), record["zIndex"], record["assetId"]))


def composite_layer(prefabs: list[dict], layers: set[str]) -> Image.Image:
    """Phase-1 build: blank transparent canvas, prefabs only, no master read."""
    canvas = Image.new("RGBA", SOURCE_SIZE, (0, 0, 0, 0))
    for record in ordered(prefabs):
        if record["layer"] not in layers:
            continue
        path = REPO / record["path"]
        if not path.exists():
            raise RuntimeError(f"Manifest references a missing prefab file: {record['path']}")
        with Image.open(path) as raw:
            image = raw.convert("RGBA")
        origin = (record["cropOriginWorld"]["x"], record["cropOriginWorld"]["y"])
        if image.size != (record["dimensions"]["width"], record["dimensions"]["height"]):
            raise RuntimeError(f"On-disk size drifted from manifest for {record['assetId']}")
        canvas.alpha_composite(image, origin)
    return canvas


def coverage_check(prefabs: list[dict]) -> dict:
    terrain_only = composite_layer(prefabs, {"terrain"})
    alpha_extrema = terrain_only.getchannel("A").getextrema()
    fully_covered = alpha_extrema == (255, 255)
    missing_pixels = 0
    if not fully_covered:
        histogram = terrain_only.getchannel("A").histogram()
        missing_pixels = sum(histogram[:255])
    return {
        "claim": "terrain plates alone (layer=terrain) fully cover the 1586x992 canvas with zero gaps",
        "alphaExtrema": {"min": alpha_extrema[0], "max": alpha_extrema[1]},
        "fullyCovered": fully_covered,
        "missingPixelCount": missing_pixels,
    }


def make_diff_heatmap(master_rgb: Image.Image, recon_rgb: Image.Image) -> Image.Image:
    from PIL import ImageChops
    difference = ImageChops.difference(master_rgb, recon_rgb).convert("L")
    # Amplify so a handful of off-by-one pixels are still visible at full-image scale.
    amplified = difference.point(lambda value: min(255, value * 12))
    heat = Image.merge("RGB", (amplified, Image.new("L", amplified.size, 0), Image.new("L", amplified.size, 0)))
    return heat


def make_contact_sheet(master_rgb: Image.Image, recon_rgb: Image.Image, heat: Image.Image, report: dict) -> Image.Image:
    scale = 0.5
    thumb_size = (round(SOURCE_SIZE[0] * scale), round(SOURCE_SIZE[1] * scale))
    master_thumb = master_rgb.resize(thumb_size, Image.Resampling.NEAREST)
    recon_thumb = recon_rgb.resize(thumb_size, Image.Resampling.NEAREST)
    heat_thumb = heat.resize(thumb_size, Image.Resampling.NEAREST)

    gap = 24
    margin = 28
    canvas_w = margin * 2 + thumb_size[0] * 3 + gap * 2
    canvas_h = margin * 2 + 60 + thumb_size[1] + 90
    canvas = Image.new("RGB", (canvas_w, canvas_h), (13, 16, 21))
    draw = ImageDraw.Draw(canvas)
    title_font = font(24, bold=True)
    label_font = font(16, bold=True)
    note_font = font(14)

    draw.text((margin, 20), "TARGET-TOWN MASTER — PREFAB-ONLY RECONSTRUCTION PROOF", font=title_font, fill=(243, 225, 174))

    x = margin
    y = margin + 60
    for label, thumb in (("ACCEPTED MASTER (read-only ground truth)", master_thumb),
                          ("RECONSTRUCTED FROM PREFABS ONLY (manifest.json, no master read)", recon_thumb),
                          ("DIFF (amplified x12, red = changed)", heat_thumb)):
        draw.text((x, y - 24), label, font=label_font, fill=(190, 200, 214))
        canvas.paste(thumb, (x, y))
        draw.rectangle((x - 1, y - 1, x + thumb.width, y + thumb.height), outline=(91, 105, 122), width=1)
        x += thumb.width + gap

    footer_y = y + thumb_size[1] + 20
    coverage = report["coverage"]
    diff = report["diff"]
    lines = [
        f"prefabs used: {report['prefabCountTotal']}   layers: {report['prefabCounts']}",
        f"terrain-only coverage: fullyCovered={coverage['fullyCovered']}  missingPixelCount={coverage['missingPixelCount']}",
        f"changed pixels: {diff['changedPixelCount']} / {diff['totalPixelCount']}   maximum channel delta: {diff['maximumChannelDelta']}",
        f"pixelIdentical: {diff['pixelIdentical']}",
    ]
    for index, line in enumerate(lines):
        draw.text((margin, footer_y + index * 22), line, font=note_font, fill=(210, 216, 225))

    return canvas


def main() -> None:
    validate_exact_source()
    manifest = load_manifest()
    prefabs = manifest["prefabs"]

    by_layer: dict[str, int] = {}
    for record in prefabs:
        by_layer[record["layer"]] = by_layer.get(record["layer"], 0) + 1

    print("Phase 1 (build): compositing from prefabs only, master not opened yet.")
    coverage = coverage_check(prefabs)
    print(f"  terrain-only coverage: {coverage}")

    full_composite = composite_layer(prefabs, set(LAYER_ORDER))
    full_alpha_extrema = full_composite.getchannel("A").getextrema()
    fully_opaque_after_all_layers = full_alpha_extrema == (255, 255)
    recon_rgb = full_composite.convert("RGB")
    QA_DIR.mkdir(parents=True, exist_ok=True)
    recon_rgb.save(RECON_PATH, optimize=False)
    print(f"  wrote {relative(RECON_PATH)}")

    print("Phase 2 (grade): loading the accepted master read-only, for comparison only.")
    master_rgb = Image.open(SOURCE).convert("RGB")
    diff = diff_metrics(master_rgb, recon_rgb)
    print(f"  diff: {diff}")

    heat = make_diff_heatmap(master_rgb, recon_rgb)
    heat.save(DIFF_PATH, optimize=False)
    print(f"  wrote {relative(DIFF_PATH)}")

    report = {
        "schemaVersion": 1,
        "manifestPath": relative(MANIFEST_PATH),
        "manifestSha256": digest(MANIFEST_PATH),
        "sourceSha256Compared": digest(SOURCE),
        "prefabCountTotal": manifest["prefabCountTotal"],
        "prefabCounts": by_layer,
        "coverage": coverage,
        "fullyOpaqueAfterAllLayers": fully_opaque_after_all_layers,
        "diff": diff,
        "verdict": "PASS" if (diff["pixelIdentical"] and coverage["fullyCovered"]) else "FAIL",
        "reconstructionPath": relative(RECON_PATH),
        "diffHeatmapPath": relative(DIFF_PATH),
    }

    contact = make_contact_sheet(master_rgb, recon_rgb, heat, report)
    contact.save(CONTACT_PATH, optimize=False)
    report["contactSheetPath"] = relative(CONTACT_PATH)
    print(f"  wrote {relative(CONTACT_PATH)}")

    write_json(REPORT_PATH, report)
    print(f"wrote {relative(REPORT_PATH)}")

    # Fold a compact verification summary back into manifest.json so the
    # manifest's own "status" field reflects the latest proof, without this
    # script becoming a second source of truth for prefab geometry.
    manifest["status"] = (
        "extracted-verified-runtime-integration-pending" if report["verdict"] == "PASS"
        else "extracted-reconstruction-verification-failed"
    )
    manifest["verification"] = {
        "verifiedBy": relative(Path(__file__).resolve()),
        "verdict": report["verdict"],
        "coverage": coverage,
        "diff": diff,
        "reconstructionPath": relative(RECON_PATH),
        "diffHeatmapPath": relative(DIFF_PATH),
        "contactSheetPath": relative(CONTACT_PATH),
        "reportPath": relative(REPORT_PATH),
    }
    write_json(MANIFEST_PATH, manifest)
    print(f"updated {relative(MANIFEST_PATH)} status={manifest['status']}")

    print(f"\nVERDICT: {report['verdict']}")
    if report["verdict"] != "PASS":
        print("Reconstruction did not match the accepted master byte-for-byte. Diagnostics above; not exiting 0.")
        sys.exit(1)


if __name__ == "__main__":
    main()
