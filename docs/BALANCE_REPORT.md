# Balance report (Day 10)

Every adjacent tier pair in every era, flown as 1v1 bot duels with the screen off (`npm run balance`). **Done-when: the higher tier wins 55–80% of the decided duels in every pair. After tuning, all 54 pairs are between 56.3% and 74.2%.**

## How the tournament works

- `tests/balance/tournament.ts`: two *normal* bots (fighter role) start 1.5–2.5 km apart at 1,800–2,200 m over open ocean (Carrier Strike map, no terrain to crash into), each on a random heading, at 75% of top speed. They fight with the real game code (flight model, guns, missiles, flares, chaff, damage) until one goes down. After 3 minutes the one that took the larger share of the other's HP wins on points; no damage either way is a draw (left out of the rate).
- 200 duels per pair: 100 starting positions, each flown twice with the planes swapped, so neither plane gets the better start more often.
- Rate = higher tier's wins ÷ decided duels. With ~195 decided duels a single run has about ±3.5% noise (one standard error).
- `npm run balance` runs all six eras in parallel (one Vitest process each, ~40 s on this Mac). `npm run balance -- before` replays the planes.json in git HEAD; `npm run balance -- tune` runs the tuner.

## What changed

1. **Bot fix (stalemates).** The first run (Day 9 data and bots) had up to 180 draws in 200 Cold War duels: two jets would settle into a slow climbing circle 300–450 m apart and never get a shot, so speed and climb never mattered. Bots now break off after 12 s circling the same target without a shot (only when the target is close and neither fleeing nor pointing at them), unload at full throttle for 10 s, and come back with speed. After tuning, the jet eras have 0–18 draws per 200. The fix applies in real matches too.
2. **Three tier swaps** (GAME_DESIGN allows it: the order is a starting point, not a ranking). The lower plane won every tuning round even at twice its partner's HP: the Spitfire Mk XIV beat the Me 262 (the 262's slow 30 mm shells miss and its 9 s of ammo runs out), the MiG-19S beat the F-8, the Rafale's MICAs beat the Typhoon's AIM-120/AIM-9X. Now Spitfire XIV is Late WW2 tier 10 (Me 262 tier 9), MiG-19S is Early Jets tier 10 (F-8 tier 9), Rafale C is Modern tier 9 (Typhoon tier 8). BR follows the tier.
3. **Stat tuning** (`tests/balance/tune.test.ts`): rounds of the tournament, each moving every plane's **HP** and, at half the strength, its **turn rate** (log scale) so each pair heads for ~65%, then re-centring each era. Real figures (top speed, guns, ammo, missiles) were not touched. Five passes, ending with 400 duels per pair per round.
4. **Checked on a seed the tuner never saw.** The first check (seed 777) still had four pairs at 49.5–53% (the tuner had picked lucky rounds measured with 120–200 duels), so the last pass used 400 duels and aimed at 66%. The final check (seed 4242, 200 duels per pair) is the "after" column.

## Win rates, higher tier (before → after)

"Before" = Day 9 planes.json, same harness and bots (`npm run balance -- before`). Pairs are by tier slot; the three swapped pairs list the planes as they are now.


### WW1

| Tiers | Before | Rate | After | Rate | W–L (draws) |
| --- | --- | ---: | --- | ---: | --- |
| 1→2 | Fokker E.III vs Airco DH.2 | 48.0% | Fokker E.III vs Airco DH.2 | **64.6%** | 128–70 (2) |
| 2→3 | Airco DH.2 vs Nieuport 11 Bébé | 44.7% | Airco DH.2 vs Nieuport 11 Bébé | **64.8%** | 129–70 (1) |
| 3→4 | Nieuport 11 Bébé vs Sopwith Pup | 52.3% | Nieuport 11 Bébé vs Sopwith Pup | **63.3%** | 126–73 (1) |
| 4→5 | Sopwith Pup vs Albatros D.III | 93.0% | Sopwith Pup vs Albatros D.III | **61.5%** | 123–77 (0) |
| 5→6 | Albatros D.III vs Fokker Dr.I | 55.3% | Albatros D.III vs Fokker Dr.I | **62.8%** | 125–74 (1) |
| 6→7 | Fokker Dr.I vs Sopwith Camel F.1 | 43.5% | Fokker Dr.I vs Sopwith Camel F.1 | **61.3%** | 122–77 (1) |
| 7→8 | Sopwith Camel F.1 vs Royal Aircraft Factory S.E.5a | 59.2% | Sopwith Camel F.1 vs Royal Aircraft Factory S.E.5a | **67.9%** | 133–63 (4) |
| 8→9 | Royal Aircraft Factory S.E.5a vs SPAD S.XIII | 50.0% | Royal Aircraft Factory S.E.5a vs SPAD S.XIII | **61.1%** | 121–77 (2) |
| 9→10 | SPAD S.XIII vs Fokker D.VII | 33.5% | SPAD S.XIII vs Fokker D.VII | **68.3%** | 136–63 (1) |

### Early WW2

| Tiers | Before | Rate | After | Rate | W–L (draws) |
| --- | --- | ---: | --- | ---: | --- |
| 1→2 | Boeing P-26 Peashooter vs Gloster Gladiator Mk I | 57.9% | Boeing P-26 Peashooter vs Gloster Gladiator Mk I | **71.1%** | 140–57 (3) |
| 2→3 | Gloster Gladiator Mk I vs Fiat CR.42 Falco | 64.8% | Gloster Gladiator Mk I vs Fiat CR.42 Falco | **60.6%** | 120–78 (2) |
| 3→4 | Fiat CR.42 Falco vs Polikarpov I-16 Type 24 | 64.8% | Fiat CR.42 Falco vs Polikarpov I-16 Type 24 | **69.5%** | 137–60 (3) |
| 4→5 | Polikarpov I-16 Type 24 vs Curtiss P-36A Hawk | 16.2% | Polikarpov I-16 Type 24 vs Curtiss P-36A Hawk | **68.5%** | 137–63 (0) |
| 5→6 | Curtiss P-36A Hawk vs Hawker Hurricane Mk I | 71.9% | Curtiss P-36A Hawk vs Hawker Hurricane Mk I | **61.3%** | 122–77 (1) |
| 6→7 | Hawker Hurricane Mk I vs Mitsubishi A6M2 Zero | 70.2% | Hawker Hurricane Mk I vs Mitsubishi A6M2 Zero | **61.8%** | 123–76 (1) |
| 7→8 | Mitsubishi A6M2 Zero vs Messerschmitt Bf 109 E-4 | 53.0% | Mitsubishi A6M2 Zero vs Messerschmitt Bf 109 E-4 | **63.1%** | 125–73 (2) |
| 8→9 | Messerschmitt Bf 109 E-4 vs Supermarine Spitfire Mk V | 48.7% | Messerschmitt Bf 109 E-4 vs Supermarine Spitfire Mk V | **63.1%** | 125–73 (2) |
| 9→10 | Supermarine Spitfire Mk V vs Messerschmitt Bf 109 F-4 | 45.3% | Supermarine Spitfire Mk V vs Messerschmitt Bf 109 F-4 | **62.5%** | 125–75 (0) |

### Late WW2

| Tiers | Before | Rate | After | Rate | W–L (draws) |
| --- | --- | ---: | --- | ---: | --- |
| 1→2 | Curtiss P-40E Warhawk vs Bell P-39Q Airacobra | 44.0% | Curtiss P-40E Warhawk vs Bell P-39Q Airacobra | **71.9%** | 141–55 (4) |
| 2→3 | Bell P-39Q Airacobra vs Grumman F6F-5 Hellcat | 46.0% | Bell P-39Q Airacobra vs Grumman F6F-5 Hellcat | **68.5%** | 135–62 (3) |
| 3→4 | Grumman F6F-5 Hellcat vs Focke-Wulf Fw 190 A-8 | 45.7% | Grumman F6F-5 Hellcat vs Focke-Wulf Fw 190 A-8 | **74.2%** | 147–51 (2) |
| 4→5 | Focke-Wulf Fw 190 A-8 vs Republic P-47D Thunderbolt | 30.1% | Focke-Wulf Fw 190 A-8 vs Republic P-47D Thunderbolt | **71.1%** | 140–57 (3) |
| 5→6 | Republic P-47D Thunderbolt vs Vought F4U-4 Corsair | 66.5% | Republic P-47D Thunderbolt vs Vought F4U-4 Corsair | **58.3%** | 116–83 (1) |
| 6→7 | Vought F4U-4 Corsair vs Yakovlev Yak-3 | 70.6% | Vought F4U-4 Corsair vs Yakovlev Yak-3 | **66.8%** | 131–65 (4) |
| 7→8 | Yakovlev Yak-3 vs North American P-51D Mustang | 31.6% | Yakovlev Yak-3 vs North American P-51D Mustang | **65.7%** | 130–68 (2) |
| 8→9 | North American P-51D Mustang vs Supermarine Spitfire Mk XIV | 50.8% | North American P-51D Mustang vs Messerschmitt Me 262 A-1a | **61.9%** | 122–75 (3) |
| 9→10 | Supermarine Spitfire Mk XIV vs Messerschmitt Me 262 A-1a | 24.6% | Messerschmitt Me 262 A-1a vs Supermarine Spitfire Mk XIV | **58.0%** | 116–84 (0) |

### Early Jets

| Tiers | Before | Rate | After | Rate | W–L (draws) |
| --- | --- | ---: | --- | ---: | --- |
| 1→2 | Lockheed P-80 Shooting Star vs de Havilland Vampire FB.5 | 71.7% | Lockheed P-80 Shooting Star vs de Havilland Vampire FB.5 | **65.6%** | 124–65 (11) |
| 2→3 | de Havilland Vampire FB.5 vs Gloster Meteor F.8 | 37.0% | de Havilland Vampire FB.5 vs Gloster Meteor F.8 | **67.9%** | 129–61 (10) |
| 3→4 | Gloster Meteor F.8 vs Republic F-84G Thunderjet | 31.8% | Gloster Meteor F.8 vs Republic F-84G Thunderjet | **65.1%** | 121–65 (14) |
| 4→5 | Republic F-84G Thunderjet vs Mikoyan-Gurevich MiG-15bis | 63.3% | Republic F-84G Thunderjet vs Mikoyan-Gurevich MiG-15bis | **63.7%** | 121–69 (10) |
| 5→6 | Mikoyan-Gurevich MiG-15bis vs North American F-86F Sabre | 37.2% | Mikoyan-Gurevich MiG-15bis vs North American F-86F Sabre | **64.9%** | 126–68 (6) |
| 6→7 | North American F-86F Sabre vs Mikoyan-Gurevich MiG-17F | 70.0% | North American F-86F Sabre vs Mikoyan-Gurevich MiG-17F | **63.4%** | 123–71 (6) |
| 7→8 | Mikoyan-Gurevich MiG-17F vs Hawker Hunter F.6 | 56.5% | Mikoyan-Gurevich MiG-17F vs Hawker Hunter F.6 | **68.4%** | 132–61 (7) |
| 8→9 | Hawker Hunter F.6 vs Mikoyan-Gurevich MiG-19S | 40.0% | Hawker Hunter F.6 vs Vought F-8 Crusader | **61.7%** | 116–72 (12) |
| 9→10 | Mikoyan-Gurevich MiG-19S vs Vought F-8 Crusader | 32.6% | Vought F-8 Crusader vs Mikoyan-Gurevich MiG-19S | **63.5%** | 125–72 (3) |

### Cold War

| Tiers | Before | Rate | After | Rate | W–L (draws) |
| --- | --- | ---: | --- | ---: | --- |
| 1→2 | Mikoyan-Gurevich MiG-21F-13 vs Lockheed F-104G Starfighter | 16.7% | Mikoyan-Gurevich MiG-21F-13 vs Lockheed F-104G Starfighter | **64.5%** | 120–66 (14) |
| 2→3 | Lockheed F-104G Starfighter vs Dassault Mirage IIIE | 85.5% | Lockheed F-104G Starfighter vs Dassault Mirage IIIE | **57.9%** | 110–80 (10) |
| 3→4 | Dassault Mirage IIIE vs Northrop F-5E Tiger II | 86.1% | Dassault Mirage IIIE vs Northrop F-5E Tiger II | **64.1%** | 118–66 (16) |
| 4→5 | Northrop F-5E Tiger II vs McDonnell Douglas F-4E Phantom II | 22.1% | Northrop F-5E Tiger II vs McDonnell Douglas F-4E Phantom II | **67.2%** | 125–61 (14) |
| 5→6 | McDonnell Douglas F-4E Phantom II vs Mikoyan-Gurevich MiG-23MLD | 69.1% | McDonnell Douglas F-4E Phantom II vs Mikoyan-Gurevich MiG-23MLD | **60.0%** | 117–78 (5) |
| 6→7 | Mikoyan-Gurevich MiG-23MLD vs Dassault Mirage F1C | 60.3% | Mikoyan-Gurevich MiG-23MLD vs Dassault Mirage F1C | **62.5%** | 120–72 (8) |
| 7→8 | Dassault Mirage F1C vs Grumman F-14A Tomcat | 54.6% | Dassault Mirage F1C vs Grumman F-14A Tomcat | **62.1%** | 121–74 (5) |
| 8→9 | Grumman F-14A Tomcat vs General Dynamics F-16A Fighting Falcon | 76.3% | Grumman F-14A Tomcat vs General Dynamics F-16A Fighting Falcon | **65.7%** | 130–68 (2) |
| 9→10 | General Dynamics F-16A Fighting Falcon vs McDonnell Douglas F-15A Eagle | 26.0% | General Dynamics F-16A Fighting Falcon vs McDonnell Douglas F-15A Eagle | **65.0%** | 128–69 (3) |

### Modern

| Tiers | Before | Rate | After | Rate | W–L (draws) |
| --- | --- | ---: | --- | ---: | --- |
| 1→2 | Mikoyan MiG-29A vs Dassault Mirage 2000-5 | 67.0% | Mikoyan MiG-29A vs Dassault Mirage 2000-5 | **71.4%** | 135–54 (11) |
| 2→3 | Dassault Mirage 2000-5 vs McDonnell Douglas F/A-18C Hornet | 56.1% | Dassault Mirage 2000-5 vs McDonnell Douglas F/A-18C Hornet | **64.4%** | 125–69 (6) |
| 3→4 | McDonnell Douglas F/A-18C Hornet vs General Dynamics F-16C Block 50 | 41.5% | McDonnell Douglas F/A-18C Hornet vs General Dynamics F-16C Block 50 | **65.7%** | 130–68 (2) |
| 4→5 | General Dynamics F-16C Block 50 vs Saab JAS 39C Gripen | 55.3% | General Dynamics F-16C Block 50 vs Saab JAS 39C Gripen | **69.2%** | 135–60 (5) |
| 5→6 | Saab JAS 39C Gripen vs Sukhoi Su-27S | 29.0% | Saab JAS 39C Gripen vs Sukhoi Su-27S | **65.8%** | 121–63 (16) |
| 6→7 | Sukhoi Su-27S vs McDonnell Douglas F-15C Eagle | 44.6% | Sukhoi Su-27S vs McDonnell Douglas F-15C Eagle | **59.0%** | 118–82 (0) |
| 7→8 | McDonnell Douglas F-15C Eagle vs Dassault Rafale C | 71.7% | McDonnell Douglas F-15C Eagle vs Eurofighter Typhoon | **67.0%** | 122–60 (18) |
| 8→9 | Dassault Rafale C vs Eurofighter Typhoon | 31.2% | Eurofighter Typhoon vs Dassault Rafale C | **68.4%** | 130–60 (10) |
| 9→10 | Eurofighter Typhoon vs Lockheed Martin F-22A Raptor | 55.0% | Dassault Rafale C vs Lockheed Martin F-22A Raptor | **56.3%** | 107–83 (10) |

Before: **33 of 54 pairs outside 55–80%** (several inverted: the I-16 beat the P-36 84% of the time, the F-5E beat the F-4E 78%). After: **0 of 54**.

## Stat changes (HP and turn rate only)

| Era | Tier | Plane | HP | Turn °/s |
| --- | ---: | --- | --- | --- |
| WW1 | 1 | Fokker E.III | 80 → 59 | 27 → 23.5 |
| WW1 | 2 | Airco DH.2 | 80 → 67 | 28 → 26 |
| WW1 | 3 | Nieuport 11 Bébé | 80 → 81 | 30 → 30 |
| WW1 | 4 | Sopwith Pup | 80 → 93 | 31 → 33.5 |
| WW1 | 5 | Albatros D.III | 80 → 56 | 30 → 25.5 |
| WW1 | 6 | Fokker Dr.I | 80 → 63 | 35 → 31 |
| WW1 | 7 | Sopwith Camel F.1 | 80 → 82 | 36 → 36.5 |
| WW1 | 8 | Royal Aircraft Factory S.E.5a | 90 → 101 | 31 → 33 |
| WW1 | 9 | SPAD S.XIII | 90 → 113 | 30 → 34 |
| WW1 | 10 | Fokker D.VII | 80 → 134 | 34 → 44 |
| Early WW2 | 1 | Boeing P-26 Peashooter | 100 → 53 | 22 → 15.5 |
| Early WW2 | 2 | Gloster Gladiator Mk I | 100 → 57 | 24 → 18 |
| Early WW2 | 3 | Fiat CR.42 Falco | 100 → 59 | 26 → 20.5 |
| Early WW2 | 4 | Polikarpov I-16 Type 24 | 100 → 73 | 25 → 21 |
| Early WW2 | 5 | Curtiss P-36A Hawk | 100 → 141 | 24 → 28.5 |
| Early WW2 | 6 | Hawker Hurricane Mk I | 110 → 132 | 25 → 27 |
| Early WW2 | 7 | Mitsubishi A6M2 Zero | 75 → 86 | 29 → 31 |
| Early WW2 | 8 | Messerschmitt Bf 109 E-4 | 100 → 130 | 26 → 29.5 |
| Early WW2 | 9 | Supermarine Spitfire Mk V | 100 → 157 | 26 → 32.5 |
| Early WW2 | 10 | Messerschmitt Bf 109 F-4 | 100 → 187 | 27 → 37.5 |
| Late WW2 | 1 | Curtiss P-40E Warhawk | 120 → 60 | 19 → 13.5 |
| Late WW2 | 2 | Bell P-39Q Airacobra | 110 → 63 | 19 → 14.5 |
| Late WW2 | 3 | Grumman F6F-5 Hellcat | 130 → 77 | 20 → 15.5 |
| Late WW2 | 4 | Focke-Wulf Fw 190 A-8 | 125 → 95 | 19 → 16.5 |
| Late WW2 | 5 | Republic P-47D Thunderbolt | 150 → 162 | 18 → 19 |
| Late WW2 | 6 | Vought F4U-4 Corsair | 125 → 124 | 22 → 22 |
| Late WW2 | 7 | Yakovlev Yak-3 | 100 → 87 | 25 → 23.5 |
| Late WW2 | 8 | North American P-51D Mustang | 110 → 167 | 23 → 28.5 |
| Late WW2 | 9 (was 10) | Messerschmitt Me 262 A-1a | 120 → 260 | 19 → 28 |
| Late WW2 | 10 (was 9) | Supermarine Spitfire Mk XIV | 110 → 249 | 24 → 36 |
| Early Jets | 1 | Lockheed P-80 Shooting Star | 110 → 65 | 15 → 11.5 |
| Early Jets | 2 | de Havilland Vampire FB.5 | 110 → 54 | 17 → 12 |
| Early Jets | 3 | Gloster Meteor F.8 | 125 → 83 | 16 → 13 |
| Early Jets | 4 | Republic F-84G Thunderjet | 125 → 116 | 15 → 14 |
| Early Jets | 5 | Mikoyan-Gurevich MiG-15bis | 110 → 87 | 17 → 15 |
| Early Jets | 6 | North American F-86F Sabre | 110 → 116 | 17 → 17 |
| Early Jets | 7 | Mikoyan-Gurevich MiG-17F | 110 → 98 | 19 → 18 |
| Early Jets | 8 | Hawker Hunter F.6 | 110 → 112 | 18 → 18.5 |
| Early Jets | 9 (was 10) | Vought F-8 Crusader | 110 → 300 | 19 → 31.5 |
| Early Jets | 10 (was 9) | Mikoyan-Gurevich MiG-19S | 110 → 261 | 19 → 29.5 |
| Cold War | 1 | Mikoyan-Gurevich MiG-21F-13 | 110 → 75 | 13 → 11 |
| Cold War | 2 | Lockheed F-104G Starfighter | 120 → 180 | 10 → 12 |
| Cold War | 3 | Dassault Mirage IIIE | 120 → 102 | 13 → 12 |
| Cold War | 4 | Northrop F-5E Tiger II | 110 → 53 | 16 → 11 |
| Cold War | 5 | McDonnell Douglas F-4E Phantom II | 140 → 181 | 12 → 14 |
| Cold War | 6 | Mikoyan-Gurevich MiG-23MLD | 120 → 151 | 13 → 15 |
| Cold War | 7 | Dassault Mirage F1C | 120 → 126 | 15 → 15 |
| Cold War | 8 | Grumman F-14A Tomcat | 140 → 173 | 15 → 16.5 |
| Cold War | 9 | General Dynamics F-16A Fighting Falcon | 120 → 87 | 18 → 15.5 |
| Cold War | 10 | McDonnell Douglas F-15A Eagle | 130 → 230 | 16 → 21.5 |
| Modern | 1 | Mikoyan MiG-29A | 120 → 77 | 18 → 14.5 |
| Modern | 2 | Dassault Mirage 2000-5 | 120 → 81 | 19 → 15.5 |
| Modern | 3 | McDonnell Douglas F/A-18C Hornet | 120 → 63 | 20 → 15 |
| Modern | 4 | General Dynamics F-16C Block 50 | 120 → 80 | 20 → 16.5 |
| Modern | 5 | Saab JAS 39C Gripen | 110 → 79 | 20 → 17 |
| Modern | 6 | Sukhoi Su-27S | 130 → 148 | 22 → 23.5 |
| Modern | 7 | McDonnell Douglas F-15C Eagle | 130 → 198 | 21 → 25.5 |
| Modern | 8 (was 9) | Eurofighter Typhoon | 120 → 213 | 22 → 29 |
| Modern | 9 (was 8) | Dassault Rafale C | 120 → 150 | 23 → 26 |
| Modern | 10 | Lockheed Martin F-22A Raptor | 130 → 300 | 24 → 37 |

## What this means in a match

- Each tier now beats the one below it about 60–70% of the time one on one, so a tier-10 plane against a tier-1 is a big favourite (the underdog RP multiplier pays ×3 for that kill). Team balancing by BR (Day 6) already evens out teams; nothing there changed.
- HP now spreads more within an era (Modern: 63 for the F/A-18C up to 300 for the F-22A, the most planes.json allows). Missiles still remove a percentage of max HP, so a missile hit is as deadly as before on any plane; the spread shows in gunfights.
- Tier-1 planes got lighter: the free planes everyone starts with die faster in gunfights. The tutorial repairs your plane, so it's unaffected.
- Known limits: duels are bot-vs-bot at *normal* difficulty in one geometry family; human skill, teamwork and 10 v 10 fights will shift these numbers. Re-run `npm run balance` after any planes.json edit.
