"""Writes tools/blender/specs/<id>.json for the Day 9 propeller planes (every WW1, Early WW2 and Late WW2 plane
except the hand-written Sopwith Camel, Fokker Dr.I, Spitfire Mk V and F4U-4) and the three AI bombers.
Run with plain Python: python3 tools/blender/make_prop_specs.py

Length and span are real metres from the spec sheets; chords, gaps, sweeps and fuselage sections are sensible
guesses read off general-arrangement drawings. Edit here and rerun, then `npm run models -- <id>`."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# Fuselage templates: (t, width, height, y) as fractions of the plane's max width W and height H (y × H).
INLINE = [(0, 0.56, 0.49, 0), (0.09, 0.82, 0.72, 0), (0.26, 1.0, 0.93, 0.04), (0.43, 0.96, 1.0, 0.06), (0.6, 0.71, 0.78, 0.07),
          (0.8, 0.44, 0.53, 0.1), (0.95, 0.2, 0.32, 0.15), (1.0, 0.07, 0.15, 0.16)]
RADIAL = [(0, 0.92, 0.84, 0), (0.1, 1.0, 0.92, 0), (0.32, 0.94, 1.0, 0.04), (0.52, 0.8, 0.97, 0.08), (0.72, 0.55, 0.72, 0.12),
          (0.9, 0.27, 0.43, 0.17), (1.0, 0.08, 0.19, 0.19)]
STUBBY = [(0, 0.95, 0.88, 0), (0.12, 1.0, 0.95, 0), (0.35, 0.92, 1.0, 0.05), (0.6, 0.66, 0.82, 0.1), (0.85, 0.32, 0.5, 0.16),
          (1.0, 0.1, 0.22, 0.2)]
WW1_ROTARY = [(0, 1.0, 0.96, 0), (0.13, 0.93, 1.0, 0), (0.36, 0.87, 1.0, 0.02), (0.55, 0.64, 0.83, 0.05), (0.8, 0.33, 0.48, 0.11),
              (1.0, 0.07, 0.17, 0.13)]
WW1_INLINE = [(0, 0.8, 0.85, 0), (0.12, 1.0, 1.0, 0), (0.35, 0.95, 1.0, 0.02), (0.55, 0.7, 0.82, 0.05), (0.8, 0.36, 0.5, 0.1),
              (1.0, 0.07, 0.18, 0.13)]
SHARK = [(0, 0.4, 0.45, 0), (0.08, 0.85, 0.9, 0), (0.3, 1.0, 1.0, 0), (0.55, 0.7, 0.82, 0.04), (0.8, 0.35, 0.5, 0.1),
         (1.0, 0.06, 0.16, 0.12)]
JET_PROP = [(0, 0, 0, 0), (0.04, 0.4, 0.42, -0.02), (0.14, 0.75, 0.8, 0), (0.3, 0.95, 1.0, 0.03), (0.5, 1.0, 0.95, 0.03),
            (0.75, 0.6, 0.7, 0.08), (0.92, 0.25, 0.4, 0.14), (1.0, 0.08, 0.2, 0.16)]
BOMBER = [(0, 0.45, 0.5, -0.05), (0.06, 0.82, 0.86, 0), (0.18, 1.0, 1.0, 0), (0.55, 0.95, 0.95, 0.02), (0.8, 0.55, 0.6, 0.12),
          (1.0, 0.12, 0.2, 0.22)]


def body(tpl, W, H, sides=8):
    return {"sides": sides, "sections": [[t, round(w * W, 3), round(h * H, 3), round(y * H, 3)] for t, w, h, y in tpl]}


# Colours: body, camo patches, underside. Team paint (red/blue in game) per the preset.
RFC = {"body": "#5f5a3c", "camo": "#5f5a3c", "underside": "#d8cfae", "teamBand": ["fuselage_band", "wingtips", "cowl"]}
FRENCH_WW1 = {"body": "#b9b6a6", "camo": "#a9a593", "underside": "#cfccbd", "teamBand": ["fuselage_band", "wingtips", "cowl"]}
SPAD = {"body": "#7a6f4b", "camo": "#5d6340", "underside": "#cfc7a4", "teamBand": ["fuselage_band", "wingtips", "nose"]}
LINEN = {"body": "#c9b98f", "camo": "#b8a87f", "underside": "#d6c9a2", "teamBand": ["fuselage_band", "wingtips", "cowl"]}
ALBATROS = {"body": "#a8814f", "camo": "#a8814f", "underside": "#b8c8d0", "wing": "#5d6a3e", "teamBand": ["fuselage_band", "wingtips", "nose"]}
LOZENGE = {"body": "#5d5470", "camo": "#4f5a3e", "underside": "#8f8aa6", "teamBand": ["fuselage_band", "wingtips", "nose"]}
USAAC = {"body": "#3d5a78", "camo": "#3d5a78", "underside": "#3d5a78", "wing": "#d9b43c", "teamBand": ["fuselage_band", "fin"]}
RAF = {"body": "#6b5a3c", "camo": "#4a5a3a", "underside": "#b9c1c4", "teamBand": "aft_fuselage_and_wingtips"}
ITALY = {"body": "#b8a76a", "camo": "#5f6b3b", "underside": "#b9bfbf", "teamBand": "aft_fuselage_and_wingtips"}
VVS = {"body": "#56653a", "camo": "#3f4b2c", "underside": "#a9c0cf", "teamBand": "aft_fuselage_wingtips_fin"}
VVS_GREY = {"body": "#8a9096", "camo": "#6b7076", "underside": "#b4c6d4", "teamBand": "aft_fuselage_wingtips_fin"}
USAAF_OD = {"body": "#5a5a3c", "camo": "#5a5a3c", "underside": "#9a9a96", "teamBand": "aft_fuselage_wingtips_fin"}
METAL = {"body": "#c3c7cb", "camo": "#b6bbc0", "underside": "#cdd1d5", "teamBand": "aft_fuselage_wingtips_fin"}
NAVY = {"body": "#1d2c4c", "camo": "#1d2c4c", "underside": "#22355a", "teamBand": "aft_fuselage_wingtips_fin"}
IJN = {"body": "#b5b59a", "camo": "#a9a98e", "underside": "#c2c2aa", "teamBand": "aft_fuselage_wingtips_fin"}
LW_GREEN = {"body": "#4b5a3c", "camo": "#3c4a33", "underside": "#a8bccc", "teamBand": "aft_fuselage_wingtips_fin"}
LW_GREY = {"body": "#6f747a", "camo": "#585d63", "underside": "#a9b8c4", "teamBand": "aft_fuselage_wingtips_fin"}
LW_JET = {"body": "#5f6648", "camo": "#4a5a3a", "underside": "#a9b8c4", "teamBand": "aft_fuselage_wingtips_fin"}
BOMBER_COL = {"body": "#6d7154", "camo": "#5a5f44", "underside": "#9fa8ad", "teamBand": "aft_fuselage_wingtips_fin"}
BOMBER_JET = {"body": "#b9bec3", "camo": "#aeb3b8", "underside": "#d2d6da", "teamBand": "aft_fuselage_wingtips_fin"}


def tail(stab_span, stab_root, stab_tip, stab_sweep, stab_pos, fin_h, fin_root, fin_tip, fin_sweep, fin_pos, **kw):
    t = {"type": kw.pop("type", "conventional"), "stabSpanM": stab_span,
         "stab": {"rootChordM": stab_root, "tipChordM": stab_tip, "sweepDeg": stab_sweep, "positionAlongLength": stab_pos},
         "finHeightM": fin_h, "fin": {"rootChordM": fin_root, "tipChordM": fin_tip, "sweepDeg": fin_sweep, "positionAlongLength": fin_pos}}
    for k in ("yM", "dihedralDeg", "mountFrac"):
        if k in kw:
            t["stab"][k] = kw.pop(k)
    t.update(kw)
    return t


def mono(root, tip, pos, mount="low", dih=5, sweep=0, plan="tapered", thickness=0.13, **kw):
    w = {"planform": plan, "rootChordM": root, "tipChordM": tip, "positionAlongLength": pos, "mount": mount,
         "sweepDeg": sweep, "dihedralDeg": dih, "thickness": thickness}
    w.update(kw)
    return w


def bi(span, root, tip, pos, y, dih=0, sweep=0, thickness=0.08):
    """One plane of a biplane: explicit span and height (yM)."""
    return {"spanM": span, "planform": "tapered", "rootChordM": root, "tipChordM": tip, "positionAlongLength": pos,
            "yM": y, "dihedralDeg": dih, "sweepDeg": sweep, "thickness": thickness}


def radial(dia, ln, blades, prop, spinner=True, sd=0.45, sl=0.4, off=0.15):
    e = {"type": "radial_cowl", "cowlDiameterM": dia, "cowlLengthM": ln, "propBlades": blades, "propDiameterM": prop,
         "spinner": spinner, "propOffsetM": off}
    if spinner:
        e.update(spinnerDiameterM=sd, spinnerLengthM=sl)
    return e


def inline(blades, prop, sd=0.5, sl=0.6, off=0.2, spinner=True):
    e = {"type": "inline_nose", "propBlades": blades, "propDiameterM": prop, "spinner": spinner, "propOffsetM": off}
    if spinner:
        e.update(spinnerDiameterM=sd, spinnerLengthM=sl)
    return e


def canopy(pos, ln, w, h=0.5, kind="teardrop", profile=None):
    c = {"type": kind, "positionAlongLength": pos, "lengthM": ln, "widthM": w, "heightM": h}
    if profile:
        c["profile"] = profile
    return c


def open_cockpit(pos, ln=0.8, w=0.55):
    return {"type": "open", "positionAlongLength": pos, "lengthM": ln, "widthM": w}


def fgun(t, x=0.0, y=None, mount=0, z=0.2):
    g = {"at": "fuselage", "t": t, "xM": x, "mount": mount, "zOffsetM": z}
    if y is not None:
        g["yOffsetM"] = y
    return g


def wgun(frac, mount=0, wi=0):
    g = {"at": "wing", "spanFraction": frac, "mount": mount}
    if wi:
        g["wingIndex"] = wi
    return g


def wpylon(*fracs, wi=0):
    return [{"at": "wing", "spanFraction": f, **({"wingIndex": wi} if wi else {})} for f in fracs]


def gear(t, track, height, wheel=0.66, **kw):
    g = {"t": t, "trackM": track, "heightM": height, "wheelM": wheel}
    g.update(kw)
    return g


def scoop(a, b, w, h, y=-0.05, taper=0.6):
    return {"fromT": a, "toT": b, "widthM": w, "heightM": h, "yOffsetM": y, "taperM": taper}


def struts(*fracs, cabane=True):
    return {"spanFractions": list(fracs), "cabane": cabane}


P = {}

# ---------------------------------------------------------------- WW1
P["fokker_e3"] = dict(era="ww1", lengthM=7.2, wingspanM=9.52, fuselage=body(WW1_ROTARY, 0.75, 0.95),
                      wing=mono(1.8, 1.8, 0.2, "high", 0, thickness=0.07, yM=0.42),
                      tail=tail(3.1, 1.0, 0.6, 20, 0.86, 1.0, 0.9, 0.6, 10, 0.88),
                      engine=radial(0.95, 0.45, 2, 2.6, spinner=False, off=0.12),
                      canopy=open_cockpit(0.36), gear=gear(0.14, 1.7, 1.0, 0.68),
                      struts={"spanFractions": [], "cabane": False},
                      guns=[fgun(0.12, 0.0, 0.58)], colors=LINEN)
# Wire-braced monoplane: a pylon above the cockpit carries the bracing wires; one box stands in for it.
P["fokker_e3"]["hump"] = {"fromT": 0.26, "toT": 0.3, "widthM": 0.12, "heightM": 0.75}
P["airco_dh2"] = dict(era="ww1", lengthM=7.68, wingspanM=8.61,
                      fuselage={"sides": 8, "sections": [[0.0, 0.5, 0.6, 0.0], [0.08, 0.72, 0.86, 0.0], [0.24, 0.76, 0.9, 0.04],
                                                         [0.36, 0.6, 0.7, 0.06], [0.42, 0.0, 0.0, 0.06]]},
                      wing=[bi(8.61, 1.45, 1.45, 0.28, 1.15, 2), bi(8.61, 1.45, 1.45, 0.3, -0.45, 2)],
                      struts=struts(0.42, 0.85, cabane=False),
                      tail=tail(2.6, 1.0, 0.95, 0, 0.84, 1.1, 0.9, 0.7, 5, 0.86, yM=0.25),
                      engine={"type": "rotary", "propBlades": 4, "propDiameterM": 2.6, "spinner": False, "propOffsetM": 0.2,
                              "pusher": True},
                      pods=[{"xM": 1.35, "xEndM": 0.25, "yM": 0.55, "yEndM": 0.25, "fromT": 0.36, "toT": 0.9, "radiusM": 0.05,
                             "endRadiusM": 0.04, "sides": 4},
                            {"xM": 1.35, "xEndM": 0.25, "yM": -0.4, "yEndM": 0.2, "fromT": 0.38, "toT": 0.9, "radiusM": 0.05,
                             "endRadiusM": 0.04, "sides": 4}],
                      canopy=open_cockpit(0.16, 0.7, 0.5), gear=gear(0.2, 1.7, 0.95, 0.68, tailSkid=False),
                      guns=[fgun(0.01, 0.0, 0.25, z=0.1)], colors=dict(RFC, teamBand=["fuselage_band", "wingtips", "nose"]))
P["airco_dh2"]["fuselage"]["teamBand"] = [0.22, 0.3]
P["nieuport_11"] = dict(era="ww1", lengthM=5.8, wingspanM=7.55, fuselage=body(WW1_ROTARY, 0.72, 0.9),
                        wing=[bi(7.55, 1.2, 1.15, 0.17, 1.0, 0, 3), bi(7.4, 0.7, 0.55, 0.22, -0.4, 4, 3)],
                        struts=struts(0.62), tail=tail(2.5, 0.9, 0.55, 15, 0.86, 0.85, 0.8, 0.6, 30, 0.86),
                        engine=radial(0.9, 0.45, 2, 2.4, spinner=False, off=0.12),
                        canopy=open_cockpit(0.4), gear=gear(0.15, 1.6, 0.9, 0.62),
                        guns=[fgun(0.22, 0.0, 1.0, z=0.4)], colors=FRENCH_WW1)
P["sopwith_pup"] = dict(era="ww1", lengthM=5.89, wingspanM=8.08, fuselage=body(WW1_ROTARY, 0.8, 0.95),
                        wing=[bi(8.08, 1.56, 1.5, 0.15, 1.05, 0), bi(8.08, 1.56, 1.5, 0.2, -0.42, 3)],
                        struts=struts(0.62), tail=tail(3.0, 1.0, 0.75, 0, 0.84, 0.85, 0.85, 0.5, 30, 0.85),
                        engine=radial(0.95, 0.55, 2, 2.6, spinner=False, off=0.12),
                        canopy=open_cockpit(0.42), gear=gear(0.14, 1.6, 0.92, 0.66),
                        guns=[fgun(0.15, 0.0, 0.62)], colors=RFC)
P["albatros_d3"] = dict(era="ww1", lengthM=7.33, wingspanM=9.0, fuselage=body(SHARK, 0.9, 1.05),
                        wing=[bi(9.0, 1.7, 1.5, 0.17, 1.05, 0, 3), bi(8.73, 1.1, 0.75, 0.24, -0.45, 2, 3)],
                        struts=struts(0.6), tail=tail(2.9, 1.0, 0.55, 25, 0.86, 1.0, 1.0, 0.55, 30, 0.87),
                        engine=inline(2, 2.7, sd=0.4, sl=0.35, off=0.1),
                        canopy=open_cockpit(0.4), gear=gear(0.16, 1.7, 0.95, 0.7),
                        guns=[fgun(0.15, 0.12, 0.62)], colors=ALBATROS)
P["se5a"] = dict(era="ww1", lengthM=6.38, wingspanM=8.11, fuselage=body(WW1_INLINE, 0.85, 1.05),
                 wing=[bi(8.11, 1.55, 1.5, 0.2, 1.05, 5), bi(8.11, 1.55, 1.5, 0.24, -0.45, 5)],
                 struts=struts(0.42, 0.82), tail=tail(3.2, 1.0, 0.7, 0, 0.85, 0.9, 0.9, 0.6, 25, 0.86),
                 engine=inline(2, 2.4, spinner=False, off=0.12),
                 canopy=open_cockpit(0.42), gear=gear(0.17, 1.6, 0.95, 0.68),
                 guns=[fgun(0.14, 0.15, 0.58), fgun(0.32, 0.0, 1.32, z=0.5)], colors=RFC)
P["spad_s13"] = dict(era="ww1", lengthM=6.25, wingspanM=8.25, fuselage=body(WW1_INLINE, 0.85, 1.05),
                     wing=[bi(8.25, 1.4, 1.4, 0.18, 1.05, 0), bi(7.8, 1.4, 1.4, 0.2, -0.45, 2)],
                     struts=struts(0.4, 0.75), tail=tail(3.0, 0.95, 0.75, 0, 0.85, 0.95, 1.0, 0.6, 25, 0.86),
                     engine=inline(2, 2.5, spinner=False, off=0.12),
                     canopy=open_cockpit(0.42), gear=gear(0.16, 1.6, 0.95, 0.68),
                     guns=[fgun(0.14, 0.13, 0.6)], colors=SPAD)
P["fokker_d7"] = dict(era="ww1", lengthM=6.95, wingspanM=8.9, fuselage=body(WW1_INLINE, 0.85, 1.05),
                      wing=[bi(8.9, 1.6, 1.4, 0.18, 1.1, 0, thickness=0.13), bi(7.0, 1.4, 1.2, 0.22, -0.45, 0, thickness=0.13)],
                      struts=struts(0.68), tail=tail(3.0, 1.0, 0.7, 10, 0.86, 1.0, 1.0, 0.55, 35, 0.86),
                      engine=inline(2, 2.8, spinner=False, off=0.12),
                      canopy=open_cockpit(0.42), gear=gear(0.14, 1.7, 1.0, 0.72),
                      guns=[fgun(0.14, 0.12, 0.6)], colors=LOZENGE)

# ---------------------------------------------------------------- Early WW2
P["p26"] = dict(era="early_ww2", lengthM=7.18, wingspanM=8.5, fuselage=body(RADIAL, 1.05, 1.25),
                wing=mono(1.9, 1.3, 0.22, "low", 6, thickness=0.12),
                tail=tail(3.0, 1.0, 0.6, 5, 0.85, 1.05, 1.0, 0.6, 20, 0.85),
                engine=radial(1.15, 0.6, 2, 2.6, spinner=False, off=0.15),
                canopy=open_cockpit(0.48, 0.8, 0.6), gear=gear(0.2, 1.8, 0.62, 0.7, spats=True, rootXM=0.9, rootYM=-0.45),
                guns=[fgun(0.12, 0.25, 0.25, 0), fgun(0.12, 0.25, 0.25, 1)], colors=USAAC)
P["gladiator"] = dict(era="early_ww2", lengthM=8.36, wingspanM=9.83, fuselage=body(RADIAL, 1.0, 1.35),
                      wing=[bi(9.83, 1.95, 1.7, 0.18, 1.15, 3), bi(9.5, 1.95, 1.7, 0.2, -0.55, 4)],
                      struts=struts(0.66), tail=tail(3.4, 1.15, 0.7, 10, 0.85, 1.15, 1.15, 0.6, 25, 0.85),
                      engine=radial(1.2, 0.75, 2, 3.2, spinner=False, off=0.15),
                      canopy=canopy(0.4, 1.3, 0.62, 0.45, "framed"), gear=gear(0.18, 2.0, 1.1, 0.7),
                      guns=[fgun(0.14, 0.4, -0.2), wgun(0.42, 0, 1)], colors=RAF)
P["cr42"] = dict(era="early_ww2", lengthM=8.25, wingspanM=9.7, fuselage=body(RADIAL, 1.0, 1.35),
                 wing=[bi(9.7, 1.8, 1.4, 0.2, 1.15, 0), bi(6.5, 1.1, 0.8, 0.24, -0.5, 3)],
                 struts=struts(0.85), tail=tail(3.3, 1.1, 0.7, 10, 0.85, 1.15, 1.15, 0.6, 25, 0.85),
                 engine=radial(1.2, 0.7, 3, 2.8, spinner=True, sd=0.4, sl=0.35),
                 canopy=open_cockpit(0.42, 0.85, 0.6), gear=gear(0.18, 2.0, 0.8, 0.7, spats=True, rootXM=0.9, rootYM=-0.55),
                 guns=[fgun(0.1, 0.25, 0.45)], colors=ITALY)
P["i16"] = dict(era="early_ww2", lengthM=6.13, wingspanM=9.0, fuselage=body(STUBBY, 1.3, 1.4),
                wing=mono(2.4, 1.2, 0.26, "low", 4, thickness=0.13),
                tail=tail(3.6, 1.0, 0.6, 10, 0.86, 1.15, 1.1, 0.6, 20, 0.85),
                engine=radial(1.35, 0.7, 2, 2.8, spinner=True, sd=0.4, sl=0.3),
                canopy=canopy(0.5, 0.9, 0.62, 0.4), guns=[fgun(0.1, 0.32, 0.3), wgun(0.36)], colors=VVS)
P["p36"] = dict(era="early_ww2", lengthM=8.7, wingspanM=11.38, fuselage=body(RADIAL, 1.2, 1.5),
                wing=mono(2.6, 1.2, 0.27, "low", 6, thickness=0.13),
                tail=tail(4.0, 1.25, 0.7, 5, 0.85, 1.35, 1.4, 0.7, 25, 0.84),
                engine=radial(1.3, 0.85, 3, 3.1, sd=0.45, sl=0.4),
                canopy=canopy(0.46, 1.5, 0.62, 0.5, "framed"), guns=[fgun(0.12, 0.2, 0.0, 0), fgun(0.12, -0.0, 0.05, 1)],
                colors=METAL)
P["p36"]["guns"] = [fgun(0.12, 0.2, -0.05, 0), fgun(0.14, 0.0, -0.05, 1)]
P["hurricane_mk1"] = dict(era="early_ww2", lengthM=9.84, wingspanM=12.19, fuselage=body(INLINE, 1.05, 1.6),
                          wing=mono(2.55, 1.25, 0.26, "low", 4, thickness=0.16),
                          tail=tail(3.4, 1.4, 0.7, 10, 0.86, 1.4, 1.5, 0.7, 15, 0.84),
                          engine=inline(2, 3.35, sd=0.55, sl=0.6), scoops=[scoop(0.38, 0.6, 0.62, 0.42, -0.05)],
                          canopy=canopy(0.42, 1.5, 0.62, 0.45), guns=[wgun(0.32), wgun(0.36), wgun(0.42), wgun(0.46)],
                          colors=RAF)
P["a6m2"] = dict(era="early_ww2", lengthM=9.06, wingspanM=12.0, fuselage=body(RADIAL, 1.15, 1.4),
                 wing=mono(2.6, 1.3, 0.25, "low", 6, thickness=0.12),
                 tail=tail(4.4, 1.2, 0.6, 10, 0.86, 1.3, 1.4, 0.6, 25, 0.84),
                 engine=radial(1.2, 0.8, 3, 2.9, sd=0.45, sl=0.4),
                 canopy=canopy(0.46, 2.4, 0.62, 0.48, "framed"), guns=[wgun(0.45, 0), fgun(0.12, 0.2, 0.2, 1)], colors=IJN)
P["bf109e4"] = dict(era="early_ww2", lengthM=8.64, wingspanM=9.87, fuselage=body(INLINE, 0.9, 1.3),
                    wing=mono(2.1, 1.25, 0.27, "low", 6, thickness=0.12),
                    tail=tail(3.1, 0.95, 0.6, 5, 0.86, 1.15, 1.15, 0.65, 15, 0.86, mountFrac=0.6),
                    engine=inline(3, 3.1, sd=0.5, sl=0.55), scoops=[scoop(0.1, 0.2, 0.45, 0.3, 0.0)],
                    canopy=canopy(0.4, 1.4, 0.6, 0.45, "framed", [0.4, 0.95, 1.0, 1.0, 0.5]),
                    guns=[wgun(0.42, 0), fgun(0.1, 0.18, 0.05, 1)], colors=LW_GREEN)
P["bf109f4"] = dict(era="early_ww2", lengthM=8.94, wingspanM=9.92, fuselage=body(INLINE, 0.9, 1.3),
                    wing=mono(2.1, 0.95, 0.27, "low", 6, thickness=0.12),
                    tail=tail(3.0, 0.95, 0.55, 8, 0.86, 1.15, 1.15, 0.6, 20, 0.86, mountFrac=0.6),
                    engine=inline(3, 3.0, sd=0.6, sl=0.7), scoops=[scoop(0.1, 0.2, 0.45, 0.3, 0.0)],
                    canopy=canopy(0.4, 1.4, 0.6, 0.45, "framed", [0.4, 0.95, 1.0, 1.0, 0.5]),
                    guns=[fgun(0.0, 0.0, 0.0, 0, z=0.9), fgun(0.1, 0.18, 0.05, 1)], colors=LW_GREY)

# ---------------------------------------------------------------- Late WW2
P["p40e"] = dict(era="late_ww2", lengthM=9.66, wingspanM=11.38, fuselage=body(INLINE, 1.0, 1.5),
                 wing=mono(2.7, 1.3, 0.28, "low", 6, thickness=0.14),
                 tail=tail(4.0, 1.3, 0.7, 5, 0.86, 1.35, 1.4, 0.7, 20, 0.84),
                 engine=inline(3, 3.4, sd=0.5, sl=0.55), scoops=[scoop(0.05, 0.25, 0.75, 0.55, 0.1, 0.5)],
                 canopy=canopy(0.45, 1.5, 0.6, 0.45, "framed"), guns=[wgun(0.36), wgun(0.41), wgun(0.46)], colors=USAAF_OD)
P["p39q"] = dict(era="late_ww2", lengthM=9.19, wingspanM=10.36, fuselage=body(INLINE, 1.0, 1.5),
                 wing=mono(2.4, 1.2, 0.3, "low", 4, thickness=0.13),
                 tail=tail(4.0, 1.3, 0.7, 5, 0.86, 1.35, 1.3, 0.7, 20, 0.84),
                 engine=inline(3, 3.15, sd=0.55, sl=0.6), scoops=[scoop(0.46, 0.6, 0.5, 0.3, 0.0)],
                 canopy=canopy(0.36, 1.6, 0.66, 0.5, "framed", [0.3, 0.95, 1.0, 1.0, 0.7]),
                 guns=[fgun(0.0, 0.0, 0.0, 0, z=0.9), fgun(0.08, 0.2, 0.3, 1), wgun(0.42, 1)], colors=USAAF_OD)
P["f6f5"] = dict(era="late_ww2", lengthM=10.24, wingspanM=13.06, fuselage=body(RADIAL, 1.35, 1.75),
                 wing=mono(3.0, 1.6, 0.3, "low", 7, thickness=0.14),
                 tail=tail(4.8, 1.6, 0.8, 5, 0.86, 1.8, 1.7, 0.8, 15, 0.82),
                 engine=radial(1.4, 1.0, 3, 4.0, sd=0.5, sl=0.45),
                 canopy=canopy(0.45, 1.6, 0.7, 0.5, "framed"), guns=[wgun(0.38), wgun(0.43), wgun(0.48)], colors=NAVY)
P["fw190a8"] = dict(era="late_ww2", lengthM=9.0, wingspanM=10.51, fuselage=body(RADIAL, 1.3, 1.45),
                    wing=mono(2.4, 1.2, 0.27, "low", 6, thickness=0.13),
                    tail=tail(3.6, 1.05, 0.55, 8, 0.86, 1.2, 1.2, 0.55, 20, 0.86),
                    engine=radial(1.3, 0.9, 3, 3.3, sd=0.7, sl=0.55),
                    canopy=canopy(0.46, 1.6, 0.6, 0.48),
                    guns=[wgun(0.15, 0), wgun(0.36, 0), fgun(0.08, 0.22, 0.05, 1)],
                    pylons=[{"at": "fuselage", "t": 0.38, "xM": 0.0, "yOffsetM": -0.85}] + wpylon(0.48), colors=LW_GREY)
P["p47d"] = dict(era="late_ww2", lengthM=11.0, wingspanM=12.42, fuselage=body(RADIAL, 1.45, 1.9),
                 wing=mono(3.0, 1.5, 0.3, "low", 5, plan="elliptical", thickness=0.14),
                 tail=tail(4.7, 1.5, 0.8, 5, 0.86, 1.7, 1.7, 0.8, 15, 0.82),
                 engine=radial(1.55, 1.1, 4, 4.0, sd=0.5, sl=0.45), scoops=[scoop(0.1, 0.4, 0.6, 0.45, 0.25, 0.5)],
                 canopy=canopy(0.46, 1.8, 0.72, 0.55), guns=[wgun(0.4), wgun(0.44), wgun(0.48), wgun(0.52)],
                 pylons=wpylon(0.24, 0.6, 0.67, 0.74, 0.81), colors=METAL)
P["yak3"] = dict(era="late_ww2", lengthM=8.5, wingspanM=9.2, fuselage=body(INLINE, 0.9, 1.25),
                 wing=mono(2.1, 1.1, 0.28, "low", 5, thickness=0.12),
                 tail=tail(3.2, 1.0, 0.5, 10, 0.86, 1.1, 1.1, 0.6, 15, 0.86),
                 engine=inline(3, 3.0, sd=0.5, sl=0.6), scoops=[scoop(0.42, 0.62, 0.45, 0.3, 0.0)],
                 canopy=canopy(0.46, 1.4, 0.58, 0.45),
                 guns=[fgun(0.0, 0.0, 0.0, 0, z=0.9), fgun(0.08, 0.16, 0.05, 1)], colors=VVS_GREY)
P["p51d"] = dict(era="late_ww2", lengthM=9.83, wingspanM=11.28, fuselage=body(INLINE, 0.95, 1.45),
                 wing=mono(2.6, 1.15, 0.29, "low", 5, thickness=0.12),
                 tail=tail(4.1, 1.3, 0.65, 5, 0.86, 1.4, 1.5, 0.6, 25, 0.82),
                 engine=inline(4, 3.4, sd=0.5, sl=0.6), scoops=[scoop(0.42, 0.68, 0.62, 0.42, 0.0, 0.4)],
                 canopy=canopy(0.42, 1.7, 0.66, 0.52), guns=[wgun(0.38, 0), wgun(0.43, 1), wgun(0.47, 1)], colors=METAL)
P["spitfire_mk14"] = dict(era="late_ww2", lengthM=9.96, wingspanM=11.23, fuselage=body(INLINE, 0.92, 1.4),
                          wing=mono(2.5, 0.55, 0.28, "low", 6, plan="elliptical", thickness=0.12),
                          tail=tail(3.4, 1.15, 0.6, 8, 0.86, 1.35, 1.4, 0.55, 25, 0.84),
                          engine=inline(5, 3.15, sd=0.6, sl=0.75), scoops=[scoop(0.3, 0.42, 0.4, 0.3, 0.0)],
                          canopy=canopy(0.5, 1.5, 0.62, 0.48), guns=[wgun(0.36, 0), wgun(0.46, 1)], colors=RAF)
P["me262"] = dict(era="late_ww2", lengthM=10.6, wingspanM=12.6, fuselage=body(JET_PROP, 1.2, 1.55),
                  wing=mono(3.0, 1.4, 0.36, "low", 6, sweep=18, thickness=0.1),
                  tail=tail(4.2, 1.4, 0.7, 15, 0.86, 1.8, 1.7, 0.8, 30, 0.82, yM=0.35),
                  engine={"type": "inline_nose"},
                  pods=[{"xM": 2.1, "yM": -0.7, "fromT": 0.33, "toT": 0.66, "radiusM": 0.45, "endRadiusM": 0.32,
                         "intake": True, "exhaust": True}],
                  canopy=canopy(0.4, 1.9, 0.62, 0.5), guns=[fgun(0.06, 0.18, 0.25, 0), fgun(0.06, 0.18, -0.05, 1)],
                  colors=LW_JET)

# ---------------------------------------------------------------- AI bombers (Bomber Escort), era "bombers"
# Generic types, not any one aircraft: a WW1 twin-engine biplane, a WW2 four-engine bomber and a swept jet bomber.
# Gunner muzzles are mount 0 (nose), 1 (top), 2 (tail).
B = {}
B["bomber_ww1"] = dict(era="bombers", lengthM=12.0, wingspanM=23.0, fuselage=body(WW1_INLINE, 1.2, 1.5),
                       wing=[bi(23.0, 2.6, 2.4, 0.3, 1.6, 0), bi(21.5, 2.6, 2.4, 0.32, -0.7, 0)],
                       struts=struts(0.3, 0.62, 0.9), tail=tail(5.5, 1.8, 1.5, 0, 0.86, 1.8, 1.8, 1.2, 15, 0.86, type="twin_fin",
                                                                     finOffsetM=1.2),
                       engine={"type": "inline_nose"},
                       pods=[{"xM": 2.6, "yM": 0.15, "fromT": 0.22, "toT": 0.42, "radiusM": 0.45, "endRadiusM": 0.25, "sides": 6, "intake": True}],
                       canopy=open_cockpit(0.15, 1.0, 0.7), gear=gear(0.28, 3.0, 1.2, 0.9),
                       guns=[fgun(0.04, 0.0, 0.7, 0, z=0.0), fgun(0.45, 0.0, 0.8, 1, z=0.0), fgun(0.6, 0.0, 0.6, 2, z=0.0)],
                       colors=RFC)
B["bomber_ww2"] = dict(era="bombers", lengthM=22.6, wingspanM=31.6, fuselage=body(BOMBER, 2.4, 2.7, 10),
                       wing=mono(5.6, 2.2, 0.3, "mid", 4, thickness=0.15),
                       tail=tail(13.0, 4.0, 2.0, 5, 0.83, 5.0, 5.5, 2.0, 30, 0.76),
                       engine={"type": "inline_nose"},
                       pods=[{"xM": 4.2, "yM": -0.1, "fromT": 0.21, "toT": 0.44, "radiusM": 0.75, "endRadiusM": 0.4, "intake": True},
                             {"xM": 7.8, "yM": 0.0, "fromT": 0.23, "toT": 0.42, "radiusM": 0.7, "endRadiusM": 0.35, "intake": True}],
                       canopy=canopy(0.1, 2.6, 1.5, 0.7, "framed"),
                       guns=[fgun(0.0, 0.0, 0.0, 0, z=0.3), fgun(0.3, 0.0, 1.55, 1, z=0.0), fgun(1.0, 0.0, 0.0, 2, z=-0.2)],
                       colors=BOMBER_COL)
B["bomber_jet"] = dict(era="bombers", lengthM=33.5, wingspanM=35.4, fuselage=body(JET_PROP, 2.8, 3.0, 10),
                       wing=mono(6.5, 2.0, 0.36, "high", -2, sweep=35, thickness=0.09),
                       tail=tail(10.0, 4.0, 1.6, 35, 0.86, 6.0, 6.0, 2.2, 40, 0.78),
                       engine={"type": "inline_nose"},
                       pods=[{"xM": 5.5, "yM": 0.0, "fromT": 0.41, "toT": 0.55, "radiusM": 0.7, "endRadiusM": 0.55,
                              "intake": True, "exhaust": True},
                             {"xM": 10.0, "yM": 0.05, "fromT": 0.51, "toT": 0.63, "radiusM": 0.6, "endRadiusM": 0.45,
                              "intake": True, "exhaust": True}],
                       canopy=canopy(0.1, 3.5, 1.4, 0.8), guns=[fgun(0.99, 0.0, 0.0, 2, z=-0.6), fgun(0.4, 0.0, 1.4, 1, z=0.0)],
                       colors=BOMBER_JET)


def main():
    out = os.path.join(HERE, "specs")
    for pid, spec in {**P, **B}.items():
        spec = {"id": pid, **spec}
        spec.setdefault("pylons", [])
        with open(os.path.join(out, f"{pid}.json"), "w") as f:
            json.dump(spec, f, indent=2)
            f.write("\n")
    print(f"wrote {len(P)} plane specs and {len(B)} bomber specs")


if __name__ == "__main__":
    main()
