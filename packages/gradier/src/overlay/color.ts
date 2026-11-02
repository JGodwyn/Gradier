import { h } from './dom';
import { ICONS } from './icons';

// ---------- colour maths ----------
type Hsv = { h: number; s: number; v: number };
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function hexToRgb(hex: string): [number, number, number] {
  let s = hex.replace('#', '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const n = Number.parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsv([r, g, b]: [number, number, number]): Hsv {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let hue = 0;
  if (d) hue = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function hsvToRgb({ h: hue, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [Math.round(rgbToHsv([r, g, b]).h), Math.round(s * 100), Math.round(l * 100)];
}
function hslToRgb(hue: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHex = (v: string) => HEX_RE.test(v.trim());
export const normHex = (v: string) => {
  let s = v.trim().replace('#', '').toLowerCase();
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  return `#${s}`;
};

type Format = 'hex' | 'rgb' | 'hsl';
const FORMAT_KEY = 'gradier:colorFormat';

function formatValue(hex: string, f: Format): string {
  const rgb = hexToRgb(hex);
  if (f === 'rgb') return rgb.join(', ');
  if (f === 'hsl') {
    const [hh, s, l] = rgbToHsl(rgb);
    return `${hh}, ${s}%, ${l}%`;
  }
  return hex;
}
function parseValue(text: string, f: Format): string | null {
  const t = text.trim();
  if (isHex(t)) return normHex(t);
  const nums = t.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null;
  if (f === 'hsl' || /hsl/i.test(t)) return rgbToHex(...hslToRgb(((nums[0]! % 360) + 360) % 360, clamp(nums[1]!, 0, 100) / 100, clamp(nums[2]!, 0, 100) / 100));
  return rgbToHex(nums[0]!, nums[1]!, nums[2]!);
}

// ---------- picker ----------
export interface ColorPicker {
  /** Open for `key`, next to `anchor`. `onInput` gets every change while dragging or typing. */
  open(key: string, anchor: HTMLElement, hex: string, onInput: (hex: string) => void): void;
  close(animate?: boolean): void;
  readonly key: string | null;
  /** The panel is being rebuilt: fields call `rebind` to keep an open picker attached; unclaimed pickers close. */
  beginBind(): void;
  rebind(key: string, anchor: HTMLElement, onInput: (hex: string) => void): void;
  endBind(): void;
  /** The colour changed elsewhere (undo, typing in the field). */
  sync(key: string, hex: string): void;
  contains(node: EventTarget | null): boolean;
}

/**
 * Popover colour picker: a saturation/brightness square, a hue bar, and a value row (HEX, RGB or HSL) with a preview.
 * One instance is shared by every colour field.
 */
export function createColorPicker(root: HTMLElement, getPanel: () => HTMLElement | null): ColorPicker {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let hsv: Hsv = { h: 0, s: 0, v: 0 };
  let key: string | null = null;
  let onInput: ((hex: string) => void) | null = null;
  let bound = false;
  let dragging = false;
  let format: Format = (() => {
    try {
      const f = localStorage.getItem(FORMAT_KEY);
      return f === 'rgb' || f === 'hsl' ? f : 'hex';
    } catch {
      return 'hex';
    }
  })();

  const svThumb = h('div', { className: 'cp-thumb', tabIndex: 0, role: 'slider', 'aria-label': 'Saturation and brightness' });
  const sv = h('div', { className: 'cp-sv' }, h('div', { className: 'cp-sv-white' }), h('div', { className: 'cp-sv-black' }), svThumb);
  const hueThumb = h('div', { className: 'cp-thumb', tabIndex: 0, role: 'slider', 'aria-label': 'Hue' });
  const hue = h('div', { className: 'cp-hue' }, hueThumb);
  const select = h(
    'select',
    { className: 'cp-format', 'aria-label': 'Colour format' },
    ...(['hex', 'rgb', 'hsl'] as Format[]).map((f) => h('option', { value: f }, f.toUpperCase())),
  );
  const value = h('input', { className: 'cp-value', spellcheck: false, 'aria-label': 'Colour value' });
  const preview = h('span', { className: 'cp-preview' });
  const el = h('div', { className: 'cpick', role: 'dialog', 'aria-label': 'Colour picker' }, sv, hue, h('div', { className: 'cp-row' }, select, h('span', { className: 'cp-div' }), value, preview));
  el.style.pointerEvents = 'auto';

  const hex = () => rgbToHex(...hsvToRgb(hsv));
  const paint = () => {
    const c = hex();
    sv.style.backgroundColor = `hsl(${hsv.h} 100% 50%)`;
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    svThumb.style.color = c;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    hueThumb.style.color = `hsl(${hsv.h} 100% 50%)`;
    preview.style.background = c;
    select.value = format;
    if (el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot).activeElement !== value) value.value = formatValue(c, format);
  };
  const emit = () => {
    paint();
    onInput?.(hex());
  };

  const drag = (target: HTMLElement, apply: (x: number, y: number) => void) => {
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      target.setPointerCapture(e.pointerId);
      (target.querySelector('.cp-thumb') as HTMLElement | null)?.focus({ preventScroll: true });
      const move = (ev: PointerEvent) => {
        const r = target.getBoundingClientRect();
        apply(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
        emit();
      };
      const up = () => {
        dragging = false;
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
      move(e);
    });
  };
  drag(sv, (x, y) => ((hsv.s = x), (hsv.v = 1 - y)));
  drag(hue, (x) => (hsv.h = Math.min(x * 360, 359.9)));

  // Arrow keys: 1% / 1° steps, Shift for 10.
  svThumb.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    hsv.s = clamp(hsv.s + d[0]!, 0, 1);
    hsv.v = clamp(hsv.v + d[1]!, 0, 1);
    emit();
  });
  hueThumb.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    hsv.h = clamp(hsv.h + d, 0, 359.9);
    emit();
  });

  select.addEventListener('change', () => {
    format = select.value as Format;
    try {
      localStorage.setItem(FORMAT_KEY, format);
    } catch {}
    value.value = formatValue(hex(), format);
  });
  const commit = () => {
    const next = parseValue(value.value, format);
    if (!next) return void (value.value = formatValue(hex(), format));
    const n = rgbToHsv(hexToRgb(next));
    hsv = n.s === 0 ? { ...n, h: hsv.h } : n;
    emit();
  };
  value.addEventListener('change', commit);
  value.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(), value.blur();
  });

  /** Beside the panel (on whichever side has room), level with the field; below the field as a fallback. */
  const place = (anchor: HTMLElement) => {
    const a = anchor.getBoundingClientRect();
    const p = getPanel()?.getBoundingClientRect();
    const w = el.offsetWidth || 280;
    const ht = el.offsetHeight || 300;
    let x: number;
    let y = a.top - 12;
    let origin: string;
    if (p && p.left - w - 12 >= 8) {
      x = p.left - w - 12;
      origin = 'right center';
    } else if (p && p.right + 12 + w <= innerWidth - 8) {
      x = p.right + 12;
      origin = 'left center';
    } else {
      x = a.left;
      y = a.bottom + 8;
      origin = 'top left';
    }
    el.style.left = `${Math.round(clamp(x, 8, innerWidth - w - 8))}px`;
    el.style.top = `${Math.round(clamp(y, 8, innerHeight - ht - 8))}px`;
    el.style.transformOrigin = origin;
  };

  let closing: Animation | null = null;
  const picker: ColorPicker = {
    open(k, anchor, color, fn) {
      const wasOpen = !!key && el.isConnected && !closing;
      closing?.cancel();
      closing = null;
      key = k;
      onInput = fn;
      const next = rgbToHsv(hexToRgb(color));
      hsv = next.s === 0 ? { ...next, h: hsv.h } : next;
      if (!el.isConnected) root.append(el);
      paint();
      place(anchor);
      if (!wasOpen) {
        el.getAnimations().forEach((a) => a.cancel());
        el.animate(reduce?.matches ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], {
          duration: 160,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        });
      }
    },
    close(animate = true) {
      if (!key) return;
      key = null;
      onInput = null;
      if (!animate || !el.isConnected) return void el.remove();
      closing = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' });
      closing.finished.then(
        () => {
          closing = null;
          if (!key) el.remove();
        },
        () => {},
      );
    },
    get key() {
      return key;
    },
    beginBind() {
      bound = false;
    },
    rebind(k, anchor, fn) {
      if (k !== key) return;
      bound = true;
      onInput = fn;
      if (!dragging) place(anchor);
    },
    endBind() {
      if (key && !bound) picker.close(false);
    },
    sync(k, color) {
      if (k !== key || dragging || color.toLowerCase() === hex()) return;
      const next = rgbToHsv(hexToRgb(color));
      hsv = next.s === 0 ? { ...next, h: hsv.h } : next;
      paint();
    },
    contains: (node) => node instanceof Node && el.contains(node),
  };
  return picker;
}

// ---------- field ----------
export interface ColorFieldOptions {
  picker: ColorPicker;
  /** Identifies the colour so an open picker survives panel rebuilds, e.g. `mesh:hero:2`. */
  key: string;
  /** Any colour the field shows: a hex, or (with `free`) the authored CSS value. */
  text: string;
  /** Resolved hex for the swatch and picker. */
  hex: string;
  /** 0–1. */
  alpha: number;
  onColor(hex: string): void;
  onAlpha(alpha: number): void;
  /** Accept any CSS colour in the text box (CSS stops); otherwise hex only. */
  free?: boolean;
  onText?(text: string): void;
}

export interface ColorField {
  el: HTMLElement;
  set(text: string, hex: string, alpha: number): void;
}

const display = (text: string) => (isHex(text) ? normHex(text).slice(1).toUpperCase() : text);

/** `[swatch | HEX] [◐ 100 %]`: a colour that opens the picker, plus its opacity (type, arrow keys, or drag the icon). */
export function colorField(o: ColorFieldOptions): ColorField {
  let cur = { text: o.text, hex: o.hex, alpha: o.alpha };
  const chip = h('span', { className: 'cf-chip' });
  const swatch = h('button', { className: 'cf-swatch', type: 'button', title: 'Pick a colour', 'aria-label': 'Pick a colour' }, chip);
  const text = h('input', { className: 'cf-hex', spellcheck: false, 'aria-label': 'Colour' });
  const icon = h('span', { className: 'cf-icon', title: 'Drag to change the opacity' });
  icon.innerHTML = ICONS.opacity;
  const alpha = h('input', { className: 'cf-alpha', inputMode: 'numeric', 'aria-label': 'Opacity (%)' });
  const el = h(
    'div',
    { className: 'cf' },
    h('div', { className: 'cf-color' }, swatch, text),
    h('label', { className: 'cf-opacity' }, icon, alpha, h('span', { className: 'cf-unit' }, '%')),
  );

  const pick = (hex: string) => {
    cur = { ...cur, hex, text: hex };
    paint();
    o.onColor(hex);
  };
  swatch.addEventListener('click', () => {
    if (o.picker.key === o.key) return o.picker.close();
    o.picker.open(o.key, swatch, cur.hex, pick);
  });
  o.picker.rebind(o.key, swatch, pick);

  const commitText = () => {
    const v = text.value.trim();
    if (isHex(v)) {
      const hx = normHex(v);
      if (hx !== cur.hex) pick(hx);
      else paint();
    } else if (o.free && o.onText && v && CSS.supports('color', v)) o.onText(v);
    else paint();
  };
  text.addEventListener('change', commitText);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') text.blur();
    else if (e.key === 'Escape') paint(), text.blur();
  });

  const setAlpha = (pct: number) => {
    const a = clamp(Math.round(pct), 0, 100) / 100;
    if (a === cur.alpha) return paint();
    cur = { ...cur, alpha: a };
    paint();
    o.onAlpha(a);
  };
  alpha.addEventListener('change', () => {
    const n = Number.parseFloat(alpha.value);
    Number.isFinite(n) ? setAlpha(n) : paint();
  });
  alpha.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setAlpha(cur.alpha * 100 + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    } else if (e.key === 'Enter') alpha.blur();
  });
  // Scrub: drag the icon sideways, 1% per 2px.
  icon.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    icon.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const a0 = cur.alpha * 100;
    const move = (ev: PointerEvent) => setAlpha(a0 + (ev.clientX - x0) / 2);
    const up = () => {
      icon.removeEventListener('pointermove', move);
      icon.removeEventListener('pointerup', up);
    };
    icon.addEventListener('pointermove', move);
    icon.addEventListener('pointerup', up);
  });

  const paint = () => {
    const [r, g, b] = hexToRgb(cur.hex);
    chip.style.background = `rgb(${r} ${g} ${b} / ${cur.alpha})`;
    const root = el.getRootNode() as ShadowRoot | Document;
    if (root.activeElement !== text) text.value = display(cur.text);
    if (root.activeElement !== alpha) alpha.value = String(Math.round(cur.alpha * 100));
  };
  paint();

  return {
    el,
    set(t, hx, a) {
      cur = { text: t, hex: hx, alpha: a };
      paint();
      o.picker.sync(o.key, hx);
    },
  };
}
