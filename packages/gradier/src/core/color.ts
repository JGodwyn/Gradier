import { hexToRgb, rgbToHex, type Gradient, type GradientPoint } from './types';

export type Lab = [number, number, number];

export function srgbToOklab(hex: string): Lab {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToHex([L, A, B]: Lab): string {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = lin.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
  });
  return rgbToHex(enc[0]!, enc[1]!, enc[2]!);
}

type FilterSource = { hue?: number; saturation?: number; brightness?: number; temperature?: number };

/** Apply hue / saturation / brightness / temperature to an OKLab colour. All four are affine in OKLab, so filtering
 * each point before blending gives exactly the same result as filtering the blended colour. */
export function applyFilters([L, A, B]: Lab, f: FilterSource): Lab {
  const hue = ((f.hue ?? 0) * Math.PI) / 180;
  const sat = f.saturation ?? 1;
  const temp = f.temperature ?? 0;
  const c = Math.cos(hue);
  const s = Math.sin(hue);
  const a = (A * c - B * s) * sat + temp * 0.012;
  const b = (A * s + B * c) * sat + temp * 0.06;
  return [L * (f.brightness ?? 1), a, b];
}

/** A point's colour in OKLab with its own filters and then the gradient's filters applied. */
export function pointLab(p: GradientPoint, g: Gradient): Lab {
  return applyFilters(applyFilters(srgbToOklab(p.color), p), g);
}

const isPlain = (f: FilterSource) => !f.hue && (f.saturation ?? 1) === 1 && (f.brightness ?? 1) === 1 && !f.temperature;

/** A point colour with its own and the gradient's filters applied, as hex. */
export function filteredHex(p: GradientPoint, g: Gradient): string {
  return isPlain(p) && isPlain(g) ? p.color : oklabToHex(pointLab(p, g));
}

/** OKLab → linear sRGB (unclamped). */
export function oklabToLinear([L, A, B]: Lab): Lab {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export const encodeSrgb = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};
