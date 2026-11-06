# データの受け渡し（実装用）

製品の意図は `PRODUCT.md`。ここにはモジュール間で受け渡すデータの形だけを書く。座標の単位は、注記がなければtile（16px）。

## RepoModel（src/analyze.mjs → src/layout.mjs）

```js
{
  name: "codecity-inspector",          // ディレクトリ名
  head: "79c767e", branch: "main",     // gitでなければ null
  latestCommitDate: "2026-11-01T..",   // いちばん新しいコミットの日時（「最近90日」の基準）。gitでなければ null
  readme: { title: "CodeCity", excerpt: "最初の段落（300字まで）" } | null,
  modules: [{
    path: "src/engine",                // ルートからの相対パス。ルート直下のファイル群は "."
    kind: "workshop" | "shop" | "house" | "ruin",
    reason: "package.json の scripts と .github/workflows を含む",   // kind を決めた理由（日本語、事実のみ）
    files: 12, lines: 3400, bytes: 120000,
    languages: { "js": 9, "css": 3 },  // 拡張子ごとのファイル数
    lastCommit: { hash, date: "2026-10-01T..", author, subject } | null,
    commits: 41,                       // このパスに触れたコミット数
    recent: 12,                        // そのうち latestCommitDate までの90日のコミット数
    authors: [{ name: "amano", commits: 30 }],
    topFiles: [{ path, lines }]        // 行数の多い順に最大8件
  }],
  facilities: [{                       // src/facilities.mjs。証拠があるものだけ（控えめに判定）
    archetype: "town_hall" | "inn" | "pub" | "warehouse" | "watchtower" | "dojo",
    name: "役場",                      // 役場・宿屋・酒場・倉庫・見張り台・道場
    reason: "git リポジトリ（マージを除くコミット 115 件・タグ 1 個）",   // 日本語、事実のみ。コミット数はどこでもマージを除く
    evidence: ["CHANGELOG.md", ...],   // 根拠のパス（最大20件、ディレクトリは末尾 "/"、役場は ".git"）
    evidenceCount: 131,                // 根拠の総数
    merged: ["tests", "tests/e2e"],    // 全ファイルがこの施設の根拠であるモジュール（家を建てず、施設の建物にまとめる）
    commits, recent, lastCommit, authors,   // 根拠に触れたコミット（役場はリポジトリ全体）
    facts: { ... }                     // 番人が話す事実（下の表）
  }],
  contributors: [{ name, commits, modules: ["src/engine", ...],     // メールアドレスは含めない
                  lastCommit: { subject, date } }]                   // その人のいちばん新しいコミット
}
```

facts の形:

| archetype | facts |
|---|---|
| town_hall | `{ commits, contributors, contributorsWindow /* 履歴を上限まで読んだときの範囲 */, firstCommit, lastCommit, tags, latestTag: {name,date}, changelog }` |
| inn | `{ servers: [{path, how}], deploy: [paths], domains: ["docs.brew.sh"], frameworks: ["Next.js"], configs: [paths], pages: [paths] }` |
| pub | `{ connectors: [{ name: "OpenAI", via: "dep" \| "url", paths }], webhooks: ["/api/webhook"] }` |
| warehouse | `{ kinds: ["SQLite", ...], sqlFiles, migrations, configs, dataFiles, sqliteCode }` |
| watchtower | `{ tools: ["Sentry", ...], logDirs, configs }` |
| dojo | `{ files, runners: ["Vitest", "node --test"], dirs, latest: { subject, date, author } }` |

## Town（src/layout.mjs → web、`/town.json`）

```js
{
  version: 1,
  repo: { name, head, branch, readme, latestCommitDate, recentDays: 90 },
  tile: 16, cols: 96, rows: 72,
  ground: ["..##++..", ...],          // rows個の文字列、各cols文字。'.'草地 '#'石畳の通り ':'土の路地 '+'広場 '~'水 ' '街の外
  groundImage: "/ground.png",         // ground から src/ground.mjs が合成した1枚の地面画像（cols*16 × rows*16 px、原点は tile (0,0) の左上）
  buildings: [{
    id: "b12",
    id: "b12" | "f1",                  // 施設は f<n>
    archetype: "house_s" | "house_m" | "shop" | "workshop" | "ruin"
             | "town_hall" | "inn" | "pub" | "warehouse" | "watchtower" | "dojo",   // art/game/manifest.json のキー
    variant: "house_s-2",              // 省略可。見た目の版（近くに同じ版が並ばないよう layout が選ぶ）。無ければ hash(id) で選ぶ
    x: 10, y: 8, w: 6, h: 4,           // footprint（壁の外周）。扉は下辺
    door: { x: 12, y: 11 },            // 扉のtile（footprintの最下段）
    module: { ...RepoModel.modules[i] },  // 施設では kind = archetype、統計は根拠とまとめたモジュールのもの
    facility: { archetype, name, reason, evidence, evidenceCount, facts, merged }   // 施設のときだけ
  }],
  props: [{ type: "lamp" | "barrel" | "crate" | "tree" | "bush" | "bench" | "well" | "fence" | "noticeboard"
                 | "sacks" | "flowerpot" | "planter" | "cart", x: 20.5, y: 14 }],   // manifest に <type>-2 などの別の見た目があれば、位置の hash で選ぶ
  residents: [{ id: "r1", name: "amano", commits: 30, homes: ["b12", "b3"], look: 0,
                lastCommit: { subject, date } | null }],             // contributors[].lastCommit
  crowd: [{ id: "c1", home: "b12", look: 3, fact: 0 | 1 }],          // 常連（街を歩くモブ）。建物ごとに0〜2人、最近90日の
                                                                     // コミットが多いほど多い。全体で最大40人、廃屋にはいない。
                                                                     // fact: 吹き出しで言う事実（0=最近の回数、1=最後の変更）
  creatures: [{ kind: "pigeon" | "dog" | "cat", name: "express", reason: "package.json の dependencies",
                home: { x: 41.5, y: 25.7 },   // 足元（tile、歩ける所）。下の「小さな生き物」
                flock: 0,                     // 鳩だけ: 同じ群れの番号
                meaning: "cron" | "job" | "ruin",   // 猫だけ
                sprite: "cat-2", sleeping: true, building: "b7" }],   // 廃屋の猫だけ（その廃屋の id）
  spawn: { x: 48, y: 40 }
}
```

### 小さな生き物（src/creatures.mjs → town.creatures → web/creatures.js）

コードと依存の「生活」。リポジトリに根拠があるものだけを置き、無ければその種類はいない。
- 鳩 = 直接の依存（package.json の dependencies / devDependencies、requirements*.txt、pyproject.toml、Pipfile、Gemfile、go.mod、Cargo.toml、composer.json。docs・examples・tests の下の manifest は後回し）。1羽に依存1つ、最大14羽。小さな群れで広場と通りにいる。走って近づくと飛び立ち（pigeon-fly）、少しして近くに降りる。
- 犬 = リポジトリで働く bot（git log の作者名が `[bot]` で終わる・`…Bot`、または `.github/dependabot.yml`・`renovate.json` などの設定）。1匹に bot 1つ、最大3匹。役場のまわりを歩き、近くを通ると数歩ついてくる。
- 猫 = 決まった時間・裏で動く仕事（`.github/workflows/*.yml` の `schedule:`、workers/・jobs/・queue/ などのディレクトリ、`*.worker.*`・`*_job.*`・`jobs.js` などのファイル、cron・queue のライブラリ）。最大4匹、根拠のあるモジュールの建物のそばで歩く・座る・眠る。廃屋があれば、いちばん長く触られていない廃屋のそばで眠る猫を1匹（`cat-2`）。
- 生き物は誰の通り道もふさがない。近くに立つと小さな吹き出しで本当の意味を言う（例: 鳩「express」（このリポジトリが使っている道具））。

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
  `interiorLights: [[x,y,r], ...]`（footprint基準のpx）は炉・暖炉など室内の光で、建物が開いている（cutaway）間だけ灯る。`lights` は常に灯る（窓など）。
  `floor: [x,y,w,h]`（footprint基準のpx）があれば、室内で歩けるのはその矩形から `blockers` を除いた所だけで、footprintの残りは壁（扉の隙間を除く）。無ければ従来どおり外周1tile（奥は2tile）が壁。
  画像の大きさは「幅 = footprint幅×16」「高さ = footprint奥行×16 + 屋根の高さ」。footprintの下端が画像の下端に来るので、通常 origin = [0, 画像の高さ − footprint奥行×16]。
  同じarchetypeに複数の `<n>`（見た目の違う版）があってよい。manifestでは `archetypes["house_s"].variants = [...]` になり、町の各建物は `building.variant`（無ければ `hash(building.id)`）で版を選ぶ。
- 人物 `art/game/residents/<name>.png`（4×4、32×32のframe。行は 下・左・右・上、列は 立ち・歩きA・立ち・歩きB）。`keeper-<kind>.png` は建物の中にいる番人（kind は workshop・shop・house・ruin）、`townsfolk-<n>.png` は街を歩く住人。
- 生き物 `art/game/creatures/<name>.png` と `<name>.json`: `{ "frame": [16,16], "pivot": [8,15], "anims": { "<anim>": { "down": [...], "left": [...], ... } } }` → manifest の `creatures[name] = { src, frame, pivot, anims }`。name は pigeon・pigeon-fly・dog・cat・cat-2（anims: pigeon は idle・peck・hop、pigeon-fly は fly、dog・cat は idle（座る）・stand・walk）。
- 小物 `art/game/props/<type>.png` と `<type>.json`: `{ "origin": [ox,oy], "solid": [x,y,w,h] | null, "light": [x,y,r] | null, "flicker": true }`（座標は小物の足元＝town.jsonの(x,y)×16 を原点としたpx）

## 施設の置き場所（src/layout.mjs）

- 施設は art manifest にその archetype の絵があるときだけ置く。絵が無ければ置かず、merged のモジュールはふつうの建物になる。
- 役場は広場の北の真ん中で広場に面する（北へ向かう大通りは役場の脇を通る）。酒場は広場の東か西のきわ。宿屋は大通り（広場の南の東西の通り）を外から入ってきた端。道場・倉庫は広場からひとまわり外の、別々の向きの地区。見張り台は外縁。
- 施設の扉の前5行には小物を置かず、施設のまわりには木を置かない。

## 番人と住人

- すべての建物に、その建物の種類（module.kind）の番人が1人いる。番人は名前のある人物ではなく「工房の親方」「商店の主人」「家の人」「廃屋の管理人」という役で、そのモジュールの事実だけを話す（誰がよく手を入れているか、最近何が変わったか、どんなファイルがあるか）。
- 施設の番人は「役場の書記」「宿屋の番頭」「酒場の主人」「倉庫番」「見張り台の番人」「道場の検査官」で、facility.facts だけを話す。絵は `keeper-<archetype>.png`（characters.keepers[archetype]）。無ければいちばん近い番人の絵（宿屋・酒場→shop、倉庫→workshop、ほか→house）で立てる。
- 常連（town.crowd）は townsfolk の姿（`look % townsfolk数`）で、自分の建物の近くを歩き、ときどき広場やほかの建物の扉へ行き、立ち止まって見回し、二人で向かい合って立ち話をする。吹き出しは「◯◯の常連」と、その建物の本当の事実をひとつだけ言う。
- コミットした人は townsfolk の姿で街を歩く（`look % townsfolk数` で姿を選ぶ）。番人と同じ人物が二重に現れることはない。
