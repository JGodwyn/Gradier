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

/** Define the `<gradier-gradient>` custom element. Safe to call multiple times and during SSR (no-op). */
export function defineGradientElement(): void {
  if (typeof window === 'undefined' || !('customElements' in window) || customElements.get(TAG)) return;

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
      this.canvas.style.background = g ? gradientToCSS(g) : 'transparent';
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
