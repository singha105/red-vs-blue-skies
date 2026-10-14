"""Builds every plane spec and weapon in one headless Blender session (npm run models calls this).

  Blender --background --factory-startup --python tools/blender/build_all.py -- <raw_out_dir> <previews_dir> [ids...]

Writes <raw_out_dir>/<id>.glb + <id>.json (dimensions, empties, triangle count) for planes,
<raw_out_dir>/weapons/<id>.glb + .json for weapons, and a preview PNG per model."""

from __future__ import annotations

import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import plane_kit  # noqa: E402
import render_preview  # noqa: E402
import weapons_kit  # noqa: E402

PROP_BUDGET = 1200
JET_BUDGET = 1500


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
        reset()
        objs, info = plane_kit.build(spec)
        jet = spec["era"] in ("early_jets", "cold_war", "modern")
        budget = JET_BUDGET if jet else PROP_BUDGET
        info["budget"] = budget
        if info["tris"] > budget:
            failures.append(f"{spec['id']}: {info['tris']} triangles > {budget}")
        export(objs, os.path.join(raw_dir, f"{spec['id']}.glb"))
        json.dump(info, open(os.path.join(raw_dir, f"{spec['id']}.json"), "w"), indent=2)
        render_preview.render(objs, os.path.join(prev_dir, f"{spec['id']}.png"))
        print(f"BUILT {spec['id']} tris={info['tris']}/{budget} muzzles={len(info['muzzles'])} pylons={len(info['pylons'])}")

    if not only or "weapons" in only:
        for wid in weapons_kit.WEAPONS:
            reset()
            objs, info = weapons_kit.build_weapon(wid)
            export(objs, os.path.join(raw_dir, "weapons", f"{wid}.glb"))
            json.dump(info, open(os.path.join(raw_dir, "weapons", f"{wid}.json"), "w"), indent=2)
            render_preview.render(objs, os.path.join(prev_dir, f"weapon_{wid}.png"), tint=False)
            print(f"BUILT weapon {wid} tris={info['tris']}")

    if failures:
        print("BUDGET FAILURES:\n" + "\n".join(failures))
        sys.exit(1)


main()
