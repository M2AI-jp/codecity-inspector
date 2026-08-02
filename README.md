# CodeCity

CodeCity turns a repository into a stable, living pixel-art RPG town without
executing or modifying the inspected repository.

The repository is divided into two organizations:

- `ship/`: code, approved assets, and legal material delivered to customers.
- `studio/`: governance, asset production, verification, and evidence that are
  not runtime dependencies.

The single design authority is
`studio/governance/contracts/MASTER.md`. The 22 immutable visual originals are
under `art/references/user-provided/`.

Shipping dependency direction:

```text
10-inspect -> 20-semantics -> 30-town-domain -> 40-worldgen
approved asset manifest -------------------------> 60-scene-compiler
40-worldgen -------------------------------------> 60-scene-compiler
60-scene-compiler -> 70-game-runtime
90-cli composes the pipeline and starts 80-local-server
```

Each module exposes only its `index.mjs`. Sibling deep imports are forbidden.

