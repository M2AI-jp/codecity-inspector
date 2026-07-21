# Fable5 Art Contract — 素材間の統一を保証するアート契約

正本指定: 本書は**アセットの作り方**(投影・解像度・光・色・比率・正規化・検収)の正本である。
配置の正本は `Fable5PlacementGuide.md`、prefab 分解と実装用契約は `Fable5PrefabSpec.md`、
組み立ての最初の検収対象は `Fable5VerticalSlice24x16.md`(市庁舎広場 v2)。
数値が先行文書と食い違う場合は本書 §10 の正誤表が勝つ。

> **2026-07-18 品質基準の更新（ユーザー決定）**
>
> `art/references/target-town.png` をビジュアル品質と画面構成の最優先正本とする。
> 本書の旧パレット上限、禁欲的なコントラスト、平坦な道路面、4棟だけで閉じた画面構成が
> この正本より低品質になる場合は上書きする。対象画像が示す三層の奥行き、建築密度、
> 石・木・植生の描き込み、明暗の統一、前景の遮蔽を採用する。独立 Sol 二者が合格させた
> `old-town-exterior-master-v1.png` を **1536×1024 = 24×16 cells × native 64px** の新しい
> ビジュアル・ジオメトリ導出正本とし、再サンプルしない。旧18×12座標、北overscan、mask、camera proofは
> 失敗過程を示す診断証拠へ降格し、製造座標へ流用しない。正規入口、衝突、pivot、prefab再構成、
> 固定背景禁止は機能制約として残す。
> 大域ライティングはscene rendererで統一し、個別prefabへ長い他物体依存影を焼き込まない。

読者は実装エージェント(Codex)。感覚語は使わない。本書にない判断が必要になったら、
実装せず「不足規則」として報告する(推測での補完は禁止)。

---

## 0. 診断 — なぜ現画面は「一つの世界」に見えないか

現ビルドのスクリーンショットの不合格要因は 4 つで、すべて本書の契約で塞ぐ。

1. **画素密度の不一致**: 素材ごとに 1 タイルあたりの native px が違い、拡大率もバラバラ
   → §2(単一密度 + 整数ズーム)と §7(正規化検収)で機械的に排除。
2. **光・輪郭・彩度の不一致**: 素材ごとに光源方向・線幅・コントラストが違う
   → §4 で全素材共通のライティング/線/色の数値契約。
3. **統一感の担い手の取り違え**: 参照画像の統一感は「シーン全体に焼かれた光」で、
   素材単位では再現不可能 → §1 の役割分担(素材は禁欲、統一はレンダラー)。
4. **地面が単一タイルの全面リピート** → 配置側の既存契約(PlacementGuide Q1/D2)違反。
   本書ではなく `Fable5VerticalSlice24x16.md` の再組み立てで検収する。

## 1. 最重要決定: 統一感の役割分担

参照画像(2 枚目)の品質は「1 枚の絵としての大域ライティング」から来ている。
これを**素材単位で真似させることを禁止**する(全素材が別々の絵になる再発コース)。

- **素材(prefab)が持つもの**: 形・固有色・フォーム陰影(§4)・接地影のみ。
  ドラマチックな光・長い落ち影・周辺減光・グロー・強コントラストを**素材に焼き込むことを禁止**。
- **レンダラーが一括で掛けるもの**(全画面共通、ここで「一つの世界」を作る):
  1. カラーグレーディング LUT(地区・時間帯別、§4.4)
  2. 画面全体の ambient(PlacementGuide §9 の夜仕様を含む)
  3. 光源ハロー(街灯・窓・炉)
  4. 接地 AO 帯(PlacementGuide §2.1 の 8px 帯影)
  5. ビネット(四隅 減光 8%、半径 = 画面短辺の 75%)

この分担により、切り出した素材同士をどう再配置しても照明が破綻しない
(= WorldPlan がリポジトリごとに違う街を組んでも成立する、という本ゲームの前提条件)。

## 2. 投影・解像度・ズーム

- **投影**: 正方グリッド 3/4 俯瞰(PlacementGuide §0 を維持)。壁は南面のみ、anchor は接地南端、
  屋根・樹冠は北へ張り出す。アイソメ菱形・素材ごとの視点変更は禁止。
- **論理タイル**: 1 tile = **64px native**。全カテゴリで 1 tile あたり画素密度を統一
  (`nativeScale: 1` 以外の素材は登録不可)。
- **製造解像度**: 採用ビジュアルマスターは 1536×1024 をそのまま 24×16 cells × 64px とする。
  拡大・縮小・box filter は行わない。派生する clean plate / layer board / prefab も native 64px 基準で
  描画し、生成器が別解像度を返した場合は縮小救済せず不合格とする。
- **表示**: 整数ズームのみ `{1, 2, 3}`。nearest-neighbor。devicePixelRatio は canvas の内部解像度
  (`canvas.width = cssWidth × dpr`)で吸収し、**CSS による分数拡大は禁止**。
  レンダラーは `assert(Number.isInteger(zoom))` を実装すること。
- **基準画面**: 1920×1080 zoom2 = 15×8.44 tiles 可視 / 1280×720 zoom2 = 10×5.63 tiles 可視。
  受入はこの 2 解像度で行う(§9 AC-8)。

## 3. 相対寸法表(必須比率の確定値)

依頼書のレンジを以下に確定する。全 prefab はこの表に適合しない限り登録不可。

| 項目 | 確定値 | 依頼書の制約への適合 |
|------|--------|---------------------|
| 人物: frame canvas | 64×128px | — |
| 人物: 可視身長 | 72px ± 2(≈1.1 tile) | — |
| 人物: 肩幅 | 36px ± 2 | — |
| 人物: 足元 pivot | frame 内 (32, 120) **全キャラ・全フレーム固定** | 足元ピボット統一 |
| 人物: collision | pivot中心の24×14px foot ellipse/capsule | 64×128 sprite bboxで衝突しない |
| 扉: visual opening | `geometry-v2.json` のobservedRectを正本化。open stateのclear widthは48px以上 | foot collider幅 ×2以上 |
| 扉: portal | owner cell + world-pixel triggerRect + approachPoint | cell中心への丸め・装飾扉を禁止 |
| 主要道 | visual pavementはaccepted master準拠の可変幅。runtimeの連続pixel corridorは最低48px。3 tilesは将来のprocedural配置目標 | sprite幅ではなく24px foot colliderで検収 |
| 路地幅 | 2 tiles / 小道・参道 1 tile | — |
| 広場 | 5×4 〜 7×5 tiles | — |
| 建物 footprint | v2 draft: hall 8×4 / inn 5×3 / house 4×3 / tower 3×3 provisional | clean alpha/interior overlay承認までは確定値と呼ばない |
| 建物 visual bbox | clean alpha boardで実測しmanifestへ固定 | 屋根・庇の張り出しをfootprintと混同しない |
| 窓 | 幅 32px・下端 = 接地 +72px(人物の目線が届く高さ) | — |
| 接地面 | footprint 南辺 = ナビグリッドのセル境界に一致 | 接地面とナビ一致 |

## 4. 光・線・色の契約(全素材共通)

### 4.1 ライティング

- フォーム陰影: **トップライト + キーライト西上 15°**。つまり上面が最明、東面がわずかに暗い。
  全素材で同一方向。素材ごとの光源変更は禁止。
- 影: 素材に焼き込んでよいのは**接地影のみ**(footprint + 外周 1px の apron 内、不透明度 ≤30%)。
  長い落ち影・隣タイルへ伸びる影の焼き込みは禁止(再配置で破綻するため。大域 AO は §1 のレンダラー側)。
- 発光: 窓・炉・灯は素材では「消灯状態」で描く。点灯はエフェクト(window_glow 等)とハローで行う。

### 4.2 輪郭線

- 外周輪郭: 1px(native)。色は隣接する塗りの 30% 暗。**純黒 #000 禁止**。
- 内部ディテール線: 1px、塗りの 50% 暗まで。2px 以上の線・スケッチ調の線は禁止。

### 4.3 色域とコントラスト

- target-town の石、木、青い屋根、苔、花が持つ微細な階調を残す。**全素材を40色へ最近傍snapする旧規則は
  production gateから削除**する。色数削減で材質感を失わせない。
- accepted unlit boardから地区ごとのmaterial swatch群と輝度分布を測り、派生prefabは同じmaterial family内に置く。
  機械検査はexact palette membershipではなく、透明pixel除外後の色域、局所contrast、materialごとの色差外れ値を使う。
- emission、night grade、haloをアルベド色へ混ぜない。最終の時間帯contrastと色温度はrenderer LUT/effectで加える。

### 4.4 地区差の付け方(同じ世界に保つ規則)

地区差は次の 3 チャンネル**のみ**で表現する。形状言語・線・投影・密度を地区ごとに変えることは禁止。

1. 地表スキン(PlacementGuide §3 の表)
2. アクセント 8 色(例: 旧市街=琥珀/深緑、港=藍/ロープ茶、雪=青白/朱、森=苔緑/灯橙)
3. レンダラー LUT(旧市街=中性、港=寒色 +5%、雪=青 +10% 明度 +5%、森=緑 +5% 彩度 +5%、夜=PlacementGuide §9)

## 5. 生産パイプライン — 「全体図をパズル化」の正式手順

**素材を 1 個ずつ個別生成することを禁止する**(視点・光・密度が必ずズレる。現況の原因)。
プロダクトオーナーの方針「先に世界を画像で作り、全体図をパズル化する」を、次の 6 工程で契約化する。

1. **ビジュアルマスター凍結**: 採用済み `old-town-exterior-master-v1.png` の寸法・hash・24×16原点を固定する。
   これは見た目と構図の正本だが、lit RGB composite のため直接slice・runtime loadを禁止する。
2. **ジオメトリ化**: 64px grid overlay上で全 visible object の ownership、footprint、door opening/cell、
   approach、pivot、collision、y-sort、occlusion、hidden-background regionを確定する。花壇は見た目どおりblocking。
3. **登録済みneutral状態の決定的導出**: 全景imagegen editは2回連続でregistrationを壊したため禁止する。
   凍結masterへauthority material mask単位の1×1 Oklab LUTを適用し、座標を0pxのままneutral化する。
   煙・発光・halo・light poolと2件のtopology repairは `registered-neutral-pipeline-v1.json` と
   `semantic-masks-v1.json` の事前宣言mask内だけで処理する。Imagegenはhidden pixelのdonor boardだけを生成し、
   mask外の生成pixelはすべて破棄する。Mask内合成、cluster移動、rounding、hashは決定的でなければならない。
   Candidate02は44/49・45/49のneutral-look参照だがregistration 27/49のため、geometry・slice・runtime正本ではない。
4. **Purpose-built whole-state layer board導出**: 登録済みneutral状態をregistration/identity参照として、
   building base/roof/door/shadow、foreground、state overlay、hidden-background、cutawayの専用boardを作る。
   照明・煙・grade・vignetteはrenderer所有。各boardはflat key/alpha、同一anchor、0px state-popを別Gateで証明する。
5. **パズル化と正規化**: 承認済みalpha boardからだけ prefab を切り出し、`Fable5PrefabSpec.md` と §7を通す。
   地表は同じマスターを外観正本とするseamless setとして派生し、矩形のlit composite cropを代用しない。
6. **再組み立て検証**: prefabとrenderer effectだけで同じ24×16構図を再構築し、マスターと人間比較する。
   **マスターボードそのものを背景として出荷することは禁止**(1枚絵納品の禁止)。

旧 Wave A と旧互換素材は 2026-07-18 に全削除済みであり、再登録・救済・fallback の対象にしない。
新素材はすべて本工程のマスターボードから制作し、N1–N9を通過したものだけを登録する。

## 6. シーム(継ぎ目)規則

- 地表タイルは 4 辺シームレス必須。各地表 4 variant(§PrefabSpec)。同一 variant の
  2×2 以上の隣接反復を禁止(タイル選択は座標ハッシュで決定的に回す)。
- 道・水・崖は 16 方位 autotile(N/E/S/W の接続ビットマスク → frame index)。
- prefab の透過縁: alpha の縁 1px にハロー(半透明の白/背景色)を残さない。登録時に defringe。
- タイル境界を跨ぐ描き込み(影・草はみ出し等)は prefab では禁止。はみ出し表現は
  overlay 素材(flowers 等)と屋根/樹冠の北張り出し(PlacementGuide P3)だけに許す。

## 7. 正規化検収(機械判定。`tools/asset-forge/normalize-check.mjs` として実装)

登録候補 PNG 1 枚ごとに全項目を判定し、1 つでも落ちたら登録不可。

| # | 検査 | 判定 |
|---|------|------|
| N1 | 寸法 | PNG の w/h が contract の宣言値と一致。tile 整数倍(人物 frame は 64×128) |
| N2 | 密度 | nativeScale = 1 のみ(縮小・拡大の痕跡: エッジのボケ/リンギングを Laplacian 分散でしきい値判定) |
| N3 | 色域 | accepted unlit material swatch群との色差外れ値を検出。全体palette snapは禁止し、材質階調を保持 |
| N4 | 輪郭 | 外周の太さと色が同カテゴリの承認boardから逸脱しない。無関係な黒halo・chroma spillは0 |
| N5 | 影 | footprint apron 外に不透明度 >0 の影画素なし |
| N6 | pivot | 人物: (32,120) に足接地(下端 8px 行に不透明画素が存在し、その重心 x = 32±2)。全フレーム同値 |
| N7 | 透過 | 建物/人物/opaque propは透明四隅・key残留0・肉眼haloなし。shadow/effectは別契約で部分alphaを許し、opaque素材へ混在させない |
| N8 | 文字 | 文字状の高周波クラスタ検出 → 看板は図像のみ(**読める/読めない以前に文字を描かない**) |
| N9 | 発光 | 消灯状態で納品(輝度 >90% の画素が窓/灯領域に集中していないこと) |

## 8. 禁止事項(依頼書の禁止を契約語に変換)

1. 1 枚絵の背景を最終納品とすること(マスターボードは中間生成物。§5 工程 5)
2. 素材ごとの視点・光源・線幅・密度の変更(§2, §4)
3. CSS・分数倍率での拡大縮小(§2)
4. ナビと一致しない装飾扉(door tile の無い開口を立面に描くこと。窓と明確に区別する)
5. 文字の描き込み(§7 N8。固有名は UI レイヤーのフォントで出す)
6. 既存ゲーム・作家・参照画像固有の建築/構図の模倣(参照は密度・統一感・完成度の基準としてのみ使う)
7. UI・カーソル・選択枠を建物画像へ焼き込むこと(効果 prefab として分離。PrefabSpec §5)
8. 素材への大域ライティング焼き込み(§1)

## 9. 受入条件(AC。依頼書の受入条件の機械化)

| ID | 条件 | 検証方法 |
|----|------|----------|
| AC-1 | 同じ WorldPlan の再描画が決定的に同一 | 同一入力 2 回レンダ → PNG ハッシュ一致 |
| AC-2 | prefab 再組み立てがマスターボードと構図一致 | 工程 5 の比較(建物座標 100%、SSIM ≥ 0.85) |
| AC-3 | 100% 表示で素材間の解像度差なし | 全登録素材が N2 通過 + スクリーンショット人間確認 |
| AC-4 | 4 方向移動で足元がノードからずれない | pivot(32,120) unit test + 歩行録画の目視 1 回 |
| AC-5 | 入口→室内の連続移動、カットアウェイ後も人物可視 | e2e: 屋根 α0 後に player スプライトが描画順で見える |
| AC-6 | 最低1棟の正規入口（最初は宿屋）で進入/退出し、室内NPCと意味のある最低2往復の会話。未実装扉は閉鎖理由を正直に表示 | door portal経由のe2e + 会話状態遷移 + 人間操作確認 |
| AC-7 | 宿屋の室内床・壁・家具shellが新しい5×3外観 footprint と一致 | interiorレイヤー矩形・door threshold・NPC routeをoverlay/lint |
| AC-8 | 1920×1080 / 1280×720 の両方で密度・可読性 | 両解像度で PlacementGuide Q1/Q2/Q11 を再計測 |
| AC-9 | 建物数・地区・道路配置を変えても破綻しない | ランダム 3 リポジトリの WorldPlan で Q1–Q11 を自動計測 |
| AC-10 | 整数ズームのみ | レンダラーの assert + devicePixelRatio テスト |

## 10. 先行文書との正誤表(本書が勝つ)

| 項目 | 旧値(PlacementGuide/Blueprints) | 新値 |
|------|------|------|
| 主要道幅 | 2 tiles / 旧改訂3 tiles固定 | v2はaccepted masterの可変visual幅 + 48px以上の連続pixel corridor。3 tilesは将来のprocedural配置目標 |
| 広場最大 | 5×4 | **7×5** |
| 人物規格 | 「NPC 高 ≈1 tile」のみ | §3 の確定値(64×128 frame、身長 72px、pivot 32,120) |
| 建物立面 | 未規定 | 壁バンド 2.5 tiles + 屋根高クラス別(§3) |
| 実装順序の起点 | 6 画面ブループリント / legacy 18×12 slice | **`Fable5VerticalSlice24x16.md` と採用visual masterを最初の検収対象とする**。旧18×12と6画面は診断・配置文法の参考に限り、新WorldPlanへ座標を流用しない |

その他の規則(スキン表・plot kit・地形接続・Q1–Q14・素材配置 Matrix)はすべて有効のまま。
