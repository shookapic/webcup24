# Colony tree: ~5.3 m, tapered trunk with a root flare and four faceted canopy clusters (deterministic seed). Two materials (bark, foliage)
# so the runtime can recolour the leaves per district/season. Origin at the trunk base.
# blender -b --factory-startup --python tools/assets/tree.py -- world/assets-src/colony/colonyTree.glb
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

reset()
bark, leaves = pal('bark', roughness=0.9), pal('foliage', roughness=0.9)
cylinder('flare', 0.42, 0.5, (0, 0, 0.25), bark, vertices=8, radius2=0.2)
cylinder('trunk', 0.2, 2.6, (0.05, 0, 1.75), bark, vertices=8, radius2=0.13)
cylinder('branchA', 0.1, 1.2, (0.55, 0.1, 3.0), bark, vertices=6, rotation=(0.1, 0.9, 0), radius2=0.05)
cylinder('branchB', 0.1, 1.1, (-0.5, -0.1, 3.1), bark, vertices=6, rotation=(-0.1, -0.85, 0), radius2=0.05)
random.seed(7)
for i, (x, y, z, r) in enumerate(((0.0, 0.0, 4.0, 1.55), (1.05, 0.25, 3.45, 1.1), (-0.95, -0.3, 3.55, 1.15), (0.15, -0.9, 4.75, 0.95))):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(x, y, z))
    o = bpy.context.active_object
    o.name = f'canopy{i}'
    bm = bmesh.new(); bm.from_mesh(o.data)
    for v in bm.verts:                                         # irregular, faceted silhouette
        v.co *= 1.0 + random.uniform(-0.14, 0.14)
        v.co.z *= 0.82
    bm.to_mesh(o.data); bm.free()
    finish(o, leaves)
merge_by_material('colonyTree')
parent_all('colonyTree')
print('TRIANGLES', bake_modifiers_and_triangles())
if out_path():
    os.makedirs(os.path.dirname(out_path()), exist_ok=True)
    export_glb(out_path())
