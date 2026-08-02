# Art department

This pre-shipping department must become one demand-driven production module:

```text
immutable originals + finite v1 selectors
  -> uncovered work orders
  -> reproducible candidates and measurements
  -> human promotion of exact bytes
  -> deterministic approved shipping catalog
```

Today only original custody and candidate/report write containment are
implemented. Candidate planning, production, palette derivation, review queue,
promotion transaction, and catalog publication are incomplete; see `P1` and
`P2` in `studio/governance/PRODUCT.md`.

`index.mjs` exposes the current custody boundary:

- `ORIGINAL_REGISTRY`, `getOriginalRegistry()`, `findOriginal()`
- `verifyOriginalRegistry()` and `assertOriginalRegistry()`
- `writeCandidate()` and `writeReport()`, which cannot write originals,
  masters, or shipping paths

The machine may prepare every byte and metadata field. Only the human owner
may promote an exact candidate to an approved master.
