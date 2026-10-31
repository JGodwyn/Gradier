import { gradientToCSS } from '../core/css';
import { defineGradientElement } from '../core/element';
import { getGradient, getGradients, mountedElements, registerGradients, removeGradient, setGradient, subscribe } from '../core/store';
import { arcSamples, defaultBulge, distToLine } from '../core/geometry';
import {
  AREA_RADIUS,
  defaultArms,
  isValidName,
  MAX_POINTS,
  MAX_RADIUS,
  MIN_RADIUS,
  normalizeGradient,
  normalizeHex,
  PRESETS,
  randomGradient,
  rgbToHex,
  translatePoint,
  type Gradient,
  type GradientPoint,
  type PointShape,
} from '../core/types';
import { createCssEditor } from './css-editor';
import { h } from './dom';
import { ICONS } from './icons';
import { startPicker } from './picker';
import { STYLES } from './styles';
import { ACTION_KEYS, createToolbar, TOOLS, type Tool } from './toolbar';

declare global {
  interface Window {
    __GRADIER_OVERLAY__?: boolean;
  }
}


const SLIDERS: Array<{ key: keyof Omit<Gradient, 'points'>; label: string }> = [
  { key: 'softness', label: 'Softness' },
  { key: 'warp', label: 'Warp' },
  { key: 'warpScale', label: 'Warp size' },
  { key: 'grain', label: 'Grain' },
  { key: 'speed', label: 'Motion' },
];

const script = document.currentScript as HTMLScriptElement | null;
const BASE = (script?.src ? new URL('.', script.src) : new URL('/__gradier/', location.href)).toString();
const API = `${BASE}api`;

const canon = (g: Gradient) => JSON.stringify(normalizeGradient(g));
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

function storage(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isTextField(node: EventTarget | undefined): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  return node instanceof HTMLInputElement && !['range', 'color', 'checkbox', 'radio', 'button'].includes(node.type);
}

function boot() {
  const state = {
    open: storage('gradier:open') === '1',
    dock: (storage('gradier:dock') as 'left' | 'right' | null) ?? 'right',
    selected: null as string | null,
    target: null as HTMLElement | null,
    point: null as number | null,
    saved: {} as Record<string, string>,
    file: '',
    connected: false,
    loaded: false,
    saving: false,
    mode: 'mesh' as 'mesh' | 'css',
    tool: 'select' as Tool,
    handlesHidden: false,
  };
  let cancelPick: (() => void) | null = null;
  const history = new Map<string, { undo: string[]; redo: string[]; key?: string; at: number }>();

  // ---------- DOM scaffolding ----------
  const host = h('div', { id: 'gradier-overlay' });
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const root = h('div', { className: 'root' });
  const stage = h('div', { className: 'stage' });
  const toastEl = h('div', { className: 'toast' });
  shadow.append(h('style', {}, STYLES), root);
  root.append(stage, toastEl);
  document.documentElement.append(host);
  // Re-attach if a framework wipes the document (e.g. full-page client navigation).
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.append(host);
  }).observe(document.documentElement, { childList: true });

  let launcher: HTMLButtonElement | null = null;
  let panel: HTMLElement | null = null;
  let refs: {
    rows: HTMLElement[];
    swatches: HTMLInputElement[];
    hexes: HTMLInputElement[];
    coords: HTMLElement[];
    sliders: Map<string, [HTMLInputElement, HTMLOutputElement]>;
    status?: HTMLElement;
    save?: HTMLButtonElement;
    undo?: HTMLButtonElement;
    redo?: HTMLButtonElement;
  } = { rows: [], swatches: [], hexes: [], coords: [], sliders: new Map() };
  let structure = '';

  // ---------- helpers ----------
  let toastTimer = 0;
  const toast = (msg: string, error = false) => {
    toastEl.textContent = msg;
    toastEl.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.className = 'toast'), error ? 4000 : 1800);
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      window.prompt(`Copy ${what}:`, text);
    }
  };

  const button = (cls: string, icon: string, title: string, onclick: () => void) => {
    const b = h('button', { className: `btn ${cls}`, title, type: 'button', onclick });
    b.innerHTML = icon;
    return b;
  };

  const css = createCssEditor({
    api: BASE,
    host,
    stage,
    shadow,
    toast,
    copy: (text, what) => void copy(text, what),
    button,
    render: () => render(),
    pick: () => pick(),
    back: () => {
      if (css.close()) state.mode = 'mesh';
      render();
    },
  });

  /** Enter pick mode: the next click on the page chooses which gradient to edit. */
  const pick = () => {
    if (cancelPick) return;
    if (!state.open) setOpen(true);
    cancelPick = startPicker(stage, host, (result) => {
      cancelPick = null;
      if (!result) return render();
      if (result.kind === 'mesh') {
        if (!css.close()) return render();
        state.mode = 'mesh';
        if (!getGradient(result.name)) create(result.name);
        else select(result.name, result.el);
        return;
      }
      if (!css.close()) return render();
      state.mode = 'css';
      css.open(result);
    });
    render();
  };

  const isDirty = () => changes().count > 0 || css.dirty;

  const namedElements = () =>
    [...mountedElements()].filter((el) => el.isConnected && el.getAttribute('name')) as HTMLElement[];

  const changes = () => {
    const current = getGradients();
    const changed = Object.keys(current).filter((n) => canon(current[n]!) !== state.saved[n]);
    const deleted = Object.keys(state.saved).filter((n) => !(n in current));
    return { changed, deleted, count: changed.length + deleted.length };
  };

  const hist = (name: string) => {
    let entry = history.get(name);
    if (!entry) history.set(name, (entry = { undo: [], redo: [], at: 0 }));
    return entry;
  };

  const ensureSelection = () => {
    const names = Object.keys(getGradients());
    if (state.selected && names.includes(state.selected)) return;
    const onPage = namedElements().find((el) => names.includes(el.getAttribute('name')!));
    state.selected = onPage?.getAttribute('name') ?? names[0] ?? null;
    state.target = onPage ?? null;
    state.point = null;
  };

  /** Apply an edit to the selected gradient. Consecutive edits with the same `key` merge into one undo step. */
  const update = (mutate: (g: Gradient) => Gradient | void, key?: string) => {
    const name = state.selected;
    const current = name ? getGradient(name) : undefined;
    if (!name || !current) return;
    const draft = structuredClone(current);
    const next = normalizeGradient(mutate(draft) ?? draft);
    const before = canon(current);
    if (canon(next) === before) return;
    const entry = hist(name);
    const now = performance.now();
    if (!key || key !== entry.key || now - entry.at > 1000) {
      entry.undo.push(before);
      if (entry.undo.length > 200) entry.undo.shift();
    }
    entry.redo = [];
    entry.key = key;
    entry.at = now;
    setGradient(name, next);
  };

  const undo = (redo = false) => {
    const name = state.selected;
    const current = name ? getGradient(name) : undefined;
    if (!name || !current) return;
    const entry = hist(name);
    const snapshot = (redo ? entry.redo : entry.undo).pop();
    if (!snapshot) return;
    (redo ? entry.undo : entry.redo).push(canon(current));
    entry.key = undefined;
    const g = normalizeGradient(JSON.parse(snapshot));
    if (state.point !== null && state.point >= g.points.length) state.point = null;
    setGradient(name, g);
  };

  // ---------- server ----------
  const load = async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { file: string; gradients: Record<string, Gradient> };
      state.file = data.file;
      state.saved = Object.fromEntries(Object.entries(data.gradients).map(([n, g]) => [n, canon(g)]));
      const current = getGradients();
      const missing = Object.fromEntries(Object.entries(data.gradients).filter(([n]) => !(n in current)));
      if (Object.keys(missing).length) registerGradients(missing);
      state.connected = true;
    } catch (err) {
      console.warn(`[gradier] Could not reach the save server at ${API}.`, err);
      state.connected = false;
    }
    state.loaded = true;
    render();
  };

  const save = async () => {
    const { changed, deleted, count } = changes();
    if (!count || state.saving) return;
    if (!state.connected) return toast('Save server not reachable', true);
    state.saving = true;
    render();
    try {
      const current = getGradients();
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: Object.fromEntries(changed.map((n) => [n, current[n]])), delete: deleted }),
      });
      const data = (await res.json()) as { file: string; gradients: Record<string, Gradient>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      state.file = data.file;
      state.saved = Object.fromEntries(Object.entries(data.gradients).map(([n, g]) => [n, canon(g)]));
      toast(`Saved to ${data.file}`);
    } catch (err) {
      toast(`Save failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      state.saving = false;
      render();
    }
  };

  // ---------- gradient management ----------
  const create = (suggested?: string) => {
    const names = Object.keys(getGradients());
    let n = names.length + 1;
    while (names.includes(`gradient-${n}`)) n++;
    const name = suggested ?? window.prompt('Name for the new gradient (letters, numbers, - and _):', `gradient-${n}`)?.trim();
    if (!name) return;
    if (!isValidName(name)) return toast('Use letters, numbers, - and _ only', true);
    if (names.includes(name)) return toast(`"${name}" already exists`, true);
    setGradient(name, randomGradient());
    state.selected = name;
    state.target = namedElements().find((el) => el.getAttribute('name') === name) ?? null;
    state.point = null;
    render();
  };

  const rename = () => {
    const from = state.selected;
    const g = from ? getGradient(from) : undefined;
    if (!from || !g) return;
    const to = window.prompt(`Rename "${from}" to:\n(Remember to update name="${from}" in your markup.)`, from)?.trim();
    if (!to || to === from) return;
    if (!isValidName(to)) return toast('Use letters, numbers, - and _ only', true);
    if (getGradient(to)) return toast(`"${to}" already exists`, true);
    setGradient(to, g);
    namedElements()
      .filter((el) => el.getAttribute('name') === from)
      .forEach((el) => el.setAttribute('name', to));
    removeGradient(from);
    const h0 = history.get(from);
    if (h0) history.set(to, h0), history.delete(from);
    state.selected = to;
    render();
  };

  const remove = () => {
    const name = state.selected;
    if (!name || !window.confirm(`Delete gradient "${name}"? It is removed from the file when you save.`)) return;
    removeGradient(name);
    state.selected = null;
    ensureSelection();
    render();
  };

  const select = (name: string, target?: HTMLElement | null) => {
    if (state.selected !== name) state.point = null;
    state.selected = name;
    state.target = target ?? namedElements().find((el) => el.getAttribute('name') === name) ?? null;
    render();
  };

  const addPoint = (x?: number, y?: number, color?: string, shape?: PointShape) => {
    update((g) => {
      if (g.points.length >= MAX_POINTS) {
        toast(`Max ${MAX_POINTS} points`, true);
        return;
      }
      const near = g.points[Math.floor(Math.random() * g.points.length)];
      g.points.push({
        x: x ?? 0.2 + Math.random() * 0.6,
        y: y ?? 0.2 + Math.random() * 0.6,
        color: color ?? near?.color ?? '#ffffff',
        ...(shape ? { shape } : {}),
      });
      state.point = g.points.length - 1;
    });
  };

  const removePoint = (i: number) => {
    update((g) => {
      if (g.points.length <= 2) {
        toast('A gradient needs at least 2 points', true);
        return;
      }
      g.points.splice(i, 1);
      state.point = null;
    });
  };

  const shuffleColors = () =>
    update((d) => {
      const colors = d.points.map((p) => p.color);
      // Rotate rather than sort randomly so every click visibly changes something.
      const shift = 1 + Math.floor(Math.random() * Math.max(1, colors.length - 1));
      d.points.forEach((p, i) => (p.color = colors[(i + shift) % colors.length]!));
    });

  const scatterPoints = () =>
    update((d) => {
      d.points.forEach((p) => translatePoint(p, 0.08 + Math.random() * 0.84 - p.x, 0.08 + Math.random() * 0.84 - p.y));
    });

  const setTool = (tool: Tool) => {
    state.tool = tool;
    render();
  };

  const toggleHandles = () => {
    state.handlesHidden = !state.handlesHidden;
    render();
  };

  const toolbar = createToolbar({ setTool, shuffle: shuffleColors, scatter: scatterPoints, toggleHandles });

  const setOpen = (open: boolean) => {
    state.open = open;
    storage('gradier:open', open ? '1' : '0');
    if (open) ensureSelection();
    render();
  };

  // ---------- panel ----------

  const buildPanel = (g: Gradient | undefined) => {
    refs = { rows: [], swatches: [], hexes: [], coords: [], sliders: new Map() };
    const names = Object.keys(getGradients());
    const onPage = new Set(namedElements().map((el) => el.getAttribute('name')));

    const head = h(
      'div',
      { className: 'head' },
      h('span', { className: 'logo' }),
      state.mode === 'css' && Object.keys(getGradients()).length
        ? button('icon ghost', ICONS.back, 'Back to mesh gradients', () => {
            if (css.close()) state.mode = 'mesh';
            render();
          })
        : null,
      h('span', { className: 'title' }, state.mode === 'css' ? 'CSS gradient' : 'Gradier'),
      button(`icon ghost${cancelPick ? ' on' : ''}`, ICONS.pick, 'Pick any gradient on the page (Alt+P)', pick),
      button('icon ghost', ICONS.dock, 'Move panel to other side', () => {
        state.dock = state.dock === 'right' ? 'left' : 'right';
        storage('gradier:dock', state.dock);
        render();
      }),
      button('icon ghost', ICONS.close, 'Close (Alt+G)', () => setOpen(false)),
    );

    if (state.mode === 'css') {
      const { body, foot } = css.build();
      return h('div', { className: `panel${state.dock === 'left' ? ' left' : ''}` }, head, body, foot);
    }

    const body = h('div', { className: 'body' });

    if (!state.connected && state.loaded) {
      body.append(
        h(
          'div',
          { className: 'hint', style: 'color: var(--warn)' },
          `Can't reach the save server (${API}). You can still edit, but saving won't work.`,
        ),
      );
    }

    const picker = h(
      'select',
      {
        className: 'grow',
        onchange: (e: Event) => select((e.target as HTMLSelectElement).value),
      },
      ...names.map((n) =>
        h('option', { value: n, selected: n === state.selected }, onPage.has(n) ? n : `${n}  (not on page)`),
      ),
    );
    body.append(
      h(
        'div',
        { className: 'section' },
        h('div', { className: 'label' }, 'Gradient'),
        h(
          'div',
          { className: 'row' },
          names.length ? picker : h('div', { className: 'grow hint' }, 'No gradients yet'),
          names.length ? button('icon', ICONS.edit, 'Rename', rename) : null,
          names.length ? button('icon', ICONS.trash, 'Delete', remove) : null,
          button('icon', ICONS.plus, 'New gradient', () => create()),
        ),
      ),
    );

    if (!g || !state.selected) {
      body.append(
        h(
          'div',
          { className: 'section' },
          h('div', { className: 'hint' }, 'Edit any CSS gradient already on this page:'),
          h('button', { className: 'btn primary', type: 'button', onclick: pick }, 'Pick a gradient on the page'),
          h('div', { className: 'hint' }, 'Or add a mesh gradient: put this in your markup, then create a gradient with the same name.'),
          h('div', { className: 'code' }, '<gradier-gradient name="hero"></gradier-gradient>'),
          h('button', { className: 'btn', type: 'button', onclick: () => create() }, 'Create mesh gradient'),
        ),
      );
    } else {
      // Points
      const list = h('div', { className: 'points' });
      g.points.forEach((p, i) => {
        const color = h('input', {
          type: 'color',
          value: p.color,
          oninput: (e: Event) => update((d) => void (d.points[i]!.color = (e.target as HTMLInputElement).value), `color-${i}`),
        });
        const hex = h('input', {
          className: 'text grow',
          value: p.color,
          spellcheck: false,
          onchange: (e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) update((d) => void (d.points[i]!.color = normalizeHex(v)));
            else (e.target as HTMLInputElement).value = getGradient(state.selected!)!.points[i]!.color;
          },
        });
        const coords = h('span', { className: 'coords' });
        refs.swatches.push(color);
        refs.hexes.push(hex);
        refs.coords.push(coords);
        const del = button('icon ghost small', ICONS.trash, 'Remove point', () => removePoint(i));
        const row = h(
          'div',
          {
            className: 'point',
            onpointerdown: () => {
              state.point = i;
              patch(getGradient(state.selected!));
            },
          },
          h('label', { className: 'swatch' }, color),
          hex,
          coords,
          del,
        );
        refs.rows.push(row);
        list.append(row);
      });
      body.append(
        h(
          'div',
          { className: 'section' },
          h(
            'div',
            { className: 'label' },
            `Points  ${g.points.length}/${MAX_POINTS}`,
            h('button', { className: 'btn small', type: 'button', onclick: () => addPoint() }, '+ Add'),
          ),
          list,
          h('div', { className: 'hint' }, 'Drag the handles on the page. Double-click the gradient, or use the Node tool (N), to add a point.'),
        ),
      );

      // Sliders
      const sliders = h('div', { className: 'section' }, h('div', { className: 'label' }, 'Blend'));
      for (const { key, label } of SLIDERS) {
        const out = h('output', {});
        const input = h('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.01,
          oninput: (e: Event) => update((d) => void (d[key] = Number((e.target as HTMLInputElement).value)), key),
        });
        refs.sliders.set(key, [input, out]);
        sliders.append(h('label', { className: 'slider' }, h('span', {}, label), input, out));
      }
      body.append(sliders);

      // Presets
      const presets = h('div', { className: 'presets' });
      for (const [name, preset] of Object.entries(PRESETS)) {
        const b = h('button', {
          className: 'preset',
          type: 'button',
          title: name,
          onclick: () => update(() => structuredClone(preset)),
        });
        b.style.background = gradientToCSS(preset);
        presets.append(b);
      }
      body.append(
        h(
          'div',
          { className: 'section' },
          h('div', { className: 'label' }, 'Presets'),
          presets,
          h(
            'div',
            { className: 'row' },
            h('button', { className: 'btn grow', type: 'button', onclick: () => update((d) => ({ ...randomGradient(d.points.length), ...blendOf(d) })) }, 'Randomize'),
            h(
              'button',
              {
                className: 'btn grow',
                type: 'button',
                onclick: shuffleColors,
              },
              'Shuffle colors',
            ),
          ),
        ),
      );

      // Export
      const name = state.selected;
      body.append(
        h(
          'div',
          { className: 'section' },
          h('div', { className: 'label' }, 'Use'),
          onPage.has(name)
            ? null
            : h('div', { className: 'hint' }, `"${name}" isn't on this page yet. Drop this where you want it:`),
          h('div', { className: 'code' }, `<gradier-gradient name="${name}"></gradier-gradient>`),
          h(
            'div',
            { className: 'row' },
            h('button', { className: 'btn grow', type: 'button', onclick: () => copy(`<gradier-gradient name="${name}"></gradier-gradient>`, 'Snippet') }, 'Copy tag'),
            h('button', { className: 'btn grow', type: 'button', onclick: () => copy(`background: ${gradientToCSS(getGradient(name)!)};`, 'CSS') }, 'Copy CSS'),
            h('button', { className: 'btn grow', type: 'button', onclick: () => copy(JSON.stringify(getGradient(name), null, 2), 'JSON') }, 'Copy JSON'),
          ),
        ),
      );
    }

    refs.undo = button('icon ghost', ICONS.undo, `Undo (${MOD}Z)`, () => undo());
    refs.redo = button('icon ghost', ICONS.redo, `Redo (${MOD}Shift+Z)`, () => undo(true));
    refs.status = h('span', { className: 'status' });
    refs.save = h('button', { className: 'btn primary', type: 'button', title: `Save (${MOD}S)`, onclick: save }, 'Save');
    const foot = h('div', { className: 'foot' }, refs.undo, refs.redo, refs.status, refs.save);

    const el = h('div', { className: `panel${state.dock === 'left' ? ' left' : ''}` }, head, body, foot);
    return el;
  };

  /** Update values in place (keeps focus and slider drags working). */
  const patch = (g: Gradient | undefined) => {
    if (g) {
      g.points.forEach((p, i) => {
        const sw = refs.swatches[i];
        const hex = refs.hexes[i];
        if (sw && sw.value !== p.color) sw.value = p.color;
        if (hex && shadow.activeElement !== hex) hex.value = p.color;
        refs.rows[i]?.classList.toggle('active', state.point === i);
        refs.coords[i]!.textContent = `${Math.round(p.x * 100)}, ${Math.round(p.y * 100)}`;
      });
      for (const [key, [input, out]] of refs.sliders) {
        const v = g[key as keyof Gradient] as number;
        if (shadow.activeElement !== input) input.value = String(v);
        out.value = `${Math.round(v * 100)}`;
      }
    }
    const { count } = changes();
    if (refs.status) {
      refs.status.className = `status${count ? ' dirty' : ''}`;
      refs.status.textContent = state.saving
        ? 'Saving…'
        : count
          ? `${count} unsaved change${count > 1 ? 's' : ''}`
          : state.connected
            ? `Saved · ${state.file}`
            : 'Not connected';
      refs.status.title = state.file;
    }
    if (refs.save) refs.save.disabled = !count || state.saving || !state.connected;
    const entry = state.selected ? history.get(state.selected) : undefined;
    if (refs.undo) refs.undo.disabled = !entry?.undo.length;
    if (refs.redo) refs.redo.disabled = !entry?.redo.length;
  };

  const render = () => {
    const count = changes().count + (css.dirty ? 1 : 0);
    if (!state.open) {
      cancelPick?.();
      cancelPick = null;
      css.clearStage();
      panel?.remove();
      panel = null;
      structure = '';
      if (!launcher) {
        launcher = h('button', { className: 'launcher', type: 'button', title: 'Open Gradier (Alt+G)', onclick: () => setOpen(true) });
        launcher.style.pointerEvents = 'auto';
        root.append(launcher);
      }
      launcher.innerHTML = `<span class="logo"></span>Gradier${count ? '<span class="dot"></span>' : ''}`;
      toolbar.el.remove();
      stage.replaceChildren();
      overlays.clear();
      clearHandles();
      return;
    }
    launcher?.remove();
    launcher = null;
    if (state.mode === 'css' && !css.active) state.mode = 'mesh';
    ensureSelection();
    const g = state.selected ? getGradient(state.selected) : undefined;
    const key = [
      state.mode,
      !!cancelPick,
      state.mode === 'css' ? css.structureKey() : '',
      state.selected,
      state.dock,
      state.connected,
      state.loaded,
      g?.points.length,
      Object.keys(getGradients()).join(','),
      namedElements().map((el) => el.getAttribute('name')).join(','),
    ].join('|');
    if (key !== structure || !panel) {
      structure = key;
      const scroll = panel?.querySelector('.body')?.scrollTop ?? 0;
      const next = buildPanel(g);
      next.style.pointerEvents = 'auto';
      panel ? panel.replaceWith(next) : root.append(next);
      panel = next;
      panel.querySelector('.body')!.scrollTop = scroll;
    }
    const showToolbar = state.mode === 'mesh' && !cancelPick && !!g;
    if (showToolbar) {
      if (!toolbar.el.isConnected) root.append(toolbar.el);
      toolbar.patch({ tool: state.tool, handlesHidden: state.handlesHidden });
    } else toolbar.el.remove();
    if (state.mode === 'css') css.patch();
    else patch(g);
  };

  let frame = 0;
  const scheduleRender = () => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), render()));
  };

  // ---------- on-page handles ----------
  type Overlay = { frame: HTMLElement; chip: HTMLButtonElement };
  type Rel = { x: number; y: number };
  const overlays = new Map<HTMLElement, Overlay>();
  let dragKey: string | null = null;
  let drawing: { tool: Tool; samples: Rel[] } | null = null;

  /** Keyed element pool so handles survive across frames (keeps pointer capture and listeners intact). */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'guides');
  const pool = new Map<string, Element>();
  let used = new Set<string>();
  const get = <T extends Element>(key: string, make: () => T, parent: Element): T => {
    used.add(key);
    let el = pool.get(key);
    if (!el) {
      el = make();
      pool.set(key, el);
    }
    if (el.parentNode !== parent) parent.append(el);
    return el as T;
  };
  const svgEl = (key: string, tag: string, cls: string) =>
    get(key, () => {
      const el = document.createElementNS(SVG_NS, tag);
      el.setAttribute('class', cls);
      return el;
    }, svg);
  const sweepPool = () => {
    for (const [key, el] of pool) if (!used.has(key)) el.remove(), pool.delete(key);
    used = new Set();
  };
  const clearHandles = () => {
    used = new Set();
    sweepPool();
    svg.remove();
    canvas.remove();
  };

  const relFromEvent = (ev: PointerEvent, el: HTMLElement, snap = ev.shiftKey): Rel => {
    const r = el.getBoundingClientRect();
    let x = clamp((ev.clientX - r.left) / r.width, -0.25, 1.25);
    let y = clamp((ev.clientY - r.top) / r.height, -0.25, 1.25);
    if (snap) {
      x = Math.round(x * 20) / 20;
      y = Math.round(y * 20) / 20;
    }
    return { x, y };
  };

  /** Generic drag: calls `onMove` with the pointer position relative to the selected element. */
  const startDrag = (e: PointerEvent, key: string, index: number, onMove: (rel: Rel, ev: PointerEvent) => void) => {
    const el = state.target;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragKey = key;
    if (state.point !== index) {
      state.point = index;
      render();
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => onMove(relFromEvent(ev, el), ev);
    const up = () => {
      dragKey = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const editPoint = (index: number, key: string, mutate: (p: GradientPoint, el: HTMLElement) => void) =>
    update((d) => {
      const p = d.points[index];
      if (p && state.target) mutate(p, state.target);
    }, `${key}-${index}`);

  /** Pixel size of one arm/radius unit (√(w×h)) for the element. */
  const unitOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { r, unit: Math.sqrt(Math.max(r.width * r.height, 1)) };
  };

  const onColorHandle = (e: PointerEvent, i: number) =>
    startDrag(e, `h:${i}`, i, (rel) =>
      editPoint(i, 'move', (p) => {
        if (p.shape?.type === 'line') translatePoint(p, rel.x - p.x, rel.y - p.y);
        else {
          p.x = rel.x;
          p.y = rel.y;
        }
      }),
    );

  const onEndpoint = (e: PointerEvent, i: number, end: 'a' | 'b') =>
    startDrag(e, `ep:${i}:${end}`, i, (rel) =>
      editPoint(i, `end-${end}`, (p) => {
        if (!p.shape) return;
        p.shape[end] = rel;
        if (p.shape.type === 'line') {
          p.x = (p.shape.a.x + p.shape.b.x) / 2;
          p.y = (p.shape.a.y + p.shape.b.y) / 2;
        }
      }),
    );

  const onArm = (e: PointerEvent, i: number, k: number) =>
    startDrag(e, `arm:${i}:${k}`, i, (rel) =>
      editPoint(i, `arm-${k}`, (p, el) => {
        const { r, unit } = unitOf(el);
        const arms = p.arms ?? defaultArms();
        arms[k] = [((rel.x - p.x) * r.width) / unit, ((rel.y - p.y) * r.height) / unit];
        p.arms = arms;
      }),
    );

  const onGrip = (e: PointerEvent, i: number) =>
    startDrag(e, `grip:${i}`, i, (rel) =>
      editPoint(i, 'radius', (p, el) => {
        const { r, unit } = unitOf(el);
        const dist = Math.hypot((rel.x - p.x) * r.width, (rel.y - p.y) * r.height);
        p.radius = clamp(dist / (AREA_RADIUS * unit), MIN_RADIUS, MAX_RADIUS);
      }),
    );

  /** Read the rendered colour under a point of a gradient element (averaged over a few pixels). */
  const sampler = document.createElement('canvas');
  sampler.width = sampler.height = 1;
  const sampleColor = (el: HTMLElement, rel: Rel): string | null => {
    const src = el.shadowRoot?.querySelector('canvas');
    const ctx = sampler.getContext('2d', { willReadFrequently: true });
    if (!src || !ctx || !src.width || !src.height) return null;
    try {
      const sx = clamp(rel.x, 0, 1) * src.width;
      const sy = clamp(rel.y, 0, 1) * src.height;
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(src, clamp(sx - 3, 0, src.width - 6), clamp(sy - 3, 0, src.height - 6), 6, 6, 0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a ? rgbToHex(r!, g!, b!) : null;
    } catch {
      return null;
    }
  };

  /** Turn a finished drag with the Line / Arc / Pencil tool into a shaped point. */
  const finishDrawing = (tool: Tool, samples: Rel[]) => {
    const el = state.target;
    if (!el || samples.length < 2) return;
    const { r } = unitOf(el);
    const px = (p: Rel) => ({ x: p.x * r.width, y: p.y * r.height });
    const rel = (p: { x: number; y: number }) => ({ x: p.x / r.width, y: p.y / r.height });
    const a = samples[0]!;
    const b = samples[samples.length - 1]!;
    const chord = Math.hypot(px(b).x - px(a).x, px(b).y - px(a).y);
    if (chord < 8) {
      if (tool === 'pencil') toast('Draw an open stroke: it becomes a line or an arc');
      return;
    }
    let shape: PointShape;
    let mid: Rel;
    if (tool === 'line') {
      shape = { type: 'line', a, b };
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (tool === 'arc') {
      shape = { type: 'arc', a, b };
      mid = rel(defaultBulge(px(a), px(b)));
    } else {
      // Pencil: fit the freehand stroke with the arc through its start, halfway point and end.
      const pts = samples.map(px);
      const lengths = [0];
      for (let k = 1; k < pts.length; k++) lengths.push(lengths[k - 1]! + Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y));
      const half = lengths[lengths.length - 1]! / 2;
      const m = pts[Math.max(0, lengths.findIndex((l) => l >= half))]!;
      const straight = distToLine(m, pts[0]!, pts[pts.length - 1]!) < chord * 0.06;
      shape = { type: straight ? 'line' : 'arc', a, b };
      mid = straight ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : rel(m);
    }
    addPoint(mid.x, mid.y, sampleColor(el, mid) ?? undefined, shape);
  };

  /** Transparent layer over the selected gradient that receives clicks while a drawing tool is active. */
  const canvas = h('div', { className: 'canvas' });
  canvas.addEventListener('pointerdown', (e) => {
    const el = state.target;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const start = relFromEvent(e, el, false);
    if (state.tool === 'node') {
      addPoint(clamp(start.x, 0, 1), clamp(start.y, 0, 1), sampleColor(el, start) ?? undefined);
      return;
    }
    if (state.tool === 'select') return;
    canvas.setPointerCapture(e.pointerId);
    drawing = { tool: state.tool, samples: [start] };
    const move = (ev: PointerEvent) => {
      if (!drawing) return;
      const p = relFromEvent(ev, el, ev.shiftKey && drawing.tool !== 'pencil');
      if (drawing.tool === 'pencil') drawing.samples.push(p);
      else drawing.samples = [drawing.samples[0]!, p];
    };
    const up = () => {
      const done = drawing;
      drawing = null;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      if (done) finishDrawing(done.tool, done.samples);
    };
    const cancel = () => {
      drawing = null;
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
  });

  const polyline = (pts: Array<{ x: number; y: number }>) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const knob = (key: string, cls: string, x: number, y: number, onDown: (e: PointerEvent) => void, title: string) => {
    const el = get(key, () => {
      const k = h('div', { className: cls, title });
      k.addEventListener('pointerdown', onDown);
      return k;
    }, stage);
    el.classList.toggle('dragging', dragKey === key);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    return el;
  };

  /** Draw handles, curves, the area circle and arms for the selected gradient. */
  const drawHandles = (g: Gradient, r: DOMRect) => {
    if (!svg.isConnected) stage.prepend(svg);
    const unit = Math.sqrt(Math.max(r.width * r.height, 1));
    const toPx = (p: Rel) => ({ x: r.left + p.x * r.width, y: r.top + p.y * r.height });

    if (!state.handlesHidden) {
      const sel = state.point !== null ? g.points[state.point] : undefined;
      const i = state.point!;
      if (sel) {
        const c = toPx(sel);
        // Curve the colour follows.
        if (sel.shape) {
          const a = toPx(sel.shape.a);
          const b = toPx(sel.shape.b);
          const pts = sel.shape.type === 'arc' ? arcSamples(a, c, b) : [a, b];
          svgEl(`curve:${i}`, 'polyline', 'curve').setAttribute('points', polyline(pts));
        }
        // Area circle + resize grip.
        const R = AREA_RADIUS * (sel.radius ?? 1) * unit;
        const area = svgEl(`area:${i}`, 'circle', 'area');
        area.setAttribute('cx', `${c.x}`);
        area.setAttribute('cy', `${c.y}`);
        area.setAttribute('r', `${R}`);
        const gr = R + 5;
        const a0 = (15 * Math.PI) / 180;
        const a1 = (65 * Math.PI) / 180;
        const d = `M ${c.x + gr * Math.cos(a0)} ${c.y + gr * Math.sin(a0)} A ${gr} ${gr} 0 0 1 ${c.x + gr * Math.cos(a1)} ${c.y + gr * Math.sin(a1)}`;
        svgEl(`grip:${i}`, 'path', `grip${dragKey === `grip:${i}` ? ' on' : ''}`).setAttribute('d', d);
        const hit = get(`griphit:${i}`, () => {
          const el = document.createElementNS(SVG_NS, 'path');
          el.setAttribute('class', 'grip-hit');
          el.appendChild(document.createElementNS(SVG_NS, 'title')).textContent = 'Drag to expand or shrink the area';
          el.addEventListener('pointerdown', (e) => onGrip(e as PointerEvent, i));
          return el;
        }, svg);
        hit.setAttribute('d', d);
        // Direction arms (plain points only).
        if (!sel.shape) {
          (sel.arms ?? defaultArms()).forEach(([dx, dy], k) => {
            const end = { x: c.x + dx * unit, y: c.y + dy * unit };
            const line = svgEl(`armline:${i}:${k}`, 'line', 'arm');
            line.setAttribute('x1', `${c.x}`);
            line.setAttribute('y1', `${c.y}`);
            line.setAttribute('x2', `${end.x}`);
            line.setAttribute('y2', `${end.y}`);
            knob(`arm:${i}:${k}`, 'knob', end.x, end.y, (e) => onArm(e, i, k), 'Drag to stretch the colour this way');
          });
        } else {
          const a = toPx(sel.shape.a);
          const b = toPx(sel.shape.b);
          knob(`ep:${i}:a`, 'knob end', a.x, a.y, (e) => onEndpoint(e, i, 'a'), 'Drag to move this end');
          knob(`ep:${i}:b`, 'knob end', b.x, b.y, (e) => onEndpoint(e, i, 'b'), 'Drag to move this end');
        }
      }
      g.points.forEach((p, k) => {
        const c = toPx(p);
        const el = knob(`h:${k}`, 'handle', c.x, c.y, (e) => onColorHandle(e, k), '');
        el.className = `handle${state.point === k ? ' active' : ''}${dragKey === `h:${k}` ? ' dragging' : ''}`;
        el.style.background = p.color;
        el.title =
          p.shape?.type === 'arc'
            ? `${p.color} · drag to bend the arc, Delete to remove`
            : `${p.color} · drag to move, Delete to remove`;
      });
    }

    // Live preview while drawing a line, arc or pencil stroke.
    if (drawing && drawing.samples.length > 1) {
      const pts = drawing.samples.map(toPx);
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const shown = drawing.tool === 'arc' ? arcSamples(a, defaultBulge(a, b), b) : drawing.tool === 'line' ? [a, b] : pts;
      svgEl('preview', 'polyline', 'curve preview').setAttribute('points', polyline(shown));
    }
  };

  const positionStage = () => {
    if (!state.open) return;
    if (state.mode === 'css') {
      for (const o of overlays.values()) o.frame.remove(), o.chip.remove();
      overlays.clear();
      clearHandles();
      css.positionStage();
      return;
    }
    css.clearStage();
    const els = namedElements();
    const selected = state.selected;
    if (!state.target?.isConnected || state.target.getAttribute('name') !== selected) {
      state.target = els.find((el) => el.getAttribute('name') === selected) ?? null;
    }
    const seen = new Set<HTMLElement>();
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      seen.add(el);
      let o = overlays.get(el);
      if (!o) {
        const chip = h('button', { className: 'chip', type: 'button' });
        chip.addEventListener('click', () => {
          const name = el.getAttribute('name')!;
          if (!getGradient(name)) create(name);
          else select(name, el);
        });
        o = { frame: h('div', { className: 'frame' }), chip };
        overlays.set(el, o);
        stage.append(o.frame, o.chip);
      }
      const name = el.getAttribute('name')!;
      const active = el === state.target;
      const missing = !getGradient(name);
      o.frame.className = `frame${active ? '' : ' dim'}`;
      o.chip.className = `chip${active ? '' : missing ? ' missing' : ' dim'}`;
      const label = missing ? `${name} · click to create` : name;
      if (o.chip.textContent !== label) o.chip.textContent = label;
      Object.assign(o.frame.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      Object.assign(o.chip.style, { left: `${r.left}px`, top: `${Math.max(r.top, 24)}px` });
    }
    for (const [el, o] of overlays) {
      if (!seen.has(el)) {
        o.frame.remove();
        o.chip.remove();
        overlays.delete(el);
      }
    }

    const g = selected ? getGradient(selected) : undefined;
    const target = state.target;
    if (!g || !target || !seen.has(target)) return clearHandles();
    const r = target.getBoundingClientRect();
    if (state.tool !== 'select' && !cancelPick) {
      if (!canvas.isConnected) stage.prepend(canvas);
      Object.assign(canvas.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    } else canvas.remove();
    drawHandles(g, r);
    sweepPool();
  };

  const loop = () => {
    positionStage();
    requestAnimationFrame(loop);
  };

  // ---------- global listeners ----------
  window.addEventListener(
    'dblclick',
    (e) => {
      if (!state.open || state.mode !== 'mesh' || cancelPick) return;
      const path = e.composedPath();
      if (path.includes(host)) return;
      const el = namedElements().find((x) => path.includes(x));
      const name = el?.getAttribute('name');
      if (!el || !name || !getGradient(name)) return;
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      if (state.selected !== name || state.target !== el) select(name, el);
      const r = el.getBoundingClientRect();
      const at = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      addPoint(at.x, at.y, sampleColor(el, at) ?? undefined);
    },
    true,
  );

  const toolKey = (key: string): (() => void) | undefined => {
    if (!state.selected || !getGradient(state.selected)) return;
    const k = key.toUpperCase();
    const tool = TOOLS.find((t) => t.key === k);
    if (tool) return () => setTool(tool.id);
    if (k === ACTION_KEYS.shuffle) return shuffleColors;
    if (k === ACTION_KEYS.scatter) return scatterPoints;
    if (k === ACTION_KEYS.eye) return toggleHandles;
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        return setOpen(!state.open);
      }
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        return pick();
      }
      if (!state.open || cancelPick) return;
      const target = e.composedPath()[0];
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (state.mode === 'css') {
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void css.save();
        } else if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') && !isTextField(target)) {
          e.preventDefault();
          css.undo(e.shiftKey || e.key.toLowerCase() === 'y');
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && css.selectedStop !== null && !isTextField(target)) {
          e.preventDefault();
          css.removeSelectedStop();
        } else if (e.key === 'Escape' && !isTextField(target)) {
          if (!css.deselect()) setOpen(false);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (mod && e.key.toLowerCase() === 'z' && !isTextField(target)) {
        e.preventDefault();
        undo(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === 'y' && !isTextField(target)) {
        e.preventDefault();
        undo(true);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.point !== null && !isTextField(target)) {
        e.preventDefault();
        removePoint(state.point);
      } else if (!mod && !e.altKey && !isTextField(target) && toolKey(e.key)) {
        e.preventDefault();
        toolKey(e.key)!();
      } else if (e.key === 'Escape' && !isTextField(target)) {
        if (state.tool !== 'select') setTool('select');
        else if (state.point !== null) {
          state.point = null;
          render();
        } else setOpen(false);
      }
    },
    true,
  );

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });

  subscribe(scheduleRender);
  render();
  requestAnimationFrame(loop);
  void load();
}

/** Keep the user's blend settings when randomising colours/positions. */
function blendOf(g: Gradient) {
  const { softness, warp, warpScale, grain, speed } = g;
  return { softness, warp, warpScale, grain, speed };
}

if (typeof window !== 'undefined' && !window.__GRADIER_OVERLAY__) {
  window.__GRADIER_OVERLAY__ = true;
  defineGradientElement();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
