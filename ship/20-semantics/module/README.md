# 20-semantics module boundary

`index.mjs` is the only public entry point. The `service/`, `interface/`,
`data/`, `configuration/`, `module/`, `test/`, and `tooling/` directories are
internal to this shipping module and must not be imported by sibling modules.

The implementation is a pure transformation. It receives serialized
`InspectionReport` data, produces serialized `SemanticModel` data, and never
opens paths, executes code, contacts a network, touches a DOM, or mutates its
input.
