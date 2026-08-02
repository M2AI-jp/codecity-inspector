# CodeCity

CodeCity turns a local repository into a persistent pixel-art RPG town without
executing or modifying the inspected repository.

## Run

With Node.js 22 or newer, point CodeCity at a repository you are authorized to
inspect:

```sh
npx codecity /path/to/repository
```

CodeCity serves the generated town on `127.0.0.1` and opens it in your browser.
Accept the request, visit three investigation sites, report what you found, and
watch the town change. Exit from the game with Escape; rerunning the same
repository lets you revisit the persisted town.

CodeCity reads repository files to build the town. It does not execute or modify
the inspected repository, run its tests, hooks, binaries, or package manager,
upload its source or analysis, or bind the game server to a non-loopback host.
Use `--no-open` to print the local URL without opening a browser.

The generated dialogue keeps observed, inferred, and unknown evidence distinct.
Untested code is not reported as broken.

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

Contributors can run the repository checks with `npm run check`.
