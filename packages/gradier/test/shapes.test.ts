import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arcSamples, arcThrough, defaultBulge } from '../src/core/geometry';
import { defaultArms, normalizeGradient, translatePoint, type GradientPoint } from '../src/core/types';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('arcThrough finds the circle through three points and the sweep that passes the middle one', () => {
  // Upper half of the unit circle (y down, so "upper" means negative y).
  const arc = arcThrough({ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 })!;
  close(arc.cx, 0);
  close(arc.cy, 0);
  close(arc.r, 1);
  close(arc.sweep, Math.PI);
  const mid = arc.start + arc.sweep / 2;
  close(Math.cos(mid), 0);
  close(Math.sin(mid), -1);
  // The other bulge direction picks the other half.
  const lower = arcThrough({ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 })!;
  close(Math.sin(lower.start + lower.sweep / 2), 1);
});

test('arcThrough returns null for collinear points; arcSamples falls back to a segment', () => {
  assert.equal(arcThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
  assert.deepEqual(arcSamples({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }), [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ]);
});

test('arc samples start and end at the endpoints', () => {
  const a = { x: 10, y: 50 };
  const b = { x: 90, y: 50 };
  const pts = arcSamples(a, defaultBulge(a, b), b);
  const ends = [pts[0]!, pts[pts.length - 1]!];
  for (const target of [a, b]) assert.ok(ends.some((p) => Math.hypot(p.x - target.x, p.y - target.y) < 1e-6));
  // A left-to-right drag bulges upwards.
  assert.ok(pts.every((p) => p.y <= 50 + 1e-6));
});

test('normalizeGradient keeps shapes, radius and arms, and drops defaults', () => {
  const g = normalizeGradient({
    points: [
      { x: 0.1, y: 0.1, color: '#fff' },
      { x: 0.2, y: 0.2, color: '#000', radius: 1, arms: defaultArms() },
      { x: 0.9, y: 0.9, color: '#f00', radius: 2.5, arms: [[0.2, 0], [0, 0.07], [-0.07, 0], [0, -0.07]] },
      { x: 0, y: 0, color: '#0f0', shape: { type: 'line', a: { x: 0.2, y: 0.4 }, b: { x: 0.6, y: 0.8 } } },
      { x: 0.5, y: 0.3, color: '#00f', shape: { type: 'arc', a: { x: 0.2, y: 0.5 }, b: { x: 0.8, y: 0.5 } }, radius: 99 },
      { x: 0.5, y: 0.5, color: '#00f', shape: { type: 'blob', a: {}, b: {} }, arms: [[1, 2]] },
    ],
  });
  const [plain, defaults, custom, line, arc, junk] = g.points as GradientPoint[];
  assert.deepEqual(plain, { x: 0.1, y: 0.1, color: '#ffffff' });
  assert.deepEqual(defaults, { x: 0.2, y: 0.2, color: '#000000' });
  assert.equal(custom!.radius, 2.5);
  assert.deepEqual(custom!.arms![0], [0.2, 0]);
  // Line points are kept at the midpoint of their segment.
  assert.equal(line!.shape!.type, 'line');
  assert.equal(line!.x, 0.4);
  assert.equal(line!.y, 0.6);
  assert.equal(arc!.shape!.type, 'arc');
  assert.equal(arc!.x, 0.5);
  assert.equal(arc!.radius, 5);
  assert.equal(junk!.shape, undefined);
  assert.equal(junk!.arms, undefined);
});

test('translatePoint moves the curve with the point', () => {
  const p: GradientPoint = { x: 0.5, y: 0.5, color: '#fff', shape: { type: 'line', a: { x: 0.3, y: 0.5 }, b: { x: 0.7, y: 0.5 } } };
  translatePoint(p, 0.1, -0.2);
  close(p.x, 0.6);
  close(p.shape!.a.x, 0.4);
  close(p.shape!.b.y, 0.3);
});
