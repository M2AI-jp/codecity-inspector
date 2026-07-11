import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomeGuest } from '../src/inn.js';

test('宿屋は旅人を迎え、井戸の案内をする', () => {
  assert.equal(welcomeGuest('ミナ'), 'ミナさん、ようこそ。井戸の水は澄んでいます。');
});
