import { findGradients, type TextRange } from '../core/css-gradient';
import { TAG } from '../core/element';
import { h } from './dom';

export type Pseudo = '' | '::before' | '::after';

export type PickResult =
  | { kind: 'mesh'; el: HTMLElement; name: string }
  | { kind: 'css'; el: Element; pseudo: Pseudo; computed: string; layers: TextRange[] };

/** A short human label for an element, e.g. `section.hero::before`. */
export function describe(el: Element, pseudo: Pseudo = ''): string {
  const id = el.id ? `#${el.id}` : '';
  const classes = [...el.classList]
    .filter((c) => !c.startsWith('gradier'))
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  return `${el.tagName.toLowerCase()}${id}${classes}${pseudo}`;
}

/** The gradient(s) an element (or one of its pseudo-elements) paints, if any. */
export function gradientOf(el: Element): PickResult | null {
  if (el.tagName.toLowerCase() === TAG) {
    const name = el.getAttribute('name');
    if (name) return { kind: 'mesh', el: el as HTMLElement, name };
  }
  for (const pseudo of ['', '::before', '::after'] as Pseudo[]) {
    const cs = getComputedStyle(el, pseudo || null);
    if (pseudo && (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none')) continue;
    const computed = cs.backgroundImage;
    if (!computed || !computed.includes('gradient(')) continue;
    const layers = findGradients(computed);
    if (layers.length) return { kind: 'css', el, pseudo, computed, layers };
  }
  return null;
}

/** Topmost gradient under the pointer, ignoring Gradier's own UI. */
export function gradientAt(x: number, y: number, host: Element): PickResult | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host || host.contains(el) || el === document.documentElement) continue;
    const g = gradientOf(el);
    if (g) return g;
  }
  return null;
}

/**
 * Let the user click any gradient on the page. Returns a cancel function.
 * The page underneath doesn't receive the click.
 */
export function startPicker(stage: HTMLElement, host: Element, onPick: (r: PickResult | null) => void): () => void {
  const shield = h('div', { className: 'shield' });
  const box = h('div', { className: 'pick-box' });
  const label = h('div', { className: 'pick-label' });
  const tip = h('div', { className: 'pick-tip' }, 'Click a gradient to edit it · Esc to cancel');
  stage.append(shield, box, label, tip);
  let current: PickResult | null = null;
  let frame = 0;
  let last = { x: -1, y: -1 };

  const show = () => {
    frame = 0;
    current = gradientAt(last.x, last.y, host);
    if (!current) {
      box.style.display = label.style.display = 'none';
      shield.style.cursor = 'not-allowed';
      return;
    }
    shield.style.cursor = 'crosshair';
    const r = current.el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    label.textContent =
      current.kind === 'mesh'
        ? `${describe(current.el)} · mesh "${current.name}"`
        : `${describe(current.el, current.pseudo)} · ${current.layers.map((l) => l.text.slice(0, l.text.indexOf('('))).join(', ')}`;
    Object.assign(label.style, { display: 'block', left: `${Math.max(4, r.left)}px`, top: `${Math.max(4, r.top - 26)}px` });
  };

  const move = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(show);
  };
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    last = { x: e.clientX, y: e.clientY };
    show();
    if (current) finish(current);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    }
  };
  const finish = (r: PickResult | null) => {
    cancel();
    onPick(r);
  };
  const cancel = () => {
    cancelAnimationFrame(frame);
    shield.remove();
    box.remove();
    label.remove();
    tip.remove();
    window.removeEventListener('keydown', key, true);
  };

  shield.addEventListener('pointermove', move);
  shield.addEventListener('click', click);
  shield.addEventListener('wheel', () => requestAnimationFrame(show), { passive: true });
  window.addEventListener('keydown', key, true);
  return cancel;
}
