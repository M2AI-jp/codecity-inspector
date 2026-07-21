# 現状報告

更新: 2026-07-19

## 観測済み

- 直接提供の証拠がある21画像を `art/references/user-provided/` へ完全一致で保護し、ハッシュ・寸法検証に合格した。
- 緑の `character_style_reference_sheet.png` がプレイヤーの正規原画。現在runtimeの青いplayer画像はCodex生成物に由来し、原画準拠として不合格。
- 現在のn=1 runtimeは背景、4方向移動、宿屋入退室、cutaway、NPC会話を静的には実装済みだが、Leadのブラウザ操作は未実証。

- 旧棚卸し: 435 PNG、233,482,653 bytes、音声0。
- 完全重複: 78組、156 files。
- 旧runtime、固定preview、固定backplate、互換78素材、旧Asset Forge、全派生・review画像を削除。
- 旧 `/api/town/legacy` と旧 TownLayout generator を削除。
- 旧時点では品質基準用の原版を3点だけ `art/references/` に隔離していたが、その分類は不十分だった。
- production合格済みruntime assetは0。現在のruntime画像は候補であり、ブラウザQAと原画比較を通していない。
- WorldPlan v2の静的解析・生成・validatorは残している。
- デザイナーPR #2の7ファイルを取り込み済み。

## 推定

- WorldPlan v2のデータ層は再利用できる可能性が高い。
- 現在の歩行・入退室・会話runtimeは再利用できる可能性が高く、player画像と出自契約を緑の原画へ差し替える必要がある。
- ユーザー提供画像の保護領域とvalidatorにより、原本欠落・ハッシュ不一致を機械的に検出できる。

## 未確認

- 新Vertical Sliceのマスターボード品質。
- N1–N9を通る57 PNG。
- 新runtimeでの4方向移動、3建物入退室、cutaway、会話、調査完走。
- 1280×720 / 1920×1080のブラウザQA。
- 所有者のプレイ承認。

したがって現在の正確な判定は「旧不合格版を撤去し、再構築の契約と棚を整えた段階」です。
完成でも、プレイ可能版でもありません。
