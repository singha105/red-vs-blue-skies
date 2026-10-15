# Progress

Live: https://singha105.github.io/red-vs-blue-skies/ (`?debug=1` shows the FPS counter)
Repo: https://github.com/singha105/red-vs-blue-skies

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

### Review of the jet models

Each preview was checked against the real aircraft's planform; a second pass widened the twin-engine bodies back to the nozzles (F-14, F-15, MiG-29, Su-27, F-22) and moved the Mirage deltas aft. No reference drawings were downloaded this session (Day 4's were), so the review was against known general arrangements; shapes are deliberately simple and some details are approximations: the F-14 is modelled at a mid wing sweep, LERX and canards are flat plates, intakes are boxes.

### Known issues

- Missiles aren't drawn hanging on the pylons yet (the pylon empties exist).
- Notching is all-or-nothing inside the 45 m/s window; there's no partial doppler model.
- A missile's lock state on clients updates at the 20 Hz snapshot rate.
- TURN still isn't configured (Day 5 issue).

### Next steps (Day 8)

- Progression, unlocks, Firebase.

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
