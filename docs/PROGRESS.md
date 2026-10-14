# Progress

Live: https://singha105.github.io/red-vs-blue-skies/ (`?debug=1` shows the FPS counter)
Repo: https://github.com/singha105/red-vs-blue-skies

## Day 1: Foundation and live deploy (2026-10-14)

### Done

- Public repo created; GitHub Pages enabled with source "GitHub Actions". `.github/workflows/deploy.yml` (official Vite workflow: checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5) runs unit tests, builds and deploys on every push to `main`.
- Stack: Three.js 0.186.1 (r186), Vite 8.3.4, TypeScript 7.0.2 (strict + `noUncheckedIndexedAccess`), Vitest 5.0.4, Playwright 1.64.1.
- Folder layout per the plan: `src/core`, `src/game`, `src/render`, `src/net`, `src/ui`, `src/data`, `public/models`, `tools/blender`, `tests/`.
- `CLAUDE.md`, `docs/GAME_DESIGN.md` (from the BUILD_PLAN spec, plus data-field notes).
- Data: `eras.json` (6), `planes.json` (60), `missiles.json` (5 classes, 15 variants), `maps.json` (4), `modes.json` (4). Top speeds and guns come from Wikipedia spec infoboxes where available, with sensible guesses for ammo and variant details; turn rate, climb, roll, HP and countermeasures are balance values from era baselines × a tier factor.
- `src/data/validate.ts` checks every file at startup (types, ranges, unique ids, BR = 1.0 + 0.3 × (tier − 1), tiers 1–10 per era, missiles allowed by era and tier, 2–6 missiles, known gun types, model paths). An invalid file shows a full-screen list of errors with file and path.
- Mobile shell: zoom disabled, full-window canvas, resize/orientation handling, pixel ratio capped at 2 (1.5 on auto, 1 on low), "turn your phone sideways" overlay on touch devices in portrait, safe-area insets.
- PWA: `manifest.webmanifest` (fullscreen, landscape), generated red/blue roundel icons (`npm run icons`), network-first service worker (`public/sw.js`).
- Title screen with Play Solo and Host / Join (56 px+ buttons; stubs that show "coming soon"), version number bottom-right.
- Test scene: sky gradient shader, ocean, three seeded low-poly islands, placeholder box-and-wings plane flying a coordinated banked circle (pure math in `src/game/testFlight.ts`), chase camera.
- Settings module (graphics auto/low/high, sensitivity, aim assist, volume) persisted to localStorage through `src/core/storage.ts`, which falls back to memory if storage throws.
- Fonts (Big Shoulders Display, Barlow Semi Condensed, SIL OFL) are self-hosted in `public/fonts/` so there is no third-party request and they work offline.
- Tests: 12 Vitest tests (data validation incl. negative cases, settings, rng, flight math). Playwright on Desktop Chrome and iPhone 13 landscape (WebKit): title + canvas renders + no console errors, debug FPS counter, PWA files + service worker registration, portrait rotate prompt. Screenshots in `tests/screenshots/`.
- Bundle: ~576 KB JS (144 KB gzip) + ~67 KB fonts + ~27 KB icons. Well under the 10 MB budget.

### Known issues

- Plane data policy (your call, Day 1): real figures where easy to find, sensible guesses for the rest, no deep verification. All 60 planes now have `"verify": false`. Ammo counts and some variant-specific speeds are educated guesses; that is intended.
- Missile loadouts are plausible, not exact: e.g. MiG-19S carrying K-13 is a game choice so tiers 9–10 of Early Jets have missiles as the spec requires; the F-22A and Typhoon use AIM-9X as a stand-in for AIM-9M/ASRAAM; the Gripen uses AIM-9L for IRIS-T.
- Modern era allows semi-active radar missiles (spec table lists only all-aspect IR, HOBS IR and active radar) because the MiG-29A and Su-27S carry R-27R. Noted in GAME_DESIGN.md.
- Graphics "auto" only picks a pixel ratio today; the 5-second FPS measurement is Day 2.
- The 3D bundle is a single 576 KB chunk (Vite warns above 500 KB; limit raised to 800). Fine for now; revisit code-splitting on Day 10.
- Not yet tested on a real iPhone or Android; only Playwright's WebKit iPhone 13 emulation.
- iOS ignores the manifest `orientation`; the rotate overlay covers that case.

### Next steps (Day 2)

- Flight model driven by planes.json, `ControlInput`, mouse-aim/touch/gamepad/keyboard controls, chase camera, Island Chain terrain, graphics auto-detection, HUD.
- Replace the title-scene placeholder flight with the real simulation once it exists.
