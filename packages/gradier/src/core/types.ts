/** A single colour stop in a mesh gradient. Coordinates are relative (0–1) to the element box. */
export interface GradientPoint {
  x: number;
  y: number;
  /** Hex colour, e.g. `#ff6b6b`. */
  color: string;
}

export interface Gradient {
  points: GradientPoint[];
  /** How sharply each point's colour holds before blending (0 = very soft, 1 = crisp). */
  softness: number;
  /** Amount of organic noise distortion (0–1). */
  warp: number;
  /** Size of the warp noise (0 = large, smooth waves, 1 = small ripples). */
  warpScale: number;
  /** Film grain intensity (0–1). */
  grain: number;
  /** Animation speed (0 = static). */
  speed: number;
}

export type GradientMap = Record<string, Gradient>;

export const MAX_POINTS = 12;

export const DEFAULTS: Omit<Gradient, 'points'> = {
  softness: 0.5,
  warp: 0.25,
  warpScale: 0.35,
  grain: 0.06,
  speed: 0,
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
const round = (v: number) => Math.round(v * 1000) / 1000;

export function normalizeHex(color: string): string {
  let c = color.trim().toLowerCase();
  if (!c.startsWith('#')) c = `#${c}`;
  if (!HEX_RE.test(c)) return '#000000';
  if (c.length === 4) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return c;
}

/** Coerce arbitrary input (e.g. parsed JSON) into a valid gradient, filling in defaults. */
export function normalizeGradient(input: unknown): Gradient {
  const g = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rawPoints = Array.isArray(g.points) ? g.points : [];
  const points = rawPoints.slice(0, MAX_POINTS).flatMap((p): GradientPoint[] => {
    if (!p || typeof p !== 'object') return [];
    const { x, y, color } = p as Record<string, unknown>;
    if (typeof color !== 'string' || !HEX_RE.test(normalizeHex(color))) return [];
    return [{ x: round(num(x, 0.5, -0.5, 1.5)), y: round(num(y, 0.5, -0.5, 1.5)), color: normalizeHex(color) }];
  });
  return {
    points: points.length ? points : randomGradient().points,
    softness: round(num(g.softness, DEFAULTS.softness, 0, 1)),
    warp: round(num(g.warp, DEFAULTS.warp, 0, 1)),
    warpScale: round(num(g.warpScale, DEFAULTS.warpScale, 0, 1)),
    grain: round(num(g.grain, DEFAULTS.grain, 0, 1)),
    speed: round(num(g.speed, DEFAULTS.speed, 0, 1)),
  };
}

export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-zA-Z0-9][\w-]{0,63}$/.test(name);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** A pleasant random gradient: an analogous/complementary palette scattered over the box. */
export function randomGradient(count = 5): Gradient {
  const base = Math.random() * 360;
  const spread = 40 + Math.random() * 120;
  const points: GradientPoint[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (base + (i / (count - 1 || 1)) * spread + (Math.random() - 0.5) * 20 + 360) % 360;
    const light = 0.45 + Math.random() * 0.35;
    const sat = 0.55 + Math.random() * 0.4;
    points.push({
      x: round(0.1 + Math.random() * 0.8),
      y: round(0.1 + Math.random() * 0.8),
      color: hslToHex(hue, sat, light),
    });
  }
  return { ...DEFAULTS, points };
}

export const PRESETS: Record<string, Gradient> = {
  Aurora: {
    ...DEFAULTS,
    warp: 0.45,
    points: [
      { x: 0.1, y: 0.15, color: '#0b1d51' },
      { x: 0.85, y: 0.1, color: '#2bd2ff' },
      { x: 0.5, y: 0.55, color: '#2bff88' },
      { x: 0.15, y: 0.9, color: '#7a2bff' },
      { x: 0.9, y: 0.85, color: '#0b1d51' },
    ],
  },
  Peach: {
    ...DEFAULTS,
    points: [
      { x: 0.15, y: 0.2, color: '#ffd6a5' },
      { x: 0.8, y: 0.15, color: '#ff8fab' },
      { x: 0.55, y: 0.6, color: '#ffc2d1' },
      { x: 0.1, y: 0.85, color: '#ffb4a2' },
      { x: 0.9, y: 0.9, color: '#e5989b' },
    ],
  },
  Ocean: {
    ...DEFAULTS,
    softness: 0.4,
    points: [
      { x: 0.2, y: 0.1, color: '#caf0f8' },
      { x: 0.85, y: 0.25, color: '#48cae4' },
      { x: 0.4, y: 0.55, color: '#0096c7' },
      { x: 0.1, y: 0.9, color: '#023e8a' },
      { x: 0.8, y: 0.85, color: '#03045e' },
    ],
  },
  Sunset: {
    ...DEFAULTS,
    warp: 0.35,
    points: [
      { x: 0.5, y: 0.0, color: '#2d00f7' },
      { x: 0.1, y: 0.4, color: '#8900f2' },
      { x: 0.9, y: 0.45, color: '#f20089' },
      { x: 0.3, y: 0.85, color: '#ff7b00' },
      { x: 0.8, y: 0.95, color: '#ffd000' },
    ],
  },
  Mono: {
    ...DEFAULTS,
    grain: 0.12,
    points: [
      { x: 0.2, y: 0.2, color: '#f5f5f4' },
      { x: 0.8, y: 0.3, color: '#a8a29e' },
      { x: 0.3, y: 0.8, color: '#57534e' },
      { x: 0.85, y: 0.85, color: '#1c1917' },
    ],
  },
};
