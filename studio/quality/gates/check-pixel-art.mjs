#!/usr/bin/env node

import path from 'node:path';
import { formatPixelArtGateReport, runPixelArtGate } from './index.mjs';

function usage() {
  return [
    'Usage: node studio/quality/gates/check-pixel-art.mjs [options]',
    '',
    'Options:',
    '  --root <dir>        repository root (default: current directory)',
    '  --candidates <dir>  candidate root (default: studio/art-department/candidates)',
    '  --palette <file>    explicit palette JSON (default: studio/art-department/palette.json)',
    '  --json              print the full observed/inferred/unknown report as JSON',
    '  --help              show this help'
  ].join('\n');
}

function parseArguments(argv) {
  const options = { root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--root' || argument === '--candidates' || argument === '--palette') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--root') options.root = path.resolve(value);
      else if (argument === '--candidates') options.candidatesRoot = path.resolve(value);
      else options.palettePath = path.resolve(value);
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 0;
  } else {
    const report = runPixelArtGate({
      repositoryRoot: options.root,
      candidatesRoot: options.candidatesRoot,
      palettePath: options.palettePath
    });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatPixelArtGateReport(report)}\n`);
    // Idle means no candidate PNG was submitted. It is not an asset pass, but
    // an explicitly invoked check has no work item to reject in that state.
    process.exitCode = report.status === 'idle' || report.ok ? 0 : 1;
  }
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}\n`);
  process.exitCode = 2;
}
