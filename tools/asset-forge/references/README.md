# Asset Forge references

Reference images are supplied by a human project owner.

- Codex must not fetch reference images from external sites.
- Do not add commercial-game art or other third-party copyrighted assets.
- Approved references are the only strong references used by default.
- Using a pending reference requires the explicit `--allow-pending-reference` flag.
- Every reference declaration records a `licenseNote`.
- Every present reference records its SHA-256 hash in metadata.
- A `missing` placeholder is unknown input, not a broken reference.
- No reference image is included by the W1 scaffold.

Placeholders are declared in `../data/manifests/references.json`. Human approval and
provenance review must happen before a placeholder changes to `approved`.
