// 門の話し方を独立して確認できるよう、台詞をここにまとめる。
import { fmtInt } from '../../util.js';
import { listJa, q } from '../text.js';

  // 門番: where travellers from outside come in (the inn's evidence, the reception routes, login tools).
  // Never says the town is really open to the outside: a deploy setting is not proof, and we did not check.
export const gateVoice = {
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
};
