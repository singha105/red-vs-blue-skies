# Plane design standard

Every plane built from Day 12 on follows this standard, in this session and every later one. A plane is **done** only when it passes every check below; until then `docs/PLANE_QUEUE.md` says how far it got, and its `docs/planes/<id>.md` page says what is still off.

The pipeline that implements it is `tools/blender/` (see "Pipeline" at the end). Planes that haven't been rebuilt yet keep their Day 11 model and show a **classic** tag in the hangar.

## 1. Accuracy

- **Dimensions:** length, wingspan and height within **2%** of the published figures (the plane's spec sheet: manufacturer data, a museum page or the Wikipedia infobox citing one).
- **Silhouettes:** render orthographic top, side and front silhouettes of the model and compare them with the reference three-view. Trace the reference's outline with OpenCV, align by length (top and side) or span (front), and compute the overlap (intersection over union). Pass: **IoU ≥ 0.90** top and side, **≥ 0.85** front. If no usable three-view exists, compare against photos and say so on the plane's page.
- **Real airfoils:** wing and tail sections are built from the documented root and tip airfoils (David Lednicer's "The Incomplete Guide to Airfoil Usage" for which airfoil; coordinates from the UIUC Airfoil Coordinates Database or generated exactly from the NACA equations), so the shape and the physics use the same data.

## 2. Separate moving parts

Each moving part is its own mesh, parented to a hinge empty on the real hinge line, rotating about the hinge axis, with minimum and maximum deflection and travel rate (degrees per second) recorded in the export.

- **Roll:** ailerons (left and right; both wings on biplanes), or spoilers, flaperons or differential tails where the real plane used them.
- **Pitch:** elevators (left and right) or all-moving stabilators.
- **Yaw:** rudder or rudders.
- **High lift:** flaps by type (split, plain, slotted, Fowler; Fowler flaps slide back and down along a track), with the real settings mapped to **Up / Combat / Takeoff / Landing**. Slats and leading-edge flaps where fitted.
- **Drag:** airbrakes and speedbrakes.
- **Landing gear:** each leg, wheel and door, with the real retraction path and order, including tailwheels and nose gear. Fixed gear is recorded as fixed.
- **Canopy** that slides or hinges open (or the open cockpit, recorded as such).
- **Propeller:** spinner plus separate blades that turn and change pitch, with a blur disc at high RPM. **Jets:** afterburner nozzle petals that open, and swing wings on variable-sweep planes.
- **Bomb bay doors** where fitted.

## 3. Breakable parts

Left and right outer wings, left and right inner wings, the tail section, each control surface, the engine and the fuel tanks are separate meshes with clean break edges, and each breakable has a **damaged-edge variant** (`<name>_damaged`: the same panel with a torn, blackened edge where it broke). On a biplane the "outer" wings are the upper panels and the "inner" wings the lower panels.

## 4. Cockpit

A simplified interior good enough for the cockpit view: seat, stick and rudder pedals that move with the controls, gunsight, and an instrument panel whose six main gauges work (airspeed, altitude, heading, RPM or thrust, G, fuel). One **cockpit kit per era**, adjusted per plane (panel width, seat height, stick type, sight). Jets get a **HUD glass** that shows the Day 11 HUD.

## 5. Detail levels

| Level | Used for | Triangles |
| --- | --- | --- |
| LOD0 | Your own plane, the hangar, close range | 40,000–80,000 (props), 60,000–120,000 (jets) |
| LOD1 | Middle distance | about 15,000 |
| LOD2 | Far | about 4,000 |
| LOD3 | Very far | under 1,000 |

Moving parts and team markings stay visible at every level (LOD3 keeps the control surfaces as separate nodes, just simpler). Switching between levels cross-fades, so nothing pops.

## 6. Surface detail and paint

- PBR textures at **2K** for LOD0: base colour, roughness, metalness, normal, ambient occlusion; compressed to **KTX2** (ETC1S for colour/AO/roughness/metalness, UASTC for the normal map).
- Panel lines and rivets baked into the normal map, following the reference drawings' panel layout (the plane's spec lists its panel lines and rivet rows).
- The historical camouflage or natural-metal finish per plane (its `paint` spec).
- Team identity stays: **red or blue team bands and a team roundel replace national insignia**, plus a squadron number decal. **No national insignia**, ever.

## 7. Export contract

One `.glb` per detail level plus `<id>.aero.json` holding everything the Day 13 flight model needs: masses if known, every lifting surface (span, area, chord distribution, sweep, dihedral, incidence, airfoil, position), every control surface (parent surface, chord and span fraction, hinge position and axis, limits, rate), flap settings, gear positions, engine and thrust-line position, and the centre-of-gravity range.

### Frame and units

Plane frame as in the game: **+Z forward (nose), +Y up, +X the left wing**, metres, origin at mid-fuselage (half the length from the nose). Degrees in the JSON.

### Node names

One scheme, so code can find any part by name:

| Node | What |
| --- | --- |
| `fuselage`, `fuselage_aft` | Fuselage (the aft part is the breakable "tail section", carrying the tail surfaces) |
| `wing_L_inner`, `wing_L_outer`, `wing_R_inner`, `wing_R_outer` | Monoplane wing panels (inner = root to the break, outer = break to tip) |
| `wing_L_upper`, `wing_L_lower`, `wing_R_upper`, `wing_R_lower`, `wing_C_upper` | Biplane panels and the upper centre section |
| `htail_L`, `htail_R`, `vtail` (`vtail_L`, `vtail_R` for twin fins) | Fixed tail surfaces |
| `hinge_<control>` | Empty on the hinge line; its local **+X is the hinge axis**; the control mesh is its child |
| `aileron_L`, `aileron_R` (biplanes: `aileron_L_upper`, `aileron_L_lower`, …) | Ailerons |
| `flaperon_L/R`, `spoiler_L/R` | Roll surfaces where fitted |
| `elevator_L/R` or `stabilator_L/R` | Pitch |
| `rudder` (`rudder_L/R`) | Yaw |
| `flap_L/R` (`flap_L_inner`, `flap_L_outer` when split in two) | Flaps |
| `slat_L/R`, `lef_L/R` | Slats, leading-edge flaps |
| `airbrake`, `airbrake_L/R`, `airbrake_<n>` | Airbrakes and speedbrakes |
| `gear_<leg>_strut`, `gear_<leg>_wheel`, `gear_<leg>_door_<n>` with `<leg>` = `nose`, `main_L`, `main_R`, `tail` | Landing gear (each strut and door on its own `hinge_` empty) |
| `canopy` (on `hinge_canopy` or `slide_canopy`) | Canopy |
| `prop` (spins about its local +Z), `spinner`, `pitch_blade_<n>` → `blade_<n>`, `prop_disc` | Propeller: blades turn about their own radial axis on the pitch empties |
| `nozzle_<n>`, `hinge_nozzle_<n>_petal_<k>` → `nozzle_<n>_petal_<k>` | Jet nozzles and petals |
| `bay_door_<n>` | Bomb bay doors |
| `engine`, `fuel_<name>` | Breakable engine and tanks |
| `<breakable>_damaged` | Damaged-edge variant (hidden until the part breaks) |
| `cockpit` → `seat`, `stick` (on `pivot_stick`), `pedal_L/R` (on `pivot_pedals`), `gunsight`, `panel`, `gauge_<name>` → `needle_<name>`, `hud_glass` | Cockpit |
| `eye`, `muzzle_<n>`, `pylon_<n>`, `exhaust_<n>`, `thrust_<n>` | Markers (empties) |

### Deflection sign

Each control in the JSON has a hinge point and a unit **axis**; a positive deflection is a right-hand rotation about that axis by that many degrees. The axes are chosen so that **positive = trailing edge down** for ailerons, elevators, stabilators, flaps, flaperons and spoilers (spoilers and airbrakes open with positive values), and **positive = trailing edge to the right** (nose right) for rudders. `minDeg` / `maxDeg` are in that sign. Ailerons and differential tails list each side; the game moves the left one `+δ` and the right one `−δ` for a roll right.

### `<id>.aero.json`

```json
{
  "id": "spitfire_mk5",
  "version": 1,
  "frame": "+Z forward, +Y up, +X left wing; metres; origin mid-fuselage",
  "dimensions": { "lengthM": 9.12, "wingspanM": 11.23, "heightM": 3.86 },
  "mass": { "emptyKg": 2309, "grossKg": 3078, "maxKg": 3071 },
  "cg": { "forwardM": [0, 0, 0.62], "aftM": [0, 0, 0.48], "macFraction": [0.25, 0.32] },
  "surfaces": [
    { "name": "wing_L_inner", "kind": "wing", "side": "L", "airfoilRoot": "NACA 2213", "airfoilTip": "NACA 2209.4",
      "spanM": 2.6, "areaM2": 6.1, "rootChordM": 2.51, "tipChordM": 2.2, "chordStations": [[0, 2.51], [0.5, 2.4], [1, 2.2]],
      "sweepDeg": 0, "dihedralDeg": 6, "incidenceDeg": 2, "twistDeg": -0.5, "rootM": [0.6, -0.55, 0.6], "tipM": [3.2, -0.28, 0.5] }
  ],
  "controls": [
    { "name": "aileron_L", "kind": "aileron", "parent": "wing_L_outer", "chordFraction": 0.2, "spanFraction": [0.55, 0.9],
      "hinge": [-3.1, 0.05, -0.4], "axis": [0.98, 0.02, 0.18], "minDeg": -19, "maxDeg": 26, "rateDegS": 80 },
    { "name": "flap_L", "kind": "flap", "type": "split", "parent": "wing_L_inner", "hinge": [], "axis": [], "minDeg": 0, "maxDeg": 85,
      "settings": { "up": 0, "combat": 0, "takeoff": 0, "landing": 85 }, "rateDegS": 40 }
  ],
  "gear": [ { "leg": "main_L", "type": "retractable", "parts": [], "sequence": [] } ],
  "canopy": { "type": "slide", "travelM": [0, 0.02, -0.55] },
  "engines": [ { "name": "engine", "type": "inline", "thrustLineM": [[0, 0.05, 4.4], [0, 0.05, 1]], "prop": { "blades": 3, "diameterM": 3.27, "pitchDeg": [20, 60] } } ],
  "lods": [ { "file": "spitfire_mk5.glb", "tris": 61000 } ],
  "sources": [ { "what": "dimensions", "ref": "..." } ]
}
```

Every number on a plane's page and in its JSON comes from a recorded source or is marked as an estimate there.

## 8. Budgets

- Each plane's full download (all LODs and textures) **≤ 10 MB**. The published site **≤ 900 MB**.
- Never commit a file over **50 MB**. If the repository nears **1 GB**, build models in GitHub Actions with a cache keyed on each plane's spec instead of committing `.glb` files.

## 9. Proof per plane

`docs/planes/<id>.md` with: sources, the spec sheet, IoU scores, triangle counts per LOD, file sizes, preview renders (front, side, top, three-quarter front and rear, each control surface, the flaps, the gear and the canopy at full deflection), and notes from a visual review against the references (what matches, what is still off).

## Research checklist per plane

Look up and record a source for each: dimensions; three-view drawings; wing and tail airfoils; control surface sizes and deflection limits; flap type and settings; slats; airbrakes; landing gear type and retraction; canopy type; engine and propeller or nozzle; gun and pylon positions; the historical paint scheme. Reference images go in `tools/blender/refs/` (gitignored, for comparison only, never shipped or committed). Downloads: free and official sources only (Wikimedia Commons, the UIUC airfoil database, Poly Haven CC0, PyPI, npm); **never any 3D models**.

## Pipeline

`tools/blender/` turns `tools/blender/planes/<id>/spec.json` into the model, step by step: blueprint setup (three-views as true-scale background images), fuselage lofted through 40+ stations fitted to the top and side outlines, wings and tails from airfoil coordinates, control surfaces cut on their hinge lines with gaps, builders for gear, canopy, propeller, nozzles, slats, airbrakes and swing wings, LOD0 small details as real geometry, panel lines / rivets / AO bakes and camouflage from the paint spec, automatic LODs, KTX2, the `.glb` and `.aero.json`, the checks, and the preview renders. `npm run models` rebuilds only planes whose spec changed and prints a summary table. See `tools/blender/README.md`.
