# tools

画像生成で作った「ドット絵風の大きな画像」を、ゲームで使う正確な解像度のドット絵に変換する道具（Node 22以上、標準ライブラリのみ）。

- 人物シート: `node tools/pixelize.mjs in.png out.png --grid 4x4 --cell 32 --char-height 30 --colors 32`（承認済みの主人公は身長30px、足元はy=31）
- 建物・小物: `node tools/pixelize.mjs in.png out.png --grid 1x1 --size 96x112`（はみ出さないよう縮めて下端中央に置く）
- 地面のtexture: `node tools/pixelize.mjs in.png out.png --grid 1x1 --size 128x128 --fit stretch --tileable`（継ぎ目なし）
- 見比べ: `node tools/preview.mjs side art/approved/player--default.png out.png cmp.png --scale 4`
- 拡大表示: `node tools/preview.mjs up out.png out-x4.png --scale 4 --grid 32`
- manifest: `node tools/build-manifest.mjs`（art/game/ の画像と sidecar の .json から art/game/manifest.json を作る。manifest は手で編集しない）
- 入れるかの検査: `node tools/check-play.mjs <リポジトリ | town.json> [...] [-v]`（web/ の衝突判定そのもので、開始位置からすべての建物の床まで歩けるか・扉の前から上キーで入れるか・クリックで入れるか・番人に話しかけられるかを確かめる。入れない建物があれば終了コード 1 と、扉まわりをふさいでいる物を出す）
  - リポジトリ入力は CLI と同じ `layout → populateTown → placeOverlay（指定時）` で、bot・外部工務店と重複する住人を除き、代理人と生き物を含める。保存済み Town は再生成せず、`creatures`・`contractors` が無ければ populate 済みと確認できない旨を警告する。
  - 住人・常連・代理人を `web/residents.js` で生成し、生成数、初期足元の衝突・到達・接近、家の既存の入室検査、初期位置から各戸口・各家相互の経路を同じ基準で検査する。経路は `Walker.goTo` とゲームの足元の連続衝突判定を使う。
  - 生き物は `web/creatures.js` で DOM を使わず生成し、初期位置を実際の小さな足元と建物除外で検査する。主人公の到達領域に、ゲームの話者選択（番人・住人・ほかの生き物・overlay の優先を含む）がその個体を選ぶ場所があるかも調べる。任意時間後の飛行・着地・追従や全乱数列を保証する検査ではない。
  - いずれかが失敗すれば exit 1。人数・個体数と失敗個体・理由を出し、`-v` は成功した個体の初期位置（tile）も出す。`checkPlay()` の戻り値 `inhabitants` は種類ごとの `total`・`created`・`failed`・`entries`（座標は px）を持つ。
- 担当地区の検査: `node tools/ascii-town.mjs town.json --districts --check`（`module.group` ごとの塊数と理由付き `unplaced` を表示。一塊でないのに説明が無ければ失敗）
- 種を変える検査: `node tools/seed-fuzz.mjs <リポジトリ | model.json> --count 200 --out compare/fuzz`（ASCII・芝生・実際の Player を検査。group 指定時は、入力 module の欠落も検査し、全担当が完全配置された seed 数と「一塊または理由付き未配置」の seed 数を分けて表示）
- 状態判定の検査: `node tools/check-state.mjs`（os.tmpdir() の下で3つのgit fixtureを作り、記録のmtimeを固定して道場の passed・failed・unverified を確かめ、終了後に消す）

- 重ね書きを表示: `node codecity.mjs <repo> --overlay overlay.json --port 4806`。`--json compare/town.json`、`--ground compare/ground.png` で書き出せる。配信中は検証済みの配置を `/overlay.json` で取得できる。
- 重ね書きの歩行検査: `node tools/check-play.mjs <repo> --overlay overlay.json --town-out compare/overlay-town.json`。物・人（門番を含む）・goal の到達数、理由付き未配置数を出す。生成済みの town.json は `--overlay` を付けずに検査する。
- 重ね書きの種検査: `node tools/seed-fuzz.mjs <repo> --overlay overlay.json --count 200 --out compare/overlay-fuzz`。元の seed に `@fuzz:0000000` などを付けて 200 通りを作り、HEAD や施設の証拠・状態は変えない。report.json に実際の overlaySeed と到達数を保存する。保存する model.json の `overlayFiles` は全ファイルのモジュール対応。手書き model.json にそれがなければ module.path・topFiles に一致する glob だけを解決できる。
- ASCII の overlay: record は `✓`・`×`・`?`、board は `N`、gate は `[`、人は `p`、門番は `k`、goal は `◎`。

見本リポジトリと生成物を作業ツリーから分離して検査するときは、`GIT_CEILING_DIRECTORIES="$PWD/compare"` と `TMPDIR="$PWD/compare/tmp"` を指定し、先に `mkdir -p compare/tmp` を実行する。追加の npm パッケージは不要。

複数の overlay を同じリポジトリで検査する例（castle 版も別ファイルとして用意する）:

```sh
mkdir -p compare/tmp
export GIT_CEILING_DIRECTORIES="$PWD/compare"
export TMPDIR="$PWD/compare/tmp"
for overlay in compare/inputs/memo-overlay*.json; do
  name=$(basename "$overlay" .json)
  node tools/seed-fuzz.mjs /path/to/examples/memo --overlay "$overlay" --count 200 --out "compare/fuzz/$name" || exit "$?"
done
```

gridhub の2版と各 castle 版、homebrew／codecity-inspector の memo 版と castle 版も、入力先と出力先を分けて同じように回す。再現には保存された `model.json` を入力に使い、同じ overlay と `--start N --count 1` を渡す（N は10進数）。元の seed へ付く末尾は `@fuzz:0000000`〜`@fuzz:00000c7`。`report.json` の `failed` とプロセスの終了コードを両方確認する。
