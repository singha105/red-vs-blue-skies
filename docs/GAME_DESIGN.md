# Red vs Blue Skies: Game Design

Six eras, ten planes each (60 total), red vs blue, up to 20 players with bots filling empty slots. This file is the design reference for gameplay code. Numbers live in `src/data/*.json`; when this file and the data disagree, fix whichever is wrong and note it in `docs/PROGRESS.md`.

## Core rules

- **Teams:** red vs blue. Any plane can fly for either team; planes wear red or blue team paint and a team roundel, never national insignia.
- **Players:** up to 20 per match. Bots fill empty slots so there is always a full 10 vs 10.
- **Flight:** arcade with energy. Tight turns bleed speed, dives build it, slow planes stall.
- **Controls:** point where you want to fly (mouse, touch drag, or right stick all steer one aim point). Light aim assist for touch players only, with an off switch.
- **Anti-frustration:** 3 s spawn protection, out-of-bounds warning, killcam, an auto-level button for phones.
- **Match length:** 10 minutes, then a results screen with RP earned, unlocks and awards.

## Eras

Data: `src/data/eras.json`.

| Era | id | Years | Weapons | Missiles |
| --- | --- | --- | --- | --- |
| WW1 | `ww1` | 1914–1918 | 1–2 machine guns | None |
| Early WW2 | `early_ww2` | 1930–1941 | Machine guns, some 20 mm cannons | None |
| Late WW2 | `late_ww2` | 1942–1945 | Heavy MGs, 20–30 mm cannons, unguided rockets | None |
| Early Jets | `early_jets` | 1946–1958 | Cannons | Tiers 9–10 only: rear-aspect IR |
| Cold War | `cold_war` | 1959–1984 | Cannons | IR (rear and all-aspect) and semi-active radar |
| Modern | `modern` | 1985–2010 | Cannons | All-aspect IR, high off-boresight IR, semi-active and active radar |

Modern also allows semi-active radar because the MiG-29A and Su-27S historically carried the R-27R.

## Plane roster

Tier 1 = weakest, tier 10 = best. Data: `src/data/planes.json`.

| Tier | WW1 | Early WW2 | Late WW2 | Early Jets | Cold War | Modern |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Fokker E.III | Boeing P-26 | P-40E Warhawk | P-80 Shooting Star | MiG-21F-13 | MiG-29A |
| 2 | Airco DH.2 | Gloster Gladiator | P-39 Airacobra | DH Vampire | F-104G Starfighter | Mirage 2000-5 |
| 3 | Nieuport 11 | Fiat CR.42 | F6F Hellcat | Gloster Meteor F.8 | Mirage IIIE | F/A-18C Hornet |
| 4 | Sopwith Pup | Polikarpov I-16 | Fw 190 A-8 | F-84G Thunderjet | F-5E Tiger II | F-16C Block 50 |
| 5 | Albatros D.III | Curtiss P-36 Hawk | P-47D Thunderbolt | MiG-15bis | F-4E Phantom II | JAS 39C Gripen |
| 6 | Fokker Dr.I | Hurricane Mk I | F4U-4 Corsair | F-86F Sabre | MiG-23MLD | Su-27S |
| 7 | Sopwith Camel | A6M2 Zero | Yak-3 | MiG-17 | Mirage F1C | F-15C Eagle |
| 8 | S.E.5a | Bf 109 E-4 | P-51D Mustang | Hawker Hunter F.6 | F-14A Tomcat | Eurofighter Typhoon |
| 9 | SPAD S.XIII | Spitfire Mk V | Me 262 A-1 | F-8 Crusader | F-16A | Rafale C |
| 10 | Fokker D.VII | Bf 109 F-4 | Spitfire Mk XIV | MiG-19 | F-15A Eagle | F-22A Raptor |

The order is a starting point for balance, not a historical ranking. A plane may be swapped if a better fit for the tier exists. Day 10's bot tournament swapped three pairs (Spitfire Mk XIV ↔ Me 262, MiG-19 ↔ F-8, Rafale C ↔ Typhoon) and tuned HP and turn rates so each tier beats the one below it about 60–70% of the time one on one; see `docs/BALANCE_REPORT.md`.

**Data policy:** use real figures where they are easy to find (a spec sheet or Wikipedia infobox), and sensible guesses for everything else (ammo counts, exact variant figures, loadouts). Don't spend time on deep historical verification; this is an arcade game.

### Plane stats

| Field | Real or game value | Notes |
| --- | --- | --- |
| `stats.topSpeedKmh` | Real | From the plane's spec sheet (usually at best altitude) |
| `guns` | Real, guessed where unknown | Gun type and count are real; rounds per gun are real where easy to find, otherwise a sensible guess |
| `missiles` | Plausible | Historically plausible loadout, 2–6 missiles total |
| `stats.turnRateDegS`, `climbMs`, `rollRateDegS`, `hp` | Game | Balance values; Day 10's bot tournament tunes them |
| `countermeasures` | Game | Flares and chaff per life |
| `br` | Derived | Battle Rating = 1.0 + 0.3 × (tier − 1): tier 1 is 1.0, tier 10 is 3.7 |
| `verify` | Flag | `true` only for a value that is a placeholder and clearly needs a better guess; normally `false` |
| `radarSignature` | Game | Optional; the F-22A has 0.5 (enemies radar-lock it at half range) |

Gun-type ids (`mg_303`, `cannon_20mm`, …) are listed in `src/data/types.ts`. Day 3 adds `guns.json` with rate of fire, muzzle velocity, damage and tracer colour for each.

## Missiles and countermeasures

Ranges are game values scaled to the map, not real-world figures. Data: `src/data/missiles.json` (classes plus named variants).

| Class | id | Real examples | How it locks | Game range | Beaten by |
| --- | --- | --- | --- | --- | --- |
| Rear-aspect IR | `ir_rear` | AIM-9B, K-13, R.550 Magic | Only from behind the target, 20° cone, 2 s to lock | 2.5 km | Flares (60% for the first), flying toward the sun, turning to face it, outrunning it |
| All-aspect IR | `ir_all_aspect` | AIM-9L, R-60, Magic 2 | Any angle, 30° cone, 1.5 s | 3.5 km | Flares (40–45% for the first) |
| High off-boresight IR | `ir_hobs` | R-73, AIM-9X, MICA IR | Up to 75° off the nose, 1 s | 4 km | Flares (22–28% for the first), hard turns late in its flight |
| Semi-active radar | `radar_semi_active` | AIM-7, R-27R | Your radar must stay locked until impact | 6 km | Chaff, notching (fly 90° to the missile), breaking the shooter's lock |
| Active radar | `radar_active` | AIM-120, R-77, MICA | Fire and forget | 8 km | Chaff, notching, outrunning it |

In the data, `flareResistance` is the chance one flare fails, so a 60% flare success is a resistance of 0.4. `damage` is the percent of the target's max HP a hit removes.

How the simulation plays it (Day 7, `src/game/missiles.ts`):

- **One Flare button** (F, the touch Flare button, gamepad X) drops a flare and a chaff bundle together every 0.3 s while held; phones have no room for two buttons. Each decoy gets one roll per missile guiding on you. The first decoy a missile sees succeeds with 1 − resistance; each further decoy of the same kind is 0.6× as convincing. Flares work 0.6× as well in afterburner (cut the throttle), chaff 1.5× as well while you're notching.
- **IR seekers** see engine heat: lock range scales with throttle, ×1.4 in afterburner. Rear-aspect seekers lock only within 45° of the target's tail (a missile already in flight keeps the exhaust until the target shows its beam, 90°). Head-on, all-aspect seekers see about 60% as far. The sun within 10° of the line of sight blinds them.
- **Radar** locks need the target in a 60° cone ahead and are halved below 300 m (ground clutter). A target whose speed along the line of sight is under 45 m/s is in the notch (the window is 1.6× wider below 300 m and half as wide for an active seeker inside its last 1.5 km). Radar missiles remember the track for 1.2 s, so a notch has to be held, not flicked through. Semi-active missiles also need the shooter's lock to the end.
- **Guidance** is proportional navigation (N = 4). The G a missile can pull falls with the square of its speed, and after the motor burns out drag slows it, so late in flight it can be out-turned or outrun. The motor adds to the launcher's speed (40% of it), so a fast launch reaches further.
- **Target selection**: R on desktop, a quick tap on an enemy on touch, RB on a gamepad; otherwise the weapons computer picks the enemy nearest the nose and the mount whose missile suits the range.

Fairness rules:

- 2–6 missiles per plane, no reloads until respawn.
- A warning tone when locked and a louder one at launch.
- A missile hit does 70–100% damage depending on plane HP, so guns still matter.
- Every missile must have a counter a skilled player can use. If one proves nearly unbeatable, nerf it in data.

## Research points (RP) and unlocks

Points are permanent and can be spent in any era's tree, unlocking tiers in order. Tier 1 of every era is free.

| Action | RP |
| --- | --- |
| Kill | 100 × underdog multiplier: ×3 if the target is 3+ tiers higher, ×2 at +2, ×1 within ±1, ×0.5 at −2, ×0.25 at −3 or lower |
| Assist (25%+ of the target's damage) | 40 |
| Damage dealt | 1 per 1% of a plane's HP |
| Capture a zone / destroy a ground target | 50 / 30 |
| Survive to the end | 30 |
| Team win | +25% of your match total |
| Top scorer (MVP) | +20% of your match total |
| Played a full match | Minimum 50 |

Unlocking tier N costs 200 × N RP (tier 2 = 400, tier 10 = 2,000; a full era is about 10,800). A typical match with 3 kills earns about 600–700 RP, so a full era takes roughly 15 matches, faster for top players.

As built (Day 8): RP and unlocks live in your Firebase profile (anonymous account, optionally linked to Google). Solo matches earn RP too. One match is worth at most 3,000 RP (a server rule; the client caps it the same way). Team balancing and the leaderboard's "Top RP" use everything you've earned (balance + spent), so buying planes doesn't make you look like a beginner. A new player flies tier 1 of every era.

Worked example: a tier-3 player gets 2 kills on tier-5 planes (100 × 2 × 2 = 400), 1 kill on a tier-3 (100), 1 assist (40), 260% damage (260) and survives (30). Subtotal 830. Team wins: +25% = 207.5. Total 1,037.5, rounded to 1,038.

### Spawn points (SP)

Your first spawn is free with any unlocked plane. Later spawns cost 100 + 50 × tier SP. You earn SP in the match: 100 per kill, 40 per assist, 50 per capture. The era's tier-1 plane is a free reserve: if you can't afford your pick, you respawn in it, so nobody is stuck on the ground (added Day 6). Bots don't use SP; they fly whatever the team balancer gives them.

### Team balance

Teams are auto-balanced by total Battle Rating, not just headcount. Humans fly what they want; bots pick planes that bring both team totals within 10%.

## Modes

Data: `src/data/modes.json` (rules' numbers) and `src/data/objectives.json` (ground units, AA, bomber gunners, rockets and bombs, AI bombers). Rules code: `src/game/objectives.ts`. Every mode is playable since Day 9 (the `playable` flag still hides a mode from the vote if set to false).

- **Team Deathmatch** (`tdm`, default): first team to 50 kills, or most kills after 10 minutes.
- **Air Domination** (`air_domination`): 3 zones (the map's `zones`), 700 m radius. A plane inside a zone less than 300 m above the ground captures it: one plane takes 10 s from neutral, up to three count, equal numbers hold it where it is. Each team starts with 300 tickets; every held zone drains 0.5 tickets/s from the other team and every plane lost costs 2. A team at 0 loses; otherwise most tickets after 10 minutes. A capture is 50 RP and 50 SP for each plane that took it.
- **Ground Strike** (`ground_strike`): each team has 300 tickets and its own half of the map's ground targets: two convoys (three trucks and a tank driving back and forth on a road), three bunkers, an AA gun beside each bunker, and destroyers offshore where there's open water (Carrier Strike: a carrier and three destroyers). Destroying a target costs its team tickets (truck 12, tank 15, AA 10, bunker 30, destroyer 40, carrier 150) and pays 30 RP and 30 SP; a plane lost costs 2. Losing every target also ends it. AA sites, ships and carriers shoot back (weak, bursty, imperfect lead). The P-47D, F4U-4 and Fw 190 A-8 carry rockets and bombs on the missile button. Unit HP scales per era (`eraHpScale`) so WW1 guns can kill a truck and jets don't erase a carrier.
- **Bomber Escort** (`bomber_escort`): one team (picked at random) flies waves of four AI bombers (a WW1 biplane bomber, a WW2 four-engine bomber or a swept jet bomber by era) from its side to the other team's depot (Carrier Strike: its carrier), about 150 s inbound, then home; the next wave takes off 15 s after the last one is gone. A bomber over the target scores 10 points for the escorts, a bomber shot down 10 for the interceptors, and every plane kill 1. Bombers have defensive gunners (nose, top, tail) and take a capped bite from missiles (a missile removes its % of 400–450 HP, not of the bomber's HP). Most points after 10 minutes wins.

## Maps

About 16 × 16 km each, generated from a seed so they cost nothing to store. Data: `src/data/maps.json` (seed, size, colours, spawn points, zone positions). Ground target layouts are generated from the seed and heightmap (`src/game/groundLayout.ts`) and sent by the host in the match start message.

- **Island Chain** (`island_chain`, default): open ocean and green islands.
- **Mountain Valley** (`mountain_valley`): ridged mountains up to ~1,250 m with one winding canyon carved through them west to east, 550 m wide at the floor, with a river; the three zones sit on the canyon floor, so capturing means flying the canyon.
- **Desert Mesas** (`desert_mesas`): terraced noise: flat-topped plateaus in steps of 115 m above a desert floor at ~45 m, great visibility.
- **Carrier Strike** (`carrier_strike`): open ocean with one aircraft carrier per team (steaming in a wide circle behind its side, with three destroyers); the carriers are the ground targets in Ground Strike and Bomber Escort, scenery in the other modes.

## Lobby flow

Join by link → pick a callsign → 20-second vote on era, map and mode (ties broken randomly; the host can override) → teams auto-balanced by BR → pick a plane → fly. A match lasts 10 minutes, then the results screen shows RP earned, unlocks and awards.

As built (Day 6): Title → callsign → Host / Join → lobby (ready toggle, parties of up to 3, chat; the host sets bot difficulty, bots on/off, match length 5/10/15 min, and can remove players) → vote (20 s, ends early when everyone has voted) → teams (5 s: humans split by headcount then RP, parties together) → plane select (25 s, ends when everyone locks in) → match → results (awards: MVP top score, Ace 5+ kills in one life, Wingman most assists, Survivor fewest deaths) → Play again returns everyone to the lobby on the same connection, or the lobby comes back by itself after 60 s.

## Networking model (summary)

One player's browser hosts each match and runs the real simulation. Clients send controls and receive world snapshots. The host decides every hit. Own plane uses client prediction; other planes are drawn about 100 ms in the past with interpolation. Join by a 4-letter room code link (`?room=XQ7K`). If the host quits, the match ends and everyone keeps the points earned so far. Full details are in the Day 5 section of `docs/BUILD_PLAN.md`.
