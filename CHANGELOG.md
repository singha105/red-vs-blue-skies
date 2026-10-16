# Changelog

The version shows bottom-right on the title screen (`1.0.0+<commit>`). Day-by-day detail is in [docs/PROGRESS.md](docs/PROGRESS.md).

## 1.0.0 (2026-10-15): launch (Day 10)

- **Tutorial** on first launch (about a minute): fly through rings, shoot balloons, fire a missile at a drone, beat a missile with flares. Skippable; Settings → Play the tutorial again.
- **How to play** on the title screen: controls for phone, keyboard and mouse, and gamepad; modes and unlocks; hosting tips; credits.
- **Balance** from a bot tournament: 200 duels per adjacent tier pair in every era. Each tier now beats the one below it 56–74% of the time (it was 10–98%). Three tier swaps (Spitfire Mk XIV ↔ Me 262, MiG-19 ↔ F-8, Rafale ↔ Typhoon) and new HP and turn rates; see docs/BALANCE_REPORT.md. Bots no longer get stuck circling each other forever.
- **Accessibility:** colour-blind team colours (blue and orange), HUD size slider, invert pitch; every warning sound also shows on screen; all text at least 14 px on phones.
- **Battery and phones:** 30 fps cap option; the screen stays on during rooms and matches; a phone that locks mid-match rejoins its room when it comes back; a phone host is warned that locking ends the match; held buttons are released when the app goes to the background; sound pauses in background tabs.
- **Hosting:** a host's hidden tab keeps the match running (it used to freeze for everyone).
- **Errors:** a friendly card with **Copy error** instead of a silent crash.
- **Fixes:** convoys no longer drive through each other (trucks and tanks drove at different speeds on one road); Island Chain's red side now has its two convoys; moving a volume slider no longer restarts the automatic graphics test.
- **Speed:** less garbage per frame (bullets move in place, terrain lookups skipped above the highest ground, allocation-free missile seekers, HUD writes only on change, minimap at 10 Hz): GC time down about a quarter, worst pause halved. First load 3.1 s on a slow 4G connection.

## 0.9 (Day 9): remaining planes, maps, modes, sound

All 60 plane models, AI bombers, Mountain Valley / Desert Mesas / Carrier Strike, Air Domination, Ground Strike, Bomber Escort, procedural sound and effects.

## 0.8 (Day 8): progression

Firebase guest accounts with Google linking, research points, unlocks, friends leaderboard, offline queue, security rules.

## 0.7 (Day 7): missiles

IR and radar missiles with locks, flares, chaff and notching; the 28 jet models.

## 0.6 (Day 6): lobby and match flow

Lobby, voting, BR team balancing, plane select, results and play again, chat, spawn points.

## 0.5 (Day 5): multiplayer

PeerJS host-authoritative matches with room codes, QR, prediction and interpolation.

## 0.4 (Day 4): Blender pipeline

Parametric plane kit, the first six models, hangar.

## 0.3 (Day 3): playable solo

Guns, damage, bots, solo Team Deathmatch, HUD.

## 0.2 (Day 2): flight

Flight model, mouse-aim autopilot, touch and gamepad controls, Island Chain.

## 0.1 (Day 1): foundation

Data files, validation, PWA shell, live deploy.
