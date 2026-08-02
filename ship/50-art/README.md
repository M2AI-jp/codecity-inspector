# 50 Shipping Art Contract

The shipping side consumes one versioned, immutable manifest. It never looks
inside `studio/` and it never invents a visual fallback. A missing or incomplete
entry is a hard error.

## Public API

`index.mjs` exports:

- `validateAssetManifest(manifest, { assetRoot, verifyFiles })` (also
  `validateManifest`): validates the schema and, when `assetRoot` is supplied,
  checks each PNG signature, IHDR dimensions, and SHA-256 bytes.
- `loadAssetManifest(path, options)` (also `loadAndValidateAssetManifest`):
  reads JSON and applies the same validator.
- `resolveAsset(manifest, assetId, { assetRoot })` (also
  `resolveAssetBinding`): returns one accepted metadata binding, never an
  absolute filesystem path. Unknown IDs and all fallback options throw
  `AssetContractError`.
- `readPngMetadata(assetRoot, relativePath)` and
  `sha256File(assetRoot, relativePath)` perform rooted, symlink-rejecting file
  checks without exposing a reusable path.

Errors are `AssetContractError` instances with a stable `code` and an
`issues[]` list containing field paths. Callers should surface these errors;
they must not substitute another asset.

## Manifest v1

```json
{
  "format": "codecity.asset-manifest",
  "schemaVersion": 1,
  "manifestVersion": "1.0.0",
  "fallbackPolicy": "none",
  "assets": [{
    "id": "char_innkeeper_idle_v1",
    "version": "1.0.0",
    "status": "accepted",
    "accepted": true,
    "path": "characters/innkeeper/idle.png",
    "url": "/assets/characters/innkeeper/idle.png",
    "sha256": "<64 lowercase hex characters>",
    "dimensions": { "width": 32, "height": 32 },
    "pivot": { "x": 16, "y": 30 },
    "usage": {
      "kind": "character",
      "layer": "actor",
      "frame": { "width": 32, "height": 32, "columns": 1, "rows": 1 },
      "collision": { "kind": "none" },
      "animations": { "idle": { "south": { "frames": [0], "fps": 4 } } }
    },
    "license": { "spdx": "CC0-1.0", "holder": "human owner" },
    "provenance": {
      "kind": "derived",
      "source": "art/references/user-provided/<original>.png",
      "sourceSha256": "<64 hex characters>",
      "custody": "user-direct",
      "evidence": "observed"
    },
    "approval": {
      "recordId": "approval-...",
      "actorType": "human",
      "authority": "owner",
      "approvedBy": "human owner",
      "approvedAt": "2026-08-02T00:00:00.000Z",
      "decision": "accepted",
      "assetId": "char_innkeeper_idle_v1",
      "assetSha256": "<the accepted asset hash>",
      "sourceSha256": "<the provenance source hash>"
    }
  }]
}
```

Every entry must be `status: "accepted"` and `accepted: true`, include a
human approval record, and include `sha256`, dimensions, an in-bounds integer
pivot, runtime `usage`, license, and provenance. `usage.frame` must tile the
declared dimensions exactly. Collision is either `{ "kind": "none" }` or a
bounded integer `{ "kind": "rect", "x", "y", "width", "height" }`. Character
usage declares direction-aware animation frame arrays and FPS; building usage
declares a bounded entrance rectangle. `fallbackPolicy` is required to be
`none`; fallback keys in either the manifest or resolver options are rejected.
PNG bytes must use a supported non-interlaced format and contain complete,
bounded, decodable scanlines. Manifest shape, nesting, strings, animation
states, and frame arrays are bounded for both JSON-file and direct-object input.

The contract's own golden and invalid tests live in
`manifest.test.mjs` and use a temporary PNG, leaving the 22 user originals
untouched.
