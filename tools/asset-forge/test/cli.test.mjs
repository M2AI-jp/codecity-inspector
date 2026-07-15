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

test('promote-required exposes no flag that can inject confirmation or bypass its ceremony', async () => {
  assert.deepEqual(parseArgs(['promote-required']), { command: 'promote-required', options: {} });
  for (const args of [
    ['promote-required', '--write'],
    ['promote-required', '--answer', 'APPROVE'],
    ['promote-required', '--confirmed', 'true'],
    ['promote-required', '--reviewer', 'human'],
    ['promote-required', '--digest', '0'.repeat(64)]
  ]) await assert.rejects(() => main(args), /does not accept flags or options/);
});

test('promote-required treats __proto__ as a real forbidden option instead of prototype syntax', async () => {
  const parsed = parseArgs(['promote-required', '--__proto__', 'injected']);
  assert.equal(Object.hasOwn(parsed.options, '__proto__'), true);
  assert.equal(parsed.options.__proto__, 'injected');
  assert.deepEqual(Object.keys(parsed.options), ['__proto__']);
  await assert.rejects(
    () => main(['promote-required', '--__proto__', 'injected']),
    /does not accept flags or options/
  );
});
