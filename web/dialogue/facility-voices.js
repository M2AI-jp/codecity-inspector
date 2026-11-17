// 施設の番人の言い方。facility.facts にある事実だけを話す。
import { fmtInt } from '../util.js';
import { base, dateJa, listJa, nPeople, q, san, shortSubject, whenJa } from './text.js';
import { count } from './contents.js';

const dojoStatusLines = (f) => {
  const r = f.latestRecord;
  const when = r && dateJa(r.mtime);
  const tool = r && r.tool ? q(r.tool) : '検査道具';
  if (f.state === 'passed' && r) {
    return [`最後の検査は${when ? `${when}、` : ''}${tool}の記録で失敗0件です。そのあと変更はありません。`];
  }
  if (f.state === 'failed' && r) {
    return [
      `最後の検査は${when ? `${when}、` : ''}${tool}の記録で${fmtInt(r.failures)}件が通っていません。`,
      '外部工務店の完成報告は自己申告で、検査の記録には数えていません。',
    ];
  }
  if (f.state === 'unverified') {
    return r
      ? [`最後の検査（${when || '日時不明'}）のあとに変更があるので、いまの形はまだ確かめていません。`,
        '外部工務店の完成報告は自己申告で、検査の記録には数えていません。']
      : ['検査の記録が見当たりません。', '外部工務店の完成報告は自己申告なので、代わりに数えていません。'];
  }
  return [];
};

export const FACILITY_VOICE = {
  town_hall: {
    greet: ['ようこそ、役場へ。わたしは書記をしております。', 'いらっしゃいませ。こちらは役場の受付です。'],
    what: ['この街の記録は、ぜんぶここで預かっています。', 'この街の歩みを、一件ずつ帳面につけております。'],
    facts(f, town) {
      const out = [];
      if (f.commits) {
        const ppl = f.contributors ? (f.contributorsWindow ? `直近の${fmtInt(f.contributorsWindow)}件では${nPeople(f.contributors)}が手を入れています` : `手を入れた人は${nPeople(f.contributors)}です`) : '';
        out.push(f.shallow
          ? `この写しは浅いクローンで、手元にある記録はマージを除いて直近の${fmtInt(f.commits)}件だけです。${f.contributors ? `その中で手を入れた人は${nPeople(f.contributors)}です。` : ''}`
          : `記録されたコミットは、マージを除いて${fmtInt(f.commits)}件。${ppl ? `${ppl}。` : ''}`);
      }
      if (f.firstCommit && f.lastCommit) {
        out.push(dateJa(f.firstCommit) === dateJa(f.lastCommit)
          ? `記録の日付は、${dateJa(f.firstCommit)}です。`
          : `最初の記録は${dateJa(f.firstCommit)}、いちばん新しい記録は${dateJa(f.lastCommit)}です。`);
      }
      if (f.tags > 0 && f.latestTag) out.push(`節目の印（タグ）は${fmtInt(f.tags)}個。いちばん新しいのは${q(f.latestTag.name)}です。`);
      else if (f.tags === 0) out.push('節目の印（タグ）は、まだひとつもついていません。');
      // works in progress in the working tree (not yet committed)
      if (f.dirty > 0) out.push(`まだ記録していない変更が${fmtInt(f.dirty)}個あります。`);
      // 工事報告: commits made with an external code-generating agent. A self-report, never a reward.
      const ag = (Array.isArray(f.agents) ? f.agents : []).filter((a) => a && a.name && a.commits > 0);
      if (ag.length) {
        const list = ag.slice(0, 2).map((a) => `${a.name}から${fmtInt(a.commits)}件`);
        const win = f.contributorsWindow ? `直近の${fmtInt(f.contributorsWindow)}件のうち、` : '';
        out.push(`外部工務店からの工事報告も届いています。${win}${list.join('、')}${ag.length > 2 ? `、ほか${ag.length - 2}社` : ''}です。`);
        const dojo = town && (town.buildings || []).some((b) => b.facility && b.facility.archetype === 'dojo');
        out.push(`工事報告は、工務店の自己申告です。本当に動くかは、${dojo ? '道場で' : '動かして'}確かめましょう。`);
      }
      if (f.changelog) out.push(`変更の記録帳${q(f.changelog)}も、ここに保管しています。`);
      return out;
    },
    max: 6,
    close: ['記録のことなら、いつでもお尋ねください。', '帳面は、きちんとつけておきますね。'],
  },
  inn: {
    greet: ['いらっしゃいませ！宿屋へようこそ。', 'ようこそ、お疲れさまでした。宿屋の番頭でございます。'],
    what: ['ここは、外からのお客さんをお迎えする、この街の入口です。', '外から来るお客さんは、まずここに立ち寄られます。'],
    facts(f) {
      const out = [];
      if (f.servers && f.servers[0]) out.push(`お客さんは${q(f.servers[0].path)}でお迎えしています（${f.servers[0].how}）。`);
      if (f.domains && f.domains[0]) out.push(`表の看板は${q(f.domains[0])}。その住所でお店を出す段取りでございます。`);
      else if (f.deploy && f.deploy[0]) out.push(`${q(f.deploy[0])}の段取りで、表に店を出しております。`);
      if (f.frameworks && f.frameworks.length) out.push(`宿の造りは ${f.frameworks.slice(0, 2).join('、')} です。`);
      else if (f.configs && f.configs[0]) out.push(`宿の骨組みは${q(f.configs[0])}に書いてございます。`);
      if (f.pages && f.pages[0]) out.push(`最初にお見せするページは${q(f.pages[0])}です。`);
      return out;
    },
    close: ['どうぞ、ごゆっくり。', 'またのお越しを、お待ちしております。'],
  },
  pub: {
    greet: ['おう、酒場へようこそ。', 'いらっしゃい。まあ、座んな。'],
    what: ['この街と外をつなぐ連中が、ここに集まってる。', '外とつながる連中は、みんなここに顔を出すのさ。'],
    facts(f) {
      const out = [];
      const cs = Array.isArray(f.connectors) ? f.connectors : [];
      const names = cs.map((c) => c.name);
      if (names.length) {
        const first = names.slice(0, 4), rest = names.length - first.length;
        out.push(names.length === 1 ? `名簿に載ってるのは、${names[0]}だけだ。` : `名簿を読むぞ。${first.join('、')}${rest > 0 ? `、ほか${rest}組` : ''}。`);
      }
      const dep = cs.find((c) => c.via === 'dep' && c.paths && c.paths[0]);
      if (dep) {
        const same = cs.filter((c) => c.via === 'dep' && c.paths[0] === dep.paths[0]).map((c) => c.name).slice(0, 3);
        out.push(`${listJa(same)}の名前は、${q(dep.paths[0])}に載ってる。`);
      }
      const url = cs.find((c) => c.via === 'url' && c.paths && c.paths[0]);
      if (url) out.push(`${url.name}へは、${q(url.paths[0])}から使いを出してる。`);
      if (f.webhooks && f.webhooks[0]) out.push(`外からの知らせは${q(f.webhooks[0])}で受けてる。`);
      return out;
    },
    // the last line offers the guild roster (web/ui.js shows the choice under it)
    close: ['ここは接続者ギルドだ。名簿を見ていくかい？'],
    offer: 'roster',
  },
  warehouse: {
    greet: ['……倉庫だ。', 'ん。倉庫に用か。'],
    what: ['データをしまっておく場所だ。', 'ここには、街のデータがしまってある。'],
    facts(f) {
      const out = [];
      if (f.kinds && f.kinds.length) out.push(`しまい方は ${f.kinds.slice(0, 4).join('、')}。`);
      if (f.sqlFiles > 0) out.push(`SQL のファイルが${count(f.sqlFiles)}。`);
      if (f.migrations > 0) out.push(`棚の作りかえの手順（migrations）が${fmtInt(f.migrations)}件。`);
      if (f.configs && f.configs[0]) out.push(`棚の並べ方は${q(f.configs[0])}に書いてある。`);
      if (f.dataFiles && f.dataFiles[0]) out.push(`データの箱${q(f.dataFiles[0])}も、ここにある。`);
      else if (f.sqliteCode && f.sqliteCode[0]) out.push(`${q(f.sqliteCode[0])}が、SQLite の箱を開け閉めしてる。`);
      return out;
    },
    close: ['勝手に棚をいじるなよ。', '以上だ。'],
  },
  watchtower: {
    greet: ['止まれ。……なんだ、旅の人か。', 'しっ。見張りの最中だ。'],
    what: ['ここは見張り台。街で起きたことを記録して、見張っている。', '街の動きは、ここから見張っている。'],
    facts(f) {
      const out = [];
      if (f.tools && f.tools.length) out.push(`見張りの道具は ${f.tools.slice(0, 4).join('、')} だ。`);
      if (f.logDirs && f.logDirs[0]) out.push(`記録（ログ）は${q(f.logDirs[0])}にためてある。`);
      if (f.configs && f.configs[0]) out.push(`見張りの段取りは${q(f.configs[0])}に書いてある。`);
      return out;
    },
    close: ['異変があれば、すぐに知らせる。', '気をつけて行け。'],
  },
  dojo: {
    greet: ['ようこそ、道場へ。', 'お静かに。ここは道場です。'],
    what: ['ここでは、街のしくみが本当に動くかを確かめています。', '動くと言われたものを、実際に動かして確かめる場所です。'],
    facts(f) {
      const out = dojoStatusLines(f);
      if (f.files > 0) out.push(`試験（テスト）のファイルが${fmtInt(f.files)}個あります。`);   // test files, helpers included (not test cases)
      if (f.runners && f.runners.length) out.push(`確かめる道具は ${f.runners.slice(0, 2).join('、')} です。`);
      if (f.dirs && f.dirs.length) out.push(`稽古場は${f.dirs.slice(0, 2).map(q).join('と')}です。`);
      if (f.latest && f.latest.subject) {
        const w = whenJa(f.latest.date);
        out.push(`最近の稽古は${w ? `${w}、` : ''}${f.latest.author ? san(f.latest.author) : 'だれか'}の『${shortSubject(f.latest.subject)}』です。`);
      }
      return out;
    },
    close: ['動くと言うなら、確かめてからにしましょう。', '確かめたことだけが、本当のことです。'],
  },

  // 修理小屋: evidence is a sign that a return path was written down, not proof that it works.
  repair: {
    greet: ['いらっしゃい。修理小屋の職人だ。', 'こんばんは。修理小屋へようこそ。'],
    what: ['壊れたときに戻す手がかりを、ここで預かっている。', '作った所のそばで、切り戻しと復旧の手順を見張っているんだ。'],
    facts(f) {
      const out = [];
      const deployment = Array.isArray(f.deployment) ? f.deployment : [];
      const database = Array.isArray(f.database) ? f.database : [];
      const backup = Array.isArray(f.backup) ? f.backup : [];
      const runbook = Array.isArray(f.runbook) ? f.runbook : [];
      if (deployment[0]) out.push(`デプロイを切り戻す証拠は${q(deployment[0].path)}にある。${deployment[0].detail}という記述だ。`);
      if (database[0]) out.push(`DBを戻す証拠は${q(database[0].path)}にある。${database[0].detail}の手順が見つかった。`);
      if (backup[0]) out.push(`バックアップの手がかりは${q(backup[0].path)}にある。${backup[0].detail}。`);
      if (runbook[0]) out.push(`復旧の手順書は${q(runbook[0].path)}だ。${runbook[0].detail}がある。`);
      out.push('ここで見つけたのは、戻す手段を書いた証拠だけだ。本当に戻せるかは、ここでは確かめていないんだ。');
      return out;
    },
    max: 5,
    close: ['壊れたときほど、手順書を落ち着いて確かめてくれ。'],
  },

  // 井戸番: the settings (env) the town draws from its well. Names only; values are never read.
  well: {
    greet: ['やあ、井戸へようこそ。わたしは井戸番だよ。', 'こんばんは。井戸の番をしているよ。'],
    what: ['この井戸から、街が動くのに使う「設定」をくんでいるんだ。', 'この街は、ここから「設定」の水をくんで動いているんだよ。'],
    facts(f, town) {
      const out = [];
      const names = Array.isArray(f.names) ? f.names : [];
      const total = Math.max(f.namesTotal | 0, names.length);
      if (names.length) {
        const shown = names.slice(0, names.length > 3 ? 2 : 3);
        out.push(total > shown.length
          ? `この街が使う設定の名前は、${shown.join('、')}など、見つかっただけで${fmtInt(total)}個だよ。`
          : `この街が使う設定の名前は、${listJa(shown)}だよ。`);
      }
      const past = Array.isArray(town?.canal?.past) ? town.canal.past.filter(Boolean) : [];
      if (past.length) out.push(`水路は${past.map(q).join('、')}のそばを通っているよ。そこが、設定の名前をいちばん多く読む所だからだよ。`);
      if (f.examples && f.examples[0]) out.push(`書き方の見本は${q(f.examples[0])}にあるよ。`);
      else if (names.length) out.push('書き方の見本（.env.example）は、見当たらないね。');
      if (f.committed && f.committed[0]) {
        out.push(`秘密の鍵が入っているかもしれないファイル（${base(f.committed[0])}）が記録に入っています。`);
        out.push('わたしは中身をのぞいていないよ。気になったら、確かめてみてね。');
      }
      if (f.loaders && f.loaders.length) out.push(`水をくみ上げる道具は ${f.loaders.slice(0, 2).join('、')} だよ。`);
      if (f.ciSecrets && f.ciSecrets.length) out.push(`自動の仕事（CI）は、${f.ciSecrets[0]}${f.ciSecrets.length > 1 ? 'などの' : 'という'}鍵を使うよ。`);
      if (f.configs && f.configs[0] && out.length < 4) out.push(`設定のファイルは${q(f.configs[0])}にもあるよ。`);
      return out;
    },
    max: 5,
    close: ['水の味（設定の中身）は、わたしも知らないんだ。名前だけ知ってるのさ。'],
  },
  // 門番: where travellers from outside come in (the inn's evidence, the reception routes, login tools).
  // Never says the town is really open to the outside: a deploy setting is not proof, and we did not check.
  gate: {
    greet: ['ようこそ。ここは外から旅の人が入ってくる門だよ。', 'こんばんは、旅の人。ここは外から人が入ってくる門だよ。'],
    what: ['わたしは門番。この門の番をしているんだ。', 'わたしは門番だよ。夜も、ここで門を見張っているんだ。'],
    facts(f) {
      const out = [];
      const dep = Array.isArray(f.deploy) ? f.deploy : [];
      const where = [];
      if (f.domains && f.domains[0]) where.push(`門の看板には${q(f.domains[0])}という住所が書いてあるよ。`);
      if (dep[0]) where.push(dep[0].name
        ? `${q(dep[0].path)}に、${dep[0].name} で門をあける段取りが書いてあるよ。`
        : `${q(dep[0].path)}に、外へ門をあける段取りが書いてあるよ。`);
      if (f.servers && f.servers[0]) where.push(`門をあけ閉めするのは${q(f.servers[0].path)}だよ（${f.servers[0].how}）。`);
      if (!where.length && f.frameworks && f.frameworks.length) where.push(`門の造りは ${f.frameworks.slice(0, 2).join('、')} だよ。`);
      const routes = (Array.isArray(f.routes) ? f.routes : []).map((r) => r && r.route).filter(Boolean);
      const total = Math.max(f.routesTotal | 0, routes.length);
      const auth = Array.isArray(f.auth) ? f.auth.map((a) => a && a.name).filter(Boolean) : [];
      out.push(...where.slice(0, routes.length && auth.length ? 1 : 2));     // 4〜7行に収める
      if (total === 1 && routes[0]) out.push(`外から声をかけられる受付は、${q(routes[0])}の1か所だよ。`);
      else if (total > 1 && routes.length) {
        const ex = [...new Set(routes)].slice(0, 2);
        out.push(`外から声をかけられる受付は、見つかっただけで${fmtInt(total)}か所。たとえば${ex.map(q).join('や')}だよ。`);
      }
      if (auth.length) out.push(`入る人を確かめる道具（ログイン）は、${listJa(auth.slice(0, 2))}が道具の一覧に載っているよ。`);
      out.push('でも、本当に外から入れるかは、ここでは確かめていないんだ。');
      return out;
    },
    max: 4,
    close: ['気をつけて、いってらっしゃい。', 'またいつでも通っておいで。'],
  },
  // 船頭: what is ready to ship out to other islands. Never says it was published (we have no evidence).
  dock: {
    greet: ['おう、船着場へようこそ。おれは船頭だ。', 'よう、旅の人。ここは船着場だ。'],
    what: ['ここから、この街でこしらえたものを、外の島へ運ぶんだ。', 'この街でこしらえたものは、ここから船で外へ出ていく。'],
    facts(f) {
      const out = [];
      const apps = Array.isArray(f.apps) ? f.apps : [];
      if (apps[0]) out.push(`${apps[0].path === '.' ? '街のおおもと' : q(apps[0].path)}に、${APP_JA[apps[0].kind] || `${apps[0].kind}のアプリ`}が積んである${apps.length > 1 ? `。ほかに${apps.length - 1}つ` : ''}。`);
      const pk = Array.isArray(f.packages) ? f.packages : [];
      if (pk[0]) {
        const label = `${pk[0].name}${pk[0].version ? ` ${pk[0].version}` : ''}`;
        out.push(`荷札には『${label}』と書いてある（${base(pk[0].path)}）。${pk.length > 1 ? `荷札はほかに${pk.length - 1}枚。` : ''}`);
      }
      if (f.bins && f.bins.length) out.push(`荷を開けると、${f.bins.slice(0, 2).map(q).join('と')}というコマンドが使えるようになる。`);
      if (f.publish && f.publish[0]) out.push(`出港の手順は${q(f.publish[0])}に書いてある。`);
      out.push(pk.length || (f.publish && f.publish.length)
        ? 'ただ、本当に船が出たかどうかは、ここからは分からねえ。'
        : 'ただ、まだ船を出す手順は見当たらねえな。');
      return out;
    },
    max: 5,
    close: ['届いたかどうかは、向こうの島で確かめてくれ。'],
  },
};

const APP_JA = {
  iOS: 'iPhone のアプリ', macOS: 'Mac のアプリ', Apple: 'Apple の機械のアプリ', Android: 'Android のアプリ', Expo: 'スマホのアプリ（Expo）',
  'React Native': 'スマホのアプリ（React Native）', Electron: 'パソコンのアプリ（Electron）', Tauri: 'パソコンのアプリ（Tauri）',
  Capacitor: 'スマホのアプリ（Capacitor）', Flutter: 'スマホのアプリ（Flutter）', 'Browser extension': 'ブラウザの拡張機能',
  'VS Code extension': 'VS Code の拡張機能',
};
