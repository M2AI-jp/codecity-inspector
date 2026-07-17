# Fable5 Scene Blueprints — 実寸 6 画面(座標が正本)

`Fable5PlacementGuide.md`(規則)と `Fable5PlacementMatrix.md`(素材別可否)の従属文書。
本書の 6 画面は Codex 報告書の納品物①の実体である。素材 PNG はこのリポジトリに無いため、
**画像モックは Codex がこのブループリントを WorldPlan JSON 化 → レンダリングして生成する**
(Guide §13 手順 4)。出力は 1280×800 PNG を `tools/asset-forge/review/` へ。

## 共通仕様

- キャンバス: **14×9 タイル**(x 0–13, y 0–8)。1 タイル = 64px。
- カメラ: 左上 **(2,1)**、可視 **10×6.25 タイル**(x2–11 全列、y1–6 全行 + y7 の上 1/4)。
- 座標表が正本。ASCII 図は地面レイヤーの補助図示(小物・NPC は載せない)。
- 建物 footprint は「(x1,y1)-(x2,y2)」= 両端含む矩形。entrance は Guide §2 の定義どおり
  footprint 外の walkable セル。
- ASCII 凡例(ground、tile type → スキンは Guide §3):

| 記号 | tile type | 記号 | tile type |
|------|-----------|------|-----------|
| `.` | grass | `~` | water |
| `:` | path(dirt) | `=` | sand(deck スキン) |
| `#` | road(cobble スキン) | `^` | cliff |
| `P` | plaza | `s` | stairs |
| `*` | grass(雪地区 → snow スキン) | `b` | bridge |
| 大文字 | 建物 footprint(wall/floor は generator 規約で塗る) | | |

- 各画面の「検収」節は Guide §11 のチェッカーに食わせる期待値。

---

## Scene 1 — 旧市街(昼)

地区: 旧市街。時間帯: 昼。

```
y0  . . . . R R R H H H H . . .
y1  . . . . R R R H H H H . . .
y2  . I I I . : . H H H H . . .
y3  . I I I . : . H H H H . S S
y4  : I I I : : P P P P P : S S
y5  # # # # # # P P P P P # # #
y6  # # # # # # P P P P P # # #
y7  : : : : : : : : : : : : : :
y8  . . . . . . . . . . . . . .
```

(注: 広場は (6,4)-(10,6) の 5×3。y5–y6 の x6–10 も plaza タイル)

### 建物

| 建物 | footprint | entrance | state | overlay | 備考 |
|------|-----------|----------|-------|---------|------|
| town_hall | (7,0)-(10,3) | (8,4) down | occupied | — | ランドマーク。広場正面 |
| inn | (1,2)-(3,4) | (2,5) down | busy | — | 壁 lamp・壁 signboard_a |
| rowhouse_s | (4,0)-(6,1) | (5,2) down | occupied | ivy_s | 入口小道 (5,2)-(5,4) |
| shop | (12,3)-(13,4) | (12,5) down | vacant | — | フレーム外縁。夜は無灯の実例 |

### 構造物・小物

| 素材 | 座標 | frame/備考 |
|------|------|------------|
| well | (6,4) | 広場北西角 |
| tree_a | (11,0) | 幹 world / 樹冠 overhead(3×2 = x10–12, y-1–0) |
| tree_b | (0,1) | フレーム外縁 |
| streetlight | (2,7), (9,7) | 間隔 7。昼は消灯 frame |
| lamp | inn 壁 / shop 壁 | entrance 脇の壁 anchor |
| signboard_a | inn 壁付き / (11,4) | (11,4) は shop 用 |
| signboard_b | (6,6) | 広場南西角(交差点案内) |
| bench | (7,6), (10,6) | 広場南縁、道向き |
| barrel | (0,4) | inn 西壁クラスタ |
| crate | (0,3) | 同上 |

### 装飾 overlay

flowers_c (2,0), flowers_a (1,8), flowers_b (4,8), flowers_c (8,8), flowers_a (12,8) /
pebbles_a (0,7), pebbles_b (5,7), pebbles_c (7,7), pebbles_a (12,7)

### NPC

| 人物 | 座標 | facing | 仕事対象 |
|------|------|--------|----------|
| town_clerk | (8,5) | up | town_hall entrance (8,4) |
| townsfolk_f | (4,6) | right | 街路歩行 |
| townsfolk_m | (11,5) | right | shop 店先 |

### 窓 anchor(夜・Scene 5 で使用)

inn: 南壁 x1, x3 / town_hall: 南壁 x7, x9 / rowhouse_s: 南壁 x6 / shop: 無灯(vacant)

### 検収

Q1 裸地率 ≈17%(≤40) / Q2 建物 3 / Q3 town_hall(camera 内 75%・最大高) / Q10 NPC 3・全員対象 2 タイル以内 /
Q11 硬質地表 ≈47%・シグネチャ streetlight, well, signboard_a

---

## Scene 2 — 港(昼)

地区: 港。時間帯: 昼。deck は tile `sand`、dock の entrance は水に 4 方向隣接(validator DOCK_ON_WATER)。

```
y0  . W W W . . . . . . . . U U
y1  . W W W . . . . . . . . U U
y2  : W W W : : : : : : : : : :
y3  # # # # # # # # # # # # # #
y4  # # # # # # # # # # # # # #
y5  ^ ^ ^ ^ ^ s = = D D D = = =
y6  ~ ~ ~ ~ ~ = = = D D D = = =
y7  ~ ~ ~ ~ ~ = = = D D D ~ ~ =
y8  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
```

(注: (11,7)-(12,7) は水の入江=船溜まり。桟橋に切れ込みを入れて dock の entrance を水に接させる)

### 建物

| 建物 | footprint | entrance | state | overlay | 備考 |
|------|-----------|----------|-------|---------|------|
| warehouse | (1,0)-(3,2) | (2,3) down | occupied | — | 壁 lamp・壁 signboard_a |
| dock | (8,5)-(10,7) | (11,6) right | busy | — | ランドマーク。entrance (11,6) は deck、南隣 (11,7) が water |
| hut | (12,0)-(13,1) | (12,2) down | occupied | — | フレーム外。入口小道 (12,2) |

### 構造物・小物

| 素材 | 座標 | 備考 |
|------|------|------|
| stairs | (5,5) | road(5,4)↔deck(5,6)。cliff (4,5) 隣接 |
| pier | (4,6), (4,8), (6,8), (13,8) | deck 外周の水セル、間隔 2 |
| ferry_landing | (6,7) | deck 南縁。pier (6,8) が真下 |
| sea_marker | (2,7) | 岸から 2 |
| fence | (5,2)-(7,2) | run 3、両端は端 frame |
| tree_c | (5,1), (8,1) | 間隔 3 |
| rock_a | (10,1) | — |
| crate | (6,5), (7,5) | deck 荷役クラスタ |
| barrel | (6,6) | 同クラスタ |
| crate | (0,1), (0,2) | warehouse 西壁クラスタ(フレーム外) |
| streetlight | (11,2) | 補完 1 本(R5 港則: 壁 lamp 優先) |
| signboard_b | (4,2) | 段差分岐の案内 |
| signboard_a | warehouse 壁 / dock 壁 | — |
| lamp | warehouse 壁 / dock 壁 | — |

### 装飾 overlay

pebbles_a (9,2), pebbles_b (4,4)※道縁, pebbles_c (12,2) / flowers_a (4,0), flowers_b (9,0)

### NPC

| 人物 | 座標 | facing | 仕事対象 |
|------|------|--------|----------|
| townsfolk_m(porter) | (7,6) | up | crate (7,5) |
| townsfolk_f | (3,3) | left | warehouse entrance (2,3) |

### 効果

water_ripple: (3,6), (11,7), (2,8)

### 検収

Q1 ≈20%(≤40。water は裸地に数えず、代わりに水面演出 ≥3: ripple×3 + sea_marker + pier ✓) /
Q2 建物 2(warehouse 部分 + dock) / Q3 dock + ferry_landing + sea_marker + 船溜まり /
Q10 NPC 2 / Q11 deck+water ≈56%・シグネチャ crate, pier, ferry_landing, ripple

---

## Scene 3 — 雪(昼)

地区: 雪(高台)。grass セルは snow スキン。他地区との境界は南の cliff+stairs(T4)。
道は幅 1 の踏み跡(path→dirt スキン)。全建物に snowcap(tarp 装着の survey_tower は tarp が雪覆いを兼ねるため除外)。

```
y0  * * * * * * * * * * * * * *
y1  * T T * * U U * * V V * * *
y2  * T T * * U U * * V V * * *
y3  * T T * * * * * * * * * * *
y4  : : : : : : * * : : : : * *
y5  * * * * * : : : : * * * * *
y6  ^ ^ ^ ^ ^ * * * ^ ^ ^ ^ ^ ^
y7  . . . . ^ ^ ^ s ^ . . . . .
y8  . . . . . . . . . . . . . .
```

(注: path は (0,4)-(5,4) → 折れ (5,5) → (6,5)-(8,5) → 折れ (8,4) → (9,4)-(11,4)。
崖線は x4 と x8 で 2 段の折れ。崖面 (4,6)+(4,7) / (8,6)+(8,7) は縦 2 セル。stairs (7,7) は
plateau(7,6) と下界 (7,8) を接続 = validator STAIRS_CONNECT_ELEVATION 準拠)

### 建物

| 建物 | footprint | entrance | state | overlay | 備考 |
|------|-----------|----------|-------|---------|------|
| watchtower | (1,1)-(2,3) | (2,4) down | occupied | snowcap_m | ランドマーク。壁 lamp |
| hut | (5,1)-(6,2) | (5,3) down | occupied | snowcap_s | entrance (5,3) は snow、南隣 (5,4) が path |
| survey_tower | (9,1)-(10,2) | (9,3) down | vacant | tarp | pendingInspections の景観化 |

### 構造物・小物

| 素材 | 座標 | 備考 |
|------|------|------|
| survey_plot | (11,2) | discovery_glint 装着 |
| warning_lantern | (11,3) | survey_plot 隣接。夜は光源 |
| barricade | (11,4) | path 東端 = 未解決 import の行き止まり |
| broken_signpost | (11,5) | barricade から 1 |
| warning_stake | (12,4) | barricade から 1(フレーム外縁) |
| fence | (0,5)-(2,5) | 崖手前の安全柵 run 3 |
| rock_b | (3,5) | — |
| rock_c | (8,2) | — |
| rock_a | (2,8) | 下界(フレーム外縁) |
| tree_c | (6,4) | path 折れ点の単独木 |
| tree_c | (9,8), (11,8), (13,8) | 下界の針葉クラスタ。樹冠が y7 に覗く |

### 装飾 overlay

pebbles_b (4,4), pebbles_c (6,5), pebbles_a (10,7)

### NPC

| 人物 | 座標 | facing | 仕事対象 |
|------|------|--------|----------|
| gatekeeper(watch 代役) | (3,4) | left | watchtower entrance (2,4) |
| townsfolk_m | (10,4) | right | barricade / survey_plot |

### 効果

discovery_glint (11,2)。窓 anchor: watchtower 南壁 x2 / hut 南壁 x5(survey_tower は vacant で無灯)

### 検収

Q1 ≈33%(≤50。雪の静けさは許容、ただし fence・rock・survey 群で 4×4 の完全空白を作らない) /
Q2 建物 3 / Q3 watchtower(snowcap_m 込みで最大高) / Q8 崖線の折れ 2 箇所・直線 run は端例外のみ /
Q10 NPC 2 / Q11 snow ≈63%・シグネチャ snowcap, warning_lantern, survey_plot+tarp

---

## Scene 4 — 森林(昼)

地区: 森林。道幅 1 の折れる小道、東に幅 2 の小川と wood_bridge。
※小川の岸: waterline autotile(backlog P0)到着まで grass 直接接触を暫定許容(Guide T3 例外)。

```
y0  . . . . . . . . . . . ~ ~ .
y1  . . R R . . . . D D D ~ ~ .
y2  . . R R . . . . D D D ~ ~ .
y3  . . . : . . . . D D D ~ ~ .
y4  . . . : . . . : : : ~ ~ . .
y5  . . . : : : : : : : ~ ~ . .
y6  : : : : . . . . : : b b : :
y7  . . . . . . . . . . ~ ~ . .
y8  . . . . . . . . . . ~ ~ . .
```

(注: main path (0,6)-(3,6) → 折れ (3,5) → (4,5)-(6,5) → 前庭 (7,4)-(9,5)=dirt。
東 path (8,6),(9,6) → bridge (10,6),(11,6) → (12,6),(13,6)。
ruin への spur (3,3),(3,4)。小川は y0–3 が x11–12、y4–8 が x10–11 で 1 タイル折れる)

### 建物

| 建物 | footprint | entrance | state | overlay | 備考 |
|------|-----------|----------|-------|---------|------|
| dojo | (8,1)-(10,3) | (9,4) down | occupied | — | ランドマーク。前庭 (7,4)-(9,5) |
| ruin | (2,1)-(3,2) | (3,3) down | ruined | ivy_l | 屋根なし表現。窓 glow 禁止 |

### 構造物・小物

| 素材 | 座標 | 備考 |
|------|------|------|
| wood_bridge | (10,6), (11,6) | 各タイル: 南北が water・東西が walkable(validator BRIDGE_SPANS_WATER) |
| stone_lantern | (6,4), (6,6) | 前庭入口の対。(6,5) の path を挟む |
| stone_lantern | (2,7) | path (2,6) 沿い。対から間隔 4 |
| training_dummy | (7,4) | 前庭 |
| practice_target | (7,5) | 射線東向き。(8,5), (9,5) は clear((9,5) は NPC のみ) |
| broken_signpost | (4,3) | ruin spur の脇 |
| rock_a | (2,4) | spur 西 |
| rock_c | (1,3) | フレーム外縁 |
| tree_a | (5,1) | 樹冠 (4-6, 0-1) |
| tree_b | (7,1) | 樹冠 (6-7, 0-1) |
| tree_c | (6,3) | 樹冠 (6, 2-3)。北西クラスタ 3 本 |
| tree_a | (3,7) | 樹冠 (2-4, 6-7) が path を覆う(canopy fade 対象) |
| tree_b | (5,7) | 樹冠 (4-5, 6-7) |
| tree_c | (7,7) | 樹冠 (7, 6-7)。南クラスタ 3 本 |
| tree_a | (13,1) | 樹冠 (12-13, 0-1) |
| tree_b | (13,4) | 樹冠 (12-13, 3-4) |
| tree_c | (13,7) | 樹冠 (13, 6-7)。東岸クラスタ 3 本 |

### 装飾 overlay

flowers_a (4,3)※spur 東, flowers_b (5,2), flowers_c (12,7) /
pebbles_a (4,5), pebbles_b (8,6), pebbles_c (9,6)

### NPC

| 人物 | 座標 | facing | 仕事対象 |
|------|------|--------|----------|
| dojo_inspector | (8,4) | right | 訓練の監督(student / target) |
| dojo_student | (9,5) | left | practice_target (7,5)(射線距離 2) |

### 効果

discovery_glint (3,3)※ruin 入口の未読 evidence / water_ripple (11,5), (10,7)

### 検収

Q1 ≈20%(≤45。樹冠被覆セルは裸地に数えない) / Q2 建物 2(森林規定) / Q3 dojo + 灯籠対 /
Q8 小川の折れ 1 箇所(y3/y4)・path 折れ 2 箇所 / Q10 NPC 2 /
Q11 緑(草+樹冠)≈66%・シグネチャ stone_lantern, training_dummy, ivy

---

## Scene 5 — 夜(旧市街の照明モード)

**ジオメトリ・構造物・装飾は Scene 1 と完全同一**(差分のみ記す)。照明規則は Guide §9。

### 差分

- NPC: town_clerk を削除(役場閉庁)。townsfolk_f (4,6)・townsfolk_m (11,5) の 2 体のみ(L4)。
- streetlight (2,7), (9,7): 点灯 frame に切替。
- lamp: inn 壁 = 点灯。shop 壁 = 消灯(vacant)。
- window_glow(effect 層、4frame ループ):

| 建物 | anchor | 個数 |
|------|--------|------|
| inn(busy) | 南壁 x1, x3(接地 +40px) | 2 |
| town_hall(occupied) | 南壁 x7, x9 | 2 |
| rowhouse_s(occupied) | 南壁 x6 | 1 |
| shop(vacant) | **無灯**(「まだ灯っていない」= unknown evidence の可読化) | 0 |

### 光源一覧(lighting 層、L2)

| # | 光源 | 位置 | 半径 | 色/不透明度 |
|---|------|------|------|--------------|
| 1–2 | streetlight | (2,7), (9,7) | 160px | #ffb44d 35% |
| 3 | lamp(inn 壁) | inn entrance 脇 | 160px | #ffb44d 35% |
| 4–8 | window_glow ×5 | 上表 anchor | 96px | #ffd27f 30% |

ambient: multiply RGB(64,80,132) 50%(L1)。

### 検収

Q9 光源 8(4–12 内)・道タイルの 90% 以上が光源 4 タイル以内((2,7) が x0–6、(9,7) が x5–13 をカバー) /
Q10 NPC 2 / vacant 無灯の可読(shop だけ暗い)を人間確認項目に追加

---

## Scene 6 — カットアウェイ(旧市街・昼)

**街路と家具付き室内が同一画面に共存する**実証画面。別画面遷移は禁止(C1)。
player が inn の door セル (6,4) にいるため、inn の roof のみ不透明度 0。pub・house_s の屋根は通常描画(C7)。

```
y0  . . . . . . . . . . . . . .
y1  . . . . . . . . . . . . . .
y2  . . . . . I I I . B B B . .
y3  . . H H . I I I . B B B . .
y4  : : H H : I I I : B B B : :
y5  # # # # # # # # # # # # # #
y6  # # # # # # # # # # # # # #
y7  : : : : : : : : : : : : : :
y8  . . . . . . . . . . . . . .
```

### 建物

| 建物 | footprint | entrance | state | 描画 | 備考 |
|------|-----------|----------|-------|------|------|
| inn | (5,2)-(7,4) | (6,5) down | busy | **cutaway**(roof α0) | 室内は下表 |
| pub | (9,2)-(11,4) | (10,5) down | occupied | 通常 | 壁 lamp・壁 signboard_a |
| house_s | (2,3)-(3,4) | (3,5) down | occupied | 通常 | 前庭 flowers_c (1,2) |

### inn 室内(C2–C6)

床: wood_floor (5,2)-(7,4) 全 9 セル。wall_trim: 北端 1 行 (5,2)-(7,2) + 東西 8px 縁 trim。

| セル | 内容 |
|------|------|
| (5,2) | hearth(北壁際)+ hearth glow(128px #ff9a3d 40%、昼でも点灯 C6) |
| (6,2) | keeper 立ち位置: townsfolk_f(innkeeper 代役)facing down・work anim |
| (7,2)-(7,3) | bed(1×2 縦、頭北) |
| (5,3) | chair(counter 隣接、通行可 interact) |
| (6,3) | counter(南セル (6,4) から対話可能) |
| (5,4), (6,4), (7,4) | 空き床。(6,4) = door セル、player 位置 |

C3 検証: door (6,4) から (5,4), (7,4), (5,3) へ到達可。keeper セル (6,2) は counter 背後で分離(例外規定どおり)。

### 構造物・小物(街路側)

| 素材 | 座標 | 備考 |
|------|------|------|
| tree_b | (2,1) | 樹冠 (1-2, 0-1) |
| tree_c | (13,2) | フレーム外縁 |
| streetlight | (4,7), (11,7) | 間隔 7 |
| bench | (8,7) | 道向き |
| crate | (8,3) / barrel (8,4) | pub 西壁クラスタ |
| signboard_a | inn 壁 / pub 壁 | — |
| lamp | inn 壁 / pub 壁 | — |

### 装飾 overlay

flowers_b (4,2), flowers_a (8,2), flowers_c (1,2), flowers_c (13,3) /
pebbles_a (2,7), pebbles_c (10,7)

### NPC・player

| 人物 | 座標 | facing | 備考 |
|------|------|--------|------|
| player | (6,4) | up | inn 室内 door セル。cutaway トリガー中 |
| townsfolk_f | (6,2) | down | innkeeper 代役(室内) |
| townsfolk_m | (9,6) | up | pub へ向かう歩行者 |

### 検収

Q2 建物 3 / Q3 = cutaway 中の inn(屋根透過 + 室内 3 種の床材・家具はこの画面の固有資産扱い) /
Q13 C1–C7 準拠(透過範囲 = inn roof 全体のみ、家具必須数: counter1・chair1・bed1・hearth1 ※shelf は
3×3 最小構成のため省略 → inn_l(backlog P1)導入時に追加) / Q10 NPC 2 + player /
街路と室内の同時可視を人間確認項目に追加

---

## 実装ノート(6 画面共通)

1. これらは静的 WorldPlan として手置きする(Guide §13 手順 4)。generator の一般化はその後。
2. tile type は凍結された `schema.mjs` TILE_TYPES のみ使用(deck=sand、cobble=road スキン。Guide §3)。
3. validator(`src/town/validator.mjs`)を 6 画面の JSON にも通すこと: REACHABLE / DOCK_ON_WATER
   (Scene 2)/ BRIDGE_SPANS_WATER(Scene 4)/ STAIRS_CONNECT_ELEVATION(Scene 2・3)は設計済みで通る。
4. 接地影(Guide §2.1)は全建物・構造物に自動付与。ここでは個別記載しない。
5. shelf の省略(Scene 6)、snowcap と tarp の排他(Scene 3)のような**意図的な省略は本書に明記済み**。
   明記のない省略・追加は Q14(ブループリント一致)違反として落とすこと。
