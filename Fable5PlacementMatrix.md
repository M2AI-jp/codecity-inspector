# Fable5 Placement Matrix — 新prefab配置語彙

`Fable5PlacementGuide.md` の従属文書。1 素材 = 1 行。列の意味:

- **地区**: 使用可能地区。旧=旧市街 / 港 / 雪 / 森=森林 / 内=室内(カットアウェイ) / 全=全地区。
  夜は照明モードなので列にしない(Guide §9)。
- **必須隣接**: この素材を置くとき 2 タイル以内(明記なき場合)に必要なもの。満たせない場所には置かない。
- **禁止**: 置いてはならない位置。共通禁止(全素材): entrance セルの上、幅 1 の道の上(overlay を除く)。
- **個数**: 1 画面(camera 10×6.25 タイル)内の min–max。**0 可 = その画面で未使用可**。
- **間隔**: 同一 ID どうしの最小距離(タイル、チェビシェフ)。
- **frame/layer**: frame の選び方と Guide §2.1 の合成パス。
- **当たり**: 通行を塞ぐか(collision)。
- **反復**: 同一画面で繰り返し使用してよいか。

正規名→新prefab IDの結合は Guide §1 と PrefabSpec に従う。旧Wave Aの画像・ID・aliasは削除済みで、
再利用しない。contractに無い正規名・本表に無いcontract IDはどちらもエラー。

---

## 1. 地表 9(layer: ground)

地表は「比率」で管理する(個数・間隔は非適用)。比率は Guide §7 の地区表が正。

| 正規名 | 地区 | 置く理由 | 必須隣接/遷移 | 禁止 | frame | 歩行 |
|--------|------|----------|----------------|------|-------|------|
| grass | 旧/港/森 | 既定の地面 | cobble/plaza と接する時は dirt fringe(T1) | 雪地区(snow に差し替え) | 単一(variant 追加は backlog) | 可 |
| snow | 雪 | 雪地区の grass スキン | 他地区との境界は cliff+stairs(T4) | 平地で grass と直接隣接 | 単一 | 可 |
| dirt | 全 | fringe・小道・踏み跡・前庭 apron | — | — | 単一 | 可 |
| cobble | 旧/港 | 主要道(tile `road` のスキン) | 幅 2(R1)。grass と接する時 fringe | 森・雪の道(dirt を使う) | 単一 | 可 |
| plaza | 旧 | 広場(R4) | town_hall 正面。3×3–5×4 | 道の代用に細長く敷く | 単一 | 可 |
| deck | 港 | 桟橋面(tile `sand` のスキン) | 外周の水セルに pier 2 タイル間隔(T3) | 水に接しない内陸 | 単一(縁は backlog) | 可 |
| water | 全 | 水路・海・小川 | 幅 ≥2。岸は cliff、deck は直接可(T3) | 幅 1 の水路 | 単一(ripple は effect) | 不可 |
| cliff | 全 | 崖・岸・段丘(T5) | stairs を段差ごとに ≥1 | 直線 >4(T7) | 接続 frame(台帳) | 不可 |
| road | 森/雪(地区間の街道) | 地区間接続路 | 両端が他地区の道網に接続 | 旧市街内(cobble を使う) | 単一 | 可 |

## 2. 地面装飾 6(layer: decal、overlay。当たりなし・歩行影響なし)

| 正規名 | 地区 | 置く理由 | 必須隣接 | 禁止 | 個数 | 間隔 | 反復 |
|--------|------|----------|----------|------|------|------|------|
| flowers_a | 旧/森/港 | grass の裸地対策(D2) | grass 上 | snow/water/道 | 0–3 | 3 | 可(a→b→c 巡回) |
| flowers_b | 旧/森/港 | 同上 | 同上 | 同上 | 0–3 | 3 | 可 |
| flowers_c | 旧/森/港 | 同上・plant 代替 | 同上 | 同上 | 0–3 | 3 | 可 |
| pebbles_a | 全 | dirt/道/雪の裸地対策 | dirt/road/snow 上(森のみ grass も可) | plaza の中央部 | 0–3 | 3 | 可(巡回) |
| pebbles_b | 全 | 同上 | 同上 | 同上 | 0–3 | 3 | 可 |
| pebbles_c | 全 | 同上 | 同上 | 同上 | 0–3 | 3 | 可 |

装飾合計は 1 画面 4–10(意図的空白 D4 を除き、D2 の密度を満たすこと)。

## 3. 構造物 20(layer: world、y ソート)

| 正規名 | 地区 | 置く理由 | 必須隣接 | 禁止 | 個数 | 間隔 | frame | 当たり | 反復 |
|--------|------|----------|----------|------|------|------|-------|--------|------|
| stone_bridge | 旧 | 主要動線の渡河(T6) | 両端に道 ≥2、幅 1 | 水以外の上 | 0–1 | — | 接続(縦/横/端) | 通行可 | 不可 |
| wood_bridge | 港/森/雪 | 路地の渡河(T6) | 同上 | 同上 | 0–1 | — | 同上 | 通行可 | 不可 |
| stairs | 全 | 段差接続(T5) | 上下端 walkable、cliff 隣接 | 平地(段差なし) | 0–2 | — | 向き frame | 通行可 | 可 |
| fence | 全 | 境界・前庭・崖手前の安全柵 | 端 frame で終端。run 2–6 | 道を横断、完全包囲 | 0–8 セル | run 間 3 | 接続 frame | 塞ぐ | 可 |
| stone_wall | 旧/雪 | 擁壁・敷地境界 | 開口 ≥1(完全包囲禁止)。run 3–8 | 道を横断 | 0–8 セル | run 間 3 | 接続 frame | 塞ぐ | 可 |
| tree_a | 旧/港/森 | 大木。樹冠 3×2=(x−1..x+1, y−1..y) | 幹間 ≥2 で 3–5 本クラスタ、または道の折れ点に単独 1 | entrance 前 1 タイル、道上、雪(雪化 variant まで) | 0–4 | 2 | frame0=幹(world) frame1=樹冠(overhead) | 幹のみ塞ぐ | 可 |
| tree_b | 旧/港/森 | 中木。樹冠 2×2=(x−1..x, y−1..y) | 同上 | 同上 | 0–4 | 2 | 同上 | 同上 | 可 |
| tree_c | 全 | 小木/針葉(台帳画像で種別確認)。樹冠 1×2=(x, y−1..y) | 同上(雪地区で唯一使える木) | entrance 前、道上 | 0–4 | 2 | 同上 | 同上 | 可 |
| rock_a | 全 | 大岩。崖際・水際・森 | — | 道上、plaza | 0–2 | 3 | 単一 | 塞ぐ | 可 |
| rock_b | 全 | 中岩 | — | 同上 | 0–2 | 3 | 単一 | 塞ぐ | 可 |
| rock_c | 全 | 小岩・rubble 代替 | — | 同上 | 0–3 | 2 | 単一 | 塞ぐ | 可 |
| stone_lantern | 森/旧 | 参道灯(R5)。夜は光源 | 道の隣接セル。dojo 参道は対で | 道上中央 | 0–4 | 4(参道は 4–6 間隔) | 消灯/点灯 | 塞ぐ | 可 |
| pier | 港 | deck の支持杭(T3) | deck 外周の water セル | 内陸 | 2–8 | 2(等間隔) | 単一 | 水上(通行不可のまま) | 可 |
| well | 旧 | env/secrets の施設(FACILITY) | 広場縁か家屋裏。周囲 3×3 に walkable ≥6 | 道上中央 | 0–1 | — | 単一 | 塞ぐ | 不可 |
| barricade | 全 | 未解決 import の行き止まり(§8.5) | 道の端点セル。broken_signpost か warning_stake を 2 タイル以内 | validator REACHABLE を壊す位置 | 0–1 | — | 単一 | 塞ぐ | 不可 |
| broken_signpost | 全 | 未解決 import・廃道の標示 | 道の分岐/端点の隣接セル | — | 0–2 | 5 | 単一 | 塞ぐ | 可 |
| cycle_frame | 旧/森 | 循環依存の標(§8.5) | 循環建物群の重心至近の道脇 | 循環が無い画面 | 0–1 | — | 単一 | 塞ぐ | 不可 |
| ferry_landing | 港 | 渡し場(dock の動線) | deck 縁。dock entrance と同じ道網 | 内陸 | 0–1 | — | 単一 | 通行可 | 不可 |
| sea_marker | 港 | 海路標識 | water セル。岸/deck から 2–4 | 陸上 | 0–2 | 4 | 単一 | 水上 | 可 |
| survey_plot | 雪/外縁 | pendingInspections の予定地(§8.5) | warning_lantern 隣接。dirt/snow 上 | 道上 | 0–2 | 4 | 単一 | 塞ぐ | 可 |

## 4. 建物 19(layer: world=base + overhead=roof)

個数は画面合計 2–4(Q2)。敷地・setback・前庭・窓 anchor・室内床は Guide §5.1 の建物表が正。
ここでは Matrix 固有列のみ。全建物共通: 必須隣接=道網への接続(R7)、禁止=裸地単体置き(Guide §5)、反復=不可
(house/rowhouse/hut のみ同型 2 棟まで可、その場合間隔 0–2 で連担)。

| 正規名 | footprint | 地区 | 備考 |
|--------|-----------|------|------|
| gate | 台帳準拠 | 地区境界 | 道の端点。hub(validator)になる |
| town_hall | 4×4 | 旧 | ランドマーク。plaza 正面必須 |
| dojo | 3×3 | 森 | ランドマーク。参道 setback 1–3 |
| inn | 3×3 | 旧 | カットアウェイ実例(Blueprints Scene 6) |
| warehouse | 3×3 | 港 | crate×2 以上を前庭に |
| dock | 3×3 | 港 | **entrance が water に 4 方向隣接必須(validator DOCK_ON_WATER)** |
| guild | 3×3 | 旧/港 | — |
| pub | 3×3 | 旧 | 夜の光源核 |
| shop | 2×2 | 旧 | — |
| workshop | 3×3 | 旧/港 | 常時 scaffold(state=under_construction) |
| watchtower | 2×3 | 雪/港 | 雪のランドマーク |
| ruin | 2×2 | 森/旧外縁 | ivy_l 必須。屋根なし表現 |
| house_s | 2×2 | 旧 | 連担可 |
| house_m | 3×2 | 旧 | 連担可 |
| house_old | 2×2 | 旧/森 | ivy_s 併用 |
| hut | 2×2 | 雪/森/港 | — |
| rowhouse_s | 3×2 | 旧 | setback 0 固定・連担専用 |
| rowhouse_l | 4×2 | 旧 | 同上 |
| survey_tower | 2×2 | 雪/外縁 | tarp 必須。survey_plot 併設 |

## 5. 建物状態 overlay 11(layer: world、対象建物の base に装着)

| 正規名 | 対象 | 必須隣接 | 禁止 | 個数 | 備考 |
|--------|------|----------|------|------|------|
| ivy_s | 2×2 級 / 追加装飾 | house_old, ruin, 旧市街の任意 1 棟 | 新築感の建物(town_hall 正面) | 0–2/棟 | anchor=壁面(台帳) |
| ivy_m | 3×2/2×3 級 | 同上 | 同上 | 0–1/棟 | — |
| ivy_l | 3×3 級以上 | ruin は必須 | — | ruin=1 必須 | — |
| scaffold_s | 2×2 級 | state=under_construction | それ以外の建物 | 状態依存 | +construction_dust |
| scaffold_m | 3×2/2×3 級 | 同上 | 同上 | 状態依存 | 同上 |
| scaffold_l | 3×3 級以上 | 同上 | 同上 | 状態依存 | 同上 |
| snowcap_s | 2×2 級 | 雪地区の全建物に必須 | 雪地区外 | 建物数ぶん | サイズ表=Guide §5.1 |
| snowcap_m | 3×2/2×3 級 | 同上 | 同上 | 同上 | — |
| snowcap_l | 3×3 級 | 同上 | 同上 | 同上 | — |
| snowcap_xl | 4×4 級 | 同上 | 同上 | 同上 | — |
| tarp | survey_tower 必須 / under_construction の資材山 | survey_plot か scaffold の 2 タイル以内 | 単独使用 | 0–2 | — |

## 6. 屋内地形 3(カットアウェイ時のみ描画)

| 正規名 | 用途 | 規則 |
|--------|------|------|
| wood_floor | inn/pub/guild/shop/dojo/住居系の床 | footprint 全セル(Guide C2)。建物クラス対応は Guide §5.1 |
| stone_floor | town_hall/warehouse/workshop/dock/watchtower の床 | 同上 |
| wall_trim | 室内北壁の面 | 北端 1 行に overlay。東西端は 8px 縁 trim(C2) |

## 7. 小物・家具 18(layer: world、y ソート)

屋外/屋内の別に注意。屋内配置は Guide C4–C5 の家具セットが正で、本表は可否と間隔のみ。

| 正規名 | 屋外地区/屋内 | 置く理由 | 必須隣接 | 禁止 | 個数 | 間隔 | 当たり |
|--------|----------------|----------|----------|------|------|------|--------|
| lamp | 全(壁付き) | 施設入口の灯り(R5) | 建物壁 anchor(entrance 脇) | 地面への単独置き | 0–4 | — | なし(壁面) |
| streetlight | 旧/港 | 主要道の灯り(R5) | 道の隣接セル | 雪地区、幅 1 の道 | 0–3 | 5–7 | 塞ぐ |
| signboard_a | 旧/港(施設看板) | 施設の同定(plot kit d) | 対象建物の entrance 東 1 か壁付き | 対象建物なしの単独置き | 0–3 | — | 塞ぐ |
| signboard_b | 全(案内板) | 交差点・地区境界の案内 | 道の分岐/境界の隣接セル | — | 0–1 | — | 塞ぐ |
| warning_stake | 全 | 危険・未解決の標示 | barricade/survey_plot の 2 タイル以内 | 単独使用 | 0–2 | 3 | 塞ぐ |
| barrel | 全/内 | 生活感クラスタ | 建物壁 1 タイル以内、2–3 個で群 | 道の中央 | 0–4 | 群間 4 | 塞ぐ |
| crate | 港/旧/内 | 荷役クラスタ | 同上(港は deck 上可) | 同上 | 0–4 | 群間 4 | 塞ぐ |
| bench | 旧/森/内 | 広場縁・参道の腰掛け | 道/plaza に面する向き | 道上中央 | 0–2 | 3 | 塞ぐ |
| table | 内(屋外は pub 前 3 タイル以内のみ) | 食卓・作業台 | chair 1 以上隣接(屋内) | — | 0–2 | — | 塞ぐ |
| chair | 内(同上) | 席 | table か counter に隣接 | 単独置き | 0–3 | — | 通行可(interact) |
| counter | 内 | 接客(C3: 南から対話) | 北壁際の行 | 屋外 | 0–2 | — | 塞ぐ |
| shelf | 内 | 収納 | 壁際 | 室内中央 | 0–2 | — | 塞ぐ |
| ledger_desk | 内(town_hall/warehouse/dock) | 台帳事務 | 壁際 | それ以外の建物 | 0–1 | — | 塞ぐ |
| bed | 内(住居/inn) | 寝床(1×2 縦・頭北) | 北壁際 | 屋外 | 0–2 | — | 塞ぐ |
| hearth | 内(住居/inn/pub) | 炉。夜/室内光源(L2) | 北壁際 | 屋外 | 0–1 | — | 塞ぐ |
| training_dummy | 森(dojo 前庭)/内 | テストの景観化(§8.5) | dojo から 3 タイル以内 | dojo なしの画面 | 0–1 | — | 塞ぐ |
| practice_target | 森(dojo)/内 | 同上 | 手前(射線)2 セル以上 clear | 射線に建物/NPC | 0–1 | — | 塞ぐ |
| warning_lantern | 雪/外縁 | 検査中・危険の灯(夜は L2 光源) | survey_plot/barricade の 2 タイル以内 | 単独使用 | 0–2 | 3 | 塞ぐ |

## 8. 人物 7(layer: world、y ソート。個数と仕事対象は Guide §8.1・§8.3)

| 正規名 | 配置 | facing | 禁止 |
|--------|------|--------|------|
| player | spawn は gate 前か camera 中央帯の walkable。樹冠下では canopy fade(§2.3) | 進行方向 | water/wall/占有セル |
| town_clerk | town_hall entrance の隣接 walkable | up(door 向き) | town_hall なしの画面 |
| gatekeeper | gate 脇。雪地区では watch 代役(watchtower 前) | up | 対象施設なし |
| dojo_inspector | dojo 前庭/室内 | 作業対象向き | dojo なしの画面 |
| townsfolk_m | 道・店先・deck。代役表(§8.3)適用 | 進行/作業方向 | 仕事対象 2 タイル超 |
| townsfolk_f | 同上 | 同上 | 同上 |
| dojo_student | dojo 前庭。dummy/target の隣接 | 訓練対象向き | dojo なしの画面 |

anim: 4 方向 × idle/walk/talk/work(台帳)。静止配置は idle、counter 内は work。

## 9. 効果 4(layer: effect。装着点の正本は Guide §8.4)

| 正規名 | 装着点 | 個数 | frame |
|--------|--------|------|-------|
| water_ripple | pier/橋脚/岸/ferry_landing から 1 タイル以内の water | 2–4 | 4frame ループ |
| construction_dust | scaffold 上端 anchor | 1/建物 | 4frame ループ |
| window_glow | 建物の窓 anchor(夜 or 室内、occupied/busy のみ) | 窓数まで | 4frame ループ |
| discovery_glint | survey_plot・未読 evidence 対象 | 0–2 | 4frame ループ |

## 10. UI 12(layer: ui。スクリーン空間固定、ワールド zoom 非依存)

台帳の実 ID が 12 種。下表の 9 種は正規名が判明しているもの。残り 3 枠は台帳 ID をそのまま使い、
「画面端 anchor・セーフエリア 16px・ワールド描画に重ねる際は不透明度 90% 以下」の共通規則に従う。

| 正規名 | anchor | 規則 |
|--------|--------|------|
| dialogue | 画面下辺 | 高さ ≤200px(可視タイルを 1.5 行以上隠さない) |
| choice | dialogue の右上 | — |
| speech | 話者スプライトの頭上 +8px | ワールド追従 |
| journal | 画面右辺 | 開閉式。開時幅 ≤400px |
| evidence | journal 内タブ | observed/inferred/unknown を混ぜない(schema EVIDENCE_CLASSES) |
| facility_icons | 建物 roof 頂点の上 8px | ワールド追従。camera 内の施設のみ |
| key_prompts | 対話可能対象の上 | 対象から 2 タイル以内に player がいる時のみ |
| touch | タップ位置 | モバイル時のみ |
| cursor | ポインタ位置 | — |

---

## 未使用の明示(6 ブループリント時点)

以下は Matrix 上は許可されているが、`Fable5SceneBlueprints.md` の 6 画面では意図的に未使用。
素材消化は目的ではない(Guide 序文)。

- stone_bridge(旧市街の水路は 6 画面のフレーム外。地区レシピ上は旧市街主要動線用)
- guild / workshop / gate / house_m / house_old / rowhouse_l(6 画面のフレーム外の街区で使用)
- cycle_frame(6 画面のサンプルリポジトリ想定に循環がないため。循環検出時のみ §8.5 で出現)
- stone_wall(旧市街外周・段丘擁壁用)
- road(地区間街道用。6 画面はすべて地区内部)
