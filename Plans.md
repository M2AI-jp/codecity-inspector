# CodeCity Inspector — Plans

The approved implementation program for the no-API-billing game asset pipeline and its integration into the playable Canvas town is documented in [AssetForgePlan.md](AssetForgePlan.md).

## Goal

Ship a public, local-first Mac MVP that turns a JavaScript or TypeScript repository into an evidence-based habitable-town model, renders it with the current procedural Canvas, and then replaces that fallback with a human-approved 2D pixel-art city — without uploading or executing the target code.

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
  - `public/` contains a CSP-safe procedural Canvas renderer with no image assets. It consumes only the frozen API contract.
  - done when: the endpoint is covered by tests (happy path including `layout.validation.ok === true`, invalid-layout rejection, determinism, HEAD parity, non-GET rejection, and no source leak) and the server keeps loopback-only binding plus the existing CSP and safety headers.

- [ ] Rebuild the image-backed pixel-art city and playable inspection UI `cc:技術実装完了・人間レビュー待ち（2026-07-13）`
  - current: `public/` uses approved Asset Forge export schema v2 as the complete contract; legacy v1 remains readable only as an explicitly partial result. Missing/failed art is reported visibly, the procedural fallback remains, and keyboard movement keeps walkability/building collision. Sprite frames, state cues, contextual terrain/building/NPC/prop variants, water ripple, and construction dust are connected. Building details and the HTML/CSS guild UI remain available.
  - catalog: 110 definitions exist; 78 are required by the current runtime and 32 are optional future enhancements. Runtime vocabulary coverage has zero uncovered IDs, but every tracked image row is still `missing` until a human supplies and approves art.
  - next: a human supplies/licences references, visually approves candidates, performs the successful promote ceremony, then reviews the exported art, keyboard behavior, accessibility, and browser console.
  - done when: the approved export manifest drives the town art, movement and inspection work together, and a human completes visual/accessibility review.

- [ ] Re-establish an original art direction `cc:進行中（Asset Forge計画）`
  - superseded: the alpha visual reference was deleted with the frontend; no art asset is owned today.
  - done when: a new original, project-bound visual reference is produced alongside the rebuilt renderer, without copying protected game assets or characters.

- [x] Complete the Asset Forge engine `cc:完了（2026-07-13）`
  - mock/dry-run, bounded job packs, PNG/JPEG/WEBP manual import, alpha/trim/grid processing, reject lifecycle, human-only promote guards, and approved-only versioned export are implemented under an independent lockfile.
  - export schema v2 carries frame/state/variant metadata; sprite-grid dimensions and runtime integration rules are covered by tests.
  - `codex-subscription` remains an explicit unavailable stub; no API key, OpenAI SDK, paid fallback, or external command execution exists.
  - this completion does not claim that any candidate is human-approved or that final art direction is complete.

- [x] Add Mac launch, safety documentation, CI, and onboarding `cc:完了` (2026-07-12)
  - owns: root files and `.github/workflows/ci.yml`
  - source ZIP/clone requires one explicit `npm install`; the launcher never installs dependencies.
  - done when: a Mac user can launch the demo or drag a repository onto `CodeCity.command`, and limitations are plainly documented.

- [x] Complete independent distribution and security review `cc:完了` (2026-07-13)
  - the Asset Forge/runtime/distribution delta received a fresh read-only PASS after snapshot, lifecycle recovery, variant, and package-boundary fixes; the reviewer remained separate from implementation.

- [x] Create the public GitHub repository and publish the reviewed MVP `cc:完了` (2026-07-12)
  - Lead published `v0.1.0-alpha.1` from the independently reviewed commit after the macOS CI run passed.
  - The uploaded ZIP was downloaded again and matched SHA-256 `32eedbc06172aef2c1d667013fd4e891811da00362ae060911890724c19b8f1c`.
  - Note: that alpha ZIP predates the current procedural Canvas frontend. The current source tree has a no-image renderer but no approved image asset set.

## Not in MVP

- Native signed `.app` packaging
- Executing commands from the inspected repository
- Uploading source code or analysis to a remote service
- Universal language support or a claim of complete causal proof
- 3D graphics or copied commercial-game assets
