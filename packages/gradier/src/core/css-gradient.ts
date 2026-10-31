/**
 * Parsing, matching and serialising plain CSS gradients (`linear-gradient(…)` and friends).
 * Shared by the dev overlay (browser) and the save server (Node), so it must not touch the DOM.
 */

export type GradientFn = 'linear' | 'radial' | 'conic';

export interface TextRange {
  start: number;
  end: number;
  text: string;
}

export interface ParsedStop {
  /** Colour token as written (`#fff`, `var(--brand)`, `rgb(0 0 0 / 50%)`…). Empty for a colour hint. */
  color: string;
  /** Position tokens as written (`0%`, `20px`, `10% 30%`). */
  positions: string[];
}

export interface ParsedGradient {
  fn: GradientFn;
  repeating: boolean;
  /** The first argument when it is configuration (angle, shape, position…), as written. */
  config: string | null;
  stops: ParsedStop[];
  /** Separators used by the original text, so re-serialising keeps its formatting. */
  format: { open: string; sep: string; close: string };
}

const GRADIENT_RE = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
const MAX_LEN = 4000;

/** Find every gradient function call in `text` (CSS, HTML, JSX, anything). Vendor-prefixed legacy syntax is skipped. */
export function findGradients(text: string): TextRange[] {
  const out: TextRange[] = [];
  GRADIENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GRADIENT_RE.exec(text))) {
    const start = m.index;
    const before = text.slice(Math.max(0, start - 8), start).toLowerCase();
    if (/-(webkit|moz|ms|o)-$/.test(before) || /[\w-]$/.test(before)) continue;
    let depth = 0;
    let end = -1;
    for (let i = start + m[0].length - 1; i < text.length && i - start < MAX_LEN; i++) {
      const c = text[i];
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) {
        end = i + 1;
        break;
      } else if (c === ';' || c === '{' || c === '}') break;
    }
    if (end === -1) continue;
    out.push({ start, end, text: text.slice(start, end) });
    GRADIENT_RE.lastIndex = end;
  }
  return out;
}

/** Split on a separator at paren depth 0. `' '` splits on any whitespace run. */
export function splitTop(s: string, sep: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    const isSep = sep === ' ' ? /\s/.test(c) : c === sep;
    if (isSep && depth === 0) {
      if (sep === ',' || cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (sep === ',' || cur) out.push(cur);
  return out.map((x) => x.trim());
}

const COLOR_FN = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var|env|theme)\(/i;

export function isColorToken(t: string): boolean {
  const s = t.toLowerCase();
  return (
    /^#[0-9a-f]{3,8}$/.test(s) ||
    COLOR_FN.test(s) ||
    s in NAMED_COLORS ||
    s === 'transparent' ||
    s === 'currentcolor' ||
    /^[$@][\w-]+$/.test(s) || // Sass / Less variables
    /^\$\{.*\}$/.test(s) // JS template interpolation
  );
}

export function parseGradient(text: string): ParsedGradient | null {
  const m = /^\s*(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)\s*$/i.exec(text);
  if (!m) return null;
  const inner = m[3]!;
  const open = /^\s*/.exec(inner)![0];
  const close = /\s*$/.exec(inner)![0];
  const sep = /,\s*/.exec(inner)?.[0] ?? ', ';
  const args = splitTop(inner, ',');
  if (!args.length || args.some((a) => !a)) return null;
  let config: string | null = null;
  const firstTokens = splitTop(args[0]!, ' ');
  if (!firstTokens.some(isColorToken)) config = args.shift()!;
  const stops = args.map((arg): ParsedStop => {
    const tokens = splitTop(arg, ' ');
    const ci = tokens.findIndex(isColorToken);
    if (ci === -1) return { color: '', positions: tokens };
    return { color: tokens[ci]!, positions: tokens.filter((_, i) => i !== ci) };
  });
  return {
    fn: m[2]!.toLowerCase() as GradientFn,
    repeating: !!m[1],
    config,
    stops,
    format: { open, sep: sep.includes('\n') ? sep : ', ', close },
  };
}

export function serializeGradient(g: Omit<ParsedGradient, 'format'> & { format?: ParsedGradient['format'] }): string {
  const f = g.format ?? { open: '', sep: ', ', close: '' };
  const parts = [
    ...(g.config ? [g.config] : []),
    ...g.stops.map((s) => [s.color, ...s.positions].filter(Boolean).join(' ')),
  ];
  return `${g.repeating ? 'repeating-' : ''}${g.fn}-gradient(${f.open}${parts.join(f.sep)}${f.close})`;
}

// ---------------------------------------------------------------------------
// Config (angle / shape / position) parsing
// ---------------------------------------------------------------------------

export interface GradientConfig {
  /** Linear angle or conic `from` angle, degrees. */
  angle: number;
  /** Linear `to top right`-style corner, which depends on the box's aspect ratio. */
  corner: string | null;
  shape: 'circle' | 'ellipse';
  /** Radial size: keyword or lengths. */
  size: string;
  /** Position in percent, or null when written in another unit (see `positionRaw`). */
  x: number | null;
  y: number | null;
  positionRaw: string | null;
  /** Colour interpolation, e.g. `in oklch`. */
  interpolation: string;
}

const SIDES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };
const SIZE_KEYWORDS = ['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'];

export function parseAngle(t: string): number | null {
  const m = /^(-?[\d.]+)(deg|rad|grad|turn)?$/i.exec(t.trim());
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (!unit && v !== 0) return null;
  const deg = unit === 'rad' ? (v * 180) / Math.PI : unit === 'grad' ? v * 0.9 : unit === 'turn' ? v * 360 : v;
  return Math.round(deg * 100) / 100;
}

function parsePosition(tokens: string[]): { x: number | null; y: number | null; raw: string | null } {
  if (!tokens.length) return { x: 50, y: 50, raw: null };
  const X: Record<string, number> = { left: 0, center: 50, right: 100 };
  const Y: Record<string, number> = { top: 0, center: 50, bottom: 100 };
  const pct = (t: string) => (/^-?[\d.]+%$/.test(t) ? Number.parseFloat(t) : t === '0' ? 0 : null);
  const t = tokens.map((s) => s.toLowerCase());
  let x: number | null = null;
  let y: number | null = null;
  if (t.length === 1) {
    const a = t[0]!;
    if (a in Y && !(a in X)) (x = 50), (y = Y[a]!);
    else if (a in X) (x = X[a]!), (y = 50);
    else (x = pct(a)), (y = 50);
  } else if (t.length === 2) {
    const [a, b] = t as [string, string];
    if ((a in Y && a !== 'center') || (b in X && b !== 'center')) (x = X[b] ?? pct(b)), (y = Y[a] ?? pct(a));
    else (x = X[a] ?? pct(a)), (y = Y[b] ?? pct(b));
  }
  return x === null || y === null ? { x: null, y: null, raw: tokens.join(' ') } : { x, y, raw: null };
}

export function parseConfig(fn: GradientFn, config: string | null): GradientConfig {
  const cfg: GradientConfig = {
    angle: fn === 'linear' ? 180 : 0,
    corner: null,
    shape: 'ellipse',
    size: 'farthest-corner',
    x: 50,
    y: 50,
    positionRaw: null,
    interpolation: '',
  };
  if (!config) return cfg;
  let tokens = splitTop(config, ' ');
  const inIdx = tokens.findIndex((t) => t.toLowerCase() === 'in');
  if (inIdx > -1) {
    let end = inIdx + 2;
    if (/^(shorter|longer|increasing|decreasing)$/i.test(tokens[end] ?? '')) end += 2;
    cfg.interpolation = tokens.slice(inIdx, end).join(' ');
    tokens = [...tokens.slice(0, inIdx), ...tokens.slice(end)];
  }
  const lower = tokens.map((t) => t.toLowerCase());
  if (fn === 'linear') {
    if (lower[0] === 'to') {
      const sides = lower.slice(1);
      if (sides.length === 1 && sides[0]! in SIDES) cfg.angle = SIDES[sides[0]!]!;
      else cfg.corner = sides.join(' ');
    } else if (lower[0]) cfg.angle = parseAngle(lower[0]) ?? 180;
    return cfg;
  }
  const at = lower.indexOf('at');
  const head = at > -1 ? lower.slice(0, at) : lower;
  const pos = parsePosition(at > -1 ? tokens.slice(at + 1) : []);
  cfg.x = pos.x;
  cfg.y = pos.y;
  cfg.positionRaw = pos.raw;
  if (fn === 'radial') {
    const sizes = head.filter((t) => t !== 'circle' && t !== 'ellipse');
    cfg.shape = head.includes('circle') || (sizes.length === 1 && !SIZE_KEYWORDS.includes(sizes[0]!)) ? 'circle' : 'ellipse';
    if (sizes.length) cfg.size = sizes.join(' ');
  } else {
    const from = head.indexOf('from');
    if (from > -1) cfg.angle = parseAngle(head[from + 1] ?? '') ?? 0;
  }
  return cfg;
}

const n = (v: number) => `${Math.round(v * 10) / 10}`;

export function buildConfig(fn: GradientFn, c: GradientConfig): string | null {
  const parts: string[] = [];
  const position = c.positionRaw ?? (c.x === 50 && c.y === 50 ? '' : `${n(c.x ?? 50)}% ${n(c.y ?? 50)}%`);
  if (fn === 'linear') {
    if (c.corner) parts.push(`to ${c.corner}`);
    else if (c.angle !== 180) parts.push(`${n(c.angle)}deg`);
  } else if (fn === 'radial') {
    if (c.shape === 'circle') parts.push('circle');
    if (c.size !== 'farthest-corner') parts.push(c.size);
    if (position) parts.push(`at ${position}`);
  } else {
    if (c.angle) parts.push(`from ${n(c.angle)}deg`);
    if (position) parts.push(`at ${position}`);
  }
  if (c.interpolation) parts.push(c.interpolation);
  return parts.length ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// Colours (enough to compare authored source with browser-computed values)
// ---------------------------------------------------------------------------

export type RGBA = [number, number, number, number];

const num = (s: string, scale: number) => (s.endsWith('%') ? (Number.parseFloat(s) / 100) * scale : Number.parseFloat(s));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (k0: number) => {
    const k = (k0 + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Parse hex, rgb(), hsl(), named colours and `transparent`. Returns null for anything else. */
export function parseColor(token: string): RGBA | null {
  const s = token.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const named = NAMED_COLORS[s];
  if (named) return parseColor(`#${named}`);
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let hex = m[1]!;
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const v = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return [v(0), v(2), v(4), hex.length === 8 ? Math.round((v(6) / 255) * 1000) / 1000 : 1];
  }
  m = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2]!.replace(/\//g, ' ').replace(/,/g, ' ').trim().split(/\s+/);
  if (parts.length < 3 || parts.some((p) => !/^-?[\d.]+(%|deg)?$/.test(p))) return null;
  const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
  let rgb: [number, number, number];
  if (m[1]!.startsWith('rgb')) rgb = [num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255)];
  else rgb = hslToRgb(Number.parseFloat(parts[0]!), num(parts[1]!, 1) / (parts[1]!.endsWith('%') ? 1 : 100), num(parts[2]!, 1) / (parts[2]!.endsWith('%') ? 1 : 100));
  return [...rgb.map((v) => Math.round(Math.min(255, Math.max(0, v)))), Math.min(1, Math.max(0, alpha))] as RGBA;
}

function colorsEqual(a: string, b: string): boolean {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (ca && cb) return ca.every((v, i) => Math.abs(v - cb[i]!) <= (i === 3 ? 0.02 : 2));
  return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

function canonicalConfig(fn: GradientFn, config: string | null): string {
  const c = parseConfig(fn, config);
  if (fn === 'linear') return c.corner ? `to ${c.corner.split(' ').sort().join(' ')}` : `${((c.angle % 360) + 360) % 360}`;
  const pos = c.positionRaw ?? `${c.x} ${c.y}`;
  return fn === 'radial' ? `${c.shape} ${c.size} ${pos} ${c.interpolation}` : `${c.angle} ${pos} ${c.interpolation}`;
}

const canonicalPos = (p: string) => (/^0(\.0*)?(px|%|em|rem)?$/i.test(p) ? '0' : p.toLowerCase().replace(/\s+/g, ''));

export type MatchQuality = 'exact' | 'colors' | null;

/**
 * Compare two gradient strings semantically: `#fff` equals `rgb(255, 255, 255)`, `to bottom` equals
 * the default direction, and so on. `'colors'` means only the colour sequence matches.
 */
export function compareGradients(a: string, b: string): MatchQuality {
  const ga = parseGradient(a);
  const gb = parseGradient(b);
  if (!ga || !gb || ga.stops.length !== gb.stops.length) return null;
  const colorsMatch = ga.stops.every((s, i) => colorsEqual(s.color, gb.stops[i]!.color));
  if (!colorsMatch) return null;
  const same =
    ga.fn === gb.fn &&
    ga.repeating === gb.repeating &&
    canonicalConfig(ga.fn, ga.config) === canonicalConfig(gb.fn, gb.config) &&
    ga.stops.every((s, i) => s.positions.map(canonicalPos).join(' ') === gb.stops[i]!.positions.map(canonicalPos).join(' '));
  return same ? 'exact' : 'colors';
}

// prettier-ignore
const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  ('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,' +
  'darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
  'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,' +
  'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,' +
  'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,' +
  'lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,' +
  'mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,' +
  'mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,' +
  'mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,' +
  'orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,' +
  'palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,' +
  'purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,' +
  'sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,' +
  'slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,' +
  'tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32')
    .split(',')
    .map((pair) => pair.split(':') as [string, string]),
);
