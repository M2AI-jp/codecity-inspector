# CodeCity Inspector — Plans

## Goal

Ship a public, local-first Mac MVP that turns a JavaScript or TypeScript repository into an evidence-based 2D pixel-art city without uploading or executing the target code.

## MVP tasks

- [x] Build the read-only repository scanner and inspection model `cc:完了` (2026-07-12)
  - owns: `src/scanner.mjs`, `src/inspector.mjs`, `src/server.mjs`, `test/*.test.mjs`
  - parser: exact-locked `@babel/parser` AST; parse failures remain unknown with no heuristic fallback.
  - done when: imports, unresolved local links, cycles, test associations, limits, and an HTTP report are covered by tests.

- [x] Build the pixel-art city and playable inspection UI `cc:完了` (2026-07-12)
  - owns: `public/index.html`, `public/styles.css`, `public/app.js`, `sample/tiny-town/**`
  - done when: the sample town renders, buildings are selectable, and evidence-backed service failures are visible in the city and details panel.

- [x] Establish an original 16-bit-inspired art direction `cc:完了` (2026-07-12)
  - owns: `public/assets/city-art-direction.png`
  - done when: an original project-bound visual reference exists without copying protected game assets or characters.

- [x] Add Mac launch, safety documentation, CI, and onboarding `cc:完了` (2026-07-12)
  - owns: root files and `.github/workflows/ci.yml`
  - source ZIP/clone requires one explicit `npm install`; the launcher never installs dependencies.
  - done when: a Mac user can launch the demo or drag a repository onto `CodeCity.command`, and limitations are plainly documented.

- [x] Complete independent distribution and security review `cc:完了` (2026-07-12)
  - reviewer is read-only and separate from implementers.

- [x] Create the public GitHub repository and publish the reviewed MVP `cc:完了` (2026-07-12)
  - Lead published `v0.1.0-alpha.1` from the independently reviewed commit after the macOS CI run passed.
  - The uploaded ZIP was downloaded again and matched SHA-256 `32eedbc06172aef2c1d667013fd4e891811da00362ae060911890724c19b8f1c`.

## Not in MVP

- Native signed `.app` packaging
- Executing commands from the inspected repository
- Uploading source code or analysis to a remote service
- Universal language support or a claim of complete causal proof
- 3D graphics or copied commercial-game assets
