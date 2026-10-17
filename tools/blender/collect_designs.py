"""Collects every plane design into Blender files you can open and look around in (npm run designs).

  Blender --background --factory-startup --python tools/blender/collect_designs.py -- <out_dir>

Writes <out_dir>/all_planes.blend (every plane on one hangar floor: a row per era, a collection per era, a label
under each plane) and <out_dir>/<era>/<id>.blend (one plane each). The planes are rebuilt from the specs at the
detail level the game ships (read from tools/blender/build/<id>.json, so run `npm run models` first) and wear the
baked detail texture (AO + panel lines) with the team faces painted blue. The files are for looking at: the game
still uses the .glb files `npm run models` writes, and edits belong in the specs and kits."""

from __future__ import annotations

import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bake_kit  # noqa: E402
import plane_kit  # noqa: E402

ERAS = ["ww1", "early_ww2", "late_ww2", "early_jets", "cold_war", "modern", "bombers"]
ERA_NAMES = {
    "ww1": "WW1",
    "early_ww2": "Early WW2",
    "late_ww2": "Late WW2",
    "early_jets": "Early jets",
    "cold_war": "Cold War",
    "modern": "Modern",
    "bombers": "AI bombers",
}
TEAM_BLUE = plane_kit.hex_lin("#2f7de1")
BUILD = os.path.join(HERE, "build")


def plane_names() -> dict:
    planes = json.load(open(os.path.join(HERE, "..", "..", "src", "data", "planes.json")))
    names = {p["id"]: p["name"] for p in planes}
    names.update({"bomber_ww1": "WW1 bomber", "bomber_ww2": "WW2 bomber", "bomber_jet": "Jet bomber"})
    return names


def specs() -> list:
    out = []
    spec_dir = os.path.join(HERE, "specs")
    for fname in sorted(os.listdir(spec_dir)):
        if fname.endswith(".json"):
            out.append(json.load(open(os.path.join(spec_dir, fname))))
    return out


def mix_multiply(nt, location):
    """A Mix node multiplying two colours. Its inputs and outputs are found by identifier: the node has float,
    vector and colour sockets that share the names "A", "B" and "Result"."""
    node = nt.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "MULTIPLY"
    node.location = location
    node.inputs["Factor"].default_value = 1.0
    a = next(i for i in node.inputs if i.identifier == "A_Color")
    b = next(i for i in node.inputs if i.identifier == "B_Color")
    out = next(o for o in node.outputs if o.identifier == "Result_Color")
    return a, b, out


def dress(body, plane_id: str) -> None:
    """Per-plane copies of the kit's materials: vertex colour × the baked detail texture; TEAM faces blue."""
    png = os.path.join(BUILD, f"{plane_id}_detail.png")
    image = bpy.data.images.load(png, check_existing=True) if os.path.exists(png) else None
    if image:
        # The alpha channel is the team mask, not transparency: straight alpha would black out the paint
        # wherever the mask is 0.
        image.alpha_mode = "CHANNEL_PACKED"
        image.pack()
    for slot in body.material_slots:
        src = slot.material
        if src is None:
            continue
        m = src.copy()
        m.name = f"{plane_id}_{src.name}"
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        col = nt.nodes.new("ShaderNodeVertexColor")
        col.layer_name = "Col"
        col.location = (-700, 300)
        colour = col.outputs["Color"]
        if src.name == "TEAM":
            a, b, out = mix_multiply(nt, (-450, 300))
            b.default_value = TEAM_BLUE
            nt.links.new(colour, a)
            colour = out
        if image and src.name != "GLASS":
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = image
            tex.location = (-700, 0)
            a, b, out = mix_multiply(nt, (-250, 200))
            nt.links.new(colour, a)
            nt.links.new(tex.outputs["Color"], b)
            colour = out
        nt.links.new(colour, bsdf.inputs["Base Color"])
        m.diffuse_color = (*TEAM_BLUE[:3], 1) if src.name == "TEAM" else m.diffuse_color
        slot.material = m


def build_plane(spec: dict, collection, label: str):
    """Builds one plane under an empty named after it, linked into `collection`. Returns the empty."""
    info_path = os.path.join(BUILD, f"{spec['id']}.json")
    level = json.load(open(info_path)).get("detail", "high") if os.path.exists(info_path) else "high"
    plane_kit.set_detail(level)
    objs, _ = plane_kit.build(spec)
    body = next(o for o in objs if o.name.startswith("body"))
    bake_kit.unwrap(body)
    dress(body, spec["id"])
    root = bpy.data.objects.new(label, None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 1.0
    collection.objects.link(root)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        collection.objects.link(o)
        if o.parent is None:
            o.parent = root
        o.name = f"{spec['id']}_{o.name.split('.')[0]}"
    return root


def add_label(text: str, collection, location, size: float):
    curve = bpy.data.curves.new(f"label_{text}", "FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    obj = bpy.data.objects.new(f"label {text}", curve)
    obj.location = location
    collection.objects.link(obj)
    return obj


def view_setup(shading_vertex: bool) -> None:
    """Viewports open in Material Preview so the paint and baked panel lines show straight away."""
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "MATERIAL"
                    space.clip_end = 5000
                    if shading_vertex:
                        space.shading.color_type = "VERTEX"


def fresh_scene() -> None:
    bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = os.path.abspath(argv[0] if argv else os.path.join(HERE, "..", "..", "designs"))
    os.makedirs(out_dir, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups when rebuilding over old files
    names = plane_names()
    all_specs = specs()

    # One file per plane.
    for spec in all_specs:
        fresh_scene()
        scene = bpy.context.scene
        build_plane(spec, scene.collection, names.get(spec["id"], spec["id"]))
        view_setup(False)
        era_dir = os.path.join(out_dir, spec["era"])
        os.makedirs(era_dir, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(era_dir, f"{spec['id']}.blend"), compress=True)
        print(f"SAVED {spec['era']}/{spec['id']}.blend")

    # Everything on one floor: a row per era (front to back), planes side by side, a label under each.
    fresh_scene()
    scene = bpy.context.scene
    scene.name = "Red vs Blue Skies planes"
    row_y = 0.0
    for era in ERAS:
        era_specs = [s for s in all_specs if s["era"] == era]
        if not era_specs:
            continue
        coll = bpy.data.collections.new(ERA_NAMES[era])
        scene.collection.children.link(coll)
        gap = max(max(s["wingspanM"], s["lengthM"]) for s in era_specs) + 6
        x = 0.0
        add_label(ERA_NAMES[era], coll, (-gap, row_y, 0), 4.0)
        for spec in era_specs:
            label = names.get(spec["id"], spec["id"])
            root = build_plane(spec, coll, label)
            root.location = (x, row_y, 0)
            add_label(label, coll, (x, row_y - spec["lengthM"] * 0.5 - 3, -2), 1.2)
            x += gap
        row_y -= gap + 8
        print(f"ROW {era}: {len(era_specs)} planes")
    view_setup(False)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "all_planes.blend"), compress=True)
    print(f"SAVED all_planes.blend in {out_dir}")


main()
