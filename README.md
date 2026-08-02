# CodeCity

CodeCity turns a local repository into a persistent pixel-art RPG town without
executing or modifying the inspected repository.

## Status

CodeCity v1 is under construction and is not release-ready. The command-line,
repository, world, compiler, runtime, and loopback-server boundaries exist,
but the approved visual catalog and the complete packed-package browser journey
do not.

The product is complete only when a user can run:

```sh
npx codecity /path/to/repository
```

and finish request -> three investigations -> report -> visible observed town
change -> exit -> process restart -> revisit in a real browser.

Contributor source checkouts use `studio/governance/PRODUCT.md` as the only
product authority and remaining-work queue; that pre-shipping file is not part
of the npm package. Historical plans and chat transcripts are intentionally
absent from the active tree.

## Repository divisions

- `art/references/user-provided/`: 22 immutable owner-provided originals;
  neither production code nor package content.
- `studio/`: pre-shipping governance, art production, tests, and release
  evidence; excluded from the npm package.
- `ship/`: customer-delivered product modules and approved bytes only.

Run enabling checks with `npm run check`. Passing them does not establish the
product KGI.
