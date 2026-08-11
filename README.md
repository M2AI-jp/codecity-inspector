# CodeCity

CodeCity is under development as a local, read-only, top-down pixel-art game.
It reads a repository without executing or modifying it.

## Run

With Node.js 22 or newer, point CodeCity at a repository you are authorized to
inspect:

```sh
npx codecity /path/to/repository
```

CodeCity serves the current generated scene on `127.0.0.1` and opens it in your
browser. Use `--no-open` to print the local URL without opening a browser.

CodeCity reads repository files to build the town. It does not execute or modify
the inspected repository, run its tests, hooks, binaries, or package manager,
upload its source or analysis, or bind the game server to a non-loopback host.

The generated dialogue keeps observed, inferred, and unknown evidence distinct.
Untested code is not reported as broken.

Contributor source checkouts use `studio/governance/PRODUCT.md` as the only
product authority and remaining-work queue; that pre-shipping file is not part
of the npm package.

## Repository divisions

- `art/references/user-provided/`: 22 immutable owner-provided originals; they
  are not production code or package content.
- `studio/governance/PRODUCT.md`: product authority only; it is not package
  content.
- `ship/`: customer-delivered modules, exact shipping art, and custody records.
  Only the human owner may authorize new exact bytes under
  `ship/50-art/assets/`.
