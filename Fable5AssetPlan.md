# CodeCity — Fable5 素材処遇・制作計画（Asset Disposition & Required-Set Plan）

- 作成日: 2026-07-15（同日、敵対的設計レビューの素材関連所見を反映済み）
- 作成者: Fable5（design-only）
- 上位文書: [Fable5GameDesign.md](Fable5GameDesign.md)（使用scene・意味の根拠）/ [Fable5DesignHandoff.md](Fable5DesignHandoff.md) §8・§12
- 状態: **設計提案／所有者承認待ち**。所有者がscope変更を承認するまで、現行「approved 78のみ・全78使用」gateを実装側が変更してはならない（handoff §13 二段階gate）
- 素材制作: Codex側の画像生成（無制限）＋Asset Forge取り込み。**承認は権限ある人間のみ**・approved-only export・fail-closed は不変
- **数量の正本は §4 の台帳表**。他節の数字は全て§4から引用する

## 0. 確定前提（handoff 0.1）

- 現行78素材は**量・種類とも完成に全く足りず、現行実装での使い方も悪い**（所有者確定判定）。本計画は「78の並べ直し」を一切せず、[Fable5GameDesign.md](Fable5GameDesign.md) の体験から必要量を逆算する。
- 「悪い使い方」の構造的原因と対策:

| 悪い使い方（現行） | 本計画での廃止・対策 |
| --- | --- |
| 素材ID網羅を優先した固定配置（素材消化） | 「全ID使用」gateを「**required set全IDが、意味ある到達可能なsceneで使われる**」に置換。配置はWorldPlan文法（設計書§4）が決める |
| 同一tileのflip/回転反復 | autotile族＋variant≥3＋反復禁止則（設計書§10.5） |
| 静止NPC | アニメ契約の拡張（10動作） |
| opacityと`?`による状態表現 | 状態は専用素材（灯り・蔦・足場・雨覆い・杭・赤提灯）で表現 |
| 非整数拡大 | 整数倍表示規則（設計書§10.4） |

## 1. 新・表示/寸法契約（VisualAssetContract v2 の骨子） `ASSET-CHANGE`

| 項目 | v1（現行） | v2（本計画） |
| --- | --- | --- |
| 投影 | 素材ごとに不統一 | **斜め見下ろし（3/4俯瞰）単一投影・光源左上奥固定**（設計書§10.1） |
| タイル | 64×64 単tile | 64×64 基準は維持。地表は**autotileシート**（§2.2） |
| キャラクター | 96×120シート、24×40 frame、4方向×3動作 | **480×384シート、48×96 frame（body 40×80）、4方向×10動作**（idle2/walk4/talk2/work2。全キャラ統一） |
| 建物 | 256×256 一枚 | **二層**: interior base ＋ roof/facade overlay（同寸・同anchorのpair契約）。サイズはfootprintクラス別（§2.1） |
| プロップ | 64×64 | 32〜64px、接地楕円込み |
| エフェクト | 128×32（32×32×4） | 32×32×4を基本に、64×64×4（煙柱）を追加 |
| UI | 定義のみ・必須0 | **必須化**（9-slice・アイコン・キーキャップ） |
| 表示 | 1.4×非整数拡大あり | **整数倍のみ**（1×/2×/3×。overview縮小のみ非整数可） |
| 配置契約 | なし（runtime手書き値） | **各definitionに pivot / baseline / footprint / entrance / collision / occlusion / roofMask を必須フィールド化**（§6-3）。**outputSizeは宣言scaleClassの§2.1寸法と一致必須**（invariant） |

## 2. Asset family アーキテクチャ

### 2.1 建物（layered building）

- 1建物 = 1 ID = **2画像**: `<id>.base`（屋内床・内壁・据付家具・戸口）＋ `<id>.roof`（屋根天面＋正面ファサード）。カットアウェイは roof の opacity 制御のみで成立（設計書§6）。
- footprintクラスと画像寸法（**画像高さ=footprint高＋1.5タイル**。明示例外: XL=+2.0タイル（ランドマーク余白）、tower=+3.5タイル（頭部視認。設計書§10.3の「高さ4タイル級」））:

| クラス | footprint | 画像 | 屋内歩行可能床（設計書§6.2） | 該当建物 |
| --- | --- | --- | --- | --- |
| S | 2×2 | 128×224 | なし（戸口会話型） | house_s, hut, ruin |
| M | 3×3 | 192×288 | 2×2 | guild, pub, shop, workshop, house_m, house_old |
| L | 4×4 | 256×352 | 3×3 | dojo, inn, warehouse, dock |
| XL | 5×4 | 320×384 | 4×3 | town_hall, gate |
| tower | 2×2 | 128×352 | 階段＋頂上 | watchtower, survey_tower |
| rowhouse_s | 6×3 | 384×288 | 廊下＋部屋≤8 | 長屋S |
| rowhouse_l | 8×4 | 512×352 | 廊下＋部屋≤12（2階で≤24） | 長屋L |

- **長屋の窓契約**: 街路面に1部屋=1窓を等間隔配置し、roofMaskとは別に窓anchor座標をdefinitionに列挙（`effect.window_glow` が部屋stateと1:1結線。設計書§4.3）。
- 状態は**オーバーレイ素材**で合成（別建物画像を作らない）: `overlay.ivy.{s,m,l}`、`overlay.scaffold.{s,m,l}`、`overlay.snowcap.{s,m,l,xl}`、`overlay.tarp`、窓灯りは `effect.window_glow`（加算）。建物×状態の組合せ爆発を防ぎ、O-3（素材削減）を状態表現でも実現。

### 2.2 地表（autotile family）

- 1 family = 1シート: base variant 3枚＋**縁取りblob 16タイル**（透過縁。隣接family上に重ねる方式でペア爆発なし）。シート寸法 320×320（5×5×64px）。**autotile indexの解決はWorldPlan generator側**（設計書§4.8。rendererは引くだけ）。
- families: `terrain.grass / snow / dirt / cobble / plaza / deck / water(+2frame波) / cliff / road / survey_blank(未測量の方眼紙)`。
- 装飾オーバーレイ（反復破り）: `overlay.flowers.{a,b,c} / pebbles.{a,b,c} / snowdrift.{a,b,c} / leaf_litter.{a,b,c} / moss.{a,b}`。

### 2.3 立体構造物

`structure.bridge_stone / bridge_wood`（縦横＋**broken端部**=切れた橋）、`stairs_stone / stairs_wood`、`fence`（autotile 8）、`wall_stone`（autotile 8）、`tree.{a,b,c}`（**canopy/trunk分離**=樹冠遮蔽。**cは大型=2×2 footprint・高さ3タイルの「森の巨木」ランドマーク兼用**）、`rock.{a,b,c}`、`stone_lantern`、`pier`（桟橋杭）、`well`（井戸・2×2）、`barricade`、`signpost_broken`（行き先の消えた道標）、`cycle_wellcurb`（**渦紋の井桁**=環状広場の中心）、`ferry_shelter`（渡し場の待合=dynamic import）、`searoute_marker`（海路標識=外部接続）、`survey_plot`（**測量杭＋ロープ**=画像未着区画の専用記号。設計書§9.7）。

### 2.4 屋内・家具（共通プロップ語彙）

- `interior.floor_wood / floor_stone`（autotile）、`interior.wall_trim`。
- 家具・調度19点: `prop.bed / table / chair / counter / shelf / hearth / desk_ledger / stool / rug / crate_open / pot / lantern_stand / roster_board / training_dummy / practice_target / cargo_scale / bottle_rack / register_book / lantern_warning`（**赤提灯**=unresolved警告の正規表現。設計書§3.1）。

### 2.5 キャラクター

- 全員 v2 契約（48×96 frame、4方向×10動作=idle2/walk4/talk2/work2、480×384シート）。
- roster **29体**: player、keeper 12（gatekeeper, town_clerk, dojo_inspector, well_keeper※新, warehouse_keeper, dock_ferryman, guildmaster, innkeeper, tavern_master, workshop_artisan, watchtower_guard, shopkeeper※新）、**dojo_student※新**（道場の立ち合い演者。打ち込みworkフレーム）、mob 11（現行roster踏襲）＋**住民variant 4**（townsfolk_c/d、elder_f、youth※新）。
- 顔portrait（128×128 bust）は wave C のoptional（設計書D2/D12関連）。

### 2.6 エフェクト・UI

- effects 8: `window_glow / chimney_smoke_white(64×64×4) / fog_patch / discovery_glint / snow_fall / leaf_fall / water_ripple(v2) / construction_dust(v2)`。
- UI 12: `ui.dialogue_window（9-slice）/ choice_button / speech_bubble / journal_book / evidence_panel / facility_icons（14種シート）/ evidence_icons（●▲?）/ key_prompts / touch_action / cursor / footstep / town_crest`。

## 3. 現行78素材の処遇マトリクス（成果物10・全ID）

処遇: **keep**=無変更で v2 へ / **remake**=同役割の後継を新契約で再制作（supersede） / **retire**=v2 required setから除外（台帳のapproved記録・bytesは不変）。

> 結論の要約: **keep 0 / remake 65 / retire 13**（building 16/1、character 22/0、field 13/6、object 12/6、effect 2/0）。投影統一（斜め見下ろし・光源固定）が必達（O-1）のため、無傷で流用できる素材はない。remakeは「役割を引き継ぐ」、retireは「役割ごと廃止（後継は別family）」。

### 3.1 building（17件: remake 16 / retire 1）

| ID | 処遇 | 理由 / v2後継（クラスは§2.1） |
| --- | --- | --- |
| building.dock | remake | → `building.dock`（L）。桟橋・海路標識と接続 |
| building.dojo | remake | → `building.dojo`（L）。屋内に的・畳・門下生 |
| building.gate | remake | → `building.gate`（XL門構え）。看板にrepo名合成領域＋門柱の通行札anchor |
| building.guild | remake | → `building.guild`（M）。名簿板・呼び鈴 |
| building.house.medium | remake | → `building.house_m`（M） |
| building.house.small | remake | → `building.house_s`（S・戸口会話型） |
| building.hut | remake | → `building.hut`（S・森林亜種） |
| building.inn | remake | → `building.inn`（L）。客室扉の列 |
| building.old_house | remake | → `building.house_old`（M・旧市街亜種） |
| building.pub | remake | → `building.pub`（M）。席=接続のanchor |
| building.ruin | remake | → `building.ruin`（S。**破損表現ではなく「無住・下草」**） |
| building.shop | remake | → `building.shop`（M）。陳列棚 |
| building.town_hall | remake | → `building.town_hall`（XL）。旗・掲示板 |
| building.warehouse | remake | → `building.warehouse`（L）。棚と開閉できる木箱 |
| building.watchtower | remake | → `building.watchtower`（tower。logging施設時のみ建つ。設計書§4.5） |
| building.well | **retire** | 建物扱いを廃止 → 後継は `structure.well`（屋外構造物） |
| building.workshop | remake | → `building.workshop`（M）。図面台・煙突 |

追加建物（§4台帳）: `building.rowhouse_s / rowhouse_l`（長屋）、`building.survey_tower`（**検査官の櫓**=常設ランドマーク。設計書§4.5）。

### 3.2 character（22件: remake 22）

| ID | 処遇 | 理由 / v2後継 |
| --- | --- | --- |
| character.player | remake | 48×96・10動作。不鮮明の主因（24×40）を根絶 |
| character.gatekeeper / town_clerk / dojo_inspector / warehouse_keeper / dock_ferryman / guildmaster / innkeeper / tavern_master / workshop_artisan / watchtower_guard | remake | keeper 10名。固有verb演出のwork 2フレーム（帳面・的・遠眼鏡等）を10動作契約内に持つ |
| character.mob.artisan / child / delivery_person / dock_worker / elder / inn_guest / merchant / tavern_guest / townsfolk_female / townsfolk_male / traveler | remake | mob 11名。巡回walk・反射台詞talk・汎用work |

追加（§4台帳）: `well_keeper`、`shopkeeper`、`dojo_student`、住民variant 4（townsfolk_c/d, elder_f, youth）。

### 3.3 field（19件: remake 13 / retire 6）

| ID | 処遇 | 理由 / v2後継 |
| --- | --- | --- |
| field.grass | remake | → `terrain.grass`（autotile family化） |
| field.snow | remake | → `terrain.snow` |
| field.dirt_path | remake | → `terrain.dirt` |
| field.cobblestone | remake | → `terrain.cobble`。**着手前にdefinitionの苔岩overlay混入を修正**（handoff 8.6-2） |
| field.plaza | remake | → `terrain.plaza` |
| field.dock_floor | remake | → `terrain.deck` |
| field.water | remake | → `terrain.water`（岸autotile＋2frame波） |
| field.river_edge | **retire** | waterのautotile縁に吸収（単tile方式の廃止） |
| field.road_edge / road_corner / road_intersection | **retire**（3件） | `terrain.road` autotileに吸収 |
| field.cliff | remake | → `terrain.cliff`（autotile・1.5タイル立面） |
| field.stairs_stone | remake | → `structure.stairs_stone`（構造物へ再分類） |
| field.bridge_stone | remake | → `structure.bridge_stone`（縦横＋broken端部） |
| field.bridge_wood | remake | → `structure.bridge_wood`（同上） |
| field.fence_wood | remake | → `structure.fence`（autotile 8） |
| field.wall_stone | remake | → `structure.wall_stone`（autotile 8） |
| field.rock | **retire** | 「opaque ground定義なのに透過overlay運用」の矛盾ID（handoff 8.6-2）。後継 `structure.rock.{a,b,c}` |
| field.tree | **retire** | 同矛盾＋1種反復の主因。後継 `structure.tree.{a,b,c}`（canopy/trunk分離） |

### 3.4 object（18件: remake 12 / retire 6）

| ID | 処遇 | 理由 / v2後継 |
| --- | --- | --- |
| object.barrel / bench / crate / stacked_crates / flowerbed / lamp / notice_board / signboard / streetlight / rubble / construction_sign / warning_stake | remake（12件） | 投影統一＋接地楕円。warning_stakeはunresolved家の玄関前の正規表現に昇格（`prop.*`へ再分類） |
| object.well | **retire** | `structure.well` に統合（building.wellと二重だった） |
| object.grass_patch | **retire** | 装飾overlay族に置換 |
| object.unverified_tag | **retire** | 「?タグ」状態表示の廃止 → `overlay.tarp`＋語りで表現（設計書§3.2） |
| object.blue_flag | **retire** | 色旗による抽象状態表示の廃止（素材消化の典型）。旗はtown_hall造形に統合 |
| object.red_flag | **retire** | 同上。警告は `prop.warning_stake`＋`prop.lantern_warning`（赤提灯）へ |
| object.yellow_flag | **retire** | 同上。推測は `overlay.scaffold`＋語尾表現へ |

### 3.5 effect（2件: remake 2）

| ID | 処遇 | 理由 / v2後継 |
| --- | --- | --- |
| effect.water_ripple | remake | 新water autotileの岸と整合する波紋 |
| effect.construction_dust | remake | プログレッシブロードの「建ち上がり」演出（設計書§9.7）に用途変更 |

## 4. v2 required set 正本台帳（成果物10・11） `ASSET-CHANGE`

**数え方の規約**: 1 ID = 1 definition。建物は1 IDに base/roof の**2画像**が属す（画像数はID数と別勘定）。以下が唯一の正本。**合計 158 ID（remake 65 ＋ add 93）／ wave A 109・wave B 49**。

| family | ID数 | remake | add | wave A（ID列挙） | wave B（ID列挙） |
| --- | ---: | ---: | ---: | --- | --- |
| terrain | 10 | 8 | 2 | grass, snow, dirt, cobble, plaza, deck, water, cliff, **road**（9） | survey_blank（1） |
| 装飾overlay | 14 | 0 | 14 | flowers.a/b/c, pebbles.a/b/c（6） | snowdrift.a/b/c, leaf_litter.a/b/c, moss.a/b（8） |
| structure | 21 | 5 | 16 | bridge_stone, bridge_wood, stairs_stone, fence, wall_stone, tree.a/b/c, rock.a/b/c, stone_lantern, pier, well, barricade, signpost_broken, cycle_wellcurb, ferry_shelter, searoute_marker, survey_plot（20） | stairs_wood（1） |
| building | 19 | 16 | 3 | 全19: gate, town_hall, dojo, inn, warehouse, dock, guild, pub, shop, workshop, watchtower, ruin, house_s, house_m, house_old, hut, rowhouse_s, rowhouse_l, survey_tower | —（0） |
| 状態overlay | 11 | 0 | 11 | ivy.s/m/l, scaffold.s/m/l, snowcap.s/m/l/xl, tarp（11） | —（0） |
| interior | 3 | 0 | 3 | floor_wood, floor_stone, wall_trim（3） | —（0） |
| prop | 31 | 12 | 19 | lamp, streetlight, signboard, notice_board, warning_stake, barrel, crate, bench ＋ table, chair, counter, shelf, desk_ledger, bed, hearth, training_dummy, practice_target, **lantern_warning**（18） | flowerbed, stacked_crates, rubble, construction_sign ＋ stool, rug, crate_open, pot, lantern_stand, roster_board, cargo_scale, bottle_rack, register_book（13） |
| character | 29 | 22 | 7 | player, town_clerk, gatekeeper, dojo_inspector, townsfolk_male, townsfolk_female, **dojo_student**（7） | 残keeper 9（well_keeper, shopkeeper含む）＋残mob 9＋variant 4（22） |
| effect | 8 | 2 | 6 | water_ripple, **construction_dust**, window_glow, discovery_glint（4） | chimney_smoke, fog_patch, snow_fall, leaf_fall（4） |
| ui | 12 | 0 | 12 | 全12（§2.6） | —（0） |
| **合計** | **158** | **65** | **93** | **109** | **49** |

- 検算: remake 65 = terrain 8＋structure 5＋building 16＋prop 12＋character 22＋effect 2。retire 13はこの台帳に**含まれない**（§3参照。台帳から削除もしない）。
- wave A の選定根拠: (1) **全19建物**を含む=fail-closed下で中規模repoが起動できる（設計書§12.1・blocker解消）、(2) slice 5 verb（役場・門・道場・住宅・櫓）の演者と道具が揃う（dojo_student, training_dummy, practice_target, 通行札はgate造形内）、(3) tiny-townの3つの見どころ（切れた橋=broken端部+lantern_warning、渦の広場=cycle_wellcurb、灯り1軒=window_glow）が全て描ける。
- wave C（optional・required set外）: portrait 12、biome variant追加、audio以外の演出強化。
- **注**: 各IDの完全仕様（§6-3様式）の起票タイミングは設計書§14 **D15**（default: wave A分をPhase 0完了までに確定、残りはwave毎）。handoff §11-10の「全ID即時仕様化」からの逸脱として所有者承認を求める。

## 5. 新required setと二段階gate移行（handoff §13）

1. **現行gate維持期間**: 所有者が本計画を承認するまで、実装側は「approved 78のみ・全78使用」を変更しない。
2. **承認後**: §4台帳が正本。gateは「**変更後のapproved required setのみ使用し、その必須集合を意味ある到達可能なsceneで使う**」へ差し替え。
3. **移行の実務**（fail-closed期間を作らない）:
   - 現行manifest（schemaVersion 2・78件）は**凍結のまま不変**。v2素材は**新manifest（schemaVersion 3）へ二系統export**（§6-7）。
   - renderer v2は最初からv3 manifestのみを読む。旧runtime＋旧manifestはrenderer v2受入まで並存し、切替は一括（新旧素材の混在描画を禁止）。
   - required setは**wave単位で宣言**（wave A完了→v3 manifest(required=A)をexport→slice実装。wave B完了→required=A∪Bで再export）。各exportは「宣言required setの完全」を条件にatomic実行。
4. **retire 13件は台帳から削除しない**（approved記録・content-addressed bytesは不変）。v3 manifestに含めないだけ。

## 6. Asset Forge 側の先行整備（制作開始の前提条件） `ASSET-CHANGE`

handoff §8.6 の不足に対応する。**いずれも実装担当と別のread-only reviewerによるdistribution/security review必須**（handoff §12）。

1. **supersede lifecycle**: 同一役割remakeを「新ID/新hash承認→旧IDをsuperseded状態へ」で扱う正式経路。台帳手編集の禁止は維持。
2. **recipe-aware増分import**: `manual-import`（またはjob pack import）にproduction recipe＋persistent source snapshotを渡すCLI経路。programmatic `importCandidate()` の一般operator workflow接続。
3. **field系definitionの意味矛盾修正**: cobblestone/rock/tree（§3.3のとおりrock/treeはretire、cobbleは修正後remake）。
4. **配置契約フィールドの追加**: definition schemaに `pivot / baseline / footprint / entrance / collision / occlusion / roofMask / windowAnchors` を必須追加（§1）。画像単体でなくscene成立を契約で保証する。
5. **autotile／拡張アニメ／二層建物のschema対応**: blob16シート、10動作×4方向グリッド、base/roofペア契約（同寸・同anchor）。
6. **検査gateの昇格**: alpha bbox・hard alpha・exact seam・nearest resize検査を全候補への汎用reject gateへ昇格（handoff §8.4）。
7. **manifest schemaVersion 3 ＋ 二系統export**: 凍結v2 manifest（78）と並行して、**wave単位のrequired set宣言**を受け取り「宣言集合の完全」を検査してatomic exportするv3経路。履歴用one-shot wave script（handoff 8.6-3）を置き換える。distribution変更として独立review対象。

## 6-1. 制作順（1素材あたり・handoff §12準拠）

設計承認 → definition起票（§6-3様式・D15のタイミング）→ 必要referenceの所有者提供＋rights/license note（D14）→ job pack → **Codex画像生成（無制限・外部）** → recipe-aware増分import＋source snapshot → native/repeat/ensemble審査 → **権限ある人間の承認** → wave単位の明示export。

## 6-2. 審査基準（native / repeat / ensemble）

- **native**: 等倍で輪郭明瞭・投影/光源が§1どおり・binary alpha・接地楕円あり。
- **repeat**（terrain/overlay/fence等）: 3×3敷詰めでseamなし・反復が2秒で目視特定されない。
- **ensemble**: 該当biomeのscene blueprint（設計書§10.6。未承認候補アートで構成可・**Phase 1完了前**提出）へ合成し、6枚審査基準を再適用。**個別に美しく、並べて破綻する素材を落とす**段。

## 6-3. per-asset仕様の必須フィールド（definition化の様式）

`decision / assetId(新旧対応) / category / runtime semantic / 使用biome・scene / gameplay meaning / perspective(斜め見下ろし固定) / scale class / palette適合 / lighting(左上奥) / silhouette要件 / output size(=§2.1のクラス寸法。不一致は起票時reject) / transparency / frame grid / pivot / baseline / footprint / entrance / collision / occlusion / roofMask(建物) / windowAnchors(長屋) / states / animations / variants / autotile edge契約 / 使用可能reference / native・repeat・ensemble合格基準 / replacement or addition / priority(wave)`

## 6-4. 記入例（1件・building.inn v2）

```yaml
decision: remake                 # 旧 building.inn を supersede
assetId: building.inn            # 1 ID = base/roof の2画像（pair契約）
images: [building.inn.base, building.inn.roof]   # 各 256x352 PNG
category: building
runtimeSemantic: facility:inn
scene: 港/旧市街の表通り。客室扉を順に見る verb（設計書§7）の現場
gameplayMeaning: service/route file の存在を示す公共建築。客室札=service file
perspective: 斜め見下ろし(3/4俯瞰) / lighting: 左上奥・薄暮＋窓暖色
scaleClass: L(4x4)               # §2.1: L = footprint 4x4 / 画像 256x352
outputSize: 256x352 / transparency: binary alpha / frameGrid: none
silhouette: 2階建て・軒下看板・煙突なし（workshopと区別）
pivot: (128,352) 底辺中央 / baseline: y=352
footprint: 4x4 tiles / entrance: 正面中央1tile・南向き
collision: footprint矩形−戸口−屋内歩行可能床3x3 / occlusion: ファサード帯（下端2tile）
roofMask: roof画像全域（base側は遮蔽なし） / windowAnchors: 客室窓×5
states: effect.window_glow anchor×5 / 適合overlay: ivy_l, scaffold_l, snowcap_l
variants: biome別palette 2（旧市街/港）
autotileEdge: なし（建物）
references: world_visual_master + intake宿屋sheet（rights note必須・D14）
acceptance: native=窓割り視認 / repeat=n/a / ensemble=港blueprintで桟橋と同光源
replacement: 旧building.innをsupersede / priority: wave A
```

## 7. 制作wave（承認セレモニーの束ね方）

| wave | 内容 | ID数（§4正本） | 対応phase（設計書§15） |
| --- | --- | ---: | --- |
| **A** | slice＋全建物＋UI＋地形（§4のwave A列） | **109** | Phase 3 vertical slice（tiny-town＋中規模repoの両方が起動可能） |
| **B** | 残キャラ・残prop・残効果・survey_blank等（§4のwave B列） | **49** | Phase 4 展開 |
| **C** | portrait・biome variant増（optional・required set外） | — | wave 2以降 |

- 各wave = 1回の一括human承認（promote-required相当のv3版）＋1回のatomic export。承認負荷は2〜3セレモニーに集約（無制限生成×人間承認ボトルネックの折衷）。
- 各waveの前に、そのwave分のreference/rightsを所有者が確認（D14）。

## 8. 本計画の受入条件（handoff §13素材条項への対応）

- [x] 78全IDの keep/remake/retire を理由付きで明示（§3。keep 0/remake 65/retire 13）
- [x] 必要addのfamily・使用scene・意味・優先度（§2・§4。設計書の全世界表現に対応IDが存在: 赤提灯・井桁・白地図帯・海路標識・渡し場・測量杭・櫓を含む）
- [x] 変更後required set＝**§4正本台帳 158 ID**（remake 65/add 93、wave A 109/B 49）と移行手順（§5）
- [x] 素材消化にならない使用規則（§0の置換gate・§6-2 ensemble審査・WorldPlanのassetId参照検査）
- [x] pivot/baseline/footprint/entrance/collision/occlusion/state/animation/edge契約の様式（§6-3）と記入例（§6-4・寸法はscaleClass表と一致）
- [ ] 全件のdefinition化（タイミングは設計書§14 **D15** の所有者判断。default: wave A分をPhase 0完了までに確定）
