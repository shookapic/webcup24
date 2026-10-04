# Mairie (town hall) landmark: central hall with an eight-sided glazed roof and lantern, two wings, entrance steps and a canopy on four pillars,
# flag mast and antenna. Dimensions match the world's collision footprints (world/src/layout.js): hall 19.6 x 17.0 m (centre = origin),
# wings 8 x 12 m at x = +-16.5 and 1 m towards the front, canopy platform 5.2 x 4.2 m centred 10.5 m in front, pillars at x = +-2.6, 8.2 / 12.8 m in front.
# Front = glTF +Z = Blender -Y. Origin = centre of the hall footprint on the ground.
# blender -b --factory-startup --python tools/assets/townhall.py -- world/assets-src/colony/townHall.glb
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

reset()
chalk, slate, dark = pal('chalk', roughness=0.9), pal('slate', roughness=0.6, metallic=0.2), pal('slateDark', roughness=0.6, metallic=0.25)
terra, teal = pal('terracotta', roughness=0.8), pal('teal', roughness=0.7)
glass = pal('glass', roughness=0.25, metallic=0.2)
amber = material('beacon', PALETTE['amber'], roughness=0.3, emissive=PALETTE['amber'], emissive_strength=1.4)

HW, HD, WALL_TOP = 9.8, 8.5, 5.7        # hall half width, half depth, wall height
F = -1                                  # front is -Y in Blender

# --- hall ---------------------------------------------------------------------------------------------------------------
box('hallBody', (2 * HW, 2 * HD, WALL_TOP), (0, 0, WALL_TOP / 2), chalk, bevel=0.06)
box('hallBase', (2 * HW + 0.2, 2 * HD + 0.2, 0.5), (0, 0, 0.25), dark)                         # plinth course
box('hallBand', (2 * HW + 0.12, 2 * HD + 0.12, 0.4), (0, 0, 3.2), terra)                        # terracotta frieze
box('hallCornice', (2 * HW + 0.5, 2 * HD + 0.5, 0.3), (0, 0, WALL_TOP + 0.15), slate, bevel=0.04)
for i in range(7):                                                                              # front windows, deep inset
    x = -7.2 + i * 2.4
    if abs(x) < 1.8:
        continue
    box(f'fw{i}', (1.4, 0.2, 2.2), (x, F * (HD + 0.03), 1.9), glass)
    box(f'fwSill{i}', (1.7, 0.3, 0.12), (x, F * (HD + 0.08), 0.72), slate)
    box(f'fwLintel{i}', (1.7, 0.3, 0.14), (x, F * (HD + 0.08), 3.08), slate)
for i in range(6):                                                                              # side windows
    y = -6.2 + i * 2.5
    for sx in (-1, 1):
        box(f'sw{i}{sx}', (0.2, 1.3, 2.0), (sx * (HW + 0.03), y, 1.9), glass)
for i in range(5):                                                                              # back windows
    box(f'bw{i}', (1.4, 0.2, 2.0), (-6.4 + i * 3.2, -F * (HD + 0.03), 1.9), glass)
for i, x in enumerate((-8.4, -5.0, 5.0, 8.4)):                                                  # front pilasters
    box(f'pil{i}', (0.55, 0.45, WALL_TOP - 0.3), (x, F * (HD + 0.2), WALL_TOP / 2 + 0.1), slate, bevel=0.03)
# entrance: recessed glazed doors, surround, three flat steps (<= 0.15 m: the player walks over them, no step collider)
box('door', (3.0, 0.25, 3.4), (0, F * (HD + 0.02), 2.2), glass)
box('doorFrame', (3.6, 0.35, 0.3), (0, F * (HD + 0.12), 3.95), terra, bevel=0.03)
for sx in (-1, 1):
    box(f'doorJamb{sx}', (0.3, 0.35, 3.8), (sx * 1.65, F * (HD + 0.12), 2.2), terra, bevel=0.03)
for i in range(3):
    box(f'step{i}', (5.6 - i * 0.5, 0.55, 0.05), (0, F * (HD + 0.45 + i * 0.5), 0.025 + i * 0.05), chalk, bevel=0.01)

# --- roof: eight-sided glazed drum, ridge lantern, flag mast ------------------------------------------------------------
cylinder('drum', 8.9, 0.5, (0, 0, WALL_TOP + 0.55), slate, vertices=8, bevel=0.05, rotation=(0, 0, 0.3927))
cylinder('roof', 8.5, 2.3, (0, 0, WALL_TOP + 1.95), glass, vertices=8, radius2=3.3, rotation=(0, 0, 0.3927))
cylinder('lanternBase', 3.4, 0.35, (0, 0, WALL_TOP + 3.2), slate, vertices=8, rotation=(0, 0, 0.3927))
cylinder('lantern', 2.5, 1.4, (0, 0, WALL_TOP + 4.0), teal, vertices=8, rotation=(0, 0, 0.3927))
cylinder('lanternRoof', 2.9, 0.7, (0, 0, WALL_TOP + 5.05), slate, vertices=8, radius2=0.5, rotation=(0, 0, 0.3927))
cylinder('mast', 0.07, 2.4, (0, 0, WALL_TOP + 6.5), dark, vertices=6)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.22, segments=10, ring_count=6, location=(0, 0, WALL_TOP + 7.8))
finish(bpy.context.active_object, amber)
box('flag', (0.04, 1.3, 0.8), (0, 0.7, WALL_TOP + 7.2), terra)

# --- wings (8 x 12, centre 1 m towards the front), with arched doors, band and antenna ----------------------------------------
for sx in (-1, 1):
    cx = sx * 16.5
    cy = F * 1.0
    box(f'wing{sx}', (8.0, 12.0, 3.6), (cx, cy, 1.8), chalk, bevel=0.06)
    box(f'wingBase{sx}', (8.2, 12.2, 0.4), (cx, cy, 0.2), dark)
    box(f'wingBand{sx}', (8.12, 12.12, 0.3), (cx, cy, 2.5), terra)
    box(f'wingRoof{sx}', (8.6, 12.6, 0.3), (cx, cy, 3.75), slate, bevel=0.04)
    box(f'wingRoofCap{sx}', (6.0, 10.0, 0.25), (cx, cy, 4.0), chalk, bevel=0.03)
    for k in range(3):                                                                          # front arched doors / windows
        wx = cx + (-2.2 + k * 2.2)
        box(f'wd{sx}{k}', (1.6, 0.2, 2.2), (wx, cy + F * 6.03, 1.5), glass)
        box(f'wdFrame{sx}{k}', (1.9, 0.3, 0.2), (wx, cy + F * 6.08, 2.7), slate)
    for k in range(4):                                                                          # side windows (outer)
        box(f'ws{sx}{k}', (0.2, 1.3, 1.4), (cx + sx * 4.03, cy - 4.2 + k * 2.8, 1.7), glass)
# antenna dish on the east wing
cylinder('dishMast', 0.12, 3.2, (16.5, F * 1.0, 5.6), dark, vertices=6)
cylinder('dish', 1.3, 0.35, (16.5, F * 1.0 - 0.3, 7.4), chalk, vertices=16, radius2=0.2, rotation=(2.0, 0, 0))
cylinder('dishArm', 0.05, 1.4, (16.5, F * 1.0 - 0.6, 7.75), dark, vertices=4, rotation=(0.9, 0, 0))

# --- entrance canopy on four pillars (platform 5.2 x 4.2 at 3.9 m, 10.5 m in front of the hall centre) --------------------------------
box('canopy', (5.2, 4.2, 0.3), (0, F * 10.5, 3.9), slate, bevel=0.05)
box('canopyFascia', (5.3, 0.15, 0.5), (0, F * 12.6, 3.85), terra, bevel=0.02)
box('canopyTop', (4.8, 3.8, 0.1), (0, F * 10.5, 4.1), chalk)
for px in (-2.6, 2.6):
    for py in (8.2, 12.8):
        box(f'pillar{px}{py}', (0.5, 0.5, 3.75), (px, F * py, 1.9), slate, bevel=0.04)
        box(f'pillarBase{px}{py}', (0.9, 0.9, 0.25), (px, F * py, 0.12), dark)
        box(f'pillarCap{px}{py}', (0.8, 0.8, 0.15), (px, F * py, 3.75), dark)

merge_by_material('townHall')
parent_all('townHall')
print('TRIANGLES', bake_modifiers_and_triangles())
if out_path():
    os.makedirs(os.path.dirname(out_path()), exist_ok=True)
    export_glb(out_path())
