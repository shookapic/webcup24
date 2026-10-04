# Quick Workbench preview of a GLB for review: blender -b --factory-startup --python tools/assets/preview.py -- in.glb out.png [azimuth_deg] [elevation_deg] [distance]
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
az, el, dist = (float(argv[2]) if len(argv) > 2 else 35), (float(argv[3]) if len(argv) > 3 else 22), (float(argv[4]) if len(argv) > 4 else 0)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
centre = (lo + hi) / 2; size = (hi - lo).length
d = dist or size * 1.15
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.collection.objects.link(cam)
a, e = math.radians(az), math.radians(el)
cam.location = centre + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * d
cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam
s = bpy.context.scene
s.render.engine = 'BLENDER_WORKBENCH'
s.display.shading.light = 'STUDIO'; s.display.shading.color_type = 'MATERIAL'; s.display.shading.show_shadows = True
s.render.resolution_x, s.render.resolution_y = 1100, 760
import os
s.render.filepath = os.path.abspath(out)
bpy.ops.render.render(write_still=True)
print('TRIS', sum(len(o.data.polygons) for o in objs), 'bbox', tuple(round(v, 2) for v in (hi - lo)))
