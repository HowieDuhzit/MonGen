#!/usr/bin/env python3
"""Curated anatomy mesh assets for MonGen v0.5 — separate mesh objects per attachment."""
from __future__ import annotations
import importlib.util, math
from pathlib import Path
import bmesh, bpy
from mathutils import Vector, Matrix

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _load_utils():
    spec = importlib.util.spec_from_file_location("mongen_utils", Path(__file__).parent / "mongen_utils.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

_utils = _load_utils()
Mulberry32 = _utils.Mulberry32


def _s2b(p):
    """source→Blender coord (x right, y depth, z up) → (x right, y fwd, z up)."""
    return Vector((p[0], -p[2], p[1]))


# ---------------------------------------------------------------------------
# Anatomy catalog (mirrors anatomy-catalog.ts exactly)
# ---------------------------------------------------------------------------

ANATOMY_CATALOG: dict[str, list[dict]] = {
    "Horn": [
        {"name":"Crown",  "length":.80,"breadth":.24,"depth":.18,"taper":.030,"segments":1,"sweep": 0.00},
        {"name":"Ram",    "length":.68,"breadth":.34,"depth":.24,"taper":.080,"segments":2,"sweep": 0.28},
        {"name":"Needle", "length":1.05,"breadth":.16,"depth":.13,"taper":.015,"segments":1,"sweep": 0.04},
        {"name":"Antler", "length":.88,"breadth":.22,"depth":.18,"taper":.025,"segments":3,"sweep": 0.42},
    ],
    "Ear": [
        {"name":"Round",  "length":.45,"breadth":.34,"depth":.18,"taper":.25,"segments":1,"sweep": 0.00},
        {"name":"Fennec", "length":.88,"breadth":.32,"depth":.15,"taper":.08,"segments":1,"sweep": 0.12},
        {"name":"Droop",  "length":.65,"breadth":.38,"depth":.20,"taper":.18,"segments":2,"sweep":-0.35},
        {"name":"Tuft",   "length":.72,"breadth":.26,"depth":.14,"taper":.04,"segments":2,"sweep": 0.24},
    ],
    "Fin": [
        {"name":"Fan",   "length":.62,"breadth":.48,"depth":.16,"taper":.12,"segments":2,"sweep":0.18},
        {"name":"Sail",  "length":.95,"breadth":.52,"depth":.12,"taper":.04,"segments":3,"sweep":0.06},
        {"name":"Blade", "length":.80,"breadth":.28,"depth":.10,"taper":.02,"segments":1,"sweep":0.30},
        {"name":"Frill", "length":.55,"breadth":.58,"depth":.14,"taper":.10,"segments":4,"sweep":0.44},
    ],
    "Wing": [
        {"name":"Bud",    "length":.62,"breadth":.42,"depth":.18,"taper":.14,"segments":2,"sweep":0.12},
        {"name":"Swift",  "length":1.00,"breadth":.34,"depth":.12,"taper":.06,"segments":3,"sweep":0.22},
        {"name":"Raptor", "length":1.18,"breadth":.46,"depth":.16,"taper":.04,"segments":4,"sweep":0.32},
        {"name":"Moth",   "length":.92,"breadth":.70,"depth":.10,"taper":.08,"segments":4,"sweep":0.48},
    ],
    "Spine": [
        {"name":"Nub",   "length":.38,"breadth":.26,"depth":.22,"taper":.10,"segments":1,"sweep":0.00},
        {"name":"Crest", "length":.68,"breadth":.24,"depth":.18,"taper":.04,"segments":2,"sweep":0.08},
        {"name":"Saw",   "length":.58,"breadth":.30,"depth":.20,"taper":.03,"segments":4,"sweep":0.18},
        {"name":"Quill", "length":.92,"breadth":.14,"depth":.12,"taper":.01,"segments":3,"sweep":0.25},
    ],
    "Leaf": [
        {"name":"Sprout",    "length":.48,"breadth":.30,"depth":.12,"taper":.12,"segments":2,"sweep":0.16},
        {"name":"Broadleaf", "length":.68,"breadth":.52,"depth":.10,"taper":.08,"segments":1,"sweep":0.08},
        {"name":"Fern",      "length":.82,"breadth":.28,"depth":.08,"taper":.03,"segments":4,"sweep":0.36},
        {"name":"Petal",     "length":.54,"breadth":.46,"depth":.12,"taper":.10,"segments":3,"sweep":0.46},
    ],
    "Crystal": [
        {"name":"Shard",   "length":.62,"breadth":.22,"depth":.20,"taper":.01,"segments":1,"sweep":0.06},
        {"name":"Cluster", "length":.72,"breadth":.24,"depth":.18,"taper":.01,"segments":3,"sweep":0.30},
        {"name":"Crown",   "length":.90,"breadth":.20,"depth":.16,"taper":.01,"segments":4,"sweep":0.48},
        {"name":"Geode",   "length":.48,"breadth":.38,"depth":.30,"taper":.05,"segments":5,"sweep":0.62},
    ],
    "Flame": [
        {"name":"Ember",    "length":.45,"breadth":.34,"depth":.24,"taper":.12,"segments":2,"sweep":0.10},
        {"name":"Torch",    "length":.72,"breadth":.34,"depth":.22,"taper":.05,"segments":3,"sweep":0.20},
        {"name":"Wildfire", "length":.62,"breadth":.48,"depth":.25,"taper":.04,"segments":4,"sweep":0.52},
        {"name":"Wisp",     "length":.90,"breadth":.24,"depth":.16,"taper":.02,"segments":3,"sweep":0.72},
    ],
    "Armor": [
        {"name":"Plate",      "length":.48,"breadth":.50,"depth":.18,"taper":.12,"segments":1,"sweep":0.04},
        {"name":"Pauldrons",  "length":.42,"breadth":.64,"depth":.22,"taper":.10,"segments":2,"sweep":0.18},
        {"name":"Carapace",   "length":.72,"breadth":.58,"depth":.20,"taper":.08,"segments":3,"sweep":0.30},
        {"name":"Runic",      "length":.56,"breadth":.46,"depth":.16,"taper":.05,"segments":4,"sweep":0.45},
    ],
}

# Socket → bone name per skeleton
SOCKET_BONE: dict[str, dict[str, str]] = {
    "Head":      {"Biped":"head","Quadruped":"head","Serpentine":"head","Avian":"head","Floating":"head"},
    "Shoulders": {"Biped":"L_arm_upper","Quadruped":"L_front_leg_upper","Serpentine":"body_02","Avian":"L_front_leg_upper","Floating":"core"},
    "Back":      {"Biped":"spine_02","Quadruped":"spine_rear","Serpentine":"body_04","Avian":"spine_front","Floating":"core"},
    "Tail":      {"Biped":"spine_01","Quadruped":"tail","Serpentine":"body_08","Avian":"tail","Floating":"orb_1"},
}

# Mirror bone when mirror="X" and a dedicated contralateral bone exists
MIRROR_BONE: dict[str, dict[str, str]] = {
    "Shoulders": {"Biped":"R_arm_upper","Quadruped":"R_front_leg_upper","Avian":"R_front_leg_upper"},
}

# Part types that support secondary motion
SECONDARY_PART_TYPES = {"tail", "ear", "wing", "fin", "flame", "spine", "leaf", "crystal"}

# ---------------------------------------------------------------------------
# Low-level mesh builders (all build into a provided bmesh at origin)
# ---------------------------------------------------------------------------

def _horn_bm(bm, spec, seed):
    n, segs = 8, max(2, spec["segments"] + 1)
    h, br, tr = spec["length"], spec["breadth"], max(0.005, spec["taper"])
    rings = []
    for s in range(segs + 1):
        t = s / segs
        r = br * (1 - t) + tr * t
        z = h * t
        xoff = spec["sweep"] * h * t * t
        ring = [bm.verts.new((math.cos(a * math.tau / n) * r + xoff,
                               math.sin(a * math.tau / n) * r, z)) for a in range(n)]
        rings.append(ring)
        # Antler: extra lateral bud at 1/3 and 2/3 height
        if spec["segments"] >= 3 and s in (segs // 3, 2 * segs // 3):
            bud_tip = bm.verts.new((xoff + br * spec["sweep"] * 0.5,
                                     br * 0.6, z + h * 0.12))
            for v in ring[n // 4: n // 4 + 3]:
                bm.edges.new([v, bud_tip])
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(n):
            bm.faces.new([r0[j], r0[(j+1)%n], r1[(j+1)%n], r1[j]])
    bm.faces.new(rings[0][::-1])  # base cap: CW → normal -Z (outward at root)


def _flat_panel_bm(bm, spec, seed, add_midrib=False):
    """Shared builder for Ear, Fin, Leaf — an extruded convex panel."""
    lx, ly, lz = spec["breadth"], spec["depth"], spec["length"]
    sweep = spec["sweep"]
    taper = max(0.05, spec["taper"])
    segs = max(1, spec["segments"])
    rings = []
    for s in range(segs + 1):
        t = s / segs
        w = lx * (1 - t * (1 - taper))
        xoff = sweep * lz * t * t
        z = lz * t
        ring = [
            bm.verts.new(( w + xoff,  ly * 0.5, z)),
            bm.verts.new(( w + xoff, -ly * 0.5, z)),
            bm.verts.new((-w + xoff, -ly * 0.5, z)),
            bm.verts.new((-w + xoff,  ly * 0.5, z)),
        ]
        rings.append(ring)
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(4):
            bm.faces.new([r0[j], r0[(j+1)%4], r1[(j+1)%4], r1[j]])
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    if add_midrib:
        mid = Vector((0, 0, 0))
        tip = bm.verts.new((sweep * lz, 0, lz))
        base = bm.verts.new((0, 0, 0))
        bm.edges.new([base, tip])


def _wing_bm(bm, spec, seed):
    """Multi-segment swept membrane."""
    n_chords = max(3, spec["segments"] + 2)
    span = spec["length"]
    chord_root = spec["breadth"]
    taper = max(0.05, spec["taper"])
    d = spec["depth"]
    sweep = spec["sweep"]
    rows = []
    for s in range(n_chords + 1):
        t = s / n_chords
        x = span * t
        chord = chord_root * (1 - t * (1 - taper))
        xoff = sweep * span * t * t
        row = [
            bm.verts.new((x, xoff + chord * 0.5, d * (1 - t) * 0.5)),
            bm.verts.new((x, xoff, 0)),
            bm.verts.new((x, xoff - chord * 0.5, -d * (1 - t) * 0.5)),
        ]
        rows.append(row)
    for i in range(len(rows) - 1):
        r0, r1 = rows[i], rows[i + 1]
        for j in range(2):
            bm.faces.new([r0[j], r0[j+1], r1[j+1], r1[j]])
    bm.faces.new([rows[0][0], rows[0][1], rows[0][2]])


def _spine_bm(bm, spec, seed):
    n, segs = 6, max(1, spec["segments"])
    h, br, tr = spec["length"] / segs, spec["breadth"], max(0.008, spec["taper"])
    for s in range(segs):
        z0 = h * s; z1 = h * (s + 1)
        r0 = br * (1 - s / segs) + tr * (s / segs)
        r1 = br * (1 - (s+1)/segs) + tr * ((s+1)/segs)
        vb = [bm.verts.new((math.cos(a*math.tau/n)*r0, math.sin(a*math.tau/n)*r0, z0)) for a in range(n)]
        vt = [bm.verts.new((math.cos(a*math.tau/n)*r1 + spec["sweep"]*h*0.5, math.sin(a*math.tau/n)*r1, z1)) for a in range(n)]
        for j in range(n):
            bm.faces.new([vb[j], vb[(j+1)%n], vt[(j+1)%n], vt[j]])
        if s == 0:
            bm.faces.new(vb[::-1])  # base cap: CW → normal -Z (outward)


def _crystal_bm(bm, spec, seed):
    rng = Mulberry32((seed ^ 0x4C81A3F2) & 0xFFFFFFFF)
    n_copies = max(1, min(5, spec["segments"]))
    for copy in range(n_copies):
        angle = copy * math.tau / n_copies + rng.next_float() * 0.4
        scale = 0.65 + rng.next_float() * 0.45
        h = spec["length"] * scale
        r = spec["breadth"] * scale * (1 - copy * 0.1)
        ox = math.cos(angle) * spec["breadth"] * 0.35 * (1 if copy > 0 else 0)
        oy = math.sin(angle) * spec["breadth"] * 0.35 * (1 if copy > 0 else 0)
        n = 4
        base = [bm.verts.new((math.cos(a*math.tau/n)*r + ox,
                               math.sin(a*math.tau/n)*r + oy, 0)) for a in range(n)]
        tip = bm.verts.new((ox + spec["sweep"] * h * 0.2, oy, h))
        bm.faces.new(base[::-1])  # base cap: CW → normal -Z (outward)
        for j in range(n):
            bm.faces.new([base[j], base[(j+1)%n], tip])


def _flame_bm(bm, spec, seed):
    rng = Mulberry32((seed ^ 0xF1A3E000) & 0xFFFFFFFF)
    n, segs = 8, max(2, spec["segments"])
    h, br, tr = spec["length"], spec["breadth"], max(0.01, spec["taper"])
    twist = spec["sweep"]
    rings = []
    for s in range(segs + 1):
        t = s / segs
        r = br * (1 - t) + tr * t
        z = h * t
        twist_angle = twist * t * math.tau
        ring = [bm.verts.new((math.cos(a * math.tau / n + twist_angle) * r,
                               math.sin(a * math.tau / n + twist_angle) * r, z)) for a in range(n)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(n):
            bm.faces.new([r0[j], r0[(j+1)%n], r1[(j+1)%n], r1[j]])
    bm.faces.new(rings[0][::-1])  # base cap: CW → normal -Z (outward)


def _armor_bm(bm, spec, seed):
    lx, ly, lz = spec["breadth"] * 0.5, spec["depth"] * 0.5, spec["length"] * 0.5
    bevel = max(0.02, min(lx, ly, lz) * 0.18)
    # Build a rounded box via 8-point cage
    corners = [
        Vector((-lx + bevel, -ly + bevel, 0)), Vector((lx - bevel, -ly + bevel, 0)),
        Vector((lx - bevel,  ly - bevel, 0)), Vector((-lx + bevel,  ly - bevel, 0)),
    ]
    top_scale = 1 - spec["taper"] * 0.5
    top = [Vector((c.x * top_scale, c.y * top_scale, lz * 2)) for c in corners]
    bot = [bm.verts.new(c) for c in corners]
    up = [bm.verts.new(t) for t in top]
    bm.faces.new(bot[::-1])  # bottom: CW → normal -Z (outward)
    bm.faces.new(up)         # top: CCW → normal +Z (outward)
    for j in range(4):
        bm.faces.new([bot[j], bot[(j+1)%4], up[(j+1)%4], up[j]])


BUILDERS = {
    "Horn": _horn_bm,
    "Ear": lambda bm, s, seed: _flat_panel_bm(bm, s, seed, False),
    "Fin": lambda bm, s, seed: _flat_panel_bm(bm, s, seed, False),
    "Wing": _wing_bm,
    "Spine": _spine_bm,
    "Leaf": lambda bm, s, seed: _flat_panel_bm(bm, s, seed, True),
    "Crystal": _crystal_bm,
    "Flame": _flame_bm,
    "Armor": _armor_bm,
}

# ---------------------------------------------------------------------------
# Object creation and parenting
# ---------------------------------------------------------------------------

def _build_anatomy_object(pool: str, spec: dict, seed: int, label: str) -> bpy.types.Object:
    bm = bmesh.new()
    BUILDERS[pool](bm, spec, seed)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_data = bpy.data.meshes.new(f"MESH_ANAT_{label}")
    bm.to_mesh(mesh_data)
    bm.free()
    obj = bpy.data.objects.new(f"ANAT_{label}", mesh_data)
    bpy.context.collection.objects.link(obj)
    # UV unwrap
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=66.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    return obj


def _assign_anatomy_materials(obj: bpy.types.Object, palette_colors: tuple) -> None:
    primary = bpy.data.materials.new(f"{obj.name}_Pri")
    primary.use_nodes = True; primary.use_backface_culling = False
    primary.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = palette_colors[0]
    secondary = bpy.data.materials.new(f"{obj.name}_Sec")
    secondary.use_nodes = True; secondary.use_backface_culling = False
    secondary.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = palette_colors[1]
    obj.data.materials.append(primary)
    obj.data.materials.append(secondary)
    if not obj.data.vertices:
        return
    lo_z = min(v.co.z for v in obj.data.vertices)
    hi_z = max(v.co.z for v in obj.data.vertices)
    z_range = max(hi_z - lo_z, 1e-4)
    for poly in obj.data.polygons:
        poly.material_index = 1 if (poly.center.z - lo_z) / z_range < 0.3 else 0


def _parent_to_bone(obj: bpy.types.Object, arm: bpy.types.Object, bone_name: str,
                    dna_pos: list, dna_scale: list) -> None:
    bone = arm.data.bones.get(bone_name)
    if not bone:
        return
    bone_tail_world = arm.matrix_world @ bone.tail_local
    pos_offset = _s2b(dna_pos)
    obj.location = bone_tail_world + pos_offset
    obj.scale = (dna_scale[0], dna_scale[1], dna_scale[2])
    world_mat = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_bone = bone_name
    obj.parent_type = "BONE"
    obj.matrix_world = world_mat


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_all_anatomy(dna: dict, arm: bpy.types.Object,
                      palettes: dict) -> list[dict]:
    """Build anatomy mesh objects for all DNA attachments.

    Returns list of {"obj", "bone_name", "part_type"}.
    """
    skeleton = dna["skeleton"]
    element = dna.get("element", "Neutral")
    palette_colors = palettes.get(element, palettes.get("Neutral", ((0.5,0.5,0.5,1),)*3))
    seed = int(dna["seed"])
    results: list[dict] = []

    for attachment in dna.get("attachments", []):
        pool = attachment["part"]["pool"]
        if pool == "None":
            continue
        variant_idx = attachment["part"]["variant"]
        socket = attachment["socket"]
        mirror = attachment["mirror"]
        dna_pos = attachment["transform"]["position"]
        dna_scale = attachment["transform"]["scale"]

        spec_list = ANATOMY_CATALOG.get(pool, [])
        if not spec_list:
            continue
        spec = spec_list[variant_idx % len(spec_list)]
        bone_name = SOCKET_BONE.get(socket, {}).get(skeleton, "root")

        part_seed = (seed ^ (hash(attachment["id"]) & 0xFFFFFFFF)) & 0xFFFFFFFF
        label = f"{pool}_{spec['name']}_{attachment['id']}"
        obj = _build_anatomy_object(pool, spec, part_seed, label)
        _assign_anatomy_materials(obj, palette_colors)
        _parent_to_bone(obj, arm, bone_name, dna_pos, dna_scale)
        results.append({"obj": obj, "bone_name": bone_name, "part_type": pool.lower()})

        if mirror == "X":
            m_bone = MIRROR_BONE.get(socket, {}).get(skeleton, bone_name)
            m_obj = obj.copy()
            m_obj.data = obj.data.copy()
            m_obj.name = f"ANAT_{label}_MX"
            m_obj.data.name = f"MESH_ANAT_{label}_MX"
            bpy.context.collection.objects.link(m_obj)
            mirror_pos = [-dna_pos[0], dna_pos[1], dna_pos[2]]
            _parent_to_bone(m_obj, arm, m_bone, mirror_pos, dna_scale)
            m_obj.scale.x *= -1
            results.append({"obj": m_obj, "bone_name": m_bone, "part_type": pool.lower()})

    return results
