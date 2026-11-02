import {
  buildConfig,
  compareGradients,
  findGradients,
  parseConfig,
  parseGradient,
  serializeGradient,
  type GradientConfig,
  type GradientFn,
  type ParsedGradient,
  type ParsedStop,
} from '../core/css-gradient';
import { MAX_POINTS, type Gradient, type GradientPoint } from '../core/types';
import { colorField, type ColorField, type ColorPicker } from './color';
import { h } from './dom';
import { ICONS } from './icons';
import { describe, type Pseudo } from './picker';

interface SourceMatch {
  file: string;
  line: number;
  column: number;
  start: number;
  end: number;
  text: string;
  quality: 'exact' | 'colors';
  selector: string | null;
  hinted: boolean;
}

interface Model {
  fn: GradientFn;
  repeating: boolean;
  cfg: GradientConfig;
  configRaw: string | null;
  configDirty: boolean;
  stops: ParsedStop[];
  format: ParsedGradient['format'];
}

interface Target {
  el: Element;
  pseudo: Pseudo;
  id: string;
  /** Computed background-image at pick time (before any preview override). */
  computed: string;
  layer: number;
  layerCount: number;
}

export interface CssEditorContext {
  picker: ColorPicker;
  api: string;
  host: Element;
  stage: HTMLElement;
  shadow: ShadowRoot;
  toast(msg: string, error?: boolean): void;
  copy(text: string, what: string): void;
  button(cls: string, icon: string, title: string, onclick: () => void): HTMLButtonElement;
  render(): void;
  pick(): void;
  back(): void;
  /** Turn the picked element into a mesh gradient, seeded from this CSS gradient or from `from`. */
  convert(from?: Gradient): void;
  /** Your saved gradients, offered as starting points for a conversion. */
  library(): Array<{ id: string; gradient: Gradient }>;
  /** CSS approximation of a mesh gradient, for swatches. */
  swatch(g: Gradient): string;
  /** The dev server skips page reloads for HTML that Gradier edits, so HTML can save as you go. */
  quietHtml(): boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------- colour helpers (browser) ----------
const colorCtx = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.getContext('2d', { willReadFrequently: true });
})();
const colorCache = new Map<string, [number, number, number, number] | null>();

/** Resolve any CSS colour the browser understands to RGBA, or null. */
function toRgba(color: string): [number, number, number, number] | null {
  if (!color || !colorCtx) return null;
  if (colorCache.has(color)) return colorCache.get(color)!;
  let out: [number, number, number, number] | null = null;
  if (CSS.supports('color', color) && !/var\(|env\(|currentcolor/i.test(color)) {
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = color;
    colorCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
    out = [r!, g!, b!, Math.round((a! / 255) * 100) / 100];
  }
  colorCache.set(color, out);
  return out;
}

/** What a stop's colour box shows: its hex when the browser can resolve it (opacity has its own box), else as written. */
const stopText = (color: string, rgba: number[]) => (toRgba(color) ? hex(rgba) : color);
const hex = ([r, g, b]: number[]) => `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
const formatColor = (rgba: number[]) => (rgba[3]! < 1 ? `rgb(${rgba[0]} ${rgba[1]} ${rgba[2]} / ${rgba[3]})` : hex(rgba));

/** Display positions (0–100) for each stop, following CSS's rules for missing positions. */
function stopPercents(stops: ParsedStop[]): number[] {
  const raw = stops.map((s) => {
    const p = s.positions[0];
    return p && /^-?[\d.]+%$/.test(p) ? Number.parseFloat(p) : p === '0' ? 0 : null;
  });
  if (raw[0] === null) raw[0] = 0;
  if (raw.length > 1 && raw[raw.length - 1] === null) raw[raw.length - 1] = 100;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== null) continue;
    let j = i;
    while (raw[j] === null) j++;
    const a = raw[i - 1]!;
    const b = raw[j]!;
    for (let k = i; k < j; k++) raw[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return raw as number[];
}

function toModel(text: string): Model | null {
  const g = parseGradient(text);
  if (!g) return null;
  return {
    fn: g.fn,
    repeating: g.repeating,
    cfg: parseConfig(g.fn, g.config),
    configRaw: g.config,
    configDirty: false,
    stops: g.stops,
    format: g.format,
  };
}

function serialize(m: Model): string {
  return serializeGradient({
    fn: m.fn,
    repeating: m.repeating,
    config: m.configDirty ? buildConfig(m.fn, m.cfg) : m.configRaw,
    stops: m.stops,
    format: m.format,
  });
}

/** Gradient strings from CSS rules / inline styles that apply to the element, plus where they came from. */
function collectSources(t: Target) {
  const candidates: string[] = [];
  const files = new Set<string>();
  const selectors: string[] = [];
  const el = t.el;
  const pick = (value: string) => {
    const found = findGradients(value).map((g) => g.text);
    if (found.length === t.layerCount) return [found[t.layer]!];
    return found;
  };

  const ruleHits: string[][] = [];
  const visit = (rules: CSSRuleList, file: string | null) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const matches = rule.selectorText.split(',').some((sel) => {
          let s = sel.trim();
          const m = /::?(before|after)$/i.exec(s);
          if (m) {
            if (`::${m[1]!.toLowerCase()}` !== t.pseudo) return false;
            s = s.slice(0, m.index) || '*';
          } else if (t.pseudo) return false;
          try {
            return el.matches(s);
          } catch {
            return false;
          }
        });
        if (matches) {
          const values = [rule.style.getPropertyValue('background-image'), rule.style.getPropertyValue('background')];
          const found = values.flatMap(pick);
          if (found.length) {
            ruleHits.push(found);
            if (file) files.add(file);
            selectors.push(rule.selectorText);
          }
        }
        if (rule.cssRules?.length) visit(rule.cssRules, file);
      } else if ('cssRules' in rule) {
        if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText ?? rule.media.mediaText).matches) continue;
        visit((rule as CSSGroupingRule).cssRules, file);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const owner = sheet.ownerNode as Element | null;
    const file = owner?.getAttribute?.('data-vite-dev-id') ?? (sheet.href ? new URL(sheet.href).pathname : null);
    if (owner?.id === 'gradier-preview') continue;
    visit(rules, file);
  }
  if (!t.pseudo && el instanceof HTMLElement) {
    candidates.push(...pick(el.style.getPropertyValue('background-image')), ...pick(el.style.getPropertyValue('background')));
  }
  // Later rules usually win the cascade, so try them first.
  candidates.push(...ruleHits.reverse().flat());
  candidates.push(findGradients(t.computed)[t.layer]?.text ?? '');
  return { candidates: [...new Set(candidates.filter(Boolean))], files: [...files], selectors };
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) parts.unshift(describe(e));
  return parts.join(' > ');
}

export function createCssEditor(ctx: CssEditorContext) {
  let target: Target | null = null;
  let model: Model | null = null;
  let baseline = '';
  let computedStops: string[] = [];
  let matches: SourceMatch[] = [];
  let source: SourceMatch | null = null;
  let applyAll = false;
  let searching = false;
  let saving = false;
  let saveError = false;
  let saveTimer = 0;
  let selected: number | null = null;
  let idSeq = 0;
  const history = { undo: [] as string[], redo: [] as string[], key: undefined as string | undefined, at: 0 };

  let refs: Record<string, HTMLElement | undefined> = {};
  let stopRefs: Array<{ row: HTMLElement; field: ColorField; pos: HTMLInputElement }> = [];
  let markers: HTMLElement[] = [];
  /** Box shown by the expanded view; when set, on-page handles are drawn on it instead of the element. */
  let expandEl: HTMLElement | null = null;

  // ---------- preview ----------
  const previewSheet = () => {
    let s = document.getElementById('gradier-preview') as HTMLStyleElement | null;
    if (!s) {
      s = document.createElement('style');
      s.id = 'gradier-preview';
      document.head.append(s);
    }
    return s;
  };
  const previews = new Map<string, string>();
  const writePreviews = () => {
    previewSheet().textContent = [...previews.values()].join('\n');
  };
  const applyPreview = () => {
    if (!target || !model) return;
    const layers = findGradients(target.computed);
    const layer = layers[target.layer];
    if (!layer) return;
    const value = target.computed.slice(0, layer.start) + serialize(model) + target.computed.slice(layer.end);
    previews.set(target.id, `[data-gradier-target="${target.id}"]${target.pseudo}{background-image:${value} !important}`);
    writePreviews();
  };
  const dropPreview = (t: Target) => {
    previews.delete(t.id);
    writePreviews();
    if (![...previews.keys()].includes(t.el.getAttribute('data-gradier-target') ?? '')) t.el.removeAttribute('data-gradier-target');
  };

  // ---------- state ----------
  const isDirty = () => !!model && serialize(model) !== baseline;

  const update = (mutate: (m: Model) => void, key?: string) => {
    if (!model) return;
    const before = JSON.stringify(model);
    const draft = structuredClone(model);
    mutate(draft);
    if (JSON.stringify(draft) === before) return;
    const now = performance.now();
    if (!key || key !== history.key || now - history.at > 1000) {
      history.undo.push(before);
      if (history.undo.length > 200) history.undo.shift();
    }
    history.redo = [];
    history.key = key;
    history.at = now;
    const structural = draft.stops.length !== model.stops.length || draft.fn !== model.fn;
    model = draft;
    applyPreview();
    scheduleSave();
    structural ? ctx.render() : patch();
  };

  const undo = (redo = false) => {
    if (!model) return;
    const snap = (redo ? history.redo : history.undo).pop();
    if (!snap) return;
    (redo ? history.undo : history.redo).push(JSON.stringify(model));
    history.key = undefined;
    model = JSON.parse(snap) as Model;
    if (selected !== null && selected >= model.stops.length) selected = null;
    applyPreview();
    scheduleSave();
    ctx.render();
  };

  const rebase = (text: string) => {
    const m = toModel(text);
    if (!m) return false;
    model = m;
    baseline = serialize(m);
    history.undo = [];
    history.redo = [];
    return true;
  };

  const resolvedColor = (i: number): [number, number, number, number] => {
    const s = model!.stops[i]!;
    return toRgba(s.color) ?? (computedStops.length === model!.stops.length ? toRgba(computedStops[i]!) : null) ?? [136, 136, 136, 1];
  };

  // ---------- server ----------
  const find = async (candidates: string[], files: string[], selectors: string[]) => {
    const res = await fetch(`${ctx.api}css/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates, hints: { files, selectors } }),
    });
    const data = (await res.json()) as { matches?: SourceMatch[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.matches ?? [];
  };

  const search = async () => {
    if (!target) return;
    const t = target;
    const { candidates, files, selectors } = collectSources(t);
    searching = true;
    ctx.render();
    try {
      const found = await find(candidates, files, selectors);
      if (target !== t) return;
      matches = found;
      source = found[0] ?? null;
      if (source && !isDirty()) rebase(source.text);
      else if (source) scheduleSave();
    } catch (err) {
      if (target !== t) return;
      matches = [];
      source = null;
      ctx.toast(`Source search failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      if (target === t) {
        searching = false;
        applyPreview();
        ctx.render();
      }
    }
  };

  // Changes are written to source automatically: shortly after you stop editing, or right away when you leave the
  // gradient. Files that make the dev server reload the whole page (HTML and server templates) only save on leave,
  // so the page doesn't reload under you mid-edit.
  const RELOADS_PAGE = /\.(html?|php|erb|liquid|njk|hbs|twig|ejs|pug|haml|slim|cshtml|razor|mdx?)$/i;
  const SAVE_DELAY = 700;
  const QUIET = /\.html?$/i;
  const savesOnLeave = () => !!source && RELOADS_PAGE.test(source.file) && !(ctx.quietHtml() && QUIET.test(source.file));

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    if (!source || savesOnLeave()) return;
    saveTimer = window.setTimeout(() => save(), SAVE_DELAY);
  };

  /** Latest known source locations per edited gradient, so queued saves always target the current text. */
  const latest = new Map<string, { src: SourceMatch; group: SourceMatch[] }>();
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  const keyOf = (t: Target) => `${t.id}|${t.layer}`;

  /** Queue a write of the current gradient to source. Safe to call often; writes run one at a time. */
  const save = () => {
    clearTimeout(saveTimer);
    if (!model || !target || !source || !isDirty()) return;
    const t = target;
    const key = keyOf(t);
    const replacement = serialize(model);
    const snap = {
      src: source,
      group: applyAll ? matches.filter((m) => m.quality === 'exact' || m === source) : [source],
    };
    // Optimistic: the gradient counts as saved now; the status shows progress until the write lands.
    baseline = replacement;
    pending++;
    saving = true;
    patch();
    queue = queue.then(async () => {
      const { src, group } = latest.get(key) ?? snap;
      if (src.text === replacement) return;
      try {
        const res = await fetch(`${ctx.api}css/replace`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edits: group.map((m) => ({ file: m.file, start: m.start, end: m.end, text: m.text, replacement })) }),
        });
        const data = (await res.json()) as { results?: Array<Omit<SourceMatch, 'quality' | 'selector' | 'hinted'>>; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        // Pair each result with the match it came from (same file, nearest offset).
        const left = [...group];
        const updated = (data.results ?? []).map((r) => {
          const same = left.filter((m) => m.file === r.file);
          const from = same.reduce<SourceMatch | undefined>((a, b) => (!a || Math.abs(b.start - r.start) < Math.abs(a.start - r.start) ? b : a), undefined) ?? src;
          left.splice(left.indexOf(from), 1);
          return { orig: from, next: { ...from, ...r, quality: 'exact' as const } };
        });
        const primary = updated.find((u) => u.orig === src)?.next ?? updated[0]?.next ?? src;
        const nextGroup = updated.map((u) => u.next);
        latest.set(key, { src: primary, group: nextGroup.length ? nextGroup : [primary] });
        saveError = false;
        if (target === t) {
          const replaced = new Set(updated.map((u) => u.orig));
          matches = matches.map((m) => (replaced.has(m) ? updated.find((u) => u.orig === m)!.next : m));
          if (source === src || replaced.has(source!)) source = primary;
        }
        // HTML edits don't reload the page any more, so update an inline style in place to match the file.
        if (ctx.quietHtml() && QUIET.test(src.file)) {
          const style = t.el.getAttribute('style');
          if (style?.includes(src.text)) t.el.setAttribute('style', style.replace(src.text, replacement));
        }
        settlePreview(t, replacement);
      } catch (err) {
        saveError = true;
        if (target === t) baseline = '';
        ctx.toast(`Couldn't save: ${err instanceof Error ? err.message : err}`, true);
      }
    }).finally(() => {
      if (--pending === 0) saving = false;
      if (target === t) ctx.render();
    });
  };

  /** After a save, drop the preview override once the dev server's hot reload shows the same gradient. */
  const settling = new Set<string>();
  const settlePreview = (t: Target, expected: string) => {
    let tries = 0;
    settling.add(t.id);
    const check = () => {
      // Still being edited, or a newer save is on its way: that one will settle it.
      if (target === t && (isDirty() || serialize(model!) !== expected)) return void settling.delete(t.id);
      const css = previews.get(t.id);
      previews.delete(t.id);
      writePreviews();
      const now = findGradients(getComputedStyle(t.el, t.pseudo || null).backgroundImage)[t.layer]?.text ?? '';
      if (compareGradients(now, expected) === 'exact') {
        if (target === t) t.computed = getComputedStyle(t.el, t.pseudo || null).backgroundImage;
        return void settling.delete(t.id);
      }
      if (css) previews.set(t.id, css);
      writePreviews();
      if (++tries < 10) setTimeout(check, 500);
      else settling.delete(t.id);
    };
    setTimeout(check, 400);
  };

  const agentPrompt = () => {
    if (!target || !model) return '';
    const lines = [
      'Gradier edit request: update this gradient in the source code.',
      '',
      `Page: ${location.href}`,
      `Element: ${cssPath(target.el)}${target.pseudo}`,
      target.el.getAttribute('class') ? `Element classes: ${target.el.getAttribute('class')}` : null,
      `Background layer: ${target.layer + 1} of ${target.layerCount}`,
      source ? `Source: ${source.file}:${source.line}:${source.column}${source.selector ? ` (selector "${source.selector}")` : ''}` : 'Source: not found automatically',
      `Current gradient${source ? ' (as written in source)' : ' (browser-computed)'}: ${source?.text ?? baseline}`,
      `New gradient: ${serialize(model)}`,
      '',
      'Replace the current gradient with the new one where it is defined (CSS, inline style, CSS-in-JS, or Tailwind classes).',
      'If it comes from Tailwind utilities, use an arbitrary value such as bg-[linear-gradient(...)] with spaces replaced by underscores, or the closest equivalent utilities.',
      'If the colours come from CSS variables or design tokens, update the tokens only if they are not used elsewhere; otherwise inline the new values.',
    ];
    return lines.filter((l) => l !== null).join('\n');
  };

  // ---------- panel ----------
  const btn = (label: string, onclick: () => void, cls = '') => h('button', { className: `btn ${cls}`, type: 'button', onclick }, label);

  const build = () => {
    refs = {};
    stopRefs = [];
    markers = [];
    const body = h('div', { className: 'body' });
    if (!target || !model) {
      body.append(h('div', { className: 'hint' }, 'Pick a gradient on the page to edit it.'), btn('Pick a gradient', ctx.pick, 'primary'));
      return { body, foot: h('div', { className: 'foot' }) };
    }
    const t = target;
    const m = model;

    // Element
    const layerSelect =
      t.layerCount > 1
        ? h(
            'select',
            {
              onchange: (e: Event) => {
                open({ el: t.el, pseudo: t.pseudo, computed: t.computed, layer: Number((e.target as HTMLSelectElement).value) });
              },
            },
            ...Array.from({ length: t.layerCount }, (_, i) => h('option', { value: i, selected: i === t.layer }, `Layer ${i + 1} of ${t.layerCount}`)),
          )
        : null;
    body.append(
      h(
        'div',
        { className: 'section flat' },
        h('div', { className: 'label' }, 'Element'),
        h('div', { className: 'row' }, h('div', { className: 'grow mono ellipsis', title: cssPath(t.el) + t.pseudo }, describe(t.el, t.pseudo)), ctx.button('icon', ICONS.pick, 'Pick another gradient (Alt+P)', ctx.pick)),
        layerSelect,
      ),
    );

    // Source
    const sourceSection = h('div', { className: 'section flat' }, h('div', { className: 'label' }, 'Source'));
    if (searching) sourceSection.append(h('div', { className: 'hint' }, 'Searching your project…'));
    else if (!source) {
      const tw = /\b(bg-gradient-to-|bg-linear-|bg-radial|bg-conic|from-|via-|to-)/.test(t.el.getAttribute('class') ?? '');
      sourceSection.append(
        h(
          'div',
          { className: 'hint warn' },
          tw
            ? 'This looks like Tailwind gradient classes, which Gradier can’t rewrite automatically. Edit away, then use “Copy for AI agent” or “Copy CSS”.'
            : 'Couldn’t find this gradient in your source files (it may be built from variables or JS). Edit away, then use “Copy for AI agent” or “Copy CSS”.',
        ),
      );
    } else {
      if (matches.length > 1) {
        sourceSection.append(
          h(
            'select',
            {
              onchange: (e: Event) => {
                source = matches[Number((e.target as HTMLSelectElement).value)] ?? source;
                if (!isDirty() && source) rebase(source.text), applyPreview();
                ctx.render();
              },
            },
            ...matches.map((mm, i) =>
              h(
                'option',
                { value: i, selected: mm === source },
                `${mm.file}:${mm.line}${mm.selector ? `  ${mm.selector.slice(0, 40)}` : ''}${mm.quality === 'colors' ? '  (similar)' : ''}`,
              ),
            ),
          ),
        );
        const exact = matches.filter((mm) => mm.quality === 'exact').length;
        if (exact > 1) {
          sourceSection.append(
            h(
              'label',
              { className: 'check' },
              h('input', { type: 'checkbox', checked: applyAll, onchange: (e: Event) => ((applyAll = (e.target as HTMLInputElement).checked), patch()) }),
              `Update all ${exact} identical gradients`,
            ),
          );
        }
      } else {
        sourceSection.append(h('div', { className: 'mono ellipsis', title: source.file }, `${source.file}:${source.line}`));
      }
      if (source.quality === 'colors') sourceSection.append(h('div', { className: 'hint warn' }, 'Closest match by colours only. Check it’s the right one before saving.'));
      if (/var\(|\$|theme\(/.test(source.text)) sourceSection.append(h('div', { className: 'hint' }, 'Colours you change will be written as literal values.'));
    }
    body.append(sourceSection);

    // Type
    const seg = h('div', { className: 'seg' });
    for (const fn of ['linear', 'radial', 'conic'] as GradientFn[]) {
      seg.append(
        h(
          'button',
          {
            type: 'button',
            className: m.fn === fn ? 'on' : '',
            onclick: () =>
              update((d) => {
                if (d.fn === fn) return;
                if (fn === 'linear') d.cfg.angle = d.fn === 'conic' ? d.cfg.angle : 180;
                if (fn === 'conic' && d.fn === 'linear') d.cfg.angle = 0;
                d.fn = fn;
                d.cfg.corner = null;
                d.configDirty = true;
              }),
          },
          fn[0]!.toUpperCase() + fn.slice(1),
        ),
      );
    }
    const typeSection = h(
      'div',
      { className: 'section flat' },
      h('div', { className: 'label' }, 'Type'),
      seg,
      h(
        'label',
        { className: 'check' },
        h('input', { type: 'checkbox', checked: m.repeating, onchange: (e: Event) => update((d) => void (d.repeating = (e.target as HTMLInputElement).checked)) }),
        'Repeating',
      ),
    );

    const slider = (name: string, label: string, min: number, max: number, step: number, set: (d: Model, v: number) => void) => {
      const out = h('output', {});
      const input = h('input', { type: 'range', min, max, step, oninput: (e: Event) => update((d) => set(d, Number((e.target as HTMLInputElement).value)), name) });
      refs[`${name}-input`] = input;
      refs[`${name}-out`] = out;
      return h('label', { className: 'slider' }, h('span', {}, label), input, out);
    };
    if (m.fn !== 'radial') {
      typeSection.append(
        slider('angle', m.fn === 'conic' ? 'From' : 'Angle', 0, 360, 1, (d, v) => {
          d.cfg.angle = v;
          d.cfg.corner = null;
          d.configDirty = true;
        }),
      );
    }
    if (m.fn !== 'linear') {
      if (m.cfg.positionRaw) typeSection.append(h('div', { className: 'hint' }, `Position: ${m.cfg.positionRaw}`));
      else {
        typeSection.append(
          slider('x', 'Center X', 0, 100, 1, (d, v) => void ((d.cfg.x = v), (d.configDirty = true))),
          slider('y', 'Center Y', 0, 100, 1, (d, v) => void ((d.cfg.y = v), (d.configDirty = true))),
        );
      }
    }
    if (m.fn === 'radial') {
      const sizes = ['farthest-corner', 'farthest-side', 'closest-corner', 'closest-side'];
      typeSection.append(
        h(
          'div',
          { className: 'row' },
          h(
            'select',
            { className: 'grow', onchange: (e: Event) => update((d) => void ((d.cfg.shape = (e.target as HTMLSelectElement).value as 'circle' | 'ellipse'), (d.configDirty = true))) },
            h('option', { value: 'ellipse', selected: m.cfg.shape === 'ellipse' }, 'Ellipse'),
            h('option', { value: 'circle', selected: m.cfg.shape === 'circle' }, 'Circle'),
          ),
          h(
            'select',
            { className: 'grow', onchange: (e: Event) => update((d) => void ((d.cfg.size = (e.target as HTMLSelectElement).value), (d.configDirty = true))) },
            ...[...new Set([m.cfg.size, ...sizes])].map((s) => h('option', { value: s, selected: s === m.cfg.size }, s)),
          ),
        ),
      );
    }
    body.append(typeSection);

    // Stops
    const bar = h('div', { className: 'bar', title: 'Click to add a colour stop' });
    refs.bar = bar;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar) return;
      const r = bar.getBoundingClientRect();
      addStop(round1(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100)));
    });
    m.stops.forEach((s, i) => {
      if (!s.color) return;
      const mk = h('div', { className: 'marker' });
      mk.addEventListener('pointerdown', (e) => dragStop(e, i));
      markers[i] = mk;
      bar.append(mk);
    });

    const list = h('div', { className: 'points' });
    m.stops.forEach((s, i) => {
      if (!s.color) {
        list.append(h('div', { className: 'hint' }, `Colour hint at ${s.positions.join(' ')}`));
        return;
      }
      const rgba = resolvedColor(i);
      const field = colorField({
        picker: ctx.picker,
        key: `css:${target!.id}:${target!.layer}:${i}`,
        free: true,
        text: stopText(s.color, rgba),
        hex: hex(rgba),
        alpha: rgba[3],
        onColor: (hx) =>
          update((d) => {
            const [r, g, b] = toRgba(hx)!;
            d.stops[i]!.color = formatColor([r, g, b, resolvedColor(i)[3]]);
          }, `color-${i}`),
        onAlpha: (a) =>
          update((d) => {
            const [r, g, b] = resolvedColor(i);
            d.stops[i]!.color = formatColor([r, g, b, a]);
          }, `alpha-${i}`),
        onText: (v) => update((d) => void (d.stops[i]!.color = v)),
      });
      const pos = h('input', {
        className: 'text pos mono',
        spellcheck: false,
        placeholder: 'auto',
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          const parts = v ? v.split(/\s+/) : [];
          if (parts.length <= 2 && parts.every((p) => CSS.supports('width', p) || /^-?[\d.]+%$/.test(p))) update((d) => void (d.stops[i]!.positions = parts));
          else ctx.toast('Use a length or percentage, e.g. 40%', true), patch();
        },
      });
      const row = h(
        'div',
        { className: 'point', onpointerdown: () => ((selected = i), patch()) },
        field.el,
        pos,
        ctx.button('icon ghost small', ICONS.trash, 'Remove stop', () => removeStop(i)),
      );
      stopRefs[i] = { row, field, pos };
      list.append(row);
    });
    body.append(
      h(
        'div',
        { className: 'section flat' },
        h('div', { className: 'label' }, `Stops  ${m.stops.filter((s) => s.color).length}`, h('button', { className: 'btn small', type: 'button', onclick: () => addStop() }, '+ Add')),
        bar,
        list,
      ),
    );

    // Make it a mesh gradient
    const lib = ctx.library();
    const saved = h('div', { className: 'presets' });
    for (const item of lib) {
      const b = h('button', { className: 'preset', type: 'button', title: 'Make it a mesh gradient from this saved gradient', onclick: () => ctx.convert(item.gradient) });
      b.style.background = ctx.swatch(item.gradient);
      saved.append(b);
    }
    body.append(
      h(
        'div',
        { className: 'section flat' },
        h('div', { className: 'label' }, 'Mesh gradient'),
        h('div', { className: 'hint' }, 'Turn this element into a mesh gradient to add points, curves, grain and filters.'),
        btn('Make it a mesh gradient', () => ctx.convert(), 'action'),
        lib.length ? h('div', { className: 'hint' }, 'Or start from one of your saved gradients:') : null,
        lib.length ? saved : null,
      ),
    );

    // Output
    refs.code = h('div', { className: 'code' });
    body.append(
      h(
        'div',
        { className: 'section flat' },
        h('div', { className: 'label' }, 'CSS'),
        refs.code,
        h(
          'div',
          { className: 'row' },
          btn('Copy CSS', () => ctx.copy(serialize(model!), 'CSS'), 'grow'),
          btn('Copy for AI agent', () => ctx.copy(agentPrompt(), 'Agent prompt'), 'grow'),
        ),
      ),
    );

    refs.undo = ctx.button('icon ghost', ICONS.undo, 'Undo', () => undo());
    refs.redo = ctx.button('icon ghost', ICONS.redo, 'Redo', () => undo(true));
    refs.status = h('span', { className: 'status' });
    const foot = h('div', { className: 'foot' }, refs.undo, refs.redo, refs.status);
    return { body, foot };
  };

  const setRange = (name: string, value: number, label: string) => {
    const input = refs[`${name}-input`] as HTMLInputElement | undefined;
    const out = refs[`${name}-out`] as HTMLOutputElement | undefined;
    if (input && ctx.shadow.activeElement !== input) input.value = String(value);
    if (out) out.value = label;
  };

  const patch = () => {
    if (!model) return;
    const m = model;
    const pct = stopPercents(m.stops.filter((s) => s.color));
    let ci = 0;
    const barStops: string[] = [];
    m.stops.forEach((s, i) => {
      if (!s.color) return;
      const rgba = resolvedColor(i);
      const p = pct[ci++]!;
      barStops.push(`rgba(${rgba.join(',')}) ${p}%`);
      const mk = markers[i];
      if (mk) {
        mk.style.left = `${p}%`;
        mk.style.background = `rgba(${rgba.join(',')})`;
        mk.classList.toggle('active', selected === i);
      }
      const r = stopRefs[i];
      if (r) {
        r.row.classList.toggle('active', selected === i);
        r.field.set(stopText(s.color, rgba), hex(rgba), rgba[3]);
        if (ctx.shadow.activeElement !== r.pos) r.pos.value = s.positions.join(' ');
      }
    });
    if (refs.bar) refs.bar.style.background = `linear-gradient(90deg, ${barStops.join(', ')}), repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 10px 10px`;
    setRange('angle', m.cfg.angle, `${Math.round(m.cfg.angle)}°`);
    setRange('x', m.cfg.x ?? 50, `${Math.round(m.cfg.x ?? 50)}`);
    setRange('y', m.cfg.y ?? 50, `${Math.round(m.cfg.y ?? 50)}`);
    if (refs.code) refs.code.textContent = serialize(m);
    const dirty = isDirty();
    if (refs.status) {
      const where = source ? `${source.file}:${source.line}` : '';
      const warn = saveError || (!source && !searching && dirty);
      refs.status.className = `status${warn ? ' dirty' : ''}`;
      refs.status.textContent = saving
        ? 'Saving…'
        : saveError
          ? 'Not saved · edit again to retry'
          : searching
            ? 'Searching…'
            : !source
              ? dirty
                ? 'Page only · not found in source'
                : 'Not found in source'
              : dirty
                ? savesOnLeave()
                  ? `Saves to ${where} when you're done`
                  : 'Saving…'
                : `Saved · ${where}`;
      refs.status.title = where;
    }
    if (expandEl) expandEl.style.background = serialize(m);
    if (refs.undo) (refs.undo as HTMLButtonElement).disabled = !history.undo.length;
    if (refs.redo) (refs.redo as HTMLButtonElement).disabled = !history.redo.length;
  };

  // ---------- stop editing ----------
  const addStop = (at?: number) => {
    if (!model) return;
    const colored = model.stops.map((s, i) => ({ s, i })).filter(({ s }) => s.color);
    const pct = stopPercents(colored.map(({ s }) => s));
    const p = at ?? round1(((pct[pct.length - 2] ?? 0) + (pct[pct.length - 1] ?? 100)) / 2);
    let after = -1;
    pct.forEach((v, k) => v <= p && (after = k));
    const a = colored[Math.max(0, after)]!;
    const b = colored[Math.min(colored.length - 1, after + 1)]!;
    const pa = pct[Math.max(0, after)]!;
    const pb = pct[Math.min(colored.length - 1, after + 1)]!;
    const tt = pb === pa ? 0 : (p - pa) / (pb - pa);
    const ca = resolvedColor(a.i);
    const cb = resolvedColor(b.i);
    const mix = ca.map((v, k) => (k === 3 ? Math.round((v + (cb[k]! - v) * tt) * 100) / 100 : Math.round(v + (cb[k]! - v) * tt)));
    const insertAt = after === -1 ? 0 : a.i + 1;
    update((d) => {
      d.stops.splice(insertAt, 0, { color: formatColor(mix), positions: [`${p}%`] });
    });
    selected = insertAt;
    ctx.render();
  };

  const removeStop = (i: number) => {
    if (!model) return;
    if (model.stops.filter((s) => s.color).length <= 2) return ctx.toast('A gradient needs at least 2 stops', true);
    update((d) => void d.stops.splice(i, 1));
    selected = null;
    ctx.render();
  };

  const dragStop = (e: PointerEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    selected = i;
    patch();
    const bar = refs.bar!;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      const p = round1(clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100));
      update((d) => void (d.stops[i]!.positions = [`${p}%`]), `stop-${i}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Keep stops in visual order.
      if (model && model.stops.every((s) => s.color)) {
        const pct = stopPercents(model.stops);
        const order = model.stops.map((_, k) => k).sort((a, b) => pct[a]! - pct[b]!);
        if (order.some((k, idx) => k !== idx)) {
          const sel = selected;
          model.stops = order.map((k) => model!.stops[k]!);
          selected = sel === null ? null : order.indexOf(sel);
          ctx.render();
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- on-page handles ----------
  const stageEls = {
    frame: h('div', { className: 'frame' }),
    chip: h('div', { className: 'chip static' }),
    line: h('div', { className: 'rotor-line' }),
    rotor: h('div', { className: 'rotor', title: 'Drag to rotate (Shift snaps to 15°)' }),
    center: h('div', { className: 'center-handle', title: 'Drag to move the centre' }),
  };
  stageEls.rotor.addEventListener('pointerdown', (e) => dragHandle(e, 'rotor'));
  stageEls.center.addEventListener('pointerdown', (e) => dragHandle(e, 'center'));

  const geometry = () => {
    const r = (expandEl ?? target!.el).getBoundingClientRect();
    const m = model!;
    const cx = m.fn === 'linear' ? r.left + r.width / 2 : r.left + ((m.cfg.x ?? 50) / 100) * r.width;
    const cy = m.fn === 'linear' ? r.top + r.height / 2 : r.top + ((m.cfg.y ?? 50) / 100) * r.height;
    const radius = clamp(Math.min(r.width, r.height) / 2 - 12, 24, expandEl ? 120 : 70);
    let angle = m.cfg.angle;
    if (m.fn === 'linear' && m.cfg.corner) {
      const c = m.cfg.corner;
      const dx = c.includes('left') ? -r.width : r.width;
      const dy = c.includes('top') ? -r.height : r.height;
      angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    }
    return { r, cx, cy, radius, angle };
  };

  const dragHandle = (e: PointerEvent, kind: 'rotor' | 'center') => {
    if (!target || !model) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const { r, cx, cy } = geometry();
      if (kind === 'rotor') {
        let deg = ((Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180) / Math.PI + 360) % 360;
        deg = ev.shiftKey ? (Math.round(deg / 15) * 15) % 360 : Math.round(deg);
        update((d) => void ((d.cfg.angle = deg), (d.cfg.corner = null), (d.configDirty = true)), 'rotor');
      } else {
        let x = clamp(((ev.clientX - r.left) / r.width) * 100, -50, 150);
        let y = clamp(((ev.clientY - r.top) / r.height) * 100, -50, 150);
        if (ev.shiftKey) (x = Math.round(x / 5) * 5), (y = Math.round(y / 5) * 5);
        update((d) => void ((d.cfg.x = Math.round(x)), (d.cfg.y = Math.round(y)), (d.configDirty = true)), 'center');
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const positionStage = () => {
    if (!target || !model || !target.el.isConnected) return clearStage();
    const { stage } = ctx;
    const { r, cx, cy, radius, angle } = geometry();
    const m = model;
    for (const el of Object.values(stageEls)) if (!el.isConnected) stage.append(el);
    Object.assign(stageEls.frame.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    stageEls.chip.textContent = describe(target.el, target.pseudo);
    stageEls.chip.style.display = stageEls.frame.style.display = expandEl ? 'none' : '';
    Object.assign(stageEls.chip.style, { left: `${r.left}px`, top: `${Math.max(r.top, 24)}px` });
    const showCenter = m.fn !== 'linear' && !m.cfg.positionRaw;
    const showRotor = m.fn !== 'radial';
    stageEls.center.style.display = showCenter ? '' : 'none';
    stageEls.rotor.style.display = stageEls.line.style.display = showRotor ? '' : 'none';
    if (showCenter) Object.assign(stageEls.center.style, { left: `${cx}px`, top: `${cy}px` });
    if (showRotor) {
      const rad = (angle * Math.PI) / 180;
      Object.assign(stageEls.rotor.style, { left: `${cx + Math.sin(rad) * radius}px`, top: `${cy - Math.cos(rad) * radius}px` });
      Object.assign(stageEls.line.style, { left: `${cx}px`, top: `${cy}px`, width: `${radius}px`, transform: `rotate(${angle - 90}deg)` });
    }
  };

  const clearStage = () => {
    for (const el of Object.values(stageEls)) el.remove();
  };

  // ---------- conversion to a mesh gradient ----------
  /** The opaque colour behind the element, so semi-transparent stops can be flattened for the mesh. */
  const backdrop = (el: Element): [number, number, number] => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = toRgba(getComputedStyle(e).backgroundColor);
      if (c && c[3] >= 0.99) return [c[0], c[1], c[2]];
    }
    return [255, 255, 255];
  };

  type Rgba = [number, number, number, number];

  /** CSS radial-gradient ray lengths (rx, ry) for a box, following the size keyword or explicit lengths. */
  const radii = (m: Model, w: number, ht: number, cx: number, cy: number): [number, number] => {
    const size = m.cfg.size.toLowerCase();
    const sx = [cx, w - cx];
    const sy = [cy, ht - cy];
    const len = (v: string, of: number) => (v.endsWith('%') ? (Number.parseFloat(v) / 100) * of : Number.parseFloat(v));
    if (!/side|corner/.test(size)) {
      const parts = size.split(/\s+/);
      const rx = len(parts[0] ?? '0', w) || 1;
      return [rx, parts[1] ? len(parts[1], ht) || 1 : rx];
    }
    const far = size.startsWith('farthest');
    const pick = (a: number[]) => (far ? Math.max(...a) : Math.min(...a));
    const corners = [0, w].flatMap((x) => [0, ht].map((y) => Math.hypot(x - cx, y - cy)));
    if (m.cfg.shape === 'circle') {
      const r = size.endsWith('side') ? pick([...sx, ...sy]) : pick(corners);
      return [r || 1, r || 1];
    }
    const rx = pick(sx) || 1;
    const ry = pick(sy) || 1;
    return size.endsWith('side') ? [rx, ry] : [rx * Math.SQRT2, ry * Math.SQRT2];
  };

  /** Colour of one gradient layer at (x, y) in a w×h box, interpolated in premultiplied sRGB like CSS. */
  const layerColorAt = (m: Model, colors: Rgba[], x: number, y: number, w: number, ht: number): Rgba => {
    const cx = ((m.cfg.x ?? 50) / 100) * w;
    const cy = ((m.cfg.y ?? 50) / 100) * ht;
    let t: number;
    if (m.fn === 'linear') {
      let angle = m.cfg.angle;
      if (m.cfg.corner) {
        const c = m.cfg.corner;
        angle = ((Math.atan2(c.includes('left') ? -w : w, c.includes('top') ? ht : -ht) * 180) / Math.PI + 360) % 360;
      }
      const a = (angle * Math.PI) / 180;
      const [dx, dy] = [Math.sin(a), -Math.cos(a)];
      t = ((x - w / 2) * dx + (y - ht / 2) * dy) / (Math.abs(w * dx) + Math.abs(ht * dy) || 1) + 0.5;
    } else if (m.fn === 'radial') {
      const [rx, ry] = radii(m, w, ht, cx, cy);
      t = Math.hypot((x - cx) / rx, (y - cy) / ry);
    } else {
      const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI - m.cfg.angle;
      t = (((deg % 360) + 360) % 360) / 360;
    }
    const pct = stopPercents(m.stops.filter((st) => st.color)).map((v) => v / 100);
    if (m.repeating && pct.length > 1) {
      const span = pct.at(-1)! - pct[0]!;
      if (span > 0) t = pct[0]! + ((((t - pct[0]!) % span) + span) % span);
    }
    let k = pct.findIndex((v) => v >= t);
    if (k === -1) return colors.at(-1)!;
    if (k === 0) return colors[0]!;
    const span = pct[k]! - pct[k - 1]!;
    const f = span > 0 ? (t - pct[k - 1]!) / span : 1;
    const [a, b] = [colors[k - 1]!, colors[k]!];
    const alpha = a[3] + (b[3] - a[3]) * f;
    const ch = (j: number) => (alpha ? (a[j]! * a[3] + (b[j]! * b[3] - a[j]! * a[3]) * f) / alpha : 0);
    return [ch(0), ch(1), ch(2), alpha];
  };

  /**
   * Mesh points that reproduce what the element actually shows: every background layer composited over the colour
   * behind it, so the mesh keeps the same shades. Points follow the edited gradient's shape (along its line, on rings,
   * around its sweep); a stack of several layers is sampled on a grid instead.
   */
  const meshSeed = (): GradientPoint[] | null => {
    if (!model || !target) return null;
    const m = model;
    const t = target;
    const r = t.el.getBoundingClientRect();
    const w = r.width || 1;
    const ht = r.height || 1;
    const bg = backdrop(t.el);
    // All layers, top first; the edited one uses the live model.
    const layers = findGradients(t.computed).map((g, i) => {
      if (i === t.layer) return { m, colors: m.stops.map((_, k) => resolvedColor(k)).filter((_, k) => m.stops[k]!.color) as Rgba[] };
      const lm = toModel(g.text);
      return lm ? { m: lm, colors: lm.stops.filter((st) => st.color).map((st) => toRgba(st.color) ?? ([0, 0, 0, 0] as Rgba)) } : null;
    });
    const colorAt = (rx: number, ry: number) => {
      let out: [number, number, number] = [...bg];
      for (const l of [...layers].reverse()) {
        if (!l || !l.colors.length) continue;
        const c = layerColorAt(l.m, l.colors, rx * w, ry * ht, w, ht);
        out = out.map((v, j) => c[j]! * c[3] + v * (1 - c[3])) as [number, number, number];
      }
      return hex(out.map((v) => Math.round(clamp(v, 0, 255))));
    };

    const spots: Array<[number, number]> = [];
    const at = (px: number, py: number) => spots.push([clamp(px / w, 0, 1), clamp(py / ht, 0, 1)]);
    if (layers.length > 1) {
      for (const y of [0.15, 0.5, 0.85]) for (const x of [0.1, 0.37, 0.63, 0.9]) spots.push([x, y]);
    } else {
      const colored = m.stops.filter((st) => st.color);
      let ts = stopPercents(colored).map((v) => clamp(v / 100, 0, 1));
      if (m.fn === 'conic' && ts.length > 2 && ts.at(-1)! > 0.99) ts = ts.slice(0, -1);
      const perStop = m.fn === 'linear' ? 2 : m.fn === 'radial' ? 3 : 1;
      const most = Math.max(2, Math.floor(MAX_POINTS / perStop));
      if (ts.length > most) ts = Array.from({ length: most }, (_, k) => ts[Math.round((k * (ts.length - 1)) / (most - 1))]!);
      const cx = ((m.cfg.x ?? 50) / 100) * w;
      const cy = ((m.cfg.y ?? 50) / 100) * ht;
      if (m.fn === 'linear') {
        const { angle } = geometry();
        const a = (angle * Math.PI) / 180;
        const [dx, dy] = [Math.sin(a), -Math.cos(a)];
        const len = Math.abs(w * dx) + Math.abs(ht * dy);
        const across = (Math.abs(w * dy) + Math.abs(ht * dx)) * 0.28;
        for (const st of ts) {
          const bx = w / 2 + (st - 0.5) * len * dx;
          const by = ht / 2 + (st - 0.5) * len * dy;
          for (const o of [-1, 1]) at(bx - dy * across * o, by + dx * across * o);
        }
      } else if (m.fn === 'radial') {
        const [rx, ry] = radii(m, w, ht, cx, cy);
        ts.forEach((st, k) => {
          if (st < 0.08) return at(cx, cy);
          for (let j = 0; j < 3; j++) {
            const ang = (j / 3) * Math.PI * 2 + k * 0.9;
            at(cx + Math.cos(ang) * st * rx, cy + Math.sin(ang) * st * ry);
          }
        });
      } else {
        const radius = Math.min(w, ht) * 0.38;
        for (const st of ts) {
          const a = ((m.cfg.angle + st * 360) * Math.PI) / 180;
          at(cx + Math.sin(a) * radius, cy - Math.cos(a) * radius);
        }
      }
    }
    // Pin the corners to their real colour too, so a blob doesn't tint areas the CSS leaves plain.
    for (const c of [[0, 0], [1, 0], [0, 1], [1, 1]] as Array<[number, number]>) {
      if (spots.length >= MAX_POINTS) break;
      if (spots.every(([x, y]) => Math.hypot(x - c[0], y - c[1]) > 0.2)) spots.push(c);
    }
    const pts = spots.slice(0, MAX_POINTS).map(([x, y]) => ({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, color: colorAt(x, y) }));
    return pts.length >= 2 ? pts : null;
  };

  // ---------- lifecycle ----------
  const open = (pick: { el: Element; pseudo: Pseudo; computed: string; layer?: number }) => {
    leave();
    const layers = findGradients(pick.computed);
    const layer = clamp(pick.layer ?? 0, 0, layers.length - 1);
    const existing = pick.el.getAttribute('data-gradier-target');
    const id = existing ?? `g${++idSeq}`;
    pick.el.setAttribute('data-gradier-target', id);
    // If a stale preview is still applied to this element, read the computed value without it.
    let computed = pick.computed;
    if (previews.has(id)) {
      previews.delete(id);
      writePreviews();
      computed = getComputedStyle(pick.el, pick.pseudo || null).backgroundImage;
    }
    target = { el: pick.el, pseudo: pick.pseudo, id, computed, layer, layerCount: layers.length };
    if (!pending) latest.delete(keyOf(target));
    saveError = false;
    computedStops = parseGradient(findGradients(computed)[layer]?.text ?? '')?.stops.map((s) => s.color) ?? [];
    rebase(findGradients(computed)[layer]?.text ?? '');
    matches = [];
    source = null;
    applyAll = false;
    selected = null;
    ctx.render();
    void search();
  };

  /**
   * Finish with the current gradient: write any pending change to source now. If it isn't in source, the edit stays
   * applied to the page for this session (copy it from the panel to keep it).
   */
  const leave = () => {
    if (!target) return;
    if (isDirty() && source) save();
    else if (!isDirty() && !pending && !settling.has(target.id)) dropPreview(target);
  };

  /** Close the current edit (saving first). Always succeeds; kept boolean for callers. */
  const close = () => {
    if (!target) return true;
    leave();
    target = null;
    model = null;
    clearStage();
    return true;
  };

  return {
    open,
    close,
    build,
    patch,
    save,
    undo,
    positionStage,
    clearStage,
    get active() {
      return !!target;
    },
    get dirty() {
      return isDirty();
    },
    get selectedStop() {
      return selected;
    },
    removeSelectedStop: () => selected !== null && removeStop(selected),
    /** Write pending changes now (Ctrl/⌘+S, leaving the page). */
    flush: () => save(),
    meshSeed,
    /** Where the gradient is written, if found (used to locate an inline-styled element's tag). */
    get pseudo() {
      return target?.pseudo.replace('::', '') as '' | 'before' | 'after' | undefined;
    },
    get sourceMatch() {
      return source && source.quality === 'exact' ? { file: source.file, start: source.start } : null;
    },
    get targetEl() {
      return target?.el ?? null;
    },
    /** Draw the gradient in `el` (the expanded view) and put the handles there; null puts them back on the page. */
    setExpandEl: (el: HTMLElement | null) => {
      expandEl = el;
      if (el && model) el.style.background = serialize(model);
    },

    deselect: () => {
      if (selected === null) return false;
      selected = null;
      patch();
      return true;
    },
    structureKey: () =>
      [target?.id, target?.layer, model?.fn, model?.stops.length, model?.cfg.positionRaw, searching, source?.file, source?.start, matches.length, applyAll].join('|'),
  };
}

export type CssEditor = ReturnType<typeof createCssEditor>;
