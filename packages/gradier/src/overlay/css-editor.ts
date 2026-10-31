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
  let selected: number | null = null;
  let idSeq = 0;
  const history = { undo: [] as string[], redo: [] as string[], key: undefined as string | undefined, at: 0 };

  let refs: Record<string, HTMLElement | undefined> = {};
  let stopRefs: Array<{ row: HTMLElement; swatch: HTMLInputElement; text: HTMLInputElement; pos: HTMLInputElement }> = [];
  let markers: HTMLElement[] = [];

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

  const save = async () => {
    if (!model || !target || saving || !isDirty()) return;
    if (!source) {
      ctx.toast("Couldn't find this gradient in your source. Use “Copy for AI agent”.", true);
      return;
    }
    const replacement = serialize(model);
    const group = applyAll ? matches.filter((m) => m.quality === 'exact' || m === source) : [source];
    saving = true;
    patch();
    try {
      const res = await fetch(`${ctx.api}css/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits: group.map((m) => ({ file: m.file, start: m.start, end: m.end, text: m.text, replacement })) }),
      });
      const data = (await res.json()) as { results?: Array<Omit<SourceMatch, 'quality' | 'selector' | 'hinted'>>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const results = data.results ?? [];
      const mine = results.find((r) => r.file === source!.file) ?? results[0];
      if (mine) source = { ...source, ...mine, quality: 'exact' };
      matches = [source, ...matches.filter((m) => !group.includes(m))];
      baseline = replacement;
      ctx.toast(`Saved to ${source.file}:${source.line}${results.length > 1 ? ` (+${results.length - 1} more)` : ''}`);
      settlePreview(target);
    } catch (err) {
      ctx.toast(`Save failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      saving = false;
      ctx.render();
    }
  };

  /** After a save, drop the preview override once the dev server's hot reload shows the same gradient. */
  const settlePreview = (t: Target) => {
    const expected = serialize(model!);
    let tries = 0;
    const check = () => {
      if (target === t && isDirty()) return;
      const css = previews.get(t.id);
      previews.delete(t.id);
      writePreviews();
      const now = findGradients(getComputedStyle(t.el, t.pseudo || null).backgroundImage)[t.layer]?.text ?? '';
      if (compareGradients(now, expected) === 'exact') {
        if (target === t) t.computed = getComputedStyle(t.el, t.pseudo || null).backgroundImage;
        return;
      }
      if (css) previews.set(t.id, css);
      writePreviews();
      if (++tries < 10) setTimeout(check, 500);
    };
    setTimeout(check, 400);
  };

  const revert = () => {
    if (!model || !isDirty()) return;
    update((m) => Object.assign(m, toModel(baseline)!));
    ctx.render();
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
                if (isDirty() && !confirm('Discard unsaved changes to this layer?')) return ctx.render();
                open({ el: t.el, pseudo: t.pseudo, computed: t.computed, layer: Number((e.target as HTMLSelectElement).value) });
              },
            },
            ...Array.from({ length: t.layerCount }, (_, i) => h('option', { value: i, selected: i === t.layer }, `Layer ${i + 1} of ${t.layerCount}`)),
          )
        : null;
    body.append(
      h(
        'div',
        { className: 'section' },
        h('div', { className: 'label' }, 'Element'),
        h('div', { className: 'row' }, h('div', { className: 'grow mono ellipsis', title: cssPath(t.el) + t.pseudo }, describe(t.el, t.pseudo)), ctx.button('icon', ICONS.pick, 'Pick another gradient (Alt+P)', ctx.pick)),
        layerSelect,
      ),
    );

    // Source
    const sourceSection = h('div', { className: 'section' }, h('div', { className: 'label' }, 'Source'));
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
      { className: 'section' },
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
      const swatch = h('input', {
        type: 'color',
        oninput: (e: Event) =>
          update((d) => {
            const [r, g, b] = toRgba((e.target as HTMLInputElement).value)!;
            d.stops[i]!.color = formatColor([r, g, b, resolvedColor(i)[3]]);
          }, `color-${i}`),
      });
      const text = h('input', {
        className: 'text grow mono',
        spellcheck: false,
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (CSS.supports('color', v) || /^var\(/.test(v)) update((d) => void (d.stops[i]!.color = v));
          else ctx.toast('Not a valid CSS colour', true), patch();
        },
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
        h('label', { className: 'swatch' }, swatch),
        text,
        pos,
        ctx.button('icon ghost small', ICONS.trash, 'Remove stop', () => removeStop(i)),
      );
      stopRefs[i] = { row, swatch, text, pos };
      list.append(row);
    });
    const alpha = slider('alpha', 'Opacity', 0, 100, 1, (d, v) => {
      if (selected === null) return;
      const [r, g, b] = resolvedColor(selected);
      d.stops[selected]!.color = formatColor([r, g, b, v / 100]);
    });
    refs.alpha = alpha;
    body.append(
      h(
        'div',
        { className: 'section' },
        h('div', { className: 'label' }, `Stops  ${m.stops.filter((s) => s.color).length}`, h('button', { className: 'btn small', type: 'button', onclick: () => addStop() }, '+ Add')),
        bar,
        list,
        alpha,
      ),
    );

    // Output
    refs.code = h('div', { className: 'code' });
    body.append(
      h(
        'div',
        { className: 'section' },
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
    refs.revert = btn('Revert', revert, 'ghost');
    refs.save = h('button', { className: 'btn primary', type: 'button', title: 'Write to source (Ctrl/⌘+S)', onclick: () => void save() }, 'Save');
    const foot = h('div', { className: 'foot' }, refs.undo, refs.redo, refs.status, refs.revert, refs.save);
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
        const hx = hex(rgba);
        if (r.swatch.value !== hx) r.swatch.value = hx;
        if (ctx.shadow.activeElement !== r.text) r.text.value = s.color;
        if (ctx.shadow.activeElement !== r.pos) r.pos.value = s.positions.join(' ');
      }
    });
    if (refs.bar) refs.bar.style.background = `linear-gradient(90deg, ${barStops.join(', ')}), repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 10px 10px`;
    setRange('angle', m.cfg.angle, `${Math.round(m.cfg.angle)}°`);
    setRange('x', m.cfg.x ?? 50, `${Math.round(m.cfg.x ?? 50)}`);
    setRange('y', m.cfg.y ?? 50, `${Math.round(m.cfg.y ?? 50)}`);
    if (refs.alpha) {
      refs.alpha.style.display = selected === null ? 'none' : '';
      if (selected !== null) {
        const a = Math.round(resolvedColor(selected)[3] * 100);
        setRange('alpha', a, `${a}`);
      }
    }
    if (refs.code) refs.code.textContent = serialize(m);
    const dirty = isDirty();
    if (refs.status) {
      refs.status.className = `status${dirty ? ' dirty' : ''}`;
      refs.status.textContent = saving ? 'Saving…' : dirty ? 'Unsaved' : source ? `In ${source.file}:${source.line}` : searching ? 'Searching…' : 'Not found in source';
      refs.status.title = source ? `${source.file}:${source.line}` : '';
    }
    if (refs.save) (refs.save as HTMLButtonElement).disabled = !dirty || saving || !source;
    if (refs.revert) (refs.revert as HTMLButtonElement).disabled = !dirty;
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
    const r = target!.el.getBoundingClientRect();
    const m = model!;
    const cx = m.fn === 'linear' ? r.left + r.width / 2 : r.left + ((m.cfg.x ?? 50) / 100) * r.width;
    const cy = m.fn === 'linear' ? r.top + r.height / 2 : r.top + ((m.cfg.y ?? 50) / 100) * r.height;
    const radius = clamp(Math.min(r.width, r.height) / 2 - 12, 24, 70);
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

  // ---------- lifecycle ----------
  const open = (pick: { el: Element; pseudo: Pseudo; computed: string; layer?: number }) => {
    if (target) dropPreview(target);
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
    computedStops = parseGradient(findGradients(computed)[layer]?.text ?? '')?.stops.map((s) => s.color) ?? [];
    rebase(findGradients(computed)[layer]?.text ?? '');
    matches = [];
    source = null;
    applyAll = false;
    selected = null;
    ctx.render();
    void search();
  };

  /** Close the current edit. Returns false if the user cancelled because of unsaved changes. */
  const close = (force = false) => {
    if (!target) return true;
    if (!force && isDirty() && !confirm('Discard unsaved gradient changes?')) return false;
    if (isDirty()) dropPreview(target);
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
    deselect: () => {
      if (selected === null) return false;
      selected = null;
      patch();
      return true;
    },
    structureKey: () =>
      [target?.id, target?.layer, model?.fn, model?.stops.length, model?.cfg.positionRaw, searching, saving, source?.file, source?.start, matches.length, applyAll].join('|'),
  };
}

export type CssEditor = ReturnType<typeof createCssEditor>;
