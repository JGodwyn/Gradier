import { gradientToCSS } from './css';
import { MeshRenderer } from './renderer';
import { getGradient, mountedElements, subscribe } from './store';
import { normalizeGradient, type Gradient } from './types';

export const TAG = 'gradier-gradient';

export interface GradierElement extends HTMLElement {
  /** Inline gradient data. Takes precedence over the `name` lookup. */
  gradient: Gradient | undefined;
  /** The gradient currently being drawn. */
  readonly resolved: Gradient | undefined;
  /** Force a re-render (e.g. after mutating the gradient object in place). */
  refresh(): void;
}

const STYLE = `
:host { display: block; position: relative; isolation: isolate; overflow: hidden; }
:host([hidden]) { display: none; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: -1; pointer-events: none; }
`;

/** Attribute that puts a mesh gradient behind any element: `<div data-gradier="hero">`. */
export const LAYER_ATTR = 'data-gradier';
/** Marks the `<gradier-gradient>` the runtime inserts as that element's background layer. */
export const LAYER_MARK = 'data-gradier-layer';

/**
 * Keep a `<gradier-gradient>` background layer inside every element with `data-gradier="name"`. The layer sits
 * behind the element's content (the element becomes its own stacking context) and follows its rounded corners.
 * Lets any existing element become a mesh gradient without changing its tag. Safe to call more than once.
 */
export function attachGradientLayers(): void {
  if (typeof document === 'undefined') return;
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g.__GRADIER_LAYERS__) return;
  g.__GRADIER_LAYERS__ = true;

  // A mesh converted from a ::before/::after gradient replaces that gradient.
  const style = document.createElement('style');
  style.setAttribute('data-gradier-runtime', '');
  style.textContent = `[${LAYER_ATTR}-replaces~="before"]::before,[${LAYER_ATTR}-replaces~="after"]::after{background-image:none!important}`;
  (document.head ?? document.documentElement).append(style);

  const sync = (host: HTMLElement) => {
    const name = host.getAttribute(LAYER_ATTR);
    let layer = Array.from(host.children).find((c) => c.hasAttribute(LAYER_MARK)) as HTMLElement | undefined;
    if (!name) return void layer?.remove();
    if (!layer) {
      layer = document.createElement(TAG);
      layer.setAttribute(LAYER_MARK, '');
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;';
      host.prepend(layer);
    }
    if (layer.getAttribute('name') !== name) layer.setAttribute('name', name);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (host.style.isolation !== 'isolate') host.style.isolation = 'isolate';
  };
  const scan = () => {
    frame = 0;
    document.querySelectorAll<HTMLElement>(`[${LAYER_ATTR}]`).forEach(sync);
    // Layers whose element lost the attribute.
    document.querySelectorAll<HTMLElement>(`[${LAYER_MARK}]`).forEach((l) => {
      if (!l.parentElement?.hasAttribute(LAYER_ATTR)) l.remove();
    });
  };
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(scan);
  };
  // Frameworks may re-render the element's children and drop the layer; put it back.
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [LAYER_ATTR] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
}

/** Define the `<gradier-gradient>` custom element. Safe to call multiple times and during SSR (no-op). */
export function defineGradientElement(): void {
  if (typeof window === 'undefined' || !('customElements' in window)) return;
  attachGradientLayers();
  if (customElements.get(TAG)) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  class Element extends HTMLElement implements GradierElement {
    static observedAttributes = ['name'];
    private _gradient: Gradient | undefined;
    private canvas!: HTMLCanvasElement;
    private renderer: MeshRenderer | null = null;
    private cleanup: Array<() => void> = [];
    private visible = true;
    private raf = 0;
    private time = 0;
    private last = 0;

    get gradient() {
      return this._gradient;
    }
    set gradient(value: Gradient | undefined) {
      this._gradient = value ? normalizeGradient(value) : undefined;
      this.refresh();
    }
    get resolved() {
      const name = this.getAttribute('name');
      return this._gradient ?? (name ? getGradient(name) : undefined);
    }

    connectedCallback() {
      if (!this.shadowRoot) {
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${STYLE}</style><canvas part="canvas"></canvas><slot></slot>`;
        this.canvas = root.querySelector('canvas')!;
      }
      mountedElements().add(this);
      this.renderer = MeshRenderer.create(this.canvas);

      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this);
      const io = new IntersectionObserver(([entry]) => {
        this.visible = !!entry?.isIntersecting;
        this.schedule();
      });
      io.observe(this);
      const onLost = (e: Event) => {
        e.preventDefault();
        this.renderer = null;
      };
      const onRestored = () => {
        this.renderer = MeshRenderer.create(this.canvas);
        this.refresh();
      };
      this.canvas.addEventListener('webglcontextlost', onLost);
      this.canvas.addEventListener('webglcontextrestored', onRestored);
      const onMotion = () => this.schedule();
      reducedMotion?.addEventListener?.('change', onMotion);
      const unsubscribe = subscribe((name) => {
        if (name === null || name === this.getAttribute('name')) this.refresh();
      });
      this.cleanup = [
        () => ro.disconnect(),
        () => io.disconnect(),
        () => this.canvas.removeEventListener('webglcontextlost', onLost),
        () => this.canvas.removeEventListener('webglcontextrestored', onRestored),
        () => reducedMotion?.removeEventListener?.('change', onMotion),
        unsubscribe,
      ];
      this.resize();
    }

    disconnectedCallback() {
      mountedElements().delete(this);
      this.cleanup.forEach((fn) => fn());
      this.cleanup = [];
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.renderer?.destroy();
      this.renderer = null;
    }

    attributeChangedCallback() {
      this.refresh();
    }

    refresh() {
      if (!this.canvas) return;
      const g = this.resolved;
      // The CSS approximation only stands in until WebGL draws (it would show through see-through points).
      this.canvas.style.background = g && !this.renderer ? gradientToCSS(g) : 'transparent';
      this.toggleAttribute('data-missing', !g);
      if (g && this.renderer) {
        this.renderer.setGradient(g);
        this.renderer.render();
      } else if (!g && this.renderer) {
        const gl = this.renderer.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      this.schedule();
    }

    private resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.refresh();
    }

    private schedule() {
      const g = this.resolved;
      const animate = !!g && g.speed > 0 && this.visible && !!this.renderer && !reducedMotion?.matches;
      if (animate && !this.raf) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.tick);
      } else if (!animate && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    }

    private tick = (now: number) => {
      const g = this.resolved;
      if (!g || !this.renderer) return void (this.raf = 0);
      this.time += ((now - this.last) / 1000) * (0.2 + g.speed * 1.8);
      this.last = now;
      this.renderer.setTime(this.time);
      this.renderer.render();
      this.raf = requestAnimationFrame(this.tick);
    };
  }

  customElements.define(TAG, Element);
}
