#!/usr/bin/env node
// src/generate-town.mjs
//
// CodeCity Inspector — Phase 2 CLI: the "役場検査" that turns one inspected
// repository into a deterministic town.layout.json artifact.
//
// Pipeline (each step is pure data-in / data-out; the target repository's code,
// scripts, hooks, and package manager are NEVER executed anywhere here):
//
//   parseCliArgs
//     -> inspectRepository(repo)                 (src/inspector.mjs; reads files as data)
//     -> buildTown(repo, inspection)             (src/town/index.mjs -> { model, habitability })
//     -> repoFingerprint(inspection)             (src/town/rng.mjs; stable determinism key)
//     -> generateLayout({ model, habitability,   (src/town/generator.mjs; only randomness =
//          seed, generatorVersion, repoFingerprint })  the seeded PRNG in rng.mjs)
//     -> annotateLayout(layout)                  (src/town/validator.mjs; runs validateLayout
//                                                 and fills layout.validation)
//     -> if validation.ok: write pretty JSON to --out + print a one-line summary
//        else: print the validation issues to stderr and exit non-zero WITHOUT
//              writing (a failed 役場検査 is not adopted).
//
// DETERMINISM: the layout is a pure function of (repoFingerprint,
// generatorVersion, seed) + the TownModel — the same triple yields a
// byte-identical town.layout.json. This CLI adds NO wall-clock or random data of
// its own (no Date.now / new Date / Math.random); when no --seed is given the
// seed defaults to the repository fingerprint, so re-running on unchanged code
// reproduces the same town exactly.
//
// SAFETY: the scanned repository is read-only. The ONLY file this tool writes is
// its output artifact at --out, which defaults to ./town.layout.json in the
// current working directory. An output path inside the scanned repository (even
// through a symlinked ancestor) is rejected before any write.

import {
  closeSync, constants as fsConstants, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectRepository } from './inspector.mjs';
import { buildTown } from './town/index.mjs';
import { repoFingerprint, defaultSeed } from './town/rng.mjs';
import { generateLayout } from './town/generator.mjs';
import { annotateLayout } from './town/validator.mjs';
import { GENERATOR_VERSION } from './town/schema.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_REPOSITORY = path.join(PROJECT_ROOT, 'sample', 'tiny-town');
const DEFAULT_OUTPUT = 'town.layout.json';

function containedBy(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function actualPathForPotentialFile(candidate) {
  let current = path.resolve(candidate);
  const missingSegments = [];
  while (true) {
    try {
      const stat = await lstat(current);
      if (current === path.resolve(candidate) && stat.isSymbolicLink()) {
        throw new Error('Output file must not be a symbolic link');
      }
      const actual = await realpath(current);
      return path.resolve(actual, ...missingSegments);
    } catch (error) {
      if (error?.message === 'Output file must not be a symbolic link') throw error;
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Prove that the sole CLI output remains outside the inspected repository.
 * Checks both lexical and real paths so a symlinked parent cannot redirect an
 * apparently external output back into the target.
 */
export async function assertSafeOutputPath(repoPath, outPath) {
  const requestedRepo = path.resolve(repoPath);
  const actualRepo = await realpath(requestedRepo);
  const requestedOut = path.resolve(outPath);
  const actualOut = await actualPathForPotentialFile(requestedOut);
  if (containedBy(requestedRepo, requestedOut) || containedBy(actualRepo, actualOut)) {
    throw new Error('Refusing to write town.layout.json inside the inspected repository');
  }
  return actualOut;
}

export function writeOutputAtomic(outPath, contents) {
  const directory = path.dirname(outPath);
  const basename = path.basename(outPath);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const temporary = path.join(directory, `.${basename}.${process.pid}.${attempt}.tmp`);
    let descriptor;
    let created = false;
    try {
      descriptor = openSync(temporary, flags, 0o600);
      created = true;
      writeFileSync(descriptor, contents, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, outPath);
      return;
    } catch (error) {
      lastError = error;
      if (descriptor !== undefined) closeSync(descriptor);
      if (created) {
        try { unlinkSync(temporary); } catch { /* no temporary file to clean */ }
      }
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw lastError ?? new Error('Unable to allocate a temporary town output file');
}

/**
 * Parse argv (already sliced past `node script`) into CLI options, mirroring the
 * argument style of src/server.mjs: each flag supports both `--flag value` and
 * `--flag=value`, and an unrecognised token throws so the caller can exit 2.
 * `--seed` accepts an empty string (a valid PRNG seed); `--repo` / `--out` are
 * resolved to absolute paths so behaviour is independent of later cwd changes.
 *
 * @param {string[]} argv
 * @returns {{ repoPath: string, seed: string|null, outPath: string, print: boolean, help: boolean }}
 */
export function parseCliArgs(argv) {
  const result = {
    repoPath: DEFAULT_REPOSITORY,
    seed: null,
    outPath: path.resolve(DEFAULT_OUTPUT),
    print: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--print') result.print = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--repo') {
      if (!argv[index + 1]) throw new Error('--repo requires a directory path');
      result.repoPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--repo=')) result.repoPath = path.resolve(argument.slice('--repo='.length));
    else if (argument === '--seed') {
      if (argv[index + 1] === undefined) throw new Error('--seed requires a value');
      result.seed = String(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--seed=')) result.seed = argument.slice('--seed='.length);
    else if (argument === '--out') {
      if (!argv[index + 1]) throw new Error('--out requires a file path');
      result.outPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--out=')) result.outPath = path.resolve(argument.slice('--out='.length));
    else throw new Error(`Unknown option: ${argument}`);
  }
  return result;
}

/**
 * Run the full inspect -> model -> fingerprint -> generate -> validate pipeline
 * for one repository and return the annotated (validation-filled) TownLayout
 * alongside the inputs a caller may want to report. Never executes target code.
 *
 * @param {{ repoPath: string, seed?: string|null }} options
 * @returns {Promise<{ layout: import('./town/schema.mjs').TownLayout, habitability: import('./town/schema.mjs').Habitability, seed: string, fingerprint: string }>}
 */
export async function buildTownArtifact({ repoPath, seed = null } = {}) {
  const inspection = await inspectRepository(repoPath);
  const { model, habitability } = await buildTown(repoPath, inspection);
  const fingerprint = repoFingerprint(inspection);
  const seedString = seed == null ? defaultSeed(inspection) : String(seed);
  const layout = annotateLayout(generateLayout({
    model,
    habitability,
    seed: seedString,
    generatorVersion: GENERATOR_VERSION,
    repoFingerprint: fingerprint
  }));
  return { layout, habitability, seed: seedString, fingerprint };
}

/**
 * One-line, town-language summary of an adopted layout.
 * @param {{ layout: object, habitability: object, seed: string, outPath: string }} input
 * @returns {string}
 */
export function formatSummary({ layout, habitability, seed, outPath }) {
  const density = Number.isFinite(layout.validation?.densityScore)
    ? layout.validation.densityScore.toFixed(3)
    : '0.000';
  const seedShown = typeof seed === 'string' && seed ? seed.slice(0, 12) : '(empty)';
  const rel = path.relative(process.cwd(), outPath) || outPath;
  return `${layout.townId} · Lv.${habitability.level} ${habitability.levelName}`
    + ` · canLive=${habitability.canLive}`
    + ` · buildings=${layout.buildings.length}`
    + ` · density=${density}`
    + ` · seed=${seedShown}`
    + ` -> ${rel}`;
}

function printHelp() {
  process.stdout.write(
`CodeCity Inspector — town.layout.json generator

Usage: node src/generate-town.mjs [--repo PATH] [--seed S] [--out FILE] [--print]

  --repo PATH   repository to inspect (read-only; never executed).
                Default: sample/tiny-town
  --seed S      PRNG seed string. Default: the repository fingerprint, so the
                same code reproduces a byte-identical town.
  --out FILE    where to write town.layout.json.
                Default: ./town.layout.json (current working directory)
  --print       also write the full layout JSON to stdout (in addition to --out)
  -h, --help    show this help

The target repository is read as data only; its code is never executed. The
layout is a pure function of (repoFingerprint, generatorVersion, seed): identical
inputs always produce a byte-identical town.layout.json. A layout that fails the
validator (役場検査) is reported to stderr and NOT written.
`);
}

async function main() {
  // A downstream reader (e.g. `... --print | head`) may close the pipe early;
  // treat that as normal end-of-consumer instead of crashing on unhandled EPIPE.
  process.stdout.on('error', (error) => {
    if (error && error.code === 'EPIPE') process.exit(0);
    process.exit(1);
  });
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  try {
    const { layout, habitability, seed } = await buildTownArtifact(options);
    const validation = layout.validation;
    if (!validation.ok) {
      process.stderr.write(`役場検査 failed: ${layout.townId} was not adopted; town.layout.json not written.\n`);
      for (const issue of validation.issues) {
        process.stderr.write(`  [${issue.severity}] ${issue.code}: ${issue.message}\n`);
      }
      process.exitCode = 1;
      return;
    }
    const json = JSON.stringify(layout, null, 2);
    const safeOutputPath = await assertSafeOutputPath(options.repoPath, options.outPath);
    writeOutputAtomic(safeOutputPath, `${json}\n`);
    if (options.print) process.stdout.write(`${json}\n`);
    process.stdout.write(`${formatSummary({ layout, habitability, seed, outPath: options.outPath })}\n`);
  } catch (error) {
    process.stderr.write(`Unable to generate town.layout.json: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
