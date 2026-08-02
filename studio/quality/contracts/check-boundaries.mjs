import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundaryProblems } from './import-boundary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const shipRoot = path.join(repositoryRoot, 'ship');

async function javascriptFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await javascriptFiles(absolute));
    if (entry.isFile() && entry.name.endsWith('.mjs')) output.push(absolute);
  }
  return output.sort();
}

const problems = [];
for (const absolute of await javascriptFiles(shipRoot)) {
  const repositoryPath = path.relative(repositoryRoot, absolute);
  problems.push(...boundaryProblems(repositoryPath, await readFile(absolute, 'utf8')));
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('module boundaries: ok\n');
}
