# Fable5 Vertical Slice — 市庁舎広場(最初の検収対象)

`Fable5ArtContract.md` §10 により、実装の起点はこの 1 画面である。
この座標データは 3 役を兼ねる:

1. **ブロックアウト原稿**(ArtContract §5 工程 1): 本書をフラット色で 128px/tile 描画した
   2304×1536 PNG が、旧市街マスターボード生成(工程 2)の下絵になる。
2. **切り出し後の再組み立て検証**(工程 5・AC-2): 同じ座標を prefab だけで再構築して比較する。
3. **e2e 受入の舞台**(AC-4〜AC-7): 進入/退出・カットアウェイ・4 方向移動をこの画面で検証する。

すべて再配置可能な prefab インスタンスで構成する。固定背景への描き込みは禁止。

## キャンバスとカメラ

- キャンバス: **18×12 タイル**(1152×768 native)。地区: 旧市街(old_town)。時間帯: 昼。
- カメラ(zoom 2):
  - 1920×1080 → 可視 15×8.44 tiles、TL **(1,2)**。構図検収(AC-2, Q2, Q3)はこちらで行う。
  - 1280×720 → 可視 10×5.63 tiles、TL **(2,2)**。検収対象は密度・可読性のみ(Q1/Q11 と文字サイズ)。
    主要道は画面外で構わない(構図要件は 1080p のみに課す)。

## 地面レイヤー(凡例は Blueprints と同じ。`P`=plaza, `#`=road(cobble), `:`=dirt, `.`=grass)

```
y0   . . . . . . . H H H H . . . . . . .
y1   . . . . . . . H H H H . . . . . . .
y2   . . . . . . . H H H H . . . . . . .
y3   . . . . . : : H H H H : . . . V V .
y4   . I I I : P P P P P P P : . . V V .
y5   . I I I : P P P P P P P M M M : . .
y6   . I I I : P P P P P P P M M M : . .
y7   : : : : : P P P P P P P : : : : : :
y8   # # # # # # # # # # # # # # # # # #
y9   # # # # # # # # # # # # # # # # # #
y10  # # # # # # # # # # # # # # # # # #
y11  : : : : : : : : # # : : : : : : : :
```

- 広場 (5,4)-(11,7) = 7×4(ArtContract §10 の新上限内)。
- 主要道 y8-y10 = **幅 3**(新規格)。南へ 2 幅の分岐 x8-x9(y11 から画面外へ)。
  分岐の読みは (8,10),(9,10) の autotile T 字 frame + 広場口(y7/y8)の 2 箇所。
- fringe: plaza/road が grass に接する辺はすべて dirt 1 タイル(T1 準拠。x4 列、y3 の x5,6,11、y7 帯、y11 帯)。

## 建物(4 棟)

| prefab | footprint | door tile(world) | entrance | state | 付随 |
|--------|-----------|------------------|----------|-------|------|
| bld_l_town_hall | (7,0)-(10,3) | (8,3) | (8,4) down | occupied | fx_done、壁 lamp×2(door 両脇)、window_glow anchor×2 |
| bld_m_inn | (1,4)-(3,6) | (2,6) | (2,7) down | busy | **カットアウェイ実演**(player が室内)。壁 lamp・壁 signboard_a |
| bld_m_house(house_m) | (12,5)-(14,6) | (13,6) | (13,7) down | occupied | 壁 lamp |
| bld_s_survey_tower | (15,3)-(16,4) | (15,4) | (15,5) down | vacant | tarp、fx_unverified、窓 glow なし |

## inn 室内(cutaway。interior レイヤー = footprint (1,4)-(3,6) と完全一致 = AC-7)

| セル | 内容 |
|------|------|
| (1,4) | hearth + hearth glow(昼でも点灯、C6) |
| (2,4) | keeper: townsfolk_f(work anim, facing south)。counter 背後の分離セル(C3 例外) |
| (3,4)-(3,5) | bed(1×2 縦・頭北) |
| (2,5) | counter(南セルから対話) |
| (1,5) | chair(通行可 interact) |
| (1,6), (3,6) | 空き床 |
| (2,6) | door tile。**player 位置**(facing north)→ inn の roof が α0 |

## 構造物・小物

| prefab | 座標 | 備考 |
|--------|------|------|
| prop_well | (11,4) | 広場北東角 |
| prop_bench | (6,7), (9,7) | 広場南縁、道向き。間隔 3 |
| prop_signboard_b | (5,7) | 広場口の案内板 |
| prop_streetlight | (3,8), (10,8), (16,10) | 主要道の縁レーンのみ(中央レーン y9 は常に空ける)。間隔 7/6、南北交互 |
| prop_barrel | (4,5) | inn 東壁クラスタ |
| prop_crate | (4,6) | 同上 |
| prop_warning_lantern | (14,4) | survey_plot 隣接 |
| struct_survey_plot | (14,3) | fx_unverified の根拠地物 |
| tree_a | (1,1), (14,1) | 樹冠 3×2。北西/北東クラスタ |
| tree_b | (3,1), (12,1) | 樹冠 2×2 |
| tree_c | (5,2), (16,0) | 樹冠 1×2。各クラスタ 3 本目 |

## 装飾 overlay

flowers_a (4,2)※grass, (0,5) / flowers_b (11,2) / flowers_c (17,6) /
pebbles_a (4,7), (7,11) / pebbles_b (12,4) / pebbles_c (15,6)

## 人物

| prefab | 座標 | anim / facing | 仕事対象 |
|--------|------|---------------|----------|
| char_player | (2,6) | idle north | inn counter(対話可能距離) |
| char_town_clerk | (9,4) | idle north | town_hall door (8,3) |
| char_townsfolk_m | (5,9) | walk east | 主要道の通行(1080p 構図用) |
| char_townsfolk_f | (2,4) | interact south | inn counter(室内) |

## 効果

fx_done: town_hall 屋根上 / fx_entry: door tile (8,3), (2,6), (13,6) の 3 箇所 /
fx_unverified: survey_tower 全体(薄もや)/ hearth glow: (1,4)

## 検収(この画面で通すべき項目)

- AC-2: マスターボード(工程 2)と prefab 再組み立ての構図一致(建物座標 100%・SSIM ≥ 0.85)
- AC-4: player を (2,6)→(2,7)→道→(13,7)→house_m 室内まで歩かせ、全フレームで足元 = ノード
- AC-5/AC-6: town_hall・inn・house_m の 3 種で進入/退出、カットアウェイ後も player 可視
- AC-7: inn/town_hall/house_m の interior 矩形 = footprint
- AC-8: 上記 2 カメラで Q1(裸地率 ≤40%)・Q11(硬質地表 35–60%・シグネチャ streetlight/well/signboard ≥2)
- Q2: 1080p カメラ内の建物 4(town_hall, inn, house_m, survey_tower 部分)
- Q3: town_hall(footprint の 50% 以上が 1080p カメラ内・最大シルエット)
- Q10: NPC 3 + player、全員の 2 タイル以内に仕事対象

## 実装ノート

1. WorldPlan データとしては tile type で表現する(plaza=`plaza`, 主要道=`road`, fringe=`path`,
   室内=`floor`。スキンは PlacementGuide §3)。
2. validator を通すこと(REACHABLE: 全 entrance → 道網 ✓ 設計済み)。
3. この画面が AC を全て通過し人間承認されるまで、他地区のマスターボード生成・6 画面の再発行・
   generator 一般化に着手しない(ArtContract §10)。
