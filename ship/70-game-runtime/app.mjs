import {
  GameRuntimeError,
  startGameRuntime,
  validateSceneBundle,
} from './index.mjs';

const SCENE_PATH = './scene.json';
const REQUIRED_ELEMENTS = Object.freeze(['game-canvas', 'game-ui', 'game-status', 'game-error']);
const EXTERNAL_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;
const UNSAFE_PATH_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;

export class BrowserEntryError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'BrowserEntryError';
    this.code = code;
    this.cause = cause;
  }
}

function browserWindow(value = globalThis.window) {
  if (!value || !value.location || typeof value.location.href !== 'string' || typeof value.location.origin !== 'string') {
    throw new BrowserEntryError('WINDOW_REQUIRED', 'ブラウザの場所を確認できません。');
  }
  return value;
}

function sameOriginUrl(raw, windowObject, kind) {
  let resolved;
  try {
    resolved = new URL(raw, windowObject.location.href);
  } catch (error) {
    throw new BrowserEntryError('URL_INVALID', `${kind}の場所を確認できません。`, error);
  }
  if (resolved.origin !== windowObject.location.origin) {
    throw new BrowserEntryError('CROSS_ORIGIN_FORBIDDEN', `${kind}が同じ街の配布物ではありません。`);
  }
  return resolved;
}

function sceneError(issues = []) {
  const first = issues[0];
  if (!first) return 'scene.json の内容を確認できません。';
  const path = typeof first.path === 'string' ? first.path : '$';
  const labels = {
    FORMAT_INVALID: '形式が違います',
    SCHEMA_UNSUPPORTED: '対応していない版です',
    SCENE_FIELD_REQUIRED: '必要な項目がありません',
    BINDINGS_UNSUPPORTED: 'アセット結合の版が違います',
    ASSETS_REQUIRED: '承認済み素材がありません',
    GAME_REQUIRED: 'ゲーム設定がありません',
    UNKNOWN_FIELD: '許可されていない項目があります',
  };
  const message = labels[first.code] ?? '契約違反があります';
  return `scene.json の設計図が契約に合いません（${path}: ${message}）。`;
}

function imageError(asset, suffix) {
  const selector = typeof asset?.selector === 'string' && asset.selector.trim() !== '' ? asset.selector : '不明なアセット';
  return `承認済み素材「${selector}」を読み込めません${suffix ? `（${suffix}）` : ''}。`;
}

function errorText(error) {
  if (error instanceof BrowserEntryError) return error.message;
  if (error instanceof GameRuntimeError) {
    if (error.code === 'SCENE_BUNDLE_INVALID') return `街を開始できません。${sceneError(error.issues)}`;
    if (error.code === 'ASSET_LOAD_FAILED') {
      const detail = error.issues?.[0]?.message;
      return `街を開始できません。承認済み素材を読み込めません${detail ? `（${detail}）` : '。'}`;
    }
    if (error.code === 'STORAGE_REQUIRED' || error.code === 'PERSISTENCE_WRITE_FAILED') return 'このブラウザでは街の記録を保存できません。保存機能を有効にしてから再試行してください。';
    const runtimeLabels = {
      CANVAS_REQUIRED: '描画画面を準備できません',
      CANVAS_CONTEXT_REQUIRED: '描画機能を準備できません',
      UI_ROOT_REQUIRED: '操作表示を準備できません',
      ASSET_LOADER_REQUIRED: '承認済み素材の読み込み機能がありません',
      INPUT_TARGET_REQUIRED: '入力を受け取る画面がありません',
      CLOCK_REQUIRED: 'アニメーション時計を準備できません',
      PERSISTENCE_LIMIT: '保存データが大きすぎます',
    };
    return `街を開始できません（${runtimeLabels[error.code] ?? '実行契約に違反しました'}）。`;
  }
  if (error instanceof SyntaxError) return 'scene.json の形式を読み取れません。';
  if (error instanceof TypeError) return '街の配布物を読み込めません。配布物が揃っているか確認してください。';
  return '街を開始できません。配布物を確認してから再試行してください。';
}

function requiredElements(documentObject) {
  if (!documentObject || typeof documentObject.getElementById !== 'function') {
    throw new BrowserEntryError('DOCUMENT_REQUIRED', '画面を準備できません。');
  }
  const elements = Object.fromEntries(REQUIRED_ELEMENTS.map((id) => {
    const element = documentObject.getElementById(id);
    if (!element) throw new BrowserEntryError('DOM_REQUIRED', `画面要素「${id}」がありません。`);
    return [id, element];
  }));
  if (typeof elements['game-canvas'].getContext !== 'function') throw new BrowserEntryError('CANVAS_REQUIRED', '描画画面を準備できません。');
  return elements;
}

function localStorageFor(windowObject) {
  try {
    const storage = windowObject.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('localStorage unavailable');
    return storage;
  } catch (error) {
    throw new BrowserEntryError('STORAGE_REQUIRED', 'このブラウザの保存領域を利用できません。', error);
  }
}

/** Fetch the generated SceneBundle without accepting redirects or other origins. */
export async function fetchSceneBundle({ windowObject = globalThis.window, fetchImpl = null } = {}) {
  const activeWindow = browserWindow(windowObject);
  const sceneUrl = sameOriginUrl(SCENE_PATH, activeWindow, 'scene.json');
  if (fetchImpl !== null && typeof fetchImpl !== 'function') throw new BrowserEntryError('FETCH_REQUIRED', 'scene.json を読み込む機能がありません。');
  if (fetchImpl === null && typeof activeWindow.fetch !== 'function') throw new BrowserEntryError('FETCH_REQUIRED', 'scene.json を読み込む機能がありません。');
  const request = typeof fetchImpl === 'function'
    ? fetchImpl
    : (...args) => activeWindow.fetch(...args);

  let response;
  try {
    response = await request(sceneUrl.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
  } catch (error) {
    throw new BrowserEntryError('SCENE_FETCH_FAILED', 'scene.json を読み込めません。同じ配布元で再試行してください。', error);
  }
  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? `（HTTP ${response.status}）` : '';
    throw new BrowserEntryError('SCENE_FETCH_FAILED', `scene.json を読み込めません${status}。`);
  }
  if (typeof response.url === 'string' && response.url !== '') {
    const responseUrl = sameOriginUrl(response.url, activeWindow, 'scene.json');
    if (responseUrl.pathname !== sceneUrl.pathname) throw new BrowserEntryError('SCENE_REDIRECT_FORBIDDEN', 'scene.json が別の配布物へ移動しました。');
  }
  let bundle;
  try {
    bundle = await response.json();
  } catch (error) {
    throw new BrowserEntryError('SCENE_JSON_INVALID', 'scene.json の JSON を読み取れません。', error);
  }
  const validation = validateSceneBundle(bundle);
  if (!validation.ok) throw new BrowserEntryError('SCENE_BUNDLE_INVALID', sceneError(validation.issues));
  return bundle;
}

/** Build the only asset loader used by the browser entry: same-origin Image decode. */
export function createSameOriginAssetLoader(windowObject = globalThis.window) {
  const activeWindow = browserWindow(windowObject);
  return async function loadApprovedAsset(asset) {
    if (!asset || typeof asset.url !== 'string' || asset.url.trim() === '') {
      throw new BrowserEntryError('ASSET_URL_INVALID', imageError(asset, 'URL がありません'));
    }
    const rawUrl = asset.url.trim();
    if (EXTERNAL_URL_RE.test(rawUrl) || UNSAFE_PATH_RE.test(rawUrl) || /[\u0000-\u001f\u007f]/u.test(rawUrl) || rawUrl.includes('\\') || rawUrl.includes('?') || rawUrl.includes('#') || rawUrl.includes('%')) {
      throw new BrowserEntryError('ASSET_URL_INVALID', imageError(asset, '同じ配布元の相対 URL ではありません'));
    }
    const resolved = sameOriginUrl(rawUrl, activeWindow, 'アセット');
    if (typeof activeWindow.Image !== 'function') throw new BrowserEntryError('IMAGE_REQUIRED', imageError(asset, '画像デコーダーがありません'));
    const image = new activeWindow.Image();
    image.decoding = 'async';
    image.src = resolved.href;
    if (typeof image.decode !== 'function') throw new BrowserEntryError('IMAGE_DECODE_REQUIRED', imageError(asset, '画像の decode がありません'));
    try {
      await image.decode();
    } catch (error) {
      throw new BrowserEntryError('ASSET_DECODE_FAILED', imageError(asset, '画像を decode できません'), error);
    }
    const expectedWidth = asset.dimensions?.width;
    const expectedHeight = asset.dimensions?.height;
    if (image.naturalWidth !== expectedWidth || image.naturalHeight !== expectedHeight) {
      throw new BrowserEntryError('ASSET_DIMENSIONS_MISMATCH', imageError(asset, '宣言された画像サイズと一致しません'));
    }
    return image;
  };
}

function showStatus(elements, text) {
  elements['game-status'].textContent = text;
}

function showError(elements, error) {
  elements['game-error'].textContent = errorText(error);
  elements['game-error'].hidden = false;
  showStatus(elements, '街を開始できません');
}

export async function boot({ documentObject = globalThis.document, windowObject = globalThis.window, storage, assetLoader, fetchImpl, inputTarget } = {}) {
  const activeWindow = browserWindow(windowObject);
  const elements = requiredElements(documentObject);
  elements['game-error'].hidden = true;
  elements['game-error'].textContent = '';
  showStatus(elements, '街の設計図を読み込んでいます…');
  try {
    const bundle = await fetchSceneBundle({ windowObject: activeWindow, fetchImpl });
    showStatus(elements, '承認済み素材を読み込んでいます…');
    const runtime = await startGameRuntime({
      bundle,
      canvas: elements['game-canvas'],
      uiRoot: elements['game-ui'],
      storage: storage ?? localStorageFor(activeWindow),
      assetLoader: assetLoader ?? createSameOriginAssetLoader(activeWindow),
      inputTarget: inputTarget ?? activeWindow,
    });
    showStatus(elements, '遊べます。調査を終えたら Escape で終了できます。');
    activeWindow.addEventListener?.('pagehide', () => runtime.stop(), { once: true });
    return runtime;
  } catch (error) {
    showError(elements, error);
    return null;
  }
}

if (typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined') {
  void boot();
}
