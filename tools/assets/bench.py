# Colony bench: 2.2 m x 0.6 m, seat top at 0.56 m, backrest on the -Z side in glTF (back at local z = -0.27), front faces +Z.
# blender -b --factory-startup --python tools/assets/bench.py -- world/assets-src/colony/bench.glb
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

reset()
wood, frame, trim = pal('bark', roughness=0.8), pal('slate', roughness=0.6, metallic=0.25), pal('terracotta', roughness=0.8)
# Blender axes: x right, y depth (front = -y), z up
for i, y in enumerate((-0.17, 0.0, 0.17)):                     # seat slats: top at z = 0.56
    box(f'seat{i}', (2.2, 0.15, 0.06), (0, y + 0.06 - 0.06, 0.53), wood, bevel=0.012)
for i, z in enumerate((0.78, 0.92)):                           # backrest slats, slightly reclined
    box(f'back{i}', (2.2, 0.04, 0.11), (0, 0.255 - 0.0 + 0.02 * i, z), wood, bevel=0.01)
for x in (-0.95, 0.95):                                         # side frames: legs, seat rail, back post
    box(f'leg{int(x>0)}', (0.07, 0.5, 0.5), (x, 0.0, 0.25), frame, bevel=0.01)
    box(f'post{int(x>0)}', (0.07, 0.06, 0.52), (x, 0.26, 0.82), frame, bevel=0.01)
    box(f'arm{int(x>0)}', (0.09, 0.5, 0.045), (x, 0.0, 0.64), trim, bevel=0.015)
box('plinth', (2.0, 0.04, 0.02), (0, 0.0, 0.01), frame)         # ground rail keeps the frame from floating on uneven ground
merge_by_material('bench')
parent_all('bench')
print('TRIANGLES', bake_modifiers_and_triangles())
if out_path():
    os.makedirs(os.path.dirname(out_path()), exist_ok=True)
    export_glb(out_path())
