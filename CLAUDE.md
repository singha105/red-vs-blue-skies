# Red vs Blue Skies

Always read docs/PROGRESS.md first. It says where the last session stopped.

## Project

"Red vs Blue Skies" is a low-poly multiplayer air-combat browser game for up to 20 players on phones, tablets and laptops, built over 10 days with Claude Code. It runs entirely free: Three.js + Vite + TypeScript, hosted on GitHub Pages (deployed by GitHub Actions on every push to `main`), with one player's browser hosting each match over WebRTC (PeerJS, Day 5), Firebase Spark for progression (Day 8), and Blender headless scripts generating all 60 low-poly planes from specs (Day 4). Red vs blue teams, six eras from WW1 to modern jets, bots fill empty slots.

- Live: https://singha105.github.io/red-vs-blue-skies/ (add `?debug=1` for the FPS counter)
- Repo: https://github.com/singha105/red-vs-blue-skies
- Build plan and daily prompts: `docs/BUILD_PLAN.md`
- Game design (eras, roster, missiles, RP, modes, maps): `docs/GAME_DESIGN.md`
- Progress log, known issues, next steps: `docs/PROGRESS.md`

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173/red-vs-blue-skies/ (also on the LAN for phone testing) |
| `npm run build` | Type-check (`tsc --noEmit`) then build to `dist/` |
| `npm run preview` | Serve `dist/` at http://localhost:4173/red-vs-blue-skies/ |
| `npm test` | Vitest unit tests (data validation and pure game logic) |
| `npx playwright test` | Builds, serves (port 4187), and runs the browser tests: Desktop Chrome, iPhone 13 landscape (WebKit), and `perf` (GPU Chromium fps budget). Screenshots go to `tests/screenshots/` |
| `npx playwright test --project perf` | Just the fps budget: high ≥ 55 fps, low ≥ 30 fps under 4× CPU throttling at phone size |
| `npm run icons` | Regenerate the PWA roundel icons in `public/icons/` |

The Mac has 8 GB RAM: don't leave dev servers running, and stop any server you start when you're done.

## Folder map

```
src/
  main.ts        boot: settings → data validation → renderer → title screen
  core/          loop (fixed 60 Hz), desktop input, playerControls (aim state → ControlInput),
                 quality presets + auto picker, settings (localStorage), env (URL flags)
  game/          simulation: plain serializable data, NO Three.js imports
                 math, terrain (seeded heightmap), flight (energy model), autopilot (mouse-aim PD),
                 controls (ControlInput), ballistics (guns, bullets, hit spheres), world (planes,
                 bullets, damage, kills, respawn, stepWorld), bots (AI → ControlInput), match (solo TDM)
  render/        Three.js only: renderer, mapScene (sky, ocean, terrain LOD chunks, clouds, sun),
                 chaseCamera, planeMesh (merged, 1 draw call), tracers + effects (instanced pools), titleShot
  net/           networking (Day 5): Transport interface, PeerJS adapter
  ui/            HTML/CSS overlays: title, soloSetup, settingsPanel, HUD, results, touch controls,
                 rotate prompt, error overlay, FPS
  data/          JSON data files + types.ts + validate.ts (checked at startup)
  styles.css     global styles; fonts.css declares the self-hosted fonts
public/
  models/        generated .glb files (Day 4+), never hand-edited
  icons/         generated PWA icons
  fonts/         self-hosted OFL fonts (no third-party font requests)
  manifest.webmanifest, sw.js
tools/
  blender/       headless Blender scripts and plane specs (Day 4+)
  make-icons.mjs icon generator
tests/
  unit/          Vitest
  e2e/           Playwright
  screenshots/   Playwright output (committed so changes are visible in diffs)
docs/            BUILD_PLAN.md, GAME_DESIGN.md, PROGRESS.md
```

## Coding conventions

- TypeScript strict mode (plus `noUncheckedIndexedAccess`). No `any`; validate unknown data at the boundary.
- `src/game` must never import Three.js or touch the DOM. Game state is plain JSON-serializable data, because Day 5 sends it over the network.
- Bots and humans drive planes only through `ControlInput`; nothing edits plane state directly (a unit test enforces this for bots).
- Simulation state must stay JSON-safe: no `Infinity`, `undefined` values, Maps or class instances (use `NEVER` / `NO_LIMIT` in world.ts). Randomness comes from `random(world)`, never `Math.random`, in src/game.
- Everything tunable lives in `src/data/*.json`. Balancing means editing numbers, not code. Add new fields to `types.ts` and `validate.ts` at the same time.
- Plane data: use real figures where easy to find (spec sheet or Wikipedia infobox); make sensible guesses for the rest (ammo, variant details, dimensions). Don't do deep historical research.
- Units: meters, seconds, km/h only in data (`topSpeedKmh`), radians inside the simulation, degrees in data.
- Coordinates follow Three.js: +Y up. Models face +Z (glTF convention).
- Every touch target is at least 56 px and respects `env(safe-area-inset-*)`.
- `localStorage` access always goes through try/catch (`src/core/storage.ts`); private browsing must not crash the game.
- Pixel ratio is capped at 2 (1 on low graphics). Reuse geometries and materials; no per-frame allocations in hot loops.
- Small, focused modules. Comments explain why, not what.
- Commit in small steps with clear messages. Run all tests before each commit.

## Rules

1. $0 only: no paid services or assets. Ask the user before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets (nothing from War Thunder or other games). Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.

## Controls and URL flags

- Mouse aim: the mouse moves the aim circle, the autopilot (`src/game/autopilot.ts`) flies the nose (small circle) onto it. Click to capture the mouse; if the browser refuses pointer lock, the cursor's offset from screen centre steers instead.
- Keys: W/S throttle, A/D roll override, arrows fly directly, C free-look, Space fire, Q missile, F flare, L auto-level.
- Touch: drag the right side to aim, throttle slider on the left, Fire/Missile/Flare by the left thumb, Level/Look top right.
- Gamepad: left stick aim, right stick look, RT/LT throttle, A fire, B missile, X flare, Y level.
- Tab (or the Scores button) shows the scoreboard.
- `?debug=1` FPS counter, all planes selectable, `window.__rvbs` test hooks; with debug, `?timescale=N` runs the sim N× faster and `?matchtime=S` shortens the match. `?gfx=low|medium|high` forces a quality level.
- `FULL_MATCH=1 npx playwright test match.spec` plays a full 10-minute match at 10× speed on both viewports.

## Deploy

Push to `main` → `.github/workflows/deploy.yml` runs unit tests, builds, and deploys `dist/` to Pages. Check with `gh run list --limit 3` and `gh run watch`. Vite `base` is `/red-vs-blue-skies/`; asset paths in code use `import.meta.env.BASE_URL`.

The service worker (`public/sw.js`) is network-first, so a normal reload picks up new deploys. If a phone shows an old version, bump `CACHE` in `sw.js`.

## Tools on this machine

- Node via Homebrew. Blender 5.0 at `/Applications/Blender.app/Contents/MacOS/Blender` (not on PATH; always run with `--background`).
- `gh` is logged in as singha105.
