import { filteredHex } from './color';
import { hexToRgb, rgbToHex, type Gradient } from './types';

/**
 * A pure-CSS approximation of a mesh gradient (stacked radial gradients).
 * Used as the instant/SSR/no-WebGL fallback and for "Copy CSS" in the editor.
 */
export function gradientToCSS(g: Gradient): string {
  if (!g.points.length) return 'transparent';
  const hexes = g.points.map((p) => filteredHex(p, g));
  const colors = hexes.map((c, i) => {
    const o = g.points[i]!.opacity ?? 1;
    if (o >= 1) return c;
    const [r, gg, b] = hexToRgb(c);
    return `rgb(${r} ${gg} ${b} / ${Math.round(o * 100) / 100})`;
  });
  const avg = hexes.reduce<[number, number, number]>(
    (acc, color) => {
      const [r, gg, b] = hexToRgb(color);
      return [acc[0] + r, acc[1] + gg, acc[2] + b];
    },
    [0, 0, 0],
  );
  const n = g.points.length;
  const opacity = g.points.reduce((a, p) => a + (p.opacity ?? 1), 0) / n;
  const hexBase = rgbToHex(avg[0] / n, avg[1] / n, avg[2] / n);
  const [br, bg, bb] = hexToRgb(hexBase);
  const base = opacity >= 1 ? hexBase : `rgb(${br} ${bg} ${bb} / ${Math.round(opacity * 100) / 100})`;
  // Softer points reach further before fading out.
  const layers = g.points.map((p, i) => {
    const reach = 35 + (p.softness ?? g.softness) * 35;
    return `radial-gradient(at ${pct(p.x)} ${pct(p.y)}, ${colors[i]} 0px, transparent ${Math.round(Math.min(reach * (p.radius ?? 1), 150))}%)`;
  });
  return `${layers.join(', ')}, ${base}`;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
