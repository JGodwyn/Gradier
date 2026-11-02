import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeGradient } from '../src/core/types';

test('point opacity is kept below 1, clamped, and omitted when opaque', () => {
  const g = normalizeGradient({
    points: [
      { x: 0, y: 0, color: '#ff0000', opacity: 0.5 },
      { x: 1, y: 1, color: '#0000ff', opacity: 1 },
      { x: 0.5, y: 0.5, color: '#00ff00', opacity: -2 },
    ],
  });
  assert.equal(g.points[0]!.opacity, 0.5);
  assert.equal('opacity' in g.points[1]!, false);
  assert.equal(g.points[2]!.opacity, 0);
});
