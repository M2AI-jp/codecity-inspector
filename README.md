# CodeCity Inspector

JavaScript / TypeScript リポジトリを読み取り専用で静的解析し、ファイル、参照関係、テスト、設定を
WorldPlan の建物・地区・道路・住民・調査事実へ変換するローカルゲームです。

## 現在地（2026-07-18）

**再構築中で、ゲームは未完成です。**

旧ゲーム、固定背景、互換 fallback、旧 Asset Forge、旧派生アセットは削除しました。
削除前の棚卸しは 435 PNG / 233,482,653 bytes、音声 0、完全重複 78 組（156 files）でした。
現在、製品として登録済みの runtime asset は 0 です。残している画像は品質基準用の3原版だけで、
runtime からは読み込みません。詳細は
[asset-inventory.json](art/contracts/asset-inventory.json) を参照してください。

再構築の正本は次の順です。

1. [Fable5ArtContract.md](Fable5ArtContract.md) — 投影、寸法、光、色、生成・検収方法
2. [Fable5PrefabSpec.md](Fable5PrefabSpec.md) — prefab、レイヤー、人物アニメーション
3. [Fable5VerticalSlice.md](Fable5VerticalSlice.md) — 最初に完成・承認する市庁舎広場
4. [ゲーム完成条件](docs/game-completion-definition.md) — 「完成」と報告できる条件

Vertical Slice は、座標ブロックアウト → 1枚のマスターボード → prefab 切り出し →
機械検収 → prefab だけで再組み立て、の順で制作します。マスターボードを固定背景として
出荷すること、未承認素材や旧素材へ fallback することは禁止です。

## 安全境界

- 対象のコード、テスト、hook、package script、package managerを実行しません。
- 対象リポジトリへ書き込みません。
- ソース本文や解析結果を外部へ送信しません。
- サーバーは `127.0.0.1` だけで待ち受けます。
- 観測事実、推定、不明を分離し、「未テスト」を「故障」と断定しません。

## 起動

Node.js 20 以上が必要です。

```sh
npm install
node src/server.mjs --repo "/path/to/repository" --port 4173
```

ブラウザ: [http://127.0.0.1:4173/fable5-v2/](http://127.0.0.1:4173/fable5-v2/)

API:

- `GET /api/city` — 静的検査結果
- `GET /api/town` — 検証済み WorldPlan v2

旧 `/api/town/legacy`、固定 preview、旧78素材の互換表示は削除済みです。

## 完成の定義

「APIが生成できる」「歩ける」「素材を読み込める」のどれか一つでは完成ではありません。
同じrevision・同じURLで、WorldPlan反映、4方向アニメーション、衝突、3種の建物進入・退出、
実カットアウェイ、会話UI、調査ループ、保存復元、1280×720 / 1920×1080の視覚品質、
console error 0 を実ブラウザで全件確認し、最後に所有者がプレイ承認した場合だけ完成です。

## 開発上の注意

このリポジトリ自身を `--repo .` で点検するときも、点検処理はファイルをデータとして読むだけです。
点検対象のスクリプトやテストは実行しません。詳細は [SECURITY.md](SECURITY.md) を参照してください。
