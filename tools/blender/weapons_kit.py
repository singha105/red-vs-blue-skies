"""Low-poly weapon models (missiles, rocket, bomb, drop tank), each under 200 triangles.
Same frame and conventions as plane_kit: nose toward +Z (game frame), origin at the mounting point."""

from __future__ import annotations

import math

from plane_kit import MeshBuilder, hex_lin

WEAPONS = {
    # id: length, diameter, nose length fraction, fin span, fin chord fraction, extra fins (canards), colour
    "missile_ir_small": dict(length=2.9, dia=0.13, nose=0.12, fin=0.45, chord=0.12, canards=True, colour="#e6e8ea"),
    "missile_ir_large": dict(length=3.0, dia=0.17, nose=0.14, fin=0.62, chord=0.14, canards=True, colour="#dfe2e4"),
    "missile_radar_medium": dict(length=3.66, dia=0.2, nose=0.14, fin=0.8, chord=0.12, canards=False, mid_wings=True, colour="#e8e8e8"),
    "missile_radar_long": dict(length=3.9, dia=0.23, nose=0.13, fin=0.7, chord=0.1, canards=False, mid_wings=True, colour="#ececec"),
    "rocket": dict(length=1.7, dia=0.13, nose=0.18, fin=0.35, chord=0.15, canards=False, colour="#5d6b4f"),
    "bomb_250": dict(length=1.6, dia=0.36, nose=0.3, fin=0.5, chord=0.22, canards=False, tail_cone=0.3, colour="#4f5a46"),
    "drop_tank": dict(length=3.3, dia=0.6, nose=0.3, fin=0.0, chord=0.0, canards=False, tail_cone=0.35, colour="#b8bec4"),
}


def build_weapon(wid: str):
    w = WEAPONS[wid]
    mb = MeshBuilder()
    body_col = hex_lin(w["colour"])
    dark = hex_lin("#2a2f36")
    seeker = hex_lin("#3d4a57")
    L, r = w["length"], w["dia"] / 2
    K = 8
    nose_len = L * w["nose"]
    tail_len = L * w.get("tail_cone", 0.04)
    # Body profile along +Z: (z, radius).
    prof = [(L / 2, 0.0), (L / 2 - nose_len, r), (-L / 2 + tail_len, r), (-L / 2, r * (0.45 if tail_len > 0.1 else 0.85))]
    rings = []
    for z, rad in prof:
        if rad < 1e-4:
            rings.append([mb.v((0, 0, z))])
        else:
            rings.append([mb.v((rad * math.cos(2 * math.pi * k / K), rad * math.sin(2 * math.pi * k / K), z)) for k in range(K)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(K):
            k2 = (k + 1) % K
            if len(a) == 1:
                mb.f([a[0], b[k], b[k2]], "BODY", seeker if wid.startswith("missile") else body_col)
            else:
                mb.f([a[k], b[k], b[k2], a[k2]], "BODY", body_col)
    mb.f(list(reversed(rings[-1])), "DARK", dark)

    def fins(z_le, span, chord):
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            p = [(ca * r, sa * r, z_le), (ca * (r + span), sa * (r + span), z_le - chord * 0.6),
                 (ca * (r + span), sa * (r + span), z_le - chord), (ca * r, sa * r, z_le - chord)]
            i = [mb.v(q) for q in p]
            mb.f(i, "BODY", body_col)  # one-sided; glTF materials are double-sided

    if w["fin"] > 0:
        fins(-L / 2 + L * w["chord"] + 0.02, w["fin"] / 2, L * w["chord"])
    if w.get("canards"):
        fins(L / 2 - nose_len - 0.05, w["fin"] / 4, L * 0.06)
    if w.get("mid_wings"):
        fins(0.25, w["fin"] / 3, L * 0.16)
    assert mb.tri_count() <= 200, f"{wid}: {mb.tri_count()} triangles"
    obj = mb.to_object(wid)
    return [obj], {"id": wid, "tris": mb.tri_count(), "lengthM": L}
