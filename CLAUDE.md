# Notes for Claude

## Always merge finished work into `main`

The owner tests locally with `npm run live` (see `scripts/live.mjs`), which only pulls `main`.
Work on any other branch is invisible to them until it lands there. So, once a change is done:

1. Make sure these pass:

   ```bash
   npm run typecheck && npm run build && npm test -w gradier
   ```

2. Commit on your working branch, then merge it into `main` and push both:

   ```bash
   git fetch origin main
   git checkout -B main origin/main
   git merge --no-ff <your-branch>
   git push origin main
   git checkout <your-branch> && git merge --ff-only main && git push origin <your-branch>
   ```

3. Tell the owner the change is on `main`. `npm run live` picks it up within about 15 seconds; then they refresh the browser.

No pull request is needed unless the owner asks for one.

## UI conventions

- Icons come from Phosphor (`@phosphor-icons/core`, regular weight), imported as SVG strings in
  `packages/gradier/src/overlay/icons.ts`. Size them with CSS, not attributes.
- Motion follows Emil Kowalski's animation skills, installed in `.claude/skills/` (MIT). Use `animate` when adding
  motion and `review-animations` before shipping it. In short: strong ease-out curves (tokens on `.root`), UI motion
  under 300ms, `transform`/`opacity` only (measured height for collapsing blocks), no animation on keyboard-triggered
  actions except opening/closing the panel and the expanded view (Alt+G, F, Esc animate like their buttons, as the
  owner asked), and a reduced-motion variant that keeps fades but drops movement.
