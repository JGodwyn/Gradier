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
