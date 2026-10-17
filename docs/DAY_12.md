# Day 12: desktop focus, plane design standard, detailed flagship planes

The full Day 12 prompt (it isn't in docs/BUILD_PLAN.md, which stops at Day 10). A fresh session starts here.

You are the lead 3D technical artist and engineer for "Red vs Blue Skies". Today you move the game to desktop-only, write the plane design standard, rebuild the pipeline so it produces highly detailed planes with separately moving control surfaces, deliver the first six planes, and add a look-back view on V.

Read CLAUDE.md, docs/PROGRESS.md, docs/GAME_DESIGN.md, docs/ART_DIRECTION.md and docs/HOW_TO_PLAY.md first. Days 1–11 are done (Day 11 also added an opt-in Realistic flight model).

## Downloads

The user approved downloading whatever is required, as long as it is free and safe. That covers, for example:

- `pip install opencv-python-headless` (or numpy and Pillow) for the silhouette IoU checks
- airfoil coordinate files from the UIUC airfoil database
- public-domain three-view drawings and photos from Wikimedia Commons
- Poly Haven CC0 textures

Use official sources only (PyPI, npm, the UIUC site, Wikimedia, Poly Haven). Nothing paid, no accounts, and never any 3D models. Reference images and drawings go in `tools/blender/refs/` (gitignored) and are for comparison only.

## Context

- Decision: phones and tablets are no longer supported. The game targets laptop and desktop browsers (Chrome, Edge, Firefox, and Safari on Mac) with mouse and keyboard, gamepads, and, from Day 13, joysticks. This frees much bigger detail budgets.
- The Mac has Apple Silicon and 8 GB RAM. Run Blender headless (`/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup`), one plane at a time, and bake at 2K.
- Day 13 builds a realistic, War Thunder-style flight model from the geometry produced today: wing areas, airfoils, hinge lines, and control surface sizes. Export that data accurately; the physics depends on it.
- Today's six flagship planes, one per era: Sopwith Camel, Spitfire Mk V, P-51D Mustang, F-86F Sabre, F-4E Phantom II, F-16C Block 50. Between them they cover a biplane with a rotary engine, an elliptical wing with split flaps, a laminar-flow wing, a swept wing with slats and an all-moving tail, a stabilator with spoilers, and a fly-by-wire jet with flaperons and leading-edge flaps. Verify each of those features per plane.
- For each plane, look up and record sources for: dimensions, three-view drawings, wing and tail airfoils (David Lednicer's "Incomplete Guide to Airfoil Usage" and the UIUC airfoil coordinate database), control surface sizes and deflection limits, flap type and settings, slats, airbrakes, landing gear type and retraction, canopy type, engine and propeller or nozzle, gun and pylon positions, and the historical paint scheme. Example values in this file are starting points, not facts.
- If the user types playtest notes or bugs, fix those first.
- Work in three parts and commit after each. If a session runs out, stop at a commit and leave a handoff note in PROGRESS.md.

## Design standard

Write this into `docs/PLANE_DESIGN_STANDARD.md` and follow it for every plane, today and in every later session.

1. **Accuracy**
   - Length, wingspan, and height within 2% of published figures.
   - Silhouettes: render orthographic top, side, and front silhouettes and compare them with the reference three-view (trace its outline with OpenCV and align by length). Overlap (IoU) of at least 0.90 for the top and side views and 0.85 for the front. If no usable three-view exists, compare against photos and note it.
   - Real airfoils: build wing and tail sections from the documented root and tip airfoils, so the shape and the physics use the same data.
2. **Separate moving parts.** Each is its own mesh, parented to a hinge empty on the real hinge line, rotating about the hinge axis, with min and max deflection and travel rate (degrees per second) recorded in the export:
   - Roll: ailerons (left and right; both wings on biplanes), or spoilers, flaperons, or differential tails where the real plane used them.
   - Pitch: elevators (left and right) or all-moving stabilators.
   - Yaw: rudder or rudders.
   - High lift: flaps by type (split, plain, slotted, Fowler; Fowler flaps slide back and down along a track), with the real settings mapped to Up / Combat / Takeoff / Landing. Slats and leading-edge flaps where fitted.
   - Drag: airbrakes and speedbrakes.
   - Landing gear: each leg, wheel, and door, with the real retraction path and order, including tailwheels and nose gear.
   - Canopy that slides or hinges open.
   - Propeller: spinner plus separate blades that turn and change pitch, with a blur disc at high RPM. Jets: afterburner nozzle petals that open, and swing wings on variable-sweep planes.
   - Bomb bay doors where fitted.
3. **Breakable parts for damage:** left and right outer wings, left and right inner wings, tail section, each control surface, engine, and fuel tanks, as separate meshes with clean break edges and a damaged-edge variant.
4. **Cockpit:** a simplified interior good enough for a cockpit view: seat, stick and rudder pedals that move with the controls, gunsight, and an instrument panel whose six main gauges work (airspeed, altitude, heading, RPM or thrust, G, fuel). Build one cockpit kit per era and adjust it per plane. Jets get a HUD glass that shows Day 11's HUD.
5. **Detail levels:**
   - LOD0 (your own plane, the hangar, and close range): 40,000–80,000 triangles for prop planes, 60,000–120,000 for jets.
   - LOD1 about 15,000; LOD2 about 4,000; LOD3 under 1,000. Moving parts and team markings stay visible at every level.
6. **Surface detail and paint:** PBR textures at 2K for LOD0 (base colour, roughness, metalness, normal, ambient occlusion), compressed to KTX2. Panel lines and rivets baked into the normal map, following the reference drawings' panel layout. Historical camouflage or natural-metal finish per plane. Team identity stays: red or blue team bands and a team roundel replace national insignia, plus a squadron number decal. No national insignia.
7. **Export contract:** one .glb per plane plus `<id>.aero.json` holding everything Day 13 needs: masses if known, every lifting surface (span, area, chord distribution, sweep, dihedral, incidence, airfoil, position), every control surface (parent surface, chord and span fraction, hinge position and axis, limits, rate), flap settings, gear positions, engine and thrust-line position, and centre-of-gravity range. Name nodes with one consistent scheme so code can find any part. Illustrative excerpt (verify everything):

   ```json
   {
     "id": "spitfire_mk5",
     "surfaces": [
       { "name": "wing_L_inner", "airfoilRoot": "NACA 2213", "airfoilTip": "NACA 2209.4", "spanM": 2.6, "areaM2": 6.1, "sweepDeg": 0, "dihedralDeg": 6, "incidenceDeg": 2 }
     ],
     "controls": [
       { "name": "aileron_L", "parent": "wing_L_outer", "chordFraction": 0.2, "spanFraction": [0.55, 0.9], "hinge": [-3.1, 0.05, -0.4], "axis": [0.98, 0.02, 0.18], "minDeg": -19, "maxDeg": 26, "rateDegS": 80 },
       { "name": "flap_L", "type": "split", "settings": { "up": 0, "landing": 85 } }
     ]
   }
   ```
8. **Budgets:** each plane's full download (all LODs and textures) at most 10 MB; the published site at most 900 MB. Never commit a file over 50 MB. If the repo nears 1 GB, build models in GitHub Actions with a cache keyed on each plane's spec instead of committing .glb files.
9. **Proof per plane:** `docs/planes/<id>.md` with sources, the spec sheet, IoU scores, triangle counts, file sizes, preview renders, and notes from a visual review against the references.

## Part A: desktop focus, look back, standard

1. Update CLAUDE.md: replace the phone rule with the desktop rule (rule 2 below), set the new budgets from rule 4, and add docs/PLANE_DESIGN_STANDARD.md and docs/PLANE_QUEUE.md to the read-first list. On phones and tablets, show a friendly "Please play on a laptop or desktop" screen instead of the game. Leave the existing touch code in place but stop maintaining it; drop or skip the phone/touch Playwright projects and specs, and say so in PROGRESS.md.
2. Desktop quality tiers: Low (older laptops with integrated graphics), Medium, High, and Ultra (LOD0 at longer range, 4K hangar textures, sharper shadows).
3. Look back: hold V to look behind at your six. The camera swings around in about 0.15 s to look back over the tail (in cockpit view, over your shoulder) and swings back on release. While looking back, mouse aim holds the current flight path, like free look. A setting switches between hold and toggle. On gamepads, holding the right-stick click does the same.
4. Views: B now cycles chase view → cockpit view → HUD view (jets only), replacing Day 11's V binding. On gamepads, holding the View button changes view.
5. New controls in `src/data/keybinds.json`, all rebindable: G = landing gear, F = flaps down one step, Shift+F = flaps up one step (move any Day 11 binding that clashes). On gamepads, gear and flaps start unbound.
6. Write docs/PLANE_DESIGN_STANDARD.md from the design standard above, and docs/PLANE_QUEUE.md listing all 60 planes with two statuses each, design and physics (todo / in progress / provisional / done): the six flagships first, then tiers 1, 5, and 10 of each era, then the rest, so every era gets detailed planes early.

## Part B: pipeline and the six flagship planes

7. Rebuild tools/blender into a pipeline that meets the standard:
   - Blueprint setup: load the three-view references as aligned background images at true scale.
   - Fuselage lofted through many cross-sections (at least 40 stations) fitted to the top and side outlines, with real shapes for intakes, radiators, canopy, exhausts, and fairings.
   - Wings and tails built from airfoil coordinates with the real planform, twist, dihedral, sweep, and wing-root fillets.
   - Control surfaces cut from their parent surfaces along the real hinge lines, with hinge gaps, and hinge empties aligned to the hinge axis.
   - Builders with animation for gear, canopy, propeller, nozzles, slats, airbrakes, and swing wings.
   - Small details as real geometry at LOD0: antennas, pitot tubes, gun barrels, exhaust stubs, wing fences, pylons, and navigation lights.
   - Panel-line and rivet baking to the normal map, ambient-occlusion baking, and camouflage painting from a per-plane paint spec.
   - Automatic LOD generation, KTX2 compression, and export of the .glb and .aero.json.
   - Checks: dimensions, silhouette IoU, triangle counts, file size, and that every required part exists and moves within its limits.
   - Preview renders: front, side, top, and three-quarter front and rear, plus each control surface, the flaps, the gear, and the canopy at full deflection.
8. Build the six flagship planes to the standard. For each: research, write the spec, build, run the checks, review the preview renders against the references, fix, and repeat until all checks pass (at most 4 passes; record anything still off in its docs/planes page).
9. `npm run models` rebuilds only planes whose spec changed and prints a summary table.

## Part C: in the game

10. Load LODs by distance with no visible popping (cross-fade), and always use LOD0 for your own plane and in the hangar.
11. Animate every moving part from the plane's control state at the real travel rates. Until Day 13 replaces it, map ControlInput to surface deflections: pitch to elevators, roll to ailerons (or the plane's real roll surfaces), yaw to rudder, plus flaps, gear, airbrakes, slats (extending automatically at high angle of attack where the real plane's did), canopy (closed in flight), propeller blades and pitch, nozzles, and swing wings.
12. Send each plane's surface positions over the network (about one byte each) so everyone sees other players' surfaces move. Change src/net/protocol.ts and keep tests/unit/net.test.ts passing.
13. Hangar: a part test panel that moves each surface, flap setting, gear leg, canopy, and airbrake one at a time with labels, plus an exploded view of the parts.
14. Cockpit view from the era cockpit kits, with working gauges and a moving stick.
15. Breakable parts: when the damage model destroys a wing section or the tail, that mesh detaches and falls with simple physics, and the damaged-edge variant shows. Day 13 connects this to the aerodynamics.
16. Planes not yet rebuilt keep their current models and show a "classic" tag in the hangar until the Plane factory upgrades them.
17. Update docs/HOW_TO_PLAY.md, the in-game help, and the README (`npm run docs:readme`) for look back, views, gear, and flaps. Update PROGRESS.md and PLANE_QUEUE.md, run all tests, commit, push, confirm the deploy, and run the Playwright suite against the live site with BASE_URL.

## Rules

1. $0 only: no paid services, models, or textures. Ask the user before adding any new external service or account. Poly Haven CC0 textures and OFL fonts are allowed; credit them in the README.
2. Laptops and desktops only: every feature must work in Chrome, Edge, Firefox, and Safari on Mac, with mouse and keyboard and with a gamepad.
3. Don't break earlier work: run all tests before each commit.
4. Performance budget: High holds 60 fps on the user's Mac with 20 planes in the match; Low holds 30 fps on an older laptop with integrated graphics. The first match is playable within 15 seconds on a 50 Mbps connection, with LOD0 streaming in afterwards, and the service worker caches models so later visits load fast.
5. Build every model yourself from scripts in the repo. Never download or copy 3D models (especially not from War Thunder or other games); reference images stay out of git.
6. Finish by updating docs/PROGRESS.md and docs/PLANE_QUEUE.md, committing, pushing, and confirming the live deploy.
7. Today: a plane is only "done" when it passes every check in the design standard.

## Done when

- CLAUDE.md, docs/PLANE_DESIGN_STANDARD.md, and docs/PLANE_QUEUE.md are written.
- All six flagship planes pass the standard's checks, with docs/planes pages and preview renders.
- In the hangar, every surface, flap setting, slat, airbrake, gear leg, canopy, and propeller or nozzle moves correctly on all six.
- In a match, other players' control surfaces visibly move, and parts break off when destroyed.
- Holding V looks back and releasing returns to the normal view; B cycles views.
- High holds 60 fps on the Mac in a 20-plane match.

## Notes for the session

- Never enable Firebase billing. The Metered TURN key is still pending (STUN only); don't ask for it.
- The Mac has 8 GB RAM: one Blender job at a time; stop any server or emulator you start.
- Ports: e2e PeerJS signaling 9187 (9000 is php-fpm), Firestore emulator 8187, Auth emulator 9199 (8080 is httpd).
- This is the largest day yet. Prioritise committed, passing work over breadth, and record each plane's honest status in PLANE_QUEUE.md.
