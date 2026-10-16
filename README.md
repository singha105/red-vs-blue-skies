# Red vs Blue Skies

Low-poly multiplayer air combat in the browser for up to 20 players on phones, tablets and laptops. Red against blue, 60 planes across six eras from WW1 biplanes to modern jets, and bots fill every empty seat so there's always a 10 v 10. It costs nothing to run: one player's browser hosts each match.

**Play: https://singha105.github.io/red-vs-blue-skies/**

New players get a one-minute tutorial the first time they open the game (Settings → Play the tutorial again). The title screen's **How to play** has everything below in the game.

## Controls

You point where you want to fly and the plane follows the aim circle, whatever the device.

### Phone or tablet (hold it sideways)

| Do this | To |
| --- | --- |
| Drag on the right side of the screen | Move the aim circle (like a trackpad) |
| Quick tap on an enemy | Pick it as the missile target |
| Left slider | Throttle |
| **Fire** (hold) | Guns |
| **Missile** | Fire once the ring around the button is full (locked). The P-47D, F4U-4 and Fw 190 A-8 drop rockets, then bombs |
| **Flare** | Flares and chaff against missiles |
| **Level** | Wings level, nose on the horizon |
| **Look** | Look around by dragging; tap again to stop |
| **Scores** | Scoreboard |

Touch players get light aim assist (Settings → Touch aim assist; 0% turns it off). On iPhone, Safari can't go full screen, but **Share → Add to Home Screen** launches the game full screen like an app.

### Keyboard and mouse

| Key | Does |
| --- | --- |
| Click once, then move the mouse | Aim (Esc releases the mouse) |
| Left button or Space | Guns |
| Right button or Q | Missile (rocket planes: rockets, then bombs) |
| F | Flares and chaff |
| R | Next missile target |
| W / S | Throttle up / down |
| A / D | Roll |
| Arrow keys | Fly directly, without the mouse |
| C (hold) | Look around |
| L | Level the wings |
| Tab (hold) | Scoreboard |

### Gamepad (Xbox or PlayStation layout; press any button to wake it)

| Button | Does |
| --- | --- |
| Left stick | Aim |
| Right stick | Look around |
| RT / LT | Throttle up / down |
| A (✕) | Guns |
| B (○) | Missile |
| X (□) | Flares and chaff |
| RB | Next missile target |
| Y (△) | Level the wings |

**Missiles:** keep an enemy in front of you until the box goes solid red, then fire. When **MISSILE** flashes on your screen: heat seekers (IR) → flares, cut the throttle, turn hard; radar missiles → chaff and turn side-on to the missile.

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
- **Maps:** Island Chain, Mountain Valley (a canyon), Desert Mesas, Carrier Strike (open ocean with carriers).
- **Eras:** WW1, Early WW2, Late WW2, Early Jets, Cold War, Modern; ten planes each, tier 1 to 10.
- **Research points (RP):** every match earns RP for kills (more for shooting down a better plane), assists, damage, captures and ground targets, surviving and winning. Spend them in **Research** to unlock the next tier of any era: tier 2 costs 400 RP, tier 10 costs 2,000. Tier 1 of every era is free. Your progress lives on a guest account; Settings → **Link Google account** carries it to your other devices.
- **Spawn points (SP):** better planes cost more to respawn in during a match. The era's tier-1 plane is always free.

## Settings

Graphics (auto / low / medium / high), a **30 fps cap** to save battery, aim sensitivity, **invert pitch**, touch aim assist, **HUD size**, **colour-blind team colours** (blue and orange), volume per sound group. Every warning sound (missile lock, launch, stall) also shows on screen.

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
- Fonts: Big Shoulders Display and Barlow Semi Condensed (SIL Open Font License), self-hosted.
- Every plane, ground unit, map, sound and icon is generated by the game's own code and Blender scripts. No assets from other games.
