# CodeCity Inspector

JavaScript / TypeScript のリポジトリを、点検できる2Dドット絵の街に変換するMac向けローカルツールです。ファイルは建物、ローカルimportは道として表示されます。未解決の接続、循環依存、テストとの対応などを、元ファイルへ戻れる根拠と一緒に確認できます。

> 現在はMVPです。完成した因果関係を証明するツールでも、署名済みのMacアプリでもありません。

## 必要なもの

- macOS
- [Node.js](https://nodejs.org/) 20以上（`node --version` で確認できます）
- ソースZIPまたはcloneから使う場合は、初回に `npm install` が必要です。

## 一番簡単な始め方

1. [v0.1.0-alpha.1のReleasesページ](https://github.com/M2AI-jp/codecity-inspector/releases/tag/v0.1.0-alpha.1)から `CodeCity-Inspector-mac-v0.1.0-alpha.1.zip` を取得して展開します。
2. `CodeCity.command` をダブルクリックすると、サンプルの街がブラウザで開きます。
3. 自分のリポジトリを見る場合は、そのフォルダをFinder上の `CodeCity.command` へドラッグ＆ドロップします。
4. 終了するときは、起動時に開いたターミナルで **Control + C** を押します。

Release ZIPにはlock済みの実行時依存を同梱しています。展開後の `npm install` は不要です。

## GitHubのソースから試す

1. GitHubのリポジトリ画面で **Code → Download ZIP** を選び、ZIPを展開します。Gitを使う場合は `git clone https://github.com/M2AI-jp/codecity-inspector.git` でも構いません（リポジトリ公開後に利用できます）。
2. ターミナルで展開したフォルダへ移動し、`npm install` を1回実行します。公式npmレジストリから、lockされたBabel parserとその依存が取得されます。
3. `CodeCity.command` をダブルクリックします。サンプルの街がブラウザで開きます。
4. 自分のリポジトリを見る場合は、そのフォルダをFinder上の `CodeCity.command` へドラッグ＆ドロップします。
5. 終了するときは、起動時に開いたターミナルで **Control + C** を押します。

```sh
cd "/path/to/codecity-inspector"
npm install
```

`CodeCity.command` は依存が無ければ日本語で案内して停止し、自動インストールやネットワークアクセスはしません。

ダブルクリックできない場合、ターミナルで展開先へ移動し、一度だけ実行権限を付けてください。

```sh
chmod +x CodeCity.command
./CodeCity.command
```

GitHubから取得したファイルをmacOSが初回だけ止めることがあります。その場合は、まずFinderで `CodeCity.command` をControlキーを押しながらクリックして **開く** を選び、内容と入手元を確認してから許可してください。必要なら **システム設定 → プライバシーとセキュリティ** に表示される個別の「このまま開く」を使います。Mac全体の保護や、フォルダ全体の隔離属性を一括で無効化する必要はありません。

### ターミナルから使う

```sh
# サンプルを表示
npm run demo

# 任意のリポジトリを表示
node src/server.mjs --repo "/path/to/your/repository" --open
```

標準では `http://127.0.0.1:4173` を使います。別のポートが必要なら `--port 4174` のように指定できます。

## 表示の意味

- **確認済みの事実**: 読み取った静的なimportや、実際に見つからなかった接続先
- **推定**: 静的な接続から求めた循環、到達性、テストとの対応
- **不明・未確認**: 実行しなければ分からない挙動、動的に組み立てられるimport、解析上限を超えた範囲

「テストとの対応が見つからない」は未確認であり、故障を意味しません。街の警告はソフトウェアの品質点数でも、公開可否の判定でもありません。

## 現在の解析範囲

- 対象は `.js`、`.jsx`、`.mjs`、`.cjs`、`.ts`、`.tsx`、`.mts`、`.cts` です。
- BabelのAST parserで、文字列リテラルの `import`、`export ... from`、単独の `require()`、`import()` を静的に調べます。
- 初期上限は2,500ファイル、合計12 MiB、1ファイル2 MiBです。上限を超えた範囲は未解析として表示されます。
- 動的なパス、パスエイリアス、各種bundler固有の解決、実行時のデータフロー、外部APIの挙動は完全には分かりません。
- parserが受理できない構文やAST走査上限に達したファイルは、故障ではなく未解析として記録されます。heuristicな文字列探索には戻りません。
- したがって、リポジトリ全体の依存・因果関係を完全に証明するものではありません。

## プライバシーと安全性

対象リポジトリは読み取り専用のデータとして扱います。対象のコード、テスト、hook、package script、package managerは実行せず、ファイルも変更しません。`npm install` はCodeCity自身のparserを取得する初回準備であり、点検対象のフォルダでは実行しません。解析時にソース本文を外部へ送信せず、サーバーはMac内のループバックアドレスだけで待ち受けます。詳しくは [SECURITY.md](SECURITY.md) と [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

## 開発者向け

```sh
npm ci
npm run check
```

直接の実行時依存は `@babel/parser` 1件です。対象リポジトリ側で `npm install` やテスト実行を行わないでください。
