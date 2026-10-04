# Colony street lamp: 4.3 m, slate pole on a plinth, hexagonal lantern with a restrained amber glow, terracotta cap. Origin at base centre.
# blender -b --factory-startup --python tools/assets/lamp.py -- world/assets-src/colony/streetLamp.glb
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

reset()
slate, dark, cap = pal('slate', roughness=0.55, metallic=0.3), pal('slateDark', roughness=0.6, metallic=0.25), pal('terracotta', roughness=0.75)
glow = material('lampGlass', PALETTE['amber'], roughness=0.3, emissive=PALETTE['amber'], emissive_strength=1.2)
cylinder('plinth', 0.22, 0.2, (0, 0, 0.1), dark, vertices=10, bevel=0.015)
cylinder('flare', 0.14, 0.5, (0, 0, 0.45), slate, vertices=10, radius2=0.085)
cylinder('pole', 0.085, 3.0, (0, 0, 2.2), slate, vertices=10, radius2=0.065)
cylinder('collar', 0.11, 0.08, (0, 0, 1.2), dark, vertices=10)
cylinder('collarTop', 0.1, 0.07, (0, 0, 3.65), dark, vertices=10)
cylinder('cradle', 0.2, 0.08, (0, 0, 3.72), dark, vertices=6, bevel=0.01)
cylinder('lantern', 0.2, 0.44, (0, 0, 3.98), glow, vertices=6)
for i in range(6):                                           # frame ribs around the glass
    a = i * 3.14159265 / 3
    box(f'rib{i}', (0.03, 0.03, 0.46), (0.205 * math.cos(a), 0.205 * math.sin(a), 3.98), dark)
cylinder('roof', 0.3, 0.2, (0, 0, 4.3), cap, vertices=6, radius2=0.04)
cylinder('finial', 0.04, 0.12, (0, 0, 4.46), dark, vertices=6)
merge_by_material('streetLamp')
parent_all('streetLamp')
print('TRIANGLES', bake_modifiers_and_triangles())
if out_path():
    os.makedirs(os.path.dirname(out_path()), exist_ok=True)
    export_glb(out_path())
