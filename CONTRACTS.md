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
    topFiles: [{ path, lines }],       // 行数の多い順に最大8件
    works: { dirty: 3 }                // 省略可。作業ツリーで HEAD と違うこのモジュールのファイル数（変更・追加・削除・無視されていない未追跡）。
                                       // 0 のとき・git の作業ツリーでないとき・bare リポジトリでは無い（git --no-optional-locks status で読む）
  }],
  facilities: [{                       // src/facilities.mjs。証拠があるものだけ（控えめに判定）
    archetype: "town_hall" | "inn" | "pub" | "warehouse" | "watchtower" | "dojo" | "well" | "dock" | "gate" | "repair",
    name: "役場",                      // 役場・宿屋・酒場・倉庫・見張り台・道場・井戸・船着場・門・修理小屋
    reason: "git リポジトリ（マージを除くコミット 115 件・タグ 1 個）",   // 日本語、事実のみ。コミット数はどこでもマージを除く
    evidence: ["CHANGELOG.md", ...],   // 根拠のパス（最大20件、ディレクトリは末尾 "/"、役場は ".git"）
    evidenceCount: 131,                // 根拠の総数
    merged: ["tests", "tests/e2e"],    // 全ファイルがこの施設の根拠であるモジュール（家を建てず、施設の建物にまとめる）。井戸・門は建物が無いので常に []
    commits, recent, lastCommit, authors,   // 根拠に触れたコミット（役場はリポジトリ全体）
    facts: { ... }                     // 番人が話す事実（下の表）
  }],
  contributors: [{ name, commits, modules: ["src/engine", ...],     // メールアドレスは含めない
                  lastCommit: { subject, date } }],                  // その人のいちばん新しいコミット
  agents: [{ name: "Claude Code",      // 外部のコード生成エージェント（外部工務店）。コミット数の多い順に最大3つ
             commits: 38, recent: 31,  // 名前のあるコミット（マージを除く・解析が読んだ直近5000件の中）と、そのうち最新コミットまでの90日の数
             modules: ["src", ...],    // 触ったモジュール（多い順）
             last: { subject, date } }]                              // いちばん新しいもの
}
```

agents の見分け方（src/analyze.mjs AGENTS）: 作者名（`claude`・`copilot-swe-agent[bot]`・`chatgpt-codex-connector[bot]`・`Cursor Agent`・`devin-ai-integration[bot]`・`… (aider)`・`gemini-code-assist[bot]` など）、
trailer（`Co-Authored-By: Claude … <noreply@anthropic.com>`・`Co-authored-by: Codex`・`Co-authored-by: Copilot`・`Co-authored-by: Cursor <…>`・`Amp-Thread:` など）、
定型の印（`Generated with [Claude Code]`・`Claude-Session: https://claude.ai/code/…`・件名の `aider: `）だけ。本文に名前が出てくるだけ（話題）は数えない。
作者そのものがエージェントの名前は、犬（bot）にも住人にもしない（`agentForAuthor()`）。名前は Claude Code・Codex・GitHub Copilot・Cursor・Devin・Aider・Gemini・Amp・OpenHands。

facts の形:

| archetype | facts |
|---|---|
| town_hall | `{ commits, contributors, contributorsWindow /* 履歴を上限まで読んだとき・浅いクローンのときの範囲 */, firstCommit /* 浅いクローンでは null */, lastCommit, tags /* 浅いクローンでタグが無ければ null（不明） */, latestTag: {name,date}, changelog, shallow, dirty /* 作業ツリーで HEAD と違うファイルの総数。bare・作業ツリーなしは null */, agents: [{ name, commits, recent }] /* 工事報告（RepoModel.agents） */ }` |
| inn | `{ servers: [{path, how}], deploy: [paths], domains: ["docs.brew.sh"], frameworks: ["Next.js"], configs: [paths], pages: [paths] }` |
| pub | `{ connectors: [{ name: "OpenAI", via: "dep" \| "url", paths }], webhooks: ["/api/webhook"], routes: [{ method: "GET" \| "POST" \| … \| null /* 分からなければ null */, route: "/api/chat", path }] /* この街が受ける道。サーバーらしいファイル（フレームワークの呼び出し・Flask/FastAPI・Go・Rails の routes.rb・Next.js の app/**/route と pages/api・サーバーのファイルの "/api/…" の文字列）から。最大30 */, routesTotal, keys: [{ name: "OPENAI_API_KEY", for: "OpenAI" \| null, example: true /* 見本の env に名前がある */ }] /* 鍵らしい設定の名前だけ（値は読まない）。最大20 */, envExamples: [paths], specs: [openapi・swagger・asyncapi・GraphQL・proto のパス], prompts: [AI への頼み方のファイル], promptsTotal, watchtower: true \| false /* 見張り台があるか */, watchTools: ["Sentry"] }`。酒場は connectors・webhooks・API の取り決め（openapi など）のどれかがあるときだけ |
| well | `{ examples: [".env.example", …] /* 見本（名前だけ読む） */, names: ["OPENAI_API_KEY", …] /* 見本に書いてある名前を先に、製品のコードが読む環境変数の名前（読むファイルの多い順）。最大40。OS・CI が自分で渡す名前（HOME・PATH・GITHUB_SHA など）は除く */, namesTotal, envInCode: [{ name: "OPENAI_API_KEY", files: ["src/server.js", …] }] /* 値を読まず、設定名を読む製品ファイルだけ。名前ごとに最大20件 */, configs: [設定のファイル・ディレクトリ 最大8], committed: [".env", …] /* git に記録された本物の env ファイル。中身は開かない */, loaders: ["dotenv", …], ciSecrets: ["NPM_TOKEN", …] /* .github/workflows の secrets.X（GITHUB_TOKEN は除く）。最大12 */ }`。見本・記録された env・読み込む道具のどれかがあるか、製品のコードが3つ以上の名前を読むときだけ。外に立つ施設（Town の landmarks）なので merged は常に [] |
| dock | `{ packages: [{ registry: "npm" \| "PyPI" \| "crates.io" \| "RubyGems" \| "Go" \| "Packagist" \| "pub.dev" \| "SwiftPM", name, version \| null, path }] /* 荷札。公開した証拠ではない */, apps: [{ kind: "iOS" \| "macOS" \| "Apple" \| "Android" \| "Expo" \| "React Native" \| "Electron" \| "Tauri" \| "Capacitor" \| "Flutter" \| "Browser extension" \| "VS Code extension", path: "mac/" }], publish: [paths] /* 出港の手順: 公開・配布のコマンドを含む workflow・package.json、配布の設定（.goreleaser.yml・release-please-config.json・electron-builder.yml・eas.json・Fastfile など） */, bins: ["codecity"] }`。アプリ・出港の手順・はっきりした荷札（package.json に main・bin・exports・files などがあり private でない、pyproject の build-system、Cargo.toml の [package]、gemspec など）のどれかがあるときだけ。荷札だけの package.json（名前と版だけ）・go.mod は、船着場があるときに並べるだけ |
| gate | `{ domains: ["docs.brew.sh"] /* CNAME の住所 */, deploy: [{ path: "vercel.json", name: "Vercel" \| null }] /* 公開の段取りの設定（Vercel・Netlify・Fly.io・Render・Cloudflare Workers・Firebase Hosting・Docker の EXPOSE など）。公開した証拠ではない */, servers: [{ path, how }] /* 宿屋と同じ */, frameworks: ["Next.js"], routes: [{ method, route, path }] /* 受付の道（酒場の routes と同じ見つけ方。受け方の分かるものが3本以上あればそれだけ）。最大8 */, routesTotal, auth: [{ name: "NextAuth.js", path: "package.json" }] /* ログインの道具: 製品の依存（docs・examples・tests の下の manifest は数えない）に、名前でそれと分かる道具（next-auth・@auth/*・better-auth・passport・lucia・@clerk/*・@supabase/auth-helpers-*・@supabase/ssr・@auth0/*・@firebase/auth・devise・omniauth・django-allauth・flask-login など）があるときだけ。最大4 */ }`。宿屋の証拠（Webサーバーのコード・公開の設定・Webの骨組み）があるか、受け方の分かる受付の道があるときだけ。外に立つ施設（Town の landmarks）なので merged は常に []。本当に外から入れるかは確かめない |
| warehouse | `{ kinds: ["SQLite", ...], sqlFiles, migrations, configs, dataFiles, sqliteCode }` |
| watchtower | `{ tools: ["Sentry", ...], logDirs, configs }` |
| dojo | `{ files, runners: ["Vitest", "node --test"], dirs, latest: { subject, date, author } }` |
| repair | `{ deployment: [{ path, detail }], database: [{ path, detail }], backup: [{ path, detail }], runbook: [{ path, detail }] }`。デプロイの切り戻し、DB migration の down/rollback、バックアップの dump/restore、復旧手順書の見出しなど、製品ファイルで確認できた種類だけを入れる。単なる `restore` という関数名や、fixtures・tests・vendor の中の証拠は数えない。ここにあることは実行可能性の確認ではない |

## Town（src/layout.mjs → web、`/town.json`）

```js
{
  version: 1,
  repo: { name, head, branch, readme, latestCommitDate, recentDays: 90 },
  tile: 16, cols: 96, rows: 72,
  ground: ["..##++..", ...],          // rows個の文字列、各cols文字。'.'草地 '#'石畳の通り ':'土の路地 '+'広場 '~'水 ' '街の外
  groundImage: "/ground.png",         // ground から src/ground.mjs が合成した1枚の地面画像（cols*16 × rows*16 px、原点は tile (0,0) の左上）
  canal: {                            // 井戸と橋の絵が揃うときだけ。町内座標の2マス幅の水路
    cells: [[x, y], ...],             // ground の '~' と一致する水セル（幅2、曲がり角を含む）
    from: "well",                     // 広場の井戸の縁から流れ始める
    past: ["src/server", ...],        // envInCode の設定名を最も多く読む建物地区。値は含めない
    to: "harbour" | "outside",        // 船着場があれば港の水へ、無ければ森の外へ
    crossings: [{ x, y, road: "h" | "v", bridge: "bridge-h" | "bridge-v" }, ...]
                                       // 通り・路地を直角に渡る交差点と、そこで使う橋の向き
  },
  buildings: [{
    id: "b12" | "f1",                  // 施設は f<n>
    archetype: "house_s" | "house_m" | "shop" | "workshop" | "ruin"
             | "town_hall" | "inn" | "pub" | "warehouse" | "watchtower" | "dojo" | "dock" | "repair",   // art/game/manifest.json のキー
    variant: "house_s-2",              // 省略可。見た目の版（近くに同じ版が並ばないよう layout が選ぶ）。無ければ hash(id) で選ぶ
    x: 10, y: 8, w: 6, h: 4,           // footprint（壁の外周）。扉は下辺
    door: { x: 12, y: 11 },            // 扉のtile（footprintの最下段）
    module: { ...RepoModel.modules[i] },  // 施設では kind = archetype、統計は根拠とまとめたモジュールのもの。
                                       // works: { dirty } はまとめたモジュールの合計（工事中の足場の目印）
    facility: { archetype, name, reason, evidence, evidenceCount, facts, merged }   // 施設のときだけ
  }],
  props: [{ type: "lamp" | "barrel" | "crate" | "tree" | "bush" | "bench" | "fence" | "noticeboard"
                 | "sacks" | "flowerpot" | "planter" | "cart"
                 | "wellhouse" | "canal-mouth" | "pier" | "boat" | "bridge-h" | "bridge-v" | "scaffold" | "sign-works" | "lumber" | "gate",
            x: 20.5, y: 14,            // 足元の中心（tile）。1×1 なら (tx + 0.5, ty + 1)
            look: "pier-2",            // 省略可。manifest の小物の名前そのもの（layout が形を当てにして選んだもの: 桟橋の板・足場）。
            w: 1 }],                   // 省略可。layout が場所を取った tile の幅（絵の solid より細く置いたとき。足場を1マスの隙間に立てたとき）
                                       // 無ければ manifest に <type>-2 などの別の見た目があるとき、位置の hash で選ぶ
  landmarks: [{                        // 外に立つ施設（建物が無い）。井戸（prop wellhouse）と門（prop gate）。小物は props にも同じ所に入っている
    id: "f9", archetype: "well" | "gate", name: "井戸" | "門", prop: "wellhouse" | "gate",
    x: 31.5, y: 38,                    // その小物の足元（props と同じ）
    keeper: { x: 33.5, y: 37.6875 },   // 番人の足元（tile。px = ×16。歩ける1マスの中、小物の横。まわり1マスは小物を置かない）
    facility: { archetype, name, reason, evidence, evidenceCount, facts, merged }, module: { ... } }],
  unplaced: [{                          // RepoModel に根拠があるが、絵・場所・番人などの条件で置けなかった施設／目印
    archetype: "town_hall" | "inn" | "pub" | "warehouse" | "watchtower" | "dojo" | "well" | "dock" | "gate" | "repair" | "canal",
    name: "門", reason: "出口ごとに門の絵・柱・土道・門番を置ける場所がない",
    evidence: ["src/server/index.js", ...], evidenceCount: 3
  }],                                  // 省略可。門・井戸・水路が unplaced のとき tools/check-play.mjs は失敗する。
                                       // 井戸の根拠があるのに canal と unplaced canal の両方が無い場合も失敗する
  contractors: [{ id: "a1", name: "Claude Code", commits, recent, homes: ["b3", ...], last: { subject, date } }],
  terraces: [{ x, y, w, h }],          // 段（tile）。上の面 x..x+w-1 × y..y+h-1 は歩ける。y+h 行（x..x+w-1）は擁壁の前の面で、
                                       // web/world.js では階段の所を除いて歩けない。東西の端は縁石（layout は外側の草地・広場を柵・茂み・
                                       // プランターでふさぐか、建物・森にする）。通りが段に入るのは、段と同じ高さで北か東西からだけ
  stairs: [{ x, y, w }],               // 階段（tile）。y は前の面の行（= その段の y+h）。x..x+w-1 の段は歩ける
                                       // 外部工務店（codecity.mjs が RepoModel.agents から layout のあとに足す）
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

街の形（src/layout.mjs）: 小さな広場（幅10〜14・奥行き9前後。北の辺は役場の段とその壁・階段、東西は広場わきの建物、南は大通り）・広場の南の大通り・広場の両わきから東西へ出る北の通り・広場の両わきの南北の通り・役場の脇から北への通り・大通りから街の端（水辺なら岸）へ段々に斜めに下る通り（2〜3行ごとに1列ずれる）を骨組みにして、その外の地区を通りで切り分けていく。どの通りもまっすぐなのは 5〜10 マス（大通りの広場の下と、船着場・桟橋の前は 12〜14 マス）までで、そこで1行（1列）ずれるか T 字に突き当たる（`meander`）。切れ目は地区ごとに違う位置で T 字に突き当たり、交差点の向こうの通りと一直線につながりにくいよう、はじめの一区間は短い。ずれた通りに届かなくなった通りの端は届くまでのばす。深い街区には下へだけ揺れる土の路地（ときどき行き止まり）か、中ほどの小さな舗装の中庭（court。下の通りから小路が入り、奥の家は中庭に扉を向ける）。広い街区には一度折れるか1列ずつ揺れる南北の小路（折れた角の内側は小さな裏庭）。南北の通りが東西の通りに上から突き当たる角のいくつかは小さな広場（舗装、街灯とベンチか木か荷車）。同じ通りの隣は間0マスを約半分、1マスを約4割、2マスを約1割にし、3マス以上は作らない（間0は footprint の端を接してよい）。建物は隣と違う下がり方を先に選び、前の通りから1〜2行上へ寄せる。建物の上側に置かない余白は、その外観版の `cover` の最大行数だけにする。低い建物の前の空きは草地＋柵にせず、通りと同じ STREET・DIRT・PLAZA の前庭にする。緑地は建物15棟に1つほど、街の内側の空き地は木立ち（使わなかった街区には下の通りから曲がった土の小道が抜ける。通りの向こう側の路地と同じ列にはしない）。建物の無い通りは消え、街のまわりは森、街の外へ出る土の道が北・南（斜めの通りの続きは段々）・西・東に残る（宿屋の側は2行の街道）。
密度の規則（src/layout.mjs generate）: 仮想格子は建物数に対して過大にせず、同じ面に置き始めた建物はその面の cursor が閉じるまで続けて置く。面を切り替えるときも既存の建物に近い面を優先し、広場の北側には長い frontage を数本用意して薄い地区への散開を避ける。役場は広場の北辺の中心に置き、左右の住宅を間0〜1マスで先に確保する。役場の段はその隣家の下まで広げてよい。隣の間は0マスを約半分、1マスを約4割、2マスを約1割にし、3マス以上は作らない。建物の裏は外観版の `cover` の最大行数だけを予約し、低い建物の前は STREET・DIRT・PLAZA の前庭にする。`node tools/lawn.mjs town.json` の最大は8マス以下にする。
小物（src/layout.mjs placeProps）: 広場は舞台: まん中（南寄り）の飾り（井戸小屋。無ければ manifest の flowerbed、それも無ければプランターと鉢の花の島）に左右から向くベンチ、縁に樽と鉢（2行おき）、南の縁の両わきに低い柵、街灯は2本だけ（西と東の縁に1本ずつ、段の下の上の方から。基準の広場と同じ数）。役場の階段の前（扉の列の左右2・5行）と飾りのまわり1マスはあける。井戸小屋がまん中にあり flowerbed があるときは、花壇は小さな広場か緑地へ。ほかの街灯は少なく、施設の扉のわき・石畳の通りどうしの角（路地・裏道の角には立てない、16マス離す）・岸（18マス離す）・小さな広場と緑地だけ。木は2〜5本のかたまり（裏庭・広い隙間・街のきわ）と空き地の木立ちで、通り・路地・広場・水のすぐ下2行には植えない（樹冠が歩く人を隠さないように）。建物の足もと（横の壁ぎわの下の1〜3段）と舗装の前庭の扉の脇には、その建物らしい樽・木箱・袋・鉢・プランターを寄せる。footprint の下1行と扉の列の歩行通路は空ける。建物の裏で cover の外側に2行以上の何も無い草地が残る列には、木・茂み・鉢を置いて帯を分ける。最後に、見える芝生（草地で物が無く、建物の絵の屋根の陰（版の cover）でない所）の中の何も無い長方形（縦横とも2マス以上）が8マスを超えるあいだ、いちばん大きい長方形のまん中に2〜3個の組（建物の2マス以内は樽・木箱・袋・鉢・プランター・茂み、離れた所は茂み・花・木）を置く（あけておく所には置かない。`node tools/lawn.mjs town.json` で測る）。
水辺（船着場があるとき）: 大通りの南は街区1〜3段で、その下に岸の通り（'#'、2行、切り出した街の幅いっぱいの直線）、その下は街の幅いっぱい・地図の下の端まで水（'~'）。水深は最長の桟橋の `deck` が届く行に2行の余水を加え、5〜9行に収める。岸の通りのすぐ下の水の行も町の幅いっぱいで同じ行にそろえ、src/ground.mjs が quay.png（岸壁）を重ねる。岸の通りのすぐ上の行は船着場の左右へ建物の正面を間0〜1で続け、建物を置けない列は樽・木箱・袋・網干しの柵などで埋める。岸の通りから3行以内には森を置かない。桟橋（props の pier、`look` つき）は板の上端が岸壁の行の上から4px下（岸壁の上の石が見える）から南へ突き出し、web/world.js が板と岸の通りをつなぐ（板の上端が岸の下の水の tile の上から8px以内なら、その tile の板の幅は上端から歩ける）。舟（boat）は最初の桟橋の杭にぴったりもやう。水は歩けず、桟橋の板（manifest の deck）の上だけ歩ける。

水路と橋: 井戸（well）の施設と、`bridge-h`・`bridge-v` の両方の絵・sidecar があるときだけ `Town.canal` と水路を作る。水路は広場を切らず、井戸に近い広場の南・東・西の縁の順に始点を試し、`envInCode` の設定名を最も多く読む建物モジュールの地区のそば（建物の周囲10マスまでの草地・路地）を通って、船着場があれば (a) 港の水、次に (b) 街の外（森・地図の端）へ流れる。各縁で置けなければ次の縁を試す。地区のそばを通る経路がどの縁からも無い場合に限り `past: []` として街の外へ流す。これらをすべて試しても置けない場合は、`Town.canal` を省略し、`Town.unplaced` に `{ archetype: "canal", name: "水路", reason }` を残す。

`cells` は幅2マスの `~` だけで、建物の footprint・屋根の陰・扉の前・段・広場・門の道を通らず、草地や建物の間を優先する。通り・土の路地とは直角に交わる所だけで同じマスを使い、それ以外では通り・路地のすぐ隣（1マス以内）を流さない。交差点の中心から曲がり角まで2マス以内の通りは渡らせない。通りの脇にいる状態から、通りを渡らずに曲がって離れることも許さない。港の水へ入るときは岸の通りを直角に幅いっぱい渡り、岸壁の地面文字をその水路口だけ `~` にして最初の港の水行へ注ぐ（`to: "harbour"`）。港の水・地図の端・別の水路とは、注ぎ口を除き平行に3マス以内を流さない。水が舗装地を横切るときは、道路の両側へ続く実際の横断だけを `crossings` に記録する。始点の水路端には `canal-mouth`（`ascii-town` では `∩`）を置き、広場の縁の石の口から水が出ることを示す。`crossings` の各交差点に対応する橋を置く（`ascii-town` では `bridge-h` が `─`、`bridge-v` が `│`）。`bridge-h` は東西の通りが南北の水路を渡る向き、`bridge-v` は南北の通りが東西の水路を渡る向きで、sidecar の `deck` の矩形だけが水上で歩け、`solids` は欄干である。密な配置を水路と同じ格子で確定するときは、水路セルと橋 deck を先に決定的に予約し、横橋の deck 外側まで通常建物が橋の歩行端をふさぐ場合だけその建物セルも予約して再配置する。`tools/ascii-town.mjs --check` は港の水と水路の間の幅1〜2マスの陸帯、港の水との平行3マス以内、地図端との平行3マス以内、終端の接続を検査する。橋が通りを分断しないことは tools/check-play.mjs が Player の当たり判定で両方向を渡って確かめる。井戸の根拠があるのに `Town.canal` も `unplaced` の水路記録も無い場合、または水路が `unplaced` の場合、同ツールは失敗する。

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
    keepers: { workshop: { src, frame, pivot, anims }, ..., dock: {...}, repair: {...}, well: {...} },
    townsfolk: [{ src, frame, pivot, anims }],
    contractor: { src, frame, pivot, anims }      // 外部工務店の代理人（あれば）
  },
  archetypes: {
    house_s: {
      footprint: [6, 4],
      exterior: { src: "house_s.exterior.png", origin: [0, 40] },
      cutaway:  { src: "house_s.cutaway.png",  origin: [0, 40] },
      door: { x: 2, w: 2 },              // footprint下辺での扉の位置と幅（tile）
      blockers: [[x, y, w, h], ...],     // 室内で歩けない家具（footprint基準のpx）
      lights: [[x, y, radius], ...],     // 窓・炉などの光（footprint基準のpx）
      wall: [3, 4]                       // build-manifest が外観の絵から測る: 壁が footprint の左・右の端から内側にある px（足場を壁に寄せる）
      cover: [0, 1, 1, 2, 1, 0]          // build-manifest が外観の絵から測る: footprint の列ごとに、絵が footprint の上端より上を丸ごと隠す行の数（その草地は芝生に数えない）
    }
  },
  props: { lamp: { src, origin: [ox, oy], solid: [x, y, w, h] | null, light: [x, y, r] | null, flicker: true },
           gate: { src, origin, solid, light, flicker,
                   solids: [[x, y, w, h], ...],  // 省略可。いくつもの当たり（門の柱）。あれば solid の代わり
                   lights: [[x, y, r], ...],     // 省略可。いくつもの灯（門の2つの提灯）。あれば light の代わり
                   opening: [x, y, w, h],        // 省略可。柱の間のくぐれる所（歩ける）
                   size: [w, h] },               // solids か opening があるときだけ: 絵の大きさ（layout が絵のかかる範囲を測る）
           pier: { src, origin, solid: null, light: null, flicker: false,
                   layer: "ground",            // 省略可。人物の下に描く（y でならべない）: 桟橋の板・もやった舟
                   deck: [x, y, w, h] } },     // 省略可。水の上で歩ける板（足元基準の px）
  ground: { street: "street.png", grass: "grass.png", dirt: "dirt.png", plaza: "plaza.png",   // 継ぎ目なしのtexture
            water: "water.png", quay: "quay.png" }                                           // 省略可（水辺）
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
- 人物 `art/game/residents/<name>.png`（4×4、32×32のframe。行は 下・左・右・上、列は 立ち・歩きA・立ち・歩きB）。`keeper-<kind>.png` は番人（kind は module.kind か施設の archetype、`keeper-smith.png` は workshop）→ `characters.keepers[kind]`、`townsfolk-<n>.png` は街を歩く住人、`contractor.png` は外部工務店の代理人 → `characters.contractor`（どれも同じ人物シート）。
- 生き物 `art/game/creatures/<name>.png` と `<name>.json`: `{ "frame": [16,16], "pivot": [8,15], "anims": { "<anim>": { "down": [...], "left": [...], ... } } }` → manifest の `creatures[name] = { src, frame, pivot, anims }`。name は pigeon・pigeon-fly・dog・cat・cat-2（anims: pigeon は idle・peck・hop、pigeon-fly は fly、dog・cat は idle（座る）・stand・walk）。
- 小物 `art/game/props/<type>.png` と `<type>.json`: `{ "origin": [ox,oy], "solid": [x,y,w,h] | null, "light": [x,y,r] | null, "flicker": true, "layer": "ground", "deck": [x,y,w,h], "solids": [[x,y,w,h], ...], "lights": [[x,y,r], ...], "opening": [x,y,w,h] }`（座標は小物の足元＝town.jsonの(x,y)×16 を原点としたpx。`layer`・`deck`・`solids`・`lights`・`opening` は省略可）
  `solids` は当たりをいくつも（門の柱。web/world.js はそれぞれを当たりにし、`solid` は使わない）、`lights` は灯をいくつも（門の提灯。world.lights にそれぞれ入り、web/lighting.js がほかの小物の灯と同じに描く）、`opening` は柱の間のくぐれる所（門の下。layout はその列を歩ける道にする）。足元は門の下辺（柱の足の線）で、人物はそこで y の順に並ぶ（足元より北にいる人は門の絵の後ろ）。
  `layer: "ground"` の小物は地面のすぐ上・人物の下に描く（y でならべない）。`deck` は水の上で歩ける板: そこに掛かる水の tile は板の矩形だけ歩けて、残りは水のまま（web/world.js）。layout は板の上端を岸壁の行の上から4px下に置く。橋の `deck` は通り側の板も含むが、水の tile だけを歩けるようにする。
  layout が場所を取る大きさは tile 単位で、幅 = round(solid.w / 16)、奥行き = ceil(solid.h / 16)（最小 1×1、足元は下辺の中央）。`solids` のある小物（門）は、柱の箱がかかる tile だけ（くぐれる所の列は除く）。井戸小屋 `wellhouse`・足場 `scaffold`（`scaffold-2`）・工事中の札 `sign-works`・材木 `lumber`・桟橋 `pier`（`pier-2`）・橋 `bridge-h`（`bridge-v`）・舟 `boat`・門 `gate` は、絵があるときだけ置く。
- 地面 `art/game/ground/<name>.png`（継ぎ目なし）: street・grass・dirt・plaza・moss は必須。`water.png` は水面（128×128 前後、縦横に継ぎ目なし）、`quay.png` は岸壁の帯（横に継ぎ目なし、上端 = 岸の通りの下端。16px より高ければ下の水の行に続けて描く。透明な所は水が見える）。水辺は船着場の絵と water.png の両方があるときだけつくる。`wall.png` は段（town.terraces）の石垣の前面の石の粒（高さ 16px、横に継ぎ目なし。石の形と明暗は src/ground.mjs が描く）。無ければ広場の石の粒を使う。

## 施設の置き場所（src/layout.mjs）

- 施設は art manifest にその archetype の絵があるときだけ置く。絵が無ければ置かず、merged のモジュールはふつうの建物になる。船着場は water.png もあるときだけ（水辺ごと）。
- 役場は広場の北の真ん中の段（terrace: 役場の幅＋左右1、役場の裏2行から扉の前の2行（前庭）まで）の上に立ち、段の壁は広場に向き、扉の前に3マスの階段（1マスの扉なら扉が真ん中、2マスの扉なら広場の中心の側へ1マス広げる。3マス以上の扉なら扉の幅）。北へ向かう通りは役場の脇を通る。ほかに、すぐ下に通りのある小さな緑地をひとつ段にする（壁は緑地の下の端、2マスの階段を真ん中に）。酒場は広場の東か西のきわで大通りに面する。宿屋は大通り（広場の南の東西の通り）を外から入ってきた端（そこから外へ2行の街道）。道場・倉庫は広場からひとまわり外の、別々の向きの地区。見張り台は外縁。船着場は南の岸の通りに面し、南へ向かう通りの脇（桟橋は扉の近く）。修理小屋は工房の近くに置き、工房が無ければ外縁に置く。
- 井戸（外に立つ施設）は広場のまん中の飾り（南寄り）として井戸小屋を置き、置けなければ左右の寄り、それも無理なら広場に近い緑地。番人は井戸小屋の外側の下の段の歩ける1マスに立ち、そこから街のどこへでも行けることを確かめてから置く。井戸小屋と番人のまわり1マスには木を植えない。
- 門（外に立つ施設、絵 `gate` があるときだけ）は、南北の通りが街の外へ出る土の道（北の通りの上の端・斜めの通りの下の端。finalize の `exits`）のうち宿屋に近い方（宿屋が無ければ北）に、通りをまたいで南向きに立てる。門の行は通りの端から 1〜16 行外で（切り出す範囲は、通りの端の両わき（左右8〜9マス）の建物より外へ、門の絵の高さ＋4行をのこす）、門の外（その先の地図の端まで、絵の幅の左右6マス）に建物・石畳の通り・広場が無い所（街の中の通りの途中には立てない）、絵が建物とその屋根にかからない所、柱が草地に立つ所のうち、通りにいちばん近い所。出口の土道が途中で草地・外に変わっていても、建物・水・舗装で遮られない列だけを門の候補まで土道として延ばす。くぐれる所（opening、3マス）は道の列を包むように置き、包めなければ左右に 1〜2 マスずらして、門の手前の端と門の外の行で元の道へ横につなぐ（門のわきに残る元の道は草に戻す）。門の手前2行（通りの端まで）から門の外の1行までは門の幅の土の道。柱はふさぎ、街のどこからでも門の外まで行けることを確かめる。門番は街の内側の柱のわき（北の門なら柱の1行手前、南の門なら絵の外の横）の歩ける1マスで、門の幅の道には立たない。門の絵と門番のまわり1マスには木を植えず、門の道（手前3行・外2行）には小物を置かない。ほかの街灯は門の灯から離して立てる。置ける所が無ければ門は置かず、`Town.unplaced` に理由と根拠を残す（tools/check-play.mjs はそれを失敗にする）。
- 工事中（module.works.dirty > 0）の建物: 横の壁ぎわの草地に足場（扉の前の2行・通り・路地には置かない、街の通り道をふさがない。横が1マスしかあかなければ、細く置いた足場がその1マスの真ん中に立つ）。その建物の横の1マスの隙間は路地にせず草地のままにする（足場の絵があるとき）。足場の手前か反対側の壁ぎわに工事中の札、裏庭か足場の横に材木（どれも絵と余地があるときだけ）。
- 施設の扉の前（扉の列の左右2マス、扉の列の通り・土・広場が続く所まで。2〜5行）には小物を置かず、施設のまわり（左右2マス、上1行〜扉の前5行）には木を置かない。広場の角の植え込みは、広場に面する建物の扉の前の行には作らない。
- 広場には、もう飾りの井戸（well）を置かない（井戸は env・設定の施設になったので、根拠の無い井戸を見せない）。

## 番人と住人

- すべての建物に、その建物の種類（module.kind）の番人が1人いる。番人は名前のある人物ではなく「工房の親方」「商店の主人」「家の人」「廃屋の管理人」という役で、そのモジュールの事実だけを話す（誰がよく手を入れているか、最近何が変わったか、どんなファイルがあるか）。
- 施設の番人は「役場の書記」「宿屋の番頭」「酒場の主人」「倉庫番」「見張り台の番人」「道場の検査官」「船頭」（船着場）「修理小屋の職人」（修理小屋）で、facility.facts だけを話す。絵は `keeper-<archetype>.png`（characters.keepers[archetype]）。無ければいちばん近い番人の絵（宿屋・酒場→shop、倉庫・船着場・修理小屋→workshop、ほか→house）で立てる。
- 外に立つ施設（town.landmarks）の番人（井戸→「井戸番」、絵は characters.keepers.well、無ければ house。門→「門番」、絵は characters.keepers.gate、無ければ見張り台の番人 watchtower、それも無ければ house）は landmark.keeper に立ち、近づくと建物の番人と同じように話す（web/residents.js LandmarkKeeper）。建物の番人と同じく少しだけ場所をとる（KEEPER_BOX）。
- 門番は「ようこそ。ここは外から旅の人が入ってくる門だよ。」と迎え、gate.facts だけを話す: 旅の人がどこから来るか（看板の住所・公開の段取りの設定・門をあけ閉めするサーバーのファイル、2つまで）、外から声をかけられる受付の数と例（道の名前2つ）、ログインの道具が道具の一覧に載っていること（あるときだけ）。最後に必ず「でも、本当に外から入れるかは、ここでは確かめていないんだ。」と言う。
- 井戸番は設定の名前・見本のファイル・読み込む道具・CI の鍵の名前だけを話し、値は知らないと言う。記録された本物の env ファイルがあれば「秘密の鍵が入っているかもしれないファイル（.env）が記録に入っています。」とやさしく知らせる。船頭は積んであるアプリ・荷札（名前と版）・出港の手順を話し、船が本当に出たかは分からないと言う。
- 修理小屋の職人は、証拠の種類ごとにデプロイの切り戻し・DB の戻し・バックアップの復元・復旧手順書を短く話す。ただし、証拠があることは手順を実行して戻せることの確認ではないので、最後に「本当に戻せるかは、ここでは確かめていないんだ。」と言う。
- 役場の書記は「まだ記録していない変更が N 個あります」（town_hall.facts.dirty）と、外部工務店の工事報告（town_hall.facts.agents）を話し、報告は自己申告で、動くかは道場で（道場が無ければ動かして）確かめると言う。module.works.dirty のある建物の番人は「工事中」と、その数を話す。
- 酒場の主人は最後に「ここは接続者ギルドだ。名簿を見ていくかい？」と言い、その下に「名簿をみる」が出る（クリック・タップ・Enter・Space）。名簿は町の上に開く窓で、ページは なかま（相手・どうして分かったか・場所）・うけつけ（routes）・いらい（webhook と、コードから使いを出す相手）・もちもの（鍵の名前・取り決めの書類・AI への頼み方）・じょうたい（「つながるか確かめたことはありません（未確認）」・鍵の名前が見本にあるか・見張り台があるか）。空のページはそう書く。← → か Q・E でページ、Esc・× で閉じる。開いている間も ↑ ↓ と WASD では歩け、酒場の主人から離れると閉じる。
- 外部工務店（town.contractors）は1つにつき代理人が1人、homes の建物のあいだを住人と同じように歩く（絵は characters.contractor、無ければ townsfolk の姿）。吹き出しは「<名前> ─ 外部工務店の代理人です」「この街で最近90日に N 件の工事に名前があります」「工事の報告は自己申告です」「動くかどうかは道場で確かめてください」（数は本当の数だけ）。
- 常連（town.crowd）は townsfolk の姿（`look % townsfolk数`）で、自分の建物の近くを歩き、ときどき広場やほかの建物の扉へ行き、立ち止まって見回し、二人で向かい合って立ち話をする。吹き出しは「◯◯の常連」と、その建物の本当の事実をひとつだけ言う。
- コミットした人は townsfolk の姿で街を歩く（`look % townsfolk数` で姿を選ぶ）。番人と同じ人物が二重に現れることはない。
