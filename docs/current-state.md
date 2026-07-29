# 現状報告

更新: 2026-07-22

この文書は現行worktreeのコードと記録を区別して要約する。ここで `PASS`、完成、または
実ブラウザでの動作を主張しない。今回の更新にはプロジェクトテストの再実行記録も
ブラウザcaptureも含まれない。

## 観測済み

- ユーザーが 2026-07-22 に提供した `character_style_authority_20260722_v1.png`
  （SHA-256 `446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`）を、
  現行のプレイヤー同一性と全キャラクターの唯一の画風authorityとして固定した。
  旧参照と旧候補の原本は履歴として残すが、現行promotionには使わない。
- 以前のinnkeeper 4×10 bindingは、画風authorityの差し替えによりwithdrawnである。
  `runtime-asset-manifest.mjs` の `bartender` はproduction assetから外れ、承認済みの
  置換素材と人間レビューがそろうまで宿屋もcustomer-facing routeとして閉鎖される。
- 宿屋の入口・退出は、building runtime が返す `enabled === true` の `enter` / `exit`
  interactionだけをauto transitionの候補にする。city hall と residence は現在
  `blocked-pending-approved-interior` なので、入口geometryがあってもruntimeから入れない。
- legacy player sheetは依然としてruntimeに残っており、approved Fable5 player exportへの
  bindingは存在しない。

## 推定

- building contractのportal、nav、collision定義は、承認済み室内素材がそろった後の
  runtime拡張の土台として再利用できる可能性がある。これは顧客導線や視覚品質の証明ではない。

## 未確認 (Unknown)

- 現行worktree/revisionでの実ブラウザsession、1280×720および1920×1080のcapture、
  network/console/errorの記録。
- 新しい4候補（player / innkeeper / town clerk / resident）の人間による横並び画風レビュー、
  および承認後の4方向人物再生、interaction timing、door遷移、保存・復元、調査導線の
  実ブラウザ挙動。
- 所有者の実プレイ受入と、同一revisionに結び付いたHard Gate判定。

## 未充足 (UNMET)

- 新しい画風authorityからのplayer / innkeeper / town clerk / resident 4×10候補を、
  人間レビュー、Asset Forge intake、approved export・provenance・frozen bindingへ進めること。
  現時点で候補はruntime promotionを許可していない。
- city hall と residence の承認済み室内kit、visible props、NPC、runtime binding、および
  それらを使ったcustomer-facing portal。両建物の現在のavailability gateは意図的にUNMETを
  表示する。
- browser evidence packet、同一revisionでの両viewport golden route、独立QA、所有者承認。

したがって、旧innkeeper bindingは履歴として観測できるが、現行runtimeには存在しない。
人物の新規承認、市庁舎・住宅、browser evidenceはいずれも未充足または未確認である。
完成・プレイ可能版・受入合格を主張できる状態ではない。
