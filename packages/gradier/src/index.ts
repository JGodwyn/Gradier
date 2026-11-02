import { defineGradientElement } from './core/element';

export { attachGradientLayers, defineGradientElement, LAYER_ATTR, TAG, type GradierElement } from './core/element';
export { gradientToCSS } from './core/css';
export { MeshRenderer } from './core/renderer';
export {
  registerGradients,
  setGradient,
  removeGradient,
  getGradient,
  getGradients,
  subscribe,
} from './core/store';
export {
  normalizeGradient,
  randomGradient,
  PRESETS,
  DEFAULTS,
  MAX_POINTS,
  type Gradient,
  type GradientPoint,
  type GradientMap,
} from './core/types';

defineGradientElement();
// Lets the dev overlay know the runtime is on the page (so converted elements also render outside the editor).
(globalThis as unknown as Record<string, boolean>).__GRADIER_RUNTIME__ = true;
