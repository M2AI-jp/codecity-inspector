# CodeCity Inspector

JavaScript / TypeScript のリポジトリを読み取り専用で点検し、ファイルを建物、ローカルimportを道に見立てた「住める街」のデータモデルへ変換するMac向けローカルツールです。未解決の接続、循環依存、テストとの対応、生活インフラ（入口・DB・env・ログ・テスト・配布経路など）の有無を、元ファイルへ戻れる根拠と一緒に確認できます。

> 現在は、街のデータモデル・住める街レベルの判定・決定論的なレイアウト生成・検証（役場検査）と、それを取り出すCLI / HTTP APIに加え、Canvas上を矢印キーまたはWASDで歩ける小さな街画面があります。Asset Forgeの人間承認済みmanifestがあれば画像を使い、無ければ理由を表示して手続き描画へ戻ります。画像の美観・ライセンス・採用判断は自動化せず、現時点では承認済みの本番アート一式は同梱していません。完成した因果関係を証明するツールでも、署名済みのMacアプリでもありません。

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

ブラウザには `/api/town` を読み取る街画面が開きます。地図へフォーカスして矢印キーまたはWASDで移動でき、建物の選択、住みやすさ、観測・推測・不明の証拠区分、接続者ギルドを確認できます。承認済みAsset Forge exportが無い／読み込めない場合は、その状態を画面に表示して手続き描画を使います。生のJSONは次のエンドポイントから確認できます。

Asset Forgeの定義は合計110件で、現在のゲーム完成に必要なのは78件、残り32件は任意の将来拡張です。現時点では全画像が `missing` のため、上記の手続き描画が表示されます。人間が承認したexport schema v2を置くと、道路・水辺・橋・建物状態・NPC・小物を街の文脈から決定的に選び、キャラクター／エフェクトは検証済みの1フレームだけを切り抜いて描画します。

- `GET /api/city` — scanner / inspectorが読み取った生のインスペクション結果（ファイル、import、循環、テスト対応など）
- `GET /api/town` — 街モデル・住める街レベル・検証済みレイアウトをまとめたレスポンス（下記）

終了するときは、起動時に開いたターミナルで **Control + C** を押します。

ダブルクリックできない場合や、GitHubから取得したファイルをmacOSが初回だけ止める場合は、Finderで `CodeCity.command` をControlキーを押しながらクリックして **開く** を選び、入手元を確認してから許可してください。Mac全体の保護や、フォルダ全体の隔離属性を一括で無効化する必要はありません。

## `/api/town` の中身

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

- `layout` は `src/town/generator.mjs` が生成し `src/town/validator.mjs`（役場検査）が検証・注釈した `TownLayout` そのもので、`layout.validation.ok` が false になる結果は `/api/town` からも返りません（CLIの `town.layout.json` と同じ規約です）。
- 観測できるentrypointが無いリポジトリは、壊れたレイアウトとして500にせず、入口のない街として返します。この場合は構造検査を通したうえで `habitability.canLive=false`、`importantBuildingsReachable=false`、`REACHABLE` warningとなり、画面に「誰も住めません」と理由を表示できます。
- `generatorVersion` + `repoFingerprint`（内部の決定論キー） + `seed` の組が同じであれば、`layout` は常にバイト単位で同一になります。日付やランダム値は一切使いません。同じリポジトリ状態なら、`/api/town` の `layout` と `npm run generate:town` が書き出す `town.layout.json` はバイト単位で一致します。

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
