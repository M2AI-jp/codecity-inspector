# Fable5 Placement Guide — 素材を「街」に変換する配置契約

正本指定: 本書は **素材 → 画面** の変換規則の正本である。素材そのものの正本は
`Fable5AssetPlan.md` の契約台帳(Wave A 109 ID)、品質参照は
`tools/asset-forge/references/approved/world_visual_master.png`、データモデルの正本は
`src/town/schema.mjs` である。矛盾があれば「台帳のID・寸法 > 本書 > 実装の現状」の順で解決し、
黙って類推せず、差分を issue 化して止まること。

読者は実装エージェント(Codex)である。本書は「自然に」「適度に」「賑やかに」を使わない。
すべての規則は asset 正規名・64px タイル座標・個数・距離・anchor・frame・layer で書く。

姉妹文書:

- `Fable5PlacementMatrix.md` — 109 素材の配置表(1 素材 1 行の可否・個数・間隔・レイヤー)
- `Fable5SceneBlueprints.md` — 旧市街・港・雪・森林・夜・カットアウェイの実寸 6 画面(座標が正本)

---

## 0. 最重要決定: 投影方式

**決定: 正方形 64px グリッドの 3/4 俯瞰(トップダウン・スリークォーター)を最終品質とする。**
これは品質参照画像(world_visual_master.png)と同系の投影であり、「通常のドット絵ゲームへの妥協」ではない。

- **菱形グリッドのアイソメトリック投影は禁止。** Wave A 素材(正方タイル、base+roof 分離建物)は
  3/4 俯瞰用に作られており、菱形化は全素材の作り直しになる。
- 参照画像の品質は投影の種類ではなく、次の 5 要素で成立している。本書はこの 5 要素をすべて数値規則化した。
  1. 高低差の段丘(cliff + stairs)— §6
  2. 折れ曲がる道と水路 — §4, §6
  3. 街路に正対して密集する建物 — §5
  4. スプライトの前後遮蔽(樹冠・屋根の張り出し)— §2
  5. 統一光源と夜の灯り — §9

投影の 3 原則(全素材共通・違反は不合格):

- **P1**: 壁面は南面のみ描く/見せる。東西壁・北壁の立面は描画しない。
- **P2**: すべてのワールドスプライトの anchor は接地辺(南端)。スプライトは接地辺から上(北)へ伸びる。
- **P3**: 屋根・樹冠は接地点より北のタイルへ張り出してよい(これが遮蔽を生む)。東西方向のはみ出しは最大 8px。

---

## 1. 単位と ID の結合手順

- 1 タイル = **64px**(native)。画面 1280×800・2 倍表示 → 可視範囲は **10 × 6.25 タイル**。
- 座標は整数タイル、原点は左上、x 右向き・y 下向き(`schema.mjs` と同一)。
- 本書の素材名は snake_case の**正規名**(例: `tree_a`, `snowcap_xl`)。実装前に必ず
  `Fable5AssetPlan.md` の台帳 ID と 1:1 の対応表 `tools/asset-forge/asset-id-map.json`
  (`{ "正規名": "台帳ID" }`)を生成すること。**未対応の正規名が 1 つでも残ればビルドエラーにする。**
  類似 ID への自動読み替えは禁止。
- 素材の実寸(px)・frame 数は台帳が正。台帳の寸法が本書の footprint(タイル数 × 64px)と一致しない場合は
  実装せず差分報告する。

---

## 2. レイヤー・z-order・anchor 契約

### 2.1 合成順(renderer はこの順で描く)

| # | パス | 内容 |
|---|------|------|
| 1 | ground | 地形タイル(§3 スキン表で解決) |
| 2 | decal | 地面装飾 overlay(flowers/pebbles 等)、踏み跡、**接地影**(下記) |
| 3 | world | **y ソート帯**: 建物 base・構造物・小物・人物を anchor の y で昇順ソートして描画 |
| 4 | overhead | 屋根(building roof)・樹冠(tree frame 1)。帯内は同じく anchor y 昇順 |
| 5 | effect | window_glow, water_ripple, construction_dust, discovery_glint |
| 6 | lighting | 夜のみ: ambient multiply + 光源 additive(§9) |
| 7 | ui | スクリーン空間固定。ワールド zoom 非依存 |

- `schema.mjs` の `DRAW_LAYERS`(ground/object/building/character/roof/effect/ui)は**分類語彙**として維持する。
  描画順は本表が正: object/building/character は全てパス 3 の y ソート帯に入る。
- **y ソートのタイブレーク**(同一 anchor y): 構造物 → 建物 → 小物 → 人物 の順に描く。
- **接地影**: すべての建物・構造物(tree/rock/柵含む)は接地辺に沿って高さ 8px・不透明度 25% の黒帯を
  decal 層に敷く(素材化不要、renderer で矩形描画)。これが「浮いて見える」問題の最小対策である。

### 2.2 anchor 規則

| 分類 | anchor |
|------|--------|
| 地形 | セル全面 |
| 構造物・小物・人物 | スプライト底辺中央を、占有タイルの南端中央 `(x·64+32, (y+1)·64)` に一致 |
| 建物 base | base スプライト左下 = footprint 南西角 `(x·64, (y+h)·64)` |
| 建物 roof | base に対する offset は台帳定義。未定義なら roof 下辺 = base 上辺に密着 |
| 樹冠(tree frame 1) | 幹(frame 0)に対する offset は台帳定義。未定義なら §matrix の樹冠矩形 |

### 2.3 当たり判定

- 歩行可否は `schema.mjs` の `WALKABLE_TILE_TYPES` が正。素材固有の collision は台帳 + Matrix の「当たり」列。
- 屋根・樹冠は当たりなし(overhead は視覚のみ)。プレイヤーが樹冠の真下のタイルにいる間、
  その樹冠スプライトの不透明度を 45% に落とす(canopy fade)。

---

## 3. TILE_TYPES × 地区 → 地形スキン表

`schema.mjs` の 14 `TILE_TYPES` は凍結語彙のまま使い、**見た目は地区で差し替える**。
WorldPlan は tile type を持ち、renderer がこの表で asset を引く。

| tile type | 旧市街 | 港 | 雪 | 森林 | 室内 |
|-----------|--------|-----|-----|------|------|
| grass | grass | grass | **snow** | grass | — |
| dirt | dirt | dirt | dirt(踏み跡) | dirt | — |
| path | dirt | dirt | dirt | dirt | — |
| road | **cobble** | cobble | dirt | dirt | — |
| plaza | plaza | plaza | — 使用しない | — | — |
| sand | dirt(暫定) | **deck** | — | dirt(暫定) | — |
| water | water | water | water(凍結表現なし) | water | — |
| bridge | stone_bridge | wood_bridge | wood_bridge | wood_bridge | — |
| stairs | stairs(石段) | stairs | stairs | stairs | — |
| floor | — | — | — | — | wood_floor / stone_floor(§8 建物表) |
| wall | 建物 base が描く(下地は plaza) | 同左 | 同左 | 同左 | wall_trim |
| rock | grass 下地 + rock_a/b/c | 同左 | snow 下地 + rock | 同左 | — |
| tree | grass 下地 + tree_a/b/c | 同左 | snow 下地 + tree_c | 同左 | — |
| cliff | cliff | cliff | cliff | cliff | — |

- **deck は tile type `sand` に写像する**(walkable・validator 制約なし)。`bridge` を deck に流用することは
  禁止(validator の BRIDGE_SPANS_WATER が 1 タイル橋を要求するため)。
- 橋は **1 タイル幅のみ**(validator 制約: 各 bridge タイルは一方の軸の両隣が water、直交軸の両隣が歩行可)。
  2 幅道路が水路を渡る場合は、橋の 1 タイルへ道を絞ってから渡す(参照画像の橋もこの形)。
- 雪は独立した地表 asset であり、**雪地区の grass セルを snow で描く**。平地の途中で grass↔snow を
  切り替えることは禁止(§6.4)。

---

## 4. 街路・道路網の規則

- **R1 道幅**: 旧市街・港の主要道 = 2 タイル。路地・森・雪の道 = 1 タイル。
- **R2 折れ**: 道・水路・崖線・地区境界の軸平行直線区間は最大 6 タイル(境界類は最大 4)。
  超える前に 1 タイル以上の折れ(jog)を入れる。**例外: キャンバス端で切れる区間は制限なし。**
- **R3 交差**: T 字を基本とし、十字は 1 画面 1 箇所まで。
- **R4 広場**: 最小 3×3、最大 5×4。town_hall の正面に必置。tile type は `plaza`。
- **R5 街灯**: 旧市街の主要道沿いに streetlight を 5〜7 タイル間隔で左右交互。
  片側が全て建物正面の場合、その側は建物壁付き lamp で代替する。港は建物壁 lamp 優先 + streetlight で補完。
  森は stone_lantern 4〜6 間隔。雪地区に streetlight は禁止(warning_lantern と壁 lamp のみ)。
- **R6 道上の小物**: 幅 2 の道では片側縁 1 列のみ小物可(通行 1 列を必ず残す)。幅 1 の道の上は装飾 overlay のみ可。
- **R7 入口接続**: すべての建物 entrance セルは、道(road/path/plaza/bridge/stairs/sand)に接するか、
  幅 1・長さ 3 タイル以内の入口小道(dirt)で道網へ接続する。validator の REACHABLE と同義。

---

## 5. 建物敷地レシピ(plot kit)— 「裸地に単体置き」の禁止

**建物は単体で置いてはならない。** 以下の kit を 1 セットとして置く。

- (a) 街路正面: entrance は南向き、setback(壁面から道までの距離)は地区表(§7)の範囲。
- (b) 入口小道: setback > 0 なら幅 1 の dirt を道まで敷く(≤3 タイル)。
- (c) 基礎縁: footprint 南辺に沿って dirt または cobble の apron を 1 タイル分確保する
  (既に道・広場に面していればそれが apron を兼ねる)。
- (d) 看板: 対象建物(Matrix 参照)は signboard_a を入口の東 1 タイルか壁付き anchor に置く。
- (e) 灯り: 施設建物は壁付き lamp を entrance 脇の壁 anchor に 1 個。
- (f) 前庭 props: 建物から 2 タイル以内に最低 2 個(barrel/crate/bench/井戸/樽など Matrix の許可品)。
- (g) NPC: 施設建物は担当 NPC(§8.3 代役表)を entrance から 2 タイル以内に 0〜1 体。
- (h) 状態 overlay: `TownBuilding.state` に応じて §8.2 の overlay を装着。

### 5.1 建物表(19 棟)

footprint は正規値(タイル)。台帳寸法と食い違えば台帳を優先し本表を更新する。
窓 anchor は window_glow の装着点: 台帳未定義なら「南壁、door セル中心の東西 ±1 セル中心、接地から +40px」。

| 建物 | footprint | 地区 | setback | 必須前庭 | 看板 | 窓 | 状態 overlay サイズ | 室内床 |
|------|-----------|------|---------|----------|------|----|--------------------|--------|
| town_hall | 4×4 | 旧 | 0(広場正面) | bench×2, signboard_b | — | 2 | xl | stone |
| inn | 3×3 | 旧 | 0–1 | barrel×1 以上 | ○ | 2 | l | wood |
| pub | 3×3 | 旧 | 0–1 | barrel×2, bench 可 | ○ | 2 | l | wood |
| guild | 3×3 | 旧/港 | 0–1 | bench, signboard_b 可 | ○ | 2 | l | wood |
| shop | 2×2 | 旧 | 0–1 | crate×1 以上 | ○ | 1 | s | wood |
| workshop | 3×3 | 旧/港 | 0–2 | barrel, crate | ○ | 1 | l + scaffold | stone |
| warehouse | 3×3 | 港 | 0–1 | crate×2 以上 | ○ | 1 | l | stone |
| dock | 3×3 | 港 | 0(deck 上) | crate×2, ferry_landing | ○ | 1 | l | stone |
| watchtower | 2×3 | 雪/港 | 0–2 | fence または rock | — | 1 | m | stone |
| dojo | 3×3 | 森 | 1–3(参道) | stone_lantern 対, training_dummy, practice_target | — | 1 | l | wood |
| gate | 台帳準拠 | 地区境界 | 道端点を跨ぐ/接する | signboard_b, warning 系可 | — | 0 | m | — |
| house_s | 2×2 | 旧 | 0–1 | flowers か bench | — | 1 | s | wood |
| house_m | 3×2 | 旧 | 0–1 | 同上 | — | 1 | m | wood |
| house_old | 2×2 | 旧/森 | 0–2 | ivy_s, pebbles | — | 1 | s + ivy | wood |
| hut | 2×2 | 雪/森/港 | 0–2 | rock か fence | — | 1 | s | wood |
| rowhouse_s | 3×2 | 旧 | 0 | 隣棟と間隔 0–1 で連担 | — | 1 | m | wood |
| rowhouse_l | 4×2 | 旧 | 0 | 同上 | — | 2 | m | wood |
| ruin | 2×2 | 森/旧外縁 | 制限なし | ivy_l, broken_signpost | — | 0 | ivy 必須 | — |
| survey_tower | 2×2 | 雪/外縁 | 0–2 | survey_plot, warning_lantern | — | 0 | tarp 必須 | — |

- **連担規則**: 旧市街では同一街路の同じ側に 2〜4 棟を間隔 0〜2 タイルで並べる。間隔が 3 タイル以上空く場合、
  その空きに prop クラスタ(2 個以上)か tree を 1 つ入れる。
- 施設と habitability の意味対応(`schema.mjs` FACILITY_LABELS)を壊さないこと。建物は
  `TownModel.facilities[].present === true` のものだけ置く(evidence honesty。存在しない施設を飾りで建てない)。

---

## 6. 地形接続規則

- **T1 石畳↔草**: cobble/plaza が grass に接する箇所は dirt を 1 タイル挟む(fringe)。直接接触禁止。
- **T2 dirt↔grass / dirt↔snow**: 直接接触可(トーンが近い)。
- **T3 水際**: 水路・岸の最小幅は水 2 タイル。地面が water に接する辺は cliff(岸)を 1 タイル挟む。
  例外 1: deck(sand)は water に直接接してよく、その代わり deck 外周の水セルへ **pier(杭)を 2 タイル間隔**で置く。
  例外 2: 幅 2 の小川(森林)は waterline autotile(§12 P0)到着まで grass 直接接触を暫定許容し、
  water_ripple で水際を補う。例外 3: 建物の基礎(wall)は water 隣接可(参照画像の水際建物と同じ)。
- **T4 雪境界**: 雪地区と他地区の境界は必ず cliff+stairs の標高線にする(雪は高台)。
  平地上で grass と snow を隣接させることは禁止。snowcap/snowdrift overlay は雪地区内のみ。
- **T5 崖**: cliff 面は縦 1〜2 セル。段差 1 につき stairs を最低 1 箇所、
  高台に建物 2 棟以上なら stairs 2 箇所(袋小路の禁止)。stairs の上下端は walkable に接続。
- **T6 橋**: 幅 1(§3)。両端に道が 2 タイル以上続く。stone_bridge = 旧市街の主要動線、wood_bridge = 路地・森・港。
- **T7 境界形状**: 地区境界・水際・崖線の軸平行直線は最大 4 タイルで折る(キャンバス端例外)。
  **矩形帯・直線 biome 境界は不合格。** 境界は必ず 道・水路・崖 のいずれかに沿わせ、裸の色替え境界を作らない。

---

## 7. 地区別 scene recipe(数値)

「夜」は地区ではなく照明モード(§9)、「室内」はカットアウェイモード(§10)。

| 項目 | 旧市街 | 港 | 雪 | 森林 |
|------|--------|-----|-----|------|
| プライマリ地表 | cobble/plaza | cobble+deck | snow | grass |
| セカンダリ | grass+dirt fringe | water | dirt 踏み跡 | dirt |
| 道幅 | 主 2 / 路地 1 | 主 2 | 1 | 1 |
| 建物 setback | 0–1 | 0–1 | 0–2 | 1–3 |
| 建物のまとまり | 同側 2–4 棟連担・間隔 0–2 | 岸沿い直列 | 独立、ただし相互 5 タイル以内を道か柵で接続 | 空き地(clearing)中心に 1–2 棟 |
| 画面内地表比率 | 硬質(cobble/plaza)35–60% | deck+water 40–70% | snow 55–80% | 緑(草+樹冠)50–75% |
| ランドマーク | town_hall | dock + sea_marker/ferry_landing | watchtower | dojo |
| 境界 | 道・水路沿い | 岸線 | cliff 標高線 | 樹列・小川 |
| 水際 | 水路可(幅 2) | 必須 | — | 小川可(幅 2) |
| 意図的空白(無装飾許容) | 広場中央 ≤3×3 | 荷役場 ≤3×2 | 台地縁 ≤2×4 | 道場前庭 ≤3×2 |
| シグネチャ資産(画面に ≥2 種) | streetlight, well, signboard_a | crate, pier, ferry_landing, ripple | snowcap, warning_lantern, survey_* | stone_lantern, training_dummy, ivy |
| NPC 数 | 2–3 | 2 | 1–2 | 2 |
| 裸地率上限(§11 Q1) | 40% | 40% | 50% | 45% |

### 7.1 密度と反復

- **D1 裸地の定義**: そのセルに 装飾 overlay・prop・構造物・建物・樹冠・接地影・道系タイル(road/path/plaza/
  bridge/stairs/sand)・water のいずれも無い、基本地形のみのセル。
- **D2 装飾密度**: grass/snow 領域は 4×4 ごとに装飾 ≥1、道沿い(道から 1 タイル)は 3×3 ごとに ≥1。
- **D3 反復禁止**: 同一装飾 ID を直線状に 3 連続で置かない。variant a/b/c は a→b→c の順で巡回。
  同一 prop ID の最小間隔は Matrix の間隔列。
- **D4 意図的空白**: 上表の箇所に限り無装飾を許可。ただしその縁(外周 1 タイル)は装飾すること。
- **D5 広場**: plaza の無装飾連続領域は 3×3 まで(道系タイルは裸地に数えないが、広場だけはこの上限を課す)。

---

## 8. NPC・効果・建物状態

### 8.1 NPC

- **N1**: 1 画面 1–3 体(地区表)。各 NPC は「仕事の対象」(entrance、counter、props、道)から 2 タイル以内。
  対象が 2 タイル以内に無い NPC の配置は禁止。
- **N2 facing**: 施設担当は自分の建物 door 方向(通常 up)。歩行者は進行方向。作業者は作業対象方向。
- **N3**: entrance セルの上に静止 NPC を置かない(担当 NPC は entrance の隣接セル)。

### 8.2 建物状態 → overlay(`BUILDING_STATES` 対応)

| state | 表現 |
|-------|------|
| occupied | 通常描画。夜は window_glow 点灯 |
| vacant | window_glow 常時なし(「まだ灯っていない」= unknown。壊れ表現は禁止) |
| busy | occupied + 前庭 props +1、NPC +1(画面上限内で) |
| under_construction | scaffold(サイズ表)+ construction_dust + tarp 可 |
| ruined | ivy_l 必須(+ivy_s 追加可)、window_glow 禁止、屋根は台帳の破損 frame |

雪地区ではすべての建物に snowcap(§5.1 のサイズ列: s/m/l/xl)を追加装着する。

### 8.3 NPC 代役表(Wave A の 7 人で回すための暫定契約)

| 本来の役(schema NPC_ROLES) | Wave A 代役 | Wave B で置換 |
|------|------|------|
| clerk | town_clerk | — |
| gatekeeper / watch | gatekeeper | watch |
| inspector | dojo_inspector | — |
| innkeeper / shopkeeper / resident(女) | townsfolk_f | 各 keeper |
| barkeep / ferryman / warehouse_keeper / foreman / resident(男) | townsfolk_m | 各 keeper |
| guildmaster | townsfolk_f | guildmaster |
| townsfolk / traveler / child | townsfolk_m/f | 住民 variant |

同一画面での同一代役スプライトは 2 体まで。

### 8.4 効果 4 種の装着点

| 効果 | 装着点 | 個数/画面 |
|------|--------|----------|
| water_ripple | pier・橋脚・岸(cliff)・ferry_landing から 1 タイル以内の water セル。相互間隔 ≥2 | 2–4 |
| construction_dust | scaffold の上端 anchor | 1/建物 |
| window_glow | §5.1 の窓 anchor。条件: 夜 or カットアウェイ室内、かつ state が occupied/busy | 窓数まで |
| discovery_glint | survey_plot、未読 evidence の対象物(ruin 入口等) | ≤2 |

### 8.5 リポジトリ事実 → 景観(このゲームの本義)

| リポジトリ事実 | 景観表現 |
|----------------|----------|
| facility present=false | 建てない(絶対)。空き地は survey_plot で「予定地」として示す |
| 未解決 import | その施設へ向かう道の端点に barricade + broken_signpost(2 タイル以内)+ warning_stake |
| 循環依存 | 循環に属する建物群の重心近くの道脇に cycle_frame(1 画面 1 個) |
| テスト対応あり | dojo と当該施設を結ぶ道が存在。dojo 前庭に practice_target |
| pendingInspections | survey_plot + warning_lantern + tarp(survey_tower に装着) |
| evidence が unknown のみ | state=vacant → 夜に無灯で読める |
| env/secrets | well。DB | warehouse。配布 | dock。ログ | watchtower(FACILITY_LABELS 準拠) |
| habitability Lv0–1 | 建物少 + survey_plot 多 + barricade。Lv5 | 夜画面で全 occupied 窓が点灯 |

---

## 9. 夜(照明モード)

夜は地区ではない。任意の地区マップに以下を適用する。数値は Blueprints の Scene 5 が実例。

- **L1 ambient**: 画面全体に multiply、色 RGB(64, 80, 132)、不透明度 50%。森・雪は RGB(90, 104, 150)・45%。
- **L2 光源**(additive、放射グラデーション):

| 光源 | 半径 | 色 | 不透明度 |
|------|------|----|----------|
| streetlight / lamp | 160px(2.5 タイル) | #ffb44d | 35% |
| window_glow | 96px | #ffd27f | 30% |
| hearth(室内) | 128px | #ff9a3d | 40% |
| warning_lantern | 112px | 台帳の色(既定 #ff6a4d) | 30% |

- **L3 個数**: 1 画面の光源は 4–12。町地区では全道タイルの 90% がいずれかの光源から 4 タイル以内。
- **L4**: vacant 建物は無灯(§8.2)。夜の NPC は 1–2 体に減らす。
- **L5**: 光源スプライト自体(streetlight 等)は点灯 frame(台帳)に切り替える。

---

## 10. カットアウェイ(同一画面の街路+室内)

- **C1 トリガー**: プレイヤーが建物 footprint 内(door セル含む)に入ったら、その建物の roof スプライトを
  不透明度 0 にする(即時でよい。フェードは任意 150ms)。街路と室内は**同一マップ・同一画面**。別画面遷移は禁止。
- **C2 室内床**: footprint 全セルを `floor` とし、§5.1 の床材で描く。北端 1 行に wall_trim を overlay
  (セルは歩行・家具設置可、「北壁際」として扱う)。東西端は幅 8px の縁 trim を decal で描く。
- **C3 通路**: door セルから、家具の無い床セルすべてへ 4 方向で到達可能であること。
  例外: counter の背後(keeper 側)は分離してよい。counter は南側の隣接セルから対話可能とする。
- **C4 家具 anchor**: bed の頭・hearth・shelf・counter は北壁際の行。chair は table か counter に隣接。
  家具は Matrix の屋内許可品のみ。
- **C5 クラス別の家具セット**(cutaway 対象。数は「必須」個数):

| クラス | セット |
|--------|--------|
| inn 3×3 | counter1, chair1, bed1(1×2 縦・頭北), hearth1, shelf1 — 実例は Blueprints Scene 6 |
| pub 3×3 | counter1, table1+chair2, barrel2, hearth1 |
| town_hall 4×4 | counter2(受付), ledger_desk1, shelf2, bench2, 中央 2×2 は空白(待合) |
| warehouse 3×3 | crate3, barrel2, shelf1, ledger_desk1 |
| dojo 3×3 | practice_target1(北壁), training_dummy1, bench1 |
| shop 2×2 | counter1, shelf1, crate1 |
| workshop 3×3 | table1(作業台), shelf1, barrel1, crate1 |
| dock 3×3 | ledger_desk1, crate2, barrel1 |
| guild 3×3 | counter1, shelf1, table1, bench1 |
| watchtower 2×3 | shelf1, warning_lantern1, bench1 |
| house_s/old/hut 2×2 | bed1, hearth1(door 列は空ける) |
| house_m / rowhouse_s 3×2 | bed1, table1+chair1, shelf1 |
| rowhouse_l 4×2 | bed1, table1, chair2, shelf1, hearth1 |
| gate / ruin / survey_tower | cutaway 対象外(gate=通路、ruin=常時屋根なし、survey_tower=tarp) |

- **C6 室内 NPC**: keeper は counter/作業対象の北隣接セル。室内 window_glow・hearth glow は昼でも点灯可。
- **C7 屋根透過範囲**: 当該建物の roof スプライト全体(庇の張り出し含む)。隣接建物の roof は透過しない。

---

## 11. 合否基準(測定可能)

判定は「camera rect」= 1280×800・2 倍表示の可視 10×6.25 タイル(部分行含む 10×7=70 セルで数える)。
Q1–Q11 は WorldPlan JSON から機械判定するチェッカー `tools/scene-check.mjs` を実装し、CI で 6 画面に対して走らせる。

| ID | 基準 | 閾値 |
|----|------|------|
| Q1 | 裸地率(§7.1 D1 定義) | 地区表の上限以下 |
| Q2 | 建物数(footprint∩camera ≥1 セル) | 2–4(森林は 2) |
| Q3 | ランドマーク: 指定建物の footprint が camera に 50% 以上入り、かつ sprite 高が画面内他建物の 1.2 倍以上 **または** 固有資産(sea_marker 等)を併置 | 各画面 1 |
| Q4 | 入口視認: camera 内の全 entrance セルに prop・樹冠・(他建物の)roof が被らない | 違反 0 |
| Q5 | 経路: 全 entrance から camera 端まで walkable 経路が存在(validator 流用) | 違反 0 |
| Q6 | 投影: 全スプライト anchor=南端接地、建物 base 底辺 y = footprint 南端(renderer unit test) | pass |
| Q7 | 反復: D3 違反(同一装飾 3 連続・間隔規則違反) | 0 件 |
| Q8 | 境界: 地区境界・水際・崖線の直線区間(T7) | ≤4(端例外) |
| Q9 | 夜のみ: 光源 4–12、道タイルの 90% が光源 4 タイル以内 | pass |
| Q10 | NPC: 数が地区表内、全 NPC の 2 タイル以内に仕事対象 | 違反 0 |
| Q11 | 地区識別: プライマリ地表が camera 内地表の 50% 以上 + シグネチャ資産 ≥2 種可視 | pass |
| Q12 | スケール: 1 タイル=64px、NPC 高 ≈1 タイル、建物=footprint×64(px 実測。ズレは台帳へ差戻し) | pass |
| Q13 | カットアウェイ: C1–C7 準拠(透過範囲・家具必須数・C3 到達性) | pass |
| Q14 | ブループリント一致: 建物座標 100%、prop/NPC 座標 90% 以上一致(JSON diff) | pass |

人間承認は Q1–Q14 が全て緑になった画像に対してのみ依頼する。主観講評を待つ前に機械判定で落とすこと。

---

## 12. 不足素材 backlog(現有 109 で不可能な部分)

新規 ID は Wave B(計画済 49 ID)または新 wave として definition → 生成 → 人間承認 → export を経ること。
「代替」列は素材が届くまでの本書準拠の暫定表現。

| 新 asset ID | 種別 | 寸法/frames | layer | 使用場面 | 代替(暫定) | 優先度 |
|-------------|------|-------------|-------|----------|------------|--------|
| ground_edge_cobble / dirt / snow | 地形縁 autotile | 64px・16frame | decal | 全地区の地表遷移 | T1 の dirt fringe のみ | **P0** |
| waterline | 岸 autotile | 64px・16frame | decal | 水際全部 | cliff 直置き | **P0** |
| deck_edge | deck 縁 | 64px・4frame | decal | 港 | pier で縁を示す | **P0** |
| canopy_shadow | 樹冠影 decal | 64px・1frame・50%黒 | decal | 森林 | 接地影のみ | **P0** |
| snowdrift_a–c / leaf_litter_a–c / moss_a–b | 地面 overlay | Wave B 計画通り | decal | 雪/森の裸地率対策 | flowers/pebbles | **P0** |
| 施設 keeper・mob・住民 variant(22 人) | 人物 | Wave B 計画通り | world | §8.3 の代役解消 | 代役表 | P1 |
| wood_stairs | 構造 | Wave B | world | 森・港の段差 | stairs(石段) | P1 |
| stool/rug/open_crate/pot/lantern_stand/roster_board/cargo_scale/bottle_rack/register_book 等 13 props | 小物 | Wave B | world | 室内・港の密度 | 既存 18 小物 | P1 |
| chimney_smoke / fog / snow_fall / leaf_fall | 効果 | Wave B・4frame | effect | 夜と天候の空気感 | なし(省略) | P1 |
| rowboat | 構造 | 2×1・1frame | world | 港の水面(空白対策) | sea_marker/ripple のみ | P1 |
| inn_l | 建物 | 4×3 base+roof | world | カットアウェイの余裕(3×3 は最小構成) | inn 3×3 | P1 |
| sand(浜) | 地表 | 64px | ground | 港外縁 | dirt | P2 |
| cutaway_rim | 断面帯 | 建物幅×8px | world | C2 の切断面表現 | wall_trim 流用 | P2 |
| flag / rubble / pot(鉢) | 小物 | 64px 級 | world | schema PROP_KINDS の充足(flag/rubble/plant) | flag=省略, rubble=rock_c, plant=flowers_c | P2 |
| tree_a/c 雪化 variant | 構造 | 現 tree と同寸 | world | 雪地区の木 | tree_c 素のまま | P2 |
| door_open frames | 建物 frame | 台帳準拠 | world | 入店演出 | なし(即時 cutaway) | P2 |

### schema PROP_KINDS → Wave A 対応(暫定写像)

well→well, barrel→barrel, crate→crate, signboard→signboard_a/b, lamp→streetlight/lamp,
fence→fence, bench→bench, scaffold→scaffold_s/m/l, plant→flowers_c, todo_grass→flowers_b+pebbles_b 併置,
rubble→rock_c, flag→(P2 まで省略)。

---

## 13. 実装順序(この順以外で着手しない)

1. **ID 結合**: `asset-id-map.json` 生成。未対応正規名が残れば停止(§1)。
2. **renderer 契約**: §2 の合成順・anchor・y ソート・canopy fade・接地影を実装し、Q6 の unit test を先に書く。
3. **スキン表**: §3 を実装(地区 → asset 解決)。
4. **6 画面を静的 WorldPlan として手置き**: `Fable5SceneBlueprints.md` の座標を JSON 化してレンダリングし、
   1280×800 の画像を `tools/asset-forge/review/` に出力する(これが Codex 報告書の納品物①の実体)。
5. **チェッカー**: `tools/scene-check.mjs` で Q1–Q14 を自動判定。全緑 → 人間承認へ。
6. **generator 一般化**: 6 画面が承認されて初めて、§4–§8 の規則を WorldPlan generator のアルゴリズムに落とす。
   既存 `src/town/validator.mjs` の不変条件(REACHABLE / DOCK_ON_WATER / BRIDGE_SPANS_WATER /
   STAIRS_CONNECT_ELEVATION)は破らない。TILE_TYPES の拡張は不要(§3 の写像で足りる)。

美的判断を実装者が補完することを禁止する。本書と Matrix と Blueprints で決まらないことが出たら、
実装せずに「不足規則」として報告すること。
