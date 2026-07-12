// src/town/rng.mjs
//
// The ONLY randomness source for the "habitable town" spatial subsystem
// (src/town/**). Exports a deterministic seeded PRNG (makeRng) plus the
// fingerprint helpers (repoFingerprint, defaultSeed) that turn a scanned
// repository into a stable seed. Every placement decision the layout
// generator makes must route through the object makeRng() returns — nothing
// else in src/town/** may call Math.random, Date.now, or new Date().
//
// DETERMINISM IS THE WHOLE POINT. Same seed string in => byte-identical
// sequence of next()/int()/pick()/shuffle()/chance() results out, on any
// machine, in any process, on any date. This is exactly why an LLM is never
// allowed to place the town itself: the generator + validator are the
// reproducible "役場検査", and this file is the one gear that makes that
// reproducibility possible. There is NO Date.now / new Date() / Math.random
// anywhere below; Math.imul / Math.ceil / Math.floor / Math.min / Math.max are
// pure and deterministic and are the only Math members used.
//
// ALGORITHM. makeRng: cyrb128 hashes the seed string down to four 32-bit
// state words, which seed sfc32 ("Small Fast Counter", 128 bits of state) as
// the float stream — both small, well-known, public-domain, NON-cryptographic
// constructions chosen purely for determinism and speed, not unpredictability
// (a layout seed is not a secret). repoFingerprint uses node:crypto's sha256
// instead, since that fingerprint is a stable content digest, not a PRNG.
//
// PURE. The only import is node:crypto (a Node builtin, used solely for
// repoFingerprint's digest). No npm dependency, no other Node builtins, and no
// I/O beyond reading the already-in-memory `inspection` object passed in — the
// target repository itself is never re-read or executed here (that already
// happened upstream in scanner.mjs / inspector.mjs). repoFingerprint only
// re-shapes plain data (inspection.graph.nodes / inspection.city.buildings).

import { createHash } from 'node:crypto';

// --- seed string -> four 32-bit state words (cyrb128) -----------------------
// Canonical public-domain construction (bryc). Spreads an arbitrary seed
// string across sfc32's four state words; NOT a cryptographic hash.

/**
 * @param {string} str
 * @returns {[number, number, number, number]} four 32-bit unsigned state words
 */
function cyrb128(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// --- core float stream (sfc32) ----------------------------------------------
// Canonical public-domain construction (Chris Doty-Humphrey / "sfc32"). Closes
// over its own mutable 32-bit state; identical starting state always yields the
// identical output sequence.

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 * @returns {() => number} stepper returning the next float in [0, 1)
 */
function sfc32(a, b, c, d) {
  return function step() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Coerce whatever a caller hands makeRng into a string, deterministically and
 * without throwing. The seed is virtually always already a string (a
 * repoFingerprint digest or an explicit --seed), so this only guards against
 * misuse: a nullish seed becomes the empty string (still a perfectly
 * deterministic, if shared, seed) rather than a clock- or random-derived one.
 * @param {unknown} seed
 * @returns {string}
 */
function normalizeSeed(seed) {
  if (typeof seed === 'string') return seed;
  if (typeof seed === 'number' && Number.isFinite(seed)) return String(seed);
  return seed == null ? '' : String(seed);
}

// --- public PRNG surface ----------------------------------------------------

/**
 * A stateful, deterministic pseudo-random generator. Every method advances one
 * shared internal state, so running the same sequence of method calls against
 * two generators built from the same seed always yields the same sequence of
 * results. The returned object is frozen so no caller can monkey-patch the
 * subsystem's single randomness source out from under its siblings.
 * @typedef {Object} Rng
 * @property {() => number} next - next float in [0, 1)
 * @property {(minInclusive: number, maxInclusive: number) => number} int - next integer in [minInclusive, maxInclusive], both ends inclusive; consumes one next() draw
 * @property {<T>(items: ReadonlyArray<T>) => T} pick - a uniformly-chosen element of a non-empty array
 * @property {<T>(items: ReadonlyArray<T>) => T[]} shuffle - a new array holding a Fisher-Yates shuffle of `items`; `items` itself is never mutated
 * @property {(p: number) => boolean} chance - true with probability `p` (clamped to [0,1]); consumes exactly one next() draw
 */

/**
 * Build a fresh, independent, deterministic PRNG from a seed string. The ONLY
 * randomness source permitted anywhere in src/town/**: it never wraps
 * Math.random, Date.now, or new Date(). Byte-identical `seedString` =>
 * byte-identical sequence of results from an identical sequence of method
 * calls, forever, on any machine. A non-string seed is coerced deterministically
 * (see normalizeSeed) rather than throwing.
 * @param {string} seedString
 * @returns {Rng}
 */
export function makeRng(seedString) {
  const [a, b, c, d] = cyrb128(normalizeSeed(seedString));
  const step = sfc32(a, b, c, d);
  // sfc32's authors recommend discarding a handful of outputs after seeding so
  // the stream is well-mixed regardless of how "plain" the seed's hash was. A
  // fixed count keeps this fully deterministic.
  for (let i = 0; i < 15; i++) step();

  /** @returns {number} next float in [0, 1) */
  function next() {
    return step();
  }

  /**
   * Next integer in the inclusive range [minInclusive, maxInclusive]. The
   * parameter names are the contract: `minInclusive <= maxInclusive`. Both
   * bounds must be finite (a NaN/Infinity bound throws TypeError), and the
   * rounded integer range must be non-empty — `int(0, -1)`, a reversed range,
   * or a fractional range with no integer inside (e.g. `int(1.2, 1.8)`) throws
   * RangeError rather than silently returning an out-of-range or garbage index.
   * Loud failure here is deliberate: a bad range is a generator bug, not
   * untrusted scan data, and a silent wrong index would be far harder to trace
   * through a layout than an immediate, precise error. Consumes one next() draw.
   * @param {number} minInclusive
   * @param {number} maxInclusive
   * @returns {number}
   */
  function int(minInclusive, maxInclusive) {
    const lo = Number(minInclusive);
    const hi = Number(maxInclusive);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new TypeError(`rng.int: bounds must be finite numbers, got (${minInclusive}, ${maxInclusive})`);
    }
    const low = Math.ceil(lo);
    const high = Math.floor(hi);
    const span = high - low + 1;
    if (span <= 0) {
      throw new RangeError(`rng.int: no integer exists in the inclusive range (${minInclusive}, ${maxInclusive})`);
    }
    return low + Math.floor(next() * span);
  }

  /**
   * A uniformly-chosen element of a non-empty array. Throws RangeError on a
   * non-array or empty input rather than silently returning `undefined`, since
   * a silent `undefined` element would corrupt a layout in ways that are hard
   * to trace back to their source.
   * @template T
   * @param {ReadonlyArray<T>} items
   * @returns {T}
   */
  function pick(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new RangeError('rng.pick: items must be a non-empty array');
    }
    return items[int(0, items.length - 1)];
  }

  /**
   * A new array holding a Fisher-Yates shuffle of `items`. `items` is copied
   * before any swap, so the caller's array — even a frozen or shared one — is
   * never read after copying and never mutated. Throws TypeError on a non-array
   * input (a shuffle of a non-collection is a programming error).
   * @template T
   * @param {ReadonlyArray<T>} items
   * @returns {T[]}
   */
  function shuffle(items) {
    if (!Array.isArray(items)) throw new TypeError('rng.shuffle: expected an array');
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * True with probability `p`. `p` is clamped to [0, 1] first (so `p <= 0` is
   * always false and `p >= 1` is always true), and a non-finite `p` (NaN /
   * undefined / ...) degrades to 0 — "no chance" is the safe default for a
   * malformed probability, never a throw. Always consumes exactly one next()
   * draw regardless of `p`, so toggling a probability never desyncs the stream.
   * @param {number} p
   * @returns {boolean}
   */
  function chance(p) {
    const probability = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
    return next() < probability;
  }

  return Object.freeze({ next, int, pick, shuffle, chance });
}

// --- repository fingerprint -------------------------------------------------

/**
 * @param {unknown} value
 * @returns {boolean} true only for a plain (non-array, non-null) object
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Repo-relative file-size normalizer, matching src/town/detect.mjs's
 * normalizeCount: a finite value is truncated toward zero and floored at 0;
 * anything else (absent / malformed `bytes`) degrades to 0. Keeps the
 * fingerprint crash-proof on a partial inspection.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * The unsorted `"path:bytes"` lines a fingerprint is built from. Prefers
 * inspection.graph.nodes (the primitive scanned-file list: `{ id, path, bytes,
 * kind, isTest }` per scanner.mjs); falls back to inspection.city.buildings —
 * which carries the same repo-relative `path` and numeric `bytes` per
 * inspector.mjs — when graph.nodes is absent or empty, so a caller holding
 * either half of an inspection still gets a stable fingerprint (and for one
 * full inspection both sources yield identical lines). Missing / malformed
 * entries are skipped rather than throwing, and an entry with no usable string
 * `path` is dropped rather than injecting a `":0"` line that would corrupt the
 * digest.
 * @param {unknown} inspection
 * @returns {string[]}
 */
function fingerprintLines(inspection) {
  const insp = isPlainObject(inspection) ? inspection : {};
  const graphNodes = Array.isArray(insp.graph?.nodes) ? insp.graph.nodes : [];
  const source = graphNodes.length > 0
    ? graphNodes
    : (Array.isArray(insp.city?.buildings) ? insp.city.buildings : []);
  const lines = [];
  for (const node of source) {
    if (!isPlainObject(node)) continue;
    const filePath = typeof node.path === 'string' ? node.path : '';
    if (filePath === '') continue;
    lines.push(`${filePath}:${normalizeCount(node.bytes)}`);
  }
  return lines;
}

/**
 * A deterministic, stable fingerprint of the scanned file set: every
 * `"path:bytes"` line from inspection.graph.nodes (or inspection.city.buildings
 * when graph.nodes is absent/empty), sorted, newline-joined, and sha256-digested
 * via node:crypto. Same repository contents => same fingerprint, independent of
 * the wall clock (nothing here reads one), of the order files were discovered on
 * disk (the lines are sorted), and of where the repository lives on this machine
 * (only the repo-relative `path` field feeds the hash, never an absolute path).
 *
 * The sort is a plain code-unit `.sort()`, NOT localeCompare: localeCompare is
 * ICU/locale-dependent and would make the digest differ across machines, which
 * is exactly what a byte-identical fingerprint must not do. Pure and
 * synchronous; no I/O beyond reading the already-in-memory `inspection` object.
 * @param {object} inspection - src/inspector.mjs buildInspection(scan) output (schemaVersion 2)
 * @returns {string} lowercase hex sha256 digest
 */
export function repoFingerprint(inspection) {
  const lines = fingerprintLines(inspection).sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/**
 * The seed a caller gets for free when they supply none: the repository's own
 * fingerprint, so "no --seed given" still produces a reproducible town from
 * repo contents alone rather than a different one on every run. Equivalent to
 * repoFingerprint(inspection); kept as its own named export so callers can
 * express intent ("give me the default seed") without knowing it happens to
 * equal the fingerprint. Pure; no I/O beyond reading the passed-in inspection.
 * @param {object} inspection - src/inspector.mjs buildInspection(scan) output
 * @returns {string}
 */
export function defaultSeed(inspection) {
  return repoFingerprint(inspection);
}
