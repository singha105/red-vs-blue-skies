# Progress

Live: https://singha105.github.io/red-vs-blue-skies/ (`?debug=1` shows the FPS counter)
Repo: https://github.com/singha105/red-vs-blue-skies

## Day 11: Post-launch update (2026-10-16) — IN PROGRESS, read this first

**Handoff (usage limit reached mid-Part C).** Commits: Part A `fe0774c` (controls, HUD, radar; pushed, all tests green), Part B `8bc16bc` (baked eroded terrain, terrain shader, geomorph LOD, forests, sky, clouds, water, IBL, tone mapping, plus effects/bloom/ribbons/WebGPU probe; pushed). Part C models are committed locally in the next commit but **not pushed and not yet e2e-tested**.

Done in Part C so far: plane kit detail levels + Blender bake (AO, panel lines, team mask → KTX2) for all 63 planes (`npm run models`: 1,139–1,911 triangles detailed, 291–493 LOD, 6.4 MB total); model unit tests pass. Game loader (`render/models.ts`) uses LODs on Low, detailed + texture on Medium/High.

Measured: perf project 60 fps on every profile (draw calls 59–130 incl. bloom passes); High low over Mountain Valley's forest: 404,516 trees, 15,357 in 3D, 60 fps. **WebGPU probe**: GPU Chromium WebGPURenderer 53.5 / 59.9 fps vs WebGL 58.0 / 60.0 (two runs, vsync-capped), Playwright iPhone WebKit 51.7 vs 57.7 → not faster, and the game's GLSL ShaderMaterials / onBeforeCompile shaders don't run on WebGPURenderer, so **WebGL is kept**. Not tried on a real iPhone.

Still to do (in order):
1. Look at the new models in game (hangar + flight on Medium/High) and the previews in `tools/blender/previews/`; fix anything odd in the kit.
2. Run all tests (`npm test`, `npx playwright test` ~21 min; tests are slower now in software rendering), fix, commit.
3. `npx vite preview --port 4187` + `node tools/perf/profile.mjs island_chain` (it now prints "first match playable" on Slow 4G; target < 8 s); check `du -sh dist` < 25 MB (was 10 MB before models).
4. Re-run `npx playwright test terrain-shots --project desktop-chrome` for the final after shots (before shots are in tests/screenshots/mountain-valley-before-*.png).
5. Write the full Day 11 section here, push, confirm the deploy (`gh run list`), run the suite against the live site with `BASE_URL`.
Owed by the user from earlier days: the 6-player game night, sound on a real iPhone. TURN key still pending.

## Day 10: Performance, mobile QA, balance, launch (2026-10-15)

### Done

- **Bot tournament** (`npm run balance`, `tests/balance/`): 200 seeded 1v1 duels per adjacent tier pair in every era (54 pairs, 10,800 duels, ~40 s with one process per era). Before: 33 of 54 pairs outside 55–80% (10% to 98%, several inverted). Fixes: a bot stalemate breaker (jets circled each other for the whole 3 minutes), three tier swaps (Spitfire Mk XIV ↔ Me 262, MiG-19 ↔ F-8, Rafale ↔ Typhoon), and an automatic tuner on HP and turn rate only. **After, on a seed the tuner never saw: every pair 56.3–74.2%.** A first fresh-seed check had four pairs at 49.5–53%, so I re-tuned with 400 duels per round and aimed at 66%. Everything is in `docs/BALANCE_REPORT.md`.
- **Tutorial** (`src/app/tutorial.ts`, `src/render/tutorialProps.ts`, `src/ui/tutorialPanel.ts`): offered on first launch, about 70 s: four rings, three balloons (with the lead diamond), an R-73 at a target drone, then flares against an enemy K-13 from behind. Instructions in each device's words, Skip, and Settings → Play the tutorial again. The plane is repaired and re-armed every step; a crash restarts the step. A unit test flies the whole thing with the autopilot.
- **Accessibility**: colour-blind team colours (blue and orange: plane paint, ground pennants, zones, markers, minimap, kill feed, scoreboard; the logo keeps red), HUD size 100–160%, invert pitch (mouse, drag, stick, arrows). Every warning sound already has a visual (lock box and ring for the seeker tones, the RWR display, the MISSILE launch warning with its counter, stall/edge text, damage arrows and hit markers); Settings now says so.
- **Mobile QA** (researched current iOS Safari / Android Chrome quirks, see below): `tests/e2e/mobile.spec.ts` audits five landscape phones (667×375 to 932×430) on the title, settings, How to play, setup and the flight HUD. It found 30+ text styles under 14 px; all are 14 px or more now. No overlapping or off-screen buttons. 30 fps cap option; the Screen Wake Lock keeps the screen on in rooms and matches; on `visibilitychange` held keys and touch buttons are released and sound is suspended; a phone that drops out while locked rejoins its room by itself ("Reconnecting to room …"); a phone host sees a 9 s warning at match start that locking ends the match; a host's hidden tab keeps the match running on a timer instead of freezing everyone. PWA (manifest, maskable icon, apple-touch-icon, viewport-fit=cover, home-screen metas) checked; service worker cache bumped to `rvbs-v2`.
- **Error overlay**: uncaught errors and rejections show "Something went wrong" with **Copy error** (version, screen, page, browser, window size, stack), Reload and Keep playing; later errors bump a count.
- **How to play** (title): Phone / Keyboard + mouse / Gamepad / Modes + unlocks / Hosting / Credits, opening on your device's tab. README rewritten (controls for every device, hosting, unlocks, settings, credits). **v1.0.0** on the title screen; CHANGELOG.md; docs/GAME_NIGHT.md.
- **Bug bash** (PROGRESS known issues, worst first):
  - Fixed: convoys drove through each other (trucks at 32 km/h and the tank at 26 km/h shared one road; convoys now move at the slowest vehicle's speed and keep 8 m right of the road, so the column passes itself at the ends; tested at every land map for 10 minutes); Island Chain's red half had no convoy (shorter roads allowed on small islands; every land map now has two per team); the host tab had to stay visible (now keeps running); moving any Settings slider restarted the automatic graphics test; text under 14 px on phones; phones dropping out for good after a lock.
  - Not changed (design limits, not bugs; no new features today): ground units don't collide and ships don't wake; bombers bomb by flying over and their gunners have all-round arcs; rockets and bombs only hurt ground targets; engine sound for the three nearest planes, no doppler; a wreck still falling at respawn explodes mid-air; notching is all-or-nothing; friends-grade anti-cheat; no offline unlock purchases.
  - No friends' bug reports yet (the prompt's notes were empty): game night is the next step.

### Performance

Phone proxy (`node tools/perf/profile.mjs`): GPU Chromium at 844×390 @3x, 4× CPU throttling, low graphics.

| | Before | After |
| --- | --- | --- |
| First load (Slow 4G 1.6 Mbps / 150 ms, 4× CPU, cold cache) | 3.29 s | 3.10 s (target < 5 s) |
| Frame rate, Ground Strike over Mountain Valley (heaviest scene) | 60 fps | 60 fps (p99 16.8 ms) |
| GC pauses per 8 s of that fight | 54.1 ms (0.68%), worst 7.2 ms | 39.8 ms (0.50%), worst 3.9 ms |
| Garbage allocated | ~15.3 MB/s | ~13.8 MB/s |
| Draw calls, perf spec (high laptop · low phone · Ground Strike · Bomber Escort) | 102 · 78 · 125 · – (Day 9) | 100 · 70 · 125 · 32 (budget 150) |

What changed: bullets move in place with two scratch vectors (no arrays per bullet per tick), the swept sphere test is scalar, bullets and bot look-aheads skip the terrain lookup above the map's highest ground (`maxSurfaceM`), missile seekers and auto-targeting don't allocate, and the HUD writes styles and classes only when they change, with the minimap at 10 Hz. Most of what's left is the simulation's tuple math (`rotate`, `normalize`) making short-lived vectors; young-generation GC handles it in under 0.5% of the time, so I left it.

Sizes: main bundle 993 KB (278 KB gzip), PeerJS 24 KB gzip and Firebase 63 KB gzip load only when needed; models 844.5 KB in all, one era's 115–142 KB per match (lazy, unchanged since Day 9); **whole site 2.4 MB** (budget 10 MB). Code-splitting the main bundle further wasn't needed for the 5 s target.

### Mobile quirks looked up (2026-10-15)

- iOS Safari kills a tab over a per-process memory budget (WebKit bug 300782, March 2026 comment), and then may reload it in a loop: keep GPU memory small. The game uses no image textures (vertex colours only) and one canvas, so it stays far under that; one map scene per voted map is kept (up to 4).
- iOS 26.0–26.1 home-screen apps lose Web Audio after being reopened (WebKit bug 295518, reported fixed in 26.2): GAME_NIGHT tells phone players to update or play in Safari.
- iOS suspends WebRTC when the phone locks or Safari goes to the background: hence the automatic rejoin and the phone-host warning.
- Chrome exempts tabs with WebRTC connections from heavy background timer throttling, so a hidden host keeps simulating.

### Tests

- Vitest: 166 (+11: tutorial ring/balloon detection, an autopilot flies the whole tutorial, every step reachable; tournament determinism and pair counts; every map's terrain under its ceiling; Day 10 settings; capped auto quality; two convoys per team on every land map; convoy vehicles never closer than 9 m over 10 minutes). Firestore rules: 10.
- Playwright locally: **47 passed**, 21 skipped (device-specific halves, the emulator and full-match specs). New: `mobile.spec` (five phone sizes), `day10.spec` (crash card with Copy error, the tutorial's four steps, Skip and replay, colour-blind palette, HUD size, 30 fps cap, invert pitch on touch), and `multiplayer.spec` now locks the phone mid-match and checks it rejoins with a new seat that the host sees. `npm run test:profile` on the emulators: 4 passed. Perf: 60 fps on all four profiles (100 / 70 / 125 / 32 draw calls).
- Balance: `npm run balance` with SEED=4242 (the after table).

### Deploy

- Pushed and deployed (GitHub Actions green; the live bundle reports `1.0.0+fab773a`, service worker cache `rvbs-v2`). Tagged **v1.0**.
- The Playwright suite against the live site with `BASE_URL`: **45 passed**, 23 skipped, none failed: both multiplayer specs over public PeerJS signaling (including the locked phone rejoining), every mode on every map with tier-1 planes, the tutorial, crash card and settings on desktop and iPhone, the five phone layouts, perf 60 fps on all four profiles (98 / 45 / 113 / 40 draw calls).

### Known issues

- **TURN is still not configured**: phones on mobile data may not connect (GAME_NIGHT says to use Wi-Fi).
- A phone that rejoins mid-match comes back as a new player: its RP from before the lock is saved, but the rules allow one result per player per match, so the rest of that match isn't.
- A phone host that locks its screen still ends the match (iOS suspends WebRTC); the lobby and a match-start notice warn.
- Balance comes from normal-difficulty 1v1 bot duels; 10 v 10 fights and human skill will shift it. HP now spreads more within an era (Modern 63–300); missiles still remove a percentage of max HP.
- Mode numbers (AA strength, ground-unit HP, ticket rates) were not re-tuned; the tournament covers plane-vs-plane only. Day 9's headless mode matches still capture zones, destroy targets and shoot down bombers.
- The simulation still allocates ~14 MB/s of short-lived vectors (0.5% of time in GC on the phone proxy).
- Design limits listed in the bug bash above; Day 8's friends-grade anti-cheat.

### Still to do for Day 10's done-when (the user's game night)

- A full 10-minute match with at least 6 real players including 2 phones, without a crash or desync: follow docs/GAME_NIGHT.md (laptop host on Wi-Fi, phones on Wi-Fi, TDM on Island Chain in WW1 first). Also still owed by hand: Day 8's cross-device RP check and Day 9's sound on a real iPhone.

## Day 9: Remaining planes, maps, modes, sound, effects (2026-10-15)

### Done

**Part A, content**

- **26 propeller plane models** (every WW1, Early WW2 and Late WW2 plane except the Day 4 four), written by `tools/blender/make_prop_specs.py` (lengths and spans from spec sheets; chords, gaps and sections read off general arrangements). Kit additions: fixed landing gear with V struts, axle, wheels or spats, and a tail skid (WW1, P-26, Gladiator, CR.42; the Camel and Dr.I got gear too for consistency); pusher props (`engine.pusher`, the DH.2) with converging tail booms (`pods.xEndM`); radiator and oil-cooler scoops (`scoops`: P-51D, P-40E chin, Hurricane, Yak-3, Bf 109s, P-39 and the P-47's belly); a wing colour (`colors.wing`, the P-26's yellow wings, the Albatros' green); a single centreline fuselage pylon (`xM: 0`). No jets were left as placeholders (Day 7 built all 28), so **all 60 planes have models** and the hangar opens every one (`models.spec`).
- **Review**: every preview was checked against the real aircraft's general arrangement (no drawings were downloaded this session, as on Day 7). Fixes in passes 2–3: Me 262 nacelles moved aft under the wing; P-26 and CR.42 spats raised under the wing with faired legs; the Bf 109 F wing changed from elliptical to tapered; bomber nacelles moved back onto the wings. Known simplifications: rotary engines are plain cowls, the DH.2's engine is just its prop, wire bracing is left out (the E.III has its pylon), the Fw 190's centreline rack is an empty.
- **Rocket and bomb pylons** on the P-47D (2 bombs inboard, 8 rockets), F4U-4 (2 + 8) and Fw 190 A-8 (1 centreline bomb, 2 rocket tubes). `ordnance` in planes.json; the missile button releases rockets in pairs while held, then bombs. They hang on the pylons with the Day 4 `rocket` and `bomb_250` models (`pylonMissiles.ts`), disappear as they go, and fly as the same models.
- **Three generic AI bombers** (`era: "bombers"`, 387–448 triangles, budget 2,000): a WW1 twin-engine biplane bomber, a WW2 four-engine bomber and a swept jet bomber, with gunner positions (nose, top, tail) as muzzle empties.
- **Maps**: Mountain Valley (ridged mountains to ~1,250 m and one canyon carved west to east, 550 m wide at the floor, with a river; its meander passes exactly through the three zones), Desert Mesas (terraced noise: flat plateaus in 115 m steps over a ~45 m floor), Carrier Strike (open ocean, a carrier and three destroyers per team). maps.json keeps seed, size, colours, spawns and zones; ground target layouts are generated from the seed and heightmap (`groundLayout.ts`: convoy roads walked across flat ground, bunkers spread out with an AA gun each, a depot at the rear, destroyers where there's open water) and the host sends its layout to clients.
- **Modes** (rules in GAME_DESIGN.md, numbers in modes.json and the new objectives.json), all `"playable": true`:
  - **Air Domination**: 3 zones, capture below 300 m above the ground inside 700 m (10 s alone, faster with up to 3), 300 tickets, 0.5 tickets/s drained per held zone, 2 per plane lost; 50 RP + 50 SP per capture.
  - **Ground Strike**: per team two convoys (3 trucks + a tank on a road), 3 bunkers, 3 AA guns, destroyers offshore (carriers on Carrier Strike); targets cost tickets when destroyed (30 RP + 30 SP each); AA sites, ships and carriers fire bursts with imperfect lead (weak: 2 HP a round). Unit HP scales per era.
  - **Bomber Escort**: one team's waves of 4 bombers fly ~150 s to the other team's depot or carrier and home; 10 points per bomber over the target, 10 per bomber shot down, 1 per kill. Bombers are ordinary planes (pilot role `bomber`), so guns, missiles, hit spheres, snapshots and rendering work on them unchanged; missiles take a capped bite (400–450 HP).
- **Network**: the start message carries mode, layout and escort team; snapshots carry zone progress/owner and one byte per ground unit (health %, firing), tickets as two bytes, rockets/bombs counts; rockets and bombs fly cosmetically on clients from `drop` events. Unit tests run Ground Strike, Air Domination and Bomber Escort over the fake network with delay and loss.
- **Rendering and HUD**: ground units are procedural merged low-poly shapes, one InstancedMesh per kind plus team pennants (≤ 9 draw calls), wrecks go dark and burn; zones are open columns as tall as the capture ceiling, coloured by owner and blending toward whoever is capturing. HUD: score label (Kills / Tickets / Points), zone chips A/B/C with capture rings, an objective line ("Capturing B · 45%", "Enemy bombers: 3 flying"), zone letters, target diamonds and bomber boxes on screen, zones and targets on the minimap, rockets and bombs in the ammo line, kill feed for captures, destroyed targets, bomber waves and AA kills.
- **Solo setup** picks the map and the mode (two buttons in the header that cycle on each tap).

**Part B, sound and effects**

- **Procedural Web Audio** (`src/core/sound.ts`, no sound files): engines per type (WW1 rotary: buzzy square pulses; radial: lumpy detuned saws; inline: smooth saws with a strong 2nd harmonic; jet: band-passed noise roar plus a whine; afterburner: a low rumble) pitched by throttle and speed, for your plane and the three nearest; guns per calibre (rifle-calibre MG, heavy MG, 20 mm, 30/37 mm) from pre-rendered noise bursts with a thump; hit ticks and thuds; explosions (bigger for ground targets); missile and rocket whooshes; AA fire; UI clicks on every button. The Day 7 IR growl, lock, radar and missile-warning tones moved onto the same context. Distance falloff and stereo pan; a compressor on the master.
- **Volume sliders**: master plus Engines, Guns and explosions, Warnings and clicks.
- **iPhone**: the context is created and resumed on the first pointerdown/touchend/keydown with a one-sample silent buffer started inside the gesture; resumed again when the tab comes back; `navigator.audioSession.type = 'playback'` where Safari supports it, so the silent switch doesn't mute it. Playwright's WebKit iPhone profile checks the context is running after the first tap and that the master bus has signal during a match.
- **Effects** (one instanced pool, now 2,400 puffs): contrails from jets' exhausts above 8,000 m, wingtip vapour above 5 G (props) / 6 G (jets), explosions with more fire and falling debris (bigger for ground targets), burning wrecks of ground targets, larger muzzle flashes, and puffs within 14 m of the camera shrink away (your own smoke and fire no longer fill the screen). **Low graphics** turns off contrails, vapour and debris and halves smoke.
- **Bots** play the objectives: two in five take the objective role (capture the nearest zone they don't hold, circling low inside it; strike the nearest enemy ground target with a dive, guns, rockets and bombs, then climb away; escort the bombers from above and behind), the rest dogfight with mode-aware targeting (interceptors go for bombers, defenders for low enemies near their targets, everyone for planes sitting in a zone). Headless 4-minute bot matches on all 12 mode × map pairs capture zones, destroy targets and launch, bomb and shoot down bombers.

### Download size

| What | Size |
| --- | --- |
| WW1 models (10) | 133.8 KB |
| Early WW2 (10) | 138.2 KB |
| Late WW2 (10) | 141.5 KB |
| Early Jets (10) | 115.4 KB |
| Cold War (10) | 122.6 KB |
| Modern (10) | 127.5 KB |
| AI bombers (3) | 35.7 KB |
| Weapons (7) | 29.9 KB |
| **All models** | **844.5 KB** |
| Main bundle | 966 KB (272 KB gzip); PeerJS 24 KB gzip and Firebase 63 KB gzip load only when needed |
| **Whole site (`dist/`)** | **2.17 MB** (budget 10 MB) |

A match downloads one era's models (115–142 KB), its bomber in Bomber Escort (~12 KB) and the weapon models if that era has missiles or ordnance (30 KB); maps and ground targets are generated, not downloaded.

### Tests

- 155 Vitest (+25: 12 mode × map bot matches, zone capture and drain, bullets and rockets on ground targets, ordnance release order, tickets end a match, the bomber missile cap and interceptor points, deterministic layouts on their own halves, the canyon's depth at the zones, flat mesa tops, three networked-mode tests, all 60 planes plus bombers have models).
- Playwright (35 passed locally, emulator/full-match specs skipped as before): `modes.spec` plays every mode on all four maps with bots on desktop (one map per mode on the iPhone layout), the solo map/mode pickers, and sound after the first tap on both; `models.spec` opens all 60 planes in the hangar. Perf: high 60 fps (102 draw calls); low at phone size with 4× CPU throttling 60 fps (78); **low, 4× throttle, Ground Strike over Mountain Valley 60 fps (125)**; high, Bomber Escort with Modern jets 57.6 fps.

### Deploy

- Pushed and deployed (GitHub Actions green, live bundle `index-CCWYt2Q5.js`). The Playwright suite against the live site with `BASE_URL`: **34 passed** (both multiplayer specs over public PeerJS signaling, every mode on every map with tier-1 planes, sound after the first tap on desktop and the iPhone profile, perf 60 fps on all four profiles including low + 4× throttle in Ground Strike over Mountain Valley). The all-60-planes hangar test runs on localhost only (it needs every plane unlocked).

### Known issues

- Ground units don't collide with anything and convoys drive through each other at the ends of their road; ships are boxes that don't wake.
- Bombers bomb by passing over the target (explosions on the target, no falling bombs), and their gunners have all-round arcs.
- Rockets and bombs only hurt ground targets, not planes. Only the three attackers carry them; jets attack ground targets with guns.
- Engine sound for others is limited to the three nearest planes; no doppler.
- Island Chain's red side found no convoy road on flat ground (its islands are small), so red has bunkers, AA and destroyers there.
- Reference drawings weren't downloaded for the review (judged against known general arrangements).
- TURN still isn't configured (Day 5 issue). The Day 8 cross-device check is still the user's to do.

### Next steps (Day 10)

- Performance, mobile QA on real phones (sound on a real iPhone), balance (AA strength, unit HP, ticket rates), launch. Done, see Day 10 (plane balance by bot tournament; ground-target numbers unchanged).

## Day 8: Progression, unlocks, Firebase (2026-10-15)

### Done

- **Firebase project** `red-vs-blue-skies` on the free **Spark** plan (no billing). Created with the CLI (project, web app, config) plus the console for the Firebase terms, Firestore (Standard, nam5, production mode), the Anonymous and Google providers and the `singha105.github.io` authorized domain. The web config is in `src/profile/config.ts` (public by design). Rules deployed with `npm run rules:deploy`.
- **SDK** (looked up 2026-10-15): Firebase JS v13 modular API. `firebase/auth` with `initializeAuth` (IndexedDB persistence) and `firebase/firestore/lite` (plain HTTPS: no listeners, no SDK cache, smaller). Both load only after the title screen is up, as a 63 KB gzip chunk; the main bundle grew 7 KB. The game never waits for Firebase.
- **Auth**: anonymous sign-in on first launch; the uid persists in IndexedDB, so a returning player is known offline too. **Settings → Link Google account** uses `linkWithPopup`, because `signInWithRedirect` breaks on github.io in Chrome 115+, Firefox 109+ and Safari 16.1+ (third-party storage partitioning, per Firebase's redirect best-practices page). The popup opens straight from the tap so iPhone Safari allows it. If that Google account already has a profile (a second device), `auth/credential-already-in-use` signs this device into it (`credentialFromError` + `signInWithCredential`) and loads that progress. The guest progress on that device is left behind (judgment call: merging would be a cheat path).
- **Profile** `players/{uid}`: callsign, rp, unlocked (highest tier per era), stats (kills, deaths, assists, matches, wins), friends (up to 50 uids you've flown with), lastMatch, lastUnlock, createdAt. It's cached in localStorage so plane select works offline.
- **Match results**: the host creates `matches/{matchId}` with every human's uid (`MatchRecorder` in `hostServer.ts`) and sends `matchId` + uids in `start`; late joiners are added. The host computes RP with `computeResults` (the GAME_DESIGN formula) and sends the results. Each player then writes `matches/{id}/results/{uid}` and its profile increments in **one batch**. If the host leaves, everyone saves what they had so far (counted locally, still capped). Solo: this device creates the match and the result.
- **Security rules** (`firestore.rules`, friends-grade anti-cheat): you write only your own profile; a new profile has 0 RP and tier 1 everywhere; RP and stats can only rise by exactly one result created in the same batch (its `createdAt` must equal the request time, so old results can't be replayed); one result per uid per match (create only); the uid must be a participant; the match must be under 1 hour old; at most 3,000 RP per result; RP can only fall by buying the next tier of one era at exactly 200 × tier, never below 0; the host can only append participants.
- **Rules tests** (`npm run test:rules`, Firestore emulator, Java 22 already installed): 10 tests, including **a forged +100,000 RP write rejected** (four ways: direct, increment, as a result, a capped result with a bigger profile increment), **an out-of-order unlock rejected** (tier 10 or 3 with only tier 1, re-buying, setting the map directly), a replayed result, the 3,000 cap, non-participants, a match over an hour old, wrong price, two eras at once.
- **Research screen** (`src/ui/research.ts`): one tree per era, 10 tier cards with silhouettes, Free / Unlocked / "Unlock · N RP" / "Need N RP" / "N RP · after tier N−1", each Unlock behind a confirmation ("You'll have N RP left"). Opens from the title, solo setup, the room lobby and results (between rounds), and the solo results. Buying needs a connection; the screen says so when offline.
- **Real unlocks everywhere**: the Day 6 stub is gone (`OPEN_TIERS`, the room-wide unlock, `?rp=N`). Each player's hello carries uid, unlocks and RP earned; the host checks plane picks, defaults (your best unlocked plane) and respawn picks per player; a `profile` message updates the host after a purchase between rounds. Team balancing uses RP earned (balance + spent). "All unlocked" happens only with `?debug=1` **on localhost** (`env.allUnlocked`; `&locks=1` turns it off for testing), never on the live site.
- **Offline**: results queue in localStorage (`rvbs.pending.v1`) and sync on start, on the browser's `online` event and every 60 s; retries are safe (create-only result, duplicates detected). Results screen: "RP saved to your profile." / "Saving RP…" / "RP saved on this device. It syncs when you're back online." The title shows callsign, RP, "+N syncing" and offline state. Solo works with no network at all; a solo result made offline syncs later (its match record is created at sync time).
- **Friends leaderboard** (title → Leaderboard): you plus everyone you've shared a match with. Top RP (earned), Most kills, Best K/D. It reads those profiles (`documentId() in` batches of 30) at most every **5 minutes** (localStorage cache, Refresh disabled while fresh).
- **Debug overlay** (`?debug=1`): under the fps, `FS match Xr+Yrr/Zw · session …` (reads, reads made by the rules, writes) for the current match including its saves.
- **Tests**: 130 Vitest (+14: unlock costs/order/fresh player, unlock cleaning, result capping, applyResult, profile cleaning, friends merge, the offline queue (dedupe, storage round trip, forged entries capped), match ids, leaderboard ranking; host records the match with participant uids and adds late joiners; plane select follows each player's unlocks; a profile update between rounds). `npm run test:profile` starts the auth + Firestore emulators and runs `profile.spec` (4 tests, desktop + iPhone): after a solo match "RP saved", **RP still there after a reload with the local copy wiped**, research buys WW1 tiers 2 and 3 in order with the confirmation and refuses tier 4, the unlocks survive a reload and open in plane select; offline (Firestore blocked) the result waits and syncs when it's back; **a second browser context links the same Google account and gets the same uid, RP and Modern tier 2**. Playwright tests never touch the real Firebase (automated browsers stay offline unless `&fb=1` or `&emu=1`), and against the live site they pick tier-1 planes.
- **Checked on the real project** (local dev server, in-app browser, 2026-10-15): anonymous sign-in, a solo match saved (3 writes, 2 rule reads), the RP came back after a reload with the cache wiped, the leaderboard read 1 profile.

### Deploy

- Pushed and deployed (GitHub Actions green, live bundle `b584222`); Firestore rules deployed to `red-vs-blue-skies`. The Playwright suite against the live site with `BASE_URL`: 22 passed (both multiplayer specs over public PeerJS signaling, missiles on desktop and iPhone with the tier-1 MiG-29A, perf 60 fps on both profiles). One run hit a GitHub Pages 503 on the first page load right after the deploy; that test passed on rerun. Main bundle 251 KB gzip (+7 KB), Firebase chunk 63 KB gzip loaded after the title screen.

### Firestore usage (Spark limits: 50,000 reads, 20,000 writes, 20,000 deletes per day; 1 GiB stored; 10 GiB/month egress)

Measured per match (emulator test and the real project): a solo match = 3 writes (match record, result, profile) + 2 rule reads; a network match = 1 write for the host's match record + 2 writes and 2 rule reads per player. Startup = 1 read (profile). Leaderboard = 1 read per profile shown.

Estimate for **20 players × 20 matches a day** (400 player-matches):

| What | Reads | Writes |
| --- | --- | --- |
| Results: 400 × (2 writes + 2 rule reads) | 800 | 800 |
| Match records: worst case 400 (all solo); 20 if everyone plays in one room | – | 400 |
| Startups: 20 players × 5 a day | 100 | – |
| Unlocks (~3 a day each) and callsign changes | – | 80 |
| Leaderboard: 20 players × 5 opens a day × 20 profiles (5-minute cache) | 2,000 | – |
| **Total** | **2,900 (5.8% of 50,000)** | **1,280 (6.4% of 20,000)** |

Deletes: 0. Storage: ~0.2 KB per result → ~80 KB a day. All well under 10%. The one thing that could push reads up is the leaderboard: opened after every match by everyone (20 × 20 × 20 = 8,000 reads) it would reach ~18% of reads, which is still inside the free tier.

### Known issues

- **Friends-grade anti-cheat**: a player can create a match record with only themselves in it and claim up to 3,000 RP per "match". The rules cap each claim, but they don't verify play (that would need Cloud Functions, i.e. Blaze).
- Linking Google on a device that already has guest progress, when that Google account already has a profile, switches to the account and leaves the guest progress behind.
- Unlocking needs a connection (no offline purchases). A result saved offline more than ~2 hours after a **network** match is dropped: the host's match record expires after 1 hour.
- Unlocks are client-claimed in the lobby: the host trusts each player's unlock list (Firestore holds the truth; checking it would cost reads per player per round).
- Locked planes can't be viewed in the hangar.
- TURN still isn't configured (Day 5 issue).

### Still to do for Day 8's done-when

- On the live site: play a match, reload, then link Google and open the game on a second device (phone) to see the same RP and unlocks. The emulator test covers this flow; the real Google popup needs a person.

### Next steps (Day 9)

- The remaining prop plane models, Mountain Valley / Desert Mesas / Carrier Strike maps, Air Domination / Ground Strike / Bomber Escort, procedural sound and effects.

## Day 7: Missiles, countermeasures, jet models (2026-10-15)

### Done

- **Missiles in the sim** (`src/game/missiles.ts`, run by `stepWorld`): every plane has per-mount missile counts, flares, chaff and a lock (`lockTarget`, `lockMount`, `lockProgress`). The weapons computer picks the target you chose (or the enemy nearest the nose) and the mount whose missile suits the range, builds the lock over the missile's lock time, and launches on a fresh press. Missiles and decoys live in `WorldState` (`missiles`, `decoys`, `nextMissileId`); `launch`, `detonate` and `decoy` are new `GameEvent`s; a hit removes `damage`% of the victim's max HP through `applyDamage` (with a hit event, so hit markers and damage arrows work).
- **Seekers**: IR sees engine heat (lock range scales with throttle, ×1.4 in afterburner); rear-aspect IR locks only within 45° of the tail (90° once in flight); head-on, all-aspect IR sees about 60% as far; the sun within 10° blinds it (`SUN_DIR` in `src/game/sun.ts`, shared with the sky). Radar: 60° cone, halved below 300 m, a notch when the target's speed along the line of sight is under 45 m/s (wider low down, half as wide for an active seeker inside 1.5 km), 1.2 s track memory; semi-active needs the shooter's lock to the end.
- **Guidance and kinematics**: proportional navigation, N = 4; available G falls with speed², motor drives toward the missile's speed plus 40% of the launcher's, v² drag after burnout, turning costs speed, 15 m proximity fuse; a missile that loses its target flies on for 4 s and self-destructs.
- **Countermeasures**: one Flare button drops a flare and a chaff bundle every 0.3 s (judgment call from the handoff: phones have no room for two buttons). Each decoy gets one roll per guiding missile: 1 − resistance for the first, ×0.6 for each further one, flares ×0.6 in afterburner, chaff ×1.5 while notching.
- **Counter for every missile** (today's rule): measured in `tests/unit/missiles.test.ts` ("every missile has a counter") with scripted defenders; nothing needed a data nerf after the decoy fade, afterburner and notch rules went in. Hit rates over 30 shots (none = straight and level, cm = flares/chaff only, turn = beam/notch only, full = both):

  | Missile, shot | none | cm | turn | full |
  | --- | --- | --- | --- | --- |
  | AIM-9B / K-13 / Magic, tail, 1.5 km | 1.00 | 0.07 | 1.00 | 0.07 |
  | AIM-9L, 120°, 2 km | 1.00 | 0.20 | 1.00 | 0.20 |
  | R-73, 150°, 2.2 km | 1.00 | 0.37 | 1.00 | 0.37 |
  | AIM-9X, 150°, 2.2 km | 1.00 | 0.43 | 1.00 | 0.43 |
  | AIM-7F, 170°, 5 km | 1.00 | 0.10 | 1.00 | 0.10 |
  | R-27R, 170°, 5 km | 1.00 | 0.10 | 0.00 | 0.00 |
  | AIM-120B, 170°, 6.5 km | 1.00 | 0.20 | 1.00 | 0.17 |
  | R-77 / MICA EM, 170°, 6.5 km | 1.00 | 0.20 | 0.00 | 0.00 |

  A notch started at launch at 5–6.5 km is right at the edge (it takes ~4 s to turn onto the beam), so whether it alone works depends on the geometry; early notching plus chaff is the reliable counter. Rear-aspect IR is also beaten by turning to face it before launch and by outrunning it (an AIM-9B at 2.5 km can't catch a fleeing F-8 in afterburner).
- **Bots** (`bots.ts`): fire once locked between 1.3× min range and 75% of max range, outside gun range, one missile in the air per target, every 5–14 s by difficulty. Each inbound missile gets one awareness roll (easy 35%, normal 70%, hard 95%); then flares + throttle back + a crossing break for IR, a notch + chaff for radar, sloppier for weaker bots. Headless 4-minute Modern 10 v 10 on normal: 125 launches, 266 flares, 266 chaff, 21 missile kills.
- **Networking** (`protocol.ts`): inputs are 11 bytes (target as a roster slot); planes are 24 bytes (lock target slot + progress/radar byte, for the RWR); snapshots carry missiles (17 bytes each); the trailer has your own missile, flare and chaff counts and lock mount. Launch, detonate and decoy go as reliable events; clients fly flares and chaff locally and draw missiles 100 ms behind like planes. Quick taps of Missile/Flare are latched so they reach the host.
- **Cockpit** (`src/ui/missileHud.ts`, `src/app/weapons.ts`, `src/core/audio.ts`): target select with R / a quick tap on an enemy / gamepad RB, picked-target diamond, lock box with a progress ring (solid red when locked, dashed when out of range), loadout and countermeasure counts, a radar-warning display (yellow = a radar locking you, blinking red = a missile inbound) next to the minimap, and a loud red launch warning that names the counter ("IR: flares, cut throttle, turn" / "radar: chaff, turn 90° to it"). Web Audio tones: IR growl → steady lock tone, radar beeps → steady tone, RWR beeps, fast launch-warning beeps. On touch the Missile button has a lock-progress ring and counts.
- **Rendering** (`src/render/missiles.ts`): instanced missile bodies and motor flames, smoke trails, flares with trails, chaff clouds, afterburner glow at every exhaust empty (2 extra draw calls).
- **Data**: Mirage IIIE carries the R.550 Magic.
- **Part B, jet models**: all 28 remaining jets have specs and models (`tools/blender/make_jet_specs.py` writes the specs; dimensions from spec sheets, the rest read off general arrangements). Kit additions: `pods` (Meteor nacelles, Vampire booms, tip tanks), `chin_intake` (F-8, F-16, Typhoon), `fin_only` tails for tailless deltas, canards and LERX/gloves as extra wings. Pylons for each jet's missiles, exhaust empties for the afterburner glow. 303–469 triangles each; all 34 planes plus weapons are 450 KB.
- **Tests**: 114 Vitest (+40: guidance hits nine missile/geometry cases, PN flies a lead course, outrun after burnout, rear-aspect, afterburner heat, sun, notch geometry, **notching breaks a semi-active lock**, **flare and chaff pull rates within 5% of 1 − resistance over 1,000 trials**, flares ignore radar and chaff ignores IR, a counter for all 15 missiles, bots launch/flare/chaff/kill in a headless Modern match, protocol round trips for missiles, locks and the target byte). Playwright adds `missiles.spec` on Desktop Chrome and the iPhone touch layout: R or a tap picks the enemy, the lock goes solid (and the ring on the touch Missile button), Q or a tap fires, then an inbound missile shows the warning and flares pull it off.

### Missiles on the pylons (follow-up, 2026-10-15)

- Every jet now carries its remaining missiles on its pylons (`src/render/pylonMissiles.ts`): one InstancedMesh per weapon model, so at most 4 extra draw calls for the whole match. `pylonSlots` in `src/game/planeModels.ts` puts radar missiles on the innermost pylons and IR missiles on the outermost, in left/right pairs; each launch empties a pylon (alternating sides) and a respawn refills them. Class → model: rear/all-aspect IR → `missile_ir_small`, HOBS IR → `missile_ir_large`, semi-active → `missile_radar_medium`, active → `missile_radar_long`. Weapon models load only for eras with missiles (+18 KB).
- Clients see other planes' loads too: each plane in a snapshot has one more byte (missiles left on mounts 0 and 1, 4 bits each), so 25 bytes per plane (+0.4 KB/s per client).
- The hangar shows the full load. Tests: every jet hangs all its missiles, F-15C AMRAAMs inboard of its Sidewinders, the snapshot byte round-trips, and `missiles.spec` checks the F-15C shows 6 and then 5 after a launch.

### Deploy

- Pushed and deployed (GitHub Actions green). The full Playwright suite passed against the live site with `BASE_URL` (22 tests: both multiplayer specs over public PeerJS signaling, the missile spec on desktop and iPhone, perf 60 fps on both profiles). Whole site is 1.6 MB (models 552 KB).

### Review of the jet models

Each preview was checked against the real aircraft's planform; a second pass widened the twin-engine bodies back to the nozzles (F-14, F-15, MiG-29, Su-27, F-22) and moved the Mirage deltas aft. No reference drawings were downloaded this session (Day 4's were), so the review was against known general arrangements; shapes are deliberately simple and some details are approximations: the F-14 is modelled at a mid wing sweep, LERX and canards are flat plates, intakes are boxes.

### Known issues

- Notching is all-or-nothing inside the 45 m/s window; there's no partial doppler model.
- A missile's lock state on clients updates at the 20 Hz snapshot rate.
- TURN still isn't configured (Day 5 issue).

### Next steps (Day 8)

- Progression, unlocks, Firebase. Done, see Day 8.

## Day 6: Lobby, voting, teams, match flow (2026-10-15)

### Done

- **Screen flow**: Title → callsign → Host / Join → lobby → vote → teams → plane select → match → results → back to the lobby on the same connection. The host owns every bit of state (`src/net/room.ts`, a pure state machine with injected time and randomness). Clients only send requests (ready, party, vote, pick, respawn, again, chat), and each is checked against the phase and the rules.
- **Lobby**: player rows with a blue/red stripe (the teams as they'd be drawn now), ready tags, party tags, device and ping. Ready toggle. "Party up" with anyone (parties of up to 3; Leave party). Host controls: Start vote (shows how many are ready), Remove a player, bot difficulty, bots on/off, match length 5/10/15 min. Quick chat ("Need help!", "On my way", "Nice shot", "Good game") plus 80-character text chat, rate-limited and sanitised by the host. Chat also shows in the in-match kill feed.
- **Vote**: era, map and mode chips with live counts and a 20 s timer, ending early once everyone has voted all three. Ties are broken at random. The host can switch to "Host pick" to override any category. Modes carry a new `playable` flag in modes.json: only TDM is playable, and the other three show as "coming soon" until Day 9. All four maps can be voted for. Mountain Valley and Desert Mesas use the island generator with their own seed and colours until Day 9's terrain, and Carrier Strike is open ocean.
- **Teams** (`src/game/teams.ts`): humans split by headcount first, then research points (stubbed: 0, or `?rp=N` with debug). Parties stay together. A swap pass evens out the RP. Then `balanceBots` gives bots planes from the era so the team BR totals end within 10% (it aims for 3%): bots start near the humans' median tier, and the weaker team's bots step up or the stronger team's step down while that narrows the gap. Humans always fly what they picked. The BUILD_PLAN example (blue humans 7.9, red 6.4, 6 bots each) ends at **18.7 vs 18.4 (1.6%)**.
- **Plane select**: the voted era's 10 planes as cards with a top-view silhouette rendered from the hangar model (`src/render/silhouettes.ts`, one render target, cached data URLs; placeholder shape until a model exists), tier, BR, top speed, turn rate and guns. Locked planes are greyed out with their RP cost (tiers 1–3 open, all with `?debug=1` on the host). You lock in with "Fly the …"; the screen ends when everyone has locked in or after 25 s. Anyone who didn't pick gets the best open plane.
- **Spawn points** (`world.ts`, `unlocks.ts`): first spawn free; later spawns cost 100 + 50 × tier SP, earned at 100 per kill and 40 per assist (50 per capture once modes have zones). On the respawn screen a plane picker shows your SP and greys out what you can't afford. **Judgment call:** the era's tier-1 plane is a free reserve, so a pilot with no SP still flies (GAME_DESIGN updated). Applies to solo too.
- **Results** (`src/game/results.ts`): the host computes them once and sends them to everyone. Winner, awards (MVP top score, Ace 5+ kills in one life, Wingman most assists, Survivor fewest deaths; awards need some kills, assists or damage, so a match where nothing happened gives none), both scoreboards with K / A / Dmg % / D / RP, your own RP, and the starting team BR. RP follows the GAME_DESIGN formula (underdog kill multiplier, assists, damage %, survival, +25% win, +20% MVP, 50 minimum), which reproduces the worked example's 1,038. The host's "Play again" takes everyone to the lobby without reconnecting. Clients can mark themselves ready for the next round, and the lobby comes back by itself after 60 s.
- **Join in progress**: allowed in any phase. During a match you take a bot's seat on the team with fewer humans, and the remaining bots re-pick planes to keep the BR balanced (they switch at their next respawn). A respawn in a different plane updates the roster everywhere.
- **Map per match**: the voted map is prepared during plane select. `main.ts` keeps one scene per map, so switching back is free.
- **Phone layouts**: every room screen fits a 667 × 375 landscape phone. Two columns in the lobby, chat in one row, the share QR is replaced by a "Copy link" button in the header, and the results get the full height. Touch targets are 56 px.
- **Tests**: 74 Vitest (adds 11 team/SP/RP tests: RP split, parties, max 10 per team, the BUILD_PLAN example, 500 random lobbies across all eras within 10%, createMatch's real team BR, kill/assist SP, reserve and paid respawns, underdog table, the worked RP example, awards; and 5 room tests: vote counts/ties/override/unplayable modes, early vote end, party limit and plane validation, **two full rounds over the fake network** with BR ≤ 10% each, respawn plane updates the roster). Playwright adds `multiplayer-loop.spec`: 3 Chromium contexts (host, laptop, 667 × 375 touch phone) play **the full loop twice** (ready, party, chat → vote → teams → pick → 30 s match with `?matchtime=30` → results with 10 rows per team and RP → Play again → lobby), asserting the party is on one team and team BR is within 10% in both matches (measured 2%). `multiplayer.spec` and the smoke test follow the new flow; the crash test checks the respawn picker and the free reserve.

### Performance

- Bundle: 223 KB gzip for the game plus 23 KB for PeerJS (only loaded to host or join). Total download is still about 1.2 MB.
- Rendering 10 silhouettes takes about 150 ms once, when plane select opens; it's cached after that.

### Known issues

- In a 30 s test match nobody meets: teams spawn 13 km apart. Real matches are 5 to 15 minutes.
- Most planes have no model yet (Days 7 and 9), so their silhouettes are the placeholder cross.
- Research points are a stub (0 for everyone, `?rp=N` in debug) and aren't saved; Day 8 adds Firebase.
- Mountain Valley and Desert Mesas look like islands until Day 9's terrain generators; Carrier Strike has no carriers yet.
- The host's tab must stay visible (Day 5 issue). The lobby says so.
- TURN still isn't configured: phones on mobile data may not connect until the Metered key is added.

### Manual test

- 2026-10-15, user: one player on Chrome and one on Safari. It works. This is the first check of the room flow on Safari/WebKit; the Playwright multiplayer tests only cover Chromium.

### Still to do for Day 6's done-when

- A three-device run (2 laptops + a phone) of [`docs/MULTIPLAYER_TEST.md`](MULTIPLAYER_TEST.md): two full matches in a row without reloading. The phone part also covers touch and iPhone Safari's lock-screen behaviour.

### Next steps (Day 7)

- Missiles and countermeasures (part A); the remaining jet models (part B). Done, see Day 7.

## Day 5: Multiplayer (2026-10-14)

### Done

- **Transport interface** (`src/net/transport.ts`): host and client sides with two channels, `reliable` (ordered) and `unreliable` (unordered). Three implementations: PeerJS (`peerTransport.ts`, loaded only when you host or join, so solo stays offline-safe), an in-memory fake with delay, jitter and loss (`fakeTransport.ts`), and `combineHosts`, which joins the PeerJS host to the host's own zero-delay loopback.
- **Host flow**: Host / Join → callsign → era, plane and bots → Create room. The peer id is `rvbs-<CODE>`, with 4 letters and no I or O. The lobby shows the code, a QR code generated locally (`qrcode-generator`), the `?room=CODE` link and a Copy button. If the code is taken it retries with a new one, up to 5 times.
- **Join flow**: the link or QR opens the join screen with the code filled in → callsign → Join. Clear errors for a room that isn't found, a different version, a full room, and no answer.
- **ICE**: Google STUN, plus Metered TURN once `VITE_TURN_DOMAIN` / `VITE_TURN_API_KEY` are set (fetched with a 4 s timeout, falls back to STUN). The deploy build reads both from repo secrets.
- **Protocol** (`protocol.ts`): 10-byte inputs at 30/s with a seq. Snapshots at 20/s are 15 B plus 22 B per plane: quantised position, velocity and smallest-three quaternion, with state flags, plus your own ammo. That's about 460 B for 20 planes. Events (hit, kill, explode, spawn), roster, stats and match state go as JSON on the reliable channel. No bullets are sent: each plane's firing flag drives local tracers.
- **Host is authoritative** (`hostServer.ts`): runs the real match at 60 Hz with bots filling to 20, decides every hit, damage, kill and score, and sends hit events only to the two pilots involved. Validation: inputs clamped on decode, a 70/s token bucket, seq must increase, firing limited to real rpm because the host simulates the guns, and different build versions rejected.
- **Client** (`clientSession.ts`): your own plane is predicted with the same flight model and reconciled on every snapshot (unacknowledged inputs replayed, errors under 60 m smoothed out, larger ones snap). Other planes are drawn 100 ms in the past, interpolated, and extrapolated with velocity for up to 250 ms.
- **The host plays too** through the loopback ClientSession, so the host's own player goes through exactly the same code path as everyone else.
- **Leaving**: a client who leaves (or goes silent for 8 s) is handed to a bot after 10 s. If the host leaves, everyone gets a "Host left" results screen with the scores so far. A phone that loses the connection itself (locked or backgrounded) sees "Connection lost" instead. You can join a running match: you take a bot's seat on the team with fewer humans.
- **Lobby host advice**: each player's device (phone or computer, and connection type where the browser reports it) and ping. The lobby recommends the best host (a laptop on Wi-Fi) and warns when the host is a phone.
- **Debug overlay** (`?debug=1`): ping, loss, snapshots/s, KB/s in and out, and, on the host, upload to all players.
- **Session abstraction** (`src/app/session.ts`): `main.ts` now renders any match through `Session` (solo or networked).
- **Phone layouts**: the Host/Join menu and the lobby fit a 390 px tall landscape phone without scrolling.
- **Tests**: 58 Vitest. They add 13 net tests: room codes, quaternion packing, snapshot round trip and size, input clamping, lobby and version reject, prediction under 100 ms RTT with 10% loss, interpolation under 20% loss with no teleporting, bandwidth, fire rate bounded by rpm, input-flood rate limit, leave → bot after 10 s, host close → host left, and join in progress. Playwright adds `multiplayer.spec`: 3 Chromium contexts (host laptop, laptop client, touch-phone client) on localhost with a local PeerJS server. Everyone sees the other two humans move, both clients get ≥ 15 snapshots/s and < 30 KB/s, the phone shows as a phone in the lobby, and both clients get "Host left" when the host closes. The smoke test now covers the real Host/Join screen.

### Bandwidth (measured)

| | Fake transport, 20 planes | 3 browsers on localhost |
| --- | --- | --- |
| Per client, down | 10.0 KB/s | 9.8–9.9 KB/s |
| Per client, up | 0.31 KB/s | 0.3 KB/s |
| Snapshots | 20/s | 19.6–19.7/s |

The host uploads about 10 KB/s per remote player (about 190 KB/s for a full 20-player room).

### Known issues

- **PeerJS can't turn off retransmits**, so the "unreliable" channel is unordered but still retransmitted. Late snapshots are discarded, so this only costs bandwidth on bad links.
- **The host tab must stay visible.** Browsers pause `requestAnimationFrame` in hidden tabs, which pauses the whole match. The lobby tells the host to keep the tab on screen.
- **iOS suspends WebRTC when a phone is locked or Safari goes to the background.** A phone client is replaced by a bot after 10 s; a phone host ends the match for everyone, hence the lobby warning.
- **TURN not configured yet**: phones on mobile data may fail to connect until the Metered domain and API key are added (the Host/Join screen says so).
- **Mixed plane choice**: friends get a random plane within a tier of the host's (Day 6 adds plane select). Touch aim assist is off in network matches for now, so prediction matches the host exactly.
- **No rematch in the same room**: after the results, "Play with friends" goes back to Host / Join (Day 6 adds results → lobby).
- The 20-player host upload (~190 KB/s) hasn't been tested on real home Wi-Fi yet.

### Still to do for Day 5's done-when

- Add the Metered TURN domain and API key (`.env` plus repo secrets) and redeploy.
- Run the manual test in [`docs/MULTIPLAYER_TEST.md`](MULTIPLAYER_TEST.md) on the live site: 2 laptops plus a phone on mobile data.

### Next steps (Day 6)

- Lobby, voting, teams, plane select, results → back to lobby, chat.

## Day 4: Blender pipeline and first planes (2026-10-14)

### Done

- **Plane kit** (`tools/blender/plane_kit.py`, Blender 5.0 headless): fuselage lofted through elliptical sections; wings with tapered / elliptical / gull planforms, sweep, dihedral, cranked outer panels, biplane and triplane stacking with interplane and cabane struts; tail with stabiliser (sweep, anhedral, high-mounted), single or twin fins; radial cowls, inline noses, jet nose intakes, side intakes, exhaust nozzles; separate `prop` (blades + spinner) pivoting at the hub; canopies (open cockpit, teardrop, framed tandem); gun hump; pylons. Four materials (BODY, TEAM, GLASS, DARK) with per-face vertex colours: camo patches, underside colour, team paint on fuselage band / wingtips / fin / cowl as the spec says. No insignia.
- **Empties**: `prop`, `muzzle_N` (with gun-mount index), `pylon_N`, `exhaust_N`.
- **Specs** in real metres (Wikipedia dimensions, sensible guesses elsewhere) for Sopwith Camel, Fokker Dr.I, Spitfire Mk V, F4U-4 Corsair, MiG-15bis, F-4E Phantom II.
- **Weapons kit**: missile_ir_small, missile_ir_large, missile_radar_medium, missile_radar_long, rocket, bomb_250, drop_tank (46–62 triangles each).
- **Previews** (`tools/blender/previews/<id>.png`): Workbench, front / side / top / three-quarter at 512 px each, team paint shown blue.
- **Review loop** against one Wikimedia Commons three-view per plane (`tools/blender/refs/`, gitignored): Camel and Dr.I and MiG-15 passed first time; Spitfire canopy moved back over the wing (pass 2); Corsair wing broadened, straight leading edge, deeper fuselage, team band fixed (pass 2); F-4E fuselage widened and deepened, bigger intakes, longer wing root (passes 2 and 3). Kit fixes found along the way: preview side-view camera roll, duplicate faces, fin team paint, paint-band edges.
- **`npm run models`**: clean rebuild in ~6 s of Blender time, meshopt compression (node names, materials and vertex colours preserved), writes `public/models/<era>/<id>.glb`, `public/models/manifest.json`, `src/data/planeModels.json`, prints sizes. Fails if a model is over its triangle budget.
- **In game**: GLTFLoader + meshopt decoder, converted to Lambert materials, TEAM tinted red/blue, props spin with throttle, muzzle flashes at every muzzle while firing, smoke from exhaust empties, placeholder until loaded or for unmodelled planes, only the current era's models are fetched. Bullets now leave from the model's muzzles; hit spheres scale with each plane's real length and span (Camel vs Phantom); chase camera distance scales with plane length. The title screen flies the real Spitfire.
- **Hangar**: Solo setup → Hangar: the selected plane turning in the sky, drag (mouse or finger) to rotate, pinch / wheel to zoom, Blue/Red paint toggle, full stats.
- **Tests**: 45 Vitest (adds model files exist and match planes.json paths, triangle budgets, every gun mount has a muzzle, bullets spawn at model muzzles, hit spheres scale with size, manifest sizes). 18 Playwright (adds hangar loads the real model and turns on drag on both viewports, WW1 match flies Camel/Dr.I models with props and muzzles).

### Model sizes

| Model | Era | Triangles | Size |
| --- | --- | --- | --- |
| f4e | cold_war | 461 | 13.5 KB |
| f4u4 | late_ww2 | 375 | 14.8 KB |
| fokker_dr1 | ww1 | 328 | 12.5 KB |
| mig15bis | early_jets | 307 | 11.1 KB |
| sopwith_camel | ww1 | 334 | 12.3 KB |
| spitfire_mk5 | early_ww2 | 347 | 14.7 KB |
| bomb_250 | weapon | 54 | 4.3 KB |
| drop_tank | weapon | 46 | 4.1 KB |
| missile_ir_large | weapon | 62 | 4.3 KB |
| missile_ir_small | weapon | 62 | 4.3 KB |
| missile_radar_long | weapon | 62 | 4.3 KB |
| missile_radar_medium | weapon | 62 | 4.3 KB |
| rocket | weapon | 54 | 4.2 KB |

**Total model size: 108.7 KB** for 6 planes and 7 weapons (about 13 KB per plane, so all 60 planes ≈ 0.8 MB).

### Known issues

- Low triangle counts (300–460) leave room for more detail later; shapes are deliberately simple and flat-shaded.
- Planes without a model still use the box placeholder (54 of 60). Days 7 and 9 model the rest with the same kit.
- Rounded wingtips and tails are approximated with straight segments; Dr.I's comma rudder is a trapezoid.
- The F-4 reference drawing was an F-4K (close relative); shape differences are minor at this detail level.

### Next steps (Day 5)

- Multiplayer: Transport interface, PeerJS host/join with room codes and QR, STUN + Metered TURN, input/snapshot protocol, prediction and interpolation. **Needs the Metered API key from you.**

## Day 3: Guns, damage, bots: playable solo (2026-10-14)

### Done

- **guns.json** (21 gun types): real rate of fire and muzzle velocity (Hispano 700 rpm / 850 m/s, M61 6,000 rpm / 1,050 m/s, etc.; sensible figures where sources were thin), game damage, spread, tracer colour. Validated at startup.
- **Ballistics** (`src/game/ballistics.ts`): bullets with gravity drop and the shooter's velocity, guns converge at 300 m, real rate of fire and ammo use. Each simulated projectile carries several real rounds (max 20 projectiles/s per gun mount) so 20 planes stay cheap.
- **Hit detection**: 4 spheres per plane (fuselage, left wing, right wing, engine; jets carry the engine at the tail), swept segment test per tick, distance broad-phase, friendly fire off.
- **Damage**: engine knock-out = top speed −30% (thrust 0.49×) + smoke; wing knock-out = roll and turn −25%; fire chance up to 15% per heavy hit, burning drains 2.5 HP/s for 10 s; 0 HP → wreck tumbles down and explodes on impact. Kill to the last attacker (also if you crash within 20 s of being hit), assists to anyone with 25%+ of the victim's HP. Team score per kill.
- **Respawn**: 5 s, line abreast at your team's side at 1,500 m, 3 s spawn protection (firing ends it early).
- **Aim assist (touch only)**: bullets bend toward an enemy's lead point within 2° of the shot; strength from the new Settings panel (default 60%, 0% = off).
- **Bots** (`src/game/bots.ts`) only output ControlInput (a unit test checks they never change world state) and steer with the same mouse-aim autopilot: terrain look-ahead, map edge, break turn or dive when shot from behind, target = nearest enemy weighted by threat and how far off the nose it is, pure pursuit far / lead pursuit in range, throttle back to avoid overshooting, trigger gated by miss distance at range. Easy / normal / hard differ in reaction time, aim wander, lead quality, range, trigger discipline and evasion.
- **Solo mode**: Play Solo → setup (era, plane, difficulty; tiers 1–3, all with `?debug=1`) → 10 v 10 TDM (first to 50 or most kills after 10 minutes) → results (both scoreboards, Play again).
- **HUD**: health bar, damaged parts, ammo per gun, score and clock, kill feed, scoreboard (Tab or Scores button), hit markers (bigger on kills), red damage-direction arrows, lead indicator (diamond) for the enemy nearest your aim, red/blue plane markers with range, minimap dots, spawn-protection notice, killcam (3 s watching your killer) then respawn countdown.
- **Rendering**: placeholder plane merged into one draw call per plane, instanced tracers (1 draw call), pooled instanced particles for smoke, fire, sparks and explosions (1 draw call), camera shake on hits and nearby explosions.
- **Settings panel** on the title screen: graphics, aim sensitivity, touch aim assist, volume.
- **Tests**: 41 Vitest (adds swept hits, drop, lead hits a crossing target, convergence, rate of fire, engine/wing penalties, kill/assist credit, part knock-outs, fire, spawn protection, friendly fire, crash credit, bots-only-ControlInput, bots rarely crash, bot lethality by difficulty, full 10-minute headless TDM). Playwright: 20-second solo match on Desktop Chrome and iPhone 13 (setup, scoreboard, screenshots, no console errors); `FULL_MATCH=1` runs a full 10-minute match at 10× speed to the results screen on both viewports (passed); fps budget with combat on screen.

### Balance numbers (measured)

- Headless 10-minute 10 v 10 on normal: ~40 kills, ~18% of bullets hit.
- One bot vs a weaving, non-shooting player, three 5-minute runs: easy 1 kill, normal 4, hard 8.
- Gun damage was doubled from the first guess to get there; TTK is short and arcade-like.

### Performance

- High, laptop GPU: 60 fps, 42 draw calls in a 20-plane fight. Low at phone size with 4× CPU throttle: 60 fps, 37 draw calls. Bundle 169 KB gzip.

### Known issues

- Missile and Flare buttons do nothing yet (Day 7). ~~Planes are still the box placeholder~~ (first six modelled Day 4).
- Wrecks that are still falling when the 5 s respawn comes up explode in mid-air.
- Bots don't use the player's spawn-protection rules beyond not shooting protected planes; no bot-to-bot formation or teamwork.
- `?timescale=` and `?matchtime=` are debug-only test knobs.
- Still not tried on a real phone.

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
