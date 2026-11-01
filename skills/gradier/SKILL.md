---
name: gradier
description: Set up and use Gradier, a dev-only visual gradient editor that saves edits straight back into a project's source code, plus a small WebGL mesh-gradient runtime. Use when the user wants to install or configure Gradier, add a visual gradient editor to their dev site, edit or create gradients on a website, add or change a mesh gradient (`<gradier-gradient>`, `gradients.json`), apply a "Gradier edit request" they pasted, explain how to use the Gradier editor, or troubleshoot its overlay or save server.
---

# Gradier

Gradier adds an editor overlay to a website **during development only**:

- **CSS gradients** (<kbd>Alt</kbd>+<kbd>P</kbd>, then click any gradient on the page): `linear-`, `radial-`, `conic-` and `repeating-*` gradients on any element or its `::before`/`::after`. The user edits it visually and saves; Gradier finds where that gradient is written in the project and rewrites **only that gradient's text** in place.
- **Mesh gradients** (<kbd>Alt</kbd>+<kbd>G</kbd>): a WebGL `<gradier-gradient name="…">` element whose data lives in a JSON file (default `src/gradients.json`). The user shapes it with colour points, lines, arcs and freehand strokes, then saves to that file. This small runtime (about 11 kB gzipped, with a CSS fallback) is the only part that ships to production.

Two parts must both be wired up in development:

1. **The overlay script** at `/__gradier/overlay.js`.
2. **The save server**: HTTP endpoints under `/__gradier/` that read and write project files. The Vite plugin provides them on the Vite dev server; for anything else, the CLI (`gradier serve`, default `http://localhost:4747`) does.

Never ship either part to production.

Reference files in this skill (read them when the task needs them):

- [MESH.md](MESH.md): the mesh gradient JSON format, writing or changing gradients in code, and the runtime API.
- [EDITOR.md](EDITOR.md): every editor control and shortcut, for explaining to the user how to do something.

## 1. Inspect the project first

| Question | How to check |
| --- | --- |
| Package manager | Lockfile: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb`/`bun.lock` → bun |
| Dev server / framework | `package.json` deps and `scripts.dev`; config files: `vite.config.*`, `next.config.*`, `nuxt.config.*`, `astro.config.*`, `svelte.config.*`, `angular.json`, `webpack.config.*`, `Gemfile`, `manage.py`, `composer.json` |
| Who serves the HTML in dev? | A Vite single-page app (Vite serves `index.html`) vs. a framework or server that renders HTML (Next, Nuxt, Astro, SvelteKit, Remix/React Router, Laravel, Rails, Django, PHP, static site generators) |
| Mesh gradients needed? | Only if the user wants the WebGL `<gradier-gradient>` effect. Editing existing CSS gradients doesn't need it |
| Monorepo? | Workspaces in the root `package.json`, `pnpm-workspace.yaml`, `turbo.json`. Decide which directory Gradier should scan (`root`) |

## 2. Install

```bash
npm i gradier       # mesh gradients: the runtime ships, so a normal dependency
npm i -D gradier    # CSS gradients only: everything is dev-only
```

(`pnpm add [-D] gradier`, `yarn add [-D] gradier`, `bun add [-d] gradier`.)

## 3. Wire it up (pick ONE path)

### Path A: Vite single-page apps

Covers vanilla, React, Preact, Vue, Svelte, Solid and Lit apps where Vite serves `index.html`. The plugin injects the overlay and serves the API on the same origin. It is `apply: 'serve'`, so `vite build` is untouched.

```js
// vite.config.(js|ts)
import { defineConfig } from 'vite';
import gradier from 'gradier/vite';

export default defineConfig({
  plugins: [
    // keep existing plugins
    gradier({ file: 'src/gradients.json' }), // where mesh gradients are stored
  ],
});
```

That's all for CSS gradients. Options: `root` (directory to scan and write, relative to Vite's root), `allowedOrigins` (see Troubleshooting).

### Path B: everything else

Next.js, Nuxt, Astro, SvelteKit, Remix/React Router, Angular, webpack, Laravel, Rails, Django, PHP, static HTML. Run the standalone save server from the **project root** next to the normal dev server, and load the overlay from it in development only.

1. Add a script to `package.json` (don't rewrite the user's existing `dev` script unless they ask):

   ```json
   "scripts": {
     "gradier": "gradier serve --file src/gradients.json"
   }
   ```

   Options: `--root <dir>` (directory to scan and write; default cwd), `--port 4747`, `--file <json>`, `--origin <url>` (repeatable; needed when the dev site isn't on `localhost`, `127.0.0.1` or `*.localhost`, e.g. `--origin http://myapp.test`).

   If the project already uses `concurrently` or `npm-run-all`, you may offer to add Gradier to the dev command. Otherwise tell the user to run `npm run gradier` in a second terminal.

2. Load the overlay **only in development**, near the end of `<body>` in the root layout:

   **Next.js App Router** (`app/layout.tsx`):
   ```tsx
   import Script from 'next/script';
   // …inside <body>, after {children}:
   {process.env.NODE_ENV === 'development' && (
     <Script src="http://localhost:4747/__gradier/overlay.js" strategy="afterInteractive" />
   )}
   ```

   **Next.js Pages Router** (`pages/_app.tsx`): the same `<Script>` element, next to `<Component {...pageProps} />`.

   **Nuxt** (`nuxt.config.ts`):
   ```ts
   app: { head: { script: process.env.NODE_ENV === 'development' ? [{ src: 'http://localhost:4747/__gradier/overlay.js', defer: true }] : [] } }
   ```

   **Astro** (base layout):
   ```astro
   {import.meta.env.DEV && <script is:inline src="http://localhost:4747/__gradier/overlay.js" defer></script>}
   ```

   **SvelteKit** (`src/routes/+layout.svelte`):
   ```svelte
   <script>import { dev } from '$app/environment';</script>
   <svelte:head>{#if dev}<script src="http://localhost:4747/__gradier/overlay.js" defer></script>{/if}</svelte:head>
   ```

   **Remix / React Router v7** (`app/root.tsx`): in `<body>`, `{import.meta.env.DEV && <script src="http://localhost:4747/__gradier/overlay.js" defer />}`.

   **Laravel Blade**: `@env('local') <script src="http://localhost:4747/__gradier/overlay.js" defer></script> @endenv`
   **Rails ERB**: `<% if Rails.env.development? %><script src="http://localhost:4747/__gradier/overlay.js" defer></script><% end %>`
   **Django**: `{% if debug %}<script src="http://localhost:4747/__gradier/overlay.js" defer></script>{% endif %}` (needs `django.template.context_processors.debug` and `INTERNAL_IPS`)

   **Any JS entry point** (Angular `main.ts`, webpack apps, etc.):
   ```js
   if (process.env.NODE_ENV === 'development') { // Angular: isDevMode(); Vite: import.meta.env.DEV
     const s = document.createElement('script');
     s.src = 'http://localhost:4747/__gradier/overlay.js';
     document.head.append(s);
   }
   ```

   **Plain static HTML**: add the tag and remind the user to remove it before deploying, or serve it only from a dev-only include.

An Express or webpack-dev-server setup can mount the API on its own origin instead of running the CLI, then load `/__gradier/overlay.js` from that origin:

```js
import { createGradierMiddleware } from 'gradier/server';
app.use(createGradierMiddleware({ root: process.cwd(), file: 'src/gradients.json' }));          // Express (dev only)
// webpack-dev-server: setupMiddlewares: (mws, devServer) => { devServer.app.use(createGradierMiddleware()); return mws; }
```

### Mesh gradients (either path)

Register the saved gradients once, then place elements by name. Details and the data format are in [MESH.md](MESH.md).

```js
import { registerGradients } from 'gradier';     // also defines <gradier-gradient>
import gradients from './gradients.json';        // create it as {} if it doesn't exist
registerGradients(gradients);
```

```html
<gradier-gradient name="hero" style="display:block;min-height:60vh">…content on top…</gradier-gradient>
```

React: `import { Gradient, registerGradients } from 'gradier/react'`, then `<Gradient name="hero" style={{ minHeight: '60vh' }} />`. It renders a CSS fallback on the server; in Next.js put it in a client component (`'use client'`). TypeScript needs `"resolveJsonModule": true` to import the JSON. A name that isn't in the file yet shows in the editor as a yellow "click to create" label.

### Monorepos

The server only scans and writes inside `root`, and skips `node_modules`, `dist`, `build`, `.next`, `.git` and other build or hidden directories. If shared styles live in another workspace package (e.g. `packages/ui`), widen the root: `gradier({ root: '../..' })` for the plugin, or `gradier serve --root <repo root>`. `file` is resolved against that root.

## 4. Verify the setup (every time)

1. Start the dev server (and `npm run gradier` for Path B).
2. `curl -sI <overlay URL>` returns `200` with `text/javascript`: `http://localhost:<vite port>/__gradier/overlay.js` (A) or `http://localhost:4747/__gradier/overlay.js` (B).
3. `curl -s <base>/__gradier/api` returns JSON like `{"file":"src/gradients.json","gradients":{}}`.
4. If a browser tool is available (e.g. Playwright), open the page and check `document.getElementById('gradier-overlay')` exists and the console has no `[gradier]` errors. Otherwise tell the user to look for the **Gradier** pill in the bottom-right corner.
5. Production safety: for Vite, build and confirm `grep -r "__gradier" dist/` finds nothing. For other frameworks, confirm the script tag is behind a dev-only condition.

Then tell the user how to start: **Alt+P** and click a gradient to edit it, or **Alt+G** for mesh gradients; **⌘/Ctrl+S** saves. Point them to [EDITOR.md](EDITOR.md)'s contents for anything more specific they ask.

## 5. What saving CSS gradients can and cannot handle

Gradier matches the gradient the browser shows against gradient text in source files semantically: `#fff` matches `rgb(255, 255, 255)`, `to bottom` matches the default direction, `var(--x)` matches `var(--x)`. It ranks matches by the stylesheet the rule came from and by selector. When several places match, the user picks one or updates all identical copies.

Works: CSS / SCSS / Less / PostCSS files, CSS Modules, `<style>` blocks, Vue/Svelte/Astro styles, HTML `style=""`, JSX `style={{ background: '…' }}`, gradient strings in JS/TS (styled-components/emotion **without** `${}` inside the gradient), and server templates (ERB, Blade, Twig, Jinja/Django, Liquid, Handlebars, EJS, Pug).

Doesn't save automatically. The panel shows "not found", and the user clicks **Copy for AI agent**, which hands the request to you (§6):
- Tailwind gradient utilities (`bg-gradient-to-r from-… via-… to-…`, v4 `bg-linear-*`, `bg-radial`, `bg-conic`).
- Gradients assembled at runtime (interpolation, concatenation, Sass functions/mixins, theme objects split into parts).
- Gradients from `node_modules` / third-party CSS, or CSS served from another origin.
- A CSS variable holding the whole gradient (`background: var(--hero-bg)`) whose definition text doesn't match.

When the matched source uses `var(--…)` colours, colours the user changes are written as literal values; untouched stops keep their variables.

## 6. Applying a "Gradier edit request" (pasted by the user)

**Copy for AI agent** produces text like:

```
Gradier edit request: update this gradient in the source code.

Page: http://localhost:5173/pricing
Element: main > section.pricing > div.card.featured::before
Element classes: card featured
Background layer: 1 of 2
Source: src/styles/cards.css:42:15 (selector ".card.featured::before")
Current gradient (as written in source): linear-gradient(135deg, #ff0080, #7928ca)
New gradient: linear-gradient(120deg, #ff0080 0%, #ffb800 55%, #7928ca 100%)
```

To apply it:

1. If `Source:` names a file, open it at that line and replace the **current** gradient text with the **new** one exactly. Keep the surrounding declaration, other background layers, `!important`, fallbacks and formatting.
2. If no source was found, locate the element: search for the classes and IDs in `Element:` / `Element classes:` (`rg -n "featured" src`), the component that renders it, and CSS rules matching the selector path. `Background layer: N of M` says which comma-separated layer of `background`/`background-image` to change. A trailing `::before`/`::after` means the rule is on that pseudo-element.
3. **Tailwind**: replace only the gradient utilities on that element, keeping variant prefixes (`md:`, `hover:`, `dark:`). Either:
   - an arbitrary value, which is always exact: `bg-[linear-gradient(120deg,#ff0080_0%,#ffb800_55%,#7928ca_100%)]` (spaces become `_`), or
   - utilities when the gradient fits them. v3: `bg-gradient-to-r from-[#ff0080] via-[#ffb800] via-55% to-[#7928ca]`. v4: `bg-linear-120 from-[#ff0080] via-[#ffb800] via-55% to-[#7928ca]`, with `bg-radial-[at_25%_25%]` and `bg-conic-180` for the other types. Use theme colours (`from-pink-500`) only when the hex matches exactly.
4. **CSS variables / design tokens**: update the token's value only if `rg` shows it isn't used elsewhere; otherwise change this usage.
5. **CSS-in-JS with interpolation**: update the underlying constants or theme values so the rendered result equals the new gradient.
6. Verify: reload (or rely on HMR) and check the element's computed `background-image` matches, e.g. `getComputedStyle(el, '::before').backgroundImage` with a browser tool.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No Gradier pill | Overlay not loaded. Check the script tag renders (view source), the dev condition is true, and the overlay URL returns 200. Vite-based SSR frameworks don't serve `index.html`, so use Path B. |
| Saving fails with 403 in Codespaces, Gitpod, StackBlitz, a tunnel (ngrok, Cloudflare) or a custom dev domain | The page origin isn't localhost. Allow it: `gradier({ allowedOrigins: ['https://*.app.github.dev'] })` or `gradier serve --origin 'https://*.app.github.dev'` (`*` is a wildcard). For Path B in Codespaces, also forward port 4747 and point the script at its forwarded URL. |
| Panel says "Can't reach the save server" | The CLI isn't running, uses another port, or the page origin isn't allowed (a 403 in the network tab). Add `--origin <page origin>`. |
| Script blocked | A dev-site CSP: allow `http://localhost:4747` in `script-src` and `connect-src` in development. |
| "Not found in source" | See §5; use **Copy for AI agent** and §6. In a monorepo, check `root`. |
| Saved, but the page shows the old gradient | The dev server didn't hot-reload that file type. Reload the page. |
| Page reloads on every mesh save | A non-Vite watcher sees the JSON file. Harmless; or exclude the file from the watcher. |
| Mesh gradient is blank or flat | No WebGL (the CSS fallback shows instead), the element has zero height (give it a height), or the name isn't registered (`registerGradients` not called, or a typo in `name`). |
| Port 4747 in use | `gradier serve --port 4848` and update the script URL. |

## 8. HTTP API (for scripting or debugging)

Base: `<origin>/__gradier`. Requests must come from a localhost origin, the server's own origin, or an allowed origin. POST bodies are JSON.

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /overlay.js` | | The overlay script |
| `GET /api` | | `{ file, gradients }` |
| `POST /api` | `{ save?: {name: gradient}, delete?: [name], rename?: [{from,to}] }` | `{ file, gradients }` |
| `POST /css/find` | `{ candidates: [gradient strings], hints?: { files?: [path], selectors?: [selector] } }` | `{ matches: [{ file, line, column, start, end, text, quality, selector, score }] }` |
| `POST /css/replace` | `{ edits: [{ file, start, end, text, replacement }] }` | `{ results: [{ file, start, end, text, line, column }] }` |

`/css/replace` only accepts a single gradient function as the replacement (no `; { } < > " ' \` or backticks), only inside `root`, and checks the old text is still there.

## 9. Removing Gradier

Delete the Vite plugin entry or the overlay script tag, the `gradier` package script, and uninstall the package. Keep `src/gradients.json` and the runtime import only if mesh gradients are still used.

## Rules for agents

- Never load the overlay or mount the API in production. Every script tag and middleware sits behind a development-only condition.
- Don't modify the user's existing `dev`/`build` scripts or CI without asking. Add a separate `gradier` script.
- Don't commit or push on the user's behalf unless asked. Gradier's edits are ordinary file changes for the user to review.
- After setup, always run §4 and report what you checked.
- When writing mesh gradients by hand, follow [MESH.md](MESH.md); the runtime clamps or drops invalid values silently, so a typo won't error, it just won't show.
