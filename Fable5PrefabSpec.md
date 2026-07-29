# Fable5 Prefab Spec — モジュール分解と実装用アセット契約

`Fable5ArtContract.md`(作り方)の従属文書。**何を・どの単位で・どんなメタデータ付きで**素材化するかを定める。
機械可読の契約サンプルは `tools/asset-forge/contracts/asset-contract.sample.json`。
配置規則(どこに置くか)は従来どおり `Fable5PlacementGuide.md` / `Fable5PlacementMatrix.md`。

> **24×16 Vertical Slice v2 amendment (2026-07-18)**
>
> image-derived geometry for the accepted visual master overrides the legacy S/M/L footprint defaults and asset-count quota
> for this slice. Exact authority is `art/production/vertical-slice/geometry-v2.json` and
> `Fable5VerticalSlice24x16.md`. Legacy 18×12 dimensions may not be silently reused.

命名規約: `カテゴリ_名前[_variant]`、kit 内レイヤーは `assetId.part`(例: `bld_m_inn.roof`)。
旧Wave A素材と旧ID aliasは削除済み。新素材は最初から本命名で登録し、旧名→新IDの互換表を作らない。

---

## 1. Terrain(地表)

| prefab | 内容 | 枚数 |
|--------|------|------|
| ter_grass_a–d / ter_dirt_a–d / ter_cobble_a–d / ter_plaza_a–d / ter_snow_a–d / ter_deck_a–d / ter_water_a–d | 4 辺シームレスの 64px タイル、各 4 variant(ArtContract §6 の反復禁止用) | 28 |
| ter_cliff_set | 崖 autotile 16 方位(上面/立面 1–2 段) | 1 セット(16) |
| edge_cobble / edge_dirt / edge_snow / edge_water / edge_deck | 地表境界の縁 autotile(各 16)。PlacementGuide T1–T4 の遷移を担う | 5 セット(80) |

- water は 4 variant × 2 frame(ゆらぎ)。deck は板目方向を東西固定。
- 選択規則: variant はセル座標のハッシュで決定(`hash(x,y,seed) % 4`)。決定的(AC-1)。

## 2. Road(道)

| prefab | 内容 |
|--------|------|
| road_cobble_set / road_dirt_set | 直線・角・T 字・十字・終端の 16 方位 autotile(地表と同密度、縁石/踏み跡込み) |
| road_bridge_stone / road_bridge_wood | 幅 1、縦横 2 向き + 端 2 frame(validator BRIDGE_SPANS_WATER 準拠) |
| road_stairs_stone / road_stairs_wood | 4 向き。上端・下端の接続 frame(validator STAIRS_CONNECT_ELEVATION 準拠) |

道幅3は将来のprocedural配置目標で、autotileの並置で組む。24×16 v2 sliceは
`geometry-v2.json` の可変visual幅 + 48px以上の連続pixel corridorを正本とし、専用の「3幅一体スプライト」は作らない。

## 3. Building kit(S/M/L + Landmark)

**1 建物 = 1 kit = 5 レイヤー PNG + メタデータ。** 一体絵の建物は登録不可。

| part | 内容 | layer(PlacementGuide §2.1) |
|------|------|------|
| .base | 壁立面(壁バンド 2.5 tiles)+ 開口部(扉枠・窓、消灯) | world(y ソート) |
| .roof | 屋根 + 庇の北張り出し。カットアウェイで α0 になる唯一の part | overhead |
| .door | 扉 2 frame(閉/開)。visual opening、pixel portal、owner cellをgeometry contractへ別々に記録。黒い穴だけのopenは禁止 | world(base の直後) |
| .interior | 床 + 北壁 trim + 固定作り付け(炉台等)。**矩形 = footprint と完全一致**(AC-7) | ground(カットアウェイ時) |
| .shadow | 接地影(footprint+1px apron 内) | decal |

クラス寸法(ArtContract §3 準拠。PNG 高は 台帳確定まで目安):

| クラス | footprint | base PNG | roof PNG | 該当建物 |
|--------|-----------|----------|----------|----------|
| S (legacy catalog default) | 2×2 | 128×160 | 128×96+庇 | shop, house_s, house_old, hut, ruin |
| M (legacy catalog default) | 3×3(3×2 含む) | 192×160 | 192×128+庇 | pub, guild, warehouse, dock, workshop, dojo, rowhouse_s, watchtower(2×3) |
| L (legacy catalog default) | 4×4(4×2 含む) | 256×160 | 256×160–192+庇 | rowhouse_l, gate |
| v2 town_hall draft | **8×4 provisional** | alpha bboxをclean boardで確定 | 同左 | north-clipped。uncropped derivation必須 |
| v2 inn draft | **5×3 provisional** | alpha bboxをclean boardで確定 | 同左 | 最初のcutaway対象。interior overlay後に確定 |
| v2 house draft | **4×3 provisional** | alpha bboxをclean boardで確定 | 同左 | 中間ゴールでは正直にclosed可 |
| v2 survey_tower | **3×3 provisional** | alpha bboxをclean boardで確定 | 同左 | east-clipped。kit authoring前にuncropped derivation必須 |
| Landmark | クラス寸法 + 固有シルエット | — | — | 市庁舎(bld_l_town_hall)、宿屋(bld_m_inn)、道場(bld_m_dojo)、測量塔(bld_s_survey_tower)、門(bld_l_gate) |

- Landmark は「別規格」ではなく **同一 kit 規格 + 高さ上限だけ +1 tile** の優遇。密度・光・線は同一契約。
- doorは`ownerCell`を1つ指定するが、自然なpixel移動のportal/approach中心をcell中心へ丸めない。
  `triggerRect`と24×14px foot colliderのswept clearanceを実測し、見える開口と一致させる(装飾扉の禁止)。
- 状態 overlay(ivy/scaffold/snowcap/tarp)は独立 prefab として base に重ねる(従来どおり Matrix §5)。

## 4. Interior(室内)と Props(小物)

- 室内床 `int_wood_a–b` / `int_stone_a–b`(シームレス)、`int_wall_trim`(北壁帯 + 8px 側縁)。
- 家具・小物は従来の 18 種(Matrix §7)を本命名で再登録(`prop_barrel` 等)。家具 anchor・
  通路規則は PlacementGuide §10(C1–C7)のまま。
- NPC 位置は室内 kit のメタデータ `npcSpots` で宣言(counter 背後等。contract sample 参照)。

## 5. Effects(状態表示。UI 焼き込み禁止の受け皿)

すべて effect 層の独立 prefab。ワールド座標に置くが、建物画像には一切焼き込まない。

| prefab | 意味(リポジトリ事実) | 形式 |
|--------|----------------------|------|
| fx_select | 選択中の対象 | footprint 外周のパルスリング、4 frame |
| fx_entry | 進入可能な door tile | 扉上の矢印/光沢、4 frame |
| fx_unverified | 未確認(pendingInspections / unknown evidence) | 建物を覆う薄もや、4 frame(vacant の無灯と併用) |
| fx_closed | 閉鎖(未解決 import の行き止まり) | barricade と併置する封鎖テープ状マーカー、2 frame |
| fx_done | 調査完了 | 屋根上のチェック紋 + glint、4 frame |

既存 4 効果(window_glow / water_ripple / construction_dust / discovery_glint)は継続(Matrix §9)。

## 6. Character(プレイヤー・NPC)

- frame canvas **64×128**、可視身長 72px、足元 pivot **(32,120) 全キャラ・全フレーム固定**(N6 検収)。
- シート構成(1 キャラ = 1 PNG **640×512**):

| | col 0–1 | col 2–7 | col 8–9 |
|---|---------|---------|---------|
| row 0: south | idle 2f | walk 6f | interact 2f |
| row 1: west | idle 2f | walk 6f | interact 2f |
| row 2: east | idle 2f | walk 6f | interact 2f |
| row 3: north | idle 2f | walk 6f | interact 2f |

- idle 4fps / walk 10fps / interact は発話・作業に共通使用。east は west の反転を**許可しない**
  (道具の持ち手が破綻するため。左右別描き)。
- 既存 7 人(player, town_clerk, gatekeeper, dojo_inspector, townsfolk_m/f, dojo_student)を
  この規格へ再生成し、Wave B の 22 人も同規格。

## 7. Asset Contract(実装用メタデータ)

全 prefab は次のフィールドを持つ JSON レコードとして
`tools/asset-forge/contracts/` に登録する。サンプル: `asset-contract.sample.json`(5 例)。
lint(`normalize-check.mjs`)は PNG と contract の相互一致も検査する。

| フィールド | 型 | 意味 |
|-----------|----|------|
| assetId | string | 一意 ID(本書の命名規約) |
| category | enum | terrain / road / building / overlay / interior / prop / character / effect / ui |
| png | {file,w,h} | 実ファイルと寸法(N1 で照合) |
| nativeScale | 1 | 固定。1 以外は登録不可 |
| logicalTileSize | 64 | 固定 |
| pivot | {x,y} | 接地 anchor(ArtContract §3。建物は SW 角、人物は 32,120) |
| footprint | {w,h} | 占有タイル。terrain/effect は 1×1 |
| doorPortal | {ownerCell,observedRect,triggerRect,approachPoint}? | buildingのみ。cell所有と連続pixel portalを混同しない |
| collision | polygon[] | world pixel座標の通行不可polygon。sprite bboxやboolean tile occupancyを代用しない |
| occlusion | {rect,mode}? | roof/canopy が覆う領域と、player 進入時の挙動(alpha0 / fade45) |
| layers | {part→file} | kit のレイヤー PNG(§3)。単体素材は base のみ |
| sheet | {rows,cols,frameW,frameH,anims}? | スプライトシート(character / effect / water) |
| allowedZoom | [1,2,3] | 固定 |
| materialProfile | string | accepted unlit boardから測った地区/material swatch群。global palette snapは禁止 |
| seams | {tileable:[N,E,S,W]}? | terrain のみ |
| districts | string[] | 使用可能地区(Matrix と同値。lint で突合) |
| npcSpots | {x,y,role}[]? | interior のみ |

## 8. 24×16中間ゴールの最小アセット範囲

PNG数を品質指標にしない。旧362/57枚quotaはframework先行のlegacy planning値として廃止する。
中間ゴールに必要なものだけを、accepted whole-world derivation boardから一貫して作る。

1. terrain/road/edge/step/wallの再構成用kit（clean foundationそのものはruntime禁止）。
2. 4棟のexterior base/roof/door/state kit。north/eastで切れた建物は余白付きsourceを再導出する。
3. raised garden、well、bench、lamp、sign pictogram、barrel/crate/cart、植生cluster、前景occluder。
4. 宿屋5×3のcutaway shellと、入口からNPCまでを塞がない家具kit。
5. playerとinnkeeperの4方向sprite sheet。中間ゴールに無関係な22人の量産は禁止。
6. renderer-owned emission/halo/smoke/gradeと、既存UI sheetの固定crop。UI画像は再生成しない。

正本の使用インスタンスと座標は `Fable5VerticalSlice24x16.md` と
`art/production/vertical-slice/geometry-v2.json`。最終PNG数はmanifest ownershipが決め、count達成だけでは合格しない。
