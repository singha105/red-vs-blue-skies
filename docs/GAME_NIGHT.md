# Game night checklist

For the first big match: at least 6 real players including 2 phones, a full 10-minute match without a crash or desync. Game: https://singha105.github.io/red-vs-blue-skies/

## The day before

- [ ] Open the live site and check the title shows **v1.0.0** (bottom-right). If a phone shows an older version, reload twice, or remove and re-add the home-screen app.
- [ ] Phone players: update iOS to 26.2 or later if they can (iOS 26.0–26.1 home-screen apps can lose sound after being reopened; playing in Safari works either way).
- [ ] Send everyone the "How to play" tip: the title screen has it, and the first launch offers a one-minute tutorial.

## Host (one laptop)

- [ ] A laptop, **plugged in**, on **Wi-Fi or Ethernet**, with sleep and screen lock turned off (macOS: System Settings → Lock Screen → "Turn display off" = Never while plugged in).
- [ ] Chrome, Edge or Safari, the game tab in front. A hidden host tab keeps the match running now, but slower: keep it in front.
- [ ] Close downloads and video calls on that network; the host uploads about 10 KB/s per player (≈ 200 KB/s for 20).
- [ ] Title → **Host / Join** → callsign → **Host**. Post the room link in the group chat **10 minutes early**.
- [ ] In the lobby: bots on, match length 10 min.

## Everyone

- [ ] **Phones:** Safari → Share → **Add to Home Screen** (or Chrome → Install), open it from the home screen, hold it **sideways**, turn **Low Power Mode off**, use **headphones**, tap the screen once so the sound starts.
- [ ] **Phones on mobile data may not connect** (there's no TURN relay yet, STUN only). Join from Wi-Fi. If a phone says "Couldn't connect", try it on Wi-Fi first.
- [ ] Open the link → callsign → you're in the lobby. Tap **Ready**.
- [ ] Voice: Discord with one channel per team plus a lobby channel.

## First match

- [ ] **Team Deathmatch on Island Chain in WW1 or Early WW2**: no missiles, so new players learn to fly and shoot first.
- [ ] Everyone flies tier 1 the first time (that's what new accounts have); RP from the match unlocks tier 2 (400 RP) in **Research** between rounds.

## If something goes wrong

| Problem | Do this |
| --- | --- |
| A phone can't join | Make sure it's on Wi-Fi (no TURN relay yet); check the room code; the host's screen must be on |
| A phone locked or switched apps mid-match | Unlock it: it says "Reconnecting to room …" and rejoins the match by itself (a bot flew its plane meanwhile; RP from before the lock is saved) |
| The host's laptop slept or the host left | Everyone gets "Host left" with the points so far saved. Pick a new host and start a new room |
| Everyone lags | The host is on a phone or weak Wi-Fi: host from a laptop closer to the router |
| No sound on iPhone | Tap the screen once; check Settings → Volume; on iOS 26.0–26.1 reopen in Safari |
| Low frame rate on a phone | Settings → Graphics Low; Settings → Frame rate 30 fps also saves battery |
| "Something went wrong" card | Tap **Copy error** and paste it in the group chat for the host; then **Keep playing** or **Reload** |
| A plane looks too strong | Note which era, plane and tier; balance is data (`npm run balance` re-checks it) |

## After each match

- [ ] Ask "what felt bad?" and write the answers down, with any **Copy error** reports. Paste them into the next session's notes.
- [ ] Hand checks still owed from the build: progress on a second device (play, link Google in Settings, open the game on a phone, same RP and unlocks), and sound on a real iPhone.
