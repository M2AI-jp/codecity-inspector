// Loading of the town, the art manifest and images. Nothing here is fatal except a missing town.

export const DEFAULT_PLAYER_SRC = '/art/approved/player--default.png';
const DEFAULT_GROUND = {
  street: '/art/game/ground/street.png', grass: '/art/game/ground/grass.png',
  dirt: '/art/game/ground/dirt.png', plaza: '/art/game/ground/plaza.png',
};

// Frame table for the approved player sheet (192x256, 32x32 frames, 6 cols x 8 rows).
// Rows 0-1 face up, 2-3 down, 4-5 right, 6-7 left. In each direction the first row holds
// the standing frame (col 0) and a 4-frame walk cycle (cols 2-5); the second row's cols 2-5
// are arm gestures (unused while walking).
export const DEFAULT_PLAYER_ANIMS = {
  idle: { up: [0], down: [12], right: [24], left: [36] },
  walk: {
    up: [2, 3, 4, 5],
    down: [14, 15, 16, 17],
    right: [26, 27, 28, 29],
    left: [38, 39, 40, 41],
  },
};

const warned = new Set();
export function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[codecity] ${msg}`);
}

export async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { warnOnce(`img:${url}`, `画像を読み込めません: ${url}`); resolve(null); };
    img.src = url;
  });
}

export function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// Removes leftover magenta key fringe in memory: strongly magenta-tinted pixels on the
// silhouette edge become transparent; the rare interior ones are neutralised to a dark tone.
export function cleanMagenta(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const isMag = (i) => {
    if (d[i + 3] === 0) return false;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mn = r < b ? r : b;
    return mn - g >= 20 && g < 0.6 * mn;
  };
  let removed = 0, neutral = 0;
  for (let pass = 0; pass < 3; pass++) {
    const kill = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!isMag(i)) continue;
        let edge = false;
        if (x === 0 || d[i - 4 + 3] === 0) edge = true;
        else if (x === w - 1 || d[i + 4 + 3] === 0) edge = true;
        else if (y === 0 || d[i - w * 4 + 3] === 0) edge = true;
        else if (y === h - 1 || d[i + w * 4 + 3] === 0) edge = true;
        if (edge) kill.push(i);
      }
    }
    if (!kill.length) break;
    for (const i of kill) { d[i + 3] = 0; removed++; }
  }
  for (let i = 0; i < d.length; i += 4) {
    if (!isMag(i)) continue;
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    d[i] = v * 0.9; d[i + 1] = v * 0.75; d[i + 2] = v * 0.7;
    neutral++;
  }
  ctx.putImageData(id, 0, 0);
  return { removed, neutral };
}

function flipCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

const DIRS = ['up', 'down', 'right', 'left'];
const OPPOSITE = { left: 'right', right: 'left' };

// Builds a character sheet: { image, flipped, fw, fh, px, py, cols, anims[name][dir] = [{flip, sx, sy}] }
export function buildSheet(canvas, def, fallbackAnims) {
  const [fw, fh] = def.frame || [32, 32];
  const [px, py] = def.pivot || [Math.floor(fw / 2), fh - 1];
  const cols = Math.max(1, Math.floor(canvas.width / fw));
  const rows = Math.max(1, Math.floor(canvas.height / fh));
  const src = def.anims || fallbackAnims || {};
  let flipped = null;
  const frameOf = (idx, flip) => {
    const n = Math.max(0, Math.min(cols * rows - 1, idx | 0));
    const col = n % cols, row = Math.floor(n / cols);
    return { flip, sx: (flip ? cols - 1 - col : col) * fw, sy: row * fh };
  };
  const anims = {};
  for (const name of ['idle', 'walk']) {
    anims[name] = {};
    for (const dir of DIRS) {
      let list = src[name] && src[name][dir];
      let flip = false;
      if ((!list || !list.length) && OPPOSITE[dir] && src[name] && src[name][OPPOSITE[dir]]) {
        list = src[name][OPPOSITE[dir]]; flip = true;
      }
      if (!list || !list.length) list = null;
      anims[name][dir] = list ? list.map((i) => frameOf(i, flip)) : null;
      if (flip) flipped = flipped || flipCanvas(canvas);
    }
  }
  // fill gaps: idle <- walk[0], walk <- idle, missing dirs <- down
  for (const dir of DIRS) {
    if (!anims.idle[dir] && anims.walk[dir]) anims.idle[dir] = [anims.walk[dir][0]];
    if (!anims.walk[dir] && anims.idle[dir]) anims.walk[dir] = anims.idle[dir];
  }
  for (const dir of DIRS) {
    if (!anims.idle[dir]) anims.idle[dir] = anims.idle.down || [frameOf(0, false)];
    if (!anims.walk[dir]) anims.walk[dir] = anims.walk.down || anims.idle[dir];
  }
  return { image: canvas, flipped, fw, fh, px, py, cols, anims };
}

const resolve = (src, base) => new URL(src, base).href;

// Loads everything the manifest references. Returns a normalised art object.
export async function loadArt(manifest, manifestUrl, opts) {
  const base = new URL(manifestUrl, location.href).href;
  const m = manifest || {};
  const art = { tile: m.tile || 16, player: null, keepers: {}, townsfolk: [], archetypes: {}, props: {}, ground: {} };
  const jobs = [];

  // Player
  const pdef = (m.characters && m.characters.player) || {};
  const playerSrc = opts.playerOverride
    ? new URL(opts.playerOverride, location.href).href
    : pdef.src ? resolve(pdef.src, base) : new URL(DEFAULT_PLAYER_SRC, location.href).href;
  jobs.push(loadImage(playerSrc).then((img) => {
    if (!img) return;
    const c = toCanvas(img);
    const r = cleanMagenta(c);
    if (r.removed || r.neutral) console.info(`[codecity] player sprite: removed ${r.removed} magenta fringe px, neutralised ${r.neutral}`);
    art.player = buildSheet(c, pdef.frame ? pdef : { frame: [32, 32], pivot: [16, 31] }, DEFAULT_PLAYER_ANIMS);
  }));

  // People: keepers by module.kind, townsfolk walkers (older manifests: characters.residents)
  const ch = m.characters || {};
  const loadPerson = (def, put) => {
    if (!def || !def.src) return;
    jobs.push(loadImage(resolve(def.src, base)).then((img) => {
      if (!img) return;
      const c = toCanvas(img);
      cleanMagenta(c);
      put(buildSheet(c, def, null));
    }));
  };
  for (const [kind, def] of Object.entries(ch.keepers || {})) loadPerson(def, (sh) => { art.keepers[kind] = sh; });
  const folk = Array.isArray(ch.townsfolk) ? ch.townsfolk : Array.isArray(ch.residents) ? ch.residents : [];
  folk.forEach((def, i) => loadPerson(def, (sh) => { art.townsfolk[i] = sh; }));

  // Archetypes: each has one or more visual variants with their own footprint / door / blockers /
  // lights / smoke. (A manifest entry without `variants` is treated as a single variant.)
  for (const [key, a] of Object.entries(m.archetypes || {})) {
    const defs = Array.isArray(a.variants) && a.variants.length ? a.variants : [a];
    const variants = defs.map((v, i) => {
      const entry = {
        key, id: v.id || `${key}-${i + 1}`,
        footprint: v.footprint || a.footprint || null,
        exterior: null, cutaway: null,
        exteriorOrigin: (v.exterior && v.exterior.origin) || [0, 0],
        cutawayOrigin: (v.cutaway && v.cutaway.origin) || (v.exterior && v.exterior.origin) || [0, 0],
        door: v.door || null,
        floor: Array.isArray(v.floor) ? v.floor : null,
        blockers: Array.isArray(v.blockers) ? v.blockers : [],
        lights: Array.isArray(v.lights) ? v.lights : [],
        interiorLights: Array.isArray(v.interiorLights) ? v.interiorLights : [],
        smoke: Array.isArray(v.smoke) ? v.smoke : [],
      };
      if (v.exterior && v.exterior.src) jobs.push(loadImage(resolve(v.exterior.src, base)).then((img) => { entry.exterior = img; }));
      if (v.cutaway && v.cutaway.src) jobs.push(loadImage(resolve(v.cutaway.src, base)).then((img) => { entry.cutaway = img; }));
      return entry;
    });
    art.archetypes[key] = { key, variants };
  }

  // Props
  for (const [key, p] of Object.entries(m.props || {})) {
    const entry = { key, image: null, origin: p.origin || [0, 0], solid: p.solid || null, light: p.light || null, flicker: p.flicker !== false };
    art.props[key] = entry;
    if (p.src) jobs.push(loadImage(resolve(p.src, base)).then((img) => { entry.image = img; }));
  }

  // Ground textures -> ImageData for per-pixel sampling, only needed when the town carries no
  // pre-composed groundImage. Without a manifest ground section the shared textures are tried.
  const groundDefs = opts.needGround ? (m.ground || DEFAULT_GROUND) : {};
  for (const [key, src] of Object.entries(groundDefs)) {
    if (!src) continue;
    jobs.push(loadImage(resolve(src, base)).then((img) => {
      if (!img) return;
      const c = toCanvas(img);
      art.ground[key] = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    }));
  }

  await Promise.all(jobs);
  return art;
}
