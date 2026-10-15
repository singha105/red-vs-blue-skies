"""Parametric low-poly plane generator for Blender (run headless via build_all.py).

Everything is built in the game's frame and converted to Blender's at the end:
    game:    +X = left wing, +Y = up, +Z = forward (nose)
    blender: (x, -z, y)   -> the glTF exporter (+Y up) turns it back into the game frame.

A spec (tools/blender/specs/<id>.json) describes a plane in real metres. The kit builds:
  * one mesh "body" (fuselage, wings, tail, engine, canopy, pylons) with four materials:
    BODY (paint / camo / underside), TEAM (white, tinted red or blue in game), GLASS, DARK
  * one mesh "prop" (blades + spinner) whose origin is the hub, so the game can spin it
  * empties "muzzle_N", "pylon_N", "exhaust_N" at the points the game uses
Colours are per-face vertex colours (flat shading, no textures).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy

MATERIALS = ["BODY", "TEAM", "GLASS", "DARK"]
DARK = "#2a2f36"
GLASS = "#9fc9e8"

TEAM_PRESETS = {
    "aft_fuselage_and_wingtips": ["fuselage_band", "wingtips"],
    "aft_fuselage_wingtips_fin": ["fuselage_band", "wingtips", "fin"],
    "nose_and_fin": ["nose", "fin"],
    "fin_and_wingtips": ["fin", "wingtips"],
}


# ---------------------------------------------------------------- helpers

def hex_lin(h: str) -> tuple[float, float, float, float]:
    """sRGB hex -> linear RGBA (glTF COLOR_0 is linear)."""
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


def to_blender(p):
    x, y, z = p
    return (x, -z, y)


def lerp(a, b, t):
    return a + (b - a) * t


def face_hash(*vals) -> float:
    """Deterministic 0..1 from numbers (for camo patches)."""
    h = 0
    for v in vals:
        h = (h * 31 + int(round(v * 7.3)) * 2654435761) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h & 0xFFFF) / 0xFFFF


@dataclass
class MeshBuilder:
    verts: list = field(default_factory=list)
    faces: list = field(default_factory=list)  # (indices, material, colour)

    def v(self, p) -> int:
        self.verts.append(tuple(p))
        return len(self.verts) - 1

    def f(self, idx, mat: str, colour):
        self.faces.append((list(idx), MATERIALS.index(mat), colour))

    def tri_count(self) -> int:
        return sum(len(i) - 2 for i, _, _ in self.faces)

    def to_object(self, name: str, origin=(0.0, 0.0, 0.0)):
        ox, oy, oz = origin
        verts = [to_blender((x - ox, y - oy, z - oz)) for x, y, z in self.verts]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], [i for i, _, _ in self.faces])
        mesh.update()
        for m in MATERIALS:
            mesh.materials.append(material(m))
        attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
        for poly, (_, mat, col) in zip(mesh.polygons, self.faces):
            poly.material_index = mat
            poly.use_smooth = False
            for li in poly.loop_indices:
                attr.data[li].color = col
        try:
            mesh.color_attributes.active_color = attr
            mesh.color_attributes.render_color_index = 0
        except (AttributeError, TypeError):
            pass
        obj = bpy.data.objects.new(name, mesh)
        obj.location = to_blender(origin)
        bpy.context.scene.collection.objects.link(obj)
        return obj


_materials: dict = {}


def material(name: str):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (1, 1, 1, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
            bsdf.inputs["Roughness"].default_value = 0.35 if name == "GLASS" else 0.9
            if "Metallic" in bsdf.inputs:
                bsdf.inputs["Metallic"].default_value = 0.0
    return m


def empty(name: str, p):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.25
    e.location = to_blender(p)
    bpy.context.scene.collection.objects.link(e)
    return e


# ---------------------------------------------------------------- the plane

class Plane:
    def __init__(self, spec: dict):
        self.s = spec
        self.L = spec["lengthM"]
        self.mb = MeshBuilder()
        self.prop = MeshBuilder()
        c = spec.get("colors", {})
        self.col_body = hex_lin(c.get("body", "#8a9099"))
        self.col_camo = hex_lin(c.get("camo", c.get("body", "#8a9099")))
        self.col_under = hex_lin(c.get("underside", c.get("body", "#b8c4c8")))
        self.col_wing = hex_lin(c["wing"]) if "wing" in c else None  # e.g. the P-26's yellow wings
        self.col_team = hex_lin("#ffffff")
        self.col_dark = hex_lin(DARK)
        self.col_glass = hex_lin(GLASS)
        band = c.get("teamBand", "aft_fuselage_and_wingtips")
        if isinstance(band, list):
            self.team = set(band)
        else:
            self.team = set(TEAM_PRESETS.get(band, [band]))
        self.muzzles: list = []  # (pos, mount)
        self.pylons: list = []
        self.exhausts: list = []
        self.prop_hub = None
        sections = spec["fuselage"]["sections"]
        self.sections = [(s[0], s[1], s[2], s[3] if len(s) > 3 else 0.0) for s in sections]

    # --- fuselage geometry queries
    def z_at(self, t: float) -> float:
        return self.L * (0.5 - t)

    def section_at(self, t: float):
        secs = self.sections
        if t <= secs[0][0]:
            return secs[0][1:]
        for a, b in zip(secs, secs[1:]):
            if a[0] <= t <= b[0]:
                k = (t - a[0]) / max(1e-6, b[0] - a[0])
                return (lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k))
        return secs[-1][1:]

    def top_at(self, t):
        w, h, y = self.section_at(t)
        return y + h / 2

    def paint(self, centre, normal, key) -> tuple[str, tuple]:
        """BODY colour for a face: underside if facing down, else body/camo patches."""
        if normal[1] < -0.35:
            return "BODY", self.col_under
        if self.col_camo != self.col_body and face_hash(*key) > 0.55:
            return "BODY", self.col_camo
        return "BODY", self.col_body

    # --- fuselage: loft through elliptical cross-sections
    def fuselage(self):
        K = self.s["fuselage"].get("sides", 8)
        band = self.s["fuselage"].get("teamBand", [0.66, 0.74])
        nose_team = self.s["fuselage"].get("teamNose", [0.0, 0.08])
        # Add loft rings at the paint-band edges so the band has crisp ends wherever the spec's sections are.
        extra = []
        if "fuselage_band" in self.team:
            extra += band
        if "nose" in self.team:
            extra += nose_team
        ts = sorted(set([s[0] for s in self.sections] + [t for t in extra if self.sections[0][0] < t < self.sections[-1][0]]))
        self.sections = [next((s for s in self.sections if s[0] == t), None) or (t, *self.section_at(t)) for t in ts]
        rings = []
        for t, w, h, y in self.sections:
            z = self.z_at(t)
            if w < 1e-3 and h < 1e-3:
                rings.append([self.mb.v((0, y, z))])
                continue
            ring = []
            for k in range(K):
                a = 2 * math.pi * k / K + math.pi / K
                ring.append(self.mb.v((w / 2 * math.cos(a), y + h / 2 * math.sin(a), z)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            r0, r1 = rings[i], rings[i + 1]
            t0, t1 = self.sections[i][0], self.sections[i + 1][0]
            tm = (t0 + t1) / 2
            for k in range(K):
                k2 = (k + 1) % K
                if len(r0) == 1:
                    idx = [r0[0], r1[k2], r1[k]]
                elif len(r1) == 1:
                    idx = [r0[k], r0[k2], r1[0]]
                else:
                    idx = [r0[k], r0[k2], r1[k2], r1[k]]
                a = 2 * math.pi * (k + 0.5) / K + math.pi / K
                normal = (math.cos(a), math.sin(a), 0)
                mat, col = self.paint(None, normal, (i, k, 1))
                if "fuselage_band" in self.team and band[0] <= tm <= band[1]:
                    mat, col = "TEAM", self.col_team
                if "nose" in self.team and nose_team[0] <= tm <= nose_team[1]:
                    mat, col = "TEAM", self.col_team
                self.mb.f(idx, mat, col)
        # Caps (an n-gon each; the exporter triangulates).
        if len(rings[0]) > 1:
            dark_nose = self.s.get("engine", {}).get("type") in ("jet_nose_intake",)
            self.mb.f(list(reversed(rings[0])), "DARK" if dark_nose else "BODY", self.col_dark if dark_nose else self.col_body)
        if len(rings[-1]) > 1:
            self.mb.f(rings[-1], "DARK", self.col_dark)

    # --- lifting surfaces (wings, stabilisers, fins share this)
    def surface(self, stations, thickness, vertical=False, mirror=True, x0=0.0, team_tip=False, kind="wing", cant_deg=0.0):
        """stations: list of (span_m, chord, le_z, offset) from root to tip.
        Horizontal: span along +X, offset = y. Vertical: span along +Y, offset = x."""
        sides = [1, -1] if mirror else [1]
        for side in sides:
            rings = []
            for span, chord, le_z, off in stations:
                th = chord * thickness
                pts = [(0.0, 0.0), (0.3 * chord, th / 2), (chord, 0.0), (0.3 * chord, -th / 2)]
                ring = []
                for dz, dn in pts:
                    z = le_z - dz
                    if vertical:
                        ca = math.radians(cant_deg) * side
                        x = x0 * side + dn + math.sin(ca) * span
                        y = off + math.cos(ca) * span
                        ring.append(self.mb.v((x, y, z)))
                    else:
                        ring.append(self.mb.v(((x0 + span) * side, off + dn, z)))
                rings.append(ring)
            half = stations[-1][0] or 1
            for i in range(len(rings) - 1):
                tip_zone = team_tip and stations[i][0] >= 0.84 * half
                for k in range(4):
                    k2 = (k + 1) % 4
                    idx = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
                    if side < 0:
                        idx.reverse()
                    up = k in (0, 1)  # LE->upper, upper->TE faces point up
                    if vertical:
                        normal = (side if up else -side, 0, 0)
                    else:
                        normal = (0, 1 if up else -1, 0)
                    mat, col = self.paint(None, normal, (i, k, side, stations[i][0], kind == "fin"))
                    if kind == "wing" and self.col_wing:
                        col = self.col_wing
                    if tip_zone:
                        mat, col = "TEAM", self.col_team
                    if kind == "fin" and "fin" in self.team:
                        mat, col = "TEAM", self.col_team
                    self.mb.f(idx, mat, col)
            tip = rings[-1]
            idx = [tip[0], tip[1], tip[2], tip[3]] if side > 0 else [tip[3], tip[2], tip[1], tip[0]]
            tip_team = team_tip or (kind == "fin" and "fin" in self.team)
            self.mb.f(idx, "TEAM" if tip_team else "BODY", self.col_team if tip_team else self.col_body)

    def wing_stations(self, w, half):
        """Planform -> (span_m, chord, le_z, y) stations for one side."""
        root = w["rootChordM"]
        tip = w.get("tipChordM", root * 0.5)
        sweep = math.radians(w.get("sweepDeg", 0))
        dih = math.radians(w.get("dihedralDeg", 0))
        le0 = self.z_at(w["positionAlongLength"])
        y0 = self.wing_y(w)
        plan = w.get("planform", "tapered")
        out = []
        if plan == "elliptical":
            qc = le0 - 0.25 * root
            for s in (0.0, 0.3, 0.55, 0.75, 0.86, 0.95, 1.0):
                chord = root * max(0.2, math.sqrt(max(0.0, 1 - s * s)))
                out.append((s * half, chord, qc + 0.25 * chord - math.tan(sweep) * s * half, y0 + math.tan(dih) * s * half))
        elif plan == "gull":
            brk = w.get("breakFraction", 0.35)
            inner = math.radians(w.get("innerDihedralDeg", -15))
            y_brk = y0 + math.tan(inner) * brk * half
            for s in (0.0, brk, 0.86, 1.0):
                chord = lerp(root, tip, s)
                if s <= brk:
                    y = y0 + math.tan(inner) * s * half
                else:
                    y = y_brk + math.tan(dih) * (s - brk) * half
                out.append((s * half, chord, le0 - math.tan(sweep) * s * half, y))
        else:
            brk = w.get("breakFraction")  # optional dihedral break (F-4 outer panels)
            outer = math.radians(w.get("outerDihedralDeg", math.degrees(dih)))
            stations = sorted(set([0.0, 0.86, 1.0] + ([brk] if brk else [])))
            for s in stations:
                chord = lerp(root, tip, s)
                if brk and s > brk:
                    y = y0 + math.tan(dih) * brk * half + math.tan(outer) * (s - brk) * half
                else:
                    y = y0 + math.tan(dih) * s * half
                out.append((s * half, chord, le0 - math.tan(sweep) * s * half, y))
        return out

    def wing_y(self, w):
        if "yM" in w:
            return w["yM"]
        _, h, y = self.section_at(w["positionAlongLength"] + 0.04)
        mount = w.get("mount", "mid")
        return y + {"low": -0.62, "mid": 0.0, "high": 0.72, "shoulder": 0.5}.get(mount, 0.0) * h / 2

    def wings(self):
        wings = self.s["wing"] if isinstance(self.s["wing"], list) else [self.s["wing"]]
        self.wing_geo = []
        for i, w in enumerate(wings):
            half = w.get("spanM", self.s["wingspanM"]) / 2
            st = self.wing_stations(w, half)
            self.wing_geo.append((w, half, st))
            self.surface(st, w.get("thickness", 0.11), team_tip="wingtips" in self.team and i == 0)
        self.struts(wings)

    def wing_point(self, wi, frac):
        """(x, y, le_z, chord) on wing wi at span fraction frac (left side)."""
        w, half, st = self.wing_geo[wi]
        s = frac * half
        for a, b in zip(st, st[1:]):
            if a[0] <= s <= b[0]:
                k = (s - a[0]) / max(1e-6, b[0] - a[0])
                return (s, lerp(a[3], b[3], k), lerp(a[2], b[2], k), lerp(a[1], b[1], k))
        a = st[-1]
        return (a[0], a[3], a[2], a[1])

    def box(self, a, b, size, mat="DARK", col=None):
        """Thin box strut from point a to b (game frame), square section `size`."""
        col = col or self.col_dark
        ax, ay, az = a
        bx, by, bz = b
        d = (bx - ax, by - ay, bz - az)
        ln = math.sqrt(sum(c * c for c in d)) or 1
        d = tuple(c / ln for c in d)
        ref = (0, 0, 1) if abs(d[2]) < 0.9 else (1, 0, 0)
        u = (d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0])
        ul = math.sqrt(sum(c * c for c in u)) or 1
        u = tuple(c / ul * size / 2 for c in u)
        v = (d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0])
        corners = []
        for p in (a, b):
            for su, sv in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
                corners.append(self.mb.v((p[0] + su * u[0] + sv * v[0], p[1] + su * u[1] + sv * v[1], p[2] + su * u[2] + sv * v[2])))
        for k in range(4):
            k2 = (k + 1) % 4
            self.mb.f([corners[k], corners[k2], corners[4 + k2], corners[4 + k]], mat, col)

    def struts(self, wings):
        st = self.s.get("struts")
        if not st or len(wings) < 2:
            return
        for frac in st.get("spanFractions", [0.6]):
            for wi in range(len(wings) - 1):
                for side in (1, -1):
                    top = self.wing_point(wi, frac)
                    bot = self.wing_point(wi + 1, frac * self.wing_geo[0][1] / self.wing_geo[wi + 1][1])
                    zt = top[2] - top[3] * 0.35
                    zb = bot[2] - bot[3] * 0.35
                    self.box((top[0] * side, top[1], zt), (bot[0] * side, bot[1], zb), 0.07)
        # Cabane struts: fuselage top to the top wing.
        if st.get("cabane", True):
            top_w = self.wing_geo[0]
            for side in (1, -1):
                x, y, le, chord = self.wing_point(0, 0.08)
                t = top_w[0]["positionAlongLength"] + 0.05
                self.box((0.3 * side, self.top_at(t) - 0.05, le - chord * 0.3), (x * side * 0.6 + 0.25 * side, y, le - chord * 0.3), 0.06)

    def tail(self):
        t = self.s["tail"]
        stab = t.get("stab", {})
        # Horizontal stabiliser.
        span = t.get("stabSpanM", 3.0)
        root = stab.get("rootChordM", t.get("stabChordM", 1.0))
        tip = stab.get("tipChordM", root * 0.6)
        pos = stab.get("positionAlongLength", 0.86)
        sweep = math.radians(stab.get("sweepDeg", 0))
        dih = math.radians(stab.get("dihedralDeg", 0))
        if "yM" in stab:
            y0 = stab["yM"]
        else:
            _, h, yc = self.section_at(pos + 0.03)
            y0 = yc + stab.get("mountFrac", 0.0) * h / 2
        le0 = self.z_at(pos)
        half = span / 2
        st = []
        for s in (0.0, 1.0):
            st.append((s * half, lerp(root, tip, s), le0 - math.tan(sweep) * s * half, y0 + math.tan(dih) * s * half))
        if t.get("type") != "fin_only":  # tailless deltas (Mirage, Gripen, Rafale, Typhoon) have no stabiliser
            self.surface(st, 0.08, team_tip="stab_tips" in self.team, kind="stab")
        # Fin(s).
        fin_h = t.get("finHeightM", 1.2)
        fin = t.get("fin", {})
        froot = fin.get("rootChordM", root * 1.1)
        ftip = fin.get("tipChordM", froot * 0.55)
        fpos = fin.get("positionAlongLength", pos - 0.02)
        fsweep = math.radians(fin.get("sweepDeg", 20))
        fy0 = self.top_at(fpos + 0.04) - 0.1
        fle = self.z_at(fpos)
        fst = []
        for s in (0.0, 1.0):
            fst.append((s * fin_h, lerp(froot, ftip, s), fle - math.tan(fsweep) * s * fin_h, fy0))
        twin = t.get("type") == "twin_fin"
        self.surface(fst, 0.08, vertical=True, mirror=twin, x0=t.get("finOffsetM", 0.0) if twin else 0.0,
                     kind="fin", cant_deg=t.get("finCantDeg", 0.0))
        self.fin_top = fy0 + fin_h

    def engine(self):
        e = self.s.get("engine", {})
        kind = e.get("type", "inline_nose")
        nose_z = self.z_at(self.sections[0][0])
        w0, h0, y0 = self.section_at(0.0)
        if kind == "radial_cowl":
            r = e.get("cowlDiameterM", max(w0, h0)) / 2
            ln = e.get("cowlLengthM", 0.8)
            K = 12
            front = [self.mb.v((r * math.cos(2 * math.pi * k / K), y0 + r * math.sin(2 * math.pi * k / K), nose_z)) for k in range(K)]
            back = [self.mb.v((r * 0.97 * math.cos(2 * math.pi * k / K), y0 + r * 0.97 * math.sin(2 * math.pi * k / K), nose_z - ln)) for k in range(K)]
            cowl_col = "TEAM" if "cowl" in self.team else "BODY"
            for k in range(K):
                k2 = (k + 1) % K
                self.mb.f([front[k2], front[k], back[k], back[k2]], cowl_col, self.col_team if cowl_col == "TEAM" else self.col_body)
            inner = [self.mb.v((r * 0.8 * math.cos(2 * math.pi * k / K), y0 + r * 0.8 * math.sin(2 * math.pi * k / K), nose_z - 0.12)) for k in range(K)]
            self.mb.f(list(reversed(inner)), "DARK", self.col_dark)
            for k in range(K):
                k2 = (k + 1) % K
                self.mb.f([front[k], front[k2], inner[k2], inner[k]], "DARK", self.col_dark)
        if kind == "side_intakes":
            a, b = e.get("fromT", 0.25), e.get("toT", 0.5)
            iw, ih = e.get("widthM", 0.8), e.get("heightM", 1.2)
            for side in (1, -1):
                w, h, y = self.section_at(a + 0.02)
                x_in = (w / 2 - 0.15) * side
                x_out = x_in + iw * side
                yc = y + e.get("yOffsetM", -0.1)
                za, zb = self.z_at(a), self.z_at(b)
                pts = [(x_in, yc + ih / 2, za), (x_out, yc + ih / 2, za), (x_out, yc - ih / 2, za), (x_in, yc - ih / 2, za)]
                f = [self.mb.v(p) for p in pts]
                keep = e.get("taperM", 0.4)  # how much of the intake's width/height survives to its back end
                bk = [self.mb.v((x_in + (p[0] - x_in) * keep, yc + (p[1] - yc) * keep, zb)) for p in pts]
                self.mb.f(f if side < 0 else list(reversed(f)), "DARK", self.col_dark)
                for k in range(4):
                    k2 = (k + 1) % 4
                    idx = [f[k], f[k2], bk[k2], bk[k]]
                    if side < 0:
                        idx.reverse()
                    self.mb.f(idx, "BODY", self.col_body if k != 2 else self.col_under)
        if kind == "chin_intake":
            # One intake under the nose, centred (F-16, F-8, Typhoon): a duct that fairs into the belly.
            self.duct(e)
        for ex in self.s.get("exhausts", []):
            self.nozzle(ex)
        pusher = e.get("pusher", False)
        if pusher:
            # DH.2: the engine and prop sit behind the nacelle, between the tail booms.
            t_end = self.sections[-1][0]
            nose_z = self.z_at(t_end) - 2 * e.get("propOffsetM", 0.15)
            y0 = self.section_at(t_end - 0.05)[2]
        if kind in ("inline_nose", "radial_cowl", "rotary") and e.get("propBlades"):
            self.propeller(e, nose_z, y0)
        if not self.s.get("exhausts") and not any(p.get("exhaust") for p in self.s.get("pods", [])):
            # Smoke point for prop planes: just behind the engine.
            self.exhausts.append((0.0, y0, nose_z + 0.3 if pusher else nose_z - e.get("cowlLengthM", 1.0) - 0.4))

    def duct(self, e):
        """A rectangular duct under the fuselage that fairs into the belly: jet chin intakes and the radiator
        scoops of prop fighters (P-51, P-40 chin, Hurricane, Yak-3)."""
        a, b = e.get("fromT", 0.2), e.get("toT", 0.5)
        iw, ih = e.get("widthM", 0.9), e.get("heightM", 0.7)
        w, h, y = self.section_at(a + 0.02)
        yc = y - h / 2 + e.get("yOffsetM", -0.2)
        za, zb = self.z_at(a), self.z_at(b)
        keep = e.get("taperM", 0.5)
        pts = [(iw / 2, yc + ih / 2, za), (-iw / 2, yc + ih / 2, za), (-iw / 2, yc - ih / 2, za), (iw / 2, yc - ih / 2, za)]
        f = [self.mb.v(p) for p in pts]
        ytop = yc + ih / 2
        bk = [self.mb.v((p[0] * keep, ytop + (p[1] - ytop) * keep, zb)) for p in pts]
        self.mb.f(list(reversed(f)), "DARK", self.col_dark)
        for k in range(4):
            k2 = (k + 1) % 4
            self.mb.f([f[k], f[k2], bk[k2], bk[k]], "BODY", self.col_body if k != 2 else self.col_under)

    def scoops(self):
        for sc in self.s.get("scoops", []):
            self.duct(sc)

    def gear(self):
        """Fixed landing gear (WW1 and early biplanes, P-26): V struts, an axle and wheels or spats, a tail skid."""
        g = self.s.get("gear")
        if not g:
            return
        t = g.get("t", 0.2)
        w, h, yc = self.section_at(t)
        z = self.z_at(t)
        bottom = yc - h / 2
        wr = g.get("wheelM", 0.66) / 2
        axle_y = bottom - g.get("heightM", 0.9) + wr
        track = g.get("trackM", 1.6) / 2
        spats = g.get("spats", False)
        root_x = g.get("rootXM", w * 0.3)
        root_y = g.get("rootYM", bottom + 0.05)
        for side in (1, -1):
            x = track * side
            # Spatted legs are faired (a fat strut); open gear is a thin V.
            self.box((root_x * side, root_y, z + (0.0 if spats else 0.32)), (x, axle_y + (wr * 0.6 if spats else 0), z), 0.16 if spats else 0.06,
                     "BODY" if spats else "DARK", self.col_body if spats else None)
            if not spats:
                self.box((root_x * side, root_y, z - 0.32), (x, axle_y, z), 0.06)
                self.wheel((x + 0.04 * side, axle_y, z), wr, 0.12)
            else:
                # A spat: a fat box around the wheel, slimmer at the back.
                self.box((x, axle_y, z + wr * 1.2), (x, axle_y + 0.04, z - wr * 1.5), wr * 1.15, "BODY", self.col_body)
        if not spats and g.get("axle", True):
            self.box((track, axle_y, z), (-track, axle_y, z), 0.05)
        if g.get("tailSkid", True):
            tt = g.get("skidT", 0.94)
            ws, hs, ys = self.section_at(tt)
            zt = self.z_at(tt)
            self.box((0, ys - hs / 2 + 0.02, zt + 0.25), (0, ys - hs / 2 - 0.25, zt - 0.1), 0.05)

    def wheel(self, c, r, width):
        K = 8
        cx, cy, cz = c
        rings = []
        for dx in (width / 2, -width / 2):
            rings.append([self.mb.v((cx + dx, cy + r * math.sin(2 * math.pi * k / K), cz + r * math.cos(2 * math.pi * k / K))) for k in range(K)])
        a, b = rings
        self.mb.f(a, "DARK", self.col_dark)
        self.mb.f(list(reversed(b)), "DARK", self.col_dark)
        for k in range(K):
            k2 = (k + 1) % K
            self.mb.f([a[k2], a[k], b[k], b[k2]], "DARK", self.col_dark)

    def nozzle(self, ex):
        t = ex.get("t", 1.0)
        r = ex.get("radiusM", 0.4)
        ln = ex.get("lengthM", 0.6)
        x = ex.get("xM", 0.0)
        y = ex.get("yM", self.section_at(t)[2])
        z1 = self.z_at(t) + 0.2
        z2 = z1 - ln
        K = 8
        sides = [1, -1] if x else [1]
        for side in sides:
            cx = x * side
            a = [self.mb.v((cx + r * math.cos(2 * math.pi * k / K), y + r * math.sin(2 * math.pi * k / K), z1)) for k in range(K)]
            b = [self.mb.v((cx + r * 0.9 * math.cos(2 * math.pi * k / K), y + r * 0.9 * math.sin(2 * math.pi * k / K), z2)) for k in range(K)]
            for k in range(K):
                k2 = (k + 1) % K
                self.mb.f([a[k], a[k2], b[k2], b[k]], "DARK", self.col_dark)
            self.mb.f(b, "DARK", hex_lin("#141619"))
            self.exhausts.append((cx, y, z2))

    def propeller(self, e, nose_z, y0):
        n = e["propBlades"]
        radius = e.get("propDiameterM", 3.0) / 2
        hub_z = nose_z + e.get("propOffsetM", 0.15)
        self.prop_hub = (0.0, y0, hub_z)
        hub = self.prop_hub
        chord = e.get("bladeChordM", 0.22)
        for b in range(n):
            a = 2 * math.pi * b / n
            ca, sa = math.cos(a), math.sin(a)
            pitch = math.radians(22)
            # Blade: a thin twisted quad slab from hub to tip.
            pts = []
            for r_, cw in ((0.15, chord * 0.8), (radius, chord * 0.6)):
                for sgn in (1, -1):
                    dz = math.sin(pitch) * cw / 2 * sgn
                    dt = math.cos(pitch) * cw / 2 * sgn
                    # Along the blade: (ca, sa); across it: (-sa, ca) tilted by pitch into z.
                    pts.append((hub[0] + ca * r_ - sa * dt, hub[1] + sa * r_ + ca * dt, hub[2] + dz))
            i = [self.prop.v(p) for p in pts]
            # One-sided quad: glTF materials are double-sided, so the back still renders.
            self.prop.f([i[0], i[1], i[3], i[2]], "DARK", self.col_dark)
        if e.get("spinner", True):
            K = 8
            r = e.get("spinnerDiameterM", 0.5) / 2
            ring = [self.prop.v((hub[0] + r * math.cos(2 * math.pi * k / K), hub[1] + r * math.sin(2 * math.pi * k / K), hub[2] - 0.1)) for k in range(K)]
            tipv = self.prop.v((hub[0], hub[1], hub[2] + e.get("spinnerLengthM", 0.6)))
            col = "TEAM" if "spinner" in self.team else "BODY"
            for k in range(K):
                self.prop.f([ring[k], ring[(k + 1) % K], tipv], col, self.col_team if col == "TEAM" else self.col_body)

    def canopy(self):
        c = self.s.get("canopy")
        if not c:
            return
        t = c["positionAlongLength"]
        ln = c.get("lengthM", 1.6)
        cw = c.get("widthM", self.section_at(t)[0] * 0.75)
        ch = c.get("heightM", 0.55)
        kind = c.get("type", "teardrop")
        zc = self.z_at(t)
        base = self.top_at(t) - 0.08
        if kind == "open":
            # Cockpit opening plus a small windscreen.
            hw = cw / 2
            o = [self.mb.v(p) for p in ((hw, base + 0.09, zc + ln / 2), (-hw, base + 0.09, zc + ln / 2), (-hw, base + 0.09, zc - ln / 2), (hw, base + 0.09, zc - ln / 2))]
            self.mb.f(o, "DARK", self.col_dark)
            ws = [self.mb.v(p) for p in ((hw * 0.8, base + 0.08, zc + ln / 2 + 0.05), (-hw * 0.8, base + 0.08, zc + ln / 2 + 0.05), (-hw * 0.6, base + 0.32, zc + ln / 2 - 0.08), (hw * 0.6, base + 0.32, zc + ln / 2 - 0.08))]
            self.mb.f(ws, "GLASS", self.col_glass)
            return
        # Bubble: rings along the length, half-ellipse cross-sections.
        prof = c.get("profile", [0.0, 0.8, 1.0, 0.85, 0.35] if kind == "teardrop" else [0.2, 0.9, 1.0, 1.0, 0.6])
        K = 6
        rings = []
        n = len(prof)
        for i, p in enumerate(prof):
            z = zc + ln / 2 - ln * i / (n - 1)
            if p < 1e-3:
                rings.append([self.mb.v((0, base + 0.05, z))])
                continue
            ring = []
            for k in range(K + 1):
                a = math.pi * k / K
                ring.append(self.mb.v((cw / 2 * p * math.cos(a), base + ch * p * math.sin(a), z)))
            rings.append(ring)
        for i in range(n - 1):
            r0, r1 = rings[i], rings[i + 1]
            for k in range(K):
                if len(r0) == 1:
                    idx = [r0[0], r1[k], r1[k + 1]]
                elif len(r1) == 1:
                    idx = [r0[k], r1[0], r0[k + 1]]
                else:
                    idx = [r0[k], r1[k], r1[k + 1], r0[k + 1]]
                self.mb.f(idx, "GLASS", self.col_glass)
        if len(rings[-1]) > 1:
            self.mb.f(rings[-1], "BODY", self.col_body)

    def pods(self):
        """Cylinders beside the fuselage: engine nacelles on the wings (Meteor) or tail booms (Vampire)."""
        for pd in self.s.get("pods", []):
            x, r = pd["xM"], pd.get("radiusM", 0.5)
            xb = pd.get("xEndM", x)
            za, zb = self.z_at(pd["fromT"]), self.z_at(pd["toT"])
            ya = pd.get("yM", 0.0)
            yb = pd.get("yEndM", ya)
            rb = pd.get("endRadiusM", r * 0.7)
            K = pd.get("sides", 8)
            for side in (1, -1):
                cx = x * side
                front = [self.mb.v((cx + r * math.cos(2 * math.pi * k / K), ya + r * math.sin(2 * math.pi * k / K), za)) for k in range(K)]
                back = [self.mb.v((xb * side + rb * math.cos(2 * math.pi * k / K), yb + rb * math.sin(2 * math.pi * k / K), zb)) for k in range(K)]
                for k in range(K):
                    k2 = (k + 1) % K
                    idx = [front[k2], front[k], back[k], back[k2]]
                    if side < 0:
                        idx.reverse()
                    a = 2 * math.pi * (k + 0.5) / K
                    mat, col = self.paint(None, (math.cos(a), math.sin(a), 0), (k, side, x, 7))
                    self.mb.f(idx, mat, col)
                inlet = pd.get("intake", False)
                self.mb.f(front if side < 0 else list(reversed(front)), "DARK" if inlet else "BODY", self.col_dark if inlet else self.col_body)
                self.mb.f(back if side < 0 else list(reversed(back)), "DARK", self.col_dark)
                if pd.get("exhaust"):
                    self.exhausts.append((xb * side, yb, zb))

    def hump(self):
        """Optional fairing over the guns (the Camel's hump)."""
        hp = self.s.get("hump")
        if not hp:
            return
        t0, t1 = hp["fromT"], hp["toT"]
        w, hh = hp["widthM"], hp["heightM"]
        za, zb = self.z_at(t0), self.z_at(t1)
        ya, yb = self.top_at(t0) - 0.05, self.top_at(t1) - 0.05
        p = [(w / 2, ya, za), (-w / 2, ya, za), (-w / 2, yb, zb), (w / 2, yb, zb),
             (w / 2.6, ya + hh, za - 0.1), (-w / 2.6, ya + hh, za - 0.1), (-w / 2.6, yb + hh * 0.6, zb + 0.1), (w / 2.6, yb + hh * 0.6, zb + 0.1)]
        i = [self.mb.v(q) for q in p]
        self.mb.f([i[4], i[5], i[6], i[7]], "BODY", self.col_body)
        self.mb.f([i[0], i[1], i[5], i[4]], "BODY", self.col_body)
        self.mb.f([i[1], i[2], i[6], i[5]], "BODY", self.col_body)
        self.mb.f([i[3], i[0], i[4], i[7]], "BODY", self.col_body)
        self.mb.f([i[2], i[3], i[7], i[6]], "BODY", self.col_body)

    def guns(self):
        for g in self.s.get("guns", []):
            mount = g.get("mount", 0)
            if g["at"] == "wing":
                wi = g.get("wingIndex", 0)
                x, y, le, chord = self.wing_point(wi, g["spanFraction"])
                for side in (1, -1):
                    self.muzzles.append(((x * side, y, le + 0.15), mount))
            else:
                t = g["t"]
                w, h, yc = self.section_at(t)
                x = g.get("xM", 0.0)
                y = yc + g.get("yOffsetM", h / 2)
                z = self.z_at(t) + g.get("zOffsetM", 0.2)
                sides = [1, -1] if x else [1]
                for side in sides:
                    self.muzzles.append(((x * side, y, z), mount))

    def pylons_(self):
        for p in self.s.get("pylons", []):
            if p["at"] == "wing":
                x, y, le, chord = self.wing_point(p.get("wingIndex", 0), p["spanFraction"])
                for side in (1, -1):
                    top = (x * side, y - 0.05, le - chord * 0.45)
                    bot = (x * side, y - 0.35, le - chord * 0.45)
                    self.box(top, bot, 0.12, "BODY", self.col_under)
                    self.pylons.append(bot)
            else:
                t = p["t"]
                w, h, yc = self.section_at(t)
                x = p.get("xM", w / 2)
                # xM 0 is one centreline pylon (the Fw 190's bomb rack); anything else is a left/right pair.
                for side in ((1, -1) if x else (1,)):
                    self.pylons.append((x * side, yc + p.get("yOffsetM", -h / 2 - 0.1), self.z_at(t)))

    def engine_kind(self):
        e = self.s.get("engine", {})
        if "sound" in e:  # the AI bombers have no spinning props but piston engines
            return e["sound"]
        if not self.prop_hub:
            return "jet"
        if e.get("type") in ("radial_cowl", "rotary"):
            return "rotary" if self.s["era"] == "ww1" else "radial"
        return "inline"

    def build(self):
        self.fuselage()
        self.wings()
        self.tail()
        self.engine()
        self.canopy()
        self.pods()
        self.hump()
        self.scoops()
        self.gear()
        self.guns()
        self.pylons_()
        body = self.mb.to_object("body")
        objs = [body]
        if self.prop_hub and self.prop.faces:
            objs.append(self.prop.to_object("prop", origin=self.prop_hub))
        for i, (p, _) in enumerate(self.muzzles):
            objs.append(empty(f"muzzle_{i + 1}", p))
        for i, p in enumerate(self.pylons):
            objs.append(empty(f"pylon_{i + 1}", p))
        for i, p in enumerate(self.exhausts):
            objs.append(empty(f"exhaust_{i + 1}", p))
        heights = [v[1] for v in self.mb.verts]
        info = {
            "id": self.s["id"],
            "era": self.s["era"],
            "lengthM": self.L,
            "wingspanM": self.s["wingspanM"],
            "heightM": round(max(heights) - min(heights), 2),
            "tris": self.mb.tri_count() + self.prop.tri_count(),
            "muzzles": [{"pos": [round(c, 3) for c in p], "mount": m} for p, m in self.muzzles],
            "pylons": [[round(c, 3) for c in p] for p in self.pylons],
            "exhausts": [[round(c, 3) for c in p] for p in self.exhausts],
            "prop": [round(c, 3) for c in self.prop_hub] if self.prop_hub else None,
            "finTopM": round(getattr(self, "fin_top", 0), 2),
            # Engine sound: rotary (WW1 radials), radial, inline, or jet (no propeller).
            "engine": self.engine_kind(),
        }
        return objs, info


def build(spec: dict):
    return Plane(spec).build()
