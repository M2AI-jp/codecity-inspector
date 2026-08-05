# CodeCity rebuild rules

## Authority

- Before reading any other product section or taking any action, read
  `studio/governance/PRODUCT.md` from its first line, including the mandatory
  failure record. Do not skip directly to a task, checkbox, test, or module.
- Read `studio/governance/PRODUCT.md` before changing product behavior.
- It is the only product specification and remaining-work list.
- Do not restore requirements, assets, or implementations from Git history.
- Do not create another roadmap, SSOT, product diagram, backlog, or historical
  report. Update the checkbox and evidence of the assigned PRODUCT.md item.

## Product KGI

The product is complete only when an end user can point `npx codecity` at their
own repository and play the generated town through request, three
investigations, report, observed town change, exit, and revisit in a real
browser. A folder, contract, test, backend, asset, approval, or partial demo is
never the product KGI by itself.

## Safety and evidence

- Keep every inspected repository read-only. Never execute its source, tests,
  hooks, binaries, or package manager.
- Bind the local server to loopback only. Never upload source or analysis.
- Preserve `observed`, `inferred`, and `unknown` as different states at every
  contract, UI, and dialogue boundary. Untested is not broken.
- The 22 files under `art/references/user-provided/` are immutable originals.
- Only the human owner may promote an asset from candidate to approved master.

## Module boundaries

- Dependencies flow from lower-numbered `ship/` modules to higher-numbered
  modules only, except that `90-cli` is the composition root.
- Cross-module imports use only the target module's `index.mjs`. Deep imports
  into a sibling module are forbidden.
- `40-worldgen` produces logical world data and never imports images, Canvas,
  DOM, server, or CLI code.
- `60-scene-compiler` is the only shipping module that may join a WorldPlan to
  an approved Asset Manifest.
- `70-game-runtime` consumes a serialized SceneBundle. It never inspects a
  repository.
- Shipping code never imports from `studio/`.

## Collaboration

- Workers edit only their assigned `owns` paths and never commit or push.
- The Lead owns integration, product decisions, commits, and publication.
- Distribution and security changes require a separate read-only reviewer.
- Workers may execute only an assigned unchecked PRODUCT.md item and may not
  widen v1 scope.
