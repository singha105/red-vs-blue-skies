# Multiplayer manual test (2 laptops + 1 phone)

About 20 minutes. Use the live site: https://singha105.github.io/red-vs-blue-skies/?debug=1 on every device (`?debug=1` shows the network stats). Write down anything odd for the next day's prompt.

## Setup

- **Laptop A (host):** plugged in, on Wi-Fi, Chrome or Safari.
- **Laptop B:** any network (Wi-Fi is fine).
- **Phone:** Wi-Fi **off**, on mobile data. iPhone Safari if you have one.
- Reload every device once so they all run the same version (the host rejects different versions).

## 1. Host and join

1. Laptop A: Host / Join → callsign → Host → pick an era and plane → Create room. A 4-letter code, a QR code and a link appear.
2. Phone: scan the QR code with the camera. The join screen opens with the code filled in. Type a callsign and press Join.
3. Laptop B: type the code by hand on Host / Join (don't use the link) and Join.
4. Check: all three names are in every lobby list. The phone shows as "phone / tablet". Pings appear within about 2 s.
5. Laptop A: press Copy link and paste it somewhere to check it says `?room=CODE`.

## 2. Play

1. Laptop A: Start match. All three devices go into the match within about 2 s.
2. Fly toward each other (the minimap shows everyone). Check that each device sees the other two moving smoothly, with no teleporting or stutter.
3. Shoot each other. Hits show sparks and hit markers, kills show in the kill feed on all three devices, and the score at the top matches everywhere.
4. Debug stats (top left, or top right on the phone): note the **in KB/s** on the phone and on Laptop B. It must be **under 30 KB/s** (about 10 is expected). Note the ping and loss too.
5. Lock the phone for 15 s, then unlock it. Expected: after about 10 s a bot takes over the phone's plane ("Name (bot)"), and the phone shows "Connection lost" with the scores so far (iOS suspends the connection while locked). Rejoin from the phone with the same code and check it gets into the running match as a new pilot.

## 3. Leaving

1. Laptop B: press Menu. On the host, after about 10 s, Laptop B's plane keeps flying as "(bot)".
2. Laptop A (host): close the tab. The phone shows **Host left** with the scores so far within about 8 s.

## 4. Edge cases (optional)

- Wrong code: enter a code nobody is hosting, and check for "Room … not found" within about 15 s.
- Phone as host: host from the phone and check that the lobby warns "The host is on a phone…" and recommends a laptop.
- Solo with no network: turn on airplane mode, reload, and play a solo match. It must work.

## If the phone can't connect on mobile data

That is the carrier's NAT, and it needs the TURN relay (Metered). Check that `VITE_TURN_DOMAIN` and `VITE_TURN_API_KEY` are set as repo secrets and that the deploy ran after they were added. The Host / Join screen says "no relay server configured" when they're missing.
