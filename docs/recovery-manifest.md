# Recovery Manifest

更新日: 2026-07-19

この文書は、現在の dirty worktree を維持したまま、最初の機能復旧で扱える範囲を固定する。`git reset`、一括 `restore`、フォルダ単位の復元、commit、push は対象外とする。

## 2026-07-19の優先訂正

この文書の古い「22 source」分類は、ユーザー提供物とCodex生成物を混同していた。今後は `docs/user-provided-image-policy.md` と `art/contracts/user-provided-images.json` を優先する。

- 直接提供の証拠がある21枚を `art/references/user-provided/` へ完全一致で保全した。canonical copyは未追跡なので、状態は「作業ツリー保全済み・版管理待ち」である。
- 緑の `character_style_reference_sheet.png` がプレイヤーの正規原画である。
- 青い `character_visual_master.png` と `target-cutaway.png` はCodex生成物であり、ユーザー提供画像とは表示しない。
- ユーザーの明示指示により、完成画像をruntime背景へ直接使える。背景の上に当たり判定、入口、扉、前景、室内、NPC、会話を実装する。
- 下記の削除・復旧方針がこの訂正と矛盾する場合、この訂正を優先する。

## 観測済み

- 旧監査時点では大量のtracked deletion、tracked modification、untracked fileが存在した。件数は作業中に変わるため、この文書を現在値の台帳にはしない。個々の変更は `git status` の実測を優先する。
- production asset 合格数は `art/contracts/asset-inventory.json` 上で 0、Vertical Slice 必須数は 57、fallback は禁止。
- `public/fable5-v2` の機能ファイル 5 件と再構成可能テスト 2 件は tracked deletion で、worktree には存在しない。
- 下記「変更」6 件は worktree に存在する。
- 旧source群は削除状態だったが、直接提供の証拠がある21枚は保護領域へ復旧済み。Codex生成物は別分類とした。
- rootの未分類PNGはGit HEADの `world_visual_master.png` とbyte-identicalだが、名称の由来を示すmetadataは未発見。

## 保護

### 規則・Fable5原文

- `AGENTS.md`
- `Fable5ArtContract.md`
- `Fable5PrefabSpec.md`
- `Fable5VerticalSlice.md`
- `Fable5PlacementGuide.md`
- `Fable5PlacementMatrix.md`
- `Fable5SceneBlueprints.md`
- `tools/asset-forge/contracts/asset-contract.sample.json`

上記8原文は内容を変更しない。数値差異は `Fable5ArtContract.md` §10を優先する。

### 現在worktreeに残るsource

- `art/references/target-town.png`
- `art/references/target-cutaway.png`
- `public/fable5-v2/assets/ui/ui_dialogue_frames.png`

`target-town.png` は2026-07-18のユーザー明示許可により、旧1536×1024 / SHA-256 `e8e1f30a0b92ab2fd6d49d653790b93535bffe56ec0716ef13ac757eae27ea3f` から、新1586×992 / SHA-256 `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607` へ置換された。新画像を最優先の世界品質目標とする。

`target-town.png` はruntime背景として使用できる。背景だけで完成扱いしない。cutawayの現画像はCodex生成候補として扱う。UI source copyはsliceまたは9-slice規則なしにstretchしない。

### Git履歴で同一バイトを確認できるsource

- `tools/asset-forge/references/approved/building_town_hall_sheet.png`
- `tools/asset-forge/references/approved/building_inn_sheet.png`
- `tools/asset-forge/references/approved/building_houses_shops_ruins_sheet.png`
- `tools/asset-forge/references/approved/building_guild_variant_01_sheet.png`
- `tools/asset-forge/references/approved/building_guild_variant_02_sheet.png`
- `tools/asset-forge/references/approved/building_guild_variant_03_sheet.png`
- `tools/asset-forge/references/approved/building_guild_variant_04_sheet.png`
- `tools/asset-forge/references/approved/building_warehouse_sheet.png`
- `tools/asset-forge/references/approved/building_watchtower_sheet.png`
- `tools/asset-forge/references/approved/building_workshop_sheet.png`
- `tools/asset-forge/references/approved/character_visual_master.png`
- `tools/asset-forge/references/approved/field_cobblestone_roads_sheet.png`
- `tools/asset-forge/references/approved/field_harbor_docks_tiles_sheet.png`
- `tools/asset-forge/references/approved/field_stairs_bridges_cliffs_sheet.png`
- `tools/asset-forge/references/approved/object_street_props_sheet.png`
- `tools/asset-forge/references/approved/object_status_markers_sheet.png`
- `tools/asset-forge/references/approved/ui_dialogue_frames_sheet.png`
- `tools/asset-forge/references/approved/ui_guild_roster_sheet.png`
- `tools/asset-forge/references/approved/ui_inspection_report_sheet.png`
- `tools/asset-forge/references/approved/world_visual_master.png`
- `tools/asset-forge/references/approved/provenance/character_visual_master.source-original.png`

このうち直接提供の証拠がある建物、地形、物、UI、world画像は、同じバイト列を `art/references/user-provided/` へ保全済み。元Git blobは復旧証拠として残す。青いcharacter画像とそのprovenance PNGはCodex生成履歴であり、ユーザー原画または独立した品質目標として数えない。

### 既存変更を保全し、この復旧では触らないファイル

- `README.md`
- `SECURITY.md`
- `THIRD_PARTY_NOTICES.md`
- `package.json`
- `docs/game-completion-definition.md`
- `docs/current-state.md`
- `art/README.md`
- `art/contracts/asset-inventory.json`
- `art/production/vertical-slice/README.md`

## 変更

既存差分を保全して、必要箇所だけを監査・変更できる。

- `src/server.mjs`
- `src/town/index.mjs`
- `src/town/world-plan-generator.mjs`
- `src/town/world-plan-validator.mjs`
- `test/server.test.mjs`
- `test/town/signals.test.mjs`

検査対象repositoryのscripts、tests、hooks、package managerは実行しない。テストファイルの変更は実行許可を意味しない。

## 機能だけ復旧

Git HEADの旧ファイルをフォルダ単位で戻さず、機能単位で再利用可否を判定する。生成candidate03背景と青いplayer参照はruntimeから外すが、歩行、入店、会話の正常なロジックは残す。

- `public/fable5-v2/index.html`
- `public/fable5-v2/app.js`
- `public/fable5-v2/styles.css`
- `public/fable5-v2/site-runtime.mjs`
- `public/fable5-v2/world-runtime.mjs`
- `test/world-runtime.test.mjs`
- `test/fable5-generated-prefab-ux.test.mjs`

## 個別判定

subtree単位の一括削除・一括復元を禁止する。既存assetはexact pathとSHA-256を特定して、次のいずれかを個別に付ける。

- `retain`: 現在も使える機能・画像・証拠
- `quarantine`: runtime不採用だが、比較・失敗・出自の証拠として保持
- `superseded`: 後継が確定しており、参照を外す
- `reject`: exact asset単位で不採用理由が確定
- `unknown`: 証拠不足のため削除も採用もしない

青いplayer画像と生成candidate03背景は `quarantine`、既存の歩行・入店・会話ロジックは `retain` とする。review画像、生成履歴、blockoutも自動削除せず、再生成の重複を防ぐ証拠として個別判定する。

## 未分類

- `9e28e43d-56a5-44aa-aa1d-b59461e625dd.png`

観測: worktreeではtracked deletion。Git HEAD blobは1491×1055、SHA-256 `cc2e822092b0a1cff798b540c8898057841def7b4a0d7b6c954da6feb7ae7e5d` で、`tools/asset-forge/references/approved/world_visual_master.png` とbyte-identical。commit `b13d5fd63e70ab98c31c99c8c2b042d980c73932` で追加された。名称由来を示すtext metadataは未発見。

推測: old world masterの別名copyである可能性が高い。

未確認: 誰がどの経路でrootへ置いたか。これが確認できるまで、削除確定・独立品質目標・production assetのいずれにも分類しない。

## 新規作成

### 管理・検証データ

- `docs/recovery-manifest.md`
- `docs/user-provided-image-policy.md`
- `art/contracts/user-provided-images.json`
- `art/contracts/verify-user-provided-images.mjs`
- `art/contracts/source-registry.json`
- `art/production/vertical-slice/manifest.json`
- `art/contracts/program-asset-contract.json`
- `docs/qa/evidence-matrix.md`
- `art/references/user-provided/` の21 canonical copy（作業ツリー保全済み・版管理待ち）

### ProgramAsset実装

- `src/town/program-asset-generator.mjs`
- `src/town/program-asset-validator.mjs`
- `public/fable5-v2/program-asset-runtime.mjs`

### Vertical Slice production出力

出力pathは `art/production/vertical-slice/manifest.json` に先に登録し、そのmanifestに列挙したexact pathだけを作る。master board承認前に個別production assetを生成しない。

## 不足規則・停止条件

- 一覧外のrepository fileを変更する必要が出た場合は、変更前にexact path、型、依存先、失われる機能、復元可能性を提示する。
- `Fable5ArtContract.md`、`Fable5PrefabSpec.md`、`Fable5VerticalSlice.md`で決まらない寸法・pivot・cropは推測で埋めず、manifest上で `unknown` とする。
- Vertical Slice master boardがN1–N9、AC-1〜AC-8、原画比較に合格するまで、ProgramAsset描画と他地区量産へ進まない。
