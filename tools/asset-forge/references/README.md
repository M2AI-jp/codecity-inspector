# Asset Forge references

Reference images are either supplied by the human project owner or generated locally by Codex
after an explicit owner request. Their origin and approval state are recorded separately.

- Codex must not fetch reference images from external sites.
- Do not add commercial-game art or other third-party copyrighted assets.
- Approved references are the only strong references used by default.
- Required assets always reject pending references; the pending escape hatch is optional-only.
- Every reference declaration records a `licenseNote`.
- Every present reference records its SHA-256 hash in metadata.
- A `missing` placeholder is unknown input, not a broken reference, but required jobs cannot use it.
- The approved set contains 19 subject/category sheets and `world_visual_master`.
- `cutaway_interior_visual_reference` is a Codex-generated pending candidate with its exact prompt,
  input-reference hash, and original output hash recorded. It is not an approved production input.

References are declared in `../data/manifests/references.json`. Every required asset declares
exactly `world_visual_master` and one directly targeted primary sheet. Human approval and
provenance review must happen before any future pending reference changes to `approved`.

## Intake sheets

Human-provided composite sheets are stored in `approved/` with stable ASCII filenames. Their
manifest entries may include `targetAssetIds` so one sheet can be found from every asset it
can inform. This is an intake/indexing relationship only: it does not make the sheet a final
candidate, does not add it to a generation job automatically, and does not approve either the
reference or any derived image.

Generated text, UI mockups, incidental characters, scene backgrounds, and mixed-size callouts
inside a composite sheet are reference-only. Final assets must be isolated or regenerated to
their declared dimensions, transparency, grid, and tile-seam contracts before manual import.

## Generated pending references

Owner-requested generated reference candidates remain in `pending/`. A pending record must identify
the built-in generation mode, exact prompt snapshot, approved input-reference hashes, and untouched
source image bytes. This provenance does not approve the image. A separate human decision and any
required rights review are still necessary before moving it to `approved/` or using it for a
required production asset.
