# CodeCity Inspector — Plans

## Goal

Ship a public, local-first Mac MVP that turns a JavaScript or TypeScript repository into an evidence-based habitable-town model — and, once the frontend is rebuilt, a 2D pixel-art city — without uploading or executing the target code.

## MVP tasks

- [x] Build the read-only repository scanner and inspection model `cc:完了` (2026-07-12)
  - owns: `src/scanner.mjs`, `src/inspector.mjs`, `src/server.mjs`, `test/*.test.mjs`
  - parser: exact-locked `@babel/parser` AST; parse failures remain unknown with no heuristic fallback.
  - done when: imports, unresolved local links, cycles, test associations, limits, and an HTTP report are covered by tests.

- [x] Build the habitable-town model, habitability judgement, and seeded layout generator `cc:完了` (2026-07-12)
  - owns: `src/town/{schema,signals,detect,habitability,index,rng,generator,validator}.mjs`, `src/generate-town.mjs`, `test/town/*.test.mjs`
  - pure and deterministic: seeded rng only (no `Date.now` / `Math.random`); pipeline is `inspectRepository` -> `collectSignals` -> `buildTownModel` -> `assessHabitability` -> `generateLayout` -> `validateLayout`/`annotateLayout`.
  - done when: `npm run generate:town` produces a deterministic, validator-checked `town.layout.json` (a failed 役場検査 is not written and exits non-zero) and the town test suite is green.

- [x] Expose the town pipeline as a frozen `/api/town` HTTP contract `cc:完了` (2026-07-12)
  - owns: `src/server.mjs`, `src/town/index.mjs`, `test/server.test.mjs`, `public/index.html`
  - `GET /api/town` returns `{ schemaVersion:1, repository:{name}, generatorVersion, seed, habitability:{level,levelName,canLive,blockers,warnings,pendingInspections,reasons}, model:{facilities,guild,external,summary}, layout }`, where `layout` is the validated, annotated `TownLayout` including `layout.validation`. The existing `GET /api/city` (raw inspection) is unchanged.
  - `public/index.html` is a minimal, CSP-safe placeholder status page — no pixel-art renderer — until the frontend is rebuilt (see below).
  - done when: the endpoint is covered by tests (happy path, determinism, HEAD parity, non-GET rejection, and no source leak) and the server keeps loopback-only binding plus the existing CSP and safety headers.

- [ ] Rebuild the pixel-art city and playable inspection UI `cc:凍結（フロントエンド再構築待ち）`
  - superseded: the alpha pixel-art renderer and its image assets were removed and are gone for good; `public/index.html` is now a minimal placeholder, and a new renderer will be designed against the `/api/town` contract rather than restoring the deleted assets.
  - done when: a new frontend renders `GET /api/town` as a playable town with evidence-backed service gaps visible in the city and a details panel (deferred to a later milestone).

- [ ] Re-establish an original art direction `cc:凍結（フロントエンド再構築待ち）`
  - superseded: the alpha visual reference was deleted with the frontend; no art asset is owned today.
  - done when: a new original, project-bound visual reference is produced alongside the rebuilt renderer, without copying protected game assets or characters.

- [x] Add Mac launch, safety documentation, CI, and onboarding `cc:完了` (2026-07-12)
  - owns: root files and `.github/workflows/ci.yml`
  - source ZIP/clone requires one explicit `npm install`; the launcher never installs dependencies.
  - done when: a Mac user can launch the demo or drag a repository onto `CodeCity.command`, and limitations are plainly documented.

- [x] Complete independent distribution and security review `cc:完了` (2026-07-12)
  - reviewer is read-only and separate from implementers.

- [x] Create the public GitHub repository and publish the reviewed MVP `cc:完了` (2026-07-12)
  - Lead published `v0.1.0-alpha.1` from the independently reviewed commit after the macOS CI run passed.
  - The uploaded ZIP was downloaded again and matched SHA-256 `32eedbc06172aef2c1d667013fd4e891811da00362ae060911890724c19b8f1c`.
  - Note: that alpha ZIP predates the frontend rebuild and still bundles the now-removed pixel-art renderer; the current source tree is backend-only.

## Not in MVP

- Native signed `.app` packaging
- Executing commands from the inspected repository
- Uploading source code or analysis to a remote service
- Universal language support or a claim of complete causal proof
- 3D graphics or copied commercial-game assets
