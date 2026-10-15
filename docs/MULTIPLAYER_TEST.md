# Multiplayer manual test (2 laptops + 1 phone)

About 30 minutes. Use the live site: https://singha105.github.io/red-vs-blue-skies/?debug=1 on every device (`?debug=1` shows the network stats and unlocks every plane). Write down anything odd for the next day's prompt ("My notes from yesterday's test").

## Setup

- **Laptop A (host):** plugged in, on Wi-Fi, Chrome or Safari.
- **Laptop B:** any network (Wi-Fi is fine).
- **Phone:** iPhone Safari if you have one. Use Wi-Fi until the Metered TURN key is added; after that, use mobile data with Wi-Fi **off**.
- Reload every device once so they all run the same version (the host rejects different versions).

## 1. Into the room

1. Laptop A: Host / Join → callsign → Continue → Host. The room code, a QR code and the link appear.
2. Phone: scan the QR code. The page asks for a callsign ("Join room XQZK"). Type one and press Join.
3. Laptop B: Host / Join → callsign → Continue → type the code → Join.
4. Check that all three names are in every lobby list with a blue or red stripe (the team each would get right now), the phone shows as "phone / tablet", and pings appear.
5. Phone: press "I'm ready". Laptop B: press "Party up" on the phone's row. Both now show "Party A" and the same stripe colour.
6. Each device: tap a quick chat button, then type and send a short message. Every device shows it.
7. Laptop A: try every host setting (bot difficulty, bots on/off, 5/10/15 min). Leave it on 5 min for the test.

## 2. Round 1

1. Laptop A: Start vote. All three devices show the vote with a 20 s timer.
2. Vote differently on each device and check the counts update live. Laptop A: switch to "Host pick" and tap a map. It shows "Host pick" and wins.
3. Teams appear for 5 s: the phone and Laptop B (the party) are on the same team.
4. Plane select: each device picks a different plane and presses "Fly the …". Locked planes (tier 4+ without `?debug=1`) are greyed out with their RP cost.
5. The match starts on all three. Check you see each other moving (use the minimap), and shoot each other.
6. Get shot down (or crash). The respawn picker shows your SP and which planes you can afford. With no kills only the free tier-1 reserve is selectable. Get a kill, die again, and check you can now afford a better plane.
7. Debug stats: **in KB/s** on the phone and Laptop B must stay **under 30 KB/s** (about 10 is expected).

## 3. Results and round 2

1. When the 5 minutes are up, all three show the results: winner, awards (MVP, Ace, Wingman, Survivor where earned), K / A / Dmg / D / RP for all 20 pilots, and the team BR line (within 10%).
2. Phone: press Play again ("Waiting for the host…"). Laptop A: Play again → everyone is back in the lobby **without reloading**.
3. Play round 2 the same way with a different era. That's two full matches in a row.

## 4. Leaving and joining

1. During round 2, Laptop B presses Leave. After about 10 s, its plane flies on as "(bot)".
2. Laptop B joins again with the same code mid-match: it lands on the team with fewer humans, in place of a bot.
3. Lock the phone for 15 s, then unlock it. The phone shows "Connection lost" and a bot takes over its plane.
4. Laptop A (host): close the tab. Laptop B shows **Host left** with the scores so far within about 8 s.

## 5. Edge cases (optional)

- Host removes a player in the lobby (Remove): they see "The host removed you from the room."
- Wrong code: "Room … not found" within about 15 s.
- Phone as host: the lobby warns that a laptop is a better host.
- Solo with no network: airplane mode, reload, and play a solo match. It must work, including the respawn picker and the results with RP.
