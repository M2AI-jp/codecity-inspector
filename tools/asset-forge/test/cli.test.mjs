import assert from 'node:assert/strict';
import test from 'node:test';
import { main, parseArgs } from '../src/cli.mjs';

test('CLI parser distinguishes boolean and valued options and rejects ambiguity', () => {
  assert.deepEqual(parseArgs(['generate', '--asset', 'field.grass', '--dry-run']), {
    command: 'generate', options: { asset: 'field.grass', dryRun: true }
  });
  assert.throws(() => parseArgs(['generate', '--asset']), /requires a value/);
  assert.throws(() => parseArgs(['generate', '--asset', 'a', '--asset', 'b']), /Duplicate option/);
  assert.throws(() => parseArgs(['generate', 'field.grass']), /Unknown argument/);
});

test('doctor reports provider availability without authentication or API use', async () => {
  const result = await main(['doctor']);
  assert.equal(result.providers.mock.status, 'available');
  assert.equal(result.providers['codex-subscription'].status, 'unavailable');
  assert.equal(result.apiUsage, false);
  assert.equal(result.authenticationAttempted, false);
});
