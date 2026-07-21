# Fable5 Vertical Slice v2 — 24×16 市庁舎広場

本書は 2026-07-18 のユーザー決定で `Fable5VerticalSlice.md` の18×12製造基準を置き換える。
見た目と構図の正本は `art/production/vertical-slice/boards/old-town-exterior-master-v1.png`。
同画像は **1536×1024 = 24×16 cells × native 64px**、SHA-256
`a3b33e5dcb8bd2c0475ba146888027159cb5c955eae3a5d53d58d7770a0417ce` で、再サンプル禁止。

## 状態を混同しない

### 観測済み

- 独立 Sol 二者が visual-master stage を 44/49、42/49 で合格させた。
- 市庁舎が最大シルエットで、宿屋、一般家屋、survey/work tower の4入口が見える。
- 北の建築帯、中央の広場・道路帯、南の前景帯があり、南へ抜ける主要動線が読める。
- 花壇は盛り上がった密植で、見た目上は通行不能。
- 窓・街灯の発光、地面のlight pool、dusk grade、煙、vignetteがlit compositeに焼かれている。

最初のneutral-unlit registration boardでは、煙本体を含むrenderer-owned effectをすべて除去する。
2件の明示repairだけは、そのexact mask内に限って一般の4px drift/object固定規則より優先する。

### 推論

- 24×16 gridから新しいWorldPlan、collision、prefab ownershipを導出できる可能性は高い。
- 前景建築・樹木は、alpha matteと隠れ背景plateを別に作ればy-sort occluderとして再構成できる。

### 未知（決まるまで実装禁止）

- exact door cell/opening rectangle/approach cell、footprint、pivot、collision polygon、y-sort anchor。
- 各屋根・扉・tarp・影・前景・樹木・壁のalpha境界と、背後のclean plate。
- player/NPCの最終スケールでの扉clearance、N8 pictogram、camera framing、到達可能性。

## 座標系

- 原点 `(0,0)` はマスター左上。cell `(x,y)` のpixel rectは `(x*64, y*64, 64, 64)`。
- world boundsは `[0,1536) × [0,1024)`。分数scaleと旧18×12座標の転用を禁止する。
- この節より下のexact geometryは、grid overlayと独立レビューが通るまで `unknown` として扱う。

## visual masterの用途と禁止

- 用途: appearance、hierarchy、density、route intent、geometry overlayの参照。
- 禁止: runtime load、background化、矩形slice、alpha assetの代用、lighting込みprefabの抽出。
- 必須派生: unlit clean plate、object/layer alpha boards、hidden-background plates、renderer lighting/atmosphere。

## 中間ゴールの最小プレイ可能範囲

1. characterが一定速度の自然な4方向歩行で道路・広場を自由に移動し、障害物と衝突する。
2. 少なくとも宿屋の正規door portalから入り、同じ外観footprintに整合するcutaway室内へ出入りする。
3. 室内NPCと、正規の吹き出し・dialogue frame・choice/continue affordanceを使い最低2往復の意味ある会話をする。
4. 未実装入口は装飾扉として偽らず、閉鎖状態と理由を一貫したUXで示す。
5. master/target/maskをnetworkまたはcanvas backgroundへ直接読み込まず、prefab+effectだけで再構成する。

主要道の舗装はmasterどおり可変幅で、移動契約は64px cell occupancyではなく48px以上の連続pixel corridorを使う。
旧「全区間3 tiles固定」はこのsliceへ適用しない。

## 次のhard gate

`art/production/vertical-slice/qa/old-town-master-v2-geometry-overlay.png` と機械可読geometry contractに、
全入口、主要walkable route、盛り上がった花壇、well、建物、樹木、壁、前景occluderのownershipを記録する。

- **Gate A — lighting-only whole-board edit**: 4 door center、主要anchor、route、raised blockerをoverlayで固定し、
  独立Solが「形を変えないneutral-unlit editのconditioningとして十分」と承認すれば進めてよい。
- **Gate B — alpha/layer/slice/runtime**: irregular wall/bed/vegetationを含むexact collision polygon、alpha ownership、
  hidden plate、inn 5×3 interior、swept colliderを承認するまで進めない。RGB envelopeをcollisionに代用しない。
