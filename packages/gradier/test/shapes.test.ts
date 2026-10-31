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

test('freehand paths: smoothing keeps the ends, bending fades out along the stroke', async () => {
  const { samplePath, bendPath, simplifyStroke } = await import('../src/core/geometry');
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 5 }];
  const smooth = samplePath(pts, 32);
  assert.equal(smooth.length, 32);
  close(smooth[0]!.x, 0);
  close(smooth[31]!.x, 30);
  close(smooth[31]!.y, 5);
  const bent = bendPath(pts, 'b', 0, 10);
  close(bent[3]!.y, 15); // the dragged end moves fully
  close(bent[0]!.y, 0); // the far end stays put
  assert.ok(bent[2]!.y > 0 && bent[2]!.y < 10);
  const raw = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.5, y: 0 }));
  const simple = simplifyStroke(raw, 6, 64);
  assert.ok(simple.length < 30);
  assert.deepEqual(simple[0], raw[0]);
  assert.deepEqual(simple.at(-1), raw.at(-1));
});

test('normalizeGradient keeps path shapes and end widths, and only non-default look settings', () => {
  const g = normalizeGradient({
    points: [
      { x: 0.5, y: 0.5, color: '#fff', shape: { type: 'path', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 0.9, y: 0.2 }], ra: 2, rb: 1 } },
      { x: 0.5, y: 0.5, color: '#000', shape: { type: 'path', points: [{ x: 0.1, y: 0.1 }] } },
    ],
    grainType: 'multi',
    grainSize: 1,
    hue: 400,
    saturation: 1.5,
  });
  const path = g.points[0]!.shape!;
  assert.equal(path.type, 'path');
  assert.equal(path.type === 'path' && path.points.length, 3);
  assert.equal(path.ra, 2);
  assert.equal(path.rb, undefined);
  assert.equal(g.points[1]!.shape, undefined); // a 1-point path is dropped
  assert.equal(g.grainType, 'multi');
  assert.equal(g.grainSize, undefined);
  assert.equal(g.hue, 180);
  assert.equal(g.saturation, 1.5);
  assert.equal(g.brightness, undefined);
});

test('per-point softness and filters, and blend mode, survive normalization; defaults are dropped', () => {
  const g = normalizeGradient({
    blendMode: 'overlay',
    points: [
      { x: 0.1, y: 0.1, color: '#f00', softness: 0.9, hue: 30, saturation: 1 },
      { x: 0.9, y: 0.9, color: '#00f' },
    ],
  });
  assert.equal(g.blendMode, 'overlay');
  assert.equal(g.points[0]!.softness, 0.9);
  assert.equal(g.points[0]!.hue, 30);
  assert.equal(g.points[0]!.saturation, undefined);
  assert.equal(g.points[1]!.softness, undefined);
  assert.equal(normalizeGradient({ blendMode: 'oklab', points: g.points }).blendMode, undefined);
  assert.equal(normalizeGradient({ blendMode: 'bogus', points: g.points }).blendMode, undefined);
});

test('filters are affine in OKLab, so filtering each colour before blending equals filtering the blend', async () => {
  const { applyFilters, srgbToOklab } = await import('../src/core/color');
  const f = { hue: 70, saturation: 1.4, brightness: 0.8, temperature: 0.5 };
  const a = srgbToOklab('#ff6b6b');
  const b = srgbToOklab('#2bd2ff');
  const w = 0.3;
  const mix = (p: number[], q: number[]) => p.map((v, i) => v * w + q[i]! * (1 - w));
  const before = mix(applyFilters(a, f), applyFilters(b, f));
  const after = applyFilters(mix(a, b) as [number, number, number], f);
  before.forEach((v, i) => close(v, after[i]!, 1e-9));
});
