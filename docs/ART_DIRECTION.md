# Art direction

Written on Day 11 from four screenshots of another (PC) jet game that the user shared as a style reference. The screenshots are **not** in the repo and later sessions can't see them, so this file is the description. Take the ideas below; copy no logos, fonts, artwork, UI chrome or pixel-exact layouts. Everything we ship is original or CC0.

## What the reference shows

**Shot 1, low over a forest valley, HUD on.** A small jet with an afterburner glow flies low over a steep valley wall covered edge to edge in dark green pines. Grey rock faces show on the steepest slopes. Distant ridges are lighter and bluer. The sky is mid-blue with many small, soft cumulus puffs. The green HUD has a speed tape on the left (KT, boxed readout), an altitude tape on the right (FT, boxed readout), a heading tape along the bottom (35 · N · 01 · 02 · 03, boxed heading), a pitch ladder (5/10/15 solid above, dashed below), a large thin rectangle framing the HUD field of view, and a small flight-path marker (circle and dot). Readouts: "MISSILES 10/10" at the right of the frame; "M 0.68 / −0.4 G MAX 10.6 / AOA 2.2" with a thin bar bottom left; radar altitude "R 310 FT" bottom right. Bottom-right corner: a round green radar scope with a V-shaped sector cone, range rings, your plane as a dot at the bottom point and a "12 KM" range label, next to a ring-shaped boost gauge (100%).

**Shot 2, chase view diving between peaks.** A twin-engine swept-wing jet in chase view with two very bright orange-white afterburner discs. Snowy peaks above, but the snow and rock patches are **blocky and pixelated** (big square texels from a low-resolution splat map). This is the main thing to avoid. HUD extras: "SET 950" under the speed box (commanded speed), a "MIL 8.4 s" timer (afterburner or military-power time), a red boxed **PULL UP** with **TERRAIN** under it, and a weapons list "GUN 600 / MSL 5/13 / FLR ∞". Bottom right is an instrument panel styled like a physical bezel: three vertical bar gauges (FUEL, THR, HULL, numbers on top) next to a small cone radar screen (13.8 KM). A one-line key-help strip and a big score/XP/credits bar run across the top (game-specific; don't copy).

**Shot 3, chase view through an alpine valley.** Behind and slightly above a jet flying low. Classic alpine look: dense pines on the lower slopes, scattered rock where it gets steep, snow-capped peaks in the distance, softened by haze. Forest density is very high with individual trees readable near the camera, and the ground under the trees varies (dark soil, clearings, lighter grass). HUD: "PULL UP / TERRAIN" in red at the top; corner brackets instead of a full frame; M 1.06; "8.9 G MAX 8.9" turns **red** when over the G limit; heading tape 13–17 with a boxed 153; "MISSILES 8/8 / ROUNDS 480"; "R 438 FT".

**Shot 4, hard turn, cirrus sky.** A jet pulling 11 G with two long, bright white **wingtip vapour ribbons** curving back from the wingtips. The sky has a high **streaky cirrus** layer (thin horizontal brush strokes) above soft, large cumulus. Several overlapping yellow circles mark the seeker/lock reticle. Glowing green flare dots fall below and behind the plane. The bottom-right panel is a dark rounded card with the cone scope (12 KM), a boost ring, THR and HULL pill bars, status chips (HIDDEN, LOW), a score/streak block and weapon chips (MSL 8/8 · FLR ∞ · GUN 480).

## Take

- **Terrain:** steep mountain valleys you can fly through; dense conifer forest on the lower and middle slopes; bare rock on steep faces (triplanar so cliffs don't stretch); snow on peaks, mostly on flatter high ground and fading out on steep rock; sand or pebbles at the water's edge; varied ground under the trees (soil, clearings, grass).
- **Distance:** atmospheric haze that turns far ridges lighter and bluer, plus distant mountain ranges so the horizon never ends in a flat edge.
- **Sky:** soft, puffy cumulus at mid altitude (fly-through billboards) and a separate high, streaky cirrus layer; a clear mid-blue sky with a lighter horizon.
- **Jet HUD (Cold War, Modern):** green, thin lines, high contrast, slightly glowing. Speed tape left, altitude tape right, heading tape bottom, each with a boxed current value; pitch ladder (solid above the horizon, dashed below); flight-path marker; Mach, G, max G and AoA readouts bottom left; radar altitude bottom right (below 1,500 ft); weapon counts beside the frame; commanded speed under the speed box; red "PULL UP / TERRAIN" when impact is under 4 s away; G readout turns red above the plane's limit.
- **Instrument panel, bottom right:** a cone-shaped sector radar scope with range rings, own plane at the bottom point and a range label; next to it compact vertical bars for throttle, WEP/afterburner heat and hull; a radar-warning display. Keep it one compact cluster.
- **Effects:** wingtip vapour ribbons in hard turns (above 6 G); bright afterburner glow (layered discs plus bloom); glowing flares with short trails; heat shimmer or glow behind jet engines.

## Avoid

- **Blocky, pixelated snow and rock patches** from a low-resolution splat map. Blend per pixel, break edges up with noise, and use detail textures near the camera.
- **Trees popping in.** Crossfade 3D trees to impostors and impostors into haze.
- Their score, XP and credits bars, "upgrades ready" prompts, key-help strips across the screen, streak counters, status chips and social-video captions. Our HUD shows flight and combat information only, plus our own existing scoreboard.
- Physical-bezel skeuomorphic panels with fake screws. Ours is a flat, dark, translucent card.
- Clutter: never more than one readout cluster per screen corner, and nothing overlapping the touch controls on phones.
- Their logos, fonts, artwork, icons and exact layouts. Use our own layout and an OFL font (Rajdhani or Share Tech Mono, self-hosted).

## Our palette and type

- HUD green `#6dff95` (lines and text), 85% opacity, a 1 px darker outline for readability over snow and sky; warnings `#ff4d4d`; caution `#ffd166`; friendly blue `#5aa9ff`; enemy red `#ff5a5a` (blue/orange with the colourblind option).
- Panel card: `rgba(10, 20, 30, 0.72)`, 10 px radius, no bezel.
- HUD font: a self-hosted OFL monospace or condensed face (Share Tech Mono or Rajdhani); the rest of the UI keeps Big Shoulders Display / Barlow Semi Condensed.
- Terrain mood: pines `#1f4a2c`–`#2f6b3a`; rock `#8a8d8f`; snow `#eef3f7`; haze blending toward the map's `skyHorizon` colour.
