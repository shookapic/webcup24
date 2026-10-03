"""Scoped GLB export of the `hospital` hierarchy (and nothing else): the runtime file is the raw Blender export, because the model has
no textures, one mesh per material and about 6k triangles, so compression would add a decoder dependency for a few kilobytes.

    blender --background world/assets-src/a-hospital/hospital-a-v001.blend --python tools/assets-a/hospital/export_hospital.py -- \
        --out world/public/models/buildings/hospital-a-v001.glb

Blender writes the glTF axes (+Y up, +Z front) from the model axes used in build_hospital.py. Custom properties are not exported
(export_extras=False) so the file carries no authoring metadata, and no gameplay data exists to export.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--root", default="hospital")
ap.add_argument("--out", required=True)
ap.add_argument("--allow-overwrite", action="store_true")
args = ap.parse_args(argv)

out = Path(args.out).resolve()
if out.exists() and not args.allow_overwrite:
    raise SystemExit(f"refusing to overwrite {out} (bump the version or pass --allow-overwrite)")
if bpy.data.filepath == "":
    raise SystemExit("open the authored .blend, not an empty scene")

root = bpy.data.objects[args.root]
bpy.ops.object.select_all(action="DESELECT")
stack, n = [root], 0
while stack:
    ob = stack.pop()
    stack.extend(ob.children)
    ob.hide_set(False)
    ob.select_set(True)
    n += 1
bpy.context.view_layer.objects.active = root

out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(out), export_format="GLB", use_selection=True,
    export_apply=True, export_yup=True,
    export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
    export_materials="EXPORT", export_image_format="NONE",
    export_draco_mesh_compression_enable=False,
)
print(json.dumps({"status": "exported", "file": str(out), "objects": n, "bytes": out.stat().st_size}, indent=2))
