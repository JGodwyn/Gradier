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
      // HTML that Gradier edits (a data-gradier attribute, an inline-style gradient) is already applied on the page,
      // so drop the full page reload Vite would send for it: you keep your place and selection.
      const quiet = new Map<string, number>();
      const onWrite = (written: string, kind: 'gradients' | 'css' | 'markup') => {
        if (/\.html?$/i.test(written) && (kind === 'markup' || kind === 'css')) quiet.set(path.resolve(written), Date.now() + 3000);
      };
      const viteRoot = server.config.root;
      const isQuiet = (payload: unknown) => {
        const p = payload as { type?: string; path?: string; triggeredBy?: string };
        if (p?.type !== 'full-reload') return false;
        const now = Date.now();
        for (const [f, until] of quiet) if (until < now) quiet.delete(f);
        const target = p.triggeredBy ?? (p.path && p.path !== '*' ? path.resolve(viteRoot, p.path.replace(/^\//, '')) : '');
        return !!target && quiet.has(path.resolve(target));
      };
      const channels = [(server as { environments?: Record<string, { hot?: { send: (...a: unknown[]) => void } }> }).environments?.client?.hot, server.ws];
      for (const ch of new Set(channels)) {
        if (!ch) continue;
        const send = ch.send.bind(ch) as (...a: unknown[]) => void;
        ch.send = ((...args: unknown[]) => {
          if (isQuiet(args[0])) return;
          send(...args);
        }) as typeof ch.send;
      }
      server.middlewares.use(createGradierMiddleware({ ...options, root, onWrite, quietHtml: true }));
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
