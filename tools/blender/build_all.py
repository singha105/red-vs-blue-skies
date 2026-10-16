"""Builds every plane spec and weapon in one headless Blender session (npm run models calls this).

  Blender --background --factory-startup --python tools/blender/build_all.py -- <raw_out_dir> <previews_dir> [ids...]

Writes, per plane: <raw_out_dir>/<id>.glb (the detailed model, smooth, UV-mapped), <id>_detail.png (baked AO,
panel lines and team mask, see bake_kit.py), <id>_lod.glb (the low-poly model: phones and distance) and <id>.json
(dimensions, empties, triangle counts); <raw_out_dir>/weapons/<id>.glb + .json for weapons; a preview PNG each.

Day 11 budgets: detailed models up to 3,000 triangles (props), 4,000 (jets), 6,000 (AI bombers); each plane
gets the finest kit detail level that fits. The LOD keeps the old budgets."""

from __future__ import annotations

import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bake_kit  # noqa: E402
import plane_kit  # noqa: E402
import render_preview  # noqa: E402
import weapons_kit  # noqa: E402

PROP_BUDGET = 3000
JET_BUDGET = 4000
BOMBER_BUDGET = 6000  # the AI bombers (Bomber Escort) are three or four times a fighter's size
LOD_BUDGETS = {"prop": 1200, "jet": 1500, "bomber": 2000}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_materials="EXPORT",
        export_extras=False,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    raw_dir, prev_dir = argv[0], argv[1]
    only = set(argv[2:])
    os.makedirs(os.path.join(raw_dir, "weapons"), exist_ok=True)
    os.makedirs(prev_dir, exist_ok=True)
    spec_dir = os.path.join(HERE, "specs")
    failures = []

    for fname in sorted(os.listdir(spec_dir)):
        if not fname.endswith(".json"):
            continue
        spec = json.load(open(os.path.join(spec_dir, fname)))
        if only and spec["id"] not in only:
            continue
        jet = spec["era"] in ("early_jets", "cold_war", "modern")
        kind = "bomber" if spec["era"] == "bombers" else "jet" if jet else "prop"
        budget = BOMBER_BUDGET if kind == "bomber" else JET_BUDGET if jet else PROP_BUDGET
        # The low-poly LOD first (its numbers are the reference for the empties).
        reset()
        plane_kit.set_detail("low")
        lod_objs, lod_info = plane_kit.build(spec)
        if lod_info["tris"] > LOD_BUDGETS[kind]:
            failures.append(f"{spec['id']} LOD: {lod_info['tris']} triangles > {LOD_BUDGETS[kind]}")
        export(lod_objs, os.path.join(raw_dir, f"{spec['id']}_lod.glb"))
        # Then the finest detail level that fits the budget.
        for level in ("high", "mid", "low"):
            reset()
            plane_kit.set_detail(level)
            objs, info = plane_kit.build(spec)
            if info["tris"] <= budget:
                break
        info["budget"] = budget
        info["detail"] = level
        info["lodTris"] = lod_info["tris"]
        if info["tris"] > budget:
            failures.append(f"{spec['id']}: {info['tris']} triangles > {budget}")
        body = next(o for o in objs if o.name == "body")
        bake_kit.bake(body, os.path.join(raw_dir, f"{spec['id']}_detail.png"), spec["lengthM"])
        export(objs, os.path.join(raw_dir, f"{spec['id']}.glb"))
        json.dump(info, open(os.path.join(raw_dir, f"{spec['id']}.json"), "w"), indent=2)
        render_preview.render(objs, os.path.join(prev_dir, f"{spec['id']}.png"))
        print(f"BUILT {spec['id']} tris={info['tris']}/{budget} ({level}) lod={lod_info['tris']} muzzles={len(info['muzzles'])} pylons={len(info['pylons'])}")

    if not only or "weapons" in only:
        for wid in weapons_kit.WEAPONS:
            reset()
            plane_kit.set_detail("low")
            objs, info = weapons_kit.build_weapon(wid)
            export(objs, os.path.join(raw_dir, "weapons", f"{wid}.glb"))
            json.dump(info, open(os.path.join(raw_dir, "weapons", f"{wid}.json"), "w"), indent=2)
            render_preview.render(objs, os.path.join(prev_dir, f"weapon_{wid}.png"), tint=False)
            print(f"BUILT weapon {wid} tris={info['tris']}")

    if failures:
        print("BUDGET FAILURES:\n" + "\n".join(failures))
        sys.exit(1)


main()
