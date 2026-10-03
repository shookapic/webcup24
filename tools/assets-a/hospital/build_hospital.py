"""Terra Nova, Santé district: the main clinic ("hospital"), authored from scratch, procedurally, in Blender 5.x.

    blender --background --factory-startup --python-exit-code 1 --python tools/assets-a/hospital/build_hospital.py -- \
        --out world/assets-src/a-hospital/hospital-a-v001.blend

Contract (docs/ASSET_HANDOFF_A.md): model axes X right, Y up, Z = front (the entrance side), metres, origin at the centre of the
ground footprint, footprint 14.715 (X) x 12.735 (Z) = the committed hangar_roundA x 4.5 collision box, every part of the model inside
that footprint (so no porch, sign or window projects beyond the collision box). Roof elements may rise above 6.75 m (reported by the
validator). One mesh per material, root object `hospital`, materials named Hospital_*. No gameplay / service / interaction data.

Everything is built from tagged primitives (obj["managed"]); re-running rebuilds the same scene.

File access (checked by asset_paths.py before anything is created; plain resolved-path checks, not an OS sandbox):
  - writes exactly two files, both directly inside <checkout>/world/assets-src/a-hospital/: --out (must be hospital-a-<version>.blend)
    and its sibling <name>.build-report.json; the checkout is derived from this file's location, never from the current directory;
  - rejects any other directory, a nested directory, other suffixes or names, and anything that resolves outside the checkout (`..`,
    symlinks, junctions);
  - refuses to overwrite either output unless --allow-overwrite is given (all outputs together, nothing is written if one exists);
  - must start from the factory scene (--factory-startup), and Blender's .blend1 backup is switched off so no third file appears.
Blender still writes a temporary '<name>.blend@' next to the output while saving and renames it.
"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True                      # importing the guard must not create tools/assets-a/hospital/__pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_paths  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--allow-overwrite", action="store_true")
args = ap.parse_args(argv)
if bpy.data.filepath:
    raise SystemExit(f"path guard: start from the factory scene (--factory-startup), not from the opened file {bpy.data.filepath}")
OUT = asset_paths.output_file(args.out, asset_paths.SOURCE_DIR, ".blend", "--out")
REPORT = asset_paths.output_file(OUT.with_suffix(".build-report.json"), asset_paths.SOURCE_DIR, ".json", "the build report (sibling of --out)")
asset_paths.refuse_overwrite([OUT, REPORT], args.allow_overwrite)
bpy.context.preferences.filepaths.save_version = 0       # no .blend1 backup file next to the output

VERSION = 1
FOOT_W, FOOT_D = 14.715, 12.735          # hangar_roundA [3.27, 1.5, 2.83] x 4.5 (width, depth), unrotated
HX, HZ = FOOT_W / 2, FOOT_D / 2
FX, BZ, CZ, WZ, IX = 7.2075, -6.2175, 6.2175, 5.2, 2.85   # outer side wall, back wall, central front wall, wing front wall, inner wing/central x
APRON, PLINTH, FLOOR1, FLOOR2, ROOF_W, ROOF_C, PARAPET = 0.12, 0.35, 3.2, 3.2, 6.0, 6.25, 0.45

# palette of B's kit (world/src/kit.jsx) plus the Santé accent
PALETTE = {
    "Hospital_Ceramic":    ("#e5e0d4", 0.85, 0.0, None),   # chalk
    "Hospital_Slate":      ("#6c7f89", 0.70, 0.1, None),
    "Hospital_Teal":       ("#4a8c87", 0.80, 0.0, None),   # Santé accent
    "Hospital_Terracotta": ("#a9654a", 0.80, 0.0, None),
    "Hospital_Amber":      ("#d09a3e", 0.75, 0.0, None),
    "Hospital_Glass":      ("#4a7080", 0.30, 0.0, None),
    "Hospital_LobbyGlass": ("#40677a", 0.30, 0.0, ("#ffd9a0", 0.10)),    # glass with a faint warm light behind it, kept low so it never reaches the bloom threshold
    "Hospital_Paving":     ("#cdb59b", 1.00, 0.0, None),
}


def lin(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def rgba(hex_color):
    h = hex_color.lstrip("#")
    return (lin(int(h[0:2], 16) / 255), lin(int(h[2:4], 16) / 255), lin(int(h[4:6], 16) / 255), 1.0)


def P(x, y, z):
    """model (X right, Y up, Z front) -> Blender (X, Y, Z up); the glTF exporter maps Blender -Y back to +Z (front)."""
    return Vector((x, -z, y))


bms = {name: bmesh.new() for name in PALETTE}


def box(mat, cx, cy, cz, w, h, d, rot_x=0.0):
    bm = bms[mat]
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    m = Matrix.Translation(P(cx, cy, cz)) @ Matrix.Rotation(rot_x, 4, "X") @ Matrix.Diagonal((w, d, h, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=verts)


def span(mat, x0, x1, y0, y1, z0, z1):
    box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0)


def cyl(mat, cx, cy, cz, r, h, axis="y", seg=28):
    bm = bms[mat]
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=h)["verts"]
    rot = Matrix.Rotation(math.pi / 2, 4, "X") if axis == "z" else Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(P(cx, cy, cz)) @ rot, verts=verts)


def local(normal, plane, u, v, n):
    if normal == "+z":
        return u, v, plane + n
    if normal == "-z":
        return u, v, plane - n
    if normal == "+x":
        return plane + n, v, u
    return plane - n, v, u


def lbox(mat, normal, plane, u, v, n, wu, h, t):
    x, y, z = local(normal, plane, u, v, n)
    box(mat, x, y, z, wu if normal in ("+z", "-z") else t, h, t if normal in ("+z", "-z") else wu)


def window(normal, plane, u, v, w=0.95, h=1.5):
    lbox("Hospital_Glass", normal, plane, u, v, 0.03, w, h, 0.06)                       # glass
    lbox("Hospital_Slate", normal, plane, u, v + h / 2 + 0.05, 0.05, w + 0.2, 0.10, 0.10)  # head
    for side in (-1, 1):
        lbox("Hospital_Slate", normal, plane, u + side * (w / 2 + 0.05), v, 0.05, 0.10, h + 0.2, 0.10)  # jambs
    lbox("Hospital_Slate", normal, plane, u, v, 0.06, 0.05, h, 0.08)                    # mullion
    lbox("Hospital_Slate", normal, plane, u, v + 0.18, 0.06, w, 0.05, 0.08)             # transom
    lbox("Hospital_Ceramic", normal, plane, u, v - h / 2 - 0.10, 0.07, w + 0.3, 0.08, 0.14)  # sill


def build():
    # ground: paved apron = the exact collision footprint
    span("Hospital_Paving", -HX, HX, 0.0, APRON, -HZ, HZ)

    # --- massing
    for sgn in (-1, 1):
        x0, x1 = (IX, FX) if sgn > 0 else (-FX, -IX)
        span("Hospital_Ceramic", x0, x1, APRON, ROOF_W, BZ, WZ)                                  # wing walls
    span("Hospital_Ceramic", -IX, IX, APRON, FLOOR1, BZ, 4.5675)                                 # central ground floor behind the porch
    for sgn in (-1, 1):
        px0, px1 = (2.2, IX) if sgn > 0 else (-IX, -2.2)
        span("Hospital_Ceramic", px0, px1, APRON, FLOOR1, 4.5675, CZ)                            # porch piers
    span("Hospital_Teal", -2.2, 2.2, 2.95, FLOOR2, 4.5675, CZ)                                    # canopy soffit (between the piers: no overlap with them)
    span("Hospital_Ceramic", -IX, IX, FLOOR2, ROOF_C, BZ, CZ)                                    # central upper block
    # plinth and floor bands, proud of the walls but inside the footprint
    for sgn in (-1, 1):
        x0, x1 = (IX, FX + 0.08) if sgn > 0 else (-FX - 0.08, -IX)
        span("Hospital_Slate", x0, x1, APRON, PLINTH, BZ - 0.08, WZ + 0.08)
        outer = FX + 0.07
        xa, xb = (IX, outer) if sgn > 0 else (-outer, -IX)
        span("Hospital_Slate", xa, xb, 3.15, 3.40, BZ - 0.07, WZ + 0.07)
    span("Hospital_Slate", -IX, IX, APRON, PLINTH, BZ - 0.08, 4.5675)
    span("Hospital_Slate", -IX, IX, 3.15, 3.40, BZ - 0.07, 4.5675)

    # --- entrance: recessed porch, steps, glazed doors
    span("Hospital_Slate", -2.1, 2.1, APRON, 0.24, 5.2, 5.8)                                      # step A
    span("Hospital_Slate", -2.1, 2.1, APRON, PLINTH, 4.5675, 5.2)                                 # step B (door sill level)
    span("Hospital_Ceramic", -2.2, 2.2, PLINTH, 2.95, 4.5675, 4.6)                                 # wall plane behind the glass
    zf = 4.6
    for x0, x1 in ((-1.5, -0.04), (0.04, 1.5), (-2.05, -1.55), (1.55, 2.05)):
        span("Hospital_LobbyGlass", x0, x1, PLINTH + 0.02, 2.6, zf, zf + 0.05)
    span("Hospital_LobbyGlass", -2.05, 2.05, 2.64, 2.92, zf, zf + 0.05)                          # transom light
    for x in (-2.08, -1.52, 0.0, 1.52, 2.08):
        span("Hospital_Slate", x - 0.035, x + 0.035, PLINTH, 2.93, zf, zf + 0.09)               # mullions
    span("Hospital_Slate", -2.12, 2.12, 2.6, 2.64, zf, zf + 0.09)                                 # transom rail
    span("Hospital_Slate", -2.12, 2.12, PLINTH, PLINTH + 0.04, zf, zf + 0.09)                     # bottom rail
    for sgn in (-1, 1):
        box("Hospital_Ceramic", sgn * 0.18, 1.2, zf + 0.1, 0.05, 0.5, 0.05)                      # door pulls
        box("Hospital_Amber", sgn * 2.14, 2.4, 5.35, 0.16, 0.16, 0.16)                           # warm entrance lamps on the piers

    # --- health symbol on the facade: teal ring, chalk disc, terracotta cross
    cx, cy = 0.0, 4.75
    cyl("Hospital_Teal", cx, cy, CZ + 0.035, 1.15, 0.07, axis="z")
    cyl("Hospital_Ceramic", cx, cy, CZ + 0.065, 0.95, 0.05, axis="z")
    box("Hospital_Terracotta", cx, cy, CZ + 0.09, 1.25, 0.40, 0.05)
    box("Hospital_Terracotta", cx, cy, CZ + 0.09, 0.40, 1.25, 0.05)

    # --- windows
    for u in (3.75, 5.10, 6.45):
        for sgn in (-1, 1):
            for v in (1.95, 4.75):
                window("+z", WZ, sgn * u, v)                                                       # wing fronts
    for v in (4.75,):
        for sgn in (-1, 1):
            window("+z", CZ, sgn * 2.0, v, w=0.9)                                                 # beside the symbol
    for z in (-4.6, -2.8, -1.0, 0.8, 2.6, 4.2):
        for v in (1.95, 4.75):
            window("-x", -FX, z, v)
            window("+x", FX, z, v)                                                                 # side walls
    for u in (3.6, 5.0, 6.4):
        for sgn in (-1, 1):
            for v in (1.95, 4.75):
                window("-z", BZ, sgn * u, v)                                                       # back of the wings
    for sgn in (-1, 1):
        window("-z", BZ, sgn * 1.0, 4.75, w=0.9)
    # ambulance bay at the back (a flat opening with a teal frame and a terracotta lintel; nothing projects)
    span("Hospital_Glass", -1.7, 1.7, PLINTH, 2.8, BZ - 0.04, BZ)
    for x0, x1, y0, y1 in ((-1.9, -1.7, PLINTH, 2.95), (1.7, 1.9, PLINTH, 2.95), (-1.9, 1.9, 2.8, 2.95)):
        span("Hospital_Teal", x0, x1, y0, y1, BZ - 0.1, BZ)
    span("Hospital_Terracotta", -1.9, 1.9, 2.95, 3.1, BZ - 0.1, BZ)
    for i in range(7):
        span("Hospital_Slate", -1.6 + i * 0.5, -1.55 + i * 0.5, PLINTH + 0.05, 2.75, BZ - 0.07, BZ - 0.04)  # roller-door slats

    # --- roofs: membrane, teal parapets
    def parapet(x0, x1, z0, z1, y0, sides):
        t, h = 0.22, PARAPET
        if "n" in sides:
            span("Hospital_Teal", x0, x1, y0, y0 + h, z0, z0 + t)
        if "s" in sides:
            span("Hospital_Teal", x0, x1, y0, y0 + h, z1 - t, z1)
        if "w" in sides:
            span("Hospital_Teal", x0, x0 + t, y0, y0 + h, z0, z1)
        if "e" in sides:
            span("Hospital_Teal", x1 - t, x1, y0, y0 + h, z0, z1)

    span("Hospital_Slate", -FX + 0.22, -IX, ROOF_W, ROOF_W + 0.03, BZ + 0.22, WZ - 0.22)
    span("Hospital_Slate", IX, FX - 0.22, ROOF_W, ROOF_W + 0.03, BZ + 0.22, WZ - 0.22)
    parapet(-FX, -IX, BZ, WZ, ROOF_W, "nsw")
    parapet(IX, FX, BZ, WZ, ROOF_W, "nse")
    span("Hospital_Slate", -IX + 0.22, IX - 0.22, ROOF_C, ROOF_C + 0.03, BZ + 0.22, CZ - 0.22)
    parapet(-IX, IX, BZ, CZ, ROOF_C, "nswe")

    # --- roof furniture (visible from the elevated T2 tram): helipad, solar panels, plant room, flat roof cross
    hx, hz, ry = -5.1, -0.5, ROOF_W + 0.03
    cyl("Hospital_Amber", hx, ry + 0.015, hz, 1.75, 0.03, seg=36)
    cyl("Hospital_Slate", hx, ry + 0.035, hz, 1.5, 0.03, seg=36)
    for sgn in (-1, 1):
        box("Hospital_Ceramic", hx + sgn * 0.38, ry + 0.06, hz, 0.18, 0.03, 1.1)
    box("Hospital_Ceramic", hx, ry + 0.06, hz, 0.76, 0.03, 0.18)
    for px in (3.8, 5.15, 6.5):
        for pz in (-3.7, -1.7):
            box("Hospital_Glass", px, ry + 0.34, pz, 1.1, 0.05, 0.75, rot_x=math.radians(-18))
            for sx in (-0.4, 0.4):
                box("Hospital_Slate", px + sx, ry + 0.12, pz, 0.06, 0.24, 0.08)
    span("Hospital_Slate", -1.6, 1.6, ROOF_C + 0.03, 7.65, -5.2, -2.2)                              # plant room
    span("Hospital_Teal", -1.7, 1.7, 7.65, 7.75, -5.3, -2.1)                                        # its roof cap
    for i in range(6):
        span("Hospital_Ceramic", -1.45 + i * 0.5, -1.35 + i * 0.5, 6.7, 7.4, -2.2, -2.16)            # louvres, 4 cm proud of the front face (no coplanar faces)
    for vx in (-1.95, 1.95):
        cyl("Hospital_Slate", vx, ROOF_C + 0.03 + 0.5, -1.4, 0.22, 1.0, seg=16)
        cyl("Hospital_Teal", vx, ROOF_C + 0.03 + 1.02, -1.4, 0.26, 0.06, seg=16)
    span("Hospital_Teal", -1.4, 1.4, ROOF_C + 0.03, ROOF_C + 0.07, 0.8, 3.6)                       # roof cross on a teal pad
    box("Hospital_Terracotta", 0.0, ROOF_C + 0.09, 2.2, 1.7, 0.04, 0.5)
    box("Hospital_Terracotta", 0.0, ROOF_C + 0.09, 2.2, 0.5, 0.04, 1.7)


def finish():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for item in list(coll):
            coll.remove(item)
    root = bpy.data.objects.new("hospital", None)
    root.empty_display_type = "PLAIN_AXES"
    bpy.context.scene.collection.objects.link(root)
    root["managed"] = True
    mats = {}
    for name, (color, rough, metal, emit) in PALETTE.items():
        m = bpy.data.materials.new(name)
        if m.node_tree is None:
            m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = rgba(color)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if emit:
            bsdf.inputs["Emission Color"].default_value = rgba(emit[0])
            bsdf.inputs["Emission Strength"].default_value = emit[1]
        m["managed"] = True
        mats[name] = m
    for name, bm in bms.items():
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        mesh = bpy.data.meshes.new(name.replace("Hospital_", "hospital_").lower())
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mats[name])
        obj = bpy.data.objects.new(mesh.name, mesh)
        obj.parent = root
        obj["managed"] = True
        bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    return root


def validate(root):
    report = {"objects": {}, "triangles": 0}
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in root.children:
        mesh = obj.data
        assert len(mesh.polygons) > 0, f"{obj.name} is empty"
        assert len(mesh.materials) == 1, f"{obj.name} must have one material"
        tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
        report["triangles"] += tris
        report["objects"][obj.name] = {"triangles": tris, "material": mesh.materials[0].name}
        for v in mesh.vertices:
            w = obj.matrix_world @ v.co
            m = Vector((w.x, w.z, -w.y))                      # back to model axes: X, Y up, Z front
            lo = Vector((min(lo[i], m[i]) for i in range(3)))
            hi = Vector((max(hi[i], m[i]) for i in range(3)))
    report["bounds_min"] = [round(c, 4) for c in lo]
    report["bounds_max"] = [round(c, 4) for c in hi]
    report["size"] = [round(hi[i] - lo[i], 4) for i in range(3)]
    eps = 1e-3
    assert abs(lo.x + HX) < eps and abs(hi.x - HX) < eps, f"X extent {lo.x}..{hi.x} != footprint"
    assert abs(lo.z + HZ) < eps and abs(hi.z - HZ) < eps, f"Z extent {lo.z}..{hi.z} != footprint"
    assert abs(lo.y) < eps, f"ground is not at y=0 ({lo.y})"
    assert hi.y > 6.5, "model is too low"
    report["footprint"] = [FOOT_W, FOOT_D]
    return report


def main():
    build()
    root = finish()
    report = {"status": "built", "version": VERSION, "validation": validate(root)}
    root["asset_version"] = VERSION
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=True)
    REPORT.write_text(json.dumps(report, indent=2) + chr(10))
    print(json.dumps(report, indent=2))


main()
