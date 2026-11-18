// 施設の台詞から補助処理とアプリ名の表記を分け、同じ言い方を保つ。
import { fmtInt } from '../../util.js';
import { dateJa, q } from '../text.js';

export const recoveryDetail = (detail) => {
  const text = String(detail ?? '').replace(/。+$/, '');
  if (!text) return '';
  return /ある$/.test(text) ? `${text}。` : `${text}という記述がある。`;
};

export const dojoStatusLines = (f) => {
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

export const APP_JA = {
  iOS: 'iPhone のアプリ', macOS: 'Mac のアプリ', Apple: 'Apple の機械のアプリ', Android: 'Android のアプリ', Expo: 'スマホのアプリ（Expo）',
  'React Native': 'スマホのアプリ（React Native）', Electron: 'パソコンのアプリ（Electron）', Tauri: 'パソコンのアプリ（Tauri）',
  Capacitor: 'スマホのアプリ（Capacitor）', Flutter: 'スマホのアプリ（Flutter）', 'Browser extension': 'ブラウザの拡張機能',
  'VS Code extension': 'VS Code の拡張機能',
};
