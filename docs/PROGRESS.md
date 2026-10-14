# Progress

Live: https://singha105.github.io/red-vs-blue-skies/ (`?debug=1` shows the FPS counter)
Repo: https://github.com/singha105/red-vs-blue-skies

## Day 2: Flight model, controls, first map (2026-10-14)

### Done

- **Simulation** (`src/game`, no Three.js, all JSON-serializable, checked by a unit test): fixed 60 Hz step, render interpolates between steps. `PlaneState` matches the plan's example shape plus `g`, `edgeWarning`, `autoTurn`, `respawnIn`.
- **Flight model** driven by planes.json + eras.json: throttle with spool, thrust from climb rate, drag that balances at top speed, lift that fades below stall speed (soft controls, sagging flight path, nose drop), G-limited pitch, turn bleed ∝ G, dives gain / climbs lose speed, thrust fading to zero at the era's service ceiling, crash on ground or water, edge warning 700 m before the edge and an automatic turn back past it. Respawn in the air after 3 s.
- Jet speeds are compressed above 750 km/h (`gameTopSpeedKmh`: 2,400 → 1,410 km/h) so Mach 2 jets don't cross the 16 km map in 20 s.
- New era fields: `ceilingM`, `stallSpeedRatio` (validated).
- **ControlInput** `{ pitch, roll, yaw, throttle, fire, missile, flare }` is the only thing that steers a plane.
- **Mouse-aim autopilot** (War Thunder / MouseFlight style): PD on pitch/yaw error, aggressive roll toward the target far off the nose, wings-level near it. Aim can lead the nose by at most 75°.
- **Devices**: desktop pointer lock (with a cursor-offset fallback when lock is refused), W/S, A/D, arrows, C free-look, Space/Q/F/L; touch relative-drag aim pad, throttle slider, Fire/Missile/Flare/Level/Look (all ≥ 56 px, safe-area aware); Gamepad API (sticks, triggers, face buttons). Fire/missile/flare are wired but do nothing until Day 3.
- **Chase camera** behind the aim direction with slight lag, FOV 62° → 76° with speed, shake hook.
- **Island Chain**: seeded value-noise heightmap with 14 islands kept clear of spawns, 16 × 16 km, flat-shaded vertex-coloured chunks (2 km, 3 LODs, edge skirts), ocean shader (ripples, fresnel, sun glint), sky with sun, 150 instanced cloud clusters (one draw call), fog.
- **Graphics quality**: auto measures 5 s of frames and picks low/medium/high (pixel ratio 1/1.5/2, shadows on high only, cloud count, draw distance 7/10.5/14 km, LOD distances). `?gfx=` forces a level.
- **HUD** (HTML/CSS, scales with screen): speed, altitude, throttle, G, stall / edge / crash warnings, aim reticle and nose marker, minimap placeholder, control hint, Menu button.
- Title screen keeps the circling plane, now over the real island map. Play Solo starts free flight in a Spitfire Mk V (`?plane=` to pick another).
- **Tests**: 26 Vitest (flight behaviours for all 60 planes, stall/recover, dive/climb, turn bleed, ceiling, crash, edge turn-back, autopilot convergence, respawn, deterministic terrain, JSON round trip, no Three.js in src/game). 12 Playwright: smoke, keyboard flight, crash + respawn, iPhone touch drag moves the aim + throttle slider + button sizes, fps budget.
- **Performance** (perf project, GPU Chromium): high 60 fps with 53 draw calls; low at phone size with 4× CPU throttling 60 fps with 34 draw calls. In the in-app browser on this Mac: 120 fps at high. Bundle 608 KB JS (156 KB gzip).

### Known issues

- Pointer lock is refused inside some embedded browsers (e.g. the Claude app's browser pane); the cursor-offset fallback steers there. Real Chrome / Safari / Firefox should lock normally; not yet tried by hand.
- The headless Playwright shell renders WebGL in software (~12 fps), so the fps test runs in its own `perf` project with the GPU enabled. CI only runs unit tests.
- Mountain Valley and Desert Mesas use the island generator until Day 9; Carrier Strike is open ocean.
- Not yet flown on a real phone; touch was tested with synthetic pointer events in WebKit.
- Flight feel (turn rates, bleed, stall ratio) is a first pass; tune on Day 10 with the bot tournament.

### Next steps (Day 3)

- guns.json, ballistics, hit spheres, damage model, bots on ControlInput + the mouse-aim autopilot, solo 10 vs 10 Team Deathmatch, HUD additions, killcam.

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
- ~~Graphics "auto" only picks a pixel ratio~~ (done Day 2).
- The 3D bundle is a single 576 KB chunk (Vite warns above 500 KB; limit raised to 800). Fine for now; revisit code-splitting on Day 10.
- Not yet tested on a real iPhone or Android; only Playwright's WebKit iPhone 13 emulation.
- iOS ignores the manifest `orientation`; the rotate overlay covers that case.
