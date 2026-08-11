import {
  GameRuntimeError,
  startGameRuntime,
  validateSceneBundle,
} from './index.mjs';

const SCENE_PATH = './scene.json';
const SHUTDOWN_PATH = './__codecity/shutdown';
const EXIT_PENDING_MESSAGE = '街を閉じています…';
const EXIT_CLOSED_MESSAGE = '街を閉じました。端末からもう一度起動すると、同じ街へ戻れます。';
const EXIT_ACTIVE_MESSAGE = '街を閉じられませんでした。ローカルのプロセスは動作中です。端末で停止してください。';
const REQUIRED_ELEMENTS = Object.freeze(['game-canvas', 'game-ui', 'game-error']);
const EXTERNAL_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu;
const UNSAFE_PATH_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;

class BrowserEntryError extends Error {
  constructor(message) {
    super(message);
  }
}

function browserWindow() {
  const value = globalThis.window;
  if (!value || !value.location || typeof value.location.href !== 'string' || typeof value.location.origin !== 'string') {
    throw new BrowserEntryError('ブラウザの場所を確認できません。');
  }
  return value;
}

function sameOriginUrl(raw, windowObject, kind) {
  let resolved;
  try {
    resolved = new URL(raw, windowObject.location.href);
  } catch {
    throw new BrowserEntryError(`${kind}の場所を確認できません。`);
  }
  if (resolved.origin !== windowObject.location.origin) {
    throw new BrowserEntryError(`${kind}が同じ街の配布物ではありません。`);
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
    ASSETS_REQUIRED: '出荷素材がありません',
    GAME_REQUIRED: 'ゲーム設定がありません',
    UNKNOWN_FIELD: '許可されていない項目があります',
  };
  const message = labels[first.code] ?? '契約違反があります';
  return `scene.json の設計図が契約に合いません（${path}: ${message}）。`;
}

function imageError(asset, suffix) {
  const id = typeof asset?.id === 'string' && asset.id.trim() !== '' ? asset.id : '不明なアセット';
  return `出荷素材「${id}」を読み込めません${suffix ? `（${suffix}）` : ''}。`;
}

function errorText(error) {
  if (error instanceof BrowserEntryError) return error.message;
  if (error instanceof GameRuntimeError) {
    if (error.code === 'SCENE_BUNDLE_INVALID') return `街を開始できません。${sceneError(error.issues)}`;
    if (error.code === 'ASSET_LOAD_FAILED') {
      const detail = error.issues?.[0]?.message;
      return `街を開始できません。出荷素材を読み込めません${detail ? `（${detail}）` : '。'}`;
    }
    if (error.code === 'STORAGE_REQUIRED' || error.code === 'PERSISTENCE_WRITE_FAILED') return 'このブラウザでは街の記録を保存できません。保存機能を有効にしてから再試行してください。';
    const runtimeLabels = {
      CANVAS_REQUIRED: '描画画面を準備できません',
      CANVAS_CONTEXT_REQUIRED: '描画機能を準備できません',
      UI_ROOT_REQUIRED: '操作表示を準備できません',
      ASSET_LOADER_REQUIRED: '出荷素材の読み込み機能がありません',
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

function requiredElements() {
  const documentObject = globalThis.document;
  if (!documentObject || typeof documentObject.getElementById !== 'function') {
    throw new BrowserEntryError('画面を準備できません。');
  }
  const elements = Object.fromEntries(REQUIRED_ELEMENTS.map((id) => {
    const element = documentObject.getElementById(id);
    if (!element) throw new BrowserEntryError(`画面要素「${id}」がありません。`);
    return [id, element];
  }));
  if (typeof elements['game-canvas'].getContext !== 'function') throw new BrowserEntryError('描画画面を準備できません。');
  return elements;
}

function localStorageFor() {
  try {
    const storage = globalThis.window.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('localStorage unavailable');
    return storage;
  } catch {
    throw new BrowserEntryError('このブラウザの保存領域を利用できません。');
  }
}

/** Fetch the generated SceneBundle without accepting redirects or other origins. */
async function fetchSceneBundle() {
  const activeWindow = browserWindow();
  const sceneUrl = sameOriginUrl(SCENE_PATH, activeWindow, 'scene.json');
  if (typeof activeWindow.fetch !== 'function') throw new BrowserEntryError('scene.json を読み込む機能がありません。');

  let response;
  try {
    response = await activeWindow.fetch(sceneUrl.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
  } catch {
    throw new BrowserEntryError('scene.json を読み込めません。同じ配布元で再試行してください。');
  }
  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? `（HTTP ${response.status}）` : '';
    throw new BrowserEntryError(`scene.json を読み込めません${status}。`);
  }
  if (typeof response.url === 'string' && response.url !== '') {
    const responseUrl = sameOriginUrl(response.url, activeWindow, 'scene.json');
    if (responseUrl.pathname !== sceneUrl.pathname) throw new BrowserEntryError('scene.json が別の配布物へ移動しました。');
  }
  let bundle;
  try {
    bundle = await response.json();
  } catch {
    throw new BrowserEntryError('scene.json の JSON を読み取れません。');
  }
  const validation = validateSceneBundle(bundle);
  if (!validation.ok) throw new BrowserEntryError(sceneError(validation.issues));
  return bundle;
}

/** Ask the same loopback origin to close the CLI-owned server after Exit. */
async function requestServerShutdown() {
  const activeWindow = browserWindow();
  const shutdownUrl = sameOriginUrl(SHUTDOWN_PATH, activeWindow, '終了処理');
  if (typeof activeWindow.fetch !== 'function') return false;
  const response = await activeWindow.fetch(shutdownUrl.href, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-CodeCity-Exit': '1',
    },
    redirect: 'error',
    keepalive: true,
  });
  return response?.status === 204;
}

/** Build the only asset loader used by the browser entry: same-origin Image decode. */
function createSameOriginAssetLoader() {
  const activeWindow = browserWindow();
  return async function loadShippingAsset(asset) {
    if (!asset || typeof asset.url !== 'string' || asset.url.trim() === '') {
      throw new BrowserEntryError(imageError(asset, 'URL がありません'));
    }
    const rawUrl = asset.url.trim();
    if (EXTERNAL_URL_RE.test(rawUrl) || UNSAFE_PATH_RE.test(rawUrl) || /[\u0000-\u001f\u007f]/u.test(rawUrl) || rawUrl.includes('\\') || rawUrl.includes('?') || rawUrl.includes('#') || rawUrl.includes('%')) {
      throw new BrowserEntryError(imageError(asset, '同じ配布元の相対 URL ではありません'));
    }
    const resolved = sameOriginUrl(rawUrl, activeWindow, 'アセット');
    if (typeof activeWindow.Image !== 'function') throw new BrowserEntryError(imageError(asset, '画像デコーダーがありません'));
    const image = new activeWindow.Image();
    image.decoding = 'async';
    image.src = resolved.href;
    if (typeof image.decode !== 'function') throw new BrowserEntryError(imageError(asset, '画像の decode がありません'));
    try {
      await image.decode();
    } catch {
      throw new BrowserEntryError(imageError(asset, '画像を decode できません'));
    }
    const expectedWidth = asset.dimensions?.width;
    const expectedHeight = asset.dimensions?.height;
    if (image.naturalWidth !== expectedWidth || image.naturalHeight !== expectedHeight) {
      throw new BrowserEntryError(imageError(asset, '宣言された画像サイズと一致しません'));
    }
    return image;
  };
}

function showStatus(elements, text) {
  // Loading and exit feedback share the game-ui root so the browser never
  // exposes a second permanent status panel outside the authored frame.
  elements['game-ui'].textContent = text;
  elements['game-ui'].hidden = text === '';
  elements['game-ui'].dataset.kind = text === '' ? '' : 'loading';
}

function showError(elements, error) {
  elements['game-error'].textContent = errorText(error);
  elements['game-error'].hidden = false;
  showStatus(elements, '街を開始できません');
}

function setFramedMessage(uiRoot, text, kind) {
  uiRoot.hidden = false;
  uiRoot.dataset.kind = kind;
  const body = typeof uiRoot.querySelector === 'function' ? uiRoot.querySelector('.game-ui-body') : null;
  const prompt = typeof uiRoot.querySelector === 'function' ? uiRoot.querySelector('.game-ui-prompt') : null;
  const footer = typeof uiRoot.querySelector === 'function' ? uiRoot.querySelector('.game-ui-footer') : null;
  if (body) {
    body.textContent = text;
    if (prompt) prompt.textContent = '街を出る';
    if (footer) footer.textContent = '';
    return;
  }
  uiRoot.textContent = text;
}

async function boot() {
  const activeWindow = browserWindow();
  const elements = requiredElements();
  elements['game-error'].hidden = true;
  elements['game-error'].textContent = '';
  showStatus(elements, '街の設計図を読み込んでいます…');
  try {
    const bundle = await fetchSceneBundle();
    showStatus(elements, '出荷素材を読み込んでいます…');
    let runtime = null;
    runtime = await startGameRuntime({
      bundle,
      canvas: elements['game-canvas'],
      uiRoot: elements['game-ui'],
      storage: localStorageFor(),
      assetLoader: createSameOriginAssetLoader(),
      onExit: () => {
        setFramedMessage(elements['game-ui'], EXIT_PENDING_MESSAGE, 'exit-pending');
        runtime?.stop();
        void requestServerShutdown().then((closed) => {
          setFramedMessage(elements['game-ui'], closed ? EXIT_CLOSED_MESSAGE : EXIT_ACTIVE_MESSAGE, closed ? 'exit-closed' : 'exit-active');
        }).catch(() => {
          setFramedMessage(elements['game-ui'], EXIT_ACTIVE_MESSAGE, 'exit-active');
        });
      },
    });
    showStatus(elements, '');
    activeWindow.addEventListener('pagehide', () => runtime.stop(), { once: true });
  } catch (error) {
    showError(elements, error);
  }
}

if (typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined') {
  void boot();
}
