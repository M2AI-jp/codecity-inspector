# CodeCity Inspector — Plans

> **2026-07-15 再設計実装開始:** 所有者は commit `230d566` の
> [Fable5GameDesign.md](Fable5GameDesign.md) と
> [Fable5AssetPlan.md](Fable5AssetPlan.md) を実装基準として承認した。
> 以下のチェック済み項目は過去の技術実装記録であり、旧gameは
> ゲームデザイン・実機視覚審査に不合格。完成状態を意味しない。
> 現在はFable5再設計の Phase 0 技術・security基盤を独立review済みとし、
> Phase 1 WorldPlan v2と並行するWave A画像制作へ移る地点である。

The historical no-API-billing pipeline notes are documented in [AssetForgePlan.md](AssetForgePlan.md).
The only current product and asset completion authorities are [Fable5GameDesign.md](Fable5GameDesign.md)
and [Fable5AssetPlan.md](Fable5AssetPlan.md).

## Goal

Ship a public, local-first Mac MVP that turns a JavaScript or TypeScript repository into an evidence-based habitable-town model and renders it as a playable, image-backed 2D pixel-art city — without uploading or executing the target code. The procedural Canvas remains only as an explicit fallback when a published image cannot be loaded.

## 現行Fable5完成工程（唯一の進捗正本）

- [x] **Phase 0 — Asset Forge前提整備と独立review（技術・security基盤のみ）**
  - **review済み現在地（2026-07-16）**。Wave Aは109 ID / 128 PNG / 771 declared slots。意味のある制作対象は708 cells（696 expected-nonempty + 12 semantic-transparent）で、63 reserved-transparent slotsを成果数へ水増ししない。
  - 109件の画像生成仕様からgenericな穴埋め語を除去し、全定義の再検算と17件の承認済みreference bytes・権利記録・109件の参照割当を独立監査済み。未承認のカットアウェイ参照画像はpendingのままWave A入力に使わない。
  - generation unit単位のcrop/key/nearest/hard-alpha変換、characterの二段階identity binding、決定論的atlas組立、source snapshotからのbyte-identical deep replayを実装。symlink、欠落、重複、truth label、source/transformed/atlas/recipe/metadata、別identity差替えを含む敵対試験を通した。
  - Wave A一括human承認とA-only atomic v3 exportは、実TTY・発行済みpreview・固定root/出力先・ledger CAS・fsync・再export時のdeep replayを必須化。Wave A実物を旧78承認へ流すpreview/writeは明示拒否し、旧78の定義・manifest・承認metadata・PNG bytesをfreezeした。
  - Asset Forge全161試験、構文、315 JSON parse、diff検査、catalog validate（issues 0）をLeadと独立Terraが再検算し、Phase 0-B/Cのblocker/majorは0。これは素材制作・視覚審査・ゲーム実装のPASSではない。
  - **完成素材は0、Wave A承認bundleも0**。生成source、マゼンタ背景、job pack、pending PNG、透過予約セル、コード上の参照は完成数に含めない。ゲームは未完成であり、所有者の実機承認まで完成を宣言しない。
- [ ] **Phase 1 — `/api/city`由来WorldPlan v2・validator・決定性**
  - **次の実装地点**。Wave A候補画像制作とnative/repeat/ensemble審査、scene blueprint 6枚を並行作業線として開始する。素材制作を独立した「Phase 1」と誤記せず、Phase 3の必須入力として追跡する。
- [ ] **Phase 2 — renderer v2（カットアウェイ、整数表示、DOM本文）**
  - Wave A制作・再生成・人間審査を継続し、rendererへ未承認素材を完成素材として混入させない。
- [ ] **Phase 3 — Wave A 109 IDの一括承認・v3 export済みvertical slice（5施設・橋・階段・地区移動）**
- [ ] **Phase 4 — Wave B 49 IDと14施設の固有verb・full game loop**
- [ ] **初見playtest成功**
- [ ] **技術テスト成功**
- [ ] **所有者の実機・視覚審査成功（完成候補）**
- [ ] **所有者による実機確認後の明示承認（この時点だけ完成）**

## 旧MVP技術記録（現行の完成チェックリストではない）

- [x] Build the read-only repository scanner and inspection model `cc:旧MVP技術実装の記録（2026-07-12）`
  - owns: `src/scanner.mjs`, `src/inspector.mjs`, `src/server.mjs`, `test/*.test.mjs`
  - parser: exact-locked `@babel/parser` AST; parse failures remain unknown with no heuristic fallback.
  - done when: imports, unresolved local links, cycles, test associations, limits, and an HTTP report are covered by tests.

- [x] Build the habitable-town model, habitability judgement, and seeded layout generator `cc:旧MVP技術実装の記録（2026-07-12）`
  - owns: `src/town/{schema,signals,detect,habitability,index,rng,generator,validator}.mjs`, `src/generate-town.mjs`, `test/town/*.test.mjs`
  - pure and deterministic: seeded rng only (no `Date.now` / `Math.random`); pipeline is `inspectRepository` -> `collectSignals` -> `buildTownModel` -> `assessHabitability` -> `generateLayout` -> `validateLayout`/`annotateLayout`.
  - done when: `npm run generate:town` produces a deterministic, validator-checked `town.layout.json` (a failed 役場検査 is not written and exits non-zero) and the town test suite is green.

- [x] Expose the town pipeline as a frozen `/api/town` HTTP contract `cc:旧MVP技術実装の記録（2026-07-12）`
  - owns: `src/server.mjs`, `src/town/index.mjs`, `test/server.test.mjs`, `public/index.html`
  - `GET /api/town` returns `{ schemaVersion:1, repository:{name}, generatorVersion, seed, habitability:{level,levelName,canLive,blockers,warnings,pendingInspections,reasons}, model:{facilities,guild,external,summary}, layout }`, where `layout` is the validated, annotated `TownLayout` including `layout.validation`. The existing `GET /api/city` (raw inspection) is unchanged.
  - `public/` contains a CSP-safe image-backed Canvas renderer with a procedural fallback. It consumes only the frozen API contract and the published Asset Forge manifest.
  - done when: the endpoint is covered by tests (happy path including `layout.validation.ok === true`, invalid-layout rejection, determinism, HEAD parity, non-GET rejection, and no source leak) and the server keeps loopback-only binding plus the existing CSP and safety headers.

- [x] Rebuild the image-backed pixel-art city and playable inspection UI `cc:旧技術実装の記録／デザイン不合格（2026-07-14）`
  - `public/` uses the approved Asset Forge schema-v2 export as its only public image contract. All 78 required assets are approved, exported, hash/dimension validated, and exposed through an in-game inspection view; the procedural fallback remains visible and honest for load failures.
  - the runtime connects terrain/building/NPC/prop variants, full character sheets, four-frame water ripple and construction dust, keyboard movement with collision, walk-to-idle player motion, building details, and the five-tab guild UI.
  - verification: root checks pass 190/190; Asset Forge checks pass 45/45; catalog validation reports 110 definitions, 78 required, and zero issues. A loopback-only browser run observed 78/78 loaded, 78 inspection cards with zero failures, movement, both modal focus traps/Escape/focus restoration, guild tab keyboard navigation, live canvas animation, and zero console warnings/errors.
  - the checked-in `sample/tiny-town` is intentionally an evidence-honest Lv.1 habitable settlement; Lv.5 is not a completion criterion for that sample.

- [x] Record the v1 asset provenance and then-current visual sign-off `cc:旧78素材の承認記録／Fable5品質未達（2026-07-14）`
  - the project owner confirms that all 78 required assets were generated with ChatGPT Pro and accepts them for the game. This resolves the project-level provenance and visual-approval gate recorded in this plan.
  - OpenAI's current [Terms of Use](https://openai.com/policies/terms-of-use/) assign Output to the user as between the user and OpenAI, to the extent permitted by law; its [ChatGPT FAQ](https://help.openai.com/en/articles/6783457-how-chatgpt-works) states that commercial use is allowed for free and paid plans, subject to the Terms and policies. This record is not a warranty of exclusivity or non-infringement: third-party input rights, applicable law, and final release compliance remain the owner's responsibility.

- [x] Asset Forge v1 engine implementation record `cc:v1技術実装の記録／Fable5前提不足（2026-07-13）`
  - mock/dry-run, bounded job packs, PNG/JPEG/WEBP manual import, alpha/trim/grid processing, reject lifecycle, human-only promote guards, and approved-only versioned export are implemented under an independent lockfile.
  - export schema v2 carries frame/state/variant metadata; sprite-grid dimensions and runtime integration rules are covered by tests.
  - `codex-subscription` remains an explicit unavailable stub; no API key, OpenAI SDK, paid fallback, or external command execution exists.
  - the 78 runtime-required candidates were subsequently approved and exported at commit `047ef91`; 32 catalog entries remain optional future enhancements.
  - this completion does not claim that provenance, licence suitability, or final visual quality has been independently cleared.

- [x] Add Mac launch, safety documentation, CI, and onboarding `cc:旧MVP配布技術の記録（2026-07-12）`
  - owns: root files and `.github/workflows/ci.yml`
  - source ZIP/clone requires one explicit `npm install`; the launcher never installs dependencies.
  - done when: a Mac user can launch the demo or drag a repository onto `CodeCity.command`, and limitations are plainly documented.

- [x] Independent distribution and security review record `cc:旧v1差分の審査記録（2026-07-13）`
  - the Asset Forge/runtime/distribution delta received a fresh read-only PASS after snapshot, lifecycle recovery, variant, and package-boundary fixes; the reviewer remained separate from implementation.

- [x] Create the public GitHub repository and publish the reviewed MVP `cc:旧alpha公開の記録（2026-07-12）`
  - Lead published `v0.1.0-alpha.1` from the independently reviewed commit after the macOS CI run passed.
  - The uploaded ZIP was downloaded again and matched SHA-256 `32eedbc06172aef2c1d667013fd4e891811da00362ae060911890724c19b8f1c`.
  - Note: that published alpha ZIP predates the old image-backed frontend. The later 78-asset integration described above was local technical work, failed the Fable5 visual/game-design standard, and is not a current completion claim.

## Not in MVP

- Native signed `.app` packaging
- Executing commands from the inspected repository
- Uploading source code or analysis to a remote service
- Universal language support or a claim of complete causal proof
- 3D graphics or copied commercial-game assets
