"""Workbench previews: front, side, top and three-quarter views tiled 2x2 into one PNG (four 512 px views).
TEAM faces are shown in blue so the team paint is visible. Run inside Blender (build_all.py calls it)."""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

from plane_kit import MATERIALS, hex_lin

VIEW_PX = 512


def _setup_scene():
    s = bpy.context.scene
    s.render.engine = "BLENDER_WORKBENCH"
    s.render.resolution_x = VIEW_PX
    s.render.resolution_y = VIEW_PX
    s.render.film_transparent = False
    s.render.dither_intensity = 0.0  # dither noise wrecks PNG compression
    s.render.image_settings.file_format = "PNG"
    sh = s.display.shading
    sh.light = "STUDIO"
    sh.color_type = "VERTEX"
    sh.show_shadows = False
    sh.show_cavity = True
    sh.show_object_outline = True
    sh.object_outline_color = (0.1, 0.12, 0.15)
    world = s.world or bpy.data.worlds.new("World")
    s.world = world
    world.color = (0.82, 0.86, 0.9)
    s.view_settings.view_transform = "Standard"


def _tint_team(objs, colour="#2f7de1"):
    team = MATERIALS.index("TEAM")
    c = hex_lin(colour)
    for o in objs:
        if o.type != "MESH":
            continue
        attr = o.data.color_attributes.get("Col")
        for poly in o.data.polygons:
            if poly.material_index == team:
                for li in poly.loop_indices:
                    attr.data[li].color = c


def render(objs, out_png: str, tint=True):
    _setup_scene()
    if tint:
        _tint_team(objs)
    meshes = [o for o in objs if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    size = max(hi - lo) * 1.15

    cam_data = bpy.data.cameras.new("preview")
    cam = bpy.data.objects.new("preview", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    # Blender frame: nose points -Y, up is +Z.
    views = [
        ("front", Vector((0, -1, 0)), True),
        ("side", Vector((1, 0, 0)), True),
        ("top", Vector((0, 0, 1)), True),
        ("three_quarter", Vector((0.9, -0.85, 0.55)), False),
    ]
    tiles = []
    base = os.path.splitext(out_png)[0]
    for name, d, ortho in views:
        d = d.normalized()
        cam.location = centre + d * size * 3
        if name == "top":
            # Straight down, nose (-Y in Blender) at the top of the image.
            cam.rotation_euler = (0.0, 0.0, math.pi)
        else:
            # Camera looks down its -Z; its +Y is image-up and should point to world up.
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = size
        else:
            cam_data.type = "PERSP"
            cam_data.lens = 50
            cam_data.sensor_width = 36
            cam.location = centre + d * size * 1.75
        cam_data.clip_end = size * 10
        path = f"{base}_{name}.png"
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tiles.append(path)

    # Tile 2x2 into the final preview.
    import numpy as np

    imgs = []
    for p in tiles:
        im = bpy.data.images.load(p)
        arr = np.array(im.pixels[:], dtype=np.float32).reshape(VIEW_PX, VIEW_PX, 4)
        imgs.append(arr)
        bpy.data.images.remove(im)
        os.remove(p)
    # Blender image rows start at the bottom: top row = front, side; bottom row = top, three-quarter.
    top = np.concatenate([imgs[0], imgs[1]], axis=1)
    bottom = np.concatenate([imgs[2], imgs[3]], axis=1)
    grid = np.concatenate([bottom, top], axis=0)
    out = bpy.data.images.new("preview_grid", VIEW_PX * 2, VIEW_PX * 2, alpha=True)
    out.pixels[:] = grid.ravel()
    # 8-bit RGB, max compression: previews are committed, so keep them small.
    settings = bpy.context.scene.render.image_settings
    settings.file_format = "PNG"
    settings.color_mode = "RGB"
    settings.color_depth = "8"
    settings.compression = 100
    out.save_render(out_png, scene=bpy.context.scene)
    bpy.data.images.remove(out)
    bpy.data.objects.remove(cam)
