# CodeCity Inspector — Plans

The approved implementation program for the no-API-billing game asset pipeline and its integration into the playable Canvas town is documented in [AssetForgePlan.md](AssetForgePlan.md).

## Goal

Ship a public, local-first Mac MVP that turns a JavaScript or TypeScript repository into an evidence-based habitable-town model and renders it as a playable, image-backed 2D pixel-art city — without uploading or executing the target code. The procedural Canvas remains only as an explicit fallback when a published image cannot be loaded.

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
  - `public/` contains a CSP-safe image-backed Canvas renderer with a procedural fallback. It consumes only the frozen API contract and the published Asset Forge manifest.
  - done when: the endpoint is covered by tests (happy path including `layout.validation.ok === true`, invalid-layout rejection, determinism, HEAD parity, non-GET rejection, and no source leak) and the server keeps loopback-only binding plus the existing CSP and safety headers.

- [x] Rebuild the image-backed pixel-art city and playable inspection UI `cc:完了（2026-07-14）`
  - `public/` uses the approved Asset Forge schema-v2 export as its only public image contract. All 78 required assets are approved, exported, hash/dimension validated, and exposed through an in-game inspection view; the procedural fallback remains visible and honest for load failures.
  - the runtime connects terrain/building/NPC/prop variants, full character sheets, four-frame water ripple and construction dust, keyboard movement with collision, walk-to-idle player motion, building details, and the five-tab guild UI.
  - verification: root checks pass 190/190; Asset Forge checks pass 45/45; catalog validation reports 110 definitions, 78 required, and zero issues. A loopback-only browser run observed 78/78 loaded, 78 inspection cards with zero failures, movement, both modal focus traps/Escape/focus restoration, guild tab keyboard navigation, live canvas animation, and zero console warnings/errors.
  - the checked-in `sample/tiny-town` is intentionally an evidence-honest Lv.1 habitable settlement; Lv.5 is not a completion criterion for that sample.

- [x] Record the asset provenance and final visual sign-off `cc:ユーザー確認済み（2026-07-14）`
  - the project owner confirms that all 78 required assets were generated with ChatGPT Pro and accepts them for the game. This resolves the project-level provenance and visual-approval gate recorded in this plan.
  - OpenAI's current [Terms of Use](https://openai.com/policies/terms-of-use/) assign Output to the user as between the user and OpenAI, to the extent permitted by law; its [ChatGPT FAQ](https://help.openai.com/en/articles/6783457-how-chatgpt-works) states that commercial use is allowed for free and paid plans, subject to the Terms and policies. This record is not a warranty of exclusivity or non-infringement: third-party input rights, applicable law, and final release compliance remain the owner's responsibility.

- [x] Complete the Asset Forge engine `cc:完了（2026-07-13）`
  - mock/dry-run, bounded job packs, PNG/JPEG/WEBP manual import, alpha/trim/grid processing, reject lifecycle, human-only promote guards, and approved-only versioned export are implemented under an independent lockfile.
  - export schema v2 carries frame/state/variant metadata; sprite-grid dimensions and runtime integration rules are covered by tests.
  - `codex-subscription` remains an explicit unavailable stub; no API key, OpenAI SDK, paid fallback, or external command execution exists.
  - the 78 runtime-required candidates were subsequently approved and exported at commit `047ef91`; 32 catalog entries remain optional future enhancements.
  - this completion does not claim that provenance, licence suitability, or final visual quality has been independently cleared.

- [x] Add Mac launch, safety documentation, CI, and onboarding `cc:完了` (2026-07-12)
  - owns: root files and `.github/workflows/ci.yml`
  - source ZIP/clone requires one explicit `npm install`; the launcher never installs dependencies.
  - done when: a Mac user can launch the demo or drag a repository onto `CodeCity.command`, and limitations are plainly documented.

- [x] Complete independent distribution and security review `cc:完了` (2026-07-13)
  - the Asset Forge/runtime/distribution delta received a fresh read-only PASS after snapshot, lifecycle recovery, variant, and package-boundary fixes; the reviewer remained separate from implementation.

- [x] Create the public GitHub repository and publish the reviewed MVP `cc:完了` (2026-07-12)
  - Lead published `v0.1.0-alpha.1` from the independently reviewed commit after the macOS CI run passed.
  - The uploaded ZIP was downloaded again and matched SHA-256 `32eedbc06172aef2c1d667013fd4e891811da00362ae060911890724c19b8f1c`.
  - Note: that published alpha ZIP predates the current image-backed frontend. The completed 78-asset integration described above is newer local work and is not claimed as pushed or released by this plan.

## Not in MVP

- Native signed `.app` packaging
- Executing commands from the inspected repository
- Uploading source code or analysis to a remote service
- Universal language support or a claim of complete causal proof
- 3D graphics or copied commercial-game assets
