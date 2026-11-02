import { createElement, useCallback, useEffect, useState, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { gradientToCSS } from './core/css';
import { defineGradientElement, TAG, type GradierElement } from './core/element';
import { getGradient, subscribe } from './core/store';
import { normalizeGradient, type Gradient as GradientData } from './core/types';

export interface GradientProps extends HTMLAttributes<HTMLElement> {
  /** Name of a gradient registered with `registerGradients` (and editable with the Gradier overlay). */
  name?: string;
  /** Inline gradient data. Takes precedence over `name`. */
  gradient?: GradientData;
  children?: ReactNode;
}

/**
 * React wrapper around `<gradier-gradient>`. Renders a CSS approximation on the server
 * so there's no flash before the WebGL version takes over.
 */
export function Gradient({ name, gradient, style, children, ...rest }: GradientProps): ReactElement {
  const [, rerender] = useState(0);
  useEffect(() => {
    defineGradientElement();
    return subscribe((changed) => {
      if (changed === null || changed === name) rerender((n) => n + 1);
    });
  }, [name]);

  const ref = useCallback(
    (el: GradierElement | null) => {
      if (el) el.gradient = gradient;
    },
    [gradient],
  );

  const resolved = gradient ? normalizeGradient(gradient) : name ? getGradient(name) : undefined;
  // Pre-render stand-in. Skipped for see-through gradients, where it would show behind the WebGL canvas.
  const fallback: CSSProperties = resolved && resolved.points.every((p) => (p.opacity ?? 1) >= 1) ? { background: gradientToCSS(resolved) } : {};

  return createElement(TAG, { ...rest, name, ref, style: { ...fallback, ...style } }, children);
}

export { registerGradients, getGradient } from './core/store';
export type { GradientData };

// Lets the dev overlay know the runtime is on the page (so converted elements also render outside the editor).
if (typeof window !== 'undefined') {
  (globalThis as unknown as Record<string, boolean>).__GRADIER_RUNTIME__ = true;
  defineGradientElement();
}
