"""Scoped GLB export of the `hospital` hierarchy (and nothing else): the runtime file is the raw Blender export, because the model has
no textures, one mesh per material and about 6k triangles, so compression would add a decoder dependency for a few kilobytes.

    blender --background world/assets-src/a-hospital/hospital-a-v001.blend --python-exit-code 1 \
        --python tools/assets-a/hospital/export_hospital.py -- --out world/public/models/buildings/hospital-a-v001.glb

Blender writes the glTF axes (+Y up, +Z front) from the model axes used in build_hospital.py. Custom properties are not exported
(export_extras=False) so the file carries no authoring metadata, and no gameplay data exists to export.

File access (checked by asset_paths.py before anything is created or changed; plain resolved-path checks, not an OS sandbox):
  - reads one .blend, the one Blender opened: it must be hospital-a-<version>.blend directly inside <checkout>/world/assets-src/a-hospital/;
  - writes one file, --out: hospital-a-<version>.glb directly inside <checkout>/world/public/models/buildings/; the checkout is derived
    from this file's location, never from the current directory;
  - rejects other directories, nested directories, other suffixes or names, and anything that resolves outside the checkout (`..`,
    symlinks, junctions);
  - refuses to overwrite --out unless --allow-overwrite is given.
The exporter is called for a single GLB with no images, so it is expected to write only that one file; that is Blender's behaviour, not
something these checks enforce. The scene itself is not saved.
"""
import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True                      # importing the guard must not create tools/assets-a/hospital/__pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_paths  # noqa: E402

import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--root", default="hospital", choices=["hospital"])
ap.add_argument("--out", required=True)
ap.add_argument("--allow-overwrite", action="store_true")
args = ap.parse_args(argv)

if bpy.data.filepath == "":
    raise SystemExit("path guard: open the authored world/assets-src/a-hospital/hospital-a-<version>.blend, not an empty scene")
SRC = asset_paths.input_file(bpy.data.filepath, asset_paths.SOURCE_DIR, ".blend", "the opened .blend")
out = asset_paths.output_file(args.out, asset_paths.RUNTIME_DIR, ".glb", "--out")
asset_paths.refuse_overwrite([out], args.allow_overwrite)

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

bpy.ops.export_scene.gltf(
    filepath=str(out), export_format="GLB", use_selection=True,
    export_apply=True, export_yup=True,
    export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
    export_materials="EXPORT", export_image_format="NONE",
    export_draco_mesh_compression_enable=False,
)
print(json.dumps({"status": "exported", "source": str(SRC), "file": str(out), "objects": n, "bytes": out.stat().st_size}, indent=2))
