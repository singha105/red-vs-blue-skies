# Red vs Blue Skies — 10-Day Build Plan for Claude Code

Oct 14, 2026 · @Arnab Singh

## How to use this plan

Each day is one Claude Code session started with one copy-paste prompt. Two files in the repo, `CLAUDE.md` and `docs/PROGRESS.md`, carry memory between days, so the game stays consistent even though every session starts fresh.

### One-time setup before Day 1 (about 20 minutes)

1. Install the free tools on your Mac: `brew install node` and `brew install --cask blender`. Git and the `gh` CLI are already set up.
2. Create an empty folder named `red-vs-blue-skies` with a `docs/` folder inside it.
3. Export this doc as Markdown and save it as `docs/BUILD_PLAN.md`. Every daily prompt points Claude Code at it, so the full design spec is always available without pasting it.
4. Open a terminal in that folder and run `claude`.
5. Create two free accounts now so you aren't blocked later: Firebase (needed Day 8, no card required) and Metered Open Relay (needed Day 5, free TURN relay for phones on mobile data).

The game will live at `https://singha105.github.io/red-vs-blue-skies/` once Day 1 is done.

### Daily routine

1. Start a clean session (`/clear`, or a new terminal). Context comes from the repo files, not chat history.
2. Paste the day's prompt. Fill in the `[YOUR NOTES]` slot with bugs or ideas from yesterday's playtest, or write "none".
3. Switch to plan mode (Shift+Tab) for the first message. Read the plan, correct anything wrong, then let it build.
4. Test on your laptop **and** your phone using the live github.io link, not only localhost.
5. Before you stop, Claude Code updates `docs/PROGRESS.md`, commits, and pushes. Tick off the day's "Done when" list.

If a day runs long or you hit your Claude Pro usage limit, stop at the last commit. Next session, paste: "Continue Day N. Read docs/PROGRESS.md for where we stopped."

### How each prompt is structured

Every prompt follows the same five parts, wrapped in XML tags so Claude Code can tell them apart. The tags are a suggestion, not magic; they just keep long prompts unambiguous.

| Part | Tag | What it holds |
| --- | --- | --- |
| 1. Role and task | `<role>` | 1–2 sentences: who Claude is today and the single goal |
| 2. Context | `<context>` | Files to read first, yesterday's state, your playtest notes, things to look up online |
| 3. Instructions | `<task>` | Numbered build steps in order |
| 4. Examples | `<examples>` | Data shapes, message formats, expected output (only on days that need it) |
| 5. Critical rules | `<rules>` | The same non-negotiables every day: $0, works on phones, don't break earlier features, commit, update PROGRESS.md |
| Added: Done when | `<done_when>` | Checks Claude must run and pass before calling the day finished |

The "Done when" block is my addition. It makes Claude Code test its own work (build, automated browser test, screenshots) instead of stopping at "the code is written."

## The $0 tech stack

Every piece below runs on a free tier with no credit card; the only thing you pay for is the Claude Pro plan you already have. Limits were checked on Oct 14, 2026 and are far above what 20 friends will use.

| Need | Tool | Free limit | Why this one |
| --- | --- | --- | --- |
| Hosting | [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) + GitHub Actions deploy | Site up to 1 GB, soft 100 GB/month bandwidth | Free for public repos; Actions deploys skip the 10 builds/hour limit |
| 3D engine | Three.js + Vite + TypeScript | Open source | Runs in every modern browser, including iPhone Safari; TypeScript catches Claude's mistakes early |
| Match connections | PeerJS with its free public signaling server | Free | One player's browser hosts the match; no server to run |
| Phone relay (TURN) | [Metered Open Relay](https://www.metered.ca/tools/openrelay/) | 20 GB/month | [PeerJS dropped its free TURN service](https://github.com/peers/peerjs/discussions/1172); phones on mobile data often can't connect without one |
| Accounts and unlocks | [Firebase Spark](https://firebase.google.com/pricing): Anonymous Auth + Firestore | 50K reads/day, 20K writes/day, 1 GiB stored | No payment method needed; a full night of matches uses a few hundred writes |
| Plane and weapon models | Blender (headless Python scripts), optional [Blender MCP](https://github.com/ahujasid/blender-mcp) | Open source | Scripts live in the repo, so all 60 planes can be regenerated in one command |
| Model compression | gltf-transform CLI | Open source | Shrinks `.glb` files so phones load fast |
| Sound effects | Procedural Web Audio (jsfxr-style) | Built into browsers | Zero files to license, tiny download |
| Testing | Playwright + Vitest | Open source | Claude Code can open the game in desktop and phone-sized browsers and take screenshots to check its own work |
| Voice chat | Discord | Free | Not worth building into the game |

Rough bandwidth check: a 5 MB game download × 20 players is 100 MB per game night. A phone on relay uses about 10 KB/s, so a 15-minute match with 5 relayed phones is roughly 50 MB of the 20 GB TURN allowance.

**Why not Unity or a hosted server?** Unity's web builds are heavy and slow to load on phones, and Claude Code iterates much faster on plain TypeScript. Free server hosts either sleep when idle or need a card on file; the host-player model avoids both.

## Design decisions and improvements

These are the changes I'd make to your original idea. The biggest two are host-player networking (the only way to get 20-player matches for $0) and permanent unlocks (so weaker players don't quit).

### Networking

1. **One player hosts each match.** The host's browser runs the real game; everyone else sends their controls 20 times a second and receives the world state back. The host decides every hit, so there are no "I shot him first on my screen" arguments.
2. **Smooth play despite lag.** Your own plane responds instantly (client prediction); other planes are drawn about 100 ms in the past and smoothly blended (interpolation).
3. **Join by link.** The host gets a 4-letter room code and a share link like `.../red-vs-blue-skies/?room=XQ7K` to drop in your group chat.
4. **Best device hosts.** The lobby recommends a laptop on Wi-Fi as host. If the host quits, the match ends and everyone keeps the points earned so far.

&#91;embedded content: match architecture · 8 parts\]

Solid lines carry live match data; dashed lines are used only to load the game, join, and save results. Only phones that can't connect directly use the TURN relay.

### Progression and balance

5. **Unlocks are permanent research, not a per-match reward.** Your rule stays: more kills earn more points, so top players unlock faster. But everyone earns something every match, so nobody gets stuck.
6. **Points for more than kills:** damage dealt, assists, zone captures, ground targets, surviving, and a team-win bonus.
7. **Underdog bonus.** Killing a plane 2+ tiers above you pays double or triple; killing one far below you pays very little.
8. **Battle Rating (BR).** Every plane has a BR. Teams are auto-balanced by total BR, not just headcount.
9. **Spawn points.** Better planes cost more to spawn. You can bring your best jet, but after it dies you may need to fly a cheaper plane to earn it back.

### Look and feel

10. **Team paint instead of national markings.** Any plane can fly for either team, so planes get bold blue or red bands and a team roundel. It's instantly readable on a small phone screen and avoids historical insignia problems.
11. **Low-poly, no textures.** Each plane is a few hundred to 1,500 triangles with flat vertex colors. All 60 planes together stay around a few MB, and only the voted era's planes are downloaded.
12. **Arcade flight with energy.** Not a simulator, but tight turns bleed speed, dives build it, and slow planes stall. This single rule makes dogfights tactical.
13. **Anti-frustration:** 3 seconds of spawn protection, an out-of-bounds warning, a killcam, and an "auto-level" button for phone players.

### Any device

14. **One control idea for every device: point where you want to fly.** Mouse on laptops, drag on phones, right stick on gamepads, all steering the same aim point.
15. **Light aim assist for touch players only** (a lead marker plus slight bullet magnetism), with a slider to turn it off. Mouse players otherwise dominate.
16. **Installable app (PWA).** On iPhone, Safari can't go fullscreen, but "Add to Home Screen" launches the game fullscreen in landscape like a real app.
17. **Automatic graphics level.** The game measures frame rate for 5 seconds and drops to Low on weak phones (target: 60 fps laptop, 30 fps mid-range phone).
18. **Cross-device progress.** Play instantly as a guest; optionally link Google sign-in (free in Firebase) to keep unlocks on your phone and laptop.

### Always a full match

19. **Bots fill empty slots up to 20.** Three friends online still get a 10 vs 10 battle, and you can test everything alone.
20. **Everything is data.** Planes, missiles, eras, and maps live in JSON files, so balancing is editing numbers, not code.

## Game design spec

Six eras, ten planes each (60 total), red vs blue, up to 20 players with bots filling empty slots. Claude Code turns this section into `docs/GAME_DESIGN.md` and the JSON data files on Day 1.

### Eras

| Era | Years | Weapons | Missiles |
| --- | --- | --- | --- |
| WW1 | 1914–1918 | 1–2 machine guns | None |
| Early WW2 | 1930–1941 | Machine guns, some 20 mm cannons | None |
| Late WW2 | 1942–1945 | Heavy MGs, 20–30 mm cannons, unguided rockets | None |
| Early Jets | 1946–1958 | Cannons | Tiers 9–10 only: rear-aspect IR |
| Cold War | 1959–1984 | Cannons | IR and semi-active radar |
| Modern | 1985–2010 | Cannons | All-aspect IR, high off-boresight IR, active radar |

### Plane roster (tier 1 = weakest, tier 10 = best)

| Tier | WW1 | Early WW2 | Late WW2 | Early Jets | Cold War | Modern |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Fokker E.III | Boeing P-26 | P-40E Warhawk | P-80 Shooting Star | MiG-21F-13 | MiG-29A |
| 2 | Airco DH.2 | Gloster Gladiator | P-39 Airacobra | DH Vampire | F-104G Starfighter | Mirage 2000-5 |
| 3 | Nieuport 11 | Fiat CR.42 | F6F Hellcat | Gloster Meteor F.8 | Mirage IIIE | F/A-18C Hornet |
| 4 | Sopwith Pup | Polikarpov I-16 | Fw 190 A-8 | F-84G Thunderjet | F-5E Tiger II | F-16C Block 50 |
| 5 | Albatros D.III | Curtiss P-36 Hawk | P-47D Thunderbolt | MiG-15bis | F-4E Phantom II | JAS 39C Gripen |
| 6 | Fokker Dr.I | Hurricane Mk I | F4U-4 Corsair | F-86F Sabre | MiG-23MLD | Su-27S |
| 7 | Sopwith Camel | A6M2 Zero | Yak-3 | MiG-17 | Mirage F1C | F-15C Eagle |
| 8 | S.E.5a | Bf 109 E-4 | P-51D Mustang | Hawker Hunter F.6 | F-14A Tomcat | Rafale C |
| 9 | SPAD S.XIII | Spitfire Mk V | Spitfire Mk XIV | MiG-19 | F-16A | Eurofighter Typhoon |
| 10 | Fokker D.VII | Bf 109 F-4 | Me 262 A-1 | F-8 Crusader | F-15A Eagle | F-22A Raptor |

The order is a starting point for balance, not a historical ranking. Claude Code verifies each plane's years, speed, and armament online before building it, and may swap a plane if a better fit for the tier exists.

Each plane in `planes.json` has 9 stats: top speed, turn rate, climb rate, roll rate, HP, gun damage per second, ammo, missile loadout, and countermeasures. Battle Rating = 1.0 + 0.3 × (tier − 1), so tier 1 is 1.0 and tier 10 is 3.7.

### Missiles and countermeasures

Ranges are game values scaled to the map, not real-world figures.

| Class | Real examples | How it locks | Game range | Beaten by |
| --- | --- | --- | --- | --- |
| Rear-aspect IR | AIM-9B, K-13 | Only from behind the target, 20° cone, 2 s to lock | 2.5 km | Flares (60% each), flying toward the sun |
| All-aspect IR | AIM-9L, R-60 | Any angle, 30° cone, 1.5 s | 3.5 km | Flares (40% each) |
| High off-boresight IR | R-73, AIM-9X | Up to 75° off the nose, 1 s | 4 km | Flares (25% each), hard turns |
| Semi-active radar | AIM-7, R-27R | Your radar must stay locked until impact | 6 km | Chaff, notching (fly 90° to the missile), breaking the shooter's lock |
| Active radar | AIM-120, R-77, MICA | Fire and forget | 8 km | Chaff, notching, outrunning it |

Rules that keep missiles fair: 2–6 missiles per plane, no reloads until respawn, a warning tone when locked and a louder one at launch, and a missile hit does 70–100% damage depending on plane HP, so guns still matter. The F-22A also halves the range at which enemies can radar-lock it.

### Research points and unlocks

Points are permanent and spent in any era's tree, unlocking tiers in order. Tier 1 of every era is free.

| Action | Research points (RP) |
| --- | --- |
| Kill | 100 × underdog multiplier (×3 if target is 3+ tiers higher, ×2 at +2, ×1 within ±1, ×0.5 at −2, ×0.25 at −3 or lower) |
| Assist (25%+ of the target's damage) | 40 |
| Damage dealt | 1 per 1% of a plane's HP |
| Capture a zone / destroy a ground target | 50 / 30 |
| Survive to the end | 30 |
| Team win | +25% of your match total |
| Top scorer (MVP) | +20% of your match total |
| Played a full match | Minimum 50 |

Unlocking tier N costs 200 × N RP (tier 2 = 400, tier 10 = 2,000; a full era is about 10,800). A typical match with 3 kills earns about 600–700 RP, so a full era takes roughly 15 matches, faster for top players.

**Spawn points (SP):** your first spawn is free with any unlocked plane. Later spawns cost 100 + 50 × tier SP, and you earn SP in-match: 100 per kill, 40 per assist, 50 per capture.

### Modes

- **Team Deathmatch:** first team to 50 kills or most kills after 10 minutes.
- **Air Domination:** 3 zones; fly below 300 m over a zone to capture it; held zones drain enemy tickets.
- **Ground Strike:** destroy the enemy's AI convoys, bunkers, and ships; gives bombers and attackers a job.
- **Bomber Escort:** one team protects AI bombers flying a route, the other intercepts them.

### Maps

About 16 × 16 km each, generated from a seed so they cost nothing to store.

- **Island Chain:** open ocean and green islands; the default map.
- **Mountain Valley:** a canyon you can fly through to escape missiles.
- **Desert Mesas:** flat-topped plateaus, great visibility.
- **Carrier Strike:** open ocean with one aircraft carrier per team as the ground target.

### Lobby flow

Join by link → pick a callsign → 20-second vote on era, map, and mode (ties broken randomly; host can override) → teams auto-balanced by BR → pick a plane → fly. A match lasts 10 minutes, then a results screen shows RP earned, unlocks, and awards.

## Day 1 — Foundation and live deploy

By tonight the game has a public URL, a working deploy pipeline, a mobile-ready shell, and all 60 planes defined as data. Nothing flies yet; that's Day 2.

```text
<role>
You are the lead engineer for "Red vs Blue Skies", a low-poly multiplayer air-combat browser game for up to 20 players on phones, tablets, and laptops, hosted free on GitHub Pages. Today (Day 1 of 10) you set up the project and ship a live game shell.
</role>

<context>
- Read docs/BUILD_PLAN.md completely before doing anything. It is the source of truth for the stack, design decisions, and game spec.
- The folder is empty except docs/. GitHub user: singha105. git and the gh CLI are already logged in.
- Machine: Mac with Apple Silicon and 8 GB RAM. Keep dev processes light.
- Look up the current Three.js version and the current official "Vite to GitHub Pages with GitHub Actions" workflow before configuring.
- My notes: [YOUR NOTES]
</context>

<task>
1. Create the public repo singha105/red-vs-blue-skies with gh and push an initial commit.
2. Scaffold Vite + TypeScript (strict mode) + Three.js with this layout: src/core (loop, input, settings), src/game (simulation, no Three.js imports), src/render, src/net, src/ui, src/data, public/models, tools/blender, tests/.
3. Set Vite base to '/red-vs-blue-skies/'. Add a GitHub Actions workflow that builds and deploys to Pages on every push to main. Enable Pages with source "GitHub Actions" using gh api.
4. Write CLAUDE.md (under 150 lines): one-paragraph project summary, commands, folder map, coding conventions, the rules block below, and "Always read docs/PROGRESS.md first."
5. Turn the "Game design spec" section of BUILD_PLAN.md into docs/GAME_DESIGN.md.
6. Create data files in src/data: eras.json, planes.json (all 60 planes from the roster), missiles.json, maps.json, modes.json. Use the schema in <examples>. Fill real top speed and armament from quick online lookups where easy; set "verify": true on anything uncertain. Game stats (turn rate, HP) are balance values, not real data.
7. Add TypeScript types and a loader that validates every data file at startup and shows a clear error if one is invalid.
8. Build the mobile-ready shell: viewport meta with zoom disabled, full-window canvas, resize handling, device pixel ratio capped at 2, a "rotate your phone" overlay in portrait, a PWA manifest with generated roundel icons, and a minimal service worker so it can be installed.
9. Title screen with "Play Solo" and "Host / Join" buttons (stubs for now), large enough for thumbs.
10. Test scene: sky gradient, ocean, three low-poly islands, a placeholder plane (box + wings) circling. FPS counter shown only with ?debug=1.
11. Settings module (graphics auto/low/high, sensitivity, aim assist, volume) saved to localStorage, wrapped in try/catch so private browsing doesn't crash it.
12. Set up Vitest (a test that validates all data files) and Playwright with two projects: Desktop Chrome and iPhone 13 (WebKit). Smoke test: page loads, canvas renders, no console errors, screenshots saved to tests/screenshots/.
13. Create docs/PROGRESS.md: done today, known issues, next steps, live URL.
14. Commit in small steps with clear messages, push, confirm the Actions run succeeded and the live URL loads.
</task>

<examples>
One planes.json entry (speed and guns are real; turn rate and HP are game values):
{
  "id": "spitfire_mk5",
  "name": "Supermarine Spitfire Mk V",
  "era": "early_ww2",
  "tier": 9,
  "br": 3.4,
  "years": "1941",
  "stats": { "topSpeedKmh": 594, "turnRateDegS": 22, "climbMs": 14, "rollRateDegS": 120, "hp": 100 },
  "guns": [
    { "type": "cannon_20mm", "count": 2, "ammoPerGun": 60 },
    { "type": "mg_303", "count": 4, "ammoPerGun": 350 }
  ],
  "missiles": [],
  "countermeasures": { "flares": 0, "chaff": 0 },
  "model": "models/early_ww2/spitfire_mk5.glb",
  "verify": true
}
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets (nothing from War Thunder or other games). Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
</rules>

<done_when>
- https://singha105.github.io/red-vs-blue-skies/ shows the title screen and test scene on desktop and on an iPhone-sized viewport.
- npm test and npx playwright test both pass; screenshots are saved.
- CLAUDE.md, docs/GAME_DESIGN.md, docs/PROGRESS.md and all five JSON data files exist and validate.
</done_when>
```

## Day 2 — Flight model, controls, first map

By tonight you can fly over Island Chain with a mouse, a phone, or a gamepad, and it feels good. Flying is the core of the game, so this day gets the most polish.

```text
<role>
You are the lead engineer for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 2 of 10) you make flying feel great on every device: the flight model, cross-device controls, the camera, and the first real map.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md first. Day 1 shipped the shell, data files, and deploy pipeline.
- Look up how "mouse aim" / "instructor" control schemes work in arcade flight games (the concept only: the player moves an aim point and an autopilot steers the plane toward it).
- Look up current Three.js performance tips for mobile (instancing, draw calls, pixel ratio).
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
1. Game loop: fixed 60 Hz simulation step, separate from rendering. All game state is plain serializable data (no Three.js objects in src/game), because Day 5 sends it over the network.
2. Arcade flight model driven by planes.json stats: throttle 0–100%, lift that depends on speed, stall below a stall speed (nose drops, controls go soft), sustained turns bleed speed in proportion to G, dives gain speed, climbs lose it, a service ceiling, terrain collision = crash, and a warning then auto turn-back at the map edge.
3. One control input type, ControlInput { pitch, roll, yaw, throttle, fire, missile, flare, ... }, produced by every input device and later by bots.
4. Mouse-aim: a world-space aim point the plane steers toward with a smooth PD controller.
   - Desktop: pointer lock, mouse moves the aim, W/S throttle, A/D roll override, C free-look.
   - Touch: drag anywhere on the right half to move the aim (relative drag), a vertical throttle slider on the left, placeholder buttons for Fire, Missile, Flare, Auto-level, Free-look. Buttons at least 56 px, placed for thumbs, respecting safe-area insets (notch).
   - Gamepad API: left stick aims, triggers set throttle.
   - Arrow-key fallback.
5. Chase camera: smooth follow with slight lag, field of view widens with speed, a camera-shake hook for later.
6. Map "Island Chain" from maps.json: seeded noise heightmap, 16 × 16 km, flat-shaded low-poly terrain in chunks with distance-based detail, ocean with a simple shader, sky gradient and sun, instanced low-poly clouds, fog to hide the draw distance.
7. Graphics quality: "auto" measures fps for 5 seconds and picks low/medium/high (pixel ratio, shadows, cloud count, draw distance).
8. HUD as an HTML/CSS overlay that scales with screen size: speed, altitude, throttle, stall warning, the aim reticle and the plane's nose marker (two circles), and a minimap placeholder.
9. Playwright: on the iPhone viewport, simulate a touch drag and assert the aim point moved. Save desktop and phone screenshots.
10. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
Shape of one plane's state in the simulation:
{ "id": "p7", "team": "blue", "planeId": "spitfire_mk5", "pos": [1200, 850, -340], "quat": [0, 0.38, 0, 0.92], "vel": [0, -2, -150], "throttle": 0.85, "hp": 100, "stalled": false, "alive": true }
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: src/game must never import Three.js; keep simulation and rendering fully separate.
</rules>

<done_when>
- On the live site you can spawn in the air, fly, stall and recover, and crash into terrain using mouse, touch, and keyboard.
- The touch-drag Playwright test passes on the iPhone viewport.
- The debug fps counter meets the budget on your laptop at "high" and on the throttled phone profile at "low".
</done_when>
```

## Day 3 — Guns, damage, bots: playable solo

By tonight you can play a full 10 vs 10 Team Deathmatch alone against bots. This is the first version that is actually a game.

```text
<role>
You are the lead gameplay engineer for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 3 of 10) you add guns, damage, respawning, a HUD, and AI bots so a solo player can play a full 10 vs 10 match.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md first. Day 2 delivered the flight model, ControlInput, controls, camera, and Island Chain.
- Look up the muzzle velocity and rate of fire of the gun types used in planes.json (for example .303 Browning, .50 M2, 20 mm Hispano, 30 mm MK 108) and simple air-combat bot AI patterns (pursuit, lead pursuit, break turn).
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
1. Guns from data: add guns.json with rate of fire, muzzle velocity, damage, spread, and tracer color per gun type. Bullets are simulated in src/game with gravity drop and rendered as instanced tracers. Guns converge at 300 m.
2. Hit detection: each plane has 4 hit spheres (fuselage, left wing, right wing, engine/tail). Use a swept test along each bullet's path per tick so fast bullets can't skip through.
3. Damage model: engine hit = top speed −30% plus smoke; wing hit = roll and turn −25%; a 15% chance of fire that drains HP for 10 seconds. At 0 HP: explosion, wreck falls, kill credited (assist to anyone who did 25%+).
4. Lead indicator: a marker showing where to aim at the selected target. For touch players only, aim assist adds slight bullet magnetism within 2° (on by default, slider in settings).
5. Respawn: 5-second timer, spawn in the air at the team's side at 1,500 m, 3 seconds of spawn protection.
6. Bots that use exactly the same ControlInput as humans: patrol, choose a target (nearest enemy weighted by threat), lead-pursue, fire inside a cone and range, break-turn or dive when shot at, avoid terrain with a look-ahead check, stay inside the map. Easy/normal/hard via reaction time and aim error.
7. Solo mode: Play Solo → choose era → 10 vs 10 with bots, Team Deathmatch (first to 50 kills or most kills after 10 minutes). With ?debug=1 all planes are selectable; otherwise tiers 1–3 for now.
8. HUD: health and damaged parts, ammo, kill feed, scoreboard (Tab key or on-screen button), hit markers, damage-direction arrows, respawn screen.
9. Killcam: 3 seconds looking at your killer before the respawn screen.
10. Tests: Vitest for ballistics and damage; Playwright starts a solo match, runs 20 seconds with no console errors, and saves screenshots at desktop and iPhone size.
11. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
One guns.json entry (velocity and rate of fire are real; damage is a game value):
{ "id": "cannon_20mm", "name": "20 mm Hispano", "rpm": 600, "muzzleVelocityMs": 880, "damage": 9, "spreadDeg": 0.35, "tracerColor": "#ffb347" }
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone. With 20 planes and hundreds of tracers, use instancing and object pools; no per-bullet meshes.
5. No copyrighted assets. Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: bots must only act through ControlInput, never by editing plane state directly. Day 5 networking depends on this.
</rules>

<done_when>
- A full 10-minute solo Team Deathmatch runs to the results without errors on desktop and on a phone.
- Bots shoot you down sometimes on normal and almost never on easy.
- Ballistics and damage unit tests pass; the 20-second Playwright match test passes on both viewports.
</done_when>
```

## Day 4 — Blender pipeline and first planes

By tonight one command turns plane specs into game-ready 3D models, and six real planes plus all weapon models are in the game.

The approach: instead of sculpting 60 planes by hand, Claude Code writes a Python "plane kit" for Blender that builds a fuselage, wings, tail, engine, and canopy from numbers (length, wingspan, wing shape, sweep). Each plane is then a small JSON spec that Claude fills in by researching the real aircraft. Blender renders preview images, Claude looks at them, compares against reference photos, and fixes proportions. Everything runs headless, so it's light on your 8 GB Mac and fully repeatable.

The six planes are chosen to test every body type the kit needs: biplane, triplane, elliptical wing, gull wing, swept-wing jet, and twin-engine jet with missiles.

```text
<role>
You are the lead engineer and 3D technical artist for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 4 of 10) you build an automated, scripted Blender pipeline and use it to model the first six planes and all weapon models.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md first. Day 3 delivered a playable solo match with placeholder planes.
- Blender is installed at /Applications/Blender.app/Contents/MacOS/Blender. Verify the version and that it runs with --background. Always run it headless; the Mac has 8 GB RAM.
- Today's planes: Sopwith Camel, Fokker Dr.I, Spitfire Mk V, F4U-4 Corsair, MiG-15bis, F-4E Phantom II.
- For each plane, look up online: length, wingspan, height, wing planform and root/tip chord, sweep, dihedral, engine and propeller blade count or intake layout, canopy shape, tail layout, and typical paint scheme. Download one side-view photo or three-view drawing per plane (Wikimedia Commons is a good source) to tools/blender/refs/ for comparison only. Add refs/ to .gitignore; never ship it.
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
1. tools/blender/plane_kit.py: a parametric generator with builders for: fuselage (loft through cross-sections along the length), wings (planform with root/tip chord, span, sweep, dihedral, taper; elliptical and gull-wing options; biplane/triplane stacking with struts), tail (horizontal stabilizer, single fin, twin fins, anhedral), engines (radial cowl, inline nose, jet nose intake, side intakes, exhaust nozzles), propeller (blade count, separate object so it can spin), canopy, missile pylons.
2. One spec per plane at tools/blender/specs/<id>.json in real meters, using the format in <examples>.
3. Materials: flat vertex colors, no textures. Four material slots: BODY (the plane's base color or a simple camo approximation), TEAM (white in the file; the game tints it red or blue), GLASS, DARK. No national insignia.
4. Named empties the game uses: "prop" (spins), "muzzle_1..n" (gun positions), "pylon_1..n" (missile mounts), "exhaust_1..n" (smoke, afterburner).
5. Export .glb following glTF conventions (+Y up, +Z forward), transforms applied. Triangle budget: 1,200 for props, 1,500 for jets. Compress with gltf-transform using meshopt.
6. tools/blender/render_preview.py: render each model from front, side, top, and three-quarter views with the Workbench engine at 512 px into tools/blender/previews/<id>.png.
7. Review loop: open each preview image and compare it with the reference image. Fix wrong proportions, wing position, or silhouette, and re-render. Up to 3 passes per plane. The goal is that someone who knows the plane recognizes it at a glance from its silhouette.
8. tools/blender/weapons_kit.py: missile_ir_small, missile_ir_large, missile_radar_medium, missile_radar_long, rocket, bomb_250, drop_tank, at most 200 triangles each.
9. One command, npm run models, rebuilds every spec, compresses, writes public/models/<era>/<id>.glb plus public/models/manifest.json, and prints total size.
10. In the game: GLTFLoader with the meshopt decoder, tint TEAM to red/blue, spin the prop with throttle, muzzle flashes at muzzle empties, placeholder fallback for planes without a model yet, and load only the current era's models.
11. Hangar screen: rotate the selected plane with mouse or finger and show its stats. Useful for checking models on a phone.
12. Record the Blender path and the npm run models command in CLAUDE.md. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
tools/blender/specs/spitfire_mk5.json (dimensions approximate; verify online):
{
  "id": "spitfire_mk5",
  "era": "early_ww2",
  "lengthM": 9.12,
  "wingspanM": 11.23,
  "fuselage": { "sections": [[0.00, 0.55, 0.75], [0.25, 0.90, 1.30], [0.60, 0.70, 1.00], [1.00, 0.15, 0.35]] },
  "wing": { "planform": "elliptical", "rootChordM": 2.5, "positionAlongLength": 0.32, "dihedralDeg": 6, "sweepDeg": 0, "mount": "low" },
  "tail": { "type": "conventional", "finHeightM": 1.1, "stabSpanM": 3.2 },
  "engine": { "type": "inline_nose", "propBlades": 3, "spinner": true },
  "canopy": { "type": "teardrop", "positionAlongLength": 0.42 },
  "guns": [{ "at": "wing", "spanFraction": 0.35 }, { "at": "wing", "spanFraction": 0.5 }],
  "colors": { "body": "#6b7356", "camo": "#8a7a5c", "underside": "#b8c4c8", "teamBand": "aft_fuselage_and_wingtips" }
}
(sections = [position along length 0–1, width m, height m])
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Never download or copy 3D models from the internet; reference images are for looking only and stay out of git.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: every model must be reproducible from scripts and specs in the repo. If you use Blender MCP for an interactive fix, write the change back into the spec or kit.
</rules>

<done_when>
- npm run models rebuilds all six planes and the weapon models from a clean state.
- Preview PNGs exist for every model and you have reviewed each one against its reference.
- The six planes fly in solo matches with red/blue team paint, spinning props, and correct muzzle positions, on desktop and phone.
- Total model size is reported in PROGRESS.md.
</done_when>
```

**Optional Blender MCP.** If you'd like to watch Claude model live inside the Blender window, install [Blender MCP](https://github.com/ahujasid/blender-mcp) and run `claude mcp add blender uvx blender-mcp` (set `DISABLE_TELEMETRY=true` to turn off its usage reporting). It's handy for one-off fixes, but the headless scripts remain the source of truth.

## Day 5 — Multiplayer

By tonight you and two friends (one on a phone using mobile data) fly in the same match from the live site. This is the riskiest day technically, so test with real devices before you stop.

Before starting, log in to your free Metered account, create a TURN credential, and have its API key ready to paste when Claude asks.

```text
<role>
You are the network engineer for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 5 of 10) you make the game multiplayer for up to 20 players using a host-authoritative model over WebRTC, with no game server.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md first. The simulation in src/game is plain data with no Three.js (Day 2), and bots and humans both drive planes through ControlInput (Day 3). Both were designed for today.
- Architecture: one player's browser (the host) runs the authoritative simulation. Clients send inputs and receive snapshots. PeerJS's free public signaling server introduces peers. PeerJS no longer provides free TURN, so use Google's public STUN plus Metered Open Relay TURN for phones behind mobile-carrier NAT.
- Look up: the current PeerJS version and API, how to fetch Metered Open Relay TURN credentials from the browser, and current iOS Safari support and background behavior for WebRTC data channels.
- I will paste the Metered API key when you ask. Store it as VITE_TURN_API_KEY in .env (gitignored) and as a GitHub Actions secret for the deploy build.
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
1. A Transport interface in src/net so PeerJS could later be swapped out without touching game code.
2. Host flow: create a peer with ID "rvbs-<ROOMCODE>" (4 letters, skip look-alikes like O/0, I/1). Show the code, a share link (?room=CODE), a copy button, and a QR code generated locally for phones.
3. Join flow: open the link → enter a callsign → connect to the host. ICE servers: Google STUN + Metered TURN.
4. Two channels: unreliable/unordered for inputs and snapshots; reliable/ordered for events (join, leave, chat, kills, match state).
5. Protocol: clients send ControlInput 30 times/s with sequence numbers. The host simulates at 60 Hz and sends binary snapshots at 20 Hz (quantized positions, compressed quaternions, velocity, HP, flags). Don't send individual bullets: send a firing flag, draw tracers locally, and let the host decide hits and broadcast hit/kill events.
6. Client prediction for your own plane with reconciliation (replay unacknowledged inputs after each snapshot). Draw other planes 100 ms in the past with interpolation; extrapolate up to 250 ms during packet loss.
7. The host also plays through a local loopback client. The host fills empty slots with bots up to 20.
8. Disconnects: if a client leaves, a bot takes over their slot after 10 seconds. If the host leaves, everyone sees a "Host left" screen with results so far.
9. Host validation: clamp every input field, rate-limit firing to the gun's real rate of fire, reject clients running a different build version.
10. Debug overlay (?debug=1): ping, packet loss, snapshots per second, bytes per second in and out.
11. Lobby ping test that recommends the best host (prefer laptops on Wi-Fi; phones get suspended when the screen locks).
12. Tests: a Vitest fake transport with configurable delay and loss to test prediction and interpolation; a Playwright test with 3 browser contexts on localhost (1 host, 2 clients) asserting everyone sees each other move.
13. Give me a short manual test script for tonight (2 laptops + 1 phone on mobile data). Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
Message types:
type ClientMsg =
  | { t: "hello"; callsign: string; version: string }
  | { t: "input"; seq: number; pitch: number; roll: number; yaw: number; throttle: number; fire: boolean; missile: boolean; flare: boolean };
type HostEvent =
  | { t: "welcome"; playerId: string; team: "red" | "blue"; tick: number }
  | { t: "kill"; killer: string; victim: string; weapon: string; assists: string[] }
  | { t: "match"; state: "lobby" | "vote" | "playing" | "results" };

Bandwidth target: 20 planes × about 32 bytes × 20 snapshots/s ≈ 13 KB/s per client; host upload about 260 KB/s total.
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit. Solo mode must still work with no network at all.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: never trust clients. The host is the only one that decides hits, damage, kills, and scores.
</rules>

<done_when>
- Two laptops and a phone on mobile data play one match together on the live site.
- The debug overlay shows under 30 KB/s per client.
- The fake-transport tests and the 3-context Playwright test pass.
</done_when>
```

## Day 6 — Lobby, voting, teams, match flow

By tonight your group can join a lobby, vote on era, map, and mode, get balanced teams, play, see results, and go again without reloading.

```text
<role>
You are the lead engineer and UI designer for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 6 of 10) you build the full multiplayer session loop: lobby, voting, team balancing, plane selection, spawn points, results, and replay.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md first (especially "Research points and unlocks" and "Lobby flow"). Day 5 delivered host/join, snapshots, prediction, and host-side bots.
- Unlocks and research points arrive on Day 8. Today use a local stub: tiers 1–3 unlocked, everything unlocked with ?debug=1.
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
1. A screen state machine: Title → Callsign → Host/Join → Lobby → Vote → Teams → Plane select → Match → Results → back to Lobby. All screens touch-friendly and readable on a 375 px wide phone in landscape.
2. Lobby: player list with team colors and a ready toggle. Host controls: start, kick, bot difficulty, bots on/off, match length. Quick chat buttons ("Need help!", "On my way", "Nice shot", "Good game") plus short text chat.
3. Vote: era, map, and mode with live counts and a 20-second timer. Ties are random; the host can override.
4. Teams: split humans evenly by research points (stubbed today), keep parties together (up to 3 friends can party up in the lobby), then let bots pick planes that even out the total Battle Rating of both teams to within 10%. Bots are the balancing lever, so humans always fly what they want.
5. Plane select: the voted era's 10 planes as cards (silhouette from the hangar, tier, BR, key stats). Locked planes are greyed out with their RP cost.
6. Spawn points: first spawn free; later spawns cost 100 + 50 × tier SP, earned in-match at 100 per kill, 40 per assist, 50 per capture. The respawn screen shows which planes you can afford.
7. Results: winning team, scoreboard (kills, assists, damage, deaths, RP earned), and awards: MVP (top score), Ace (5+ kills in one life), Wingman (most assists), Survivor (fewest deaths). "Play again" returns everyone to the lobby without reconnecting.
8. Join in progress: allowed, joining the smaller team; a bot leaves to make room.
9. Tests: a Playwright test with 3 contexts running the full loop twice (vote → play 30 s with a short-match debug flag → results → lobby), plus unit tests for team balancing.
10. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
Balancing check: blue has 4 humans flying tiers 7, 5, 3, 2 (BR 2.8 + 2.2 + 1.6 + 1.3 = 7.9) and red has 4 humans flying tiers 4, 4, 3, 1 (BR 1.9 + 1.9 + 1.6 + 1.0 = 6.4). The 6 bots on each team pick planes so both team totals end within 10% of each other.
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit. Solo mode still works offline.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: the host owns all lobby and match state; clients only send requests (vote, ready, pick plane).
</rules>

<done_when>
- Three real devices complete two full matches in a row (lobby → vote → play → results → lobby) without reloading.
- Team BR totals are within 10% in every test match.
- The full-loop Playwright test passes.
</done_when>
```

## Day 7 — Missiles, countermeasures, jet models

By tonight modern jets lock, launch, and dodge missiles, bots use them sensibly, and all 30 jets have models. This is a two-part day; if you hit a limit, finish part A and continue part B next session.

```text
<role>
You are the weapons and avionics engineer, and the 3D technical artist, for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 7 of 10) you add guided missiles and countermeasures (part A) and build the remaining jet models with the Day 4 plane kit (part B).
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md ("Missiles and countermeasures") first.
- Look up how these work in principle: proportional navigation guidance, IR seeker cones and rear-aspect vs all-aspect seekers, semi-active vs active radar homing, notching, and how flares and chaff decoy missiles. Also look up which missiles each jet in planes.json historically carried.
- Jets still needing models: all Early Jets, Cold War, and Modern planes except MiG-15bis and F-4E (built Day 4). Use plane_kit.py and the same research → spec → preview → review loop.
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
Part A: missiles
1. missiles.json with the 5 classes from GAME_DESIGN.md and named variants (AIM-9B, K-13, AIM-9L, R-60, R-73, AIM-9X, AIM-7F, R-27R, AIM-120B, R-77, MICA). Fields: seeker, aspect, cone, lock time, min/max range, speed, max G, motor burn time, flare/chaff resistance, damage. Assign historically plausible loadouts per jet in planes.json.
2. Seekers: IR sees engine heat (afterburner hotter); rear-aspect IR needs the target's tail within its cone; the sun within 10° of the seeker can steal an IR lock. Radar needs your radar locked (60° cone); semi-active needs that lock held until impact. A target flying 90° to the shooter (closing speed near zero) breaks radar lock (notching). Radar locks are weaker below 300 m altitude (ground clutter).
3. Guidance: proportional navigation with N = 3–4, limited by max G. After motor burnout the missile slows, so it can be outrun or out-turned.
4. Countermeasures: flares vs IR, chaff vs radar, limited counts per plane, success chance from the missile's resistance.
5. Cockpit UI: target selection (tap an enemy on touch, R on desktop, a shoulder button on gamepad), lock box, IR growl while seeking and a steady tone when locked, a radar-warning display with threat directions, and a loud red launch warning. On touch, the Missile button shows a lock-progress ring.
6. Bots: fire at good range and aspect, release flares/chaff when warned, notch radar missiles.
7. Networking: missiles are host-simulated entities included in snapshots; launch and detonation are reliable events.
8. Tests: guidance hits a non-maneuvering target; notching breaks semi-active lock; flare success rate matches resistance over 1,000 trials.

Part B: jet models
9. Specs and models for the remaining 28 jets, with pylons placed for their missiles and exhaust empties for afterburner glow. Review every preview against its reference.
10. If time runs short, finish tiers 1, 5, and 10 of each jet era first, leave placeholders for the rest, and list them in PROGRESS.md.
11. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
One missiles.json entry (game values, scaled to the map):
{ "id": "aim9l", "name": "AIM-9L Sidewinder", "class": "ir_all_aspect", "coneDeg": 30, "lockTimeS": 1.5, "minRangeM": 300, "maxRangeM": 3500, "speedMs": 750, "maxG": 30, "burnTimeS": 5, "flareResistance": 0.6, "damage": 85 }
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Never download 3D models; reference images stay out of git.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: every missile must have a counter a skilled player can use. If testing shows a missile is nearly unbeatable, nerf it in data.
</rules>

<done_when>
- In a Modern-era match, players can lock, fire, and defeat missiles with flares, chaff, and notching on desktop and on a phone using taps.
- Bots launch missiles and use countermeasures.
- The guidance, notching, and flare tests pass.
- All 30 jets have models, or the gaps are listed in PROGRESS.md.
</done_when>
```

## Day 8 — Progression, unlocks, Firebase

By tonight every match earns research points that persist across sessions and devices, and the unlock trees work.

Before starting: in the Firebase console, create a project on the Spark plan, add a Web app, enable Anonymous and Google sign-in, and create a Firestore database. Keep the web config snippet ready to paste.

```text
<role>
You are the backend and progression engineer for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 8 of 10) you add permanent player profiles, research points, and unlock trees using Firebase on the free Spark plan.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md ("Research points and unlocks") first. Day 6 used a local unlock stub.
- I created a Firebase project on the Spark plan with Anonymous and Google sign-in and Firestore enabled. I will paste the web config when you ask; it is safe to commit because Firebase web config is public by design. Security comes from Firestore rules.
- Look up the current modular Firebase JS SDK setup, linking an anonymous account to Google, Firestore security rules syntax, and the current Spark plan limits, and confirm our design stays inside them.
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
1. Auth: sign in anonymously on first launch. Optional "Link Google account" in settings so progress follows the player to other devices.
2. Profile document players/{uid}: callsign, rp, unlocked (highest tier per era), lifetime stats (kills, deaths, assists, matches, wins), createdAt.
3. Match results: the host creates matches/{matchId} with the participant uid list. At the end, the host computes every human's RP with the GAME_DESIGN formula (underdog multiplier, assists, damage, captures, survival, win and MVP bonuses, 50 minimum) and sends it to each client, which writes its own matches/{matchId}/results/{uid} and updates its profile.
4. Security rules (friends-grade anti-cheat): players write only their own profile; one result per uid per match; uid must be in the match's participant list; the match must be under 1 hour old; RP gain per match capped at 3,000; unlocks must be bought in order with enough RP.
5. Unlock tree screen per era: 10 tiers, costs (200 × tier RP, tier 1 free), an Unlock button with confirmation. Plane select and team balancing now use real unlocks and RP.
6. Offline fallback: if Firebase can't be reached, the game still plays; results queue in localStorage and sync later.
7. Friends leaderboard: top RP, most kills, best K/D, cached for 5 minutes to keep reads low.
8. Count Firestore reads and writes per match in the debug overlay. Estimate daily usage for 20 players × 20 matches and write the numbers in PROGRESS.md next to the Spark limits.
9. "All unlocked" only with ?debug=1 on localhost; never on the live site.
10. Deploy the rules with npx firebase-tools (tell me when I need to log in in the browser). Test the rules with the local Firestore emulator; if it needs Java, install it with brew install openjdk.
11. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<examples>
Worked RP example: a tier-3 player gets 2 kills on tier-5 planes (100 × 2 × 2 = 400), 1 kill on a tier-3 (100), 1 assist (40), 260% damage (260), survives (30). Subtotal 830. Team wins: +25% = 207.5. Total 1,037.5, rounded to 1,038.
</examples>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit. The game must still be playable with Firebase unreachable.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: Spark plan only. Never enable billing or any feature that requires the Blaze plan (such as Cloud Functions or Cloud Storage).
</rules>

<done_when>
- After a match, RP and unlocks persist after a reload, and on a second device after linking Google.
- The emulator tests prove the rules reject a forged +100,000 RP write and an out-of-order unlock.
- The estimated daily Firestore usage in PROGRESS.md is under 10% of the Spark limits.
</done_when>
```

## Day 9 — Remaining planes, maps, modes, sound, effects

By tonight all 60 planes, 4 maps, and 4 modes are in, and the game has sound. Like Day 7, this is two parts; content can spill into a second session without blocking Day 10.

```text
<role>
You are the content lead and technical artist for "Red vs Blue Skies" (see CLAUDE.md). Today (Day 9 of 10) you finish the remaining propeller planes, three new maps, three new game modes, procedural sound, and visual effects.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md, and docs/GAME_DESIGN.md ("Modes" and "Maps") first.
- Propeller planes still needing models: all WW1, Early WW2, and Late WW2 planes except Sopwith Camel, Fokker Dr.I, Spitfire Mk V, and F4U-4 Corsair (built Day 4). Plus any jets listed as placeholders in PROGRESS.md.
- Look up for each plane the same details as Day 4. Look up how jsfxr-style procedural sound effects and Web Audio engine sounds are made, and how to unlock audio on iPhone Safari.
- My notes from yesterday's test: [YOUR NOTES]
</context>

<task>
Part A: content
1. Models for the 26 remaining propeller planes with the plane kit, reviewed against references. Late WW2 attackers (P-47D, F4U-4, Fw 190 A-8) also get rocket and bomb pylons.
2. Unguided rockets and bombs for Ground Strike, using the Day 4 weapon models.
3. Three generic AI bomber models (WW1, WW2, jet-era) with defensive gunners, for Bomber Escort.
4. Maps: Mountain Valley (a canyon carved into the heightmap that you can fly through), Desert Mesas (terraced noise for flat-topped plateaus), Carrier Strike (open ocean with one simple carrier model per team as the ground target). Each in maps.json with seed, size, colors, spawn points, and zone positions.
5. Modes: Air Domination (3 zones, capture by flying below 300 m inside a zone, held zones drain enemy tickets), Ground Strike (AI convoys driving on paths, bunkers, ships, and weak anti-air guns that shoot back), Bomber Escort (an AI bomber formation flies a route; attackers vs defenders).

Part B: sound and effects
6. Procedural Web Audio, no sound files: engine sound per engine type (rotary, inline, radial, jet, afterburner) pitched by throttle and speed, guns per caliber, hits, explosions, IR growl and lock tones, missile warning, UI clicks. Volume sliders. Unlock audio on the first tap for iPhone.
7. Effects with instanced particles and pooling: damage smoke, fire, explosions, muzzle flashes, contrails for jets above 8,000 m, wingtip vapor at high G. Low graphics disables the heavy ones.
8. Bots learn the new modes: capture zones, attack ground targets, escort or intercept bombers.
9. Update PROGRESS.md, commit, push, confirm deploy.
</task>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone. Only the voted era's models and the voted map load.
5. No copyrighted assets: no downloaded models or sound files.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: report the total download size and per-era model size in PROGRESS.md; if over budget, simplify models before adding more.
</rules>

<done_when>
- All 60 planes have models and appear in the hangar.
- Each of the 4 modes is playable with bots on each of the 4 maps.
- Sound works on an iPhone after the first tap; the low graphics setting holds 30 fps on the throttled phone profile.
</done_when>
```

## Day 10 — Performance, mobile QA, balance, launch

By tonight the game is fast on phones, balanced by data instead of guesswork, easy for new friends to learn, and ready for a 20-player game night.

The standout idea here is the bot tournament: Claude Code runs hundreds of bot-vs-bot duels with the screen off, measures how often each plane wins, and adjusts stats until every tier is better than the one below it without being unbeatable.

```text
<role>
You are the lead engineer for "Red vs Blue Skies" (see CLAUDE.md), now in charge of quality. Today (Day 10 of 10) you make the game fast on phones, balance all 60 planes with data, add a tutorial and accessibility options, fix outstanding bugs, and prepare launch.
</role>

<context>
- Read CLAUDE.md, docs/PROGRESS.md (especially known issues), and docs/GAME_DESIGN.md first.
- Look up current iPhone Safari and Android Chrome quirks for WebGL games (memory limits, PWA install, audio, background tabs) and Three.js profiling tools.
- My notes from yesterday's test, including every bug my friends reported: [YOUR NOTES]
</context>

<task>
1. Performance: profile at iPhone resolution with 4× CPU throttling as a phone proxy. Reduce draw calls below 150, remove per-frame allocations (GC spikes), pool everything, lazy-load era models. Report bundle and model sizes; target first load under 5 seconds on 4G.
2. Mobile QA, then fix: landscape on iPhone and Android, notch safe areas, PWA install and icon, audio unlock, buttons not overlapping, text at least 14 px, a 30 fps cap option to save battery, and visibilitychange handling (pause input when backgrounded, reconnect when back; warn a phone host that locking the screen ends the match).
3. Bot tournament for balance: run the simulation headless at maximum speed for 200 1v1 bot duels per adjacent tier pair in every era. Target: the higher tier wins 60–65%, never above 80%. Adjust planes.json stats, re-run, and save docs/BALANCE_REPORT.md with before/after win rates.
4. Tutorial on first launch (about 60 seconds): fly through rings, shoot target balloons, fire a missile at a drone, drop flares. Skippable and replayable from settings.
5. Accessibility: colorblind-safe team colors option (blue/orange), every audio warning also shown visually, HUD scale slider, invert pitch option.
6. Bug bash: fix every known issue in PROGRESS.md and my notes, worst first.
7. Error overlay: catch global errors, show a friendly message with a "Copy error" button so friends can send you bugs.
8. README and in-game "How to play": controls per device, hosting tips (laptop on Wi-Fi), how unlocks work, credits. Show the version number on the title screen and add a CHANGELOG.md.
9. Game night checklist in docs/GAME_NIGHT.md (see BUILD_PLAN appendix).
10. Update PROGRESS.md, commit, tag v1.0, push, confirm deploy.
</task>

<rules>
1. $0 only: no paid services or assets. Ask me before adding any new external service or account.
2. Every feature must work on phones (touch, small screens, iPhone Safari) as well as on desktop.
3. Don't break earlier work: run the full test suite before each commit.
4. Performance budget: total download under 10 MB; 60 fps on a laptop, 30 fps on a mid-range phone.
5. No copyrighted assets. Make everything or use CC0.
6. Finish by updating docs/PROGRESS.md, committing, pushing, and confirming the live deploy.
7. Today: no new features. Only speed, stability, balance, and clarity.
</rules>

<done_when>
- A full 10-minute match with at least 6 real players, including 2 phones, finishes without a crash or desync.
- Every adjacent-tier pair in BALANCE_REPORT.md is between 55% and 80%.
- All tests pass, v1.0 is tagged, and the README explains controls for every device.
</done_when>
```

## Appendix

### Game night checklist

- [ ] Host on a laptop that's plugged in, on Wi-Fi (or Ethernet), with sleep turned off and the game tab in front.
- [ ] Post the room link in the group chat 10 minutes early.
- [ ] Phone players: "Add to Home Screen", play in landscape, turn off Low Power Mode, use headphones.
- [ ] Discord: one voice channel per team plus a lobby channel.
- [ ] First match: Team Deathmatch on Island Chain in WW1 or Early WW2, so new players learn without missiles.
- [ ] After each match, ask "what felt bad?" and paste the answers into the next day's `[YOUR NOTES]`.

### Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A phone can't join on mobile data | No TURN relay, or the TURN key is wrong | Check the Metered dashboard for usage and the key; test the same phone on Wi-Fi to confirm |
| Everyone lags | The host is on a phone or has weak upload | Host from a laptop on Wi-Fi; drop snapshots from 20 to 15 per second |
| No sound on iPhone | Audio not unlocked yet, or the silent switch is on | Tap the screen once; check the ringer switch |
| Live site shows an old version | Service worker cache | Bump the version number; hard-refresh, or remove and re-add the home-screen app |
| Blender command fails | Wrong path or version | Run `/Applications/Blender.app/Contents/MacOS/Blender --version` |
| Claude Code stops mid-day | Usage limit reached | Wait, then paste "Continue Day N. Read docs/PROGRESS.md for where we stopped." |
| Claude Code drifts off-plan | The session got too long | `/clear`, then the same continue prompt |
| A plane model looks wrong | Spec proportions off | Ask Claude Code to re-research that plane and run another preview review pass |

### After the 10 days

Ideas worth adding once the core is solid, roughly in order of fun per effort:

1. **Target pings:** tap an enemy to mark it for your team, so phone players can coordinate without voice.
2. **Host migration:** another player takes over automatically when the host leaves.
3. **Paint editor:** custom liveries on top of the team color.
4. **Replays:** record snapshots and watch the match back from any plane.
5. **Carrier takeoffs and landings** on Carrier Strike.
6. **Weekly events:** a featured era with double RP.
7. **A real game server** (for example Colyseus) only if your group outgrows 20 players or host-player lag becomes a problem.

### Sources

Checked Oct 14, 2026.

- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Firebase pricing (Spark plan)](https://firebase.google.com/pricing)
- [PeerJS: discontinuation of free TURN services](https://github.com/peers/peerjs/discussions/1172)
- [PeerJS server docs](https://peerjs.com/server/getting-started)
- [Metered Open Relay free TURN server](https://www.metered.ca/tools/openrelay/)
- [Blender MCP](https://github.com/ahujasid/blender-mcp)
- [Claude Code: how Claude remembers your project (CLAUDE.md)](https://code.claude.com/docs/en/memory)
