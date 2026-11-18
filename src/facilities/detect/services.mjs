import { collectEnvironment } from '../env.mjs';
import { detectDojo } from '../dojo.mjs';
import { detectDock } from '../dock.mjs';
import { detectGate, detectInn } from '../gate-inn.mjs';
import { detectPub } from '../pub.mjs';
import { detectWarehouse } from '../warehouse.mjs';
import { detectWatchtower } from '../watchtower.mjs';

// 各施設の判定と追加。宿屋から門までの順序と、施設間で共有する証拠を保つ。
export function addServiceFacilities(S) {
  const { files, history, extra, byBase, named, depHits, read, prod, servers, examples, pkgJsons, workflows,
    envInCode, loaderSrc, hostsSeen, webhooks, routeList, sqliteSrc, stats, facilities, add, dockManifests, deps } = S;
  const { root, isGit, keyer, refTime } = extra;
  // --- 宿屋: 公開Webサービス ---
  let entry = null;          // 外から人が入る入口の証拠（門も同じものを見る）
  const inn = detectInn({ files, byBase, named, depHits, read, prod, servers });
  if (inn) {
    add('inn', '宿屋', inn.reason, inn.evidence, inn.facts);
    entry = inn.entry;
  }

  // --- 井戸と酒場の名簿で使う: 設定の名前（env）。値は読まない・出さない ---
  const environment = collectEnvironment({
    files, examples, pkgJsons, workflows, read, depHits, prod, isGit, envInCode, loaderSrc,
  });
  const { exampleSet, envNames, workflowText } = environment;

  // --- 酒場: API・外部接続・LLM・webhook ---
  const pub = detectPub({
    files, depHits, hostsSeen, webhooks, prod, envNames, exampleSet, examples, routeList,
  });
  if (pub) add('pub', '酒場', pub.reason, pub.evidence, pub.facts);

  // --- 倉庫: DB・storage ---
  const warehouse = detectWarehouse({ files, depHits, sqliteSrc });
  if (warehouse) add('warehouse', '倉庫', warehouse.reason, warehouse.evidence, warehouse.facts);

  // --- 見張り台: logs・monitoring ---
  const watchtower = detectWatchtower({ files, depHits });
  if (watchtower) add('watchtower', '見張り台', watchtower.reason, watchtower.evidence, watchtower.facts);

  // --- 道場: test・E2E ---
  const dojo = detectDojo({
    files, named, depHits, read, pkgJsons, history, keyer, stats, root, refTime, extra,
  });
  if (dojo) {
    add('dojo', '道場', dojo.reason, dojo.evidence, dojo.facts, dojo.extraStats);
    facilities[facilities.length - 1].all = dojo.all;
  }

  // --- 井戸: env・secrets・config（生活インフラ）。外に建物を持たない（広場の井戸と井戸番） ---
  if (environment.well) {
    add('well', '井戸', environment.well.reason, environment.well.evidence, environment.well.facts);
    facilities[facilities.length - 1].noMerge = true;      // 建物が無いので、モジュールをまとめない
  }

  // --- 船着場: アプリ・パッケージの配布（外の島へ届ける場所） ---
  const dock = detectDock({ files, dockManifests, workflowText, read });
  if (dock) add('dock', '船着場', dock.reason, dock.evidence, dock.facts);

  // --- 門: 外から旅の人が入ってくる入口（宿屋と同じ証拠に、受付の道とログインの道具を添える）。外に立つ施設 ---
  // 公開の設定があっても、本当に外に開いているかは分からない（確かめていない）
  const gate = detectGate({ entry, routeList, deps, prod, servers });
  if (gate) {
    add('gate', '門', gate.reason, gate.evidence, gate.facts);
    facilities[facilities.length - 1].noMerge = true;      // 建物が無いので、モジュールをまとめない
  }
}
