import { overlayGround } from '../terrain.mjs';
import { layoutKey } from './identity.mjs';
// 道場の元の札と入力の診断を引き継ぎ、配置先と表示用データを同じ順に作る。
const sign = (p) => ['sign-passed', 'sign-failed', 'sign-unverified'].includes(p.type);

export function initializeOverlay(S) {
  const { base, overlay } = S;
  const hideDojoSigns = overlay.markers.some((m) => m.kind === 'record');
  const nativeSigns = base.props.filter(sign).map((p, i) => ({ ...p, overlayId: `native:dojo:${i}` }));
  const town = { ...base, ground: overlayGround(base), props: base.props.filter((p) => !sign(p)),
    unplaced: [...(base.unplaced || []).filter((u) => !u.overlay), ...overlay.rejected] };
  if (!hideDojoSigns) town.props.push(...nativeSigns);
  const data = { version: 1, layoutKey: layoutKey(overlay),
    ...(overlay.source ? { source: overlay.source } : {}), ...(overlay.title ? { title: overlay.title } : {}),
    hideDojoSigns, markers: [], people: [], goal: null, props: hideDojoSigns ? [] : [...nativeSigns], unplaced: [] };
  Object.assign(S, { town, data });
}
