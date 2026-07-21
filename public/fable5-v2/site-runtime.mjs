export class AssetContractError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'AssetContractError';
    this.issues = Object.freeze([...issues]);
  }
}

export const PRODUCTION_ASSETS = Object.freeze({
  worldMaster: Object.freeze({
    id: 'target-town-user-direct-v1',
    url: '/fable5-v2/assets/world/target-town-user-direct-v1.png',
    width: 1586,
    height: 992,
    bytes: 3200516,
    sha256: '39102cbaed6745d658b8449cc7197f8454fb8492b4679f288de16c204e82d607',
    role: 'exact user-direct whole-world runtime background'
  }),
  player: Object.freeze({
    id: 'player-green-8walk-v4',
    url: '/fable5-v2/assets/characters/player-green-8walk-v4.png',
    width: 576,
    height: 512,
    bytes: 118169,
    sha256: 'f55e954d04304fd0c05c329b2477ef4980d50f23b172823aea7c912fe553f913',
    role: 'user-source-derived green character, 4 directions × idle plus 8 planted-foot 64×128 walk phases with common head/sole rhythm'
  }),
  bartender: Object.freeze({
    id: 'innkeeper-talk-4frame-v2',
    url: '/fable5-v2/assets/characters/innkeeper-talk-4frame-v2.png',
    width: 384,
    height: 64,
    bytes: 19270,
    sha256: '19fbe607d0e085d7dc969a682d3175c2eaf458cf63f0b1b88e9724a1c63ba63e',
    role: 'imagegen innkeeper bust, four same-style idle and speaking frames'
  }),
  innExteriorClosed: Object.freeze({
    id: 'target-town-inn-exterior-closed-v1',
    url: '/fable5-v2/assets/objects/target-town-inn/inn-exterior-closed-v1.png',
    width: 397,
    height: 402,
    bytes: 309447,
    sha256: '9e6ed907784281579e26308fbdede7784054d749bb43800e75ee9e7038b1438a',
    role: 'roof-closed exterior overlay shown only before entering the inn'
  }),
  innCounterClean: Object.freeze({
    id: 'inn-counter-clean-plate-v1',
    url: '/fable5-v2/assets/objects/target-town-inn/inn-counter-clean-plate-v1.png',
    width: 49,
    height: 57,
    bytes: 5344,
    sha256: 'f68b3a44ca25e741fd105e3b29c00273560f1f6de759cb6150e0e762350439f1',
    role: '49x57 background-only repair plate that removes the baked source bartender before the runtime NPC is drawn'
  }),
  entranceForeground: Object.freeze({
    id: 'target-town-inn-entrance-foreground-v1',
    url: '/fable5-v2/assets/objects/target-town-inn/entrance-foreground-v1.png',
    width: 151,
    height: 89,
    bytes: 16765,
    sha256: '8934e3a8b29b9b71c04e08ac33a054a25bdf245bd9752bdc3e77c2302855354a',
    role: 'exact source-pixel foreground occlusion object at the inn entrance'
  }),
  routeStreetlamp: Object.freeze({
    id: 'target-town-route-streetlamp-foreground-v1',
    url: '/fable5-v2/assets/objects/target-town-streetlamp/route-streetlamp-foreground-v1.png',
    width: 53,
    height: 162,
    bytes: 10590,
    sha256: '4b40d527e7d621198c2bef221d812d6cc7da84fc8ca8fb12eeea21e75b96187e',
    role: 'exact source-pixel depth-sorted foreground on the n=1 route'
  }),
  dialogueSheet: Object.freeze({
    id: 'ui-dialogue-frames',
    url: '/fable5-v2/assets/ui/ui_dialogue_frames.png',
    width: 1448,
    height: 1086,
    bytes: 2799709,
    sha256: '60a2255fe72e2e96c91f00caa93fa7f4906f57fc1f8f0332bdbe91648b9ba29d',
    role: 'retained fixed-crop dialogue source'
  }),
  speechBubble: Object.freeze({
    id: 'speech-bubble-transparent-v2',
    url: '/fable5-v2/assets/ui/speech-bubble-transparent-v2.png',
    width: 202,
    height: 124,
    bytes: 54670,
    sha256: '77293c248ec7b1d1c709585d83c558278f8ff6150c0341cca79847b7bc86208e',
    role: 'user-provided speech UI with only edge-connected matte made transparent'
  }),
  dialogueFrame: Object.freeze({
    id: 'dialogue-frame-transparent-v2',
    url: '/fable5-v2/assets/ui/dialogue-frame-transparent-v2.png',
    width: 370,
    height: 180,
    bytes: 150495,
    sha256: '43bc459d09e330fbbe14f40b6916089ad4e17634e4eb69f476f55e21240ecc7a',
    role: 'user-provided dialogue UI with only edge-connected matte made transparent'
  })
});

export const DIALOGUE_CROPS = Object.freeze({
  frame: Object.freeze({
    x: 497,
    y: 47,
    width: 370,
    height: 180,
    safeInsets: Object.freeze({ left: 24, top: 22, right: 24, bottom: 40 })
  }),
  speechBubble: Object.freeze({
    x: 15,
    y: 600,
    width: 202,
    height: 124,
    safeInsets: Object.freeze({ left: 20, top: 18, right: 20, bottom: 36 })
  }),
  choicePointer: Object.freeze({ x: 29, y: 542, width: 32, height: 24 }),
  continueMarker: Object.freeze({ x: 449, y: 549, width: 24, height: 13 })
});

function decodeImage(contract, sourceUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      callback(value);
    };
    const timer = window.setTimeout(() => {
      finish(reject, new AssetContractError(
        `${contract.id} の読み込みが時間内に完了しませんでした。`,
        [`${contract.url} — expected ${contract.width}×${contract.height}`]
      ));
    }, timeoutMs);
    image.onload = () => {
      if (image.naturalWidth !== contract.width || image.naturalHeight !== contract.height) {
        finish(reject, new AssetContractError(
          `${contract.id} の寸法がasset contractと一致しません。`,
          [`${contract.url}: actual ${image.naturalWidth}×${image.naturalHeight}, expected ${contract.width}×${contract.height}`]
        ));
        return;
      }
      finish(resolve, image);
    };
    image.onerror = () => finish(reject, new AssetContractError(
      `${contract.id} を読み込めませんでした。代替画像では続行しません。`,
      [`missing or unreadable: ${contract.url}`, `${contract.role}; ${contract.width}×${contract.height}`]
    ));
    image.decoding = 'async';
    image.src = sourceUrl;
  });
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifiedImagePromise(contract, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AssetContractError('画像照合の制限時間が不正です。', [`timeoutMs: ${timeoutMs}`]);
  }
  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(contract.url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new AssetContractError(`${contract.id} を読み込めませんでした。`, [
        `${contract.url}: HTTP ${response.status}`
      ]);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(contentLength) || contentLength !== contract.bytes) {
      throw new AssetContractError(`${contract.id} の容量が承認済み画像と一致しません。`, [
        `${contract.url}: actual Content-Length ${response.headers.get('content-length') ?? 'missing'}`,
        `expected bytes ${contract.bytes}`
      ]);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== contract.bytes) {
      throw new AssetContractError(`${contract.id} の実データ容量が一致しません。`, [
        `${contract.url}: actual bytes ${bytes.byteLength}, expected ${contract.bytes}`
      ]);
    }
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== contract.sha256) {
      throw new AssetContractError(`${contract.id} の内容が承認済み画像と一致しません。`, [
        `${contract.url}: actual SHA-256 ${actualSha256}`,
        `expected SHA-256 ${contract.sha256}`
      ]);
    }
    const objectUrl = URL.createObjectURL(new Blob(
      [bytes],
      { type: response.headers.get('content-type') ?? 'image/png' }
    ));
    try {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new AssetContractError(`${contract.id} の照合が時間内に完了しませんでした。`, [contract.url]);
      }
      return await decodeImage(contract, objectUrl, remainingMs);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    if (error instanceof AssetContractError) throw error;
    throw new AssetContractError(`${contract.id} の照合に失敗しました。`, [
      `${contract.url}: ${error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error)}`
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loadProductionAssets({ timeoutMs = 15000 } = {}) {
  const entries = Object.entries(PRODUCTION_ASSETS);
  const settled = await Promise.allSettled(entries.map(([, contract]) => verifiedImagePromise(contract, timeoutMs)));
  const failures = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    const contract = entries[index][1];
    const details = Array.isArray(result.reason?.issues) ? result.reason.issues : [String(result.reason?.message ?? result.reason)];
    return [`${contract.id}: ${details.join(' / ')}`];
  });
  if (failures.length > 0) {
    throw new AssetContractError('production画像アセットが揃っていないため、ゲームを開始できません。', failures);
  }
  return Object.freeze(Object.fromEntries(entries.map(([key], index) => [key, settled[index].value])));
}

export function drawWorldImage(context, image) {
  context.drawImage(image, 0, 0);
}

export function drawCharacterFrame(context, image, frame, foot, { alpha = 1 } = {}) {
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(
    image,
    frame.sx,
    frame.sy,
    frame.sw,
    frame.sh,
    Math.round(foot.x - 32 + (frame.offsetX ?? 0)),
    Math.round(foot.y - 120 + (frame.offsetY ?? 0)),
    64,
    128
  );
  context.restore();
}

// Crops are always drawn at their native source dimensions. Supplying a
// destination size is intentionally unsupported so gold borders cannot stretch.
export function drawNativeCrop(context, image, crop, destinationX, destinationY) {
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    Math.round(destinationX),
    Math.round(destinationY),
    crop.width,
    crop.height
  );
}
