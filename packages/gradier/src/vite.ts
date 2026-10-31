import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { BASE_PATH, createGradierMiddleware, resolveGradientsFile, type GradierServerOptions } from './server/index';

export interface GradierPluginOptions extends GradierServerOptions {
  /** Directory to scan for gradients and write to, relative to Vite's root. Defaults to Vite's root. */
  root?: string;
}

const OVERLAY_SRC = `${BASE_PATH}/overlay.js`;

/**
 * Vite plugin: during `vite dev` it injects the Gradier editor overlay and serves the save API.
 * It does nothing in `vite build`, so the editor never reaches production.
 */
export default function gradier(options: GradierPluginOptions = {}): Plugin {
  const dist = path.dirname(fileURLToPath(import.meta.url));
  const runtimeEntries = new Set([path.resolve(dist, 'index.js'), path.resolve(dist, 'react.js')]);
  let file = '';
  let root = '';

  return {
    name: 'gradier',
    apply: 'serve',
    config() {
      // Keep the runtime out of dependency pre-bundling so `transform` below sees it.
      return { optimizeDeps: { exclude: ['gradier'] } };
    },
    configResolved(config) {
      root = path.resolve(config.root, options.root ?? '.');
      file = resolveGradientsFile({ ...options, root });
    },
    configureServer(server) {
      server.middlewares.use(createGradierMiddleware({ ...options, root }));
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: OVERLAY_SRC, defer: true }, injectTo: 'body' }];
    },
    transform(code, id) {
      // For frameworks without an index.html (SvelteKit, Astro, React Router…), load the
      // overlay from the runtime module itself.
      if (!runtimeEntries.has(path.resolve(id.split('?')[0]!))) return;
      return `${code}\nif (typeof document !== 'undefined' && !document.querySelector('script[src="${OVERLAY_SRC}"]')) {\n  const s = document.createElement('script');\n  s.src = '${OVERLAY_SRC}';\n  document.head.appendChild(s);\n}\n`;
    },
    handleHotUpdate(ctx) {
      // The overlay already shows the saved state; don't reload the page when it writes the file.
      if (path.resolve(ctx.file) === file) return [];
    },
  };
}

export { gradier };
