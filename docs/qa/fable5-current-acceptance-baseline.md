# Fable5 受入ベースライン（履歴）

> **状態:** 2026-07-22 に作成した履歴上の受入ベースラインである。これは現行revisionの
> 受入証拠でも、現行状態の正本でもない。以下の各節にある「現行」「開始時Current」「未決定」
> 「検出できなかった」は、すべてこのベースラインを作成した時点の記録として読む。歴史上の
> 事実は保持するが、現在の判定にそのまま流用してはならない。
>
> **現行差分（2026-07-22、文書記録に基づく。テスト再実行・ブラウザ再検証はしていない）:**
> この差分は、以下の履歴記述と矛盾する現在状態を置き換える。受入範囲のDEC-01–04は、
> `docs/fable5-product-completion-roadmap.md` のP0記録で決定済みである。同ロードマップは
> `user_target_town_current` を可視正本、runtime asset ledgerを素材受入基準とし、音声と
> 3建物・3調査方式・保存/復元・3リポジトリ比較を完成スコープに残すと記録する。これは
> scopeの決定であり、受入PASSや現行browser証拠を意味しない。
>
> - **Observed:** 以前のinnkeeper (`bartender`) 640×512 / 4×10 runtime bindingは、frozen ledger
>   とともに履歴として残る。ただし2026-07-22の新しいcharacter visual-style authorityにより
>   withdrawnされ、現行runtimeはそのsheetを読まない。置換は人間承認待ちである。
> - **UNMET:** playerはlegacy sheetのままで、approved Fable5 export / provenance / frozen bindingへ
>   の昇格が未了である。city hall と residence はapproved interior kit、visible props、NPC、
>   runtime binding、およびcustomer-facing portalが未了であり、現在は
>   `blocked-pending-approved-interior` として利用不可である。
> - **Unknown:** 現行worktree/revisionの実ブラウザsession、1280×720・1920×1080のcapture、
>   network / console / error記録、および同一revisionに結び付くHard Gate判定と所有者の
>   実プレイ受入。したがって、過去のbrowser smokeや静的テストの記録をこの受入のbrowser
>   evidence packetとして扱わない。
>
> この差分の作成自体は、コード、テスト、server、package managerを実行していない。現在状態は
> `docs/current-state.md`、実行順とscope決定は`docs/fable5-product-completion-roadmap.md`を参照する。

**作成時の用途:** これは最終プロダクト完成と中間ビジュアル目標の双方に使う、P0の
意思決定・証拠パケット雛形である。結果報告でも、既存の古いQAを遡及的に合格へ
書き換えるものでもない。記録がない行は `UNKNOWN`、必要な成果物自体がない行は
`UNMET` とする。`UNKNOWN` は故障の主張ではないが、受入には使えない。

**作成時に観測したGit状態 (2026-07-22):**

| Field | Observed value | 意味 |
|---|---|---|
| HEAD | `c497498890c2ca7c6ff777519942cd7b7b962954` | この文書を作成する直前に `git rev-parse HEAD` で読んだ値。以後の変更には使えない。 |
| Branch | `agent/initial-mvp` | 同時点に `git branch --show-current` で読んだ値。 |
| Worktree | entriesなし | 同時点に `git status --short` で読んだ観測。画面証拠を取る直前に再取得が必要。 |

このSHAはベースライン作成の由来であり、**受入revisionの先取りではない**。キャプチャを
開始する時点で、下記 `00-revision-identity.json` に再度実測して固定する。同一の完全SHA、
URL、ブラウザ、DPR、WorldPlan入力、時刻を共有しない成果物は、ひとつの判定に混ぜない。

## 1. 正本化が先に必要な未決定事項

次の矛盾は観測済みである。いずれも本書は決定しない。プロダクト所有者／Leadが
`01-scope-and-authority-decisions.md` に選択と理由を署名してから、対応する素材制作・
スコアリングへ進む。

| ID | Observed conflict | 必要な決定 | 受入に与える影響 |
|---|---|---|---|
| DEC-01 | `Fable5ArtContract.md` §2/§5 は1536×1024・24×16のvisual masterを製造正本とする。一方、`art/production/vertical-slice/qa/town-master-prefab-reconstruction-report-v1.json` は1586×992の`target-town`から48 prefabを再構成した記録である。 | この受入の比較元、座標系、建物座標比較の正本を一つに固定する。もう片方は参照／歴史資料として明記する。 | A1、A2–A5、HG-01、HG-03、HG-04の比較対象が変わる。 |
| DEC-02 | `docs/qa/evidence-matrix.md` は「57 core + 7 support」をHG-04に書く。`Fable5PrefabSpec.md` §8 は固定PNG quotaを廃止し、manifest ownershipで範囲を決める。現行再構成レポートは48 prefab、runtimeでは特殊処理を含む。 | 固定数か、可視runtime asset setを列挙する方式かを決め、正確なasset ID一覧を受入対象として凍結する。 | HG-04を「数だけ」で通すこと、および不足素材を数え落とすことを防ぐ。 |
| DEC-03 | `docs/qa/evidence-matrix.md` D1および必須チェックはfootstep/door/dialogue音とmute/volumeを要求する。別計画では音声をスコープ外としている。 | 音声を最終完成に実装するか、所有者が正式にrubricを改訂して対象外にするかを明記する。 | D1、D2、必須証拠パケット、最終85点の分母を黙って変更しない。 |
| DEC-04 | `docs/game-completion-definition.md` は3建物、完全調査、保存復元を最終完成に要求する。一方、`docs/qa/evidence-matrix.md` は「中間ゴール」と表記する。 | 今回の判定が「中間目標」か「製品完成」かを選び、満たすべき表を固定する。 | 中間目標のPASSを製品完成と呼ばない。最終完成なら保存復元・3建物・所有者プレイ承認が必須。 |

`docs/current-state.md`、`docs/qa/evidence-matrix.md`の`356f7e6`/dirty表記、
`art/contracts/asset-inventory.json`の`acceptedRuntimeAssets: 0`、および
`docs/recovery-manifest.md`のwhole-image runtime許容記述は、少なくとも現行HEADを
固定した受入証拠ではない。削除せず歴史記録として残し、新しい判定がどれを置き換えるかを
上の決定記録で明記する。

## 2. 状態語と判定の単位

- **Observed:** ハッシュ付きファイル、実行ログ、同一sessionのスクリーンショット／動画、
  又は人が記名したレビューで直接裏付けられる事実。
- **Inferred:** 観測からの設計上の推論。例: 静的テストの存在から、ブラウザの操作感を推論しない。
- **Unknown:** 証拠がない、又は別revision・別sessionでしか証拠がない状態。
- **UNMET:** 受入に必須の成果物、テスト、又は実装がまだ存在しない状態。
- **PASS / FAIL:** `02-evidence-index.json` に同一sessionの成果物、実行コマンド、SHA-256、
  reviewer、判定理由が結び付いた後にだけ使う。

機械テストのPASSはそのテストの主張だけを表す。視覚品質、自然な歩行、会話の意味、
一連の顧客体験、所有者承認を自動的にPASSへ昇格させない。

## 3. 受入パケットの固定レイアウト

各実行は、**実際に取得した完全HEAD**を`<REV>`へ置換して、次の一意な場所に保存する。
例にある`c497…`を後続revisionに流用してはならない。

```text
art/production/vertical-slice/qa/acceptance/<REV>/
  00-revision-identity.json
  01-scope-and-authority-decisions.md
  02-evidence-index.json
  10-approved-runtime-asset-set.json
  11-asset-contract-n1-n9-report.json
  12-asset-forge-provenance-index.json
  20-prefab-reconstruction-report.json
  21-prefab-reconstruction.png
  22-prefab-reconstruction-diff.png
  23-prefab-coordinate-comparison.json
  30-browser-session.json
  31-network.har
  32-console.json
  33-browser-errors.json
  40-viewport-1920x1080.png
  41-viewport-1280x720.png
  42-crops-character-building-seam-door.png
  43-cutaway.png
  44-dialogue.png
  45-golden-route-60fps.webm
  46-frame-pivot-overlay.png
  47-collision-nav-overlay.png
  48-dialogue-slice-and-stress.json
  49-resize-reload-reset-failure-log.json
  50-three-repository-comparison.json
  90-rubric-scorecard.json
  91-hard-gate-verdicts.json
  92-owner-play-approval.md
```

`02-evidence-index.json` は全ファイルの相対path、SHA-256、作成時刻、capture/session ID、
実行コマンド、reviewer、判定を持つ。映像の切り出し、画像、HAR、console logを別sessionから
組み合わせることを禁止する。

## 4. 再現可能な事前実行コマンド

以下は現時点でrepositoryに存在するコマンドである。受入実行時にはstdout/stderr、終了status、
実行時刻を`02-evidence-index.json`へ記録する。これらをまだ実行していない本書は、結果をPASSと
しない。

```sh
# revision identity (capture start/endの両方で実行)
git rev-parse HEAD
git status --porcelain=v1
git branch --show-current
node --version

# source/static preflight
npm run check

# prefab-only offline reconstruction; report/PNG/manifestを更新するため、
# 受入用worktreeでのみ実行し、生成物を20–22へsnapshotする
python3 art/production/vertical-slice/scripts/verify-target-town-prefab-reconstruction.py

# Asset Forgeの既存schema/ledger preflight
(cd tools/asset-forge && npm run validate)
(cd tools/asset-forge && npm run check)

# loopback限定の被験ブラウザ用server（別terminal）
node src/server.mjs --repo sample/tiny-town --port 4173
```

次の実行は受入に**必要だが、現時点でchecked-in commandが存在しない**。存在しないものを
実行済みと記さない。Leadは実装または同等の記名済み手順を追加し、名称・version・引数を
`02-evidence-index.json`に固定する。

```sh
# REQUIRED BEFORE FINAL EVALUATION — currently UNMET: browser automation/capture harness
node tools/qa/capture-fable5-acceptance.mjs \
  --url http://127.0.0.1:4173/fable5-v2/ \
  --out art/production/vertical-slice/qa/acceptance/<REV>

# Implemented static subset — approved frozen ledgers only. This deliberately
# reports `fullN1N9Status: INCOMPLETE`; it is not an HG-04 PASS or a substitute
# for human visual review, browser evidence, or the remaining N-gate analyzers.
node tools/qa/fable5-asset-n1-n9-preflight.mjs \
  --ledger tools/asset-forge/generated/fable5-runtime-ledgers/<LEDGER_SHA256>.json

# REQUIRED BEFORE HG-04 — still UNMET: full per-asset N1–N9 analyzer and
# acceptance-packet writer (the old normalize-check command is a historical
# planned name, not an executable command in this revision).

# REQUIRED BEFORE AC-1/D2 — currently UNMET: deterministic PNG render-hash harness
node tools/qa/render-fable5-hash.mjs \
  --url http://127.0.0.1:4173/fable5-v2/ --same-worldplan-twice \
  --out art/production/vertical-slice/qa/acceptance/<REV>/49-resize-reload-reset-failure-log.json
```

上の`REQUIRED`コマンドは仕様上の名前であって、今すぐ実行可能なコマンドではない。実装時に
名前を変える場合は、旧名・新名・同等性をdecision recordに残す。

## 5. Asset Forgeを使う位置と素材受入

Asset Forgeは画像を自動生成しない。`docs/fable5-codex-sprite-handoff.md`の通り、プレイヤーと
宿主のdraftは `draft-pending-generation` / `not-yet-submitted` であり、runtime採用の根拠ではない。
新規／再制作素材については、次の順を崩さない。

1. `01-scope-and-authority-decisions.md`でasset ID、正本reference、hash、用途、必要性を固定する。
2. Asset Forgeのjob packを作る。draftを既存catalogへ接続できない間は、job作成は**UNMET**であり、
   mock出力を代替素材にしない。
3. 人間が外部の生成sessionを明示的に許可・実行する。生成provider、session、返却bytesはprovenanceに記録する。
4. `import`/`process`でhash検証済みpending candidateにし、N1–N9、sheet 40セル、全frame pivot、
   east非mirror、人物同一性、元画像との視覚比較を行う。
5. 権限を持つ人間だけがinteractive `promote` / `promote-required`で承認する。承認前のcandidate、
   pending、mock、旧fallbackはruntimeから読まない。
6. 承認済みexportと`10-approved-runtime-asset-set.json`を照合してからruntimeへ統合し、
   network/captureを再取得する。

この手順はcharacterだけに限らない。最終完成の3建物、cutaway/interior、door状態、visible prop、
renderer-owned effectのうち新規画像が必要な範囲も、DEC-02で凍結したasset setと各contractを通す。

## 6. Hard Gate 判定表

開始時のCurrent欄はすべて受入上 `UNMET` 又は `UNKNOWN` である。HG-09/HG-10についても、
新しい同一revision packetを確認するまで最終PASSを再利用しない。

| Gate | PASSに必要な同一revision成果物 | 実行／確認方法 | 開始時Current |
|---|---|---|---|
| HG-01 | `00-revision-identity.json`: full HEAD、worktree、canonical source/asset hashes、URL、viewport、DPR、browser version、capture開始/終了時刻 | §4 identity commands + browser harnessのmetadata | UNMET |
| HG-02 | `30-browser-session.json`と`02-evidence-index.json`が40–49、31–33を単一session IDへ結ぶ | browser harnessが生成。手動なら開始から終了まで連続録画・署名済みsession log | UNMET |
| HG-03 | 10、20–23、31、32。全runtime画像がapproved asset setにあり、master/target/legacy/CSS world art/missing concealmentを使わない | `npm run check`、prefab reconstruction command、HARのURL allowlist/denylist検査 | UNKNOWN |
| HG-04 | 10–12。各visible assetのmanifest source/crop/pivot/layer/hash、承認、N1–N9結果、支援assetの根拠 | Asset Forge validate/check + static N1–N9 preflight（現状は一部のみ）+ full analyzer + human review | UNMET |
| HG-05 | 45、46、40–42。4方向のidle2/walk6/interact2、east非mirror、10fps、facing≤1frame、pivot drift≤2pxを表示 | 60fps browser captureとframe overlay。静的sheet検査だけでは不可 | UNKNOWN |
| HG-06 | 45、47。市庁舎・宿屋・M住宅のdoor→interior→exit、cutaway、collision/nav、10 corner approachesが中断なし | Golden-route replay。閉鎖表示は未実装扉の正直なUX証拠であって、このgateの代替ではない | UNMET |
| HG-07 | 44、48、45。保持したdialogue sourceの正規crop/9-slice、読みやすい意味ある会話、選択肢・長文stress | source-to-runtime comparison + quest capture | UNKNOWN |
| HG-08 | 31–33、49。console error/unhandled rejection/network failure/production asset欠損/source upload/non-loopback/old fallbackがすべて0 | HAR/console/error JSON、resize/reload/save-failureの復旧試験 | UNKNOWN |
| HG-09 | 50、44、45、49が観測・推定・不明をUIと保存データで区別する | 3-repository cases + dialogue/unknown表示の人間確認 | UNKNOWN |
| HG-10 | `91-hard-gate-verdicts.json`が01–09の未完を隠さず、`92-owner-play-approval.md`が未記名の間はacceptedをfalseにする | Lead review + owner sign-off。browserなしの合格禁止をschemaで検査 | UNMET |

## 7. 85点rubric の採点証拠

`90-rubric-scorecard.json`は各行について `weight`、`score`、`percentage`、`artifactPaths`、
`reviewer`、`rationale`、`state`を必須とする。受入条件は旧matrixの定義どおり、総点≥85、
visual≥48/55、gameplay≥22/27、UI/dialogue≥8/10、experience/robustness≥5/8、各行≥60%、
かつHG-01–HG-10の全PASSである。決定済みのscope変更がある時だけ、変更前後の式と所有者承認を
`01-scope-and-authority-decisions.md`に併記する。

| Rubric | Weight | 必須artifact（上記packet内） | 評価時の最低条件 |
|---|---:|---|---|
| A1 Recomposable visual truth | 15 | 10–12、20–23、31 | prefab-only再構成、座標100%、比較指標、fallbackなし。現在のpixel-identical reportは再実行・同revision pinなしには引用のみ。 |
| A2 Architectural height and hierarchy | 14 | 40–42、90のgrayscale/squint review | town hallが次の建物の≥1.2×、3 depth bands、4 silhouettesを両viewportで人間確認。 |
| A3 Density/depth/exploration | 12 | 40–42、47、90 | base terrain≤25%、許可plaza以外にdead areaなし、3 destinations、prop clustersを測定／記名レビュー。 |
| A4 Material/pixel/projection/lighting | 8 | 11、40–42、90 | native/integer crisp、共通projection/outline/light、接地、繰返しなし、renderer所有effectを確認。 |
| A5 Cutaway visual quality | 6 | 43、45、47 | active roofだけ、floor/wall/trim/door/furniture/NPC/player/lightを同一画面で確認。 |
| B1 Natural four-way movement | 11 | 11、45、46 | HG-05の定量条件と主観的滑り／pivot wobbleなしのレビュー。 |
| B2 Navigation/collision feel | 8 | 45、47 | inn→road→house、10 corners、tunnel/snagsなし、invisible wall誤差≤4px。 |
| B3 Entry/exit/camera/occlusion | 8 | 43、45、47 | 3 buildings、door/nav alignment、spawn、only active roof、canopy fade、camera clamp。 |
| C1 Correct dialogue UI | 5 | 44、48、40–41 | source crop/9-slice、border/tail、long text/choices、両viewportでsource example漏れなし。 |
| C2 Meaningful minimum conversation | 5 | 44、45、50 | 2–4 turns、NPC role/local context、observed/inferred/unknownのrepository fact、次の行動／choice。最終完成なら完全questも必要。 |
| D1 Feedback/pacing/sound/exploration | 3 | 45、49、90 | input≤100ms、interaction≤150ms、control≤3s、affordance≤5s、conversation/cutaway≤30s、DEC-03に従う音声/mute。 |
| D2 Robustness/resize/errors/accessibility/regressions | 5 | 31–33、40–41、49 | crisp viewport、loading/missing state、keyboard/focus/contrast/non-color/reduced-motion/touch、golden replay。最終完成ではsave/reload/resetも含む。 |

## 8. 顧客体験から逆算する実施順序

1. **判定を偽らない土台:** DEC-01–04を決定し、`00`–`02`のschemaとcapture harnessを用意する。
   ここを飛ばして画像を増やしても、どの完成条件にも加点しない。
2. **顧客に見える承認済み世界:** 受入asset setを凍結し、Asset Forgeの実生成／取り込み／人間承認を
   完了する。N1–N9、provenance、manifest、prefab再構成を通す。この時点でA1/HG-03/HG-04を評価可能にする。
3. **歩ける人物と入れる建物:** 正規player/innkeeper、3建物kitとinterior/cutaway、door/collision/cameraを
   実装する。静的テストを更新後、B1–B3/HG-05/HG-06のcaptureを可能にする。
4. **調べて答えを得る体験:** UI sourceを正規sliceで描き、手帳→問い→3調査→市庁舎→回答→結果を実装する。
   保存、復元、確認付きreset、失敗状態を実装する。C1/C2/HG-07、最終完成条件5–6を評価可能にする。
5. **一つの顧客sessionで証明:** 同一WorldPlan・revisionで両viewport、3 repo、golden route、network/console、
   resize/reload/error/reduced-motion/touchを取得する。HG-01/02/08/09をここで判定する。
6. **独立採点と所有者承認:** rubricを採点し、unknownを残さず、HG全件PASSを検証してから所有者が
   `92-owner-play-approval.md`へプレイ承認を記す。これより前に「完成」「85点」を宣言しない。

## 9. 現時点の誠実な基線

- **Observed:** 48 prefabのoffline再構成に関する既存reportはpixel diff 0を記録している。
  `test/town/prefab-runtime-wiring.test.mjs`および
  `test/town/world-prefabs-runtime-contract.test.mjs`は、source上のmaster直接参照を防ぐ契約を持つ。
- **Inferred:** これらはA1/HG-03の実装準備を前進させるが、実ブラウザnetwork、asset acceptance、
  visual quality、顧客操作の代替ではない。
- **Unknown:** 現行acceptance revisionでのbrowser session、全assetのN1–N9、自然歩行、3建物、
  全quest、保存復元、audio scope、両viewport、3-repo差分、owner approval。
- **UNMET:** `capture-fable5-acceptance.mjs`、全N1–N9を満たすper-asset analyzer／acceptance-packet writer、
  deterministic render-hash harnessは、最終受入の前に同等の実装と結果が必要である。approved ledgerに対する
  `fable5-asset-n1-n9-preflight.mjs` は実装済みだが、N1/N6/N7などの静的部分だけを再検査し、
  `fullN1N9Status: INCOMPLETE` を返すため、このUNMETを解消しない。

関連する正本／歴史資料: `docs/game-completion-definition.md`,
`docs/qa/evidence-matrix.md`, `Fable5ArtContract.md`, `Fable5PrefabSpec.md`,
`docs/fable5-codex-sprite-handoff.md`, `art/contracts/asset-inventory.json`,
`art/production/vertical-slice/qa/town-master-prefab-reconstruction-report-v1.json`。
