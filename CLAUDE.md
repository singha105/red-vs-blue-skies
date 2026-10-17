# Red vs Blue Skies

Read first, in this order:

1. `docs/PROGRESS.md`: where the last session stopped.
2. `docs/ART_DIRECTION.md`: the look we're going for (terrain, sky, HUD, effects) and what to avoid. It describes another game's screenshots in words; copy nothing from that game.
3. `docs/HOW_TO_PLAY.md`: every control on every device, the HUD, radar, missiles, points. It is the source of the in-game How to play screen and of the README's controls (`npm run docs:readme`; a unit test fails if they drift), so change controls there first.
4. `docs/PLANE_DESIGN_STANDARD.md` (Day 12): the standard every plane model follows (accuracy, moving parts, breakables, cockpit, LODs, paint, the `.aero.json` export contract and node names, budgets, proof). A plane is only "done" when it passes every check.
5. `docs/PLANE_QUEUE.md` (Day 12): all 60 planes with a design status and a physics status each, in build order.

## Project

"Red vs Blue Skies" is a low-poly multiplayer air-combat browser game for up to 20 players on laptops and desktops (since Day 12; phones and tablets get a "please play on a laptop or desktop" screen), built over 10 days with Claude Code and extended since. It runs entirely free: Three.js + Vite + TypeScript, hosted on GitHub Pages (deployed by GitHub Actions on every push to `main`), with one player's browser hosting each match over WebRTC (PeerJS, Day 5), Firebase Spark for progression (Day 8), and Blender headless scripts generating all 60 low-poly planes from specs (Day 4). Red vs blue teams, six eras from WW1 to modern jets, bots fill empty slots.

- Live: https://singha105.github.io/red-vs-blue-skies/ (add `?debug=1` for the FPS counter)
- Repo: https://github.com/singha105/red-vs-blue-skies
- Build plan and daily prompts: `docs/BUILD_PLAN.md`
- Game design (eras, roster, missiles, RP, modes, maps): `docs/GAME_DESIGN.md`
- Progress log, known issues, next steps: `docs/PROGRESS.md`

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:5173/red-vs-blue-skies/ (also on the LAN) |
| `npm run build` | Type-check (`tsc --noEmit`) then build to `dist/` |
| `npm run preview` | Serve `dist/` at http://localhost:4173/red-vs-blue-skies/ |
| `npm test` | Vitest unit tests (data validation and pure game logic) |
| `npx playwright test` | Builds, serves (port 4187), and runs the browser tests: `desktop-chrome` (everything), `desktop-safari` (WebKit: smoke and the device gate), and `perf` (GPU Chromium fps budget). Day 12 dropped the iPhone/touch project; touch-only tests skip. Screenshots go to `tests/screenshots/` |
| `npx playwright test --project perf` | Just the fps budget: high ≥ 55 fps, low ≥ 30 fps under 4× CPU throttling (the "older laptop" profile, 1366 × 768) |
| `npm run test:rules` | Firestore security rules tests on the local emulator (Java; ports 8187, hub/ws defaults) |
| `npm run test:profile` | Starts the auth + Firestore emulators and runs `profile.spec` (RP saved, research, offline queue, Google linking on a second device) |
| `npm run rules:deploy` | Deploy `firestore.rules` to the real project (`npx firebase login` first, with the Google account that owns the project) |
| `npm run icons` | Regenerate the PWA roundel icons in `public/icons/` |
| `npm run terrain` | Bake the land maps' heightmaps (procedural base + hydraulic erosion) to `public/terrain/<map>.png` (16-bit) and `src/data/heightfields.json`; `-- mountain_valley` bakes one. `python3 tools/terrain-preview.py [map]` writes a hillshade to `tools/build/` |
| `npm run textures` | Download the Poly Haven CC0 terrain textures and sky HDRI, encode the textures to KTX2 (ktx2-encoder, Python + Pillow decode), write `public/textures/` and `src/data/textureAverages.json` |
| `npm run docs:readme` | Copy the controls, HUD, radar and missile sections of `docs/HOW_TO_PLAY.md` into README.md |
| `npm run balance` | Bot tournament: 200 1v1 duels per adjacent tier pair in every era (one Vitest process per era, ~40 s), prints the table. `-- before` replays planes.json from git HEAD, `-- tune` runs the HP/turn-rate tuner and writes planes.json. `SEED`, `DUELS`, `ERAS` env. Results in `tests/balance/{before,after,out}/`, write-up in `docs/BALANCE_REPORT.md` |
| `npm run designs` | Rebuild every plane design as Blender files you can open: `designs/all_planes.blend` (all 63 on one floor, a collection per era, labelled) and `designs/<era>/<id>.blend`, with the baked detail texture and blue team paint (gitignored; run `npm run models` first) |
| `node tools/perf/profile.mjs [era plane map mode]` | Slow-device profile (Day 10, phone-sized) against a running `npx vite preview --port 4187`: first load on Slow 4G + 4× CPU, frame times, draw calls, GC pauses, top allocation sites (build with `--minify false` to read names) |
| `npm run models` | Clean rebuild of every plane spec + weapon with headless Blender, meshopt-compress with gltf-transform, write `public/models/<era>/<id>.glb`, `public/models/manifest.json`, `src/data/planeModels.json` and previews; prints sizes. `npm run models -- f4e weapons` rebuilds only some |

The Mac has 8 GB RAM: don't leave dev servers running, and stop any server you start when you're done.

## Folder map

```
src/
  main.ts        boot: settings → data validation → renderer → title screen
  core/          loop (fixed 60 Hz), desktop input, playerControls (aim state → ControlInput),
                 quality presets + auto picker, settings (localStorage), env (URL flags),
                 sound (procedural Web Audio: engines, guns, hits, explosions, UI; buses + iPhone unlock),
                 audio (cockpit seeker/warning tones on the sound engine's context), wakeLock (screen on in rooms
                 and matches)
  game/          simulation: plain serializable data, NO Three.js imports
                 math, terrain (seeded heightmap), flight (Arcade energy model), flightSim (Realistic
                 force-and-moment model, opt-in), autopilot (mouse-aim PD),
                 controls (ControlInput), ballistics (guns, bullets, hit spheres), missiles (seekers, PN
                 guidance, locks, flares/chaff, notching), sun (SUN_DIR for sky + IR seekers), world (planes,
                 bullets, damage, kills, respawn, spawn points, stepWorld), bots (AI → ControlInput, mode
                 objectives too), match (any mode, humans + bots), objectives (zones, ground units, AA, rockets and
                 bombs, bomber waves, scoring per mode), groundLayout (seeded ground target layout per map),
                 teams (split by RP + parties, bot BR balancing), results (RP formula, awards),
                 unlocks (research trees: tiers in order, 200 × tier RP; spawn costs)
  render/        Three.js only: renderer, mapScene (sky, ocean, terrain LOD chunks, clouds, sun),
                 chaseCamera, planeMesh (merged, 1 draw call), tracers + effects (instanced pools: smoke, fire,
                 explosions, contrails, vapour), missiles (missiles, trails, flares, chaff, afterburner glow),
                 pylonMissiles (missiles, rockets and bombs on pylons and in flight), groundUnits (procedural
                 instanced trucks/tanks/bunkers/AA/ships/carriers/depots, zone columns), titleShot,
                 silhouettes (top-view card images rendered from the models); Day 11: terrainMaterial,
                 terrainTextures (KTX2), heightfieldLoader, forest, horizon (distant ranges, far terrain), sky (three Sky)
  profile/       progress (Day 8): model (pure: profile, results, queue, leaderboard ranking), cloud (Firebase
                 Auth + Firestore Lite, lazy-loaded), store (cached profile, offline queue, sync), config (web config)
  app/           session.ts: what the renderer needs from a match (solo or networked); weapons.ts: cockpit
                 missile state (lock box, RWR, warnings, tones) and target picking; tutorial.ts: the first-launch
                 lesson (rings, balloons, drone, flares) as a solo Session with a script
  net/           multiplayer: transport (interface), peerTransport (PeerJS, lazy-loaded), fakeTransport
                 (in-memory, delay/loss, also the host's loopback), protocol (binary input/snapshot),
                 room (host-owned lobby state machine, pure), hostServer (room + authoritative match),
                 clientSession (prediction + interpolation, room/results/chat), roomCode, ice, hostAdvice
  ui/            HTML/CSS overlays: title, howToPlay, tutorialPanel, soloSetup, settingsPanel, HUD, results, touch controls,
                 netScreens (callsign, host/join), roomScreens (lobby, vote, teams, plane select, results,
                 chat), respawn (plane picker with SP costs), research (unlock trees), leaderboard, rotate
                 prompt, error overlay (data errors + the "Copy error" crash card), FPS
  data/          JSON data files + types.ts + validate.ts (checked at startup); objectives.json holds ground
                 units, AA, bomber gunners, rockets/bombs and the AI bombers
  styles.css     global styles; fonts.css declares the self-hosted fonts
public/
  models/        generated .glb files (Day 4+), never hand-edited
  icons/         generated PWA icons
  fonts/         self-hosted OFL fonts (no third-party font requests)
  manifest.webmanifest, sw.js
tools/
  blender/       plane_kit.py (parametric generator), weapons_kit.py, render_preview.py, build_all.py,
                 specs/<id>.json (one per plane, real metres), previews/<id>.png (committed),
                 refs/ (reference drawings, gitignored, never shipped), build/ (raw output, gitignored)
  build-models.mjs  the npm run models driver
  make-icons.mjs icon generator
tests/
  unit/          Vitest
  balance/       bot tournament + tuner (npm run balance; not part of npm test)
  rules/         Firestore rules tests (emulator, npm run test:rules)
  e2e/           Playwright
  screenshots/   Playwright output (committed so changes are visible in diffs)
docs/            BUILD_PLAN.md, GAME_DESIGN.md, PROGRESS.md, BALANCE_REPORT.md, GAME_NIGHT.md, MULTIPLAYER_TEST.md
```

## Coding conventions

- TypeScript strict mode (plus `noUncheckedIndexedAccess`). No `any`; validate unknown data at the boundary.
- `src/game` must never import Three.js or touch the DOM. Game state is plain JSON-serializable data, because Day 5 sends it over the network.
- Bots and humans drive planes only through `ControlInput`; nothing edits plane state directly (a unit test enforces this for bots).
- Simulation state must stay JSON-safe: no `Infinity`, `undefined` values, Maps or class instances (use `NEVER` / `NO_LIMIT` in world.ts). Randomness comes from `random(world)`, never `Math.random`, in src/game.
- Everything tunable lives in `src/data/*.json`. Balancing means editing numbers, not code. Add new fields to `types.ts` and `validate.ts` at the same time.
- Plane data (planes.json gameplay stats): use real figures where easy to find (spec sheet or Wikipedia infobox); make sensible guesses for the rest (ammo, variant details). Plane **models** rebuilt from Day 12 on follow `docs/PLANE_DESIGN_STANDARD.md` instead: researched dimensions, three-views, airfoils and control surfaces, each with a recorded source.
- Units: meters, seconds, km/h only in data (`topSpeedKmh`), radians inside the simulation, degrees in data.
- Coordinates follow Three.js: +Y up. Models face +Z (glTF convention).
- Buttons are at least 44 px; the old touch layer (56 px touch targets, safe-area insets) stays in the repo but is no longer maintained (Day 12).
- `localStorage` access always goes through try/catch (`src/core/storage.ts`); private browsing must not crash the game.
- Pixel ratio is capped at 2 (1 on low graphics). Reuse geometries and materials; no per-frame allocations in hot loops.
- Small, focused modules. Comments explain why, not what.
- Commit in small steps with clear messages. Run all tests before each commit.

## Rules

1. $0 only: no paid services or assets. Ask the user before adding any new external service or account.
2. **Laptops and desktops only** (Day 12): every feature must work in Chrome, Edge, Firefox, and Safari on Mac, with mouse and keyboard and with a gamepad (joysticks from Day 13). Phones and tablets get the "Please play on a laptop or desktop" screen (`src/core/device.ts`); the touch code stays but isn't maintained.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget (Day 12): High holds 60 fps on the user's Mac (Apple Silicon, 8 GB) with 20 planes in the match; Low holds 30 fps on an older laptop with integrated graphics. The first match is playable within 15 s on a 50 Mbps connection, with LOD0 streaming in afterwards, and the service worker caches models so later visits load fast. Each plane's full download (all LODs and textures) at most 10 MB; the published site at most 900 MB; never commit a file over 50 MB (near 1 GB of repo, build models in Actions instead). Every visual upgrade has a quality-tier switch (Low, Medium, High, Ultra).
5. No copyrighted assets (nothing from War Thunder or other games). Build every model yourself from scripts in the repo; never download or copy 3D models; reference images stay out of git (`tools/blender/refs/`). Make everything else or use CC0 (Poly Haven textures and HDRIs) and OFL fonts, credited in the README.
6. Finish by updating docs/PROGRESS.md and docs/PLANE_QUEUE.md, committing, pushing, and confirming the live deploy.
7. A plane is only "done" when it passes every check in `docs/PLANE_DESIGN_STANDARD.md`.

## Multiplayer (Days 5–6)

- **The host owns all lobby and match state.** Clients only send requests (`ClientMsg` in protocol.ts: ready, party, vote, pick, respawn, again, chat); `src/net/room.ts` checks each against the phase and the rules. Host-only controls (start vote, override, settings, kick, play again) are direct calls on `HostServer` from the host's own UI.
- Room phases: lobby → vote → teams → select → playing → results → lobby. The host broadcasts the whole `RoomState` when it changes (≤10/s) and once a second. Timers are sent as "ms left" and counted down locally.
- Each match gets its own `WorldContext` for the voted map; `main.ts` keeps one scene per map (`useMap`). Bots get their planes from `balanceBots` (team BR within 10%); joins mid-match and respawn-plane changes call `rebalanceBots` (bots switch at their next respawn). A respawn in a different plane bumps the roster version.

- One player's browser hosts: `HostServer` runs the real match (bots included) and alone decides hits, damage, kills and scores. Everyone, the host's own player included, is a `ClientSession`; the host's runs over a zero-delay `FakeNetwork` loopback joined to PeerJS with `combineHosts`. Per 60 Hz step: `session.step` → `loop.advance` → `server.tick`.
- PeerJS public signaling, peer id `rvbs-<CODE>`, 4-letter codes without I/O. Each client opens two DataConnections: `r` (reliable, ordered: JSON events) and `u` (unordered: binary inputs 30/s, snapshots 20/s, pings). PeerJS can't turn retransmits off, so `u` is unordered but still reliable.
- No bullets on the wire: the `firing` flag drives local cosmetic tracers. Own plane predicted and reconciled; others drawn 100 ms behind, extrapolated up to 250 ms.
- Host validation: inputs clamped on decode, token bucket 70/s, seq must increase, fire rate is whatever the sim allows (real rpm), different `__APP_VERSION__` is rejected.
- Missiles (Day 7) are host-simulated and sent in snapshots (17 B each); the input carries the picked target as a roster slot; launch/detonate/decoy are reliable events and clients fly flares and chaff locally.
- TURN: `VITE_TURN_DOMAIN` + `VITE_TURN_API_KEY` in `.env` (gitignored) and as GitHub Actions secrets for the deploy build. The Metered apiKey only fetches TURN credentials, so it's fine in the bundle; never put the Metered secret key anywhere.
- Change the protocol in `src/net/protocol.ts` only, and keep `tests/unit/net.test.ts` (fake transport with delay/loss) passing. `tests/e2e/multiplayer.spec.ts` (movement, bandwidth, host left) and `multiplayer-loop.spec.ts` (two full rounds, BR check) run 1 host + 2 clients (one on a small laptop screen) against a local PeerJS server (`tests/e2e/peer-server.mjs`, port 9187), or the public one with `BASE_URL`/`PUBLIC_SIGNAL=1`. Shared steps are in `tests/e2e/netHelpers.ts`.

## Progress: Firebase (Day 8)

- Firebase project `red-vs-blue-skies`, **Spark plan only** (never enable billing or Blaze-only features such as Cloud Functions or Storage). Web config in `src/profile/config.ts` (public by design). Console: https://console.firebase.google.com/project/red-vs-blue-skies
- Anonymous sign-in on first launch (the uid persists in IndexedDB, so it works offline); Settings → "Link Google account" uses `linkWithPopup` (redirects break on github.io in Safari/Chrome). If that Google account already has a profile, the device switches to it.
- Data: `players/{uid}` (callsign, rp, unlocked per era, stats, friends, lastMatch, lastUnlock, createdAt), `matches/{matchId}` (host, participants, createdAt), `matches/{id}/results/{uid}` (rp, kills, deaths, assists, won, createdAt). The host creates the match record (`MatchRecorder` in hostServer.ts) and sends `matchId` + uids in `start`; each player saves its own row in one batch with the profile increments.
- `firestore.rules` is the anti-cheat: own profile only; RP rises only by a result created in the same batch (≤ 3,000, participant, match < 1 h old, once); RP falls only by buying the next tier at 200 × tier. Change the rules → `npm run test:rules` → `npm run rules:deploy`.
- Offline: results queue in localStorage (`rvbs.pending.v1`) and sync on start, on the browser's `online` event and every 60 s. Firestore Lite (no listeners, no SDK cache). The game never waits for Firebase.

## Controls and URL flags

- Controls (Day 11, War Thunder style; the full list per device is `docs/HOW_TO_PLAY.md`): every action is in `src/data/keybinds.json` (keyboard codes, `MouseLeft/Middle/Right`, gamepad buttons by Xbox name). `src/core/keybinds.ts` resolves them with the player's changes (localStorage `rvbs.keybinds.v1`, only changed actions saved), finds conflicts, resets; the Controls screen (`src/ui/controlsPanel.ts`, from Settings and the in-match menu) rebinds two slots per action. `src/core/input.ts` applies the flying actions every frame and queues one-shot presses that `main.ts` `handlePresses` reads with `takePress`.
- Mouse aim (default): the mouse moves the aim circle, the autopilot (`src/game/autopilot.ts`) flies the nose onto it; rudder (Q/E, ramped over 0.3 s in `playerControls.ts`) adds yaw on top. Mouse joystick (Settings): the mouse moves the stick (`controls.stick`), which drifts back to centre. Click to capture the mouse; Esc (or the browser releasing it) opens the in-match menu (`matchOverlays.ts`), which pauses solo. If pointer lock is refused, the cursor's offset from screen centre steers instead.
- Default keys: W/S throttle (hold W at 100% for WEP), A/D roll, Q/E rudder, H airbrake, F flaps down a step / Shift+F up a step (Up, Combat, Takeoff, Landing), G gear, L level, left mouse guns, Space missile/rocket/bomb, N switch secondary (Day 12; was Left Shift, now a modifier), middle mouse or T select target (again within 1.5 s: next), X flares + chaff, 1/2/3 radar power/mode/range, R radar lock, C free look, V look back (hold; Settings → toggle), right mouse zoom, B view (chase → cockpit → HUD on jets), Tab scores, M map, Enter chat, J quick chat, Esc menu, P pause (solo). Arrows fly directly.
- Day 12 binding forms: `Shift+KeyF` (a key with Shift held; that press doesn't also fire the plain key's action) and gamepad `View:hold` (fires after 0.5 s; a shorter press of that button is a tap, and held actions on it, the scoreboard, toggle). Look back is `controls.lookBack` / `lookBackT` (eased 0–1 over 0.15 s, `LOOK_BACK_S`); while it's on, free-look semantics hold the aim. Cockpit view puts the camera at the model's `eye` point (planeModels.json; `tools/eye-from-spec.mjs` derives it for classic specs) and draws the own plane in `mapScene`'s near pass (`setNear`, 3 cm near plane).
- ControlInput (Day 11/12 fields are optional): `wep`, `airbrake`, `flaps`, `flapStep` (0–3), `gear`, `radarOn`, `radarDogfight`, `radarRange`, `radarLock`, `secondary`. PlaneState has `wep`, `engineHeat` (0–1), `overheatFor`, `airbrake`, `flaps`, `radar*`, `secondary`. 100% throttle without WEP is `MIL_THRUST` (0.85 of full thrust, ~92% of top speed); WEP heats the engine over the era's `wepTimeS` (eras.json); at full heat the engine runs at 45% for 10 s. Bots use WEP at full throttle until the engine is 85% hot. The afterburner glow and IR heat follow `p.wep` on jets.
- **Flight models**: Arcade (`flight.ts` `stepPlane`, default: the stick sets pitch/roll/yaw rates and the flight path follows the nose) and Realistic (`flightSim.ts` `stepPlaneSim`, Settings → Flight model, solo matches only for now: `world.flightModel === 'realistic'`, set by `MatchOptions.flightModel`). Realistic: stick → control surfaces with servo rates → moments ∝ ρv², damping ∝ ρv; lift from angle of attack (linear to 15°, then stall and wing drop), induced drag, sideslip with weathervane, side force and dihedral roll, adverse yaw, flaps (+38% lift), airbrake, density with altitude, damaged wings roll. `simParams` calibrates every plane from FlightParams (stall speed at 1 G, top speed at full power, listed roll rate at corner speed, listed turn rate as the best sustained turn via induced drag; 8 planes are wing-limited at 70–96%), cached in `ctx.sim`. Extra state lives in optional PlaneState fields (`rates`, `surfaces`, `flapPos`, `aoa`, `slip`), absent in Arcade. Both models share `stepEngine`, `thrustFor` and `checkEdgeAndGround`. The mouse-aim autopilot adds an integral trim only when `s.rates` exists. Next phases: room setting + protocol for multiplayer, bot retune and balance run, model control surfaces as separate nodes in the Blender kit, animated by `surfaces`. `tests/unit/flightSim.test.ts` holds the calibration and behaviour checks.
- Radar (`src/game/radar.ts`, jets with a `radar` block in planes.json: rangeKm, coneDeg as the half-angle, modes): Search locks the picked target (or nearest the nose) when `radarLock` is asked; Dogfight auto-locks inside 10° up to 10 km; a lock survives 1 s out of sight. Radar missiles need the radar lock to lock, and semi-active ones guide only while it holds and sees the target that tick. The RWR shows radar locks (orange) separately from seeker spikes. Validation requires a radar for any plane with radar missiles.
- Cockpit display: `src/ui/flightHud.ts` (one canvas; reflector sight + gauges for props, gyro sight for early jets, full green HUD for Cold War/Modern; units setting) and `src/ui/radarPanel.ts` (bottom-right card: scope with sweep, RWR, THR/HEAT/HULL bars; tap a contact on touch to select it). `main.ts` `drawCockpit` builds both frames. The old HTML speed readout and RWR are hidden by CSS.
- Touch: drag right half to steer, slider (top 12% band = WEP), FIRE, MSL (+ › switch), CM, RDR (tap lock, long-press mode), LEVEL, eye (drag to look), ZOOM; tap the scores for the scoreboard; Settings: rudder buttons, tilt steering (`requestTiltPermission` from the settings tap). Touch-held zoom/rudder/look live in `controls.touch` so the desktop input doesn't overwrite them.
- Gamepad: left stick steer, right stick look (hold the click: look back), LS zoom, RT/LT throttle (LT at idle = airbrake), LB/RB rudder, A guns, B secondary, X switch, Y target, d-pad down CM / up lock / left mode / right range, View tap scores / hold view, Menu menu; gear and flaps unbound.
- Protocol (Day 12): input is 13 bytes (the last byte: flap step and gear); before that (Day 11) it was 12 bytes (buttons byte carries WEP, airbrake, flaps, radar lock, radar on; an extra byte has dogfight, range and secondary); planes are 26 bytes (throttle 255 = WEP lit, plus the radar lock slot); the own-weapons trailer adds engine heat, overheat seconds and the secondary pick.
- Solo setup: era, plane, difficulty, plus Map and Mode buttons in the header that cycle on each tap.
- Touch: drag the right side to aim, a quick tap on an enemy picks it as the missile target, throttle slider on the left, Fire/Missile/Flare by the left thumb (the Missile button shows a lock ring), Level/Look top right.
- Gamepad: left stick aim, right stick look, RT/LT throttle, A fire, B missile, X flare, RB next target, Y level.
- Tab (or the Scores button) shows the scoreboard.
- Settings (Day 10): 30 fps cap (`cap30`, the loop skips display frames; auto quality then never picks high), colour-blind team colours (`setTeamPalette` in planeMesh.ts repaints TEAM materials and sets `html[data-teams]` for CSS `--red`/`--red-hi`), HUD size (`--hud-scale`, CSS `scale` on the anchored HUD panels, 1–1.6 so text stays ≥ 14 px), invert pitch (`controls.invertPitch`).
- Tutorial: offered on first launch (`rvbs.tutorial.v1` in storage; never to automated browsers unless `?tutorial=1`, never with `?room=`). Hooks: `startTutorial()`, `tutorial()`, `tutorialNext()`. Its planes are `z1`/`z2`: **missile target ids starting with "d" are decoys** (missiles.ts), so never give a plane such an id.
- `?debug=1` FPS counter plus Firestore reads/writes (this match and this session), `window.__rvbs` test hooks (`startSolo({era, planeId, map, mode})`, `objectives()`, `sound()`, `placeNearUnit(kind)`…); all planes selectable **only on localhost** (`&locks=1` keeps the real unlocks); with debug, `?timescale=N` runs the sim N× faster and `?matchtime=S` shortens the match. `?gfx=low|medium|high` forces a quality level.
- With `?debug=1`: `&emu=1` (localhost) uses the Firebase emulators, `&offline=1` pretends Firebase is unreachable. Automated browsers (Playwright) never touch the real Firebase unless the page has `&fb=1`.
- `?room=CODE` opens the callsign step for that room (the lobby's share link and QR use it). With `?debug=1`, a network match shows ping, loss, snapshots/s and KB/s in and out, and `?signal=host:port` uses a local PeerJS signaling server.
- `FULL_MATCH=1 npx playwright test match.spec` plays a full 10-minute match at 10× speed.
- `?anydevice=1` skips the phone/tablet screen (so does its "Continue anyway", remembered in `rvbs.anydevice.v1`).

## Deploy

Push to `main` → `.github/workflows/deploy.yml` runs unit tests, builds, and deploys `dist/` to Pages. Check with `gh run list --limit 3` and `gh run watch`. Vite `base` is `/red-vs-blue-skies/`; asset paths in code use `import.meta.env.BASE_URL`.

The service worker (`public/sw.js`) is network-first, so a normal reload picks up new deploys. If a phone shows an old version, bump `CACHE` in `sw.js`.

## 3D models

- Blender: `/Applications/Blender.app/Contents/MacOS/Blender` (5.0), always `--background --factory-startup`. Override with `BLENDER=/path`.
- Every model is reproducible from `tools/blender/specs/<id>.json` + the kits. Never hand-edit .glb files or download models; fix the spec or kit and rerun `npm run models`.
- Frame: models face +Z, +Y up, +X is the left wing; real metres; origin at mid-fuselage. Materials BODY, TEAM (white, tinted red/blue in game), GLASS, DARK; colours are vertex colours.
- Named nodes the game uses: `prop` (spins about its local Z), `muzzle_N`, `pylon_N`, `exhaust_N`. Spec guns carry a `mount` index into the plane's `guns` list in planes.json.
- Budgets (Day 11): the detailed model up to 3,000 triangles for props, 4,000 for jets, 6,000 for the AI bombers; the low-poly LOD (`<id>_lod.glb`) keeps the old 1,200 / 1,500 / 2,000. `plane_kit.set_detail("high" | "mid" | "low")`: high doubles ring sides, adds Catmull-Rom loft rings and span stations, rounds the airfoils (8 points) and shades smooth with edges sharper than 38° kept; build_all.py takes the finest level under budget. Faces are recalculated outward (bmesh) so smooth shading and AO work.
- Detail texture (`tools/blender/bake_kit.py`): smart-UV unwrap, Cycles bakes of AO, object-space position (panel lines drawn in numpy: frames every 1.1 m, ribs every 1.3 m, a spine) and a TEAM-material mask, into `<id>_detail.png` (RGB = AO × lines, A = team mask) → `<id>_detail.ktx2` (ETC1S via ktx2-encoder). In game (`render/models.ts`): Low loads only LODs (Lambert, flat); Medium/High load the detailed model + texture (MeshStandardMaterial: paint × detail, team colour where the mask is) and switch to the LOD beyond ~380 m (THREE.LOD). `PlaneVisual.props` holds every level's propeller.
- The jet specs (every jet except the hand-written mig15bis and f4e) are written by `python3 tools/blender/make_jet_specs.py`; the Day 9 prop specs and the three AI bombers (`era: "bombers"`, `public/models/bombers/`) by `python3 tools/blender/make_prop_specs.py`. Edit those scripts, not their JSONs (hand-written: sopwith_camel, fokker_dr1, spitfire_mk5, f4u4, mig15bis, f4e). Kit extras: `pods` (nacelles, booms with `xEndM`, tip tanks), `chin_intake`, `scoops` (radiators), `gear` (fixed gear, spats), `engine.pusher` (DH.2), `colors.wing`, `fin_only` tails, canards/LERX as extra wing entries; xM 0 on a fuselage pylon is one centreline pylon. `planeModels.json` records each plane's `engine` sound type (rotary/radial/inline/jet).
- To add a plane: write its spec, `npm run models -- <id>`, look at `tools/blender/previews/<id>.png` next to a reference in `tools/blender/refs/`, adjust, repeat (up to 3 passes).
- In game: `src/render/models.ts` loads only the current era's models (plus that era's bomber in Bomber Escort); every plane has a model since Day 9. Hit spheres and muzzle positions come from `src/data/planeModels.json`. Ground targets and carriers are built in code (`src/render/groundUnits.ts`), not downloaded.

## Terrain and graphics (Day 11)

- **Baked terrain**: `src/game/terrain.ts` holds the procedural base (ridged multifractal on gradient noise for Mountain Valley's alpine peaks); `tools/bake-terrain.mjs` bundles it with rolldown, erodes it (droplet hydraulic erosion + talus) and writes a 16-bit PNG per land map. At runtime `createTerrain` samples the baked grid (`heightfield.ts`, bilinear) plus seeded micro-relief; the procedural base is only the fallback until the PNG has loaded. **Change terrain → `npm run terrain` → commit the PNGs**, or the sim and the shipped maps disagree. Unit tests register the PNGs (`tests/unit/setupTerrain.ts`, also in the balance config); the browser loads them with `render/heightfieldLoader.ts` (DecompressionStream + PNG unfilter). `main.ts` starts every map's download at boot, `startSolo` awaits its map, and a map scene built before its heightmap arrived is rebuilt (never mid-match).
- **Map look data** (maps.json): `sun` (azimuth/elevation; the sim's IR seekers use it too via `ctx.sunDir`), `snowLineM`, `forestColor`, `horizonRangeM`.
- **Rendering** (`render/mapScene.ts`): two passes per frame, `mapScene.render()`: a backdrop scene (three.js `Sky` with a cirrus layer and a horizon haze band, the distant ranges ring `horizon.ts`, a coarse copy of the whole map `createFarTerrain`, a backdrop sea; far plane 60 km) and then, after clearing depth, the map (FogExp2 haze tuned to the tier's draw distance). Tone mapping ACES filmic on every tier (renderer.ts).
- **Terrain mesh** (`terrainMesh.ts`): 2 km chunks, levels 96/48/24/12 cells, chosen per chunk by distance to its nearest point; coarsening first morphs vertices onto the coarser surface (`morphY` attribute, per-chunk `uMorph`; one material instance per chunk because built-in materials only upload uniforms when the material changes), so LOD never pops; skirts hide cracks.
- **Terrain shading** (`terrainMaterial.ts`, MeshStandardMaterial + onBeforeCompile): per-pixel sand / grass / forest floor (from the forest density map) / triplanar rock on steep slopes / snow above `snowLineM` on flatter ground, every threshold broken up by noise. Medium/High use the Poly Haven KTX2 textures as detail on the palette colour (texel ÷ the texture's average from `textureAverages.json`), High adds detail normals near the camera; Low uses palette colours with noise. KTX2 needs `public/basis/` (three's Basis transcoder, copied in).
- **Forests** (`forest.ts`): placement rules (altitude band, slope, moisture noise) → a 256² density map (terrain shader reads it too) → jittered-grid trees per 4 km tile. 3D instanced pines and broadleaf near the camera (rebuilt every 120 m of camera movement), camera-facing impostors from a runtime-rendered atlas elsewhere, crossfaded with an ordered dither, fading into the haze. Counts and distances per tier (`FOREST_TIERS`): High ~410k trees on Mountain Valley at 60 fps on this Mac.
- **Sky and weather**: billboard cumulus clusters you can fly through (`clouds.ts`, thin to mist up close); water is the cheap shader on Low/Medium and a reflective PBR surface with an animated normal map on High (`ocean.ts`).
- **Quality tiers** (`core/quality.ts`): every Day 11 visual has a switch (textures, detail normals, forest tier, IBL, reflective water, bloom, shadows, horizon ranges, clouds, draw distance). Day 12: Low (older laptops with integrated graphics), Medium, High, **Ultra** (LOD0 planes at longer range `planeLodScale`, 4K hangar textures `hangar4k`, 4096² shadows `shadowMapSize`); the auto picker never chooses Ultra. Debug hooks: `forest()` (tree counts), `placePlayer(x, z, aglM, headingDeg)`.
- **Effects and post** (Part C): particles are textured camera-facing sprites in one draw (`effects.ts`; premultiplied blend: smoke covers, fire/flashes/sparks add light at 5–8× white); tracers, missile motors, flares and afterburners (orange disc + white core) are above white too, so bloom (`post.ts`: EffectComposer → UnrealBloomPass, threshold 3 → OutputPass for ACES + sRGB; Medium/High) only lights real light sources. Jets out of afterburner get a dull heat glow (`GlowSource.heat`). Wingtip vapour ribbons above 6 G (5 for props) in `ribbons.ts` (one dynamic buffer). Low skips bloom, ribbons and heat glow.
- **WebGPU** (Part C): `?debug=1&webgpuprobe=1` runs `src/dev/webgpuProbe.ts` (three's WebGPURenderer vs the WebGLRenderer on one benchmark scene, dynamically imported; perf.spec and webgpu-probe.spec run it). The game stays on WebGL: see PROGRESS.md for the numbers and why (its GLSL ShaderMaterials and onBeforeCompile shaders don't run on WebGPURenderer).
- Test-only knobs: automated browsers start on Low unless `?gfx=` says otherwise (software rendering); `?debug=1&renderscale=0.5` draws fewer pixels (the three-page multiplayer specs use it). `__rvbs.part(name, visible)` hides one part of the map scene for profiling.
- Screenshots: `tests/e2e/terrain-shots.spec.ts` (Mountain Valley from the spawn on Low and High, plus low over the forest; `SHOT_TAG=before` against the old live site made the Day 11 "before" pictures).

## Modes (Day 9)

- `world.objectives` (objectives.ts) holds the mode: zones, ground units (positions follow from the match clock and `ctx.layout`, so clients only get health + firing bits), rockets/bombs in flight, and Bomber Escort's wave state. `match.score` is kills (TDM), tickets left (Air Domination, Ground Strike) or points (Bomber Escort); `scoreDeath`/`checkEnd` apply each mode's rules.
- AI bombers are ordinary planes with pilot `role: 'bomber'` (ids `B1`…), added after the players; they never respawn on their own, don't count as seats, and are left out of team BR, scoreboards and results. `isBomber(world, id)`.
- Network: the `start` message carries `mode`, the host's ground `layout` and the `escort` team; snapshots carry zone progress/owner and one byte per unit; `drop` events let clients fly rockets and bombs cosmetically.
- Sound: one AudioContext (`createSound`), buses engine / weapons / cockpit / ui with sliders in Settings; unlocked on the first pointerdown/touchend/keydown with a silent buffer; `navigator.audioSession.type = 'playback'` where supported.

## Day 10 notes

- Balance is data: after editing planes.json run `npm run balance` and keep every adjacent pair 55–80% (the tuner aims at ~65% because one 200-duel run has ±3.5% noise). Only HP and turn rate are tuned; real speeds, guns and missiles stay.
- Bots break off a turning stalemate (12 s on the same close target with no shot, target neither fleeing nor pointing at them) and extend for 10 s (`STALEMATE_S`, `EXTEND_S` in bots.ts).
- Convoys move at their slowest vehicle's speed (`unitSpeedMs`) and keep 8 m right of the road, so the column never overlaps itself.
- Background/foreground: on `visibilitychange` hidden, held keys and touch buttons are released and sound is suspended; a host's hidden tab keeps stepping on a timer (`loop.keepRunningHidden`); a client that lost the connection while hidden (within 20 s) rejoins its room automatically (`joinRoom(code, true)`; test hook `lockAndDrop()`).
- Errors: `installErrorOverlay` catches `error` and `unhandledrejection` (ignoring ResizeObserver, cross-origin "Script error." and extensions) and shows one card; `body[data-screen]` names the screen in the report.
- `day10.spec.ts` covers the crash card, tutorial and settings. (Day 10's `mobile.spec.ts` phone layout audit was removed on Day 12; `desktop-only.spec.ts` checks the phone/tablet screen.)

## Tools on this machine

- Node via Homebrew. Blender 5.0 (see 3D models above; not on PATH).
- `gh` is logged in as singha105.
