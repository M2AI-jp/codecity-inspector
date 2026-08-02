# Art department

This package is the custody boundary for the 22 user-provided PNG originals.
`index.mjs` is intentionally read-only with respect to
`art/references/user-provided/`: it verifies the dimensions, PNG signature, and
the reset-time full SHA-256 values (whose prefixes are recorded in MASTER.md)
and returns an evidence report. It never copies or
edits an original and has no promotion function.

Public API:

- `ORIGINAL_REGISTRY` / `getOriginalRegistry()` — frozen, 22-entry registry
  derived from the preserved authority (filename, dimensions, full hash,
  custody).
- `verifyOriginalRegistry({ repositoryRoot, strictSet })` (also
  `verifyOriginals`) — read-only report with `ok`, `checked`, `entries`,
  `failures`, and unexpected PNG names.
- `assertOriginalRegistry(options)` — same gate, throwing
  `OriginalCustodyError` when any original is missing, tampered, malformed, or
  unlisted.
- `findOriginal(fileOrId)` — lookup for provenance checks.
- `writeCandidate(factoryRoot, relativePath, data)` and `writeReport(...)` —
  the only write helpers. They reject absolute paths, traversal, symlinks,
  `masters/`, `ship/`, and every directory other than `candidates/` or
  `reports/`.

The registry gate does not grant approval. Human approval and shipping are
separate lifecycle steps; nothing in this module can auto-promote a candidate
into `masters/` or `ship/50-art/`.
