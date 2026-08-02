# CodeCity

CodeCity turns a repository into a stable, living pixel-art RPG town without
executing or modifying the inspected repository.

## Release status

**Blocked; this tree is not a releasable game.** Product completion means a
customer can point the one-line command at a repository and, in a real
browser, accept one request, complete exactly three evidence-grounded
investigations, report them, see one permitted observed change, exit, restart,
and revisit the preserved town. Passing module tests is not that KGI.

The current release path intentionally refuses to launch because no
human-approved product assets, shipping manifest, or scene bindings exist.
The normal inspection path also has no producer of an observed reward
transition. No placeholder art, invented observation, or test fixture is used
to bypass either gate.

The repository is divided into two organizations:

- `ship/`: code, approved assets, and legal material delivered to customers.
- `studio/`: governance, asset production, verification, and evidence that are
  not runtime dependencies.

The single design authority is
`studio/governance/contracts/MASTER.md`. The 22 immutable visual originals are
under `art/references/user-provided/`.

The complete intended product/data/production topology is maintained as a
projection in `studio/governance/contracts/PRODUCT-STRUCTURE.md`.

Shipping dependency direction:

```text
10-inspect -> 20-semantics -> 30-town-domain -> 40-worldgen
approved asset manifest -------------------------> 60-scene-compiler
40-worldgen -------------------------------------> 60-scene-compiler
60-scene-compiler -- serialized SceneBundle -----> 70-game-runtime
90-cli composes 10–60 and starts independent 80-local-server
```

Each module exposes only its `index.mjs`. Sibling deep imports are forbidden.
The SceneBundle arrow is a data boundary, not a runtime code import.
