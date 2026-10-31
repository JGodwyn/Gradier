# Gradier

Edit mesh gradients **live on your own site** during development, then save them straight back into your codebase.

- Drop `<gradier-gradient name="hero">` anywhere (it works in HTML, React, Vue, Svelte, and anything else that renders HTML).
- Run your dev server. A **Gradier** button appears bottom-right (or press <kbd>Alt</kbd>+<kbd>G</kbd>).
- Drag colour points on the page, tweak softness, warp, grain and motion, or pick a preset.
- Hit **Save** (<kbd>⌘/Ctrl</kbd>+<kbd>S</kbd>). Your gradients are written to `src/gradients.json`. Commit that file.

The editor only runs in development. In production you ship the small runtime (a WebGL renderer with a CSS fallback) and the JSON file.

```
packages/gradier       the npm package
examples/vite-vanilla  plain HTML + Vite
examples/vite-react    React + Vite
```

## Install

```bash
npm i gradier
```

### Vite (React, Vue, Svelte, Astro, vanilla…)

```js
// vite.config.js
import gradier from 'gradier/vite';

export default {
  plugins: [gradier({ file: 'src/gradients.json' })],
};
```

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

### Anything else (Next.js, Rails, Django, static HTML…)

Run the standalone save server next to your dev server:

```bash
npx gradier serve --file src/gradients.json   # port 4747
```

and add the overlay script to your page **in development only**:

```html
<script src="http://localhost:4747/__gradier/overlay.js" defer></script>
```

For example, in Next.js:

```jsx
{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:4747/__gradier/overlay.js" defer />
)}
```

Express / webpack-dev-server users can mount the middleware directly:

```js
import { createGradierMiddleware } from 'gradier/server';
app.use(createGradierMiddleware({ file: 'src/gradients.json' }));
```

## Editor

| Action | How |
| --- | --- |
| Open / close | Click the **Gradier** pill, or <kbd>Alt</kbd>+<kbd>G</kbd> |
| Pick a gradient | Click its label on the page, or use the dropdown |
| Create a missing gradient | Click a yellow `name · click to create` label |
| Move a point | Drag the handle (hold <kbd>Shift</kbd> to snap) |
| Add a point | Double-click the gradient, or **+ Add** |
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

`x`/`y` are relative to the element (0–1). Colours blend in OKLab, which keeps transitions vivid instead of muddy. Everything except the points is a 0–1 value. `speed > 0` animates the gradient, and animation pauses when the gradient is off-screen or the user prefers reduced motion.

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

The save API only accepts requests from localhost origins (and the dev server's own origin). It writes only the one configured JSON file and validates every gradient before writing. The CLI binds to `127.0.0.1`. Pass `--origin https://my.local.dev` to allow another dev origin.

## Develop

```bash
npm install
npm run example         # builds the package, starts examples/vite-vanilla
npm run example:react
npm run dev             # rebuild the package on change
```
