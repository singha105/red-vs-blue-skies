# Plane queue

Every plane's progress against `docs/PLANE_DESIGN_STANDARD.md`, in build order: the six Day 12 flagships first, then tiers 1, 5 and 10 of each era (so every era gets detailed planes early), then the rest by era and tier.

Two statuses per plane:

- **Design**: the model against the standard (dimensions, silhouettes, airfoils, moving parts, breakables, cockpit, LODs, paint, export, proof page).
- **Physics**: the Day 13 flight model fed from the plane's `.aero.json` (wing areas, airfoils, hinge lines, control sizes, flap settings, masses).

Status values: `todo` (classic Day 11 model or nothing yet), `in progress`, `provisional` (built and exported but at least one check still fails or an estimate stands in for a source; see the plane's page), `done` (every check passes).

| # | Plane | id | Era | Tier | Group | Design | Physics | Page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sopwith Camel F.1 | `sopwith_camel` | WW1 | 7 | Flagship | in progress | todo | |
| 2 | Supermarine Spitfire Mk V | `spitfire_mk5` | Early WW2 | 9 | Flagship | in progress | todo | |
| 3 | North American P-51D Mustang | `p51d` | Late WW2 | 8 | Flagship | in progress | todo | |
| 4 | North American F-86F Sabre | `f86f` | Early Jets | 6 | Flagship | in progress | todo | |
| 5 | McDonnell Douglas F-4E Phantom II | `f4e` | Cold War | 5 | Flagship | in progress | todo | |
| 6 | General Dynamics F-16C Block 50 | `f16c_b50` | Modern | 4 | Flagship | in progress | todo | |
| 7 | Fokker E.III | `fokker_e3` | WW1 | 1 | Tier 1 pass | todo | todo | |
| 8 | Boeing P-26 Peashooter | `p26` | Early WW2 | 1 | Tier 1 pass | todo | todo | |
| 9 | Curtiss P-40E Warhawk | `p40e` | Late WW2 | 1 | Tier 1 pass | todo | todo | |
| 10 | Lockheed P-80 Shooting Star | `p80` | Early Jets | 1 | Tier 1 pass | todo | todo | |
| 11 | Mikoyan-Gurevich MiG-21F-13 | `mig21f13` | Cold War | 1 | Tier 1 pass | todo | todo | |
| 12 | Mikoyan MiG-29A | `mig29a` | Modern | 1 | Tier 1 pass | todo | todo | |
| 13 | Albatros D.III | `albatros_d3` | WW1 | 5 | Tier 5 pass | todo | todo | |
| 14 | Curtiss P-36A Hawk | `p36` | Early WW2 | 5 | Tier 5 pass | todo | todo | |
| 15 | Republic P-47D Thunderbolt | `p47d` | Late WW2 | 5 | Tier 5 pass | todo | todo | |
| 16 | Mikoyan-Gurevich MiG-15bis | `mig15bis` | Early Jets | 5 | Tier 5 pass | todo | todo | |
| 17 | Saab JAS 39C Gripen | `jas39c` | Modern | 5 | Tier 5 pass | todo | todo | |
| 18 | Fokker D.VII | `fokker_d7` | WW1 | 10 | Tier 10 pass | todo | todo | |
| 19 | Messerschmitt Bf 109 F-4 | `bf109f4` | Early WW2 | 10 | Tier 10 pass | todo | todo | |
| 20 | Supermarine Spitfire Mk XIV | `spitfire_mk14` | Late WW2 | 10 | Tier 10 pass | todo | todo | |
| 21 | Mikoyan-Gurevich MiG-19S | `mig19s` | Early Jets | 10 | Tier 10 pass | todo | todo | |
| 22 | McDonnell Douglas F-15A Eagle | `f15a` | Cold War | 10 | Tier 10 pass | todo | todo | |
| 23 | Lockheed Martin F-22A Raptor | `f22a` | Modern | 10 | Tier 10 pass | todo | todo | |
| 24 | Airco DH.2 | `airco_dh2` | WW1 | 2 | Rest | todo | todo | |
| 25 | Nieuport 11 Bébé | `nieuport_11` | WW1 | 3 | Rest | todo | todo | |
| 26 | Sopwith Pup | `sopwith_pup` | WW1 | 4 | Rest | todo | todo | |
| 27 | Fokker Dr.I | `fokker_dr1` | WW1 | 6 | Rest | todo | todo | |
| 28 | Royal Aircraft Factory S.E.5a | `se5a` | WW1 | 8 | Rest | todo | todo | |
| 29 | SPAD S.XIII | `spad_s13` | WW1 | 9 | Rest | todo | todo | |
| 30 | Gloster Gladiator Mk I | `gladiator` | Early WW2 | 2 | Rest | todo | todo | |
| 31 | Fiat CR.42 Falco | `cr42` | Early WW2 | 3 | Rest | todo | todo | |
| 32 | Polikarpov I-16 Type 24 | `i16` | Early WW2 | 4 | Rest | todo | todo | |
| 33 | Hawker Hurricane Mk I | `hurricane_mk1` | Early WW2 | 6 | Rest | todo | todo | |
| 34 | Mitsubishi A6M2 Zero | `a6m2` | Early WW2 | 7 | Rest | todo | todo | |
| 35 | Messerschmitt Bf 109 E-4 | `bf109e4` | Early WW2 | 8 | Rest | todo | todo | |
| 36 | Bell P-39Q Airacobra | `p39q` | Late WW2 | 2 | Rest | todo | todo | |
| 37 | Grumman F6F-5 Hellcat | `f6f5` | Late WW2 | 3 | Rest | todo | todo | |
| 38 | Focke-Wulf Fw 190 A-8 | `fw190a8` | Late WW2 | 4 | Rest | todo | todo | |
| 39 | Vought F4U-4 Corsair | `f4u4` | Late WW2 | 6 | Rest | todo | todo | |
| 40 | Yakovlev Yak-3 | `yak3` | Late WW2 | 7 | Rest | todo | todo | |
| 41 | Messerschmitt Me 262 A-1a | `me262` | Late WW2 | 9 | Rest | todo | todo | |
| 42 | de Havilland Vampire FB.5 | `vampire` | Early Jets | 2 | Rest | todo | todo | |
| 43 | Gloster Meteor F.8 | `meteor_f8` | Early Jets | 3 | Rest | todo | todo | |
| 44 | Republic F-84G Thunderjet | `f84g` | Early Jets | 4 | Rest | todo | todo | |
| 45 | Mikoyan-Gurevich MiG-17F | `mig17f` | Early Jets | 7 | Rest | todo | todo | |
| 46 | Hawker Hunter F.6 | `hunter_f6` | Early Jets | 8 | Rest | todo | todo | |
| 47 | Vought F-8 Crusader | `f8` | Early Jets | 9 | Rest | todo | todo | |
| 48 | Lockheed F-104G Starfighter | `f104g` | Cold War | 2 | Rest | todo | todo | |
| 49 | Dassault Mirage IIIE | `mirage3e` | Cold War | 3 | Rest | todo | todo | |
| 50 | Northrop F-5E Tiger II | `f5e` | Cold War | 4 | Rest | todo | todo | |
| 51 | Mikoyan-Gurevich MiG-23MLD | `mig23mld` | Cold War | 6 | Rest | todo | todo | |
| 52 | Dassault Mirage F1C | `mirage_f1c` | Cold War | 7 | Rest | todo | todo | |
| 53 | Grumman F-14A Tomcat | `f14a` | Cold War | 8 | Rest | todo | todo | |
| 54 | General Dynamics F-16A Fighting Falcon | `f16a` | Cold War | 9 | Rest | todo | todo | |
| 55 | Dassault Mirage 2000-5 | `mirage2000_5` | Modern | 2 | Rest | todo | todo | |
| 56 | McDonnell Douglas F/A-18C Hornet | `fa18c` | Modern | 3 | Rest | todo | todo | |
| 57 | Sukhoi Su-27S | `su27s` | Modern | 6 | Rest | todo | todo | |
| 58 | McDonnell Douglas F-15C Eagle | `f15c` | Modern | 7 | Rest | todo | todo | |
| 59 | Eurofighter Typhoon | `typhoon` | Modern | 8 | Rest | todo | todo | |
| 60 | Dassault Rafale C | `rafale_c` | Modern | 9 | Rest | todo | todo | |

AI bombers (`bomber_ww1`, `bomber_ww2`, `bomber_jet`) are not in the roster and keep their Day 11 models until the fighters are done.
