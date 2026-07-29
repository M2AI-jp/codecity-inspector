# Fable5 runtime asset inventories

This directory contains human-maintained input inventories for the Fable5 Asset Forge runtime
ledger. It is intentionally not a source of approval: an inventory can only point to an existing
pending, approved, or rejected artifact and its independently written provenance/review record.

Use `fable5-runtime-asset-inventory-v1` exactly as documented in
`contracts/fable5-prefab/README.md`. A ledger is valid only when it can re-read every listed
artifact, contract, job pack, provenance record, runtime copy, and SHA-256 digest. It fails
closed if any of those facts drift.

Do not create a record with `state: "approved"` until a human has actually accepted the image.
The Forge has no command that writes a terminal human decision, moves assets to `approved`, or
installs an asset into runtime.

For every `character` asset, a terminal decision must additionally include the approval scope
`character-style-lock`. The ledger rejects an otherwise valid runtime approval without it. That
scope means the project owner completed the nearest-neighbour comparison described in
[`character-style-lock-20260722.md`](character-style-lock-20260722.md) against the authoritative
rendering language and relevant approved cast; mechanical sheet checks alone never establish
drawing-style continuity.
