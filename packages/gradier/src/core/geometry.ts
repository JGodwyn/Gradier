/** Geometry shared by the renderer and the editor overlay. All inputs must be in an isotropic space (e.g. pixels). */

export type Vec = { x: number; y: number };

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

export interface Arc {
  cx: number;
  cy: number;
  r: number;
  /** Start angle in radians, [0, 2π). The arc runs counter-clockwise (increasing angle) from here. */
  start: number;
  /** Positive sweep in radians, (0, 2π). */
  sweep: number;
}

/**
 * The circular arc that starts at `a`, passes through `m` and ends at `b`.
 * Returns null when the three points are (nearly) collinear — callers should treat that as a straight line.
 */
export function arcThrough(a: Vec, m: Vec, b: Vec): Arc | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  // Relative collinearity test: twice the triangle area against the chord length squared.
  if (Math.abs(d) < 1e-3 * Math.max(chord * chord, 1e-9)) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  const cx = (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d;
  const cy = (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  if (!Number.isFinite(r) || r > chord * 200) return null;
  const angA = wrap(Math.atan2(a.y - cy, a.x - cx));
  const angM = wrap(Math.atan2(m.y - cy, m.x - cx));
  const angB = wrap(Math.atan2(b.y - cy, b.x - cx));
  const toB = wrap(angB - angA);
  const toM = wrap(angM - angA);
  return toM <= toB ? { cx, cy, r, start: angA, sweep: toB } : { cx, cy, r, start: angB, sweep: TAU - toB };
}

/** Points along the arc a → m → b (or the straight segment if they are collinear). */
export function arcSamples(a: Vec, m: Vec, b: Vec, n = 48): Vec[] {
  const arc = arcThrough(a, m, b);
  if (!arc) return [a, b];
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = arc.start + (arc.sweep * i) / n;
    out.push({ x: arc.cx + arc.r * Math.cos(t), y: arc.cy + arc.r * Math.sin(t) });
  }
  return out;
}

/** A default through-point for a fresh arc from a to b: bulges to the left of a→b (upwards for a left-to-right drag). */
export function defaultBulge(a: Vec, b: Vec, amount = 0.25): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: (a.x + b.x) / 2 + dy * amount, y: (a.y + b.y) / 2 - dx * amount };
}

/** Distance from p to the line through a and b. */
export function distToLine(p: Vec, a: Vec, b: Vec): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
}

/** Smooth a polyline with a Catmull-Rom spline, then resample it to `n` evenly spaced points. */
export function samplePath(points: Vec[], n: number): Vec[] {
  if (points.length < 2) return points.slice();
  const dense: Vec[] = [];
  if (points.length === 2) dense.push(points[0]!, points[1]!);
  else {
    const P = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
    const steps = 8;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = P(i - 1);
      const p1 = P(i);
      const p2 = P(i + 1);
      const p3 = P(i + 2);
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
      }
    }
    dense.push(points[points.length - 1]!);
  }
  return resample(dense, n);
}

/** Cumulative length at each vertex of a polyline. */
export function cumulative(points: Vec[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  return out;
}

/** The point at fraction `f` (0–1) of a polyline's length. */
export function pointAlong(points: Vec[], f: number, lengths = cumulative(points)): Vec {
  const total = lengths[lengths.length - 1]!;
  const target = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < points.length; i++) {
    if (lengths[i]! >= target) {
      const seg = lengths[i]! - lengths[i - 1]! || 1;
      const t = (target - lengths[i - 1]!) / seg;
      const a = points[i - 1]!;
      const b = points[i]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return points[points.length - 1]!;
}

/** Resample a polyline to `n` points evenly spaced along its length. */
export function resample(points: Vec[], n: number): Vec[] {
  if (points.length < 2 || n < 2) return points.slice();
  const lengths = cumulative(points);
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push(pointAlong(points, i / (n - 1), lengths));
  return out;
}

/**
 * Reduce a raw pointer stroke to control points at least `spacing` apart (always keeping both ends),
 * capped at `max` points.
 */
export function simplifyStroke(points: Vec[], spacing: number, max: number): Vec[] {
  if (points.length < 2) return points.slice();
  const out: Vec[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1]!;
    if (Math.hypot(points[i]!.x - last.x, points[i]!.y - last.y) >= spacing) out.push(points[i]!);
  }
  const end = points[points.length - 1]!;
  const last = out[out.length - 1]!;
  if (out.length > 1 && Math.hypot(end.x - last.x, end.y - last.y) < spacing / 2) out.pop();
  out.push(end);
  return out.length > max ? resample(out, max) : out;
}

/**
 * Bend a stroke by moving one end by (dx, dy): points near that end follow fully, and the effect fades
 * smoothly to nothing at the other end.
 */
export function bendPath(points: Vec[], end: 'a' | 'b', dx: number, dy: number): Vec[] {
  const lengths = cumulative(points);
  const total = lengths[lengths.length - 1]! || 1;
  return points.map((p, i) => {
    const s = end === 'a' ? lengths[i]! / total : 1 - lengths[i]! / total;
    const w = 1 - s * s * (3 - 2 * s);
    return { x: p.x + dx * w, y: p.y + dy * w };
  });
}
