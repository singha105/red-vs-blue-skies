# Red vs Blue Skies

Low-poly multiplayer air combat in the browser for up to 20 players on phones, tablets and laptops. Red against blue, 60 planes across six eras from WW1 biplanes to modern jets, and bots fill every empty seat so there's always a 10 v 10. It costs nothing to run: one player's browser hosts each match.

**Play: https://singha105.github.io/red-vs-blue-skies/**

New players get a one-minute tutorial the first time they open the game (Settings → Play the tutorial again). The title screen's **How to play** shows [docs/HOW_TO_PLAY.md](docs/HOW_TO_PLAY.md) in the game.

## Controls and cockpit

Every control can be rebound in **Settings → Controls and key bindings** (keyboard, mouse and gamepad). The full guide is [docs/HOW_TO_PLAY.md](docs/HOW_TO_PLAY.md), and the game's **How to play** screen shows the same text.

<!-- how-to-play:start (generated from docs/HOW_TO_PLAY.md by npm run docs:readme; edit that file) -->
### Keyboard and mouse

Click the game once to capture the mouse (Esc frees it and opens the menu). Every key can be changed in **Settings → Controls and key bindings**.

#### Flying

| Key | Action |
| --- | --- |
| Mouse | Steer: the plane flies toward the aim circle |
| W / S | Throttle up / down. Hold W at 100% for WEP (afterburner on jets) |
| A / D | Roll left / right |
| Q / E | Rudder left / right (ramps in over 0.3 s; fine aim and flat turns) |
| H | Airbrake on / off |
| F | Flaps on / off (slower stall, tighter low-speed turns) |
| L | Auto-level: wings level, nose on the horizon |
| Arrow keys | Fly directly without the mouse |

#### Weapons

| Key | Action |
| --- | --- |
| Left mouse | Guns |
| Space | Fire a missile, rocket or bomb |
| Left Shift | Switch secondary weapon (Auto, then each missile type; rockets / bombs) |
| Middle mouse / T | Select the target nearest the crosshair; press again quickly for the next one |
| X | Flares and chaff together |

#### Radar (jets that have one)

| Key | Action |
| --- | --- |
| 1 | Radar on / off |
| 2 | Mode: Search / Dogfight |
| 3 | Range: 5 / 10 / 20 km |
| R | Lock / unlock the target |

#### View and game

| Key | Action |
| --- | --- |
| C (hold) | Free look |
| Right mouse (hold) | Zoom |
| V | Chase view / HUD view (camera at the nose) |
| Tab (hold) | Scoreboard |
| M | Bigger map |
| Enter | Chat (multiplayer) |
| J | Quick chat (then 1–4) |
| Esc | Menu (also frees the mouse) |
| P | Pause (solo only) |

**Mouse joystick:** Settings → Mouse → Mouse joystick makes the mouse move the stick directly (pitch and roll), for players who like flying by hand. Mouse aim is the default.

### Touch (phones and tablets)

Hold the phone sideways.

| Control | Action |
| --- | --- |
| Drag on the right half | Steer (like a trackpad) |
| Left slider | Throttle. The striped band at the top is WEP / afterburner |
| FIRE (hold) | Guns |
| MSL | Fire the secondary weapon. The ring fills as the lock builds; the small › button next to it switches weapon |
| CM | Flares and chaff |
| Tap an enemy plane or a radar contact | Select it as your target |
| RDR | Tap: lock / unlock. Long-press: Search / Dogfight |
| LEVEL | Auto-level |
| Eye button (drag it) | Look around; let go to look ahead again |
| ZOOM (hold) | Zoom |
| Tap the team scores | Scoreboard |

Settings has optional **rudder buttons** and **tilt steering** (tilt the phone to steer; iPhone asks for motion access the first time). Touch aim assist is on by default (Settings → Touch aim assist; 0% turns it off).

### Gamepad

Any standard pad works once you press a button. Xbox names, PlayStation in brackets. Buttons can be rebound in Settings → Controls → Gamepad.

| Button | Action |
| --- | --- |
| Left stick | Steer |
| Right stick | Look around; click [R3] switches view |
| Left stick click [L3] | Zoom (hold) |
| RT [R2] | Throttle up; hold at 100% for WEP |
| LT [L2] | Throttle down; at idle it's the airbrake |
| LB / RB [L1 / R1] | Rudder left / right |
| A [Cross] (hold) | Guns |
| B [Circle] | Secondary weapon |
| X [Square] | Switch secondary weapon |
| Y [Triangle] | Select target |
| D-pad down | Flares and chaff |
| D-pad up | Radar lock / unlock |
| D-pad left | Radar mode |
| D-pad right | Radar range |
| View [Touchpad] (hold) | Scoreboard |
| Menu [Options] | Menu |

### Reading the HUD

**Propeller planes (WW1 to Late WW2)** have an amber reflector gunsight ring on the nose and a small card of gauges: airspeed, altitude (the needle goes round once per 1,000 ft), throttle with the WEP band and engine heat, and rounds left.

**Early jets** have a gyro gunsight (a ring of diamonds around a pipper) and the same gauges.

**Cold War and Modern jets** have the full green HUD:

- **Speed tape** on the left (knots, or km/h) and **altitude tape** on the right (feet, or metres), each with the current value boxed.
- **Heading tape** at the bottom (N, 03, 06…), heading boxed.
- **Pitch ladder:** solid rungs above the horizon, dashed below, every 5°.
- **Flight-path marker** (circle with wings): where the plane is actually going. The small circle is the nose, the big circle is your aim.
- Bottom left: **M** Mach number, **G** load factor and **MAX** this life (red near the plane's limit), **AOA** angle of attack, **THR** throttle, or **AB / WEP 42 s** (seconds of afterburner left before the engine overheats), **ENG HOT** while it cools. **BRK** airbrake, **FLP** flaps.
- Bottom right: missiles (**MSL 4/6** and the picked type), **GUN** rounds, **FLR** flares, **R 310 FT** radar altitude below 1,500 ft.
- Red **PULL UP / TERRAIN** when you'd hit the ground in under 4 s.

Settings → Units switches between knots and feet (default) and km/h and metres.

**The panel (bottom right):** the radar scope (jets with radar), the **RWR** (radar warning: yellow squares are radars looking at you, orange a radar lock, flashing red a missile on its way), and bars for **THR** throttle, **HEAT** engine heat and **HULL** health. Hold W (or the slider's top band) at 100% for WEP; when HEAT reaches the top the engine overheats and gives about half power for 10 s.

### Radar step by step

1. Fly a jet that has a radar (most Cold War and all Modern jets, and the F-8 Crusader). The scope is the cone at the bottom right: you are the triangle at the bottom point; the rings mark quarters of the range shown top right.
2. **Search** (default, "SRCH"): the sweep line goes back and forth and paints contacts as it passes them; enemies are red squares, friends blue. Press **3** (d-pad right) to change the range: 5, 10 or 20 km.
3. Select a target (T, middle mouse, Y, or tap it on the screen or on the scope), then press **R** (d-pad up, or tap RDR) to **lock** it. With nothing selected, R locks the contact nearest the nose. The scope says "LOCK", circles the target, and shows its range, altitude and closing speed (VC). The enemy's warning tells them they're locked.
4. Fire a **radar missile** (Space) once the lock box on screen goes solid. **Semi-active** missiles (AIM-7, R-27R) only guide while your lock holds: keep the target inside your radar cone until the hit. **Active** missiles (AIM-120, R-77, MICA) can be fired and forgotten once they're close enough to see the target themselves.
5. **Dogfight mode** (press **2**, long-press RDR): the radar locks by itself on the first enemy inside a narrow cone straight ahead, up to 10 km. Point your nose at an enemy and it locks.
6. Locks break when the target leaves the cone or the range, dives into ground clutter (below 300 m the radar sees half as far), or **notches** (flies at right angles to your radar). Press R again to unlock; **1** turns the radar off (quiet: enemies' warners don't see a lock).

### Missiles: firing and dodging

| Missile type | Examples | How it locks | Range | How to beat it |
| --- | --- | --- | --- | --- |
| Rear-aspect heat seeker (IR) | AIM-9B, K-13, R.550 | From behind only, 2 s | 2.5 km | Flares, throttle back, turn into it, fly toward the sun, outrun it |
| All-aspect heat seeker | AIM-9L, R-60, Magic 2 | Any angle, 1.5 s | 3.5 km | Flares (with the throttle back), a hard turn as it closes |
| High off-boresight heat seeker | R-73, AIM-9X, MICA IR | Up to 75° off the nose, 1 s | 4 km | Flares are weaker; break hard late in its flight |
| Semi-active radar | AIM-7, R-27R | Needs the shooter's radar lock to the end | 6 km | Chaff, notch (fly 90° to it), break the shooter's lock, dive into clutter |
| Active radar | AIM-120, R-77, MICA | Fire and forget near the end | 8 km | Chaff, notch, outrun it before its motor burns out |

- **Firing:** hold the enemy in front of you until the lock ring fills and the box turns solid red (dashed = out of range), then press Space. Missiles fly further when you launch fast and from above.
- **Dodging:** when **MISSILE** flashes, the text says which counter to use. X drops a flare and a chaff bundle every 0.3 s; each one gets one chance to pull each missile away, and the first works best. Heat seekers see your engine: afterburner makes flares 40% less convincing, so cut the throttle. Radar missiles lose you if you fly side-on to them (keep the missile on your wing tip) and drop chaff. Late in its flight a missile is slow and can be out-turned.
<!-- how-to-play:end -->

## Playing with friends

1. Title → **Host / Join** → pick a callsign → **Host**.
2. Share the link (or let friends scan the QR code). They open it, pick a callsign and they're in.
3. Everyone votes on the era, map and mode; teams are balanced by Battle Rating; pick a plane; fly. After the results you're back in the lobby for the next round.

Hosting tips:

- Host from a **laptop on Wi-Fi or Ethernet, plugged in, with sleep off and the game tab in front**. The host's browser runs the whole match and uploads about 10 KB/s per player.
- A phone can host, but locking it or switching apps ends the match for everyone. Phones that *join* are fine: if one locks, it rejoins the room by itself when it comes back.
- Phones on mobile data may fail to connect: there's no TURN relay configured yet (STUN only). Wi-Fi works.

The full game-night checklist is in [docs/GAME_NIGHT.md](docs/GAME_NIGHT.md).

## Modes, eras and unlocks

- **Modes:** Team Deathmatch (first to 50 kills), Air Domination (hold three zones by flying low inside them), Ground Strike (destroy the other team's convoys, bunkers, AA and ships), Bomber Escort (escort AI bombers to the enemy base, or shoot them down).
- **Maps:** Island Chain, Mountain Valley (an alpine valley with a canyon: pine forests, rock faces, snowy peaks), Desert Mesas, Carrier Strike (open ocean with carriers). The land maps are eroded heightmaps baked at build time.
- **Eras:** WW1, Early WW2, Late WW2, Early Jets, Cold War, Modern; ten planes each, tier 1 to 10.
- **Research points (RP):** every match earns RP for kills (more for shooting down a better plane), assists, damage, captures and ground targets, surviving and winning. Spend them in **Research** to unlock the next tier of any era: tier 2 costs 400 RP, tier 10 costs 2,000. Tier 1 of every era is free. Your progress lives on a guest account; Settings → **Link Google account** carries it to your other devices.
- **Spawn points (SP):** better planes cost more to respawn in during a match. The era's tier-1 plane is always free.

## Settings

Graphics (auto / low / medium / high: Low is for phones, Medium adds textured terrain, 3D trees near you, bloom and sky lighting, High adds detail normals, reflective water, shadows and denser forests), a **30 fps cap** to save battery, aim sensitivity, **mouse aim or mouse joystick**, **units** (knots and feet, or km/h and metres), **invert pitch**, touch aim assist, touch **rudder buttons** and **tilt steering**, **HUD size**, **colour-blind team colours** (blue and orange), volume per sound group. Every warning sound (missile lock, launch, stall) also shows on screen.

If something breaks, the game shows a card with **Copy error**: paste that into a message to whoever runs the game.

## Running it yourself

```bash
npm install
npm run dev          # http://localhost:5173/red-vs-blue-skies/ (also on your LAN for phones)
npm test             # unit tests
npx playwright test  # browser tests (desktop, iPhone, perf, multiplayer)
npm run balance      # the bot tournament (docs/BALANCE_REPORT.md)
```

Pushing to `main` deploys to GitHub Pages. Everything else (commands, architecture, conventions) is in [CLAUDE.md](CLAUDE.md); the history is in [CHANGELOG.md](CHANGELOG.md) and [docs/PROGRESS.md](docs/PROGRESS.md).

## Credits

Built in 10 days with [Claude Code](https://claude.com/claude-code) by Arnab Singh.

- [Three.js](https://threejs.org/) (MIT), [PeerJS](https://peerjs.com/) (MIT), [Firebase JS SDK](https://firebase.google.com/) (Apache 2.0), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), [Vite](https://vite.dev/) (MIT).
- Fonts: Big Shoulders Display, Barlow Semi Condensed and Share Tech Mono (the HUD) (SIL Open Font License), self-hosted.
- Terrain textures and the sky light (HDRI) are from [Poly Haven](https://polyhaven.com), public domain (CC0): [leafy_grass](https://polyhaven.com/a/leafy_grass), [forest_ground_04](https://polyhaven.com/a/forest_ground_04), [lichen_rock](https://polyhaven.com/a/lichen_rock), [snow_field_aerial](https://polyhaven.com/a/snow_field_aerial), [coast_sand_01](https://polyhaven.com/a/coast_sand_01) and [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) (list in `public/textures/CREDITS.txt`).
- Every plane, ground unit, map, tree, sound and icon is generated by the game's own code and Blender scripts. No assets from other games.
