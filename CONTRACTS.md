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
  contributors: [{ name, commits, modules: ["src/engine", ...],     // メールアドレスは含めない
                  lastCommit: { subject, date } }]                   // その人のいちばん新しいコミット
}
```

## Town（src/layout.mjs → web、`/town.json`）

```js
{
  version: 1,
  repo: { name, head, branch, readme },
  tile: 16, cols: 96, rows: 72,
  ground: ["..##++..", ...],          // rows個の文字列、各cols文字。'.'草地 '#'石畳の通り ':'土の路地 '+'広場 '~'水 ' '街の外
  groundImage: "/ground.png",         // ground から src/ground.mjs が合成した1枚の地面画像（cols*16 × rows*16 px、原点は tile (0,0) の左上）
  buildings: [{
    id: "b12",
    archetype: "house_s" | "house_m" | "shop" | "workshop" | "ruin" | ...,   // art/game/manifest.json のキー
    x: 10, y: 8, w: 6, h: 4,           // footprint（壁の外周）。扉は下辺
    door: { x: 12, y: 11 },            // 扉のtile（footprintの最下段）
    module: { ...RepoModel.modules[i] }
  }],
  props: [{ type: "lamp" | "barrel" | "crate" | "tree" | "bush" | "bench" | "well" | "fence" | "noticeboard", x: 20.5, y: 14 }],
  residents: [{ id: "r1", name: "amano", commits: 30, homes: ["b12", "b3"], look: 0,
                lastCommit: { subject, date } | null }],             // contributors[].lastCommit
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

## 画像ごとのsidecar（art/game/** → tools/build-manifest.mjs → manifest.json）

manifest.json は手で編集しない。画像を作る人は、画像の隣に同名の `.json` を置き、`node tools/build-manifest.mjs` で manifest.json を組み立てる。

- 建物 `art/game/buildings/<archetype>-<n>.json`:
  `{ "archetype": "house_s", "footprint": [6,4], "exterior": {"src": "house_s-1.exterior.png", "origin": [ox,oy]}, "cutaway": {"src": "house_s-1.cutaway.png", "origin": [ox,oy]}, "door": {"x":2,"w":2}, "blockers": [...], "lights": [...], "smoke": [...] }`
  `floor: [x,y,w,h]`（footprint基準のpx）があれば、室内で歩けるのはその矩形から `blockers` を除いた所だけで、footprintの残りは壁（扉の隙間を除く）。無ければ従来どおり外周1tile（奥は2tile）が壁。
  画像の大きさは「幅 = footprint幅×16」「高さ = footprint奥行×16 + 屋根の高さ」。footprintの下端が画像の下端に来るので、通常 origin = [0, 画像の高さ − footprint奥行×16]。
  同じarchetypeに複数の `<n>`（見た目の違う版）があってよい。manifestでは `archetypes["house_s"].variants = [...]` になり、町の各建物は `hash(building.id)` で版を選ぶ。
- 人物 `art/game/residents/<name>.png`（4×4、32×32のframe。行は 下・左・右・上、列は 立ち・歩きA・立ち・歩きB）。`keeper-<kind>.png` は建物の中にいる番人（kind は workshop・shop・house・ruin）、`townsfolk-<n>.png` は街を歩く住人。
- 小物 `art/game/props/<type>.png` と `<type>.json`: `{ "origin": [ox,oy], "solid": [x,y,w,h] | null, "light": [x,y,r] | null, "flicker": true }`（座標は小物の足元＝town.jsonの(x,y)×16 を原点としたpx）

## 番人と住人

- すべての建物に、その建物の種類（module.kind）の番人が1人いる。番人は名前のある人物ではなく「工房の親方」「商店の主人」「家の人」「廃屋の管理人」という役で、そのモジュールの事実だけを話す（誰がよく手を入れているか、最近何が変わったか、どんなファイルがあるか）。
- コミットした人は townsfolk の姿で街を歩く（`look % townsfolk数` で姿を選ぶ）。番人と同じ人物が二重に現れることはない。
