import { defineGradientElement } from './core/element';

export { defineGradientElement, TAG, type GradierElement } from './core/element';
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
