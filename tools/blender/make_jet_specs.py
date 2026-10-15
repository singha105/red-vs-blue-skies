"""Writes tools/blender/specs/<id>.json for the Day 7 jets (all Early Jets, Cold War and Modern planes except
the hand-written MiG-15bis and F-4E). Run with plain Python: python3 tools/blender/make_jet_specs.py

Dimensions are real metres (length and span from the spec sheets; chords, sweeps and fuselage sections are
sensible guesses read off general-arrangement drawings). Fuselage templates are scaled by each jet's maximum
width and height; everything else is per jet. Edit here and rerun, then `npm run models -- <id>`."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# Fuselage templates: (t, width, height, y) as fractions of the jet's max width W and height H (y × H).
POINTED = [(0, 0, 0, 0.0), (0.04, 0.3, 0.32, -0.02), (0.12, 0.6, 0.62, 0), (0.22, 0.8, 0.85, 0.03), (0.35, 0.95, 1.0, 0.04),
           (0.55, 1.0, 1.0, 0.04), (0.75, 0.92, 0.9, 0.04), (0.9, 0.78, 0.78, 0.04), (1.0, 0.66, 0.66, 0.04)]
NOSE_INTAKE = [(0, 0.72, 0.72, 0), (0.06, 0.86, 0.88, 0), (0.25, 1.0, 1.05, 0.04), (0.5, 1.0, 1.0, 0.04), (0.75, 0.82, 0.8, 0.04),
               (0.95, 0.62, 0.6, 0.04), (1.0, 0.56, 0.55, 0.04)]
TWIN = [(0, 0, 0, 0), (0.04, 0.2, 0.24, 0), (0.12, 0.38, 0.5, 0.04), (0.22, 0.46, 0.66, 0.08), (0.32, 0.7, 0.78, 0.06),
        (0.45, 1.0, 0.8, 0.0), (0.65, 1.0, 0.76, 0.0), (0.85, 0.96, 0.64, 0.0), (1.0, 0.9, 0.52, 0.0)]
DELTA = [(0, 0, 0, 0), (0.05, 0.3, 0.34, -0.02), (0.15, 0.6, 0.66, 0.02), (0.28, 0.82, 0.92, 0.05), (0.45, 1.0, 1.0, 0.04),
         (0.7, 0.96, 0.92, 0.02), (0.9, 0.8, 0.78, 0.02), (1.0, 0.7, 0.68, 0.02)]


def body(tpl, W, H, sides=10):
    return {"sides": sides, "sections": [[t, round(w * W, 3), round(h * H, 3), round(y * H, 3)] for t, w, h, y in tpl]}


US = {"body": "#8e979f", "camo": "#7f888f", "underside": "#b9c0c6", "teamBand": "aft_fuselage_wingtips_fin"}
NAVY = {"body": "#9aa2a9", "camo": "#8a939a", "underside": "#d6dade", "teamBand": "aft_fuselage_wingtips_fin"}
METAL = {"body": "#c3c7cb", "camo": "#b6bbc0", "underside": "#cdd1d5", "teamBand": "aft_fuselage_wingtips_fin"}
SOVIET = {"body": "#a7b3ba", "camo": "#8f9da5", "underside": "#c9d3d8", "teamBand": "aft_fuselage_wingtips_fin"}
RAF = {"body": "#6f7566", "camo": "#4f5a4b", "underside": "#b9c1c4", "teamBand": "aft_fuselage_wingtips_fin"}
FRENCH = {"body": "#8d959b", "camo": "#79838a", "underside": "#b4bcc1", "teamBand": "aft_fuselage_wingtips_fin"}
NATO = {"body": "#7f878e", "camo": "#6c757c", "underside": "#a9b1b7", "teamBand": "aft_fuselage_wingtips_fin"}
SEA = {"body": "#8a7d5a", "camo": "#56603e", "underside": "#cfd2cb", "teamBand": "aft_fuselage_wingtips_fin"}


def tail(stab_span, stab_root, stab_tip, stab_sweep, stab_pos, fin_h, fin_root, fin_tip, fin_sweep, fin_pos, **kw):
    t = {"type": kw.pop("type", "conventional"), "stabSpanM": stab_span,
         "stab": {"rootChordM": stab_root, "tipChordM": stab_tip, "sweepDeg": stab_sweep, "positionAlongLength": stab_pos},
         "finHeightM": fin_h, "fin": {"rootChordM": fin_root, "tipChordM": fin_tip, "sweepDeg": fin_sweep, "positionAlongLength": fin_pos}}
    for k in ("yM", "dihedralDeg", "mountFrac"):
        if k in kw:
            t["stab"][k] = kw.pop(k)
    t.update(kw)
    return t


def fin_only(fin_h, fin_root, fin_tip, fin_sweep, fin_pos):
    return tail(0.1, 0.1, 0.1, 0, 0.9, fin_h, fin_root, fin_tip, fin_sweep, fin_pos, type="fin_only")


def wing(root, tip, sweep, pos, mount="mid", dih=0, **kw):
    w = {"planform": "tapered", "rootChordM": root, "tipChordM": tip, "positionAlongLength": pos, "mount": mount,
         "sweepDeg": sweep, "dihedralDeg": dih, "thickness": kw.pop("thickness", 0.06)}
    w.update(kw)
    return w


def canopy(pos, ln, w, h, kind="teardrop", profile=None):
    c = {"type": kind, "positionAlongLength": pos, "lengthM": ln, "widthM": w, "heightM": h}
    if profile:
        c["profile"] = profile
    return c


def gun(t, x=0.0, y=-0.3, mount=0):
    return {"at": "fuselage", "t": t, "xM": x, "yOffsetM": y, "mount": mount}


def wpylon(*fracs, wi=0):
    return [{"at": "wing", "spanFraction": f, **({"wingIndex": wi} if wi else {})} for f in fracs]


def fpylon(t, x, y=None):
    p = {"at": "fuselage", "t": t, "xM": x}
    if y is not None:
        p["yOffsetM"] = y
    return p


def side(a, b, w, h, y=-0.05, taper=0.6):
    return {"type": "side_intakes", "fromT": a, "toT": b, "widthM": w, "heightM": h, "yOffsetM": y, "taperM": taper}


def chin(a, b, w, h, y=-0.15, taper=0.5):
    return {"type": "chin_intake", "fromT": a, "toT": b, "widthM": w, "heightM": h, "yOffsetM": y, "taperM": taper}


NOSE = {"type": "jet_nose_intake"}


def ex(r, x=0.0, ln=0.5, t=1.0, y=None):
    e = {"t": t, "radiusM": r, "lengthM": ln}
    if x:
        e["xM"] = x
    if y is not None:
        e["yM"] = y
    return e


def lerx(span, root, sweep, pos, tip=0.3):
    """Leading-edge root extensions and gloves: a second, very swept 'wing' along the fuselage."""
    return {"planform": "tapered", "spanM": span, "rootChordM": root, "tipChordM": tip, "positionAlongLength": pos,
            "mount": "mid", "sweepDeg": sweep, "dihedralDeg": 0, "thickness": 0.04}


def canard(span, root, tip, sweep, pos, mount="high"):
    return {"planform": "tapered", "spanM": span, "rootChordM": root, "tipChordM": tip, "positionAlongLength": pos,
            "mount": mount, "sweepDeg": sweep, "dihedralDeg": 0, "thickness": 0.05}


J = {}

# ---------------------------------------------------------------- Early jets
J["p80"] = dict(era="early_jets", lengthM=10.49, wingspanM=11.81, fuselage=body(POINTED, 1.35, 1.5),
                wing=wing(2.8, 1.25, 4, 0.38, "low", 4, thickness=0.1),
                tail=tail(5.0, 1.4, 0.8, 8, 0.82, 1.9, 2.0, 0.9, 35, 0.74),
                engine=side(0.3, 0.46, 0.38, 0.7, 0.0), exhausts=[ex(0.36)],
                pods=[{"xM": 5.85, "yM": -0.35, "fromT": 0.3, "toT": 0.58, "radiusM": 0.32, "endRadiusM": 0.12}],
                canopy=canopy(0.26, 1.7, 0.72, 0.55), guns=[gun(0.04, 0.2, -0.05)], pylons=[], colors=METAL)
J["vampire"] = dict(era="early_jets", lengthM=9.37, wingspanM=11.58,
                    fuselage={"sides": 10, "sections": [[0, 0, 0, 0], [0.05, 0.6, 0.7, 0], [0.15, 1.1, 1.2, 0.05], [0.3, 1.35, 1.45, 0.05], [0.45, 1.25, 1.3, 0.05], [0.56, 0.8, 0.85, 0.05]]},
                    wing=wing(2.9, 1.2, 6, 0.35, "mid", 3, thickness=0.11),
                    tail=tail(3.4, 1.2, 1.0, 0, 0.86, 1.4, 1.4, 0.8, 25, 0.85, type="twin_fin", finOffsetM=1.75, yM=0.2),
                    engine=side(0.33, 0.43, 0.3, 0.45, 0.0), exhausts=[ex(0.38, t=0.56)],
                    pods=[{"xM": 1.75, "yM": 0.0, "fromT": 0.4, "toT": 0.97, "radiusM": 0.2, "endRadiusM": 0.14, "sides": 6}],
                    canopy=canopy(0.2, 1.3, 0.7, 0.5), guns=[gun(0.12, 0.25, -0.55)], pylons=[], colors=RAF)
J["meteor_f8"] = dict(era="early_jets", lengthM=13.59, wingspanM=11.32, fuselage=body(POINTED, 1.4, 1.7),
                      wing=wing(3.6, 1.6, 5, 0.42, "mid", 4, thickness=0.12),
                      tail=tail(5.2, 1.6, 0.8, 10, 0.85, 2.2, 2.1, 1.0, 30, 0.82, yM=1.4),
                      engine={"type": "jet_nose_intake"},
                      pods=[{"xM": 2.3, "yM": 0.0, "fromT": 0.33, "toT": 0.62, "radiusM": 0.62, "endRadiusM": 0.42, "intake": True, "exhaust": True}],
                      canopy=canopy(0.2, 1.8, 0.75, 0.6), guns=[gun(0.12, 0.45, -0.3)], pylons=[], colors=RAF)
J["meteor_f8"]["engine"] = {"type": "inline_nose"}
J["f84g"] = dict(era="early_jets", lengthM=11.6, wingspanM=11.1, fuselage=body(NOSE_INTAKE, 1.55, 1.65),
                 wing=wing(3.0, 1.8, 4, 0.4, "low", 3, thickness=0.1),
                 tail=tail(4.6, 1.5, 0.9, 10, 0.84, 2.2, 2.4, 1.0, 38, 0.74),
                 engine=NOSE, exhausts=[ex(0.42)],
                 pods=[{"xM": 5.5, "yM": -0.2, "fromT": 0.32, "toT": 0.6, "radiusM": 0.3, "endRadiusM": 0.1}],
                 canopy=canopy(0.25, 1.9, 0.75, 0.6), guns=[gun(0.08, 0.5, 0.3)], pylons=[], colors=METAL)
J["f86f"] = dict(era="early_jets", lengthM=11.44, wingspanM=11.31, fuselage=body(NOSE_INTAKE, 1.45, 1.65),
                 wing=wing(3.0, 1.3, 35, 0.36, "low", 3, thickness=0.09),
                 tail=tail(3.8, 1.4, 0.7, 35, 0.83, 2.0, 2.5, 1.0, 45, 0.71),
                 engine=NOSE, exhausts=[ex(0.4)],
                 canopy=canopy(0.25, 1.9, 0.72, 0.6), guns=[gun(0.08, 0.55, 0.0)], pylons=[], colors=METAL)
J["mig17f"] = dict(era="early_jets", lengthM=11.26, wingspanM=9.63, fuselage=body(NOSE_INTAKE, 1.45, 1.6),
                   wing=wing(2.9, 1.2, 45, 0.34, "mid", -3, thickness=0.08),
                   tail=tail(3.1, 1.3, 0.6, 45, 0.84, 2.1, 2.6, 1.0, 55, 0.7, yM=1.6),
                   engine=NOSE, exhausts=[ex(0.4)],
                   canopy=canopy(0.27, 1.6, 0.7, 0.55), guns=[gun(0.1, 0.0, -0.6, 0), gun(0.12, 0.42, -0.52, 1)],
                   pylons=wpylon(0.45), colors=METAL)
J["hunter_f6"] = dict(era="early_jets", lengthM=13.98, wingspanM=10.26, fuselage=body(POINTED, 1.5, 1.7),
                      wing=wing(3.7, 1.3, 40, 0.36, "mid", -1, thickness=0.08),
                      tail=tail(3.9, 1.5, 0.7, 40, 0.84, 2.0, 2.8, 1.0, 45, 0.74, yM=0.9),
                      engine=side(0.34, 0.46, 0.35, 0.6, 0.0, 0.7), exhausts=[ex(0.45)],
                      canopy=canopy(0.2, 1.8, 0.72, 0.6), guns=[gun(0.16, 0.25, -0.6)], pylons=wpylon(0.5), colors=RAF)
J["mig19s"] = dict(era="early_jets", lengthM=12.54, wingspanM=9.0, fuselage=body(NOSE_INTAKE, 1.55, 1.7),
                   wing=wing(3.6, 1.2, 55, 0.36, "mid", -4, thickness=0.07),
                   tail=tail(3.6, 1.6, 0.6, 55, 0.84, 2.3, 3.2, 1.0, 55, 0.7, mountFrac=-0.2),
                   engine=NOSE, exhausts=[ex(0.35, 0.36)],
                   canopy=canopy(0.25, 1.6, 0.7, 0.55),
                   guns=[{"at": "wing", "spanFraction": 0.15, "mount": 0}, gun(0.14, 0.45, -0.5, 1)],
                   pylons=wpylon(0.6), colors=METAL)
J["f8"] = dict(era="early_jets", lengthM=16.53, wingspanM=10.87, fuselage=body(POINTED, 1.5, 1.65),
               wing=wing(4.0, 1.3, 42, 0.4, "high", -5, thickness=0.06),
               tail=tail(5.6, 2.0, 0.8, 45, 0.86, 2.6, 3.8, 1.2, 50, 0.73, mountFrac=-0.3),
               engine=chin(0.03, 0.34, 1.1, 0.7, -0.2), exhausts=[ex(0.5)],
               canopy=canopy(0.2, 2.2, 0.75, 0.6), guns=[gun(0.16, 0.62, -0.25)],
               pylons=[fpylon(0.3, 0.85, -0.2), fpylon(0.38, 0.85, -0.2)], colors=NAVY)

# ---------------------------------------------------------------- Cold War
J["mig21f13"] = dict(era="cold_war", lengthM=13.46, wingspanM=7.15, fuselage=body(NOSE_INTAKE, 1.25, 1.45),
                     wing=wing(5.4, 0.5, 57, 0.37, "mid", -2, thickness=0.05),
                     tail=tail(3.7, 1.6, 0.5, 57, 0.82, 2.2, 3.6, 1.0, 60, 0.67, mountFrac=-0.2),
                     engine=NOSE, exhausts=[ex(0.45)],
                     canopy=canopy(0.25, 1.9, 0.68, 0.5), guns=[gun(0.33, 0.35, -0.65)], pylons=wpylon(0.5), colors=METAL)
J["f104g"] = dict(era="cold_war", lengthM=16.66, wingspanM=6.36, fuselage=body(POINTED, 1.25, 1.35),
                  wing=wing(2.9, 1.1, 18, 0.48, "mid", -10, thickness=0.04),
                  tail=tail(3.6, 1.4, 0.8, 25, 0.84, 2.5, 3.6, 1.6, 45, 0.73, yM=3.0),
                  engine=side(0.36, 0.5, 0.45, 0.85, 0.0, 0.6), exhausts=[ex(0.48)],
                  canopy=canopy(0.21, 2.0, 0.66, 0.55, "framed"), guns=[gun(0.18, 0.45, -0.3)],
                  pylons=wpylon(0.98), colors=METAL)
J["mirage3e"] = dict(era="cold_war", lengthM=15.03, wingspanM=8.22, fuselage=body(DELTA, 1.4, 1.55),
                     wing=wing(7.6, 0.6, 60, 0.41, "low", -1, thickness=0.045),
                     tail=fin_only(2.6, 4.4, 1.0, 58, 0.62),
                     engine=side(0.3, 0.5, 0.6, 1.0, 0.0, 0.5), exhausts=[ex(0.5)],
                     canopy=canopy(0.22, 2.0, 0.7, 0.55, "framed"), guns=[gun(0.33, 0.55, -0.55)],
                     pylons=wpylon(0.65), colors=FRENCH)
J["f5e"] = dict(era="cold_war", lengthM=14.45, wingspanM=8.13, fuselage=body(POINTED, 1.4, 1.3),
                wing=wing(3.6, 0.7, 32, 0.48, "low", 0, thickness=0.05),
                tail=tail(4.3, 1.6, 0.6, 30, 0.86, 2.2, 3.2, 1.0, 45, 0.73),
                engine=side(0.33, 0.52, 0.5, 0.8, 0.0, 0.5), exhausts=[ex(0.33, 0.4)],
                canopy=canopy(0.21, 2.0, 0.7, 0.55), guns=[gun(0.07, 0.25, 0.2)], pylons=wpylon(0.98), colors=US)
J["mig23mld"] = dict(era="cold_war", lengthM=16.7, wingspanM=11.0, fuselage=body(POINTED, 1.5, 1.6),
                     wing=[wing(4.0, 1.4, 47, 0.42, "high", -3, thickness=0.05), lerx(5.4, 5.0, 64, 0.35, 2.4)],
                     tail=tail(5.6, 2.6, 0.8, 57, 0.86, 2.9, 5.0, 1.2, 60, 0.67),
                     engine=side(0.24, 0.5, 0.8, 1.3, -0.05, 0.6), exhausts=[ex(0.55)],
                     canopy=canopy(0.21, 2.0, 0.72, 0.55, "framed"), guns=[gun(0.45, 0.0, -0.85)],
                     pylons=[fpylon(0.45, 1.25, -0.8)] + wpylon(0.9, wi=1), colors=SOVIET)
J["mirage_f1c"] = dict(era="cold_war", lengthM=15.3, wingspanM=8.4, fuselage=body(POINTED, 1.5, 1.6),
                       wing=wing(3.6, 1.1, 47, 0.44, "high", -5, thickness=0.05),
                       tail=tail(5.0, 2.2, 0.8, 50, 0.85, 2.5, 3.8, 1.1, 55, 0.7, mountFrac=-0.3),
                       engine=side(0.3, 0.5, 0.6, 1.1, 0.0, 0.5), exhausts=[ex(0.5)],
                       canopy=canopy(0.21, 2.0, 0.7, 0.55, "framed"), guns=[gun(0.28, 0.5, -0.6)],
                       pylons=wpylon(0.98) + [fpylon(0.5, 0.6, -0.85)], colors=FRENCH)
J["f14a"] = dict(era="cold_war", lengthM=19.1, wingspanM=16.0, fuselage=body(TWIN, 3.5, 1.7),
                 wing=[wing(3.6, 1.4, 40, 0.5, "high", 0, thickness=0.05, spanM=16.0), lerx(6.4, 7.5, 68, 0.33, 3.6)],
                 tail=tail(9.9, 3.0, 1.0, 50, 0.82, 3.0, 3.8, 1.4, 50, 0.73, type="twin_fin", finOffsetM=1.55, finCantDeg=5),
                 engine=side(0.3, 0.6, 1.0, 1.25, -0.05, 0.85), exhausts=[ex(0.58, 1.3)],
                 canopy=canopy(0.18, 3.6, 0.85, 0.7, "framed", [0.3, 0.9, 1.0, 1.0, 0.95, 0.5]),
                 guns=[gun(0.12, 0.45, -0.1)],
                 pylons=[fpylon(0.4, 0.6, -0.9), fpylon(0.58, 0.6, -0.9)] + wpylon(0.75, wi=1), colors=NAVY)
J["f16a"] = dict(era="cold_war", lengthM=15.03, wingspanM=9.96, fuselage=body(POINTED, 1.3, 1.4),
                 wing=[wing(4.8, 1.1, 40, 0.46, "mid", 0, thickness=0.04), lerx(2.9, 4.2, 75, 0.3, 0.3)],
                 tail=tail(5.6, 2.4, 0.8, 40, 0.86, 2.6, 3.4, 1.2, 47, 0.71, dihedralDeg=-10),
                 engine=chin(0.24, 0.55, 1.0, 0.85, -0.15), exhausts=[ex(0.5)],
                 canopy=canopy(0.2, 2.6, 0.75, 0.62), guns=[gun(0.24, 0.62, 0.35)],
                 pylons=wpylon(1.0, 0.62), colors=US)
J["f15a"] = dict(era="cold_war", lengthM=19.43, wingspanM=13.05, fuselage=body(TWIN, 2.9, 1.7),
                 wing=wing(6.0, 1.6, 45, 0.48, "high", -1, thickness=0.05),
                 tail=tail(8.6, 3.0, 1.1, 50, 0.86, 3.0, 3.5, 1.3, 45, 0.73, type="twin_fin", finOffsetM=1.4),
                 engine=side(0.27, 0.55, 1.1, 1.5, 0.05, 0.75), exhausts=[ex(0.55, 0.62)],
                 canopy=canopy(0.18, 3.0, 0.82, 0.7), guns=[gun(0.45, 1.6, 0.4)],
                 pylons=[fpylon(0.42, 1.5, -0.95), fpylon(0.58, 1.5, -0.95)] + wpylon(0.4), colors=US)

# ---------------------------------------------------------------- Modern
J["mig29a"] = dict(era="modern", lengthM=17.32, wingspanM=11.36, fuselage=body(TWIN, 2.4, 1.45),
                   wing=[wing(5.3, 1.3, 42, 0.5, "mid", -2, thickness=0.05), lerx(3.6, 6.0, 74, 0.3)],
                   tail=tail(7.8, 2.6, 0.9, 45, 0.85, 2.6, 3.0, 1.2, 47, 0.74, type="twin_fin", finOffsetM=1.45, finCantDeg=6),
                   engine=side(0.32, 0.58, 0.9, 0.9, -0.6, 0.8), exhausts=[ex(0.48, 0.75)],
                   canopy=canopy(0.17, 2.4, 0.75, 0.62), guns=[gun(0.3, 0.9, 0.15)],
                   pylons=wpylon(0.35, 0.55, 0.75), colors=SOVIET)
J["mirage2000_5"] = dict(era="modern", lengthM=14.36, wingspanM=9.13, fuselage=body(DELTA, 1.45, 1.6),
                         wing=wing(7.4, 0.6, 58, 0.41, "low", -1, thickness=0.045),
                         tail=fin_only(2.7, 4.0, 1.0, 55, 0.64),
                         engine=side(0.3, 0.5, 0.6, 1.0, 0.0, 0.5), exhausts=[ex(0.5)],
                         canopy=canopy(0.21, 2.2, 0.72, 0.6), guns=[gun(0.36, 0.5, -0.6)],
                         pylons=wpylon(0.45, 0.75) + [fpylon(0.55, 0.5, -0.9)], colors=FRENCH)
J["fa18c"] = dict(era="modern", lengthM=17.1, wingspanM=12.3, fuselage=body(POINTED, 1.8, 1.6),
                  wing=[wing(4.6, 1.6, 26, 0.5, "mid", -3, thickness=0.05), lerx(3.2, 7.0, 78, 0.22)],
                  tail=tail(6.6, 2.6, 1.0, 40, 0.86, 2.8, 3.0, 1.3, 40, 0.68, type="twin_fin", finOffsetM=1.3, finCantDeg=20),
                  engine=side(0.38, 0.6, 0.8, 0.9, -0.6, 0.8), exhausts=[ex(0.45, 0.55)],
                  canopy=canopy(0.16, 2.6, 0.75, 0.62), guns=[gun(0.04, 0.0, 0.35)],
                  pylons=wpylon(1.0) + [fpylon(0.45, 0.9, -0.85)], colors=NAVY)
J["f16c_b50"] = json.loads(json.dumps(J["f16a"]))
J["f16c_b50"].update(era="modern", colors={"body": "#7c838a", "camo": "#6a7178", "underside": "#959ca2", "teamBand": "aft_fuselage_wingtips_fin"})
J["jas39c"] = dict(era="modern", lengthM=14.1, wingspanM=8.4, fuselage=body(POINTED, 1.4, 1.5),
                   wing=[wing(5.4, 0.8, 50, 0.45, "mid", -1, thickness=0.045), canard(3.6, 1.6, 0.7, 45, 0.26)],
                   tail=fin_only(2.4, 3.2, 1.0, 50, 0.68),
                   engine=side(0.27, 0.46, 0.55, 0.9, 0.0, 0.6), exhausts=[ex(0.42)],
                   canopy=canopy(0.17, 2.2, 0.72, 0.6), guns=[gun(0.4, 0.55, -0.5)],
                   pylons=wpylon(1.0, 0.6), colors=NATO)
J["su27s"] = dict(era="modern", lengthM=21.94, wingspanM=14.7, fuselage=body(TWIN, 2.8, 1.55),
                  wing=[wing(6.0, 1.3, 42, 0.5, "mid", -2, thickness=0.05), lerx(4.0, 7.0, 76, 0.3)],
                  tail=tail(9.9, 3.0, 1.0, 45, 0.85, 3.0, 3.4, 1.3, 45, 0.74, type="twin_fin", finOffsetM=2.0),
                  engine=side(0.32, 0.6, 1.1, 1.1, -0.7, 0.8), exhausts=[ex(0.55, 1.0)],
                  canopy=canopy(0.15, 2.6, 0.8, 0.68), guns=[gun(0.3, 1.0, 0.2)],
                  pylons=wpylon(0.35, 0.6, 0.98) + [fpylon(0.45, 0.6, -0.95)], colors=SOVIET)
J["f15c"] = json.loads(json.dumps(J["f15a"]))
J["f15c"].update(era="modern", colors={"body": "#8a939b", "camo": "#727c85", "underside": "#a3abb2", "teamBand": "aft_fuselage_wingtips_fin"})
J["rafale_c"] = dict(era="modern", lengthM=15.27, wingspanM=10.8, fuselage=body(POINTED, 1.6, 1.55),
                     wing=[wing(7.0, 1.0, 48, 0.45, "low", 0, thickness=0.045), canard(4.0, 1.6, 0.6, 45, 0.3)],
                     tail=fin_only(2.6, 3.8, 1.0, 50, 0.66),
                     engine=side(0.3, 0.5, 0.7, 0.9, -0.5, 0.7), exhausts=[ex(0.4, 0.5)],
                     canopy=canopy(0.17, 2.4, 0.72, 0.62), guns=[gun(0.4, 0.75, -0.3)],
                     pylons=wpylon(0.5, 1.0) + [fpylon(0.55, 0.6, -0.85)], colors=FRENCH)
J["typhoon"] = dict(era="modern", lengthM=15.96, wingspanM=10.95, fuselage=body(POINTED, 1.6, 1.6),
                    wing=[wing(6.5, 1.0, 53, 0.48, "low", 0, thickness=0.045), canard(4.0, 1.3, 0.5, 50, 0.18, "mid")],
                    tail=fin_only(2.9, 3.8, 1.2, 50, 0.68),
                    engine=chin(0.27, 0.55, 1.2, 0.8, -0.15), exhausts=[ex(0.45, 0.5)],
                    canopy=canopy(0.14, 2.4, 0.72, 0.62), guns=[gun(0.4, 0.7, -0.3)],
                    pylons=[fpylon(0.45, 0.65, -0.85), fpylon(0.6, 0.65, -0.85)] + wpylon(0.75), colors=NATO)
J["f22a"] = dict(era="modern", lengthM=18.92, wingspanM=13.56, fuselage=body(TWIN, 2.6, 1.45),
                 wing=wing(7.5, 1.2, 42, 0.5, "mid", -3, thickness=0.04),
                 tail=tail(8.8, 3.3, 1.3, 42, 0.86, 2.9, 3.6, 1.4, 42, 0.68, type="twin_fin", finOffsetM=1.5, finCantDeg=28),
                 engine=side(0.26, 0.55, 1.0, 1.2, 0.0, 0.7), exhausts=[ex(0.5, 0.6)],
                 canopy=canopy(0.15, 3.0, 0.8, 0.65), guns=[gun(0.3, 1.1, 0.3)],
                 pylons=[fpylon(0.42, 0.6, -0.8), fpylon(0.55, 0.6, -0.8), fpylon(0.36, 1.25, -0.6)], colors=NATO)


def main():
    out = os.path.join(HERE, "specs")
    for pid, spec in J.items():
        spec = {"id": pid, **spec}
        spec.setdefault("pylons", [])
        with open(os.path.join(out, f"{pid}.json"), "w") as f:
            json.dump(spec, f, indent=2)
            f.write("\n")
    print(f"wrote {len(J)} specs")


if __name__ == "__main__":
    main()
