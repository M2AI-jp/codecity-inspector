# CodeCity Inspector

JavaScript / TypeScript のリポジトリを読み取り専用で点検し、ファイルを建物、ローカルimportを道に見立てた「住める街」のデータモデルへ変換するMac向けローカルツールです。未解決の接続、循環依存、テストとの対応、生活インフラ（入口・DB・env・ログ・テスト・配布経路など）の有無を、根拠と一緒に確認できます。

> **現在の製品状態（2026-07-18）:** `--open` と `CodeCity.command` は、`/fable5-v2/preview.html` のリポジトリ駆動・seed決定的な4地区ゲームを開きます。WorldPlanの実在する建物とfactを、意味の合う旧市街・港湾・雪原・森林の場面スロットへ割り当てます。宿屋Prefabがある場合だけ同一マップ上で入室・屋根開閉・店主との会話が有効になり、閉鎖Prefabと対応看板がある場合だけ「未到達・要確認」を表示します。背景地形・道路・構図は高品質な固定シーンテンプレートであり、WorldPlanの自由な街路形状を描くものではありません。`/` の従来版と、Wave A全109素材を要求する `/fable5-v2/` の厳格atlas版も比較用に残しています。

78点はプロジェクト所有者がChatGPT Proで生成した素材として制作来歴と採用を確認済みです。素材を読み込めない場合、runtimeは理由を表示して停止し、旧素材や代替描画へ戻りません。権利・法令適合性をソフトウェアが自動保証するものではありません。完成した因果関係を証明するツールでも、署名済みのMacアプリでもありません。

`public/fable5-v2/assets/` の新規7点は、2026-07-18にプロジェクト所有者の指示でCodex内蔵の画像生成を使って制作し、このプレビューへ採用したものです。独立した法務・権利確認は行っていません。ルートのMIT Licenseはコードの利用条件であり、生成画像の権利・第三者権利への適合を自動的に保証するものではありません。

Fable5の生成経路は、`静的な読み取り専用検査 → RepositorySemanticModel → PrefabCatalog → seed付きWorldPlan → renderer` です。意味モデルは検査で見つかった既存ファイルの役割だけを補い、ファイル、観測事実、座標、当たり判定、イベントを発明できません。座標と移動可能性は再現可能な生成器とvalidatorが決めます。現在は決定論的heuristicと、ローカルまたは利用者が明示的に許可したLLM候補を受け取る境界まで実装済みで、外部LLM/APIへの送信は行いません。

ここでいう既存アセットはPNGだけではありません。`PrefabCatalog` は、外観画像、アニメーション、SE、衝突形状、入口と室内、近接表示、会話・調査イベントを1つのゲーム部品として束ねます。最初の縦断実装では、到達可能なserviceを「入室可能な宿屋」、入口から未到達で未検証のmoduleを「閉鎖・要確認の建物」へ割り当てます。後者は壊れた看板を表示しますが、死んだコードや故障とは断定しません。

## 必要なもの

- macOS
- [Node.js](https://nodejs.org/) 20以上（`node --version` で確認できます）
- 初回に一度だけ `npm install`（CodeCity自身のparserを取得します）

## セットアップ

```sh
git clone https://github.com/M2AI-jp/codecity-inspector.git
cd codecity-inspector
npm install
```

`npm install` は公式npmレジストリから、lockされたBabel parserとその依存を取得します。点検対象のフォルダに対しては実行しません。

## 使い方

### CLIで街を生成する

対象リポジトリを点検し、決定論的な `town.layout.json` を書き出します。役場検査（`validateLayout`）に通らないレイアウトは採用されず、ファイルも書き出されません（終了コードは非0）。

```sh
# サンプルリポジトリを点検し、カレントディレクトリに town.layout.json を作成
npm run generate:town

# 任意のリポジトリを点検し、出力先とseedを指定
node src/generate-town.mjs --repo "/path/to/your/repository" --out ./town.layout.json --seed my-seed --print
```

- `--repo` を省略すると同梱の `sample/tiny-town` を点検します。
- `--seed` を省略すると、リポジトリの状態から求めたfingerprintがそのままseedになります。コードが変わらなければ、再実行しても同じ `town.layout.json` になります。
- `--out` を省略すると実行時のカレントディレクトリの `./town.layout.json` に書き出します。点検対象リポジトリの内側は明示指定しても拒否し、シンボリックリンク経由で内側へ戻る出力先も拒否します。
- `--print` を付けると、レイアウトJSON全体を標準出力にも書き出します。

### サーバーを起動してAPIで見る

```sh
# サンプルを表示
npm run demo

# 任意のリポジトリを表示
node src/server.mjs --repo "/path/to/your/repository" --open
```

標準では `http://127.0.0.1:4173` で待ち受けます。別のポートが必要なら `--port 4174` のように指定できます。`CodeCity.command` をダブルクリックする、またはFinder上でリポジトリのフォルダを1つドラッグ＆ドロップしても、同じサーバーが起動します（`CodeCity.command` は依存が無ければ日本語で案内して停止し、自動インストールやネットワークアクセスはしません）。

`--open` を付けるか `CodeCity.command` を使うと、新しい4地区ゲームを直接開きます。ブラウザの `/` には比較用の `/api/town/legacy` 技術検証版が残っています。

新規アートの4地区ゲームは `/fable5-v2/preview.html` で遊べます。矢印キー・WASD・クリックまたはタッチで歩き、各地にseed決定的に結合された実際のWorldPlan factを調査します。同じ入力とseedなら割当は同一です。宿屋の敷居を越えると同じマップのまま屋根が開き、店主のそばまで歩けます。4地区の巡回後は夜の旧市街へ戻ります。これは固定シーンPrefabへリポジトリ内容を投影するテンプレート生成方式であり、道路や建物座標そのものを自由生成したという主張はしません。

厳格版のFable5候補版は `/fable5-v2/` で確認できます。こちらは `/api/town` のWorldPlan v2を読みますが、承認済みWave A v3 exportが無い／読み込めない間は理由を表示して操作を停止します。生のJSONは次のエンドポイントから確認できます。

従来版のAsset Forge定義は合計110件で、そのゲームに必要な78件は承認・export済み、残り32件は任意の将来拡張です。公開schema v2 manifestを唯一の入口として、17建物、22人物、19地形、18小物、2効果の全78 IDをruntimeから参照します。これはID・byte・寸法・来歴・bindingの技術網羅であり、到達可能なsceneでの意味ある使用、構図、ゲーム性を証明するものではありません。キャラクターは検証済みの方向・動作セルを、エフェクトは宣言済みフレームを切り抜いて描画します。公開契約が揃っていることは、画像の美観や利用権まで自動判定したという意味でもありません。

- `GET /api/city` — scanner / inspectorが読み取った生のインスペクション結果（ファイル、import、循環、テスト対応など）
- `GET /api/town/legacy` — `/` が使う従来の街モデル・住める街レベル・検証済みレイアウト（下記）
- `GET /api/town` — `/fable5-v2/` が使うfacts・WorldPlan v2・住める街レベルをまとめたレスポンス

終了するときは、起動時に開いたターミナルで **Control + C** を押します。

ダブルクリックできない場合や、GitHubから取得したファイルをmacOSが初回だけ止める場合は、Finderで `CodeCity.command` をControlキーを押しながらクリックして **開く** を選び、入手元を確認してから許可してください。Mac全体の保護や、フォルダ全体の隔離属性を一括で無効化する必要はありません。

## `/api/town/legacy` の中身

```json
{
  "schemaVersion": 1,
  "repository": { "name": "your-repository" },
  "generatorVersion": "1.0.0",
  "seed": "…",
  "habitability": {
    "level": 3,
    "levelName": "住める街",
    "canLive": true,
    "blockers": [],
    "warnings": ["…"],
    "pendingInspections": [],
    "reasons": ["…"]
  },
  "model": { "facilities": [], "guild": {}, "external": {}, "summary": {} },
  "layout": { "…": "検証済み・注釈付きの TownLayout（layout.validation を含む）" }
}
```

- `habitability` は `src/town/habitability.mjs` の判定結果です。**canLive** は「そもそも誰かが暮らせるか」（例: 建物はあるのに入口が1つもない、など生活インフラの欠落）で、これが false のときはレベルが Lv.1 までしか上がりません。**blockers** は canLive を false にしている致命的な欠落、**warnings** は古い実装やコスト制御・認証・ログなしの外部連携、DB・envの不在など、レベルを致命的には下げない「汚れ」です（Lv.5 の直前だけ影響します）。**pendingInspections** は、コントラクター（外部AIエージェント等）が「完了しました」と自己申告したが、実際の観測事実（テスト・道場）でまだ確認できていない項目です。**reasons** は判定理由を街言葉で説明した配列です。
- **habitability.level** は 0〜5 の6段階です（名前は `src/town/schema.mjs` の `HABITABILITY_LEVELS` に一致します）。

  | Lv | 名前 | 目安 |
  | -- | ---- | ---- |
  | 0 | 設計図だけの街 | 役場（リポジトリ）のほかに施設がまだ無い |
  | 1 | 通電した開拓地 | 役場以外に施設がある。ただし入口などが欠けると Lv.1 どまり |
  | 2 | 主要動線が通る小村 | 門（入口）と、宿屋または酒場が揃った |
  | 3 | 住める街 | 倉庫（DB）と井戸（env / secrets）が揃った |
  | 4 | にぎわう街 | 道場（テスト）と見張り台（ログ・監視）が揃った |
  | 5 | 見せたくなる街 | 船着場（配布）も整い、未解決の警告もない |

- `layout` は `src/town/generator.mjs` が生成し `src/town/validator.mjs`（役場検査）が検証・注釈した `TownLayout` そのもので、`layout.validation.ok` が false になる結果は `/api/town/legacy` からも返りません（CLIの `town.layout.json` と同じ規約です）。
- 観測できるentrypointが無いリポジトリは、壊れたレイアウトとして500にせず、入口のない街として返します。この場合は構造検査を通したうえで `habitability.canLive=false`、`importantBuildingsReachable=false`、`REACHABLE` warningとなり、画面に「誰も住めません」と理由を表示できます。
- `generatorVersion` + `repoFingerprint`（内部の決定論キー） + `seed` の組が同じであれば、`layout` は常にバイト単位で同一になります。日付やランダム値は一切使いません。同じリポジトリ状態なら、`/api/town/legacy` の `layout` と `npm run generate:town` が書き出す `town.layout.json` はバイト単位で一致します。

## 街モデルの読み方（証拠の区分）

- **確認済みの事実**: 読み取った静的なimportや、実際に見つからなかった接続先、`.env` やDockerfileなど既知ファイルの有無
- **推定**: 静的な接続から求めた循環、到達性、テストとの対応、habitabilityのレベル判定
- **不明・未確認**: 実行しなければ分からない挙動、動的に組み立てられるimport、解析上限を超えた範囲、`pendingInspections` に載っている自己申告

「テストとの対応が見つからない」や `pendingInspections` は未確認であり、故障を意味しません。habitabilityの警告はソフトウェアの品質点数でも、公開可否の判定でもありません。

## 現在の解析範囲

- 対象は `.js`、`.jsx`、`.mjs`、`.cjs`、`.ts`、`.tsx`、`.mts`、`.cts` です。
- BabelのAST parserで、文字列リテラルの `import`、`export ... from`、単独の `require()`、`import()` を静的に調べます。
- 初期上限は2,500ファイル、合計12 MiB、1ファイル2 MiBです。上限を超えた範囲は未解析として表示されます。
- 街モデル用の追加シグナル（`package.json`、`.env` 系ファイル、Dockerfile、デプロイ設定、`.github/workflows` のCI、`.git/logs/HEAD`（reflog）にある外部エージェントの自己申告など）も、存在確認と決められたサイズ上限内での読み取りに限られます。reflogはテキストとして読むだけで `git` は実行せず、いずれも対象コードの実行は伴いません。
- 動的なパス、パスエイリアス、各種bundler固有の解決、実行時のデータフロー、外部APIの挙動は完全には分かりません。
- parserが受理できない構文やAST走査上限に達したファイルは、故障ではなく未解析として記録されます。heuristicな文字列探索には戻りません。
- したがって、リポジトリ全体の依存・因果関係や、街のhabitability判定を完全に証明するものではありません。

## プライバシーと安全性

対象リポジトリは読み取り専用のデータとして扱います。対象のコード、テスト、hook、package script、package managerは実行せず、ファイルも変更しません。`npm install` はCodeCity自身のparserを取得する初回準備であり、点検対象のフォルダでは実行しません。解析時にソース本文を外部へ送信せず、サーバーはMac内のループバックアドレス（`127.0.0.1`）だけで待ち受け、ループバックを指さない `Host` ヘッダーは拒否します。`npm run generate:town` が書き出すのは、点検対象の外側にある指定 `--out` 先のJSONファイル1つだけです。出力は同じフォルダの一時ファイルを同期してから置き換え、既存のハードリンク先を経由して対象ファイルを書き換えません。詳しくは [SECURITY.md](SECURITY.md) と [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

## 開発者向け

```sh
npm ci
npm run check

# Asset Forgeは独立lockfile・独立依存
npm ci --prefix tools/asset-forge
npm run asset:check
npm run asset:validate
```

Asset Forgeのソースと独立lockfileはnpm配布物にも含まれますが、通常のルート
`npm install` は任意機能であるAjv/Sharpを自動導入しません。ソースcheckout・npm配布物の
どちらでも、Asset Forgeを使う前にNode.js 20.9以上で
`npm ci --prefix tools/asset-forge` を明示的に実行してください。

`npm run check` は、`CodeCity.command` の構文チェック、`src` 配下の各エントリの `node --check`、そしてルートテストを実行します。Asset Forgeは `tools/asset-forge/` 内でAjvとSharpを使い、mock、dry-run、job pack、manual import、画像処理、human-only promote guard、approved-only exportを独立テストします。`codex-subscription` は安全性・課金境界を確認できるローカルコマンドが無いため unavailable stub のままです。OpenAI API、API key、paid fallbackはありません。対象リポジトリ側で `npm install` やテスト実行を行わないでください。
