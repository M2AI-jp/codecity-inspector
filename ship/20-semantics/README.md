# 20 Semantics

Purely converts an `InspectionReport` into a `SemanticModel`. It cannot read the
filesystem or invent observed evidence, placement, collision, or game behavior.

The only public module is [`index.mjs`](./index.mjs). It exports:

```js
import {
  inferSemanticModel,
  normalizeSemanticModel,
} from './ship/20-semantics/index.mjs';
```

`inferSemanticModel(inspection)` is shorthand for
`normalizeSemanticModel({ inspection })`. Both functions accept an
`InspectionReport` v1 and reject an unknown report schema version instead of
guessing. They return a JSON-serializable `SemanticModel` v1:

```text
{
  schemaVersion: 1,
  inspectionDigest: <sha256 of canonical inspection JSON>,
  repository: { name, identity },
  files: [{ fileId, path, role, evidence }],
  connections: [{ id, direction, kind, target, sourceFileIds, evidence }],
  capabilities: {
    entrypoint, persistence, configuration, build, test,
    observability, recovery, distribution, externalConnections
  }
}
```

Roles are `service`, `interface`, `data`, `configuration`, `test`, `tooling`,
or `module`. A file whose signals are absent or contradictory is represented as
`module` with an `unknown` evidence item; absence is never treated as a
negative fact. File and connection evidence are tri-bags with `observed`,
`inferred`, and `unknown` arrays. Capabilities use `{ state, evidence }`.

Only observed keys already present in `inspection.evidence.observed` may appear
as observed in the result. Path, extension, graph, and manifest heuristics are
always `inferred`. Optional annotations may identify an existing file by its
known `fileId` or exact `path`, and may add only `inferred` or `unknown`
rationale. Annotations cannot create files, observed facts, placement,
coordinates, collision, or game behavior.

All lists are sorted and duplicate-free. No input object is mutated, and the
result's `JSON.stringify` bytes are deterministic for equivalent inspection
data.
