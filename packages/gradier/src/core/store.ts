import { normalizeGradient, type Gradient, type GradientMap } from './types';

type Listener = (name: string | null) => void;

interface Store {
  gradients: GradientMap;
  listeners: Set<Listener>;
  elements: Set<HTMLElement>;
}

const KEY = '__GRADIER_STORE__';

/**
 * The store lives on globalThis so the page's copy of the runtime and the dev overlay's
 * copy (which is a separate bundle) share the same gradients and elements.
 */
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[KEY] ??= { gradients: {}, listeners: new Set(), elements: new Set() });
}

/** Register gradients (typically the JSON file Gradier saves to) so `<gradier-gradient name>` can find them. */
export function registerGradients(map: GradientMap | Record<string, unknown>): void {
  const s = store();
  for (const [name, g] of Object.entries(map)) s.gradients[name] = normalizeGradient(g);
  s.listeners.forEach((fn) => fn(null));
}

export function setGradient(name: string, gradient: Gradient): void {
  const s = store();
  s.gradients[name] = gradient;
  s.listeners.forEach((fn) => fn(name));
}

export function removeGradient(name: string): void {
  const s = store();
  delete s.gradients[name];
  s.listeners.forEach((fn) => fn(name));
}

export function getGradient(name: string): Gradient | undefined {
  return store().gradients[name];
}

export function getGradients(): GradientMap {
  return { ...store().gradients };
}

export function subscribe(fn: Listener): () => void {
  const s = store();
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}

/** @internal Mounted `<gradier-gradient>` elements, used by the dev overlay. */
export function mountedElements(): Set<HTMLElement> {
  return store().elements;
}
