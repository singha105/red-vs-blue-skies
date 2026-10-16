"""Bakes a plane's detail texture (Day 11): UV-unwraps the body, then with Cycles bakes
  * ambient occlusion (wing roots, canopy rails, intakes get darker),
  * object-space position, from which panel lines are drawn in numpy (fuselage frames every ~1.1 m, wing ribs
    every ~1.3 m, a spine line), and
  * a team-paint mask (faces of the TEAM material),
into one RGBA PNG: RGB = AO x panel lines (grey detail the game multiplies into the paint), A = team mask (the
game paints red or blue there). Run inside Blender (build_all.py)."""

from __future__ import annotations

import math

import bpy
import numpy as np

SIZE = 512


def unwrap(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def _target(obj, image) -> None:
    """Every material gets an Image Texture node with `image`, selected and active, so Cycles bakes into it."""
    for slot in obj.material_slots:
        m = slot.material
        nodes = m.node_tree.nodes
        node = nodes.get("BakeTarget") or nodes.new("ShaderNodeTexImage")
        node.name = "BakeTarget"
        node.image = image
        for n in nodes:
            n.select = False
        node.select = True
        nodes.active = node


def _pixels(image) -> np.ndarray:
    a = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    image.pixels.foreach_get(a)
    return a.reshape(SIZE, SIZE, 4)


def _emit_team(obj, on: bool) -> list:
    """Swap every material's surface for an emission shader: white on TEAM faces, black elsewhere."""
    saved = []
    for slot in obj.material_slots:
        m = slot.material
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        link = out.inputs["Surface"].links[0] if out.inputs["Surface"].links else None
        saved.append((m, link.from_socket if link else None))
        if on:
            em = nt.nodes.get("TeamEmit") or nt.nodes.new("ShaderNodeEmission")
            em.name = "TeamEmit"
            v = 1.0 if m.name.startswith("TEAM") else 0.0
            em.inputs["Color"].default_value = (v, v, v, 1)
            em.inputs["Strength"].default_value = 1.0
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return saved


def _restore(saved) -> None:
    for m, sock in saved:
        out = next(n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL")
        if sock is not None:
            m.node_tree.links.new(sock, out.inputs["Surface"])


def bake(obj, path: str, length_m: float) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.render.bake.margin = 6
    unwrap(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    img = bpy.data.images.new("bake_rgb", SIZE, SIZE, alpha=True, float_buffer=True)
    _target(obj, img)
    # AO: occluders within a few metres only (a plane, not a valley).
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.light_settings.distance = max(1.5, length_m * 0.12)
    bpy.ops.object.bake(type="AO")
    ao = _pixels(img)[..., 0].copy()

    bpy.ops.object.bake(type="POSITION")
    pos = _pixels(img)[..., :3].copy()  # Blender frame: x = game x (span), y = -game z (length), z = up

    saved = _emit_team(obj, True)
    bpy.ops.object.bake(type="EMIT")
    team = _pixels(img)[..., 0].copy()
    _restore(saved)

    # Panel lines: thin dark lines where the position crosses a frame (along the length), a rib (along the span)
    # or the spine. Distances in metres; ~3.5 cm lines, faded by AO so they don't fight it in the corners.
    def lines(coord, spacing, width=0.035):
        d = np.abs((coord / spacing + 0.5) % 1.0 - 0.5) * spacing
        return np.clip((d - width * 0.5) / (width * 0.6), 0.0, 1.0)

    covered = np.abs(pos).sum(axis=-1) > 1e-6  # texels outside every UV island stay neutral
    frames = lines(pos[..., 1], 1.1)
    ribs = np.where(np.abs(pos[..., 0]) > 1.0, lines(pos[..., 0], 1.3), 1.0)
    spine = np.where(np.abs(pos[..., 0]) < 0.6, np.clip((np.abs(pos[..., 0]) - 0.02) / 0.02, 0, 1), 1.0)
    panel = 0.6 + 0.4 * np.minimum(np.minimum(frames, ribs), spine)
    ao = np.clip(0.35 + 0.65 * ao, 0.0, 1.0)
    detail = np.where(covered, ao * panel, 1.0)

    out = np.zeros((SIZE, SIZE, 4), dtype=np.float32)
    out[..., 0] = out[..., 1] = out[..., 2] = detail
    out[..., 3] = np.where(covered, team, 0.0)
    res = bpy.data.images.new("bake_out", SIZE, SIZE, alpha=True, float_buffer=False)
    res.colorspace_settings.name = "Non-Color"  # store the numbers as they are
    res.pixels.foreach_set(out.ravel())
    res.filepath_raw = path
    res.file_format = "PNG"
    res.alpha_mode = "STRAIGHT"
    res.save()
    # The exported glTF must not reference the bake image: drop the node again.
    for slot in obj.material_slots:
        n = slot.material.node_tree.nodes.get("BakeTarget")
        if n:
            slot.material.node_tree.nodes.remove(n)
