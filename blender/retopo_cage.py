#!/usr/bin/env python3
"""Build a retopologized deformation cage shrinkwrapped onto a Marching Cubes mesh."""
from __future__ import annotations
import math
import bmesh, bpy
from mathutils import Matrix, Vector


def _rot_z_to_dir(direction: Vector) -> Matrix:
    """3×3 rotation matrix that maps +Z to direction."""
    z = direction.normalized()
    dot = Vector((0, 0, 1)).dot(z)
    if abs(dot) > 0.9999:
        return Matrix.Identity(3) if dot > 0 else Matrix.Rotation(math.pi, 3, 'X')
    return Vector((0, 0, 1)).rotation_difference(z).to_matrix()


def _add_cylinder(bm: bmesh.types.BMesh, p1, p2, radius: float,
                  n_sides: int = 8, n_segs: int = 3) -> None:
    p1, p2 = Vector(p1), Vector(p2)
    direction = p2 - p1
    if direction.length < 0.001:
        return
    rot = _rot_z_to_dir(direction)
    rings = []
    for s in range(n_segs + 1):
        t = s / n_segs
        pos = p1 + direction * t
        ring = [bm.verts.new(pos + rot @ Vector((math.cos(a * math.tau / n_sides) * radius,
                                                  math.sin(a * math.tau / n_sides) * radius, 0)))
                for a in range(n_sides)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(n_sides):
            bm.faces.new([r0[j], r0[(j+1)%n_sides], r1[(j+1)%n_sides], r1[j]])
    bm.faces.new(rings[0][::-1])   # bottom cap: CW from +Z → normal -Z (outward)
    bm.faces.new(rings[-1])        # top cap: CCW from +Z → normal +Z (outward)


def _add_sphere(bm: bmesh.types.BMesh, center, radius: float,
                u: int = 8, v: int = 6) -> None:
    before = len(bm.verts)
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    bm.verts.ensure_lookup_table()
    c = Vector(center)
    for vert in bm.verts[before:]:
        vert.co += c


def _build_biped(bm, cx, cy, low, high, sx, sy, sz):
    tr = sx * 0.28
    _add_cylinder(bm, (cx, cy, low.z + sz*.20), (cx, cy, low.z + sz*.72), tr, 12)
    _add_cylinder(bm, (cx, cy, low.z + sz*.72), (cx, cy, low.z + sz*.82), tr * 0.44, 8)
    _add_sphere(bm, (cx, cy, low.z + sz*.91), min(sx, sz * 0.22) * 0.48)
    for sign in (1, -1):
        x1 = cx + sign * sx * .12
        x2 = cx + sign * sx * .32
        x3 = cx + sign * sx * .48
        ar = sx * 0.075
        _add_cylinder(bm, (x1, cy, low.z+sz*.65), (x2, cy, low.z+sz*.48), ar, 8)
        _add_cylinder(bm, (x2, cy, low.z+sz*.48), (x3, cy, low.z+sz*.35), ar*0.82, 8)
        xL = cx + sign * sx * .16
        lr = sx * 0.085
        _add_cylinder(bm, (xL, cy, low.z+sz*.24), (xL, cy, low.z+sz*.12), lr, 8)
        _add_cylinder(bm, (xL, cy, low.z+sz*.12), (xL, cy, low.z), lr*0.82, 8)


def _build_quadruped(bm, cx, cy, cz, low, high, sx, sy, sz, avian=False):
    br = min(sx, sy) * 0.26
    _add_cylinder(bm, (cx, high.y-sy*.15, cz), (cx, low.y+sy*.25, cz), br, 12)
    _add_cylinder(bm, (cx, low.y+sy*.25, cz), (cx, low.y+sy*.12, low.z+sz*.72), br*0.40, 8)
    _add_sphere(bm, (cx, low.y, low.z+sz*.75), br*0.52)
    _add_cylinder(bm, (cx, high.y-sy*.12, cz), (cx, high.y, cz), br*0.36, 8)
    for sign in (1, -1):
        lr = br * 0.26
        for ry in (low.y + sy*.25, high.y - sy*.18):
            x = cx + sign * sx * .20
            _add_cylinder(bm, (x, ry, cz), (x, ry, low.z+sz*.22), lr, 8)
            _add_cylinder(bm, (x, ry, low.z+sz*.22), (x, ry, low.z), lr*0.82, 8)
        if avian:
            wx = cx + sign * sx * .48
            _add_cylinder(bm, (cx+sign*sx*.10, cy, low.z+sz*.58), (wx, cy, low.z+sz*.55), br*0.20, 6)


def _build_serpentine(bm, cx, cy, cz, low, high, sx, sy, sz):
    gr = sz * 0.26
    for i in range(8):
        y0 = high.y - sy * (i / 8)
        y1 = high.y - sy * ((i + 1) / 8)
        _add_cylinder(bm, (cx, y0, cz), (cx, y1, cz), gr, 12, 2)
    _add_sphere(bm, (cx, low.y, cz), sz * 0.20)


def _build_floating(bm, cx, cy, cz, low, high, sx, sy, sz):
    cr = min(sx, sz) * 0.30
    _add_sphere(bm, (cx, cy, cz), cr)
    for i in range(3):
        angle = i * math.tau / 3
        ex = cx + math.cos(angle) * sx * .42
        ey = cy + math.sin(angle) * sy * .42
        _add_cylinder(bm, (cx, cy, low.z+sz*.32), (ex, ey, low.z+sz*.25), cr*0.22, 6)


def build_cage(skeleton: str, low: Vector, high: Vector,
               mc_obj: bpy.types.Object) -> bpy.types.Object:
    """Build a retopologized cage shrinkwrapped onto mc_obj.

    The cage becomes the rigged export mesh; mc_obj is removed after the modifier is applied.
    """
    center = (low + high) * 0.5
    cx, cy, cz = center.x, center.y, center.z
    sx = (high - low).x; sy = (high - low).y; sz = (high - low).z

    bm = bmesh.new()
    if skeleton == "Biped":
        _build_biped(bm, cx, cy, low, high, sx, sy, sz)
    elif skeleton == "Quadruped":
        _build_quadruped(bm, cx, cy, cz, low, high, sx, sy, sz, avian=False)
    elif skeleton == "Avian":
        _build_quadruped(bm, cx, cy, cz, low, high, sx, sy, sz, avian=True)
    elif skeleton == "Serpentine":
        _build_serpentine(bm, cx, cy, cz, low, high, sx, sy, sz)
    else:
        _build_floating(bm, cx, cy, cz, low, high, sx, sy, sz)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    base_name = mc_obj.name.replace("GEO_", "")
    mesh_data = bpy.data.meshes.new(f"MESH_{base_name}")
    bm.to_mesh(mesh_data)
    bm.free()

    cage = bpy.data.objects.new(f"GEO_{base_name}", mesh_data)
    cage.data.name = f"MESH_{base_name}"
    bpy.context.collection.objects.link(cage)
    cage["mongen_vertices_before_weld"] = mc_obj.get("mongen_vertices_before_weld", 0)

    # Shrinkwrap onto MC mesh
    sw = cage.modifiers.new("Shrinkwrap_MC", "SHRINKWRAP")
    sw.target = mc_obj
    sw.wrap_method = "PROJECT"
    sw.use_negative_direction = True
    sw.use_positive_direction = True
    sw.offset = 0.002
    bpy.context.view_layer.objects.active = cage
    cage.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Shrinkwrap_MC")
    cage.select_set(False)

    # Cleanup after shrinkwrap
    bm2 = bmesh.new()
    bm2.from_mesh(cage.data)
    bmesh.ops.remove_doubles(bm2, verts=bm2.verts, dist=2e-3)
    bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
    bm2.to_mesh(cage.data)
    bm2.free()
    cage.data.update()
    cage["mongen_vertices_after_weld"] = len(cage.data.vertices)

    return cage
