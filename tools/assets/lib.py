"""Shared helpers for the colony asset scripts (run inside Blender: blender -b --factory-startup --python tools/assets/<asset>.py).

Conventions (every exported asset): metres, Y up in the GLB (Blender Z up is converted by the exporter), origin at the centre of the
base on the ground, front of the object facing +Z in glTF (-Y in Blender), no cameras/lights, materials are plain PBR colours
(no textures), names are semantic. Each script is deterministic and writes only the file passed with --out.
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector

PALETTE = {
    'chalk': (0.898, 0.878, 0.831),      # #E5E0D4
    'slate': (0.294, 0.353, 0.388),      # #4B5A63
    'slateDark': (0.153, 0.212, 0.247),  # #27363F
    'terracotta': (0.663, 0.396, 0.290), # #A9654A
    'teal': (0.290, 0.549, 0.529),       # #4A8C87
    'amber': (0.914, 0.729, 0.412),      # #E9BA69
    'foliage': (0.408, 0.549, 0.451),    # #688C73
    'bark': (0.541, 0.416, 0.306),       # #8A6A4E
    'glass': (0.208, 0.314, 0.361),      # #35505C
}

def srgb_to_linear(c):
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

_materials = {}
def material(name, color, roughness=0.85, metallic=0.0, emissive=None, emissive_strength=0.0):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb_to_linear(color), 1.0) if max(color) <= 1.0 else color
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    if emissive is not None:
        b.inputs['Emission Color'].default_value = (*srgb_to_linear(emissive), 1.0)
        b.inputs['Emission Strength'].default_value = emissive_strength
    _materials[name] = m
    return m

def pal(name, **kw):
    return material(name, PALETTE[name], **kw)

def finish(obj, mat, bevel=0.0, smooth=False):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = 'ANGLE'
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj

def box(name, size, location, mat, bevel=0.0, rotation=(0, 0, 0)):
    """size = (x, y, z) in Blender axes (x right, y depth [front = -y], z up); location = centre."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, bevel)

def cylinder(name, radius, depth, location, mat, vertices=16, bevel=0.0, rotation=(0, 0, 0), radius2=None):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=location, rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=radius2, depth=depth, vertices=vertices, location=location, rotation=rotation)
    o = bpy.context.active_object
    o.name = name
    return finish(o, mat, bevel)

def merge_by_material(prefix):
    """Join every mesh that shares a material into one object (one draw call per material, fewer nodes in the GLB)."""
    groups = {}
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            groups.setdefault(o.data.materials[0].name, []).append(o)
    for mat_name, objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            bpy.context.view_layer.objects.active = o
            for mod in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)
            o.select_set(True)
        bpy.ops.object.join()
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)   # identity node transform: vertices live in asset space
        bpy.context.active_object.name = f'{prefix}_{mat_name}'
        bpy.context.active_object.data.name = f'{prefix}_{mat_name}'

def parent_all(root_name):
    root = bpy.data.objects.new(root_name, None)
    bpy.context.collection.objects.link(root)
    for o in list(bpy.context.scene.objects):
        if o is not root and o.parent is None:
            o.parent = root
    return root

def bake_modifiers_and_triangles():
    """Apply modifiers and report triangles, so budgets are recorded from the real mesh."""
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    return tris

def export_glb(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_materials='EXPORT', export_extras=False,
                              export_texcoords=False, export_attributes=False)

def out_path():
    argv = sys.argv
    return argv[argv.index('--') + 1] if '--' in argv else None
