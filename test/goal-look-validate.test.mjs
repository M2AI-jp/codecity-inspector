import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOverlay, defaultManifest, layoutKey } from '../src/overlay/place.mjs';
import { goal, overlay, openTown } from './helpers/goal-look-fixtures.mjs';

const manifest = defaultManifest();

test('goal.look: omitted stays absent; unknown strings and invalid types are diagnosed', () => {
  const { look, ...plain } = goal;
  assert.equal(Object.hasOwn(overlay(plain).goal, 'look'), false);
  for (const value of ['unknown', '__proto__', 'constructor', '', 2, null, {}]) {
    const result = overlay({ ...goal, look: value });
    assert.equal(result.goal, undefined);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /look/);
    const placed = placeOverlay(openTown(), result, manifest);
    assert.equal(placed.overlay.goal, null);
    assert.equal(placed.props.length, 0);
    assert.equal(placed.overlay.unplaced[0].scope, 'goal');
  }
  assert.notEqual(layoutKey(overlay(plain)), layoutKey(overlay()));
  assert.equal(layoutKey(overlay()), layoutKey(overlay({ ...goal, label: '別の名札' })));
  assert.notEqual(layoutKey(overlay()), layoutKey(overlay({ ...goal, at: { path: 'src' } })));
});
