// 返り値の仕上げ。施設の追加後に監視情報を補い、先に追加した施設からモジュールをまとめる。
export function finishFacilities(S) {
  const { facilities, groups } = S;
  // 酒場の名簿の「じょうたい」: 記録・見張り（見張り台）があるか
  const pubF = facilities.find((f) => f.archetype === 'pub'), tower = facilities.find((f) => f.archetype === 'watchtower');
  if (pubF) Object.assign(pubF.facts, { watchtower: !!tower, watchTools: tower ? tower.facts.tools.slice(0, 4) : [] });

  // 施設が丸ごと覆うモジュール（全ファイルがその施設の証拠）は、施設の建物にまとめる
  const taken = new Set();
  for (const f of facilities) {
    const set = new Set(f.noMerge ? [] : f.all);
    delete f.noMerge;
    f.merged = [];
    for (const g of groups) {
      if (g.path === '.' || taken.has(g.path) || !g.files.length) continue;
      if (g.files.every((x) => set.has(x.path))) { f.merged.push(g.path); taken.add(g.path); }
    }
    delete f.all;
  }
  return facilities;
}
