# Fable5 キャラクタースプライト生成 — Codex実行ブリーフ

> 作成: 2026-07-29。アートパイプライン引き継ぎ担当エージェントが、Codex(image_gen内蔵)にキャラクタースプライト生成作業をそのまま引き継げる状態にするために作成した。
>
> **本ドキュメントの立ち位置**: `docs/fable5-codex-sprite-handoff.md`(observed/inferred/unknown形式の短い状態台帳、既存)を置き換えない。本ドキュメントは実行用の詳細ブリーフで、そちらより長く、コピー貼り付け用のプロンプト本文と、実際にコマンドを実行して得た検証結果を含む。
>
> **検証方針**: このリポジトリの `docs/` 配下や契約JSONは過去に実態と乖離した主張をしてきた前例がある(虚偽の完了報告、承認済み原画の無断差し替え)。そのため本ドキュメントに書かれている事実は、原則として「実際にコマンドを実行した結果」「実際に画像をこの目で見た結果」「実際にコードを読んで確認した結果」のいずれかであり、そうでない場合はその旨を明記する。

## 0. 背景と目的 — 見失ってはいけない北極星

このプロジェクトの最終目標は、`docs/qa/evidence-matrix.md` のルーブリックで **合計85点以上**、かつ **Hard Gate 10個(HG-01〜HG-10)全PASS** を達成した、実際に遊んで気持ちのいい2DピクセルアートRPGである(この閾値と10個という数は `docs/qa/evidence-matrix.md` を実際に読んで確認した実数であり、伝聞ではない)。製品オーナーが最重視するのは「ゲーム体験の気持ちよさ」であって、テスト件数やドキュメントの整合そのものではない。

キャラクタースプライトの作り直しが直接効くルーブリック項目は次の2つで、**現状どちらも `UNKNOWN`(未評価)**:

| 項目 | 配点 | 要求内容(原文ベース) |
|---|---|---|
| A4 | 8点 | Material/pixel/projection/lighting coherence — 単一の密度/投影/輪郭/光源言語、整数倍のクリスプなレンダリング、接地、明白な5×5繰り返しの禁止、renderer全体で一貫したLUT/AO/halo/vignette |
| B1 | 11点 | Natural four-way movement — 専用の4方向、east/westが鏡像でないこと、idle 2枚+本物の歩行6枚+interact 2枚、facing差分は1フレーム以内、idle切り替えは150ms以内、pivotドリフトは2px以内 |

さらに Hard Gate `HG-05`("Four-way movement is visibly natural, not frame-count theater")も同じ領域に直結しており、現状 `UNKNOWN`。つまり「メカニカルチェックさえ通れば良い」のではなく、**見た目として自然に動いて見えること**がゲート要件そのものに含まれている。

なぜ今スプライトを作り直すのか: プレイヤー/NPCスプライトが背景と画風不一致であることが、公式ルーブリックA4の主要失点として記録されている。加えて、`tools/asset-forge` は画像生成器ではなく「契約・検収・出自管理ツール」として設計されている——過去に、承認済み原画が無断で生成画像に差し替えられた前例、Codexが虚偽の完了報告をした前例があったため、実際の絵は必ず外部セッション(=今回のCodex)で作り、ハッシュ検証つきで取り込む、という設計になっている。

製品オーナーの確定済み判断(このブリーフが前提とするもの):

1. 背景は prefab 再構成方式で実装済み(本ブリーフの対象外)。
2. 建物はまず宿屋1棟の体験を完成させてから横展開(本ブリーフの対象外、他エージェント領域)。
3. **スプライトはCodexの image_gen で生成する(このブリーフの対象)。**
4. 音声は最後(実装済みだが優先度は低い、本ブリーフの対象外)。

現在の状態(2026-07-29、オーケストレーターが実測): ゲームは起動すらせず、"PRODUCTION GATE / 必要な画像が揃っていません" という画面と `Cannot read properties of undefined (reading 'muted')` というJSエラーが出る。これは `public/fable5-v2/` と `test/` を担当する別エージェントの作業対象であり、本ブリーフの範囲外。本ブリーフは「Codexにスプライトを作らせ、asset-forgeの検収を通すところまで」を範囲とする。**絵の実生成、承認、runtimeへの組み込みはこのブリーフの範囲外。**

過去の履歴(状態台帳 `docs/fable5-codex-sprite-handoff.md` および `docs/current-state.md` に記載、実ファイルでも確認済み): 旧innkeeper 4×10バインディングは画風authorityの差し替えにより `withdrawn`。宿屋のcustomer-facingルートも人間レビューが揃うまで閉鎖中(他エージェント領域)。新しい4キャラクター(player / innkeeper / town clerk / resident)の候補はすべて `pending-human-review` のまま——runtime配線、promotion、approvalは一切なされていない。

## 1. 前提となる地上の真実(本ドキュメント作成時に実際に検証した事実)

以下は全て、このブリーフの作成中に実際にコマンドを実行する・画像を目で見る・コードを読むことで確認した事実である。文書の主張をそのまま書き写したものではない。

### 1.1 画風authority画像

- `art/references/user-provided/character_style_authority_20260722_v1.png` は実在する(`ls -la` で確認)。
- SHA-256を実測: `446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`。`art/contracts/user-provided-images.json` のレコード、および各contract-draft.json内の記載と完全一致(実測して突き合わせた)。
- 1402×1122px、8-bit RGB(アルファチャンネルなし、`file`コマンドで確認)。
- **実際にこの目で見た内容**(4行×10列、magentaクロマキー背景のシート。既存の画風グラフィックそのものであり生成物ではない可能性が高い——ファイル名・出自は「codex-clipboard」を経由したuser-directコピーとlegderに記録): 老年男性1名。頭身は2.5〜3頭身程度のちびキャラ比率、頭部が大きい。銀髪でやや乱れた短髪、顔の下半分を覆う豊かな銀髭。肌は淡いベージュ。目は最小限の描写(黒いアーモンド形+小さな白ハイライト1点のみ、瞳孔や眉の描き込みなし)。衣装はセージグリーン(深緑がかった緑)のローブ、V字の胸元と袖口にマスタードゴールドのトリム、その下にクリーム色のアンダーレイヤー(前面に見える、エプロンのような丈)、ウエストにゴールド/タン系のベルトまたはサッシュ(小さな巾着かポーチが下がっている)、ローブの裾の下に紺色のズボン、こげ茶〜黒に近い靴。シルエット全体と主要な色面の境界には連続した濃色(純黒ではなく、やや暖色寄りの黒に近い色)の輪郭線。陰影はハイライト/ベース/シャドウのおよそ3段階だが、輪郭・塗りともにやや柔らかい(アンチエイリアス寄りで、ハードエッジのドット絵ではない)。足元に落ち影の描き込みなし。
- **今回新たに発見した重大な事実(既存ドキュメントのどこにも書かれていなかった)**: このauthority画像自体のrow2(4行中3行目、south/west/east/northの並びで言えば "east" に相当する位置)は、独立して描かれた東向きポーズでも、west行の水平ミラーでもなく、**west行(row1)とほぼ同じ左向きシルエットの複製**になっている。
  - 定量検証: row1とrow2の対応walkフレームをそのまま比較した平均ピクセル差分は32.9。同じフレームを一度左右反転してから比較すると差分は65.4に拡大する(反転した方が遠くなる=反転無しの方が近い、つまり「反転」ではなく「向きの複製」である)。
  - 目視検証: row1・row2・row1を反転したものを並べたところ、row2は明らかにrow1と同じ左向きで、反転版(右向き)とは似ていない。
  - この事実は、後述する「よくある失敗と回避法」および各キャラのプロンプトに反映済み。**Codexはこの画像のrow2を「eastの描き方の見本」として絶対に使ってはならない。**row0(south)とrow3(north)は見本として問題ない。

### 1.2 背景(target-town)画像

- `public/fable5-v2/assets/world/target-town-user-direct-v1.png` は実在する。SHA-256実測 `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607` は `art/references/user-provided/target-town.png` および lineage JSON の記載と完全一致(byte-identicalコピーと明記されている点も確認)。1586×992px。
- **実際にこの目で見た内容**: たそがれ(dusk/twilight)の町並みを俯瞰した、密度の高い絵画的(HD-2D的)な1枚絵。石畳の広場、時計塔のある建物、井戸、街灯、家々。窓や街灯には暖色(amber)の灯りが灯り、それ以外の環境は石・瓦屋根・葉群を中心とした低〜中彩度の寒色寄り(スレートブルー、チャコール、モスグリーン、こげ茶)でまとめられている——**彩度は環境側は控えめ、光源周辺だけが暖色で高彩度**、というメリハリ。
- **光源方向を実際に建物の陰影から測った**: 妻壁・瓦屋根の面ごとの明暗を複数箇所(時計塔前の建物群、右側の家並み)で確認したところ、画面手前左寄りを向く面がわずかに明るいスレートブルー、奥・右を向く面がより暗い紺〜ほぼ黒の陰、という一貫した傾向。これは左上前方寄りからの柔らかい環境光と解釈でき、既存のcontract-draft内の "twilight upper-left light" という記述と一致する——ただしこれは他人の記述をそのまま採用したのではなく、自分で複数箇所を見比べて独立に確認した結果である。
- **背景内に実際に人影が2体描き込まれている**(井戸のある広場付近)ことを発見し、クロップして拡大確認した。これらはcharacter-style-authorityよりもずっと小さく、輪郭線も薄く、柔らかい絵画的タッチで描かれている——スタイルが明確に異なる。既存のcontract-draftは「target-townは陰影/光源の参照のみで、キャラクターの画風authorityではない」と明記しており、この優先順位を尊重して、**このブリーフはtarget-town内の人影を画風の見本として使わない**よう明記した(共通プロンプトに追記済み)。

### 1.3 コマンドの動作検証(既存ドキュメントの誤りを発見・修正)

- 既存ドキュメント7箇所(`docs/fable5-codex-sprite-handoff.md`、`character.player.prompt-draft.md`、`tools/asset-forge/contracts/fable5-prefab/README.md` 内5箇所)に書かれていた `npm run make-fable5-character-job -- --asset <id> --dry-run` を**リポジトリルートでそのまま実行し、実際に失敗することを確認した**(`npm error Missing script: "make-fable5-character-job"`)。理由: このスクリプトはリポジトリルートの `package.json` ではなく `tools/asset-forge/package.json` にしか定義されていない。
  - 正しい実行方法: `tools/asset-forge/` に `cd` してから実行するか、リポジトリルートから `npm --prefix tools/asset-forge run make-fable5-character-job -- --asset <id> --dry-run` を使う。
  - 両方の形式を実際に実行して修正を確認した。本ブリーフが指示するコマンドはすべてこの検証済みの正しい形式を使う。
  - 影響範囲(このブリーフ作成中に修正済み): `docs/fable5-codex-sprite-handoff.md`、`tools/asset-forge/prompts/fable5-prefab/character.player.prompt-draft.md`、`tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md`(新規に明記)、`tools/asset-forge/contracts/fable5-prefab/README.md`(冒頭に一括注記)。
- `make-fable5-character-job --dry-run` を4キャラ全て(`char_player`, `char_innkeeper`, `char_town_clerk`, `char_resident`)について実際に実行し、すべて正常終了することを確認した。各ジョブがsole authority(画風authority画像)とtarget-town(陰影参照)の両方を正しく参照していることも出力JSONで確認済み。
- `import-fable5-character` の実装(`tools/asset-forge/src/fable5-prefab-character-intake.mjs` の `inspectFable5PrefabCharacterCandidate` 関数)を実際に読み、さらに**このリポジトリに既に存在する過去のimage_gen生成候補4体**(`tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_{player,innkeeper,town_clerk,resident}-alpha.png` — すべて `pending-human-review`、未承認、promotion禁止)に対して、この検証関数を実際に実行した(直接関数呼び出しと、実際のCLI `import-fable5-character --dry-run` の両方で再現)。結果:
  - **4体中4体がpivotチェックで失敗**(各9〜13セル、40セル中)。特に列8-9(interactポーズ)がほぼ全キャラで失敗しており、最も頻出する失敗パターンだった。歩行フレームの一部(足が地面から離れる中間フレーム)でも失敗が見られた。
  - `eastNotExactMirrorOfWest` チェック自体は4体中4体で「合格」と判定された。ただしこれは、このチェックが「ピクセル完全一致の水平ミラー」しか検出しない狭い実装だからだと分かった——実際に目視・統計比較すると、4体中3体(town-clerk, resident, および元のauthority画像自体)はeast行がwest行の反転にかなり近く、生成直後のraw出力ではむしろ逆にwest行と同じ向きの複製になっていた(3/3の実generation例で再現)。**「メカニカルチェックが通った」は「eastが正しく描けている」の証明にはならない**——これは今回コードを実際に動かして初めて分かった、既存ドキュメントに書かれていなかった知見。
  - innkeeper候補は、authority画像の人物(=player)とほぼ同一人物(同じ髪色・髭・ローブ)になっており、「別人格であること」という要件を満たしていなかった。一方town-clerk/resident候補は別人格として成立していた(同じ失敗が全NPCに起きるわけではない、避けられる失敗であることも確認)。
  - これらの候補ファイルは削除・変更しておらず、誰でも同じ検証を再現できる(コマンドは6章に記載)。
- `node art/contracts/verify-user-provided-images.mjs` を実行し `"status": "pass"` を確認した。
- `npm --prefix tools/asset-forge test` のベースラインを編集前に取得: **237件中235 pass / 2 fail**。
  1. `test/fable5-prefab-character-jobs.test.mjs` の1件は、組み立て済みプロンプトに `Explicitly excluded:` という文言が存在することを期待していたが、既存のprompt-draftにその文言がなく失敗していた。
  2. `test/reference-integrity.test.mjs` の1件は、withdrawn(取り下げ済み)のinnkeeperの残留ファイルに関する既存の不整合で、キャラクタースプライトのプロンプト作業とは無関係。
  今回のプロンプト改訂(4章参照)で1.の文言を自然に含めたため、**編集後に再実行し236 pass / 1 failに改善したことを実際に確認した**(2.は本ブリーフの担当範囲外として手を付けておらず、そのまま残っている——withdrawn innkeeperの残留ファイルは他エージェントの承認記録に関わるため、無関係な副作用を避けるためあえて触れていない)。新規に発生させた失敗はゼロ。
  - 参考: `npm --prefix tools/asset-forge run make-fable5-character-job -- --asset char_innkeeper`(dry-runなし)を検証目的で1回実行し、`generated/jobs/fable5_prefab_char_innkeeper_7f3dfba557d56047fc66/` が作成された。これは検証用の副産物であり、プロンプト編集後は promptSha256 が古くなるため削除する(本ブリーフ完成時に削除済み)。

## 2. 生成すべきシートの厳密仕様

`Fable5PrefabSpec.md` 第6節・第7節が正本(実ファイルを読んで確認)。以下は全キャラ共通。

| 項目 | 値 |
|---|---|
| ファイル形式 | PNG、RGBA(アルファ必須) |
| シート全体サイズ | **640×512px、ちょうどこのサイズ**(1pxのずれも不可。後述） |
| グリッド | 4行×10列、隙間・余白・枠線なし |
| セルサイズ | 64×128px(40セル、すべて独立して切り出し可能） |
| 可視身長の目安 | セル内で約72px(頭上・足元に余白を残す） |
| footPivot | **全フレーム例外なく (32, 120)**(セル左上を原点とする座標。詳細は下記） |
| 行の並び順 | row0=south(正面) / row1=west(左向き) / row2=east(右向き) / row3=north(背面) |
| 列の割り当て | 列0-1: idle(4fps) / 列2-7: walk 6フェーズ(10fps) / 列8-9: interact(6fps、会話・作業共用) |
| east行 | **west行の独立描画。ミラー禁止、かつ「反転していないだけの複製」も禁止**(下記1.1・5章参照) |
| 背景 | 完全透過(true alpha)。文字・枠・番号・チェッカーボード・ウォーターマークの焼き込み禁止 |

### footPivot(32,120)の正確な定義(実装コードを読んで確認した仕様)

`tools/asset-forge/src/fable5-prefab-character-intake.mjs` の `pivotProblem` 関数が実際の検収基準。各64×128セルの**下部16px帯(セル内y=112〜127)**について:

1. y=120の行(セル内座標)に不透明(alpha>0)ピクセルが最低1つ必要。歩行途中で足が浮いているフレームや、リサイズで全体が1px縦にずれた場合、ここが0になって「no opaque sole pixels at the pivot row」で即座に不合格になる。
2. その下部16px帯にある不透明ピクセル全部のx座標平均が **32±2(x=30〜34)** の範囲に入っている必要がある。片足立ち・後ろ足が伸びた歩行フレーム・横にずれた足など、下半身のシルエット全体の重心がこの範囲から外れると不合格になる。

**このリポジトリに実在する過去の生成候補4体は、この検査で4体とも不合格だった**(実際に検証済み、1.3節参照)。「だいたい足元にいる」ではなく、軸足のつま先/かかとの接地点を意識してx=32・y=120に正確に乗せること。

### east行の「独立描画」の正確な意味

2つの異なる失敗パターンが両方観測されている(1.1節・1.3節):

- (a) west行を水平反転しただけのeast — 持ち物・非対称な衣装ディテールが逆側になる。
- (b) west行と同じ向きのまま複製されたeast(反転すらしていない)— 実際の生成で最も多く見られたパターン。メカニカルチェックは「反転」しか検出しないため、**この失敗はすり抜ける**。

どちらも不可。east行は「体が右(画面奥から見て東)を向いている」ことを新規に描き、目視で確認すること。

### 透過の正確な条件

同じ検査は、シート四隅が完全透過(alpha=0)であること、かつ不透明(alpha>0)で色が正確に (255,0,255) のピクセルが1つも無いことを要求する。これは「見た目上透明ならOK」ではなく、ソフトな縁取り(アンチエイリアスでうっすらマゼンタや灰色が残る)は、色がちょうど255,0,255でなければこの狭いチェックをすり抜けてしまう——見た目に縁の色残りが無いか、400%以上にズームして人間の目でも確認すること。

### 出力サイズが640×512ちょうどにならない場合

`inspectFable5PrefabCharacterCandidate` はサイズが1pxでも640×512と異なれば即不合格にする(自動リサイズは行わない)。多くの画像生成ツール(image_gen系を含む)は固定のプリセットサイズしか選べず、640:512(=5:4)にちょうど一致するものは少ない。生成後、必ず以下の手順で明示的にリサイズすること:

1. 5:4に最も近いランドスケープ(横長)サイズで生成する。
2. 5:4ちょうどでなければ、トリミングや不均等な引き伸ばしをせず、パディング(レターボックス)で5:4に合わせる。不均等な引き伸ばしは画風authorityに対するプロポーションを崩し、メカニカルチェックを通っても人間レビューで確実に弾かれる。
3. 640×512へは縦横同じ倍率で、nearest-neighbor(またはbox)フィルタでリサイズする——bicubic/lanczosはエッジを滲ませ、footPivotのy=120行のずれを招く。
4. リサイズ後、実際に640×512ちょうど・RGBA・実アルファであることを再測定してから取り込み手順(6章)に進む。

## 3. 対象4キャラの identity 仕様

4キャラすべてに共通: 画風authority画像 `art/references/user-provided/character_style_authority_20260722_v1.png`(SHA-256 `446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`)が唯一の画風/識別権威。1.1節に記載した「実際にこの目で見た特徴」(2.5〜3頭身、大きな頭、最小限の目の描写、連続した濃色輪郭線、3段階程度のやや柔らかい陰影)が、4キャラ共通で守るべき「作画文法」。

| キャラ | identity要件 | 備考 |
|---|---|---|
| `char_player` | authority画像の**直接的な視覚的派生**。同一人物・同一の顔・年齢・プロポーション・輪郭・陰影言語を40セル全てで維持する。方向とアニメーションフェーズのみ新規に描く | 老年男性、銀髪・銀髭、セージグリーンのローブ、という具体的な人物そのものを再現する |
| `char_innkeeper` | authority画像とは**別人格**。作画文法(頭身・輪郭・陰影段数)だけを継承し、顔・髪・衣装は別人にする | **過去の生成候補がこの要件を満たさず失敗した実例あり**(1.3節)。playerと同一人物にならないよう明示的に注意 |
| `char_town_clerk` | 別人格。行政職らしい端正なシルエット、台帳/書類を模した仕草は役割記号として許可(必須ではない) | 過去候補は別人格として成立していた(良い前例) |
| `char_resident` | 別人格。非戦闘の一般町民、読みやすい日常シルエット | 過去候補は別人格として成立していた(良い前例) |

各キャラの詳細な人物像・衣装案は、次章のプロンプト本文中の該当セクションに展開済み(`tools/asset-forge/prompts/fable5-prefab/character.*.prompt-draft.md` を実際に編集した内容そのもの)。

## 4. コピー貼り付け用プロンプト本文(そのまま image_gen に渡せる)

以下の4ブロックは、`tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md`(共通仕様。今回の調査で得た知見を反映済み)と、各キャラの `character.*.prompt-draft.md`(今回書き上げた内容)を、実際に以下のコマンドで機械的に連結して得たテキストをそのまま転記したものである(手で書き写したものではない。ドキュメントとファイルの間で内容がずれないよう、生成のたびにこのコマンドで再取得できる):

```sh
cd tools/asset-forge
npm run make-fable5-character-job -- --asset char_player --dry-run       # 他: char_innkeeper / char_town_clerk / char_resident
```

出力JSONの `promptText` フィールドがそのプロンプト全文。`--dry-run` を外して実行すると `generated/jobs/<job-id>/prompt.md` としても同じ内容が保存される(ピクセルは生成しない、テキストのみ)。

各キャラのプロンプトは長い(250〜290行)。image_gen呼び出しのプロンプト長に制限がある場合は、「Sole identity and style authority」「Per-row content」「Negative constraints」の3節を最優先で残し、boilerplate的な「Route to a real candidate」節(このツール自体の使い方の説明で、画像生成そのものには不要)は省略してよい——ただし何を省略したかは検収時に分かるようにしておくこと。

### 4.1 char_player(プレイヤー)

```markdown
# Fable5 prefab character sheet — common spec (draft)

> Status: draft, not wired into any asset-forge job yet. This file exists so a future
> `make-job` / `make-job-v2` prompt assembly, or a manually-run external generation session,
> has one canonical text to include. It supersedes `prompts/v2/characters/animated-character.md`
> (48x96 frame, idle2+walk4+talk2+work2) for any character that must match the current
> `Fable5PrefabSpec.md` section 6/7 contract. It does not delete or edit that older file.

Authority: `Fable5PrefabSpec.md` section 6 (Character) and section 7 (Asset Contract), repo root.

## Canvas and pivot

- Frame canvas: **64x128** pixels. Visible body height: about **72px**, vertically placed so the
  character reads as standing on the frame's own baseline.
- Foot pivot: **(32, 120) in every frame of every character, with no exception.** This is
  `Fable5PrefabSpec.md`'s N6 acceptance check. If a generated frame's sole does not land on
  that pixel after processing, the frame fails, full stop — do not average, do not "close enough".

### Exactly what the pivot check tests (read this before drawing feet)

`tools/asset-forge/src/fable5-prefab-character-intake.mjs` (`inspectFable5PrefabCharacterCandidate`,
function `pivotProblem`) is the real mechanical gate every candidate must clear on import. Per
64x128 cell it does two independent things, both on the lower **16-pixel band, y=112..127 of that
cell**:

1. Requires at least one opaque (alpha>0) pixel exactly on row **y=120**. A frame where the
   drawn sole sits at y=118 or y=122 — very common in a mid-stride "foot lifted" walk phase, or
   after a naive resize shifts everything by a pixel — has **zero** opaque pixels at y=120 and is
   rejected with "no opaque sole pixels at the pivot row", independent of how good the frame looks.
2. Computes the mean x of every opaque pixel in that same y=112..127 band and requires it to fall
   within **32±2 (x=30..34)**. This is a centroid over the whole lower-leg/foot silhouette, not a
   single point — a wide stance, a trailing back foot, or a foot that has drifted sideways during a
   walk-phase redraw all pull this number away from 32.

This is not a theoretical risk: **every one of the four historical candidate sheets already sitting
in this repo failed this exact check when run through the real `import-fable5-character` command**
(evidence in the "Failure evidence from this repo's own history" section below). Draw every frame
with the standing/contact foot's sole deliberately centered under x=32 and touching y=120, then
check it — do not eyeball it after the fact.

## Sheet layout

One character = one PNG, **640x512**, laid out as a strict 4-row x 10-column grid of 64x128
cells with no gaps, borders, labels, or frame numbers baked in:

| row | direction | col 0–1 | col 2–7 | col 8–9 |
|---|---|---|---|---|
| 0 | south (facing the viewer) | idle x2 | walk x6 | interact x2 |
| 1 | west | idle x2 | walk x6 | interact x2 |
| 2 | east | idle x2 | walk x6 | interact x2 |
| 3 | north (facing away) | idle x2 | walk x6 | interact x2 |

- idle plays at 4fps, walk at 10fps.
- interact's 2 frames are shared: the runtime reuses the same pair for talking and for working
  poses. Do not draw two different sub-poses hoping to split them later — the contract only
  reserves 2 columns for this row segment.
- **East is never a mirror of west, and east is never the same silhouette as west facing the same
  way either.** Draw it as its own pass, actually turned to face the opposite direction. Two
  distinct failure shapes have both been observed from real generations against this exact spec
  (see evidence below): (a) a horizontally-flipped west strip, which puts tool/prop hands and
  asymmetric costume details on the wrong side; (b) an **unflipped duplicate** — west and east
  both still facing left/west — which is arguably the more common failure in practice and is
  *not* reliably caught by the mechanical "exact mirror" check (that check only fires on a
  byte-perfect horizontal flip; an unflipped duplicate, or a redraw that merely resembles one,
  passes it while still being completely wrong). After generating, a human must look at row 2
  (east) directly and confirm the character's nose/torso/lead foot actually point right/east —
  do not infer this from "the mechanical check passed."

### The style-authority reference image itself has this exact defect — do not copy its row 2

`art/references/user-provided/character_style_authority_20260722_v1.png` is the sole style/identity
authority (see the per-character prompt for how strictly), but its own row 2 (the position that
would be "east" in a 4-row south/west/east/north sheet) is **not** an independently-drawn or even
mirrored east pose — it is, by direct visual and pixel comparison, the same west-facing silhouette
as row 1, not turned around. Do not treat that row as an example of what east should look like, and
do not let a generation session "match the reference" by reusing that row's content or direction
for the east row of a new sheet. Row 0 (south) and row 3 (north) in the reference are fine to use
as directional examples; row 2 is not.

## Identity discipline

- Every direction and every frame of one character must read as the same individual: same face,
  age, head size, hair, palette, silhouette, and any carried object or costume asymmetry.
- Only camera angle and walk/idle/interact phase may change between cells. Do not let the
  generator "improve" the proportions, add accessories, or drift the palette between directions —
  that is the single most common way a multi-call generation session fails identity continuity.
- Which reference image supplies that identity, and how strictly, is asset-specific — see the
  per-character prompt file, not this shared one.

## Matching the world

- Lighting and material language must match `target-town-user-direct-v1.png`
  (`public/fable5-v2/assets/world/target-town-user-direct-v1.png`, byte-identical to
  `art/references/user-provided/target-town.png`, SHA-256
  `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`): light from the upper-left
  at twilight, charcoal / slate-blue / desaturated moss-green / weathered-brown / cold-stone
  ambient tones, restrained warm-amber accents only at light sources. Use 2–3 shading steps per
  material, crisp pixel clusters, and a 1px dark contour where the silhouette needs separation
  from that background. A correctly-shaded character dropped onto that exact background should
  not look like it was lit from a different scene.
- This is a density/contrast match, not a recolor: keep the character's own identity palette
  (see the per-character prompt) and adjust shading *steps*, not hue, to sit in the same light.
- `target-town-user-direct-v1.png` also contains a few tiny human figures painted directly into the
  scene (e.g. near the well/plaza). Those are environment dressing at a much softer, smaller, far
  less outlined rendering than the character-style authority — they are not an alternate style
  authority and must not be imitated. Match that background's *light direction and shading-step
  density* only; keep the character's own crisp bold-contour chibi construction from the style
  authority image.

## Generation-image mechanics (not the finished asset)

- Request a flat, uniform, high-saturation chroma-key background (or true alpha transparency if
  the provider supports it) so each frame can be isolated. This chroma background is scaffolding
  for post-processing, not part of the style brief above.
- Explicitly excluded: text, watermark, sheet border, checkerboard, ruler, caption, frame numbers,
  UI chrome, or any second character/figure sharing a frame — anywhere in the image.
- Nearest-neighbor-safe pixel art: hard edges, no soft anti-aliased gradients, no photographic
  texture.

### Output size vs. the exact 640x512 requirement

`inspectFable5PrefabCharacterCandidate` (same file as the pivot check) hard-rejects any candidate
whose PNG is not **pixel-exact 640x512** — `candidate dimensions must be 640x512` — with no resize
step of its own. Most image-generation tools (including built-in `image_gen`-style tools) offer a
fixed menu of output sizes rather than an arbitrary WxH, and none of the common presets are exactly
the 640:512 (5:4) ratio this sheet needs. Plan for a **separate, explicit resize step before
import**, not as an afterthought:

1. Generate at the largest size available whose aspect ratio is closest to 5:4 (1.25) landscape.
2. If that size is not exactly 5:4, pad (letterbox) to 5:4 first — do not crop into the character
   and do not stretch non-uniformly. A non-uniform stretch changes the character's proportions
   against the style authority and will visibly fail human review even if it happens to pass the
   mechanical checks.
3. Resize the padded image down to exactly 640x512 with a single uniform scale factor, using
   nearest-neighbor or box filtering (not bicubic/lanczos — those blur hard pixel edges and can
   shift the foot silhouette off the exact y=120 pivot row described above).
4. Re-measure the result before importing: it must be exactly 640 wide and 512 tall, RGBA, with
   real alpha (not just visually-transparent-looking pixels — see the next section).

### Transparency has to be real alpha, not "looks transparent"

The same mechanical check also requires all four sheet corners to be fully transparent
(alpha=0) and rejects any pixel that is still opaque *and* exactly chroma magenta (R255 G0 B255).
A soft/anti-aliased chroma-key removal that leaves a faint magenta or gray fringe around limbs will
often still pass this narrow byte-exact check (the fringe pixels are rarely exactly 255,0,255) while
looking visibly wrong — so, again, do not rely on the mechanical pass alone; look at the edges of a
few frames at 400%+ zoom for keying residue before treating a candidate as ready for review.

## Failure evidence from this repo's own history (read before your first generation)

This is not a hypothetical checklist — it is the outcome of literally running this repo's real
mechanical validator (`inspectFable5PrefabCharacterCandidate`) against the four candidate sheets
already sitting in `tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/`
(`char_player-alpha.png`, `char_innkeeper-alpha.png`, `char_town_clerk-alpha.png`,
`char_resident-alpha.png` — built against this exact style authority, still `pending-human-review`,
never approved, never promoted):

- **4 of 4 failed the pivot check**, each with 9–13 failing cells out of 40. Columns 8 and 9 (the
  interact pose) failed on nearly every one of the four sheets — a reaching/gesture pose shifts
  weight off-center far more easily than a neutral idle or a mid-walk stride does. A few walk-cycle
  columns failed too, from the mid-stride "foot briefly airborne" phase landing no opaque pixel on
  y=120. **Budget real attention for the interact pose's foot placement specifically** — it is the
  single most common failure across every historical attempt.
- **3 of 3 real `image_gen`-produced NPC candidates (innkeeper, town clerk, resident — the player
  candidate was a direct crop of the authority image, not a fresh generation) reproduced the
  west/east duplication defect** described above: their raw generation output's row 2 read as the
  same facing direction as row 1, not independently turned. By the time those raw outputs were
  cropped/resized into the final 640x512 candidates, the west/east relationship had shifted to read
  closer to a mirror instead — still wrong, just wrong in the other, mechanically-checked way. Don't
  assume a resize/crop pass will fix a directionally-wrong east row; get it right at generation time.
- **The historical innkeeper candidate failed identity distinctiveness**: it is, by direct visual
  comparison, essentially the same face/beard/hair/robe as the style-authority image (i.e., the same
  person as the player), not a distinct individual using the authority only for pixel density,
  proportion, and shading language. The town-clerk and resident candidates from the same batch did
  keep a distinct identity (different hair, face, and costume from the player), so this is an
  avoidable, not inherent, failure — see `character.innkeeper.prompt-draft.md` for the specific
  guard against it.

None of these four historical candidates are promoted, approved, or usable as a reference — they
remain `pending-human-review` quarantined evidence. They are cited here only as ground truth for
what to avoid; do not import, promote, or visually copy from them.

## Boundary reminder

A generated image produced from this prompt is a **pending candidate only**. It is not approved,
not identity-verified, and not game-ready until a human inspects it against the identity source,
runs it through the Fable5-specific job/intake commands below, and it clears human review. Do not
claim completion from generation alone.

All `npm run <fable5-*>` commands referenced by the per-character prompt files must be run from
inside `tools/asset-forge/` — e.g. `cd tools/asset-forge && npm run make-fable5-character-job --
--asset char_player --dry-run`, or equivalently `npm --prefix tools/asset-forge run
make-fable5-character-job -- --asset char_player --dry-run` from the repository root. There is no
script of that name in the repository-root `package.json`; running it from the repo root without
`--prefix` fails with `npm error Missing script`. (Verified by actually running both forms.)

# char_player — Fable5 prefab sheet (draft prompt)

> Status: draft, not generated. Pair with `00_common_fable5_character_sheet_style.md` and the
> contract at `tools/asset-forge/contracts/fable5-prefab/character.player.contract-draft.json`.

## Sole identity and style authority (must not drift)

The only permitted player identity and character-style authority is the exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`). The job pack must verify
the same path and digest in `art/contracts/user-provided-images.json` before generation.

`char_player` must be a direct visual derivation of that exact image. Preserve the same individual,
visible identity, face, apparent age, proportions, silhouette, pixel density, contour language,
palette logic, and shading language across all 40 cells. Only the required camera direction
(south/west/east/north) and idle/walk/interact phase may be invented; the person must not change.

Do not use a prior player, NPC, generated sheet, deployed asset, candidate, or prompt as a visual
reference, comparison authority, derivation input, or runtime-promotion source. Historical
candidates remain quarantined records only; they are not alternate variants to reconcile.

### What the authority image actually shows (observed directly, useful if the reference can't be attached, or as a cross-check against it)

An elderly man, chibi/SD proportions (roughly 2.5–3 heads tall, oversized head, short limbs).
Silver-gray hair in a short, slightly tousled/uneven coif, and a full gray beard covering the whole
lower face and jaw (no visible mouth). Pale skin. Eyes are minimal: simple dark almond shapes with
one small light highlight dot each, no rendered pupil/iris detail or eyebrow linework. Clothing: a
sage/forest-green robe with long sleeves, a mustard-gold trim/piping running down the V-shaped front
opening and at the sleeve cuffs, worn open over a cream/off-white under-layer that shows at the
center front like an apron and hangs to roughly mid-thigh; a gold/tan belt or sash at the waist with
a small dark pouch or tool hanging at the hip; navy-blue trousers visible below the robe hem; dark
brown/near-black shoes. A continuous dark (near-black, slightly warm, not flat #000) contour line
separates the whole silhouette from the background and separates major colour fields (hair/skin,
robe/under-layer) from each other. Shading reads as roughly three tonal steps per surface
(highlight/base/shadow) rather than a smooth gradient, softened by some anti-aliasing rather than
hard 1px pixel-art edges — match that same softness, do not sharpen it into crisper pixel blocks
than the reference actually has. No baked drop/contact shadow under the feet. Background in the
reference is flat chroma-key magenta — ignore it, it is scaffolding, not part of the character.

The reference sheet's own row 2 (what would be "east") is not usable as a directional example —
see `00_common_fable5_character_sheet_style.md`, "The style-authority reference image itself has
this exact defect". Rows 0 (south) and 3 (north) are fine to study directly.

## Sheet

Follow `00_common_fable5_character_sheet_style.md` exactly: 640x512, 4 rows (south/west/east/
north) x 10 columns (idle x2, walk x6, interact x2), 64x128 cells, foot pivot fixed at (32,120).

## Per-row content

- **south (row 0):** idle = calm standing weight settled evenly, hands relaxed; walk = a
  six-phase natural stride cycle with alternating planted foot, no foot-sliding shadow, arms
  countering the opposite leg; interact = one attentive listening/speaking gesture pair usable
  for both a conversation prompt and a "working" beat (e.g., a small hand raise into a settled
  hand-at-chest follow-through). No prop is required; if one is added it must stay in the same
  hand across every other direction.
- **west / east:** same idle/walk/interact content as south, reprojected to a true side view.
  Draw east independently — do not flip west. If any asymmetric detail exists (hair part, tunic
  trim knot, a held object), keep it on the same anatomical side in both rows.
- **north (row 3):** same idle/walk/interact content, back view. Hair and tunic trim silhouette
  must still read as the same person from behind.

## Negative constraints

No sword, combat armor, hood hiding the face, baked exclamation/quest marker, UI frame, text,
multiple characters in one frame, 3/4/isometric-only substitute for a required direction, or
chroma-key residue. The final sheet must have true transparent surroundings, with no labels,
rulers, borders, checkerboard, captions, or watermark.

## Route to a real candidate (no built-in API call)

This tool does not call an image-generation API itself (see `tools/asset-forge/README.md`,
"No paid API path"). To turn this prompt into a candidate (run from inside `tools/asset-forge/`,
or prefix each command with `npm --prefix tools/asset-forge` from the repo root — there is no
`make-fable5-character-job` script in the repository-root `package.json`):

1. `npm run make-fable5-character-job -- --asset char_player --dry-run` validates the exact
   sole authority, prompt pair, and output contract without creating pixels or a candidate.
2. Run the same command without `--dry-run` to write a portable prompt/reference/output-contract
   bundle under `generated/jobs/`. No image is produced by this step.
3. A human (or an external, human-supervised session — Codex CLI's own built-in image
   generation, or a signed-in ChatGPT session) runs that prompt outside this tool and produces
   PNG bytes. Nothing in `tools/asset-forge` performs this step automatically.
4. Use only the Fable5-specific intake route to bring the result in as a new pending candidate;
   do not import, promote, or reuse historical candidates.
5. A human performs the required review and separately authorizes any later runtime installation.

Steps 1, 2, and 4 are this tool's job. Step 3 is the "都度生成セッション" (case-by-case
generation session) the product owner named as the fallback — in this tool's actual design it is
not a fallback path, it is the only path that produces real pixels; `mock` only produces
deterministic placeholder test images.
```

### 4.2 char_innkeeper(宿屋の主人・別人格)

```markdown
# Fable5 prefab character sheet — common spec (draft)

> Status: draft, not wired into any asset-forge job yet. This file exists so a future
> `make-job` / `make-job-v2` prompt assembly, or a manually-run external generation session,
> has one canonical text to include. It supersedes `prompts/v2/characters/animated-character.md`
> (48x96 frame, idle2+walk4+talk2+work2) for any character that must match the current
> `Fable5PrefabSpec.md` section 6/7 contract. It does not delete or edit that older file.

Authority: `Fable5PrefabSpec.md` section 6 (Character) and section 7 (Asset Contract), repo root.

## Canvas and pivot

- Frame canvas: **64x128** pixels. Visible body height: about **72px**, vertically placed so the
  character reads as standing on the frame's own baseline.
- Foot pivot: **(32, 120) in every frame of every character, with no exception.** This is
  `Fable5PrefabSpec.md`'s N6 acceptance check. If a generated frame's sole does not land on
  that pixel after processing, the frame fails, full stop — do not average, do not "close enough".

### Exactly what the pivot check tests (read this before drawing feet)

`tools/asset-forge/src/fable5-prefab-character-intake.mjs` (`inspectFable5PrefabCharacterCandidate`,
function `pivotProblem`) is the real mechanical gate every candidate must clear on import. Per
64x128 cell it does two independent things, both on the lower **16-pixel band, y=112..127 of that
cell**:

1. Requires at least one opaque (alpha>0) pixel exactly on row **y=120**. A frame where the
   drawn sole sits at y=118 or y=122 — very common in a mid-stride "foot lifted" walk phase, or
   after a naive resize shifts everything by a pixel — has **zero** opaque pixels at y=120 and is
   rejected with "no opaque sole pixels at the pivot row", independent of how good the frame looks.
2. Computes the mean x of every opaque pixel in that same y=112..127 band and requires it to fall
   within **32±2 (x=30..34)**. This is a centroid over the whole lower-leg/foot silhouette, not a
   single point — a wide stance, a trailing back foot, or a foot that has drifted sideways during a
   walk-phase redraw all pull this number away from 32.

This is not a theoretical risk: **every one of the four historical candidate sheets already sitting
in this repo failed this exact check when run through the real `import-fable5-character` command**
(evidence in the "Failure evidence from this repo's own history" section below). Draw every frame
with the standing/contact foot's sole deliberately centered under x=32 and touching y=120, then
check it — do not eyeball it after the fact.

## Sheet layout

One character = one PNG, **640x512**, laid out as a strict 4-row x 10-column grid of 64x128
cells with no gaps, borders, labels, or frame numbers baked in:

| row | direction | col 0–1 | col 2–7 | col 8–9 |
|---|---|---|---|---|
| 0 | south (facing the viewer) | idle x2 | walk x6 | interact x2 |
| 1 | west | idle x2 | walk x6 | interact x2 |
| 2 | east | idle x2 | walk x6 | interact x2 |
| 3 | north (facing away) | idle x2 | walk x6 | interact x2 |

- idle plays at 4fps, walk at 10fps.
- interact's 2 frames are shared: the runtime reuses the same pair for talking and for working
  poses. Do not draw two different sub-poses hoping to split them later — the contract only
  reserves 2 columns for this row segment.
- **East is never a mirror of west, and east is never the same silhouette as west facing the same
  way either.** Draw it as its own pass, actually turned to face the opposite direction. Two
  distinct failure shapes have both been observed from real generations against this exact spec
  (see evidence below): (a) a horizontally-flipped west strip, which puts tool/prop hands and
  asymmetric costume details on the wrong side; (b) an **unflipped duplicate** — west and east
  both still facing left/west — which is arguably the more common failure in practice and is
  *not* reliably caught by the mechanical "exact mirror" check (that check only fires on a
  byte-perfect horizontal flip; an unflipped duplicate, or a redraw that merely resembles one,
  passes it while still being completely wrong). After generating, a human must look at row 2
  (east) directly and confirm the character's nose/torso/lead foot actually point right/east —
  do not infer this from "the mechanical check passed."

### The style-authority reference image itself has this exact defect — do not copy its row 2

`art/references/user-provided/character_style_authority_20260722_v1.png` is the sole style/identity
authority (see the per-character prompt for how strictly), but its own row 2 (the position that
would be "east" in a 4-row south/west/east/north sheet) is **not** an independently-drawn or even
mirrored east pose — it is, by direct visual and pixel comparison, the same west-facing silhouette
as row 1, not turned around. Do not treat that row as an example of what east should look like, and
do not let a generation session "match the reference" by reusing that row's content or direction
for the east row of a new sheet. Row 0 (south) and row 3 (north) in the reference are fine to use
as directional examples; row 2 is not.

## Identity discipline

- Every direction and every frame of one character must read as the same individual: same face,
  age, head size, hair, palette, silhouette, and any carried object or costume asymmetry.
- Only camera angle and walk/idle/interact phase may change between cells. Do not let the
  generator "improve" the proportions, add accessories, or drift the palette between directions —
  that is the single most common way a multi-call generation session fails identity continuity.
- Which reference image supplies that identity, and how strictly, is asset-specific — see the
  per-character prompt file, not this shared one.

## Matching the world

- Lighting and material language must match `target-town-user-direct-v1.png`
  (`public/fable5-v2/assets/world/target-town-user-direct-v1.png`, byte-identical to
  `art/references/user-provided/target-town.png`, SHA-256
  `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`): light from the upper-left
  at twilight, charcoal / slate-blue / desaturated moss-green / weathered-brown / cold-stone
  ambient tones, restrained warm-amber accents only at light sources. Use 2–3 shading steps per
  material, crisp pixel clusters, and a 1px dark contour where the silhouette needs separation
  from that background. A correctly-shaded character dropped onto that exact background should
  not look like it was lit from a different scene.
- This is a density/contrast match, not a recolor: keep the character's own identity palette
  (see the per-character prompt) and adjust shading *steps*, not hue, to sit in the same light.
- `target-town-user-direct-v1.png` also contains a few tiny human figures painted directly into the
  scene (e.g. near the well/plaza). Those are environment dressing at a much softer, smaller, far
  less outlined rendering than the character-style authority — they are not an alternate style
  authority and must not be imitated. Match that background's *light direction and shading-step
  density* only; keep the character's own crisp bold-contour chibi construction from the style
  authority image.

## Generation-image mechanics (not the finished asset)

- Request a flat, uniform, high-saturation chroma-key background (or true alpha transparency if
  the provider supports it) so each frame can be isolated. This chroma background is scaffolding
  for post-processing, not part of the style brief above.
- Explicitly excluded: text, watermark, sheet border, checkerboard, ruler, caption, frame numbers,
  UI chrome, or any second character/figure sharing a frame — anywhere in the image.
- Nearest-neighbor-safe pixel art: hard edges, no soft anti-aliased gradients, no photographic
  texture.

### Output size vs. the exact 640x512 requirement

`inspectFable5PrefabCharacterCandidate` (same file as the pivot check) hard-rejects any candidate
whose PNG is not **pixel-exact 640x512** — `candidate dimensions must be 640x512` — with no resize
step of its own. Most image-generation tools (including built-in `image_gen`-style tools) offer a
fixed menu of output sizes rather than an arbitrary WxH, and none of the common presets are exactly
the 640:512 (5:4) ratio this sheet needs. Plan for a **separate, explicit resize step before
import**, not as an afterthought:

1. Generate at the largest size available whose aspect ratio is closest to 5:4 (1.25) landscape.
2. If that size is not exactly 5:4, pad (letterbox) to 5:4 first — do not crop into the character
   and do not stretch non-uniformly. A non-uniform stretch changes the character's proportions
   against the style authority and will visibly fail human review even if it happens to pass the
   mechanical checks.
3. Resize the padded image down to exactly 640x512 with a single uniform scale factor, using
   nearest-neighbor or box filtering (not bicubic/lanczos — those blur hard pixel edges and can
   shift the foot silhouette off the exact y=120 pivot row described above).
4. Re-measure the result before importing: it must be exactly 640 wide and 512 tall, RGBA, with
   real alpha (not just visually-transparent-looking pixels — see the next section).

### Transparency has to be real alpha, not "looks transparent"

The same mechanical check also requires all four sheet corners to be fully transparent
(alpha=0) and rejects any pixel that is still opaque *and* exactly chroma magenta (R255 G0 B255).
A soft/anti-aliased chroma-key removal that leaves a faint magenta or gray fringe around limbs will
often still pass this narrow byte-exact check (the fringe pixels are rarely exactly 255,0,255) while
looking visibly wrong — so, again, do not rely on the mechanical pass alone; look at the edges of a
few frames at 400%+ zoom for keying residue before treating a candidate as ready for review.

## Failure evidence from this repo's own history (read before your first generation)

This is not a hypothetical checklist — it is the outcome of literally running this repo's real
mechanical validator (`inspectFable5PrefabCharacterCandidate`) against the four candidate sheets
already sitting in `tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/`
(`char_player-alpha.png`, `char_innkeeper-alpha.png`, `char_town_clerk-alpha.png`,
`char_resident-alpha.png` — built against this exact style authority, still `pending-human-review`,
never approved, never promoted):

- **4 of 4 failed the pivot check**, each with 9–13 failing cells out of 40. Columns 8 and 9 (the
  interact pose) failed on nearly every one of the four sheets — a reaching/gesture pose shifts
  weight off-center far more easily than a neutral idle or a mid-walk stride does. A few walk-cycle
  columns failed too, from the mid-stride "foot briefly airborne" phase landing no opaque pixel on
  y=120. **Budget real attention for the interact pose's foot placement specifically** — it is the
  single most common failure across every historical attempt.
- **3 of 3 real `image_gen`-produced NPC candidates (innkeeper, town clerk, resident — the player
  candidate was a direct crop of the authority image, not a fresh generation) reproduced the
  west/east duplication defect** described above: their raw generation output's row 2 read as the
  same facing direction as row 1, not independently turned. By the time those raw outputs were
  cropped/resized into the final 640x512 candidates, the west/east relationship had shifted to read
  closer to a mirror instead — still wrong, just wrong in the other, mechanically-checked way. Don't
  assume a resize/crop pass will fix a directionally-wrong east row; get it right at generation time.
- **The historical innkeeper candidate failed identity distinctiveness**: it is, by direct visual
  comparison, essentially the same face/beard/hair/robe as the style-authority image (i.e., the same
  person as the player), not a distinct individual using the authority only for pixel density,
  proportion, and shading language. The town-clerk and resident candidates from the same batch did
  keep a distinct identity (different hair, face, and costume from the player), so this is an
  avoidable, not inherent, failure — see `character.innkeeper.prompt-draft.md` for the specific
  guard against it.

None of these four historical candidates are promoted, approved, or usable as a reference — they
remain `pending-human-review` quarantined evidence. They are cited here only as ground truth for
what to avoid; do not import, promote, or visually copy from them.

## Boundary reminder

A generated image produced from this prompt is a **pending candidate only**. It is not approved,
not identity-verified, and not game-ready until a human inspects it against the identity source,
runs it through the Fable5-specific job/intake commands below, and it clears human review. Do not
claim completion from generation alone.

All `npm run <fable5-*>` commands referenced by the per-character prompt files must be run from
inside `tools/asset-forge/` — e.g. `cd tools/asset-forge && npm run make-fable5-character-job --
--asset char_player --dry-run`, or equivalently `npm --prefix tools/asset-forge run
make-fable5-character-job -- --asset char_player --dry-run` from the repository root. There is no
script of that name in the repository-root `package.json`; running it from the repo root without
`--prefix` fails with `npm error Missing script`. (Verified by actually running both forms.)

# char_innkeeper — Fable5 prefab sheet (draft prompt)

> Status: draft, not generated. Pair with `00_common_fable5_character_sheet_style.md` and the
> contract at `tools/asset-forge/contracts/fable5-prefab/character.innkeeper.contract-draft.json`.
> No v2 art-direction entry for an innkeeper currently exists in
> `data/v2/art-direction/characters.json` (only `character.player`, `character.town_clerk`,
> `character.gatekeeper`, `character.dojo_inspector`, `character.mob.townsfolk_male/female`,
> `character.dojo_student` do). This is new authoring, not a rewrite of an existing wrong entry.

## Sole style authority: a different person

The exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`) is the innkeeper's **sole**
character-style authority. Verify the same path and digest in
`art/contracts/user-provided-images.json` before generation.

- The innkeeper must be a distinct person from the player: invent a different face, hair, costume,
  and role silhouette; do not copy player-specific visible traits.
- Use the exact authority only for pixel density (same apparent resolution of detail, not smoother
  or blockier), head-to-body ratio, silhouette weight/slimness, line/contour weight, and the
  2–3-step shading language described in `00_common_fable5_character_sheet_style.md`. For what
  those traits look like in the authority image concretely — chibi 2.5–3 head-height proportions,
  minimal almond-shaped eyes, a continuous dark contour line, softly-antialiased 3-tone shading —
  see the equivalent observed-description block in `character.player.prompt-draft.md`. Copy that
  *grammar*, not the elderly gray-haired-and-bearded person it describes.
- Suggested role signifiers (adjust freely, these are not locked): apron over practical tavern
  clothing, warm neutral palette that still reads correctly under the twilight ambient light of
  `target-town-user-direct-v1.png`, a towel/rag or tankard as an optional interact-row prop held
  in one consistent hand across all four directions.

### A previous generation attempt against this exact authority already failed this specific rule

`tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/char_innkeeper-alpha.png`
(still `pending-human-review`, never approved — not a reference, cited only as a documented failure)
is, by direct visual comparison, essentially the *same person* as the style-authority image: same
gray hair, same gray beard, same face, same sage-green robe with gold trim over a cream under-layer.
That is a style-authority *identity* clone, not a distinct innkeeper who merely shares its pixel
density and shading language. Concretely avoid this by changing at minimum: hair colour and style,
facial hair (or its absence), and the specific garment silhouette/colour — while keeping the same
chibi proportions, contour weight, and shading-step count. A useful gut check before finalizing a
candidate: if you covered the clothing and only compared the face/hair silhouette against the
authority image, could you tell them apart? If not, it will fail review again for the same reason.

### Historical candidates are prohibited

Do not use any previous innkeeper, player, NPC, generated sheet, deployed asset, or candidate as
a visual reference, comparison authority, derivation input, or runtime-promotion source. They are
quarantined historical records only. The exact image above is the sole character-style authority.

## Sheet

Same as the player: 640x512, 4 rows (south/west/east/north) x 10 columns (idle x2, walk x6,
interact x2), 64x128 cells, foot pivot fixed at (32,120). The innkeeper needs a real walk cycle
(the current deployed art has none) even though most in-game time will show it idle/interact
behind the inn counter — `Fable5PrefabSpec.md` section 6 does not carve out a reduced grid for
stationary NPCs, and a future scene may want the innkeeper mobile.

## Per-row content

- **south:** idle = standing attentive behind/near the counter; walk = six-phase stride matching
  the common walk-cycle description (reuse the same phase logic as the player prompt, different
  costume); interact = a serving/wiping-the-counter gesture pair, usable at runtime for both
  talk and work states per the shared-interact rule.
- **west / east:** same content reprojected; draw east independently, do not mirror west.
- **north:** same content from behind.

## Negative constraints

No player identity bleed, modern clothing, oversized sparkly/glossy anime eyes beyond the
authority's own minimal almond-shaped eye style (the required chibi 2.5–3 head-height proportions
themselves are *not* a negative constraint — see "Sole style authority" above; do not undersize
the head to avoid them), multiple characters in frame, baked UI/text, 3/4 angle standing in for a
missing direction, or chroma-key residue. The final sheet must have true transparent surroundings,
with no labels, rulers, borders, checkerboard, captions, or watermark.

> Editorial note (2026-07-29): an earlier version of this list excluded "chibi/large-eye styling"
> outright, which contradicted this same file's style-authority section — the current sole
> authority image *is* chibi-proportioned with large heads. That was very likely a leftover from
> an earlier, different style authority (before the 2026-07-22 authority swap recorded in
> `docs/current-state.md`) and has been corrected above rather than silently carried forward.

## Route to a real candidate

Identical mechanism to the player prompt file's "Route to a real candidate" section: this tool
writes job-packs and imports externally-produced results; it does not call an image API itself.
See that section rather than duplicating it here.

## npcSpot context (informational only)

`tools/asset-forge/contracts/asset-contract.sample.json`'s `bld_m_inn` entry already declares
`"npcSpots": [{ "x": 1, "y": 0, "role": "innkeeper" }]`. This prompt does not change building
placement; it only informs the pose/scale sanity check (the innkeeper should read as standing at
a counter, not mid-stride, when composited near that spot at native scale).
```

### 4.3 char_town_clerk(町役場の書記・別人格)

```markdown
# Fable5 prefab character sheet — common spec (draft)

> Status: draft, not wired into any asset-forge job yet. This file exists so a future
> `make-job` / `make-job-v2` prompt assembly, or a manually-run external generation session,
> has one canonical text to include. It supersedes `prompts/v2/characters/animated-character.md`
> (48x96 frame, idle2+walk4+talk2+work2) for any character that must match the current
> `Fable5PrefabSpec.md` section 6/7 contract. It does not delete or edit that older file.

Authority: `Fable5PrefabSpec.md` section 6 (Character) and section 7 (Asset Contract), repo root.

## Canvas and pivot

- Frame canvas: **64x128** pixels. Visible body height: about **72px**, vertically placed so the
  character reads as standing on the frame's own baseline.
- Foot pivot: **(32, 120) in every frame of every character, with no exception.** This is
  `Fable5PrefabSpec.md`'s N6 acceptance check. If a generated frame's sole does not land on
  that pixel after processing, the frame fails, full stop — do not average, do not "close enough".

### Exactly what the pivot check tests (read this before drawing feet)

`tools/asset-forge/src/fable5-prefab-character-intake.mjs` (`inspectFable5PrefabCharacterCandidate`,
function `pivotProblem`) is the real mechanical gate every candidate must clear on import. Per
64x128 cell it does two independent things, both on the lower **16-pixel band, y=112..127 of that
cell**:

1. Requires at least one opaque (alpha>0) pixel exactly on row **y=120**. A frame where the
   drawn sole sits at y=118 or y=122 — very common in a mid-stride "foot lifted" walk phase, or
   after a naive resize shifts everything by a pixel — has **zero** opaque pixels at y=120 and is
   rejected with "no opaque sole pixels at the pivot row", independent of how good the frame looks.
2. Computes the mean x of every opaque pixel in that same y=112..127 band and requires it to fall
   within **32±2 (x=30..34)**. This is a centroid over the whole lower-leg/foot silhouette, not a
   single point — a wide stance, a trailing back foot, or a foot that has drifted sideways during a
   walk-phase redraw all pull this number away from 32.

This is not a theoretical risk: **every one of the four historical candidate sheets already sitting
in this repo failed this exact check when run through the real `import-fable5-character` command**
(evidence in the "Failure evidence from this repo's own history" section below). Draw every frame
with the standing/contact foot's sole deliberately centered under x=32 and touching y=120, then
check it — do not eyeball it after the fact.

## Sheet layout

One character = one PNG, **640x512**, laid out as a strict 4-row x 10-column grid of 64x128
cells with no gaps, borders, labels, or frame numbers baked in:

| row | direction | col 0–1 | col 2–7 | col 8–9 |
|---|---|---|---|---|
| 0 | south (facing the viewer) | idle x2 | walk x6 | interact x2 |
| 1 | west | idle x2 | walk x6 | interact x2 |
| 2 | east | idle x2 | walk x6 | interact x2 |
| 3 | north (facing away) | idle x2 | walk x6 | interact x2 |

- idle plays at 4fps, walk at 10fps.
- interact's 2 frames are shared: the runtime reuses the same pair for talking and for working
  poses. Do not draw two different sub-poses hoping to split them later — the contract only
  reserves 2 columns for this row segment.
- **East is never a mirror of west, and east is never the same silhouette as west facing the same
  way either.** Draw it as its own pass, actually turned to face the opposite direction. Two
  distinct failure shapes have both been observed from real generations against this exact spec
  (see evidence below): (a) a horizontally-flipped west strip, which puts tool/prop hands and
  asymmetric costume details on the wrong side; (b) an **unflipped duplicate** — west and east
  both still facing left/west — which is arguably the more common failure in practice and is
  *not* reliably caught by the mechanical "exact mirror" check (that check only fires on a
  byte-perfect horizontal flip; an unflipped duplicate, or a redraw that merely resembles one,
  passes it while still being completely wrong). After generating, a human must look at row 2
  (east) directly and confirm the character's nose/torso/lead foot actually point right/east —
  do not infer this from "the mechanical check passed."

### The style-authority reference image itself has this exact defect — do not copy its row 2

`art/references/user-provided/character_style_authority_20260722_v1.png` is the sole style/identity
authority (see the per-character prompt for how strictly), but its own row 2 (the position that
would be "east" in a 4-row south/west/east/north sheet) is **not** an independently-drawn or even
mirrored east pose — it is, by direct visual and pixel comparison, the same west-facing silhouette
as row 1, not turned around. Do not treat that row as an example of what east should look like, and
do not let a generation session "match the reference" by reusing that row's content or direction
for the east row of a new sheet. Row 0 (south) and row 3 (north) in the reference are fine to use
as directional examples; row 2 is not.

## Identity discipline

- Every direction and every frame of one character must read as the same individual: same face,
  age, head size, hair, palette, silhouette, and any carried object or costume asymmetry.
- Only camera angle and walk/idle/interact phase may change between cells. Do not let the
  generator "improve" the proportions, add accessories, or drift the palette between directions —
  that is the single most common way a multi-call generation session fails identity continuity.
- Which reference image supplies that identity, and how strictly, is asset-specific — see the
  per-character prompt file, not this shared one.

## Matching the world

- Lighting and material language must match `target-town-user-direct-v1.png`
  (`public/fable5-v2/assets/world/target-town-user-direct-v1.png`, byte-identical to
  `art/references/user-provided/target-town.png`, SHA-256
  `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`): light from the upper-left
  at twilight, charcoal / slate-blue / desaturated moss-green / weathered-brown / cold-stone
  ambient tones, restrained warm-amber accents only at light sources. Use 2–3 shading steps per
  material, crisp pixel clusters, and a 1px dark contour where the silhouette needs separation
  from that background. A correctly-shaded character dropped onto that exact background should
  not look like it was lit from a different scene.
- This is a density/contrast match, not a recolor: keep the character's own identity palette
  (see the per-character prompt) and adjust shading *steps*, not hue, to sit in the same light.
- `target-town-user-direct-v1.png` also contains a few tiny human figures painted directly into the
  scene (e.g. near the well/plaza). Those are environment dressing at a much softer, smaller, far
  less outlined rendering than the character-style authority — they are not an alternate style
  authority and must not be imitated. Match that background's *light direction and shading-step
  density* only; keep the character's own crisp bold-contour chibi construction from the style
  authority image.

## Generation-image mechanics (not the finished asset)

- Request a flat, uniform, high-saturation chroma-key background (or true alpha transparency if
  the provider supports it) so each frame can be isolated. This chroma background is scaffolding
  for post-processing, not part of the style brief above.
- Explicitly excluded: text, watermark, sheet border, checkerboard, ruler, caption, frame numbers,
  UI chrome, or any second character/figure sharing a frame — anywhere in the image.
- Nearest-neighbor-safe pixel art: hard edges, no soft anti-aliased gradients, no photographic
  texture.

### Output size vs. the exact 640x512 requirement

`inspectFable5PrefabCharacterCandidate` (same file as the pivot check) hard-rejects any candidate
whose PNG is not **pixel-exact 640x512** — `candidate dimensions must be 640x512` — with no resize
step of its own. Most image-generation tools (including built-in `image_gen`-style tools) offer a
fixed menu of output sizes rather than an arbitrary WxH, and none of the common presets are exactly
the 640:512 (5:4) ratio this sheet needs. Plan for a **separate, explicit resize step before
import**, not as an afterthought:

1. Generate at the largest size available whose aspect ratio is closest to 5:4 (1.25) landscape.
2. If that size is not exactly 5:4, pad (letterbox) to 5:4 first — do not crop into the character
   and do not stretch non-uniformly. A non-uniform stretch changes the character's proportions
   against the style authority and will visibly fail human review even if it happens to pass the
   mechanical checks.
3. Resize the padded image down to exactly 640x512 with a single uniform scale factor, using
   nearest-neighbor or box filtering (not bicubic/lanczos — those blur hard pixel edges and can
   shift the foot silhouette off the exact y=120 pivot row described above).
4. Re-measure the result before importing: it must be exactly 640 wide and 512 tall, RGBA, with
   real alpha (not just visually-transparent-looking pixels — see the next section).

### Transparency has to be real alpha, not "looks transparent"

The same mechanical check also requires all four sheet corners to be fully transparent
(alpha=0) and rejects any pixel that is still opaque *and* exactly chroma magenta (R255 G0 B255).
A soft/anti-aliased chroma-key removal that leaves a faint magenta or gray fringe around limbs will
often still pass this narrow byte-exact check (the fringe pixels are rarely exactly 255,0,255) while
looking visibly wrong — so, again, do not rely on the mechanical pass alone; look at the edges of a
few frames at 400%+ zoom for keying residue before treating a candidate as ready for review.

## Failure evidence from this repo's own history (read before your first generation)

This is not a hypothetical checklist — it is the outcome of literally running this repo's real
mechanical validator (`inspectFable5PrefabCharacterCandidate`) against the four candidate sheets
already sitting in `tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/`
(`char_player-alpha.png`, `char_innkeeper-alpha.png`, `char_town_clerk-alpha.png`,
`char_resident-alpha.png` — built against this exact style authority, still `pending-human-review`,
never approved, never promoted):

- **4 of 4 failed the pivot check**, each with 9–13 failing cells out of 40. Columns 8 and 9 (the
  interact pose) failed on nearly every one of the four sheets — a reaching/gesture pose shifts
  weight off-center far more easily than a neutral idle or a mid-walk stride does. A few walk-cycle
  columns failed too, from the mid-stride "foot briefly airborne" phase landing no opaque pixel on
  y=120. **Budget real attention for the interact pose's foot placement specifically** — it is the
  single most common failure across every historical attempt.
- **3 of 3 real `image_gen`-produced NPC candidates (innkeeper, town clerk, resident — the player
  candidate was a direct crop of the authority image, not a fresh generation) reproduced the
  west/east duplication defect** described above: their raw generation output's row 2 read as the
  same facing direction as row 1, not independently turned. By the time those raw outputs were
  cropped/resized into the final 640x512 candidates, the west/east relationship had shifted to read
  closer to a mirror instead — still wrong, just wrong in the other, mechanically-checked way. Don't
  assume a resize/crop pass will fix a directionally-wrong east row; get it right at generation time.
- **The historical innkeeper candidate failed identity distinctiveness**: it is, by direct visual
  comparison, essentially the same face/beard/hair/robe as the style-authority image (i.e., the same
  person as the player), not a distinct individual using the authority only for pixel density,
  proportion, and shading language. The town-clerk and resident candidates from the same batch did
  keep a distinct identity (different hair, face, and costume from the player), so this is an
  avoidable, not inherent, failure — see `character.innkeeper.prompt-draft.md` for the specific
  guard against it.

None of these four historical candidates are promoted, approved, or usable as a reference — they
remain `pending-human-review` quarantined evidence. They are cited here only as ground truth for
what to avoid; do not import, promote, or visually copy from them.

## Boundary reminder

A generated image produced from this prompt is a **pending candidate only**. It is not approved,
not identity-verified, and not game-ready until a human inspects it against the identity source,
runs it through the Fable5-specific job/intake commands below, and it clears human review. Do not
claim completion from generation alone.

All `npm run <fable5-*>` commands referenced by the per-character prompt files must be run from
inside `tools/asset-forge/` — e.g. `cd tools/asset-forge && npm run make-fable5-character-job --
--asset char_player --dry-run`, or equivalently `npm --prefix tools/asset-forge run
make-fable5-character-job -- --asset char_player --dry-run` from the repository root. There is no
script of that name in the repository-root `package.json`; running it from the repo root without
`--prefix` fails with `npm error Missing script`. (Verified by actually running both forms.)

# char_town_clerk — Fable5 prefab sheet (review draft)

> Status: draft, not generated. Pair with
> `00_common_fable5_character_sheet_style.md` and
> `contracts/fable5-prefab/character.town-clerk.contract-draft.json`. This is a role/style-lock
> prompt, not evidence of Asset Forge intake, human approval, or runtime permission.

## Role and identity limits

Create one adult civic town clerk: a neat, compact administrative silhouette with a small ledger
or document gesture allowed as a role signifier. The clerk is a new NPC individual, not a user
identity and not a user-direct source. It must remain distinct from the player and every other NPC.

Keep the clerk distinct from the innkeeper (no required apron, serving prop, or tavern-worker
identity) and a general resident (the limited civic/document cue should read at native scale).
Avoid a playable-player identity, weapons, armor, badges, readable paperwork, UI, captions, or
quest markers.

## Sheet contract — fixed

Produce exactly 640x512 RGBA: four rows in `south`, `west`, `east`, `north` order and ten columns
per row. Every cell is 64x128 with the foot pivot fixed at `(32,120)`. Columns `0–1` are idle,
`2–7` are six walk phases, and `8–9` are two interact poses. Keep all 40 cells independently
readable. Draw the east row independently; do not mirror the west row.

## Style lock

The exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`) is the clerk's **sole**
character-style authority. Verify the same path and digest in
`art/contracts/user-provided-images.json` before generation. Follow it and
`00_common_fable5_character_sheet_style.md` for crisp pixel clusters, stable head/body
proportions, contour weight, restrained 2–3-step shading, a clear silhouette, transparent
surroundings, and no soft anti-aliasing. Preserve the same clerk across all directions and
animation phases; only facing and action phase may change.

Borrow the authority image's *construction grammar*, not its person: chibi 2.5–3 head-height
proportions, a large head relative to the body, minimal almond-shaped eyes with a single small
highlight and no rendered iris/eyebrow detail, and a continuous dark (not flat-black) contour line
around the silhouette and between major colour fields (see the fuller observed-description block in
`character.player.prompt-draft.md` if a copy of that reasoning is useful). The clerk must read as a
visibly different individual from that elderly gray-haired, gray-bearded, green-robed reference —
different hair colour/style and a different garment silhouette — while matching its pixel density,
proportion system, and shading-step count exactly. Suggested (not locked) signifiers: a neat
waistcoat/vest or long coat over a plain shirt, a small satchel or a compact ledger/document held in
one consistently-chosen hand across all four directions as the interact-row prop, a restrained,
slightly more formal palette than the resident's that still sits correctly under the twilight
ambient light of `target-town-user-direct-v1.png`.

Do not use any historical character candidate, generated sheet, or deployed asset as a visual
reference, comparison authority, derivation input, or runtime-promotion source. No text, UI,
labels, borders, checkerboard, watermark, or chroma-key residue may remain in the final sheet.

## Per-row content

- **south:** calm ledger-holding idle; a short, grounded six-phase walk; two restrained
  explain-or-record interact poses.
- **west / east:** reproject the same person and role signifier while preserving anatomical
  consistency; east is newly drawn rather than flipped.
- **north:** same idle, walk, and interact logic from behind, with the clerk still distinct by
  silhouette rather than readable text.

Formal Asset Forge intake/mechanical validation, human review, promotion, export, and runtime use
remain required for a future new candidate. No historical candidate carries forward.
```

### 4.4 char_resident(一般町民・別人格)

```markdown
# Fable5 prefab character sheet — common spec (draft)

> Status: draft, not wired into any asset-forge job yet. This file exists so a future
> `make-job` / `make-job-v2` prompt assembly, or a manually-run external generation session,
> has one canonical text to include. It supersedes `prompts/v2/characters/animated-character.md`
> (48x96 frame, idle2+walk4+talk2+work2) for any character that must match the current
> `Fable5PrefabSpec.md` section 6/7 contract. It does not delete or edit that older file.

Authority: `Fable5PrefabSpec.md` section 6 (Character) and section 7 (Asset Contract), repo root.

## Canvas and pivot

- Frame canvas: **64x128** pixels. Visible body height: about **72px**, vertically placed so the
  character reads as standing on the frame's own baseline.
- Foot pivot: **(32, 120) in every frame of every character, with no exception.** This is
  `Fable5PrefabSpec.md`'s N6 acceptance check. If a generated frame's sole does not land on
  that pixel after processing, the frame fails, full stop — do not average, do not "close enough".

### Exactly what the pivot check tests (read this before drawing feet)

`tools/asset-forge/src/fable5-prefab-character-intake.mjs` (`inspectFable5PrefabCharacterCandidate`,
function `pivotProblem`) is the real mechanical gate every candidate must clear on import. Per
64x128 cell it does two independent things, both on the lower **16-pixel band, y=112..127 of that
cell**:

1. Requires at least one opaque (alpha>0) pixel exactly on row **y=120**. A frame where the
   drawn sole sits at y=118 or y=122 — very common in a mid-stride "foot lifted" walk phase, or
   after a naive resize shifts everything by a pixel — has **zero** opaque pixels at y=120 and is
   rejected with "no opaque sole pixels at the pivot row", independent of how good the frame looks.
2. Computes the mean x of every opaque pixel in that same y=112..127 band and requires it to fall
   within **32±2 (x=30..34)**. This is a centroid over the whole lower-leg/foot silhouette, not a
   single point — a wide stance, a trailing back foot, or a foot that has drifted sideways during a
   walk-phase redraw all pull this number away from 32.

This is not a theoretical risk: **every one of the four historical candidate sheets already sitting
in this repo failed this exact check when run through the real `import-fable5-character` command**
(evidence in the "Failure evidence from this repo's own history" section below). Draw every frame
with the standing/contact foot's sole deliberately centered under x=32 and touching y=120, then
check it — do not eyeball it after the fact.

## Sheet layout

One character = one PNG, **640x512**, laid out as a strict 4-row x 10-column grid of 64x128
cells with no gaps, borders, labels, or frame numbers baked in:

| row | direction | col 0–1 | col 2–7 | col 8–9 |
|---|---|---|---|---|
| 0 | south (facing the viewer) | idle x2 | walk x6 | interact x2 |
| 1 | west | idle x2 | walk x6 | interact x2 |
| 2 | east | idle x2 | walk x6 | interact x2 |
| 3 | north (facing away) | idle x2 | walk x6 | interact x2 |

- idle plays at 4fps, walk at 10fps.
- interact's 2 frames are shared: the runtime reuses the same pair for talking and for working
  poses. Do not draw two different sub-poses hoping to split them later — the contract only
  reserves 2 columns for this row segment.
- **East is never a mirror of west, and east is never the same silhouette as west facing the same
  way either.** Draw it as its own pass, actually turned to face the opposite direction. Two
  distinct failure shapes have both been observed from real generations against this exact spec
  (see evidence below): (a) a horizontally-flipped west strip, which puts tool/prop hands and
  asymmetric costume details on the wrong side; (b) an **unflipped duplicate** — west and east
  both still facing left/west — which is arguably the more common failure in practice and is
  *not* reliably caught by the mechanical "exact mirror" check (that check only fires on a
  byte-perfect horizontal flip; an unflipped duplicate, or a redraw that merely resembles one,
  passes it while still being completely wrong). After generating, a human must look at row 2
  (east) directly and confirm the character's nose/torso/lead foot actually point right/east —
  do not infer this from "the mechanical check passed."

### The style-authority reference image itself has this exact defect — do not copy its row 2

`art/references/user-provided/character_style_authority_20260722_v1.png` is the sole style/identity
authority (see the per-character prompt for how strictly), but its own row 2 (the position that
would be "east" in a 4-row south/west/east/north sheet) is **not** an independently-drawn or even
mirrored east pose — it is, by direct visual and pixel comparison, the same west-facing silhouette
as row 1, not turned around. Do not treat that row as an example of what east should look like, and
do not let a generation session "match the reference" by reusing that row's content or direction
for the east row of a new sheet. Row 0 (south) and row 3 (north) in the reference are fine to use
as directional examples; row 2 is not.

## Identity discipline

- Every direction and every frame of one character must read as the same individual: same face,
  age, head size, hair, palette, silhouette, and any carried object or costume asymmetry.
- Only camera angle and walk/idle/interact phase may change between cells. Do not let the
  generator "improve" the proportions, add accessories, or drift the palette between directions —
  that is the single most common way a multi-call generation session fails identity continuity.
- Which reference image supplies that identity, and how strictly, is asset-specific — see the
  per-character prompt file, not this shared one.

## Matching the world

- Lighting and material language must match `target-town-user-direct-v1.png`
  (`public/fable5-v2/assets/world/target-town-user-direct-v1.png`, byte-identical to
  `art/references/user-provided/target-town.png`, SHA-256
  `39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607`): light from the upper-left
  at twilight, charcoal / slate-blue / desaturated moss-green / weathered-brown / cold-stone
  ambient tones, restrained warm-amber accents only at light sources. Use 2–3 shading steps per
  material, crisp pixel clusters, and a 1px dark contour where the silhouette needs separation
  from that background. A correctly-shaded character dropped onto that exact background should
  not look like it was lit from a different scene.
- This is a density/contrast match, not a recolor: keep the character's own identity palette
  (see the per-character prompt) and adjust shading *steps*, not hue, to sit in the same light.
- `target-town-user-direct-v1.png` also contains a few tiny human figures painted directly into the
  scene (e.g. near the well/plaza). Those are environment dressing at a much softer, smaller, far
  less outlined rendering than the character-style authority — they are not an alternate style
  authority and must not be imitated. Match that background's *light direction and shading-step
  density* only; keep the character's own crisp bold-contour chibi construction from the style
  authority image.

## Generation-image mechanics (not the finished asset)

- Request a flat, uniform, high-saturation chroma-key background (or true alpha transparency if
  the provider supports it) so each frame can be isolated. This chroma background is scaffolding
  for post-processing, not part of the style brief above.
- Explicitly excluded: text, watermark, sheet border, checkerboard, ruler, caption, frame numbers,
  UI chrome, or any second character/figure sharing a frame — anywhere in the image.
- Nearest-neighbor-safe pixel art: hard edges, no soft anti-aliased gradients, no photographic
  texture.

### Output size vs. the exact 640x512 requirement

`inspectFable5PrefabCharacterCandidate` (same file as the pivot check) hard-rejects any candidate
whose PNG is not **pixel-exact 640x512** — `candidate dimensions must be 640x512` — with no resize
step of its own. Most image-generation tools (including built-in `image_gen`-style tools) offer a
fixed menu of output sizes rather than an arbitrary WxH, and none of the common presets are exactly
the 640:512 (5:4) ratio this sheet needs. Plan for a **separate, explicit resize step before
import**, not as an afterthought:

1. Generate at the largest size available whose aspect ratio is closest to 5:4 (1.25) landscape.
2. If that size is not exactly 5:4, pad (letterbox) to 5:4 first — do not crop into the character
   and do not stretch non-uniformly. A non-uniform stretch changes the character's proportions
   against the style authority and will visibly fail human review even if it happens to pass the
   mechanical checks.
3. Resize the padded image down to exactly 640x512 with a single uniform scale factor, using
   nearest-neighbor or box filtering (not bicubic/lanczos — those blur hard pixel edges and can
   shift the foot silhouette off the exact y=120 pivot row described above).
4. Re-measure the result before importing: it must be exactly 640 wide and 512 tall, RGBA, with
   real alpha (not just visually-transparent-looking pixels — see the next section).

### Transparency has to be real alpha, not "looks transparent"

The same mechanical check also requires all four sheet corners to be fully transparent
(alpha=0) and rejects any pixel that is still opaque *and* exactly chroma magenta (R255 G0 B255).
A soft/anti-aliased chroma-key removal that leaves a faint magenta or gray fringe around limbs will
often still pass this narrow byte-exact check (the fringe pixels are rarely exactly 255,0,255) while
looking visibly wrong — so, again, do not rely on the mechanical pass alone; look at the edges of a
few frames at 400%+ zoom for keying residue before treating a candidate as ready for review.

## Failure evidence from this repo's own history (read before your first generation)

This is not a hypothetical checklist — it is the outcome of literally running this repo's real
mechanical validator (`inspectFable5PrefabCharacterCandidate`) against the four candidate sheets
already sitting in `tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/candidates/`
(`char_player-alpha.png`, `char_innkeeper-alpha.png`, `char_town_clerk-alpha.png`,
`char_resident-alpha.png` — built against this exact style authority, still `pending-human-review`,
never approved, never promoted):

- **4 of 4 failed the pivot check**, each with 9–13 failing cells out of 40. Columns 8 and 9 (the
  interact pose) failed on nearly every one of the four sheets — a reaching/gesture pose shifts
  weight off-center far more easily than a neutral idle or a mid-walk stride does. A few walk-cycle
  columns failed too, from the mid-stride "foot briefly airborne" phase landing no opaque pixel on
  y=120. **Budget real attention for the interact pose's foot placement specifically** — it is the
  single most common failure across every historical attempt.
- **3 of 3 real `image_gen`-produced NPC candidates (innkeeper, town clerk, resident — the player
  candidate was a direct crop of the authority image, not a fresh generation) reproduced the
  west/east duplication defect** described above: their raw generation output's row 2 read as the
  same facing direction as row 1, not independently turned. By the time those raw outputs were
  cropped/resized into the final 640x512 candidates, the west/east relationship had shifted to read
  closer to a mirror instead — still wrong, just wrong in the other, mechanically-checked way. Don't
  assume a resize/crop pass will fix a directionally-wrong east row; get it right at generation time.
- **The historical innkeeper candidate failed identity distinctiveness**: it is, by direct visual
  comparison, essentially the same face/beard/hair/robe as the style-authority image (i.e., the same
  person as the player), not a distinct individual using the authority only for pixel density,
  proportion, and shading language. The town-clerk and resident candidates from the same batch did
  keep a distinct identity (different hair, face, and costume from the player), so this is an
  avoidable, not inherent, failure — see `character.innkeeper.prompt-draft.md` for the specific
  guard against it.

None of these four historical candidates are promoted, approved, or usable as a reference — they
remain `pending-human-review` quarantined evidence. They are cited here only as ground truth for
what to avoid; do not import, promote, or visually copy from them.

## Boundary reminder

A generated image produced from this prompt is a **pending candidate only**. It is not approved,
not identity-verified, and not game-ready until a human inspects it against the identity source,
runs it through the Fable5-specific job/intake commands below, and it clears human review. Do not
claim completion from generation alone.

All `npm run <fable5-*>` commands referenced by the per-character prompt files must be run from
inside `tools/asset-forge/` — e.g. `cd tools/asset-forge && npm run make-fable5-character-job --
--asset char_player --dry-run`, or equivalently `npm --prefix tools/asset-forge run
make-fable5-character-job -- --asset char_player --dry-run` from the repository root. There is no
script of that name in the repository-root `package.json`; running it from the repo root without
`--prefix` fails with `npm error Missing script`. (Verified by actually running both forms.)

# char_resident — Fable5 prefab sheet (review draft)

> Status: draft, not generated. Pair with
> `00_common_fable5_character_sheet_style.md` and
> `contracts/fable5-prefab/character.resident.contract-draft.json`. This is a role/style-lock
> prompt, not evidence of Asset Forge intake, human approval, or runtime permission.

## Role and identity limits

Create one adult general town resident: a non-combat local citizen with a simple, readable
daily-life silhouette. The resident is a new NPC individual, not a user identity and not a
user-direct source. It must remain distinct from the player and every other NPC.

Keep the resident distinct from the town clerk (no required civic ledger, quill, official uniform,
badge, or paperwork) and the innkeeper (no required apron, serving prop, or tavern-worker
identity). Avoid weapons, armor, a quest marker, UI, captions, readable text, or a player-like
signature costume.

## Sheet contract — fixed

Produce exactly 640x512 RGBA: four rows in `south`, `west`, `east`, `north` order and ten columns
per row. Every cell is 64x128 with the foot pivot fixed at `(32,120)`. Columns `0–1` are idle,
`2–7` are six walk phases, and `8–9` are two interact poses. Keep all 40 cells independently
readable. Draw the east row independently; do not mirror the west row.

## Style lock

The exact user-provided image
`art/references/user-provided/character_style_authority_20260722_v1.png` (`sourceId`
`user_character_style_authority_20260722_v1`, SHA-256
`446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932`) is the resident's **sole**
character-style authority. Verify the same path and digest in
`art/contracts/user-provided-images.json` before generation. Follow it and
`00_common_fable5_character_sheet_style.md` for crisp pixel clusters, stable head/body
proportions, contour weight, restrained 2–3-step shading, a clear silhouette, transparent
surroundings, and no soft anti-aliasing. Preserve the same resident across all directions and
animation phases; only facing and action phase may change.

Borrow the authority image's *construction grammar*, not its person: chibi 2.5–3 head-height
proportions, a large head relative to the body, minimal almond-shaped eyes with a single small
highlight and no rendered iris/eyebrow detail, and a continuous dark (not flat-black) contour line
around the silhouette and between major colour fields (see the fuller observed-description block in
`character.player.prompt-draft.md` if a copy of that reasoning is useful). The resident must read as
a visibly different individual from that elderly gray-haired, gray-bearded, green-robed reference —
different hair colour/style and a different, plainer garment silhouette — while matching its pixel
density, proportion system, and shading-step count exactly. Suggested (not locked) signifiers: plain
practical daily-wear such as a simple tunic/shirt and trousers or a work dress, a muted, low-contrast
colour set that still sits correctly under the twilight ambient light of `target-town-user-direct-v1.png`,
no held prop required (the interact pose can be a simple greeting/gesture instead).

Do not use any historical character candidate, generated sheet, or deployed asset as a visual
reference, comparison authority, derivation input, or runtime-promotion source. No text, UI,
labels, borders, checkerboard, watermark, or chroma-key residue may remain in the final sheet.

## Per-row content

- **south:** relaxed local idle; a grounded six-phase walk; two small daily-life or greeting
  interact poses with no profession-specific prop requirement.
- **west / east:** reproject the same person and clothing, preserving anatomical consistency;
  east is newly drawn rather than flipped.
- **north:** same idle, walk, and interact logic from behind, with the resident still legible by
  silhouette.

Formal Asset Forge intake/mechanical validation, human review, promotion, export, and runtime use
remain required for a future new candidate. No historical candidate carries forward.
```

## 5. よくある失敗と回避法(すべて実証済みの根拠つき)

| # | 失敗 | 根拠 | 回避法 |
|---|---|---|---|
| 1 | east行がwest行と同じ向きのまま(反転すらしていない) | 画風authority画像自身のrow2で確認、かつ実際のimage_gen生成3/3例(innkeeper/town-clerk/resident)で再現。メカニカルチェックはこれを検出しない | east行を生成/レビューするとき、必ず人間の目で「体・鼻先・足の運びが右(東)を向いているか」を直接確認する。authority画像のrow2を参考にしない |
| 2 | east行がwest行の単純な水平ミラー | 仕様上も明示的に禁止(持ち手・非対称ディテールが逆になる) | 小道具や非対称な衣装ディテールがある場合、同じ手・同じ側に来るよう新規に描く |
| 3 | footPivotのずれ(pivot drift) | 過去候補4/4体がこの検査で不合格、列8-9(interact)が最頻出 | 各フレームで軸足のつま先/かかとの接地点をx=32・y=120に正確に置く。特にinteract(会話・作業)ポーズは重心が動きやすいので個別に確認する。生成後は2章の数式通りに機械チェックしてから提出する |
| 4 | 歩行途中フレームでfootPivot行(y=120)に不透明ピクセルが1つも無い | 過去候補で "no opaque sole pixels at the pivot row" として複数回観測 | 「両足が地面から離れる」演出をしても、どちらかの足の何らかの部分がy=120に触れているように描く |
| 5 | NPCがplayer(authority画像の人物)と同一人物になってしまう | innkeeper過去候補で実際に発生(髪色・髭・ローブが酷似) | 髪色・髪型・ひげの有無・衣装のシルエットと色を最低限変える。「衣装を隠して顔と髪だけ比べても別人と分かるか」を自問する |
| 6 | 出力サイズが640×512ちょうどにならない | ほぼすべてのimage_genツールが固定プリセットしか持たない | 2章の手順(5:4アスペクト比を保った生成→パディング→均等リサイズ→再測定)を必ず経由する。取り込みコマンドはリサイズを一切行わない |
| 7 | クロマキー/透過の縁残り | メカニカルチェックは完全一致のマゼンタしか検出しない狭い実装 | 400%以上にズームして目視確認する。マゼンタ以外の透過(true alpha)が使えるならそちらを優先する |
| 8 | 文字・枠・チェッカーボード・番号などの焼き込み | 仕様で明示的に禁止 | プロンプトの negative constraints をそのまま維持する。生成後、四隅と各セルの縁を目視確認する |
| 9 | 歩行6枚のうち実は同じフレームが混在している | メカニカルチェックは6枚全てが相異なることを要求する | 6フェーズの歩行サイクルを機械的な使い回しにせず、各フェーズで脚・腕の位置を変える |
| 10 | 背景(target-town)内の小さな人影を画風の見本にしてしまう | 1.2節で発見。あれはtarget-townの環境の一部で、画風authorityではない | 画風はauthority画像だけから取る。target-townからは光源方向と陰影の密度だけを参照する |

## 6. 生成後の検収手順(実際に動作確認したコマンド)

すべて `tools/asset-forge/` ディレクトリ内で実行する(3.1節参照。リポジトリルートから実行する場合は `npm --prefix tools/asset-forge run ...` を使う)。手順自体は `tools/asset-forge/contracts/fable5-prefab/README.md`「Lifecycle and remaining human gates」の記載を、実際に動かして裏取りしたもの。

```sh
cd tools/asset-forge

# 1) ジョブパックのプレフライト確認(ピクセルは作らない)
npm run make-fable5-character-job -- --asset char_player --dry-run

# 2) 実際にジョブパック(プロンプト/参照/出力契約の束)を書き出す。まだ画像は生成しない
npm run make-fable5-character-job -- --asset char_player
#   → generated/jobs/<job-id>/job-pack.json ができる。job-id は毎回変わる

# 3) ここでCodexのimage_genを使って実際にPNGを生成する(このツールはこの手前までしか自動化しない)。
#    生成後、2章の手順で640x512ちょうど・RGBA・実アルファに整える

# 4) 取り込み前に必ずdry-runでメカニカルチェックだけを走らせる(候補ファイルはまだ動かさない)
npm run import-fable5-character -- \
  --asset char_player \
  --file /absolute/path/to/candidate.png \
  --job-pack generated/jobs/<job-id>/job-pack.json \
  --dry-run
#   実際に検証済み: サイズ不一致・pivotドリフト・eastの完全ミラー・空セル・
#   歩行6枚の重複・クロマ残りを、この時点で機械的に拒否する
#   (このリポジトリの過去候補4体は全てこのチェックで不合格になることを実際に確認済み——1.3節)

# 5) dry-runが通ったら --dry-run を外して実行し、pending領域に取り込む
npm run import-fable5-character -- \
  --asset char_player \
  --file /absolute/path/to/candidate.png \
  --job-pack generated/jobs/<job-id>/job-pack.json
#   → generated/characters/pending/ に候補PNG+メタデータが置かれる。
#   この時点でも approval/runtime は一切許可されない(pending-inspectionのまま)
```

ここから先(人間レビュー〜承認〜runtime配線)は、このブリーフの担当範囲外だが、参考として記載する:

6. **人間による目視レビューが必須**(`tools/asset-forge/review/fable5-runtime-assets/character-style-lock-20260722.md` に基づく基準、実ファイルを読んで確認):
   - authority画像と候補を400%以上のズーム/nearest-neighborで並べて見る。
   - ピクセルクラスタの密度・輪郭の太さがauthorityと一致しているか。
   - 頭身比・顔の構成・手足の太さの文法が一致しているか。
   - パレットの圧縮度と2〜3段階の陰影言語が一致しているか(柔らかい・絵画的なレンダリングになっていないか)。
   - 髪型・衣装・持ち物が4方向×10列すべてで一貫しているか。
   - player・town clerk・resident・(新)innkeeperが、target-townの光の中で「同じ画家が描いた一つのキャストに見えるか」。
7. 承認は `review/provenance/character.*.candidate-provenance-draft.json` への記入と、`character-style-lock` スコープを含む人間の承認記録が必要(このツールに承認コマンドは無い——人間が記録するのみ)。
8. runtime配線は `freeze-fable5-runtime-ledger` / `verify-fable5-runtime-ledger` で行うが、いずれも人間承認後にのみ実行される。**これらは他エージェント担当領域(`public/fable5-v2/`)に触れるため、本ブリーフでは実行しない。**

## 7. このブリーフの対象外(明示的にやらないこと)

- 絵の実生成(Codexの仕事)。
- 候補の承認・却下・promotion・export・runtime配線。
- `public/fable5-v2/` および `test/` 配下の変更(他エージェントが作業中のため一切触れていない)。
- gitコミット。

## 8. 参照ファイル一覧(このブリーフの一次情報源)

- `art/references/user-provided/character_style_authority_20260722_v1.png` — 画風/識別authority(実在・ハッシュ確認済み)
- `public/fable5-v2/assets/world/target-town-user-direct-v1.png` — 陰影/光源参照(実在・ハッシュ確認済み)
- `art/contracts/user-provided-images.json` — 上記2点の正式な出自台帳
- `Fable5PrefabSpec.md` 第6節・第7節 — シート仕様の正本
- `docs/qa/evidence-matrix.md` — ルーブリック・Hard Gateの正本
- `tools/asset-forge/src/fable5-prefab-character-intake.mjs` — メカニカル検収の実装(実際に読み、実際に実行した)
- `tools/asset-forge/src/fable5-prefab-character-jobs.mjs` — ジョブパック組み立ての実装
- `tools/asset-forge/src/cli.mjs` — コマンド一覧の実装
- `tools/asset-forge/prompts/fable5-prefab/00_common_fable5_character_sheet_style.md` — 共通プロンプト(今回改訂)
- `tools/asset-forge/prompts/fable5-prefab/character.{player,innkeeper,resident,town-clerk}.prompt-draft.md` — 各キャラプロンプト(今回改訂)
- `tools/asset-forge/contracts/fable5-prefab/character.{player,innkeeper,resident,town-clerk}.contract-draft.json` — 各キャラの機械可読契約(既存、構造を確認済み・未変更)
- `tools/asset-forge/contracts/fable5-prefab/README.md` — 手順の正本(今回コマンドの注記を追加)
- `tools/asset-forge/review/fable5-runtime-assets/character-style-lock-20260722.md` — 人間レビュー基準
- `tools/asset-forge/review/fable5-runtime-assets/style-authority-20260722-v1/` — 過去の生成候補4体(pending、未承認。今回の失敗事例の一次証拠)
- `docs/fable5-codex-sprite-handoff.md` — 短い状態台帳(既存、本ブリーフはこれを補完する)
