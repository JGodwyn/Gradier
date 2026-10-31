import { hexToRgb, rgbToHex, type Gradient } from './types';

/**
 * A pure-CSS approximation of a mesh gradient (stacked radial gradients).
 * Used as the instant/SSR/no-WebGL fallback and for "Copy CSS" in the editor.
 */
export function gradientToCSS(g: Gradient): string {
  if (!g.points.length) return 'transparent';
  const avg = g.points.reduce<[number, number, number]>(
    (acc, p) => {
      const [r, gg, b] = hexToRgb(p.color);
      return [acc[0] + r, acc[1] + gg, acc[2] + b];
    },
    [0, 0, 0],
  );
  const n = g.points.length;
  const base = rgbToHex(avg[0] / n, avg[1] / n, avg[2] / n);
  const reach = Math.round(70 - g.softness * 35);
  const layers = g.points.map(
    (p) => `radial-gradient(at ${pct(p.x)} ${pct(p.y)}, ${p.color} 0px, transparent ${reach}%)`,
  );
  return `${layers.join(', ')}, ${base}`;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
