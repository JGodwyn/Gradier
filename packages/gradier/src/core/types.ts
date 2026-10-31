/** A position relative (0–1) to the element box. */
export interface RelPoint {
  x: number;
  y: number;
}

/**
 * Makes a point's colour follow a curve instead of radiating from a single spot.
 * - `line`: a straight segment from `a` to `b`; the point's `x`/`y` is kept at its midpoint.
 * - `arc`: a circular arc from `a` through the point's `x`/`y` to `b`.
 * - `path`: a freehand stroke through `points` (smoothed); the point's `x`/`y` sits at its middle.
 *
 * `ra` / `rb` scale how wide the colour is at the start / end of the curve (default 1).
 */
export type PointShape =
  | { type: 'line' | 'arc'; a: RelPoint; b: RelPoint; ra?: number; rb?: number }
  | { type: 'path'; points: RelPoint[]; ra?: number; rb?: number };

export type GrainType = 'mono' | 'duo' | 'multi';

/** The filter settings a point can override. */
export const POINT_FILTERS = ['hue', 'saturation', 'brightness', 'temperature'] as const;

/** A single colour stop in a mesh gradient. Coordinates are relative (0–1) to the element box. */
export interface GradientPoint {
  x: number;
  y: number;
  /** Hex colour, e.g. `#ff6b6b`. */
  color: string;
  /** How far the colour reaches, as a multiple of the default (1). Omitted when 1. */
  radius?: number;
  /**
   * Four direction handles that stretch or squash the colour's reach, as `[dx, dy]` offsets in units of
   * √(width × height) of the element. A longer arm pushes the colour further that way. Omitted when default.
   */
  arms?: Array<[number, number]>;
  /** Optional curve the colour follows. */
  shape?: PointShape;
  /** Per-point softness (0–1); overrides the gradient's softness for this point. */
  softness?: number;
  /** Per-point filters, applied on top of the gradient's filters. */
  hue?: number;
  saturation?: number;
  brightness?: number;
  temperature?: number;
}

/** How point colours are mixed. `oklab` (default) keeps blends vivid; the last four add a contrast curve on top. */
export type BlendMode = 'normal' | 'linear' | 'oklab' | 'screen' | 'multiply' | 'overlay' | 'softlight';
export const BLEND_MODES: Array<[BlendMode, string]> = [
  ['normal', 'Normal'],
  ['linear', 'Linear'],
  ['oklab', 'OKLab'],
  ['screen', 'Screen'],
  ['multiply', 'Multiply'],
  ['overlay', 'Overlay'],
  ['softlight', 'Soft light'],
];

export interface Gradient {
  points: GradientPoint[];
  /** How soft the blend between points is (0 = crisp, 1 = very soft). */
  softness: number;
  /** How colours mix (default `oklab`). */
  blendMode?: BlendMode;
  /** Amount of organic noise distortion (0–1). */
  warp: number;
  /** Size of the warp noise (0 = large, smooth waves, 1 = small ripples). */
  warpScale: number;
  /** Film grain intensity (0–1). */
  grain: number;
  /** Animation speed (0 = static). */
  speed: number;
  /** Grain colour: `mono` (grey, default), `duo` (warm/cool) or `multi` (per-channel). */
  grainType?: GrainType;
  /** Grain cell size in CSS pixels (1–4, default 1). */
  grainSize?: number;
  /** Grain density (0–2, default 1): below 1 fewer pixels get grain, above 1 it gets stronger. */
  grainDensity?: number;
  /** Hue rotation in degrees (−180–180, default 0). */
  hue?: number;
  /** Saturation multiplier (0–2, default 1). */
  saturation?: number;
  /** Brightness multiplier (0–2, default 1). */
  brightness?: number;
  /** Colour temperature (−1 cool … 1 warm, default 0). */
  temperature?: number;
}

/** Defaults for the optional look settings; they are left out of saved files when unchanged. */
export const LOOK_DEFAULTS = {
  blendMode: 'oklab' as BlendMode,
  grainType: 'mono' as GrainType,
  grainSize: 1,
  grainDensity: 1,
  hue: 0,
  saturation: 1,
  brightness: 1,
  temperature: 0,
};

const LOOK_RANGES: Record<Exclude<keyof typeof LOOK_DEFAULTS, 'grainType' | 'blendMode'>, [number, number]> = {
  grainSize: [1, 4],
  grainDensity: [0, 2],
  hue: [-180, 180],
  saturation: [0, 2],
  brightness: [0, 2],
  temperature: [-1, 1],
};

/** Read a look setting, falling back to its default. */
export function look<K extends keyof typeof LOOK_DEFAULTS>(g: Gradient, key: K): (typeof LOOK_DEFAULTS)[K] {
  return (g[key] ?? LOOK_DEFAULTS[key]) as (typeof LOOK_DEFAULTS)[K];
}

export type GradientMap = Record<string, Gradient>;

export const MAX_POINTS = 12;

/** Default arm length (in √(w×h) units). An arm of this length leaves the reach in its direction unchanged. */
export const ARM_LENGTH = 0.07;
/** On-screen radius of a point's area at `radius: 1`, in √(w×h) units. */
export const AREA_RADIUS = 0.14;
export const MIN_RADIUS = 0.2;
/** Most control points kept for a freehand stroke. */
export const MAX_PATH_POINTS = 64;
export const MAX_RADIUS = 5;

export const defaultArms = (): Array<[number, number]> => [
  [ARM_LENGTH, 0],
  [0, ARM_LENGTH],
  [-ARM_LENGTH, 0],
  [0, -ARM_LENGTH],
];

/** Move a point (and its curve, if any) by an offset. */
export function translatePoint(p: GradientPoint, dx: number, dy: number): void {
  p.x += dx;
  p.y += dy;
  const s = p.shape;
  if (!s) return;
  for (const q of s.type === 'path' ? s.points : [s.a, s.b]) {
    q.x += dx;
    q.y += dy;
  }
}

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
    const { x, y, color, radius, arms, shape } = p as Record<string, unknown>;
    if (typeof color !== 'string' || !HEX_RE.test(normalizeHex(color))) return [];
    const out: GradientPoint = { x: coord(x), y: coord(y), color: normalizeHex(color) };
    const r = round(num(radius, 1, MIN_RADIUS, MAX_RADIUS));
    if (r !== 1) out.radius = r;
    const a = normalizeArms(arms);
    if (a) out.arms = a;
    const raw = p as Record<string, unknown>;
    if (typeof raw.softness === 'number') out.softness = round(num(raw.softness, 0.5, 0, 1));
    for (const key of POINT_FILTERS) {
      const [min, max] = LOOK_RANGES[key];
      const v = round(num(raw[key], LOOK_DEFAULTS[key], min, max));
      if (v !== LOOK_DEFAULTS[key]) out[key] = v;
    }
    const sh = normalizeShape(shape);
    if (sh) {
      out.shape = sh;
      if (sh.type === 'line') {
        out.x = round((sh.a.x + sh.b.x) / 2);
        out.y = round((sh.a.y + sh.b.y) / 2);
      }
    }
    return [out];
  });
  return {
    points: points.length ? points : randomGradient().points,
    softness: round(num(g.softness, DEFAULTS.softness, 0, 1)),
    warp: round(num(g.warp, DEFAULTS.warp, 0, 1)),
    warpScale: round(num(g.warpScale, DEFAULTS.warpScale, 0, 1)),
    grain: round(num(g.grain, DEFAULTS.grain, 0, 1)),
    speed: round(num(g.speed, DEFAULTS.speed, 0, 1)),
    ...normalizeLook(g),
  };
}

function normalizeLook(g: Record<string, unknown>): Partial<Gradient> {
  const out: Partial<Gradient> = {};
  if (g.grainType === 'duo' || g.grainType === 'multi') out.grainType = g.grainType;
  if (BLEND_MODES.some(([m]) => m === g.blendMode) && g.blendMode !== 'oklab') out.blendMode = g.blendMode as BlendMode;
  for (const [key, [min, max]] of Object.entries(LOOK_RANGES) as Array<[keyof typeof LOOK_RANGES, [number, number]]>) {
    const v = round(num(g[key], LOOK_DEFAULTS[key], min, max));
    if (v !== LOOK_DEFAULTS[key]) out[key] = v;
  }
  return out;
}

const coord = (v: unknown) => round(num(v, 0.5, -0.5, 1.5));

function normalizeArms(input: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(input) || input.length !== 4) return undefined;
  const arms = input.map((arm): [number, number] => {
    const [dx, dy] = Array.isArray(arm) ? arm : [];
    let x = round(num(dx, 0, -1.5, 1.5));
    let y = round(num(dy, 0, -1.5, 1.5));
    if (Math.hypot(x, y) < 0.005) [x, y] = [0.005, 0];
    return [x, y];
  });
  const def = defaultArms();
  return arms.every((a, i) => a[0] === def[i]![0] && a[1] === def[i]![1]) ? undefined : arms;
}

function normalizeShape(input: unknown): PointShape | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const { type, a, b, points, ra, rb } = input as Record<string, unknown>;
  const pt = (v: unknown): RelPoint | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const { x, y } = v as Record<string, unknown>;
    return typeof x === 'number' && typeof y === 'number' ? { x: coord(x), y: coord(y) } : undefined;
  };
  const ends: { ra?: number; rb?: number } = {};
  const endA = round(num(ra, 1, 0.1, MAX_RADIUS));
  const endB = round(num(rb, 1, 0.1, MAX_RADIUS));
  if (endA !== 1) ends.ra = endA;
  if (endB !== 1) ends.rb = endB;
  if (type === 'path') {
    if (!Array.isArray(points)) return undefined;
    const pts = points.slice(0, MAX_PATH_POINTS).map(pt).filter((q): q is RelPoint => !!q);
    return pts.length >= 2 ? { type, points: pts, ...ends } : undefined;
  }
  if (type !== 'line' && type !== 'arc') return undefined;
  const pa = pt(a);
  const pb = pt(b);
  return pa && pb ? { type, a: pa, b: pb, ...ends } : undefined;
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
    softness: 0.6,
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
