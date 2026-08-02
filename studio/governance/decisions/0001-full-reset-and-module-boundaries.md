# Decision 0001: full reset and module boundaries

Date: 2026-08-02

## Owner decision

The owner determined that the prior implementation and generated material had
no product value relative to the 22 original images and `MASTER.md`, and
authorized a complete rebuild.

## Preserved authority

- Git history, solely for recovery.
- The 22 immutable PNG originals under `art/references/user-provided/`.
- `studio/governance/contracts/MASTER.md`.

All other prior working-tree content was removed from the active repository.
No implementation is to be recovered or copied from history or the temporary
recovery location into the rebuild.

## New product boundary

The repository uses numbered shipping modules with one-way dependencies:

```text
10-inspect -> 20-semantics -> 30-town-domain -> 40-worldgen
40-worldgen + 50-art -> 60-scene-compiler
60-scene-compiler -> 70-game-runtime
90-cli is the composition root; 80-local-server is loopback-only
```

The backend verification frontend and asset production factory live in
`studio/` and are independent of the shipping game. A module may be accepted
independently, but only the playable end-user loop is the product KGI.
