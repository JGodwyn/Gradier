import { filteredHex } from './color';
import { hexToRgb, rgbToHex, type Gradient } from './types';

/**
 * A pure-CSS approximation of a mesh gradient (stacked radial gradients).
 * Used as the instant/SSR/no-WebGL fallback and for "Copy CSS" in the editor.
 */
export function gradientToCSS(g: Gradient): string {
  if (!g.points.length) return 'transparent';
  const colors = g.points.map((p) => filteredHex(p, g));
  const avg = colors.reduce<[number, number, number]>(
    (acc, color) => {
      const [r, gg, b] = hexToRgb(color);
      return [acc[0] + r, acc[1] + gg, acc[2] + b];
    },
    [0, 0, 0],
  );
  const n = g.points.length;
  const base = rgbToHex(avg[0] / n, avg[1] / n, avg[2] / n);
  // Softer points reach further before fading out.
  const layers = g.points.map((p, i) => {
    const reach = 35 + (p.softness ?? g.softness) * 35;
    return `radial-gradient(at ${pct(p.x)} ${pct(p.y)}, ${colors[i]} 0px, transparent ${Math.round(Math.min(reach * (p.radius ?? 1), 150))}%)`;
  });
  return `${layers.join(', ')}, ${base}`;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
