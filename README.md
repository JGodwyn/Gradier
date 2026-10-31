# Gradier

Point at **any gradient on your running site**, edit it visually, and save the change straight back into your source code. It's a development tool and never ships to production.

**Edit existing CSS gradients.** Press <kbd>Alt</kbd>+<kbd>P</kbd> (or the crosshair button) and click any gradient on the page: `linear-`, `radial-`, `conic-` or `repeating-*`, on an element or its `::before`/`::after`, in any layer of a multi-layer background. Then:
- drag colour stops on a gradient bar, click it to add stops, and change colours, opacity and positions,
- switch between linear, radial and conic, rotate the angle with an on-page handle, or drag the centre of a radial or conic gradient,
- see every change live on the page,
- hit **Save** (<kbd>⌘/Ctrl</kbd>+<kbd>S</kbd>).

Gradier finds where that gradient is written in your project, whether a CSS/SCSS/Less file, a CSS Module, a `<style>` block, an HTML `style=""`, a JSX `style={{…}}` or a template, and rewrites **just that gradient** in place. Your dev server's hot reload does the rest. If several places match, you choose which one to update, or update them all.

If a gradient can't be traced to one string in source (Tailwind classes, values built at runtime), **Copy for AI agent** copies an edit request with the element, the old and new gradient, and any source hints. Your coding agent can apply it; see [the agent skill](#ai-agent-skill).

**Mesh gradients.** Drop `<gradier-gradient name="hero">` anywhere for a WebGL mesh gradient. Press <kbd>Alt</kbd>+<kbd>G</kbd> to drag colour points and tweak softness, warp, grain and motion, then save to `src/gradients.json`. This is the one part you ship: a small runtime with a CSS fallback.

```
packages/gradier       the npm package
skills/gradier         SKILL.md for AI coding agents (also shipped in the package)
examples/vite-vanilla  plain HTML + Vite: mesh and CSS gradients
examples/vite-react    React + Vite
```

## Run it locally

```bash
git clone -b main https://github.com/JGodwyn/Gradier.git
cd Gradier
npm install
npm run live
```

`npm run live` builds the editor and starts the example at http://localhost:5173. It also checks GitHub's `main` every 15 seconds and pulls new changes. After a pull, it rebuilds, runs `npm install` if dependencies changed, and restarts the server, so you only need to refresh the browser. It only ever fast-forwards: if your own edits are in the way, it tells you and doesn't touch them.

Variants:
- `npm run live:react` runs the React example instead.
- `npm run sync` pulls without running anything.
- `--interval 30` changes how often it checks.


No local setup needed:

- **GitHub Codespaces** (recommended, a full Linux VM): [open in Codespaces](https://codespaces.new/JGodwyn/Gradier). It installs, builds and starts the example. When port 5173 opens in a new tab, press <kbd>Alt</kbd>+<kbd>P</kbd> and click a gradient. Saves land in the codespace's files, and you can watch them change in the editor.
- **StackBlitz** (runs in your browser tab): [open in StackBlitz](https://stackblitz.com/github/JGodwyn/Gradier).

The examples already allow these preview domains. For your own project in a cloud environment, allow its domain too: `gradier({ allowedOrigins: ['https://*.app.github.dev'] })` or `gradier serve --origin 'https://*.app.github.dev'`.

## Add it to your project

Gradier works in any web project: it edits the gradients on your running dev site and writes them back into your source files.

**1. Install it.**

```bash
npm i gradier
```

Until it's published to npm, install it from your local clone of this repo instead. Build a package file once:

```bash
cd ~/Gradier && npm run pack        # writes gradier-0.1.0.tgz in the repo root
```

then install that file in your project:

```bash
npm i ~/Gradier/gradier-0.1.0.tgz
```

Run both again to pick up newer Gradier changes.

Only editing existing CSS gradients? Use `npm i -D` instead: everything Gradier does then happens in development, and nothing ships. Using mesh gradients (`<gradier-gradient>`)? Keep it a normal dependency, because their small runtime (about 11 kB gzipped) ships with your site.

**2. Wire it into your dev server.** Pick your setup below. With Vite, that's one line in `vite.config.js`.

**3. Run your dev server as usual** and press <kbd>Alt</kbd>+<kbd>G</kbd> (mesh gradients) or <kbd>Alt</kbd>+<kbd>P</kbd> (pick any CSS gradient on the page). Saving writes to your project's files, and the editor never ends up in your production build.

### Vite single-page apps (React, Vue, Svelte, Solid, vanilla…)

```js
// vite.config.js
import gradier from 'gradier/vite';

export default {
  plugins: [gradier({ file: 'src/gradients.json' })],
};
```

That's all you need for CSS gradients. For mesh gradients, also register your saved gradients:

```js
// main.js
import { registerGradients } from 'gradier';
import gradients from './gradients.json';

registerGradients(gradients);
```

```html
<gradier-gradient name="hero" style="height: 60vh">
  <h1>Content sits on top of the gradient</h1>
</gradier-gradient>
```

The plugin uses `apply: 'serve'`, so `vite build` contains no editor code.

### React

```jsx
import { Gradient, registerGradients } from 'gradier/react';
import gradients from './gradients.json';

registerGradients(gradients);

export function Hero() {
  return <Gradient name="hero" style={{ height: '60vh' }}>…</Gradient>;
}
```

`<Gradient>` also renders a CSS approximation on the server (SSR), so the page never flashes before WebGL kicks in.

### Anything else (Next.js, Nuxt, Astro, SvelteKit, Rails, Django, Laravel, static HTML…)

Run the standalone save server next to your dev server:

```bash
npx gradier serve --file src/gradients.json   # port 4747; --root to scan another dir, --origin to allow a non-localhost dev URL
```

and add the overlay script to your page **in development only**:

```html
<script src="http://localhost:4747/__gradier/overlay.js" defer></script>
```

For example, in a Next.js `app/layout.tsx`:

```jsx
import Script from 'next/script';
// inside <body>
{process.env.NODE_ENV === 'development' && (
  <Script src="http://localhost:4747/__gradier/overlay.js" strategy="afterInteractive" />
)}
```

The [skill](skills/gradier/SKILL.md) has snippets for Nuxt, Astro, SvelteKit, Remix, Angular, Laravel, Rails and Django.

Express / webpack-dev-server users can mount the middleware directly:

```js
import { createGradierMiddleware } from 'gradier/server';
app.use(createGradierMiddleware({ file: 'src/gradients.json' }));
```

## AI agent skill

[`skills/gradier/SKILL.md`](skills/gradier/SKILL.md) teaches a coding agent (Claude Code or any agent that reads skills) to:
- detect the framework, install Gradier and wire it up with dev-only guards,
- verify the setup,
- apply the **Copy for AI agent** edit requests, including Tailwind conversions,
- troubleshoot.

Install it into a project with:

```bash
npx gradier skill            # writes .claude/skills/gradier/SKILL.md
npx gradier skill --print    # or print it to paste elsewhere
```

## Editor: CSS gradients

| Action | How |
| --- | --- |
| Pick a gradient | <kbd>Alt</kbd>+<kbd>P</kbd> or the crosshair button, then click it on the page (<kbd>Esc</kbd> cancels) |
| Add a stop | Click the gradient bar, or **+ Add** |
| Move a stop | Drag its marker, or type a position |
| Change a colour | Use the swatch, type any CSS colour, or use the **Opacity** slider |
| Remove a stop | Select it and press <kbd>Delete</kbd>, or use the bin icon |
| Angle / centre | Drag the handles on the page (<kbd>Shift</kbd> snaps), or use the sliders |
| Save to source | **Save** or <kbd>⌘/Ctrl</kbd>+<kbd>S</kbd>. The Source row shows the file and line |
| Can't save automatically | **Copy CSS** or **Copy for AI agent** |

## Editor: mesh gradients

| Action | How |
| --- | --- |
| Open / close | Click the **Gradier** pill, or <kbd>Alt</kbd>+<kbd>G</kbd> |
| Pick a gradient | Click its label on the page, or use the dropdown |
| Create a missing gradient | Click a yellow `name · click to create` label |
| Move a point | Drag the handle (hold <kbd>Shift</kbd> to snap) |
| Add a point | Double-click the gradient, use the **Node** tool (<kbd>N</kbd>) and click, or **+ Add**. New points take the colour under the cursor |
| Expand a point's area | Select the point, then drag the curved grip on its dashed circle |
| Stretch a point's colour | Select a point and drag its four arms; a longer arm pushes the colour further that way |
| Draw a line / arc | **Line** (<kbd>L</kbd>) or **Arc** (<kbd>A</kbd>) tool, then drag across the gradient. Drag the ends to reshape; drag an arc's colour point to bend it |
| Freehand | **Pencil** (<kbd>P</kbd>): the colour follows your stroke. Drag the middle handle to move it, drag an end to bend it, and drag an end's grip to make the colour wider or narrower there |
| Shuffle / scatter | <kbd>X</kbd> shuffles colours, <kbd>R</kbd> scatters points |
| Hide handles | <kbd>H</kbd> or the eye button |
| Select / deselect | Click a node to select it; click empty space (or <kbd>Esc</kbd>) to deselect. The points list shows just the selected node; open its dropdown to see them all |
| Per-node or all nodes | With a node selected, **Softness**, **Blend mode** and the **Filter** sliders change only that node (a node's blend mode shows around it and fades into its neighbours) (the chip says *Node N*). With nothing selected they change every node (*All nodes*) |
| Blend mode | Drag the **Blend mode** field (or use the arrow keys) to step through Normal, Linear, OKLab, Screen, Multiply, Overlay and Soft light |
| Grain | **Mono**, **Duo** (warm/cool) or **Multi** (per-channel) grain, with opacity, grain size and density |
| Filters | Hue, saturation, brightness and temperature, with a reset button |
| Export | Pick 1×–4× of the element's size, then **JPG**, **PNG** or **Copy** (PNG to the clipboard) |
| Back to Select | <kbd>V</kbd> or <kbd>Esc</kbd> |
| Remove a point | Select it and press <kbd>Delete</kbd>, or use the bin icon |
| Undo / redo | <kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> / <kbd>⌘/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |
| Save | **Save** or <kbd>⌘/Ctrl</kbd>+<kbd>S</kbd> |
| Export | Copy the tag, a pure-CSS approximation, or the JSON |

Saving writes only the gradients file. Vite's HMR is told to skip that file, so the page does not reload while you edit. A dot on the launcher marks unsaved changes, and the browser warns you before you leave with unsaved edits.

## Gradient format

```json
{
  "hero": {
    "points": [
      { "x": 0.1, "y": 0.2, "color": "#ffb4a2" },
      { "x": 0.8, "y": 0.1, "color": "#8b5cf6" }
    ],
    "softness": 0.5,
    "warp": 0.3,
    "warpScale": 0.35,
    "grain": 0.08,
    "speed": 0
  }
}
```

`x`/`y` are relative to the element (0–1). Points can also carry optional fields, which the editor writes for you:

- `softness`, `blendMode`, `hue`, `saturation`, `brightness`, `temperature`: per-point overrides (softness and blend mode replace the gradient's; filters stack on top of it).
- `radius`: how far the colour reaches, as a multiple of the default (`1`).
- `arms`: four `[dx, dy]` direction handles (in units of √(width × height)) that stretch the colour's reach.
- `shape`: `{ "type": "line" | "arc", "a": {x, y}, "b": {x, y} }` makes the colour follow a segment from `a` to `b`, or an arc from `a` through the point to `b`. `{ "type": "path", "points": [{x, y}, …] }` follows a freehand stroke. Optional `ra` / `rb` set the colour's width at the start / end.

Gradients can also carry optional look settings, left out when unchanged: `blendMode` (`"normal"`, `"linear"`, `"oklab"` (default), `"screen"`, `"multiply"`, `"overlay"`, `"softlight"`), `grainType` (`"mono"`, `"duo"`, `"multi"`), `grainSize` (1–4), `grainDensity` (0–2), `hue` (−180–180), `saturation` (0–2), `brightness` (0–2) and `temperature` (−1–1).

 Colours blend in OKLab, which keeps transitions vivid instead of muddy. Everything except the points is a 0–1 value; higher `softness` gives softer, wider blends. `speed > 0` animates the gradient, and animation pauses when the gradient is off-screen or the user prefers reduced motion.

## Runtime API

```ts
import {
  registerGradients, // (map) register gradients by name
  setGradient,       // (name, gradient) update one live
  getGradient,
  gradientToCSS,     // (gradient) -> CSS background string
  randomGradient,
  PRESETS,
} from 'gradier';

// Inline data, no name lookup:
document.querySelector('gradier-gradient').gradient = { points: [...] };
```

## Security

The save API only accepts requests from localhost origins and the dev server's own origin. Pass `--origin https://my.local.dev` to allow another dev origin. The CLI binds to `127.0.0.1`.

It writes only two kinds of thing:
- the mesh JSON file, after validating every gradient,
- gradient text in source files inside the project root, outside `node_modules` and build directories.

A CSS rewrite must replace text that is still a gradient with a single gradient function containing no quotes, braces, semicolons or angle brackets. It can't inject anything into your code.

## Publish to npm

The package is ready to publish as `gradier` (the name is free on npm as of this writing). From the repo root:

```bash
npm login
```

```bash
npm publish -w gradier
```

Publishing builds the package, copies this README into it, and runs the type check and tests first; it stops if any of them fail. For later releases, bump the version first (`npm version patch -w gradier`), then publish again.

## Develop

```bash
npm install
npm run example         # builds the package, starts examples/vite-vanilla
npm run example:react
npm run dev             # rebuild the package on change
npm test -w gradier     # parser and source-rewrite tests
```
