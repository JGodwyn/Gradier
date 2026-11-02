import { gradientToCSS } from '../core/css';
import { defineGradientElement, LAYER_ATTR } from '../core/element';
import { MeshRenderer } from '../core/renderer';
import { getGradient, getGradients, mountedElements, registerGradients, removeGradient, setGradient, subscribe } from '../core/store';
import { arcSamples, bendPath, cumulative, defaultBulge, pointAlong, samplePath, simplifyStroke } from '../core/geometry';
import {
  AREA_RADIUS,
  BLEND_MODES,
  DEFAULTS,
  defaultArms,
  isValidName,
  MAX_PATH_POINTS,
  MAX_POINTS,
  MAX_RADIUS,
  MIN_RADIUS,
  normalizeGradient,
  normalizeHex,
  PRESETS,
  randomGradient,
  rgbToHex,
  translatePoint,
  LOOK_DEFAULTS,
  look,
  type Gradient,
  type GradientPoint,
  type GrainType,
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


type BaseNumKey = 'softness' | 'warp' | 'warpScale' | 'grain' | 'speed';
type LookNumKey = 'grainSize' | 'grainDensity' | 'hue' | 'saturation' | 'brightness' | 'temperature';
type NumKey = BaseNumKey | LookNumKey;
interface SliderDef {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  /** Displayed value = stored value × scale. */
  scale?: number;
  /** Applies to the selected node when one is selected, otherwise to all nodes. */
  scoped?: boolean;
}

const BLEND_SLIDERS: SliderDef[] = [
  { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, digits: 2, scoped: true },
  { key: 'warp', label: 'Warp', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'warpScale', label: 'Warp size', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'speed', label: 'Motion', min: 0, max: 1, step: 0.01, digits: 2 },
];
const GRAIN_SLIDERS: SliderDef[] = [
  { key: 'grain', label: 'Opacity', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'grainSize', label: 'Grain size', min: 1, max: 4, step: 0.1, digits: 1 },
  { key: 'grainDensity', label: 'Density', min: 0, max: 2, step: 0.1, digits: 1 },
];
const FILTER_SLIDERS: SliderDef[] = [
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, digits: 0, scoped: true },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, digits: 2, scoped: true },
  { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01, digits: 2, scoped: true },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, digits: 0, scale: 100, scoped: true },
];
const ALL_SLIDERS = [...BLEND_SLIDERS, ...GRAIN_SLIDERS, ...FILTER_SLIDERS];

const script = document.currentScript as HTMLScriptElement | null;
const BASE = (script?.src ? new URL('.', script.src) : new URL('/__gradier/', location.href)).toString();
const API = `${BASE}api`;
const LIBRARY_API = `${BASE}library`;
/** How long after the last edit mesh gradients are written to the file. */
const SAVE_DELAY = 500;

interface LibraryItem {
  id: string;
  gradient: Gradient;
  savedAt: number;
}

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
    expanded: false,
    quietHtml: false,
    exportScale: clamp(Number(storage('gradier:exportScale')) || 2, 1, 4),
  };
  let cancelPick: (() => void) | null = null;
  const history = new Map<string, { undo: string[]; redo: string[]; key?: string; at: number }>();
  /** Gradients edited in this session. Only these are auto-saved, so gradients the page registers itself stay put. */
  const touched = new Set<string>();
  let library: LibraryItem[] = [];
  let libraryRemote = false;

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
    segs: Map<string, HTMLButtonElement[]>;
    blend?: [HTMLInputElement, HTMLOutputElement];
    exportW?: HTMLElement;
    exportH?: HTMLElement;
    status?: HTMLElement;
    undo?: HTMLButtonElement;
    redo?: HTMLButtonElement;
  } = { rows: [], swatches: [], hexes: [], coords: [], sliders: new Map(), segs: new Map() };
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
    convert: (from) => void convertToMesh(from),
    library: () => library,
    swatch: (g) => gradientToCSS(g),
    quietHtml: () => state.quietHtml,
  });

  /**
   * Turn the element being edited in the CSS editor into a mesh gradient: a new gradient seeded from its CSS stops
   * (or a saved gradient), shown right away through a `data-gradier` layer, and written into the markup so it stays.
   */
  const convertToMesh = async (from?: Gradient) => {
    const el = css.targetEl as HTMLElement | null;
    if (!el) return;
    const points = from ? null : css.meshSeed();
    if (!from && !points) return toast("Couldn't read this gradient's colours", true);
    const at = css.sourceMatch;
    const replaces = css.pseudo || undefined;
    const base =
      (el.id || [...el.classList].find((c) => !c.startsWith('gradier')) || el.tagName.toLowerCase())
        .replace(/[^\w-]+/g, '-')
        .replace(/^[^a-zA-Z0-9]+/, '')
        .slice(0, 48) || 'gradient';
    let name = base;
    for (let n = 2; getGradient(name); n++) name = `${base}-${n}`;
    const g = normalizeGradient(from ? structuredClone(from) : { ...DEFAULTS, softness: 0.6, warp: 0.08, grain: 0.03, points });
    touched.add(name);
    setGradient(name, g);
    css.close();
    state.mode = 'mesh';
    state.selected = name;
    state.point = null;
    state.target = null;
    state.expanded = false;
    el.setAttribute(LAYER_ATTR, name);
    if (replaces) el.setAttribute(`${LAYER_ATTR}-replaces`, replaces);
    render();
    if (!state.connected) return toast(`"${name}" is a mesh gradient on this page. Add data-gradier="${name}" to the element to keep it.`, true);
    // Write the gradient first: changing the markup may reload the page.
    while (state.saving) await new Promise((r) => setTimeout(r, 50));
    await save();
    const runtime = (globalThis as unknown as Record<string, boolean | undefined>).__GRADIER_RUNTIME__;
    const needsRuntime = runtime ? '' : " Load the Gradier runtime on this page (import { registerGradients } from 'gradier') so it shows outside the editor.";
    try {
      const res = await fetch(`${BASE}markup/layer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          element: { tag: el.tagName.toLowerCase(), id: el.id, classes: [...el.classList], text: (el.textContent ?? '').trim().slice(0, 80), at, replaces },
        }),
      });
      const data = (await res.json()) as { file?: string; line?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast(`Now a mesh gradient · ${data.file}:${data.line}.${needsRuntime}`, !!needsRuntime);
    } catch (err) {
      toast(`"${name}" is a mesh gradient here, but ${err instanceof Error ? err.message : err} Add data-gradier="${name}" to the element to keep it.`, true);
    }
  };

  /** Enter pick mode: the next click on the page chooses which gradient to edit. */
  const pick = () => {
    if (cancelPick) return;
    if (!state.open) setOpen(true);
    state.expanded = false;
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

  /** `<gradier-gradient>` elements on the page (not the expanded view's own copy, which lives in our shadow root). */
  const namedElements = () =>
    [...mountedElements()].filter((el) => el.isConnected && el.getAttribute('name') && !shadow.contains(el)) as HTMLElement[];

  const changes = () => {
    const current = getGradients();
    const changed = Object.keys(current).filter((n) => touched.has(n) && canon(current[n]!) !== state.saved[n]);
    const deleted = Object.keys(state.saved).filter((n) => touched.has(n) && !(n in current));
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
    // After a reload, come back to the gradient you were editing.
    let last: string | null = null;
    try {
      last = sessionStorage.getItem('gradier:selected');
    } catch {}
    if (last && names.includes(last)) {
      state.selected = last;
      state.target = namedElements().find((el) => el.getAttribute('name') === last) ?? null;
      state.point = null;
      return;
    }
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
    touched.add(name);
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
    touched.add(name);
    setGradient(name, g);
  };

  // ---------- server ----------
  const load = async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { file: string; gradients: Record<string, Gradient>; quietHtml?: boolean };
      state.file = data.file;
      state.quietHtml = !!data.quietHtml;
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
    scheduleSave();
  };

  // Edits are written to the gradients file automatically, shortly after you stop changing things.
  let saveTimer = 0;
  let saveAgain = false;
  let saveFailed = false;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    if (!state.loaded || !state.connected || !changes().count) return;
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY);
  };

  const save = async (keepalive = false) => {
    clearTimeout(saveTimer);
    const { changed, deleted, count } = changes();
    if (!count || !state.connected) return;
    if (state.saving) return void (saveAgain = true);
    state.saving = true;
    patch(state.selected ? getGradient(state.selected) : undefined);
    try {
      const current = getGradients();
      const res = await fetch(API, {
        method: 'POST',
        keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: Object.fromEntries(changed.map((n) => [n, current[n]])), delete: deleted }),
      });
      const data = (await res.json()) as { file: string; gradients: Record<string, Gradient>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      state.file = data.file;
      state.saved = Object.fromEntries(Object.entries(data.gradients).map(([n, g]) => [n, canon(g)]));
      saveFailed = false;
    } catch (err) {
      // Don't retry in a loop; the next edit (or Ctrl/⌘+S) tries again.
      if (!saveFailed) toast(`Couldn't save: ${err instanceof Error ? err.message : err}`, true);
      saveFailed = true;
    } finally {
      state.saving = false;
      if (saveAgain) {
        saveAgain = false;
        scheduleSave();
      }
      render();
    }
  };

  // ---------- saved gradients (your library, shared across projects) ----------
  const loadLibrary = async () => {
    try {
      const res = await fetch(LIBRARY_API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { items: LibraryItem[] };
      library = data.items.map((i) => ({ ...i, gradient: normalizeGradient(i.gradient) }));
      libraryRemote = true;
    } catch {
      // Older or unreachable server: keep the library in this browser instead.
      try {
        const items = JSON.parse(storage('gradier:library') ?? '[]') as LibraryItem[];
        library = items.map((i) => ({ ...i, gradient: normalizeGradient(i.gradient) }));
      } catch {
        library = [];
      }
    }
    render();
  };

  const persistLibrary = async () => {
    storage('gradier:library', JSON.stringify(library));
    if (!libraryRemote) return;
    try {
      const res = await fetch(LIBRARY_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: library }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      toast(`Couldn't update saved gradients: ${err instanceof Error ? err.message : err}`, true);
    }
  };

  const saveToLibrary = () => {
    const g = state.selected ? getGradient(state.selected) : undefined;
    if (!g) return;
    const key = canon(g);
    if (library.some((i) => canon(i.gradient) === key)) return toast('Already in your saved gradients');
    library.unshift({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, gradient: structuredClone(g), savedAt: Date.now() });
    void persistLibrary();
    toast('Gradient saved');
    render();
  };

  const removeFromLibrary = (id: string) => {
    library = library.filter((i) => i.id !== id);
    void persistLibrary();
    render();
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
    touched.add(name);
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
    touched.add(from).add(to);
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
    if (!name || !window.confirm(`Delete gradient "${name}"? It's also removed from ${state.file || 'your gradients file'}.`)) return;
    touched.add(name);
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

  /** Set by mouse-initiated open/close so the next render animates; keyboard toggles stay instant. */
  let animateNext = false;

  const setOpen = (open: boolean, animate = false) => {
    animateNext = animate;
    state.open = open;
    storage('gradier:open', open ? '1' : '0');
    if (open) ensureSelection();
    render();
  };

  // ---------- panel ----------

  const sectionOpen = (id: string, fallback: boolean) => {
    const v = storage(`gradier:section:${id}`);
    return v === null ? fallback : v === '1';
  };

  /** A titled panel section. Collapsible ones remember their state per browser. */
  /**
   * A titled panel section. Collapsible ones toggle in place (no rebuild) so they can animate, and remember their
   * state per browser. `compact` sections don't hide their body when closed; they collapse everything except the
   * rows marked `.current` (used by the points list).
   */
  const section = (
    id: string,
    title: string,
    opts: { collapsible?: boolean; open?: boolean; actions?: Node[]; compact?: boolean; keepActions?: boolean },
    ...children: Array<Node | null | false>
  ) => {
    const open = !opts.collapsible || sectionOpen(id, opts.open ?? true);
    const chevron = h('span', { className: 'chev' });
    chevron.innerHTML = ICONS.chevron;
    const label = h(
      'div',
      { className: `label${opts.collapsible ? ' toggle' : ''}` },
      h('span', { className: 'grow' }, title),
      ...(opts.actions ?? []).map((a) => h('span', { className: `act${opts.keepActions ? ' keep' : ''}` }, a)),
      opts.collapsible ? chevron : null,
    );
    const body = h('div', { className: 'sbody' }, h('div', { className: 'sinner' }, ...children));
    const el = h('div', { className: `section${open ? '' : ' closed'}${opts.compact ? ' compact' : ''}` }, label, body);
    // Which parts are visible for a given open state: the whole body, or (compact) the rows that apply.
    const apply = (isOpen: boolean, animate: boolean) => {
      if (!opts.compact) return setShown(body, isOpen, animate);
      for (const wrap of body.querySelectorAll<HTMLElement>('.pwrap')) {
        const show = wrap.classList.contains('when-compact') ? !isOpen : wrap.classList.contains('when-open') ? isOpen : isOpen || wrap.classList.contains('current');
        setShown(wrap, show, animate);
      }
    };
    apply(open, false);
    if (opts.collapsible) {
      label.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const nowOpen = el.classList.toggle('closed') === false;
        apply(nowOpen, true);
        storage(`gradier:section:${id}`, nowOpen ? '1' : '0');
      });
    }
    return el;
  };

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  /**
   * Show or hide a block, animating its measured height and opacity (Web Animations API, so it is interruptible:
   * a second toggle mid-way continues from wherever it is).
   */
  const setShown = (el: HTMLElement, show: boolean, animate: boolean) => {
    el.inert = !show;
    if (!animate || !el.isConnected) return void el.classList.toggle('shut', !show);
    const from = el.getBoundingClientRect().height;
    const fromOpacity = getComputedStyle(el).opacity;
    el.getAnimations().forEach((a) => a.cancel());
    el.classList.toggle('shut', !show);
    const to = el.getBoundingClientRect().height;
    if (from === to && fromOpacity === (show ? '1' : '0')) return;
    const reduce = reducedMotion?.matches;
    el.animate(
      [
        { height: `${reduce ? to : from}px`, opacity: fromOpacity },
        { height: `${to}px`, opacity: show ? 1 : 0 },
      ],
      { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
  };

  /** A row in a compact section: collapses away (animated) unless it's `current` or the section is open. */
  const collapsible = (node: Node, cls = '') => h('div', { className: `pwrap ${cls}` }, h('div', { className: 'clip' }, node));

  const numValue = (g: Gradient, key: NumKey) => (key in LOOK_DEFAULTS ? look(g, key as LookNumKey) : g[key as BaseNumKey]);

  const sliderRow = (def: SliderDef) => {
    const out = h('output', {});
    const input = h('input', {
      type: 'range',
      min: def.min,
      max: def.max,
      step: def.step,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value) / (def.scale ?? 1);
        const node = def.scoped ? state.point : null;
        update((d) => {
          const target = node !== null ? d.points[node] : undefined;
          if (target) return void ((target as unknown as Record<string, number>)[def.key] = v);
          // No node selected: set it for the whole gradient and drop per-node overrides so it applies to all.
          (d as unknown as Record<string, number>)[def.key] = v;
          if (def.scoped) for (const p of d.points) delete (p as unknown as Record<string, unknown>)[def.key];
        }, `${def.key}-${node ?? 'all'}`);
      },
    });
    refs.sliders.set(def.key, [input, out]);
    return h('label', { className: 'slider' }, h('span', {}, def.label), input, out);
  };

  /** Value a slider shows: the selected node's own value for scoped controls, else the gradient's. */
  const sliderValue = (g: Gradient, def: SliderDef) => {
    const node = def.scoped && state.point !== null ? g.points[state.point] : undefined;
    if (node) {
      const own = (node as unknown as Record<string, number | undefined>)[def.key];
      if (own !== undefined) return own;
      return def.key === 'softness' ? g.softness : LOOK_DEFAULTS[def.key as LookNumKey];
    }
    return numValue(g, def.key);
  };

  /** "Node 3" or "All nodes": shows what the scoped controls in a section will change. */
  const scopeChip = () =>
    h('span', { className: `scope${state.point !== null ? ' node' : ''}` }, state.point !== null ? `Node ${state.point + 1}` : 'All nodes');

  /** Blend mode: a stepped field slider; drag (or use the arrow keys) to go through every mode. */
  const blendRow = () => {
    const out = h('output', {});
    const input = h('input', {
      type: 'range',
      min: 0,
      max: BLEND_MODES.length - 1,
      step: 1,
      'aria-label': 'Blend mode',
      oninput: (e: Event) => {
        const mode = BLEND_MODES[Number((e.target as HTMLInputElement).value)]![0];
        const node = state.point;
        update((d) => {
          const target = node !== null ? d.points[node] : undefined;
          if (target) return void (target.blendMode = mode);
          // No node selected: the whole gradient, clearing per-node modes so it really applies to all.
          d.blendMode = mode;
          for (const p of d.points) delete p.blendMode;
        }, `blendMode-${node ?? 'all'}`);
      },
    });
    refs.blend = [input, out];
    return h('label', { className: 'slider', title: 'Drag to go through the blend modes' }, h('span', {}, 'Blend mode'), input, out);
  };

  /** A row of toggle buttons; `refs.segs` lets `patch` mark the active one. */
  const segRow = (id: string, options: Array<[string, string]>, onPick: (value: string) => void) => {
    const buttons = options.map(([value, label]) => {
      const b = h('button', { type: 'button', onclick: () => onPick(value) }, label);
      b.dataset.value = value;
      return b;
    });
    refs.segs.set(id, buttons);
    return h('div', { className: 'seg' }, ...buttons);
  };

  /** Export the selected gradient as an image at the element's size × the chosen scale. */
  const exportImage = async (kind: 'png' | 'jpeg' | 'copy') => {
    const name = state.selected;
    const g = name ? getGradient(name) : undefined;
    if (!name || !g) return;
    const { w, h: height } = exportSize();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = height;
    const renderer = MeshRenderer.create(canvas);
    if (!renderer) return toast('Export needs WebGL', true);
    renderer.setGradient(g);
    renderer.setPixelScale(state.exportScale);
    renderer.render();
    const type = kind === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, 0.92),
    );
    try {
      if (kind === 'copy') {
        // Hand the clipboard a promise so Safari keeps the user gesture.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(`Copied ${w}×${height} PNG`);
      } else {
        const url = URL.createObjectURL(await blob);
        const a = h('a', { href: url, download: `${name}@${state.exportScale}x.${kind === 'jpeg' ? 'jpg' : 'png'}` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast(`Exported ${w}×${height} ${kind === 'jpeg' ? 'JPG' : 'PNG'}`);
      }
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      renderer.destroy();
    }
  };

  const MAX_EXPORT = 8192;
  const exportSize = () => {
    const el = state.expanded ? namedElements().find((x) => x.getAttribute('name') === state.selected) : state.target;
    const r = el?.getBoundingClientRect();
    const baseW = r && r.width ? r.width : 1200;
    const baseH = r && r.height ? r.height : 800;
    const s = Math.min(state.exportScale, MAX_EXPORT / Math.max(baseW, baseH));
    return { w: Math.max(1, Math.round(baseW * s)), h: Math.max(1, Math.round(baseH * s)) };
  };

  const buildPanel = (g: Gradient | undefined) => {
    refs = { rows: [], swatches: [], hexes: [], coords: [], sliders: new Map(), segs: new Map() };
    const names = Object.keys(getGradients());
    const onPage = new Set(namedElements().map((el) => el.getAttribute('name')));
    const sep = () => h('span', { className: 'head-sep' });

    refs.undo = button('icon ghost', ICONS.undo, `Undo (${MOD}Z)`, () => (state.mode === 'css' ? css.undo(false) : undo()));
    refs.redo = button('icon ghost', ICONS.redo, `Redo (${MOD}Shift+Z)`, () => (state.mode === 'css' ? css.undo(true) : undo(true)));
    const head = h(
      'div',
      { className: 'head' },
      state.mode === 'css' && Object.keys(getGradients()).length
        ? button('icon ghost', ICONS.back, 'Back to mesh gradients', () => {
            if (css.close()) state.mode = 'mesh';
            render();
          })
        : h('span', { className: 'logo' }),
      h('span', { className: 'title' }, state.mode === 'css' ? 'CSS gradient' : 'Gradier'),
      state.mode === 'mesh' ? refs.undo : null,
      state.mode === 'mesh' ? refs.redo : null,
      state.mode === 'mesh' ? sep() : null,
      button(`icon ghost${cancelPick ? ' on' : ''}`, ICONS.pick, 'Pick any gradient on the page (Alt+P)', pick),
      canExpand(g)
        ? button(
            `icon ghost${state.expanded ? ' on' : ''}`,
            state.expanded ? ICONS.collapse : ICONS.expand,
            state.expanded ? 'Back to the page (F)' : 'Expand to edit at full size (F)',
            () => setExpanded(!state.expanded, true),
          )
        : null,
      button('icon ghost', ICONS.dock, 'Move panel to other side', () => {
        state.dock = state.dock === 'right' ? 'left' : 'right';
        storage('gradier:dock', state.dock);
        render();
      }),
      sep(),
      button('icon ghost', ICONS.close, 'Close (Alt+G)', () => setOpen(false, true)),
    );
    const panelClass = `panel${state.dock === 'left' ? ' left' : ''}`;

    if (state.mode === 'css') {
      const { body, foot } = css.build();
      return h('div', { className: panelClass }, head, body, foot);
    }

    const body = h('div', { className: 'body' });

    if (!state.connected && state.loaded) {
      body.append(h('div', { className: 'hint warn' }, `Can't reach the save server (${API}). You can still edit, but saving won't work.`));
    }

    const picker = h(
      'select',
      { className: 'grow', onchange: (e: Event) => select((e.target as HTMLSelectElement).value) },
      ...names.map((n) => h('option', { value: n, selected: n === state.selected }, onPage.has(n) ? n : `${n}  (not on page)`)),
    );
    body.append(
      section(
        'gradient',
        'Gradient',
        {},
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
        section(
          'start',
          'Get started',
          {},
          h('div', { className: 'hint' }, 'Edit any CSS gradient already on this page:'),
          h('button', { className: 'btn primary', type: 'button', onclick: pick }, 'Pick a gradient on the page'),
          h('div', { className: 'hint' }, 'Or add a mesh gradient: put this in your markup, then create a gradient with the same name.'),
          h('div', { className: 'code' }, '<gradier-gradient name="hero"></gradier-gradient>'),
          h('button', { className: 'btn', type: 'button', onclick: () => create() }, 'Create mesh gradient'),
        ),
      );
    } else {
      // Saved gradients
      const saved = h('div', { className: 'presets' });
      for (const item of library) {
        const apply = h('button', { className: 'preset', type: 'button', title: 'Apply this saved gradient', onclick: () => update(() => structuredClone(item.gradient)) });
        apply.style.background = gradientToCSS(item.gradient);
        const del = button('remove', ICONS.close, 'Remove from saved gradients', () => removeFromLibrary(item.id));
        saved.append(h('div', { className: 'saved' }, apply, del));
      }
      body.append(
        section(
          'library',
          `Saved  ${library.length}`,
          {
            actions: [h('button', { className: 'btn small', type: 'button', title: 'Save this gradient to reuse it in any project', onclick: saveToLibrary }, '+ Save')],
          },
          library.length ? saved : h('div', { className: 'hint' }, 'Gradients you save show up here, in every project. Select any gradient, then click one to apply it.'),
        ),
      );

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
        refs.swatches[i] = color;
        refs.hexes[i] = hex;
        refs.coords[i] = coords;
        const kind = p.shape ? { line: 'Line', arc: 'Arc', path: 'Stroke' }[p.shape.type] : '';
        const row = h(
          'div',
          {
            className: 'point',
            title: kind ? `${kind} point` : 'Point',
            onpointerdown: () => {
              if (state.point === i) return;
              state.point = i;
              render();
            },
          },
          h('label', { className: 'swatch' }, color),
          hex,
          coords,
          button('icon ghost small', ICONS.trash, 'Remove point', () => removePoint(i)),
        );
        refs.rows[i] = row;
        list.append(collapsible(row, state.point === i ? 'current' : ''));
      });
      if (state.point === null) {
        list.append(
          collapsible(
            h('div', { className: 'hint' }, 'No node selected: controls marked “All nodes” change every node. Click a node to edit just that one.'),
            'when-compact',
          ),
        );
      }
      body.append(
        section(
          'points',
          `Points  ${g.points.length}/${MAX_POINTS}`,
          {
            collapsible: true,
            open: false,
            compact: true,
            actions: [h('button', { className: 'btn small', type: 'button', onclick: () => addPoint() }, '+ Add')],
          },
          list,
          collapsible(h('div', { className: 'hint' }, 'Drag the handles on the page. Use the toolbar below to add nodes, lines, arcs and strokes.'), 'when-open'),
        ),
        section('blend', 'Blend', { collapsible: true, actions: [scopeChip()] }, sliderRow(BLEND_SLIDERS[0]!), blendRow(), ...BLEND_SLIDERS.slice(1).map(sliderRow)),
        section(
          'grain',
          'Grain',
          { collapsible: true },
          segRow('grainType', [['mono', 'Mono'], ['duo', 'Duo'], ['multi', 'Multi']], (v) =>
            update((d) => void (d.grainType = v as GrainType)),
          ),
          ...GRAIN_SLIDERS.map(sliderRow),
        ),
        section(
          'filter',
          'Filter',
          {
            collapsible: true,
            actions: [
              scopeChip(),
              button('icon ghost small', ICONS.reset, state.point !== null ? 'Reset this node\'s filters' : 'Reset filters for all nodes', () =>
                update((d) => {
                  const node = state.point !== null ? d.points[state.point] : undefined;
                  const targets: object[] = node ? [node] : [d, ...d.points];
                  for (const t of targets) for (const def of FILTER_SLIDERS) delete (t as Record<string, unknown>)[def.key];
                }),
              ),
            ],
          },
          ...FILTER_SLIDERS.map(sliderRow),
        ),
      );

      // Presets
      const presets = h('div', { className: 'presets' });
      for (const [name, preset] of Object.entries(PRESETS)) {
        const b = h('button', { className: 'preset', type: 'button', title: name, onclick: () => update(() => structuredClone(preset)) });
        b.style.background = gradientToCSS(preset);
        presets.append(b);
      }
      body.append(
        section(
          'presets',
          'Presets',
          { collapsible: true, open: false },
          presets,
          h(
            'div',
            { className: 'row' },
            h('button', { className: 'btn grow', type: 'button', onclick: () => update((d) => ({ ...randomGradient(d.points.length), ...blendOf(d) })) }, 'Randomize'),
            h('button', { className: 'btn grow', type: 'button', onclick: shuffleColors }, 'Shuffle colors'),
          ),
        ),
      );

      // Export
      refs.exportW = h('div', { className: 'field readonly' });
      refs.exportH = h('div', { className: 'field readonly' });
      body.append(
        section(
          'export',
          'Export',
          { collapsible: true },
          h('div', { className: 'row' }, refs.exportW, refs.exportH),
          segRow('scale', [['1', '1×'], ['2', '2×'], ['3', '3×'], ['4', '4×']], (v) => {
            state.exportScale = Number(v);
            storage('gradier:exportScale', v);
            patch(getGradient(state.selected!));
          }),
          h(
            'div',
            { className: 'row' },
            h('button', { className: 'btn action grow', type: 'button', onclick: () => void exportImage('jpeg') }, 'JPG'),
            h('button', { className: 'btn action grow', type: 'button', onclick: () => void exportImage('png') }, 'PNG'),
            h('button', { className: 'btn action grow', type: 'button', title: 'Copy as PNG image', onclick: () => void exportImage('copy') }, 'Copy'),
          ),
        ),
      );

      // Use
      const name = state.selected;
      body.append(
        section(
          'use',
          'Use in code',
          { collapsible: true, open: false },
          onPage.has(name) ? null : h('div', { className: 'hint' }, `"${name}" isn't on this page yet. Drop this where you want it:`),
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

    refs.status = h('span', { className: 'status' });
    const foot = h('div', { className: 'foot' }, refs.status);

    return h('div', { className: panelClass }, head, body, foot);
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
        if (refs.coords[i]) refs.coords[i]!.textContent = `${Math.round(p.x * 100)}, ${Math.round(p.y * 100)}`;
      });
      for (const def of ALL_SLIDERS) {
        const pair = refs.sliders.get(def.key);
        if (!pair) continue;
        const [input, out] = pair;
        const v = sliderValue(g, def) * (def.scale ?? 1);
        if (shadow.activeElement !== input) input.value = String(v);
        out.value = v.toFixed(def.digits);
      }
      if (refs.blend) {
        const node = state.point !== null ? g.points[state.point] : undefined;
        const idx = BLEND_MODES.findIndex(([m]) => m === (node?.blendMode ?? look(g, 'blendMode')));
        if (shadow.activeElement !== refs.blend[0]) refs.blend[0].value = String(idx);
        refs.blend[1].value = BLEND_MODES[idx]![1];
      }
      const active: Record<string, string> = { grainType: look(g, 'grainType'), scale: String(state.exportScale) };
      for (const [id, buttons] of refs.segs) for (const b of buttons) b.classList.toggle('on', b.dataset.value === active[id]);
      if (refs.exportW && refs.exportH) {
        const { w, h: height } = exportSize();
        refs.exportW.innerHTML = `<span>W</span>${w}`;
        refs.exportH.innerHTML = `<span>H</span>${height}`;
      }
    }
    const { count } = changes();
    if (refs.status) {
      const warn = !state.connected || (saveFailed && count > 0);
      refs.status.className = `status${warn ? ' dirty' : ''}`;
      refs.status.textContent = !state.loaded
        ? 'Connecting…'
        : !state.connected
          ? 'Not connected · changes stay on this page'
          : state.saving || (count && !saveFailed)
            ? 'Saving…'
            : count
              ? `Not saved · ${MOD}S to retry`
              : `Saved · ${state.file}`;
      refs.status.title = state.file;
    }
    const entry = state.selected ? history.get(state.selected) : undefined;
    if (refs.undo) refs.undo.disabled = !entry?.undo.length;
    if (refs.redo) refs.redo.disabled = !entry?.redo.length;
  };

  /** Animate an element in from its `.from` state (CSS defines the transition and the hidden pose). */
  const enter = (el: HTMLElement) => {
    el.classList.add('from');
    void el.offsetWidth;
    el.classList.remove('from');
  };
  /** Animate to the `.from` pose, then remove — unless something brought it back in the meantime. */
  const leave = (el: HTMLElement) => {
    el.classList.add('from');
    setTimeout(() => el.classList.contains('from') && el.remove(), 300);
  };

  /** Transform that maps rect `to` onto rect `from` (with transform-origin 0 0). */
  const mapRect = (from: DOMRect, to: DOMRect) =>
    `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / Math.max(to.width, 1)}, ${from.height / Math.max(to.height, 1)})`;
  const visible = (r: DOMRect | undefined): r is DOMRect => !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;

  /**
   * Grow `el` out of the rect `from` (or shrink it back into it when `out`), as one shape changing size and place.
   * Reduced motion keeps only the fade. Returns the animation so callers can remove the element when it ends.
   */
  const morph = (el: HTMLElement, from: DOMRect | undefined, opts: { out?: boolean; duration: number; fade: boolean }) => {
    const to = el.getBoundingClientRect();
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transformOrigin = '0 0';
    const small = visible(from) && !reducedMotion?.matches ? mapRect(from, to) : reducedMotion?.matches ? 'none' : 'scale(0.96)';
    const fadeAt = opts.out ? 0.6 : 0.35;
    const frames: Keyframe[] = opts.fade
      ? [{ transform: small, opacity: 0 }, { opacity: 1, offset: fadeAt }, { transform: 'none', opacity: 1 }]
      : [{ transform: small }, { transform: 'none' }];
    if (opts.out) frames.reverse().forEach((f) => f.offset !== undefined && (f.offset = 1 - (f.offset as number)));
    return el.animate(frames, { duration: opts.duration, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: opts.out ? 'forwards' : 'none' });
  };

  const render = () => {
    // Reduced motion still animates: the CSS swaps movement for a plain fade.
    const animate = animateNext;
    animateNext = false;
    const count = changes().count;
    if (!state.open) {
      cancelPick?.();
      cancelPick = null;
      state.expanded = false;
      syncExpand(undefined, animate);
      css.clearStage();
      const closing = panel;
      panel = null;
      structure = '';
      if (!launcher) {
        launcher = h('button', { className: 'launcher', type: 'button', title: 'Open Gradier (Alt+G)', onclick: () => setOpen(true, true) });
        launcher.style.pointerEvents = 'auto';
        root.append(launcher);
        // The pill reappears as the panel lands in it.
        if (animate && closing) launcher.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: 140, easing: 'ease-out', fill: 'backwards' });
        else if (animate) enter(launcher);
      }
      launcher.innerHTML = `<span class="logo"></span>Gradier${count ? '<span class="dot"></span>' : ''}`;
      if (closing) {
        if (animate) morph(closing, launcher.getBoundingClientRect(), { out: true, duration: 240, fade: true }).finished.then(() => closing.remove(), () => {});
        else closing.remove();
      }
      animate ? leave(toolbar.el) : toolbar.el.remove();
      stage.replaceChildren();
      overlays.clear();
      clearHandles();
      return;
    }
    const launchRect = launcher?.getBoundingClientRect();
    if (launcher) animate ? leave(launcher) : launcher.remove();
    launcher = null;
    if (state.mode === 'css' && !css.active) state.mode = 'mesh';
    ensureSelection();
    try {
      if (state.selected) sessionStorage.setItem('gradier:selected', state.selected);
    } catch {}
    const g = state.selected ? getGradient(state.selected) : undefined;
    const key = [
      state.mode,
      !!cancelPick,
      state.mode === 'css' ? css.structureKey() : '',
      state.selected,
      state.point,
      state.dock,
      state.expanded,
      library.map((i) => i.id).join(','),
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
      const opening = !panel;
      panel ? panel.replaceWith(next) : root.append(next);
      panel = next;
      if (opening && animate) morph(panel, launchRect, { duration: 280, fade: true });
      panel.querySelector('.body')!.scrollTop = scroll;
    }
    const showToolbar = state.mode === 'mesh' && !cancelPick && !!g;
    if (showToolbar) {
      if (!toolbar.el.isConnected) {
        root.append(toolbar.el);
        if (animate) enter(toolbar.el);
      } else toolbar.el.classList.remove('from');
      toolbar.patch({ tool: state.tool, handlesHidden: state.handlesHidden });
    } else toolbar.el.remove();
    syncExpand(g, animate);
    if (state.mode === 'css') css.patch();
    else patch(g);
  };

  // ---------- expanded view ----------
  // Shows the selected gradient large in the middle of the screen so it can be edited without being limited by its size
  // on the page. It keeps the element's aspect ratio, so what you see matches the real thing.
  let expandLayer: HTMLElement | null = null;
  let expandBox: HTMLElement | null = null;
  let expandKind: 'mesh' | 'css' | null = null;
  let expandAspect = 16 / 10;

  const canExpand = (g: Gradient | undefined) => !cancelPick && (state.mode === 'css' ? css.active : !!g);

  const setExpanded = (on: boolean, animate = false) => {
    animateNext = animate;
    state.expanded = on;
    render();
  };

  const syncExpand = (g: Gradient | undefined, animate: boolean) => {
    if (state.expanded && !(state.open && canExpand(g))) state.expanded = false;
    const kind = state.expanded ? state.mode : null;
    if (expandLayer && kind !== expandKind) {
      const old = expandLayer;
      const box = expandBox!;
      if (animate && !kind) {
        // Shrink back into the element on the page.
        const home = expandKind === 'css' ? css.targetEl : namedElements().find((el) => el.getAttribute('name') === state.selected);
        const r = home?.getBoundingClientRect();
        const back = old.querySelector<HTMLElement>('.backdrop')!;
        back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
        old.style.pointerEvents = 'none';
        morph(box, r, { out: true, duration: 240, fade: !visible(r) }).finished.then(() => old.remove(), () => old.remove());
      } else old.remove();
      expandLayer = expandBox = null;
      css.setExpandEl(null);
    }
    expandKind = kind;
    if (!kind) return;
    if (!expandLayer) {
      const source = kind === 'css' ? css.targetEl : namedElements().find((el) => el.getAttribute('name') === state.selected);
      const r = source?.getBoundingClientRect();
      expandAspect = r && r.width > 0 && r.height > 0 ? clamp(r.width / r.height, 0.2, 5) : 16 / 10;
      expandBox = kind === 'css' ? h('div', {}) : (document.createElement('gradier-gradient') as HTMLElement);
      expandBox.className = 'expand-box';
      if (kind === 'mesh') {
        // Same gestures as on the page: click empty space to deselect, double-click to add a node.
        expandBox.addEventListener('pointerdown', (e) => {
          if (e.target === expandBox && state.point !== null) {
            state.point = null;
            render();
          }
        });
        expandBox.addEventListener('dblclick', (e) => {
          const el = expandBox!;
          const rect = el.getBoundingClientRect();
          const at = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
          addPoint(at.x, at.y, sampleColor(el, at) ?? undefined);
        });
      }
      const backdrop = h('div', { className: 'backdrop', title: 'Click to go back to the page', onclick: () => setExpanded(false, true) });
      expandLayer = h('div', { className: 'expand' }, backdrop, expandBox);
      root.insertBefore(expandLayer, stage);
      if (kind === 'css') css.setExpandEl(expandBox);
      layoutExpand();
      if (animate) {
        // Grow out of the element's spot on the page into the middle of the screen.
        expandLayer.querySelector<HTMLElement>('.backdrop')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        morph(expandBox, visible(r) ? r : undefined, { duration: 280, fade: !visible(r) });
      }
    }
    if (kind === 'mesh' && state.selected && expandBox!.getAttribute('name') !== state.selected) expandBox!.setAttribute('name', state.selected);
  };

  /** Fit the expanded box into the space beside the panel and above the toolbar. */
  const layoutExpand = () => {
    if (!expandBox) return;
    const panelW = panel ? panel.offsetWidth + 12 : 0;
    const margin = innerWidth < 700 ? 16 : 48;
    const top = 56;
    const bottom = 96;
    const availW = Math.max(innerWidth - panelW - margin * 2, 120);
    const availH = Math.max(innerHeight - top - bottom, 120);
    let w = availW;
    let height = w / expandAspect;
    if (height > availH) {
      height = availH;
      w = height * expandAspect;
    }
    const left = (state.dock === 'left' ? panelW : 0) + margin + (availW - w) / 2;
    Object.assign(expandBox.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top + (availH - height) / 2)}px`,
      width: `${Math.round(w)}px`,
      height: `${Math.round(height)}px`,
    });
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
  /** End circles are drawn at this fraction of the point's area so they read as "width at this end". */
  const END_SCALE = 0.5;

  const curveEnds = (sh: PointShape): [Rel, Rel] =>
    sh.type === 'path' ? [sh.points[0]!, sh.points[sh.points.length - 1]!] : [sh.a, sh.b];

  /** The middle of a freehand stroke (by on-screen length), where its colour handle sits. */
  const pathMid = (points: Rel[], r: { width: number; height: number }): Rel => {
    const smooth = samplePath(points.map((q) => ({ x: q.x * r.width, y: q.y * r.height })), 64);
    const m = pointAlong(smooth, 0.5);
    return { x: m.x / r.width, y: m.y / r.height };
  };

  const unitOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { r, unit: Math.sqrt(Math.max(r.width * r.height, 1)) };
  };

  const onColorHandle = (e: PointerEvent, i: number) =>
    startDrag(e, `h:${i}`, i, (rel) =>
      editPoint(i, 'move', (p) => {
        if (p.shape && p.shape.type !== 'arc') translatePoint(p, rel.x - p.x, rel.y - p.y);
        else {
          p.x = rel.x;
          p.y = rel.y;
        }
      }),
    );

  const onEndpoint = (e: PointerEvent, i: number, end: 'a' | 'b') => {
    // Freehand strokes bend from the original shape, so remember it at drag start.
    const start = state.selected ? getGradient(state.selected)?.points[i]?.shape : undefined;
    const original = start?.type === 'path' ? structuredClone(start.points) : null;
    startDrag(e, `ep:${i}:${end}`, i, (rel) =>
      editPoint(i, `end-${end}`, (p, el) => {
        const sh = p.shape;
        if (!sh) return;
        if (sh.type === 'path') {
          if (!original) return;
          const from = end === 'a' ? original[0]! : original[original.length - 1]!;
          const { r } = unitOf(el);
          const px = original.map((q) => ({ x: q.x * r.width, y: q.y * r.height }));
          sh.points = bendPath(px, end, (rel.x - from.x) * r.width, (rel.y - from.y) * r.height).map((q) => ({
            x: q.x / r.width,
            y: q.y / r.height,
          }));
          Object.assign(p, pathMid(sh.points, r));
          return;
        }
        sh[end] = rel;
        if (sh.type === 'line') {
          p.x = (sh.a.x + sh.b.x) / 2;
          p.y = (sh.a.y + sh.b.y) / 2;
        }
      }),
    );
  };

  /** Drag a curve end's grip to make the colour wider or narrower at that end. */
  const onEndGrip = (e: PointerEvent, i: number, end: 'a' | 'b') =>
    startDrag(e, `egrip:${i}:${end}`, i, (rel) =>
      editPoint(i, `ends-${end}`, (p, el) => {
        const sh = p.shape;
        if (!sh) return;
        const { r, unit } = unitOf(el);
        const at = curveEnds(sh)[end === 'a' ? 0 : 1];
        const dist = Math.hypot((rel.x - at.x) * r.width, (rel.y - at.y) * r.height);
        sh[end === 'a' ? 'ra' : 'rb'] = clamp(dist / (END_SCALE * AREA_RADIUS * (p.radius ?? 1) * unit), 0.1, MAX_RADIUS);
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
    const length = cumulative(samples.map(px)).at(-1)!;
    if ((tool === 'pencil' ? length : chord) < 8) return;
    let shape: PointShape;
    let mid: Rel;
    if (tool === 'line') {
      shape = { type: 'line', a, b };
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (tool === 'arc') {
      shape = { type: 'arc', a, b };
      mid = rel(defaultBulge(px(a), px(b)));
    } else {
      // Pencil: keep the stroke itself, thinned to control points a few pixels apart.
      const points = simplifyStroke(samples.map(px), 6, MAX_PATH_POINTS).map(rel);
      shape = { type: 'path', points };
      mid = pathMid(points, r);
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

  /** A dashed circle with a curved grip on its rim (between angles `from`–`to`, degrees, clockwise from 3 o'clock). */
  const ring = (key: string, gripKey: string, c: Rel, R: number, from: number, to: number, onDown: (e: PointerEvent) => void, title: string) => {
    const circle = svgEl(key, 'circle', 'area');
    circle.setAttribute('cx', `${c.x}`);
    circle.setAttribute('cy', `${c.y}`);
    circle.setAttribute('r', `${Math.max(R, 1)}`);
    const gr = Math.max(R, 1) + 5;
    const a0 = (from * Math.PI) / 180;
    const a1 = (to * Math.PI) / 180;
    const d = `M ${c.x + gr * Math.cos(a0)} ${c.y + gr * Math.sin(a0)} A ${gr} ${gr} 0 0 1 ${c.x + gr * Math.cos(a1)} ${c.y + gr * Math.sin(a1)}`;
    svgEl(gripKey, 'path', `grip${dragKey === gripKey ? ' on' : ''}`).setAttribute('d', d);
    const hit = get(`${gripKey}:hit`, () => {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('class', 'grip-hit');
      el.appendChild(document.createElementNS(SVG_NS, 'title')).textContent = title;
      el.addEventListener('pointerdown', (e) => onDown(e as PointerEvent));
      return el;
    }, svg);
    hit.setAttribute('d', d);
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
          const sh = sel.shape;
          const pts =
            sh.type === 'path'
              ? samplePath(sh.points.map(toPx), 96)
              : sh.type === 'arc'
                ? arcSamples(toPx(sh.a), c, toPx(sh.b))
                : [toPx(sh.a), toPx(sh.b)];
          svgEl(`curve:${i}`, 'polyline', 'curve').setAttribute('points', polyline(pts));
        }
        // Area circle + resize grip.
        const R = AREA_RADIUS * (sel.radius ?? 1) * unit;
        ring(`area:${i}`, `grip:${i}`, c, R, 15, 65, (e) => onGrip(e, i), 'Drag to expand or shrink the area');
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
          const sh = sel.shape;
          const [a, b] = curveEnds(sh).map(toPx) as [Rel, Rel];
          const bend = sh.type === 'path' ? 'Drag to bend the stroke from this end' : 'Drag to move this end';
          // Freehand strokes also get a width circle at each end.
          if (sh.type === 'path') {
            ring(`earea:${i}:a`, `egrip:${i}:a`, a, END_SCALE * R * (sh.ra ?? 1), 60, 120, (e) => onEndGrip(e, i, 'a'), 'Drag to change the width at this end');
            ring(`earea:${i}:b`, `egrip:${i}:b`, b, END_SCALE * R * (sh.rb ?? 1), 60, 120, (e) => onEndGrip(e, i, 'b'), 'Drag to change the width at this end');
          }
          knob(`ep:${i}:a`, 'knob end', a.x, a.y, (e) => onEndpoint(e, i, 'a'), bend);
          knob(`ep:${i}:b`, 'knob end', b.x, b.y, (e) => onEndpoint(e, i, 'b'), bend);
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
            : p.shape?.type === 'path'
            ? `${p.color} · drag to move the stroke, Delete to remove`
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
    layoutExpand();
    if (state.mode === 'css') {
      for (const o of overlays.values()) o.frame.remove(), o.chip.remove();
      overlays.clear();
      clearHandles();
      css.positionStage();
      return;
    }
    css.clearStage();
    // While expanded, the handles live on the big copy and the page's own frames are hidden.
    const els = state.expanded && expandBox ? [expandBox] : namedElements();
    const selected = state.selected;
    if (!state.target?.isConnected || !els.includes(state.target) || state.target.getAttribute('name') !== selected) {
      state.target = els.find((el) => el.getAttribute('name') === selected) ?? null;
    }
    const seen = new Set<HTMLElement>();
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      seen.add(el);
      if (el === expandBox) continue;
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

  // Clicking anywhere on the page that isn't one of Gradier's own controls deselects the node.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!state.open || state.mode !== 'mesh' || state.point === null || cancelPick) return;
      if (e.composedPath().includes(host)) return;
      state.point = null;
      render();
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
        return setOpen(!state.open, true);
      }
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        return pick();
      }
      if (!state.open || cancelPick) return;
      const target = e.composedPath()[0];
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod && !e.altKey && e.key.toLowerCase() === 'f' && !isTextField(target)) {
        const g = state.selected ? getGradient(state.selected) : undefined;
        if (state.expanded || canExpand(g)) {
          e.preventDefault();
          return setExpanded(!state.expanded, true);
        }
      }
      if (e.key === 'Escape' && state.expanded && !isTextField(target)) {
        e.preventDefault();
        return setExpanded(false, true);
      }
      if (state.mode === 'css') {
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          css.flush();
        } else if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') && !isTextField(target)) {
          e.preventDefault();
          css.undo(e.shiftKey || e.key.toLowerCase() === 'y');
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && css.selectedStop !== null && !isTextField(target)) {
          e.preventDefault();
          css.removeSelectedStop();
        } else if (e.key === 'Escape' && !isTextField(target)) {
          if (!css.deselect()) setOpen(false, true);
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
        } else setOpen(false, true);
      }
    },
    true,
  );

  // Leaving the page: write anything still waiting for its save delay.
  window.addEventListener('pagehide', () => {
    if (changes().count) void save(true);
    css.flush();
  });

  subscribe(() => {
    scheduleRender();
    scheduleSave();
  });
  render();
  requestAnimationFrame(loop);
  void load();
  void loadLibrary();
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
