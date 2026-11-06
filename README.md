# CodeCity

リポジトリが、歩ける夜のドット絵の街になります。

```sh
node codecity.mjs /path/to/repository
```

表示されたURLをブラウザで開きます。矢印キーかWASDで走り、Shiftを押している間はゆっくり歩きます。行きたい場所をクリックしても歩きます。建物の扉から入ると屋根が外れ、中の番人が話しかけてきます。酒場の主人のところでは Enter かクリックで「接続者ギルドの名簿」が開きます（←→ か Q・E でページをめくり、Esc で閉じる）。

Node.js 22以上だけで動きます（npmパッケージは不要）。製品の正本は [PRODUCT.md](PRODUCT.md)、データの形は [CONTRACTS.md](CONTRACTS.md) です。

確かめるための道具:

- `node tools/check-play.mjs <repo>` — すべての建物に扉から入れて、番人と話せるかを、ゲームと同じ当たり判定で調べる
- `node codecity.mjs <repo> --json town.json` と `node tools/ascii-town.mjs town.json --check` — 街の配置を文字で見る・検査する
- `node tools/build-manifest.mjs` — `art/game/` の画像と注釈から manifest.json を作り直す
- `node tools/gallery.mjs gallery.html` — 素材のレビュー用ページを作る

`art/approved/` はユーザーが承認した画像、`art/game/` は承認前の候補、`art/references/user-provided/` はユーザーの原画です。
