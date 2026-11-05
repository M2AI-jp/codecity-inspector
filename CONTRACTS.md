# データの受け渡し（実装用）

製品の意図は `PRODUCT.md`。ここにはモジュール間で受け渡すデータの形だけを書く。座標の単位は、注記がなければtile（16px）。

## RepoModel（src/analyze.mjs → src/layout.mjs）

```js
{
  name: "codecity-inspector",          // ディレクトリ名
  head: "79c767e", branch: "main",     // gitでなければ null
  readme: { title: "CodeCity", excerpt: "最初の段落（300字まで）" } | null,
  modules: [{
    path: "src/engine",                // ルートからの相対パス。ルート直下のファイル群は "."
    kind: "workshop" | "shop" | "house" | "ruin",
    reason: "package.json の scripts と .github/workflows を含む",   // kind を決めた理由（日本語、事実のみ）
    files: 12, lines: 3400, bytes: 120000,
    languages: { "js": 9, "css": 3 },  // 拡張子ごとのファイル数
    lastCommit: { hash, date: "2026-10-01T..", author, subject } | null,
    commits: 41,                       // このパスに触れたコミット数
    authors: [{ name: "amano", commits: 30 }],
    topFiles: [{ path, lines }]        // 行数の多い順に最大8件
  }],
  contributors: [{ name, commits, modules: ["src/engine", ...] }]   // メールアドレスは含めない
}
```

## Town（src/layout.mjs → web、`/town.json`）

```js
{
  version: 1,
  repo: { name, head, branch, readme },
  tile: 16, cols: 96, rows: 72,
  ground: ["..##++..", ...],          // rows個の文字列、各cols文字。'.'草地 '#'石畳の通り ':'土の路地 '+'広場 '~'水 ' '街の外
  buildings: [{
    id: "b12",
    archetype: "house_s" | "house_m" | "shop" | "workshop" | "ruin" | ...,   // art/game/manifest.json のキー
    x: 10, y: 8, w: 6, h: 4,           // footprint（壁の外周）。扉は下辺
    door: { x: 12, y: 11 },            // 扉のtile（footprintの最下段）
    module: { ...RepoModel.modules[i] }
  }],
  props: [{ type: "lamp" | "barrel" | "crate" | "tree" | "bush" | "bench" | "well" | "fence" | "noticeboard", x: 20.5, y: 14 }],
  residents: [{ id: "r1", name: "amano", commits: 30, homes: ["b12", "b3"], look: 0 }],
  spawn: { x: 48, y: 40 }
}
```

## アートmanifest（art/game/manifest.json → web）

画像の座標はpx。`origin` は「footprintの左上」が画像のどこにあるか。

```js
{
  tile: 16,
  characters: {
    player: { src: "../approved/player--default.png", frame: [32, 32], pivot: [16, 31],
              anims: { idle: { down: [12], up: [0], right: [24], left: [36] },
                       walk: { down: [14,15,16,17], ... } } },
    residents: [{ src, frame, pivot, anims }]
  },
  archetypes: {
    house_s: {
      footprint: [6, 4],
      exterior: { src: "house_s.exterior.png", origin: [0, 40] },
      cutaway:  { src: "house_s.cutaway.png",  origin: [0, 40] },
      door: { x: 2, w: 2 },              // footprint下辺での扉の位置と幅（tile）
      blockers: [[x, y, w, h], ...],     // 室内で歩けない家具（footprint基準のpx）
      lights: [[x, y, radius], ...]      // 窓・炉などの光（footprint基準のpx）
    }
  },
  props: { lamp: { src, origin: [ox, oy], solid: [x, y, w, h] | null, light: [x, y, r] | null } },
  ground: { street: "street.png", grass: "grass.png", dirt: "dirt.png", plaza: "plaza.png" }   // 継ぎ目なしのtexture
}
```

manifestに無いarchetype・propは描かずにconsoleへ警告し、ゲーム全体は止めない。
