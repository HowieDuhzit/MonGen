#!/usr/bin/env python3
"""Headless MonGen OBJ + DNA -> auto-rigged animated GLB pipeline (v0.5)."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


PALETTES = {
    "Neutral": ((0.26, 0.20, 0.14, 1), (0.72, 0.64, 0.44, 1), (0.96, 0.90, 0.72, 1)),
    "Fire": ((0.90, 0.08, 0.02, 1), (1.00, 0.42, 0.02, 1), (1.00, 0.82, 0.08, 1)),
    "Water": ((0.02, 0.18, 0.72, 1), (0.02, 0.62, 0.92, 1), (0.35, 0.92, 1.00, 1)),
    "Plant": ((0.05, 0.34, 0.08, 1), (0.18, 0.68, 0.12, 1), (0.72, 0.88, 0.18, 1)),
    "Earth": ((0.24, 0.10, 0.04, 1), (0.48, 0.27, 0.10, 1), (0.72, 0.56, 0.28, 1)),
    "Air": ((0.48, 0.72, 0.88, 1), (0.76, 0.90, 0.98, 1), (0.95, 0.98, 1.00, 1)),
    "Electric": ((0.18, 0.08, 0.48, 1), (0.62, 0.18, 0.92, 1), (1.00, 0.92, 0.02, 1)),
    "Ice": ((0.15, 0.46, 0.68, 1), (0.52, 0.86, 0.96, 1), (0.88, 0.98, 1.00, 1)),
    "Metal": ((0.10, 0.12, 0.16, 1), (0.38, 0.44, 0.52, 1), (0.76, 0.80, 0.84, 1)),
    "Light": ((0.82, 0.64, 0.12, 1), (1.00, 0.90, 0.42, 1), (1.00, 0.98, 0.82, 1)),
    "Shadow": ((0.025, 0.02, 0.06, 1), (0.12, 0.04, 0.22, 1), (0.38, 0.08, 0.46, 1)),
}

CLIP_EXPRESSION = {
    "Idle": ("Neutral", 0.6), "Walk": ("Neutral", 0.8), "Run": ("Alert", 0.7),
    "Attack": ("Angry", 1.0), "Special": ("Alert", 0.9), "Hurt": ("Hurt", 1.0), "Faint": ("Faint", 1.0),
}

_BLENDER_DIR = Path(__file__).parent


def _load_module(name: str, rel_path: str):
    path = _BLENDER_DIR / rel_path
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@dataclass(frozen=True)
class BoneSpec:
    name: str
    head: tuple[float, float, float]
    tail: tuple[float, float, float]
    parent: str | None = None
    deform: bool = True


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--mesh", required=True)
    parser.add_argument("--dna", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    parser.add_argument("--blend")
    parser.add_argument("--lod-dir")
    parser.add_argument("--allow-missing-face", action="store_true",
                        help="Template-test escape hatch for a mesh generated from different DNA")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def import_mesh(path: Path, name: str) -> bpy.types.Object:
    bpy.ops.wm.obj_import(
        filepath=str(path), forward_axis="NEGATIVE_Z", up_axis="Y",
        validate_meshes=True, use_split_objects=False, use_split_groups=False,
    )
    meshes = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"expected one imported mesh, found {len(meshes)}")
    obj = meshes[0]
    obj.name = f"GEO_{name}"; obj.data.name = f"MESH_{name}"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new(); bm.from_mesh(obj.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    obj["mongen_vertices_before_weld"] = before
    obj["mongen_vertices_after_weld"] = len(obj.data.vertices)
    return obj


def enforce_triangle_budget(obj: bpy.types.Object, target: int) -> int:
    triangles = sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
    if triangles <= target:
        return triangles
    modifier = obj.modifiers.new(name=f"LOD_budget_{target}", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(0.01, min(1.0, target / triangles))
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def mesh_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (Vector(tuple(min(p[i] for p in points) for i in range(3))),
            Vector(tuple(max(p[i] for p in points) for i in range(3))))


def skeleton_specs(kind: str, low: Vector, high: Vector) -> list[BoneSpec]:
    center = (low + high) * 0.5
    sx, sy, sz = (high - low)
    eps = max(min(sx, sy, sz) * 0.03, 0.02)
    specs: list[BoneSpec] = []
    add = lambda n, h, t, p=None, d=True: specs.append(BoneSpec(n, tuple(h), tuple(t), p, d))
    if kind == "Biped":
        add("root", (center.x, center.y, low.z), (center.x, center.y, low.z + eps), None, False)
        add("spine_01", (center.x, center.y, low.z+sz*.20), (center.x, center.y, low.z+sz*.48), "root")
        add("spine_02", (center.x, center.y, low.z+sz*.48), (center.x, center.y, low.z+sz*.70), "spine_01")
        add("neck", (center.x, center.y, low.z+sz*.70), (center.x, center.y, low.z+sz*.82), "spine_02")
        add("head", (center.x, center.y, low.z+sz*.82), (center.x, center.y, high.z), "neck")
        for side, sign in (("L", 1), ("R", -1)):
            x = center.x + sign * sx * .16
            add(f"{side}_leg_upper", (x, center.y, low.z+sz*.24), (x, center.y, low.z+sz*.12), "root")
            add(f"{side}_leg_lower", (x, center.y, low.z+sz*.12), (x, center.y, low.z), f"{side}_leg_upper")
            add(f"{side}_arm_upper", (center.x+sign*sx*.12, center.y, low.z+sz*.65), (center.x+sign*sx*.32, center.y, low.z+sz*.48), "spine_02")
            add(f"{side}_arm_lower", (center.x+sign*sx*.32, center.y, low.z+sz*.48), (center.x+sign*sx*.48, center.y, low.z+sz*.35), f"{side}_arm_upper")
    elif kind in {"Quadruped", "Avian"}:
        add("root", (center.x, center.y, low.z), (center.x, center.y, low.z+eps), None, False)
        add("spine_rear", (center.x, high.y-sy*.15, center.z), (center.x, center.y, center.z), "root")
        add("spine_front", (center.x, center.y, center.z), (center.x, low.y+sy*.25, center.z), "spine_rear")
        add("neck", (center.x, low.y+sy*.25, center.z), (center.x, low.y+sy*.12, low.z+sz*.72), "spine_front")
        add("head", (center.x, low.y+sy*.12, low.z+sz*.72), (center.x, low.y, low.z+sz*.78), "neck")
        for side, sign in (("L", 1), ("R", -1)):
            for region, y, parent in (("front", low.y+sy*.25, "spine_front"), ("rear", high.y-sy*.18, "spine_rear")):
                x = center.x + sign * sx * .20
                add(f"{side}_{region}_leg_upper", (x, y, center.z), (x, y, low.z+sz*.22), parent)
                add(f"{side}_{region}_leg_lower", (x, y, low.z+sz*.22), (x, y, low.z), f"{side}_{region}_leg_upper")
            if kind == "Avian":
                add(f"{side}_wing", (center.x+sign*sx*.10, center.y, low.z+sz*.58), (center.x+sign*sx*.48, center.y, low.z+sz*.55), "spine_front")
        add("tail", (center.x, high.y-sy*.12, center.z), (center.x, high.y, center.z), "spine_rear")
    elif kind == "Serpentine":
        add("root", (center.x, center.y, low.z), (center.x, center.y, low.z+eps), None, False)
        parent = "root"
        for i in range(8):
            y0 = high.y - sy*(i/8); y1 = high.y - sy*((i+1)/8)
            name = f"body_{i+1:02d}"; add(name, (center.x, y0, center.z), (center.x, y1, center.z), parent); parent = name
        add("head", (center.x, low.y+sy*.08, center.z), (center.x, low.y, center.z+eps), parent)
    else:
        add("root", (center.x, center.y, low.z), (center.x, center.y, center.z), None, False)
        add("core", (center.x, center.y, center.z), (center.x, center.y, low.z+sz*.72), "root")
        add("head", (center.x, center.y, low.z+sz*.72), (center.x, center.y, high.z), "core")
        for i in range(3):
            angle = i * math.tau / 3
            end = (center.x+math.cos(angle)*sx*.42, center.y+math.sin(angle)*sy*.42, low.z+sz*.25)
            add(f"orb_{i+1}", (center.x, center.y, low.z+sz*.32), end, "core")
    return specs


def create_armature(name: str, specs: list[BoneSpec]) -> bpy.types.Object:
    data = bpy.data.armatures.new(f"ARM_DATA_{name}")
    arm = bpy.data.objects.new(f"ARM_{name}", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for spec in specs:
        bone = data.edit_bones.new(spec.name)
        bone.head = spec.head; bone.tail = spec.tail; bone.use_deform = spec.deform
        if spec.parent: bone.parent = created[spec.parent]; bone.use_connect = False
        created[spec.name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.show_in_front = True
    return arm


def add_facial_bones(arm: bpy.types.Object, dna: dict) -> list[str]:
    """Add jaw, eye, eyelid, and brow bones at DNA face-landmark positions."""
    face = face_landmarks(dna)
    l_eye = source_to_blender(face["eyes"][0])
    r_eye = source_to_blender(face["eyes"][1])
    mouth = source_to_blender(face["mouth"])
    r = face["eye_radius"]
    mr = face["mouth_radius"]

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    data = arm.data
    added: list[str] = []

    def _add(name, hd, tl, parent, deform=True):
        b = data.edit_bones.new(name)
        b.head = tuple(hd); b.tail = tuple(tl); b.use_deform = deform
        if parent in data.edit_bones:
            b.parent = data.edit_bones[parent]; b.use_connect = False
        added.append(name)

    # Jaw
    jaw_h = mouth + Vector((0, 0, 0))
    jaw_t = mouth + Vector((0, 0, -mr * 0.5))
    _add("jaw", jaw_h, jaw_t, "head")

    # Eyes, eyelids, brows
    for side, eye_pt in (("L", l_eye), ("R", r_eye)):
        _add(f"{side}_eye", eye_pt, eye_pt + Vector((0, 0, r*0.5)), "head")
        _add(f"{side}_eyelid_upper", eye_pt + Vector((0, 0, r*0.85)), eye_pt + Vector((0, 0, r*1.1)), f"{side}_eye")
        _add(f"{side}_eyelid_lower", eye_pt + Vector((0, 0, -r*0.45)), eye_pt + Vector((0, 0, -r*0.65)), f"{side}_eye")
        _add(f"{side}_brow", eye_pt + Vector((0, 0, r*1.35)), eye_pt + Vector((0, 0, r*1.6)), "head")

    bpy.ops.object.mode_set(mode="OBJECT")
    return added


def bind_automatic(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    if not any(mod.type == "ARMATURE" and mod.object == arm for mod in mesh.modifiers):
        raise RuntimeError("automatic armature binding did not create an Armature modifier")
    world = mesh.matrix_world.copy()
    mesh.parent = None; mesh.matrix_world = world


def point_segment_distance(point: Vector, a: Vector, b: Vector) -> float:
    ab = b - a
    t = max(0.0, min(1.0, (point - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (point - (a + ab * t)).length


def clean_weights(mesh: bpy.types.Object, arm: bpy.types.Object) -> tuple[int, int]:
    deform = [bone for bone in arm.data.bones if bone.use_deform]
    repaired = 0; max_influences = 0
    for vertex in mesh.data.vertices:
        weighted = [(e.group, e.weight) for e in vertex.groups if e.weight > 1e-6]
        weighted.sort(key=lambda item: (-item[1], item[0]))
        keep = weighted[:4]
        for group_index, _ in weighted[4:]: mesh.vertex_groups[group_index].remove([vertex.index])
        if not keep:
            world = mesh.matrix_world @ vertex.co
            bone = min(deform, key=lambda b: point_segment_distance(world, arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local))
            group = mesh.vertex_groups.get(bone.name) or mesh.vertex_groups.new(name=bone.name)
            group.add([vertex.index], 1.0, "REPLACE"); keep = [(group.index, 1.0)]; repaired += 1
        total = sum(weight for _, weight in keep)
        for group_index, weight in keep: mesh.vertex_groups[group_index].add([vertex.index], weight / total, "REPLACE")
        max_influences = max(max_influences, len(keep))
    return repaired, max_influences


def _blend_weight(mesh: bpy.types.Object, vertex_index: int, bone_name: str, w: float) -> None:
    group = mesh.vertex_groups.get(bone_name) or mesh.vertex_groups.new(name=bone_name)
    current = 0.0
    for entry in mesh.data.vertices[vertex_index].groups:
        if entry.group == group.index:
            current = entry.weight; break
    group.add([vertex_index], min(1.0, current + w), "REPLACE")


def add_facial_vertex_groups(mesh: bpy.types.Object, arm: bpy.types.Object, dna: dict) -> None:
    """Blend facial bone weights into vertices near eye/mouth landmarks."""
    face = face_landmarks(dna)
    l_eye = source_to_blender(face["eyes"][0])
    r_eye = source_to_blender(face["eyes"][1])
    mouth = source_to_blender(face["mouth"])
    r = face["eye_radius"]
    mr = face["mouth_radius"]

    for vertex in mesh.data.vertices:
        wp = mesh.matrix_world @ vertex.co
        vi = vertex.index

        for side, ec in (("L", l_eye), ("R", r_eye)):
            dist = (wp - ec).length
            if dist < r * 1.5:
                w = max(0.0, 1.0 - dist / (r * 1.5))
                _blend_weight(mesh, vi, f"{side}_eye", w * 0.5)
                if wp.z > ec.z:
                    _blend_weight(mesh, vi, f"{side}_eyelid_upper", w * 0.55)
                else:
                    _blend_weight(mesh, vi, f"{side}_eyelid_lower", w * 0.40)
            brow_dist = (wp - (ec + Vector((0, 0, r*1.35)))).length
            if brow_dist < r * 1.0:
                _blend_weight(mesh, vi, f"{side}_brow", max(0.0, 1.0 - brow_dist/(r*1.0)) * 0.50)

        m_dist = (wp - mouth).length
        if m_dist < mr * 2.0:
            _blend_weight(mesh, vi, "jaw", max(0.0, 1.0 - m_dist / (mr * 2.0)) * 0.65)

    # Re-normalize
    for vertex in mesh.data.vertices:
        total = sum(e.weight for e in vertex.groups)
        if total > 0:
            for e in vertex.groups:
                mesh.vertex_groups[e.group].add([vertex.index], e.weight / total, "REPLACE")


class Mulberry32:
    def __init__(self, seed: int): self.state = seed & 0xFFFFFFFF
    def next_float(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        value = self.state
        value = ((value ^ (value >> 15)) * ((value | 1) & 0xFFFFFFFF)) & 0xFFFFFFFF
        value ^= (value + (((value ^ (value >> 7)) * ((value | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((value ^ (value >> 14)) & 0xFFFFFFFF) / 4294967296.0


def face_landmarks(dna: dict) -> dict:
    """Mirror of compileFaceLandmarks() + anchors() from src/gpu/morphology.ts — must stay in sync."""
    morphology = dna["morphology"]
    head = morphology["headScale"]
    body = morphology["bodyScale"]
    kind = dna["skeleton"]

    # compileDiversityTraits: RNG consumed in identical order to TypeScript
    diversity = Mulberry32((int(dna["seed"]) ^ 0x0D1A7E25) & 0xFFFFFFFF)
    archetype_index = min(2, int(diversity.next_float() * 3))  # 1 archetypeIndex
    diversity.next_float()                                      # 2 bodyBulk
    head_bias = .82 + diversity.next_float() * .42             # 3 headBias
    diversity.next_float()                                      # 4 stance
    diversity.next_float()                                      # 5 limbTaper
    posture = (diversity.next_float() - .5) * .30              # 6 posture
    diversity.next_float()                                      # 7 featureScale
    eye_style = min(2, int(diversity.next_float() * 3))        # 8 eyeStyle

    # archetypeHeadScale — mirrors morphology.ts exactly
    ARCH_SCALE = {
        "Biped":      (.78, .72, 1.62),
        "Quadruped":  (.85, .74, 1.30),
        "Serpentine": (1.28, .78, 1.06),
        "Avian":      (.86, 1.48, .74),
        "Floating":   (.98, .82, .68),
    }
    hb = head_bias * ARCH_SCALE[kind][archetype_index]

    # anchors() — skeleton-specific head position and radii
    if kind == "Quadruped":
        center = (0, 1.32 + posture, body[1] * .86)
        radii = (head[0] * .88 * hb, head[1] * .84 * hb, head[2] * .92 * hb)
    elif kind == "Biped":
        center = (0, 2.14 + posture, .06)
        radii = (head[0] * .90 * hb, head[1] * .88 * hb, head[2] * .86 * hb)
    elif kind == "Serpentine":
        center = (0, 1.08 + posture, morphology["tailLength"] * .52)
        radii = (head[0] * .88 * hb, head[1] * .78 * hb, head[2] * .98 * hb)
    elif kind == "Avian":
        center = (0, 1.64 + posture, .48)
        radii = (head[0] * .78 * hb, head[1] * .80 * hb, head[2] * .82 * hb)
    else:  # Floating
        center = (0, 1.58 + posture, .26)
        radii = (head[0] * .88 * hb, head[1] * .84 * hb, head[2] * .88 * hb)

    # compileFaceLandmarks — matches TypeScript exactly
    rng = Mulberry32((int(dna["seed"]) ^ 0xFACEB00C) & 0xFFFFFFFF)
    style_scale = (.88, 1.06, 1.38)[eye_style]
    radius = min(radii) * (.40 + rng.next_float() * .12) * style_scale
    spacing = radii[0] * ((.36, .43, .50)[eye_style] + rng.next_float() * .08)
    eye_y = center[1] + radii[1] * (.14 + (rng.next_float() - .5) * .06)
    eye_z = center[2] + radii[2] * 1.00
    mouth_radius = radius * (1.05 + rng.next_float() * .3)
    pupil_scale = .34 + rng.next_float() * .28
    expression = rng.next_float() * 2 - 1

    return {
        "eyes": ((-spacing, eye_y, eye_z), (spacing, eye_y, eye_z)),
        "eye_radius": radius,
        "mouth": (0, center[1] - radii[1] * .22, center[2] + radii[2] * .98),
        "mouth_radius": mouth_radius,
        "pupil_scale": pupil_scale,
        "expression": expression,
        "style": eye_style,
    }


def source_to_blender(point: tuple) -> Vector:
    return Vector((point[0], -point[2], point[1]))


def make_material(name: str, color: tuple, roughness: float, metallic: float = 0.0,
                  procedural: bool = False, seed: int = 0) -> bpy.types.Material:
    """Build a Principled BSDF material.  When procedural=True, adds noise-based color
    variation, roughness variation, and a bump map ready to bake to image textures."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    mat.use_backface_culling = False

    tree = mat.node_tree
    nodes = tree.nodes
    links = tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (700, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (340, 0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    if not procedural:
        bsdf.inputs["Base Color"].default_value = color
        return mat

    # Texture coordinates in object space (deterministic for any UV state)
    tc = nodes.new("ShaderNodeTexCoord")
    tc.location = (-750, 100)

    # Large-scale color variation — organic patches
    n1 = nodes.new("ShaderNodeTexNoise")
    n1.location = (-520, 240)
    n1.inputs["Scale"].default_value = 4.0 + (seed & 3) * 0.5
    n1.inputs["Detail"].default_value = 6.0
    n1.inputs["Roughness"].default_value = 0.62
    n1.inputs["Distortion"].default_value = 0.22

    cr = nodes.new("ShaderNodeValToRGB")
    cr.location = (-260, 240)
    cr.color_ramp.interpolation = "EASE"
    cr.color_ramp.elements[0].position = 0.28
    cr.color_ramp.elements[0].color = (color[0] * 0.80, color[1] * 0.80, color[2] * 0.80, 1.0)
    cr.color_ramp.elements[1].position = 0.72
    cr.color_ramp.elements[1].color = (min(1.0, color[0] * 1.18), min(1.0, color[1] * 1.18), min(1.0, color[2] * 1.18), 1.0)

    links.new(tc.outputs["Object"], n1.inputs["Vector"])
    links.new(n1.outputs["Fac"], cr.inputs["Fac"])
    links.new(cr.outputs["Color"], bsdf.inputs["Base Color"])

    # Roughness variation — recesses rougher, protrusions smoother
    n2 = nodes.new("ShaderNodeTexNoise")
    n2.location = (-520, -40)
    n2.inputs["Scale"].default_value = 10.0 + ((seed >> 4) & 7) * 0.5
    n2.inputs["Detail"].default_value = 4.0
    n2.inputs["Roughness"].default_value = 0.55

    cr_r = nodes.new("ShaderNodeValToRGB")
    cr_r.location = (-260, -40)
    r_lo = max(0.05, roughness * 0.68)
    r_hi = min(1.0, roughness * 1.35)
    cr_r.color_ramp.elements[0].color = (r_lo, r_lo, r_lo, 1.0)
    cr_r.color_ramp.elements[1].color = (r_hi, r_hi, r_hi, 1.0)

    links.new(tc.outputs["Object"], n2.inputs["Vector"])
    links.new(n2.outputs["Fac"], cr_r.inputs["Fac"])
    links.new(cr_r.outputs["Color"], bsdf.inputs["Roughness"])

    # Fine-grain bump — skin / scale surface detail
    n3 = nodes.new("ShaderNodeTexNoise")
    n3.location = (-520, -320)
    n3.inputs["Scale"].default_value = 16.0 + ((seed >> 8) & 7) * 1.0
    n3.inputs["Detail"].default_value = 10.0
    n3.inputs["Roughness"].default_value = 0.52
    n3.inputs["Distortion"].default_value = 0.12

    bump = nodes.new("ShaderNodeBump")
    bump.location = (80, -260)
    bump.inputs["Strength"].default_value = 0.32
    bump.inputs["Distance"].default_value = 0.045

    links.new(tc.outputs["Object"], n3.inputs["Vector"])
    links.new(n3.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    return mat


def mix32(value: int) -> int:
    value &= 0xFFFFFFFF; value = ((value ^ (value >> 16)) * 0x7FEB352D) & 0xFFFFFFFF
    value = ((value ^ (value >> 15)) * 0x846CA68B) & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFFFFFFFF


def tail_tip_blender(dna: dict) -> tuple:
    """Approximate tail tip in Blender coords matching compileTailTip() in morphology.ts."""
    m = dna["morphology"]
    kind = dna["skeleton"]
    tail_len = float(m["tailLength"])
    r = float(m["limbThickness"]) * 0.72
    # source_to_blender: (src_x, src_y, src_z) → (src_x, -src_z, src_y) in Blender
    if kind == "Biped":
        if tail_len <= 0.3:
            return None, -1.0
        return Vector((0, 0.12 + tail_len * 0.42, 0.52)), r
    if kind == "Quadruped":
        body_z = float(m["bodyScale"][1]) * 0.58
        return Vector((0, body_z + tail_len, 1.12)), r
    if kind == "Serpentine":
        return Vector((0, tail_len * 0.62, 0.48)), float(m["bodyScale"][0]) * 0.10
    if kind == "Avian":
        return Vector((0, 0.52 + tail_len * 0.65, 0.86)), r * 0.88
    return None, -1.0


def palette_region(center: Vector, dna: dict, low: Vector, high: Vector,
                   poly_normal: Vector | None = None) -> int:
    pattern = dna["surface"]["pattern"]
    scale = max(float(dna["surface"]["patternScale"]), .001)
    seed = int(dna["seed"])
    sz = max(high.z - low.z, .001)
    sx = max(high.x - low.x, .001)
    sy = max(high.y - low.y, .001)
    nz = (center.z - low.z) / sz          # 0=bottom … 1=top  (Blender Z = source Y = height)
    nx = (center.x - (low.x + high.x) * .5) / (sx * .5)  # −1…+1 left/right
    ny = (center.y - low.y) / sy          # 0=front (viewer) … 1=back (Blender Y: low=front)

    # Counter-shading: belly/chest lighter, dorsal darker — mirrors WGSL bellyValue()
    chest_belly = ny < 0.40 and 0.15 < nz < 0.82 and abs(nx) < 0.62
    under_belly  = nz < 0.32 and abs(nx) < 0.50
    is_belly = chest_belly or under_belly
    is_dorsal = nz > 0.68 and ny > 0.52

    if pattern == "Solid":
        return 2 if is_belly else (0 if is_dorsal else 1)

    if pattern == "Stripes":
        freq = scale * 1.05
        # Direction + harmonic width variation mirrors WGSL Stripes branch (Zebstrika/Rapidash style).
        fv = ((seed >> 16) & 0xFF) / 255.0
        sa = math.sin(fv * math.pi) * 0.52
        ca = math.cos(fv * math.pi) * 0.52
        t_base = (center.x * ca + center.z * sa + (-center.y) * 0.88) * freq
        harmonic_str = 0.28 + fv * 0.22
        combined = max(-1.0, min(1.0, math.sin(t_base) + math.sin(t_base * 2.0) * harmonic_str))
        base_idx = 0 if combined < -0.12 else (2 if combined > 0.12 else 1)
        return max(base_idx, 2 if is_belly else (0 if is_dorsal else base_idx))

    if pattern == "Bands":
        # Approximate noise hash for the warp term — mirrors WGSL Bands branch.
        src_x_b = center.x; src_y_b = center.z
        h_b = mix32(seed ^ (int(src_x_b * 8 + 512) * 0x1F123BB5 & 0xFFFFFFFF) ^
                    (int(src_y_b * 8 + 512) * 0x5F356495 & 0xFFFFFFFF))
        noise_b = (h_b & 0xFF) / 255.0
        band_warp = math.sin(center.x * scale * 0.48 + noise_b * 2.1) * 0.15
        band = math.sin(center.z * scale * 1.10 + band_warp + noise_b * 0.18)
        base_idx = 2 if band < -.30 else (1 if band > .30 else 0)
        return 2 if is_belly else (0 if is_dorsal else base_idx)

    if pattern == "Spots":
        # 3D Voronoi — mirrors upgraded WGSL Spots branch (no triplanar seaming).
        # Blender coords: X=source X, Z=source Y (height), Y=-source Z (depth).
        src_x, src_y, src_z = center.x, center.z, -center.y
        noise_h = mix32(seed ^ (int(abs(src_x * 4 + src_y * 7 + src_z * 3) * 1000 + 512) * 0x9E3779B1 & 0xFFFFFFFF))
        noise_val = (noise_h & 0xFF) / 255.0
        sx = src_x * scale * 0.38 + noise_val * 0.14
        sy = src_y * scale * 0.38 + noise_val * 0.14
        sz = src_z * scale * 0.38 + noise_val * 0.14
        cx_v, cy_v, cz_v = math.floor(sx), math.floor(sy), math.floor(sz)
        min_d = 1.0
        for diz in (-1, 0, 1):
            for diy in (-1, 0, 1):
                for dix in (-1, 0, 1):
                    nb_x, nb_y, nb_z = cx_v + dix, cy_v + diy, cz_v + diz
                    hx = (math.sin(nb_x * 127.1 + nb_y * 311.7 + nb_z * 74.7) * 43758.545) % 1.0
                    hy = (math.sin(nb_x * 269.5 + nb_y * 183.3 + nb_z * 46.1) * 43758.545) % 1.0
                    hz = (math.sin(nb_x * 419.2 + nb_y * 371.4 + nb_z * 168.5) * 43758.545) % 1.0
                    d = math.sqrt((sx-(nb_x+0.2+hx*0.6))**2+(sy-(nb_y+0.2+hy*0.6))**2+(sz-(nb_z+0.2+hz*0.6))**2)
                    min_d = min(min_d, d)
        feature_variant = ((seed >> 16) & 0xFF) / 255.0
        spot_r = 0.26 + (feature_variant * 7.0 % 1.0) * 0.16
        spot_dir = 1.0 if feature_variant > 0.50 else -1.0
        spot_on = max(0.0, min(1.0, 1.0 - (min_d - spot_r) / 0.12))
        spot_outer = (max(0.0, min(1.0, (min_d - (spot_r - 0.02)) / 0.08)) *
                      max(0.0, min(1.0, 1.0 - (min_d - (spot_r + 0.06)) / 0.14)))
        spot_ring_dir = -0.18 if feature_variant > 0.50 else 0.18
        val = 0.50 + spot_dir * spot_on * 0.46 + spot_outer * spot_ring_dir
        base_idx = 2 if val > 0.65 else (0 if val < 0.35 else 1)
        return 2 if is_belly else (0 if is_dorsal else base_idx)

    # Mottled: three-octave domain-warped organic patches — mirrors WGSL Mottled branch.
    # Approximate triplanar noise with a position + seed hash.
    src_x, src_y, src_z = center.x, center.z, -center.y   # convert Blender → source coords
    h = mix32(seed ^ (int(src_x * 8 + 512) * 0x1F123BB5 & 0xFFFFFFFF) ^
              (int(src_y * 8 + 512) * 0x5F356495 & 0xFFFFFFFF) ^
              (int(src_z * 8 + 512) * 0x9E3779B1 & 0xFFFFFFFF))
    noise = (h & 0xFF) / 255.0
    warp = math.sin(src_x * scale * 0.42 + noise * 3.1 + 0.8) * 0.42
    s1 = math.sin((src_x * 0.38 + src_z * 0.62) * scale * 1.1 + noise * 1.8 + warp)
    s2 = math.sin((src_y * 0.55 + src_x * 0.45) * scale * 0.92 + noise * 2.3 - warp * 0.5)
    s3 = math.sin((src_z * 0.72 + src_y * 0.28) * scale * 1.58 + noise * 1.4 + warp * 0.62) * 0.28
    val = s1 * 0.38 + s2 * 0.38 + s3 + noise * 0.08 + 0.50
    t = max(0.0, min(1.0, (val - 0.18) / 0.64))
    smooth = t * t * (3.0 - 2.0 * t)
    base_idx = 2 if smooth > 0.67 else (0 if smooth < 0.33 else 1)
    return 2 if is_belly else (0 if is_dorsal else base_idx)


def assign_palette(mesh: bpy.types.Object, dna: dict, require_face: bool = True) -> dict:
    colors = PALETTES.get(dna["element"], PALETTES["Neutral"])
    roughness = float(dna["surface"]["roughness"]); metallic = float(dna["surface"]["metallic"])
    seed = int(dna["seed"])
    for index, color in enumerate(colors):
        mesh.data.materials.append(make_material(
            f"MAT_{dna['element']}_{index}", color, roughness, metallic,
            procedural=True, seed=seed ^ (index * 0x1337CAFE),
        ))
    mesh.data.materials.append(make_material("MAT_Face_Eye",   (.95, .97, 1.00, 1), .38))
    mesh.data.materials.append(make_material("MAT_Face_Pupil", (.012, .008, .022, 1), .28))
    mesh.data.materials.append(make_material("MAT_Face_Mouth", (.20, .030, .055, 1), .52))
    low, high = mesh_bounds(mesh)
    face = face_landmarks(dna); eye_points = [source_to_blender(p) for p in face["eyes"]]; mouth = source_to_blender(face["mouth"])
    eye_radius = face["eye_radius"]; pupil_radius = eye_radius * face["pupil_scale"]
    tip_pos, tip_r = tail_tip_blender(dna)
    feature_variant = ((int(dna["seed"]) >> 16) & 0xFF) / 255.0
    counts = {"palette": 0, "palette_regions": [0, 0, 0], "eye": 0, "pupil": 0, "mouth": 0}
    for polygon in mesh.data.polygons:
        center = polygon.center
        eye_distance = min(math.hypot(center.x-point.x, center.z-point.z) for point in eye_points)
        eye_depth = abs(center.y - eye_points[0].y)
        mouth_delta = center - mouth
        if eye_distance < pupil_radius*1.35 and eye_depth < eye_radius*1.85: polygon.material_index = 4; counts["pupil"] += 1
        elif eye_distance < eye_radius*1.38 and eye_depth < eye_radius*2.05: polygon.material_index = 3; counts["eye"] += 1
        elif abs(mouth_delta.x) < face["mouth_radius"]*2.45 and abs(mouth_delta.z) < face["mouth_radius"]*.78 and abs(mouth_delta.y) < face["mouth_radius"]*1.8:
            polygon.material_index = 5; counts["mouth"] += 1
        elif tip_pos is not None and tip_r > 0 and (center - tip_pos).length < tip_r * 1.8:
            # Tail tip accent: light (palette 2) for 58% of creatures, dark (palette 0) for 42%
            polygon.material_index = 2 if feature_variant > 0.58 else 0
            counts["palette"] += 1; counts["palette_regions"][polygon.material_index] += 1
        else:
            polygon.material_index = palette_region(center, dna, low, high, polygon.normal); counts["palette"] += 1; counts["palette_regions"][polygon.material_index] += 1
    if require_face and (not counts["eye"] or not counts["pupil"] or not counts["mouth"]):
        raise RuntimeError(f"facial material assignment produced an unreadable face: {counts}")
    return counts


def _displace_vertices_near(shape_key, cage: bpy.types.Object, center: Vector,
                             radius: float, delta: Vector) -> None:
    for i, vertex in enumerate(cage.data.vertices):
        dist = (Vector(vertex.co) - center).length
        if dist < radius:
            falloff = 1.0 - (dist / radius) ** 2
            shape_key.data[i].co.x += delta.x * falloff
            shape_key.data[i].co.y += delta.y * falloff
            shape_key.data[i].co.z += delta.z * falloff


def add_shape_keys(cage: bpy.types.Object, dna: dict) -> list[str]:
    """Create 5 morph targets (neutral, alert, angry, hurt, faint) on the cage."""
    face = face_landmarks(dna)
    l_eye = source_to_blender(face["eyes"][0])
    r_eye = source_to_blender(face["eyes"][1])
    mouth = source_to_blender(face["mouth"])
    r = face["eye_radius"]
    mr = face["mouth_radius"]

    cage.shape_key_add(name="Neutral", from_mix=False)

    alert = cage.shape_key_add(name="Alert", from_mix=False)
    for ec in (l_eye, r_eye):
        _displace_vertices_near(alert, cage, ec + Vector((0, 0, r*1.35)), r*0.9, Vector((0, 0, r*0.08)))

    angry = cage.shape_key_add(name="Angry", from_mix=False)
    _displace_vertices_near(angry, cage, l_eye + Vector((0, 0, r*1.35)), r*0.9, Vector((r*0.08, 0, -r*0.05)))
    _displace_vertices_near(angry, cage, r_eye + Vector((0, 0, r*1.35)), r*0.9, Vector((-r*0.08, 0, -r*0.05)))
    _displace_vertices_near(angry, cage, mouth, mr*2.0, Vector((0, 0, -mr*0.15)))

    hurt = cage.shape_key_add(name="Hurt", from_mix=False)
    _displace_vertices_near(hurt, cage, l_eye + Vector((0, 0, r*1.35)), r*0.9, Vector((-r*0.06, 0, r*0.06)))
    _displace_vertices_near(hurt, cage, r_eye + Vector((0, 0, r*1.35)), r*0.9, Vector((r*0.06, 0, r*0.06)))
    _displace_vertices_near(hurt, cage, mouth, mr*2.2, Vector((0, 0, -mr*0.25)))

    faint = cage.shape_key_add(name="Faint", from_mix=False)
    for ec in (l_eye, r_eye):
        _displace_vertices_near(faint, cage, ec + Vector((0, 0, r*0.85)), r*0.6, Vector((0, 0, -r*0.72)))
        _displace_vertices_near(faint, cage, ec + Vector((0, 0, -r*0.45)), r*0.6, Vector((0, 0, r*0.52)))

    return ["Neutral", "Alert", "Angry", "Hurt", "Faint"]


def reset_pose(arm: bpy.types.Object) -> None:
    for pose in arm.pose.bones:
        pose.rotation_mode = "XYZ"; pose.rotation_euler = (0, 0, 0); pose.location = (0, 0, 0); pose.scale = (1, 1, 1)


def add_rotation(arm: bpy.types.Object, name: str, x: float = 0, y: float = 0, z: float = 0) -> None:
    pose = arm.pose.bones.get(name)
    if pose: pose.rotation_euler.x += x; pose.rotation_euler.y += y; pose.rotation_euler.z += z


def add_location(arm: bpy.types.Object, name: str, x: float = 0, y: float = 0, z: float = 0) -> None:
    pose = arm.pose.bones.get(name)
    if pose: pose.location.x += x; pose.location.y += y; pose.location.z += z


def apply_motion_pose(arm: bpy.types.Object, kind: str, clip: str, phase: float) -> None:
    reset_pose(arm); wave = math.sin(phase*math.tau); counter = math.cos(phase*math.tau)
    if clip == "Idle":
        add_location(arm, "root", z=.018*wave)
        if kind == "Biped":
            add_rotation(arm, "spine_01", z=.025*wave); add_rotation(arm, "spine_02", x=.018*counter, z=-.018*wave)
            add_rotation(arm, "head", x=-.025*counter, z=-.035*wave); add_rotation(arm, "L_arm_upper", z=.018*wave); add_rotation(arm, "R_arm_upper", z=-.018*wave)
        elif kind == "Quadruped":
            add_rotation(arm, "spine_front", x=.022*counter); add_rotation(arm, "neck", x=-.035*counter); add_rotation(arm, "head", z=.025*wave)
            # Tail follow-through: lag behind spine_front by slight phase offset
            add_rotation(arm, "tail", y=.10*math.sin((phase-.12)*math.tau), z=.045*math.cos((phase-.12)*math.tau))
        elif kind == "Serpentine":
            for index in range(8): add_rotation(arm, f"body_{index+1:02d}", z=.045*math.sin(phase*math.tau-index*.52), x=.012*counter)
            add_rotation(arm, "head", z=-.055*wave)
        elif kind == "Avian":
            add_rotation(arm, "spine_front", x=.025*counter); add_rotation(arm, "head", x=-.04*counter, z=.025*wave)
            add_rotation(arm, "L_wing", y=.035*wave); add_rotation(arm, "R_wing", y=-.035*wave)
            add_rotation(arm, "tail", z=.035*math.sin((phase-.10)*math.tau))
        else:
            add_location(arm, "core", z=.045*wave); add_rotation(arm, "head", z=-.04*wave)
            for index in range(3): add_rotation(arm, f"orb_{index+1}", z=.10*math.sin(phase*math.tau+index*math.tau/3), y=.045*counter)
    elif clip in {"Walk", "Run"}:
        pace = 1.48 if clip == "Run" else 1.0
        add_location(arm, "root", z=.035*abs(wave)*pace, y=-.025*counter*(pace-1))
        if kind == "Biped":
            for side, sign in (("L", 1), ("R", -1)):
                swing = wave * sign; add_rotation(arm, f"{side}_leg_upper", x=.58*swing*pace); add_rotation(arm, f"{side}_leg_lower", x=.38*max(0, -swing)*pace)
                add_rotation(arm, f"{side}_arm_upper", x=-.42*swing*pace, z=-.04*sign); add_rotation(arm, f"{side}_arm_lower", x=-.18*swing*pace)
            add_rotation(arm, "spine_01", x=.10*(pace-1), z=.07*wave*pace); add_rotation(arm, "spine_02", z=-.045*wave*pace); add_rotation(arm, "head", z=-.035*wave*pace)
        elif kind in {"Quadruped", "Avian"}:
            for side, sign in (("L", 1), ("R", -1)):
                for region, offset in (("front", sign), ("rear", -sign)):
                    swing = wave * offset; add_rotation(arm, f"{side}_{region}_leg_upper", x=.46*swing*pace); add_rotation(arm, f"{side}_{region}_leg_lower", x=.34*max(0, -swing)*pace)
            add_rotation(arm, "spine_rear", x=.08*(pace-1), z=.035*wave*pace); add_rotation(arm, "spine_front", x=.035*counter*pace, z=-.03*wave*pace)
            add_rotation(arm, "head", x=-.05*counter*pace, z=.025*wave*pace)
            # Tail with follow-through lag
            add_rotation(arm, "tail", z=.08*math.sin((phase-.15)*math.tau)*pace)
            if kind == "Avian":
                add_rotation(arm, "L_wing", y=.08*counter*pace); add_rotation(arm, "R_wing", y=-.08*counter*pace)
        elif kind == "Serpentine":
            for index in range(8): add_rotation(arm, f"body_{index+1:02d}", z=.25*pace*math.sin(phase*math.tau-index*.62), x=.025*pace*math.cos(phase*math.tau-index*.45))
            add_rotation(arm, "head", z=-.12*pace*math.sin(phase*math.tau-4.5))
        else:
            add_location(arm, "core", x=.055*wave*pace, z=.055*abs(counter)*pace); add_rotation(arm, "head", z=-.08*wave*pace)
            for index in range(3): add_rotation(arm, f"orb_{index+1}", z=.34*pace*math.sin(phase*math.tau+index*math.tau/3), y=.12*counter*pace)
    elif clip == "Special":
        charge = math.sin(phase*math.pi); pulse = math.sin(phase*math.tau*2)*charge
        add_location(arm, "root", z=.12*charge); add_rotation(arm, "head", x=-.18*charge, z=.08*pulse)
        if kind == "Biped":
            add_rotation(arm, "spine_01", x=-.18*charge); add_rotation(arm, "spine_02", x=.28*charge)
            for side, sign in (("L", 1), ("R", -1)): add_rotation(arm, f"{side}_arm_upper", x=-.55*charge, y=sign*.58*charge); add_rotation(arm, f"{side}_arm_lower", x=.42*charge)
        elif kind in {"Quadruped", "Avian"}:
            add_rotation(arm, "spine_front", x=-.20*charge); add_rotation(arm, "neck", x=.28*charge); add_rotation(arm, "tail", z=.28*pulse)
            if kind == "Avian": add_rotation(arm, "L_wing", y=-1.18*charge, z=-.20*pulse); add_rotation(arm, "R_wing", y=1.18*charge, z=.20*pulse)
        elif kind == "Serpentine":
            for index in range(8): add_rotation(arm, f"body_{index+1:02d}", z=.38*charge*math.sin(index*.72+phase*math.tau), x=.08*charge)
        else:
            add_location(arm, "core", z=.24*charge)
            for index in range(3): add_rotation(arm, f"orb_{index+1}", z=(.82+index*.12)*charge*(-1 if index%2 else 1), y=.44*pulse)
    elif clip == "Hurt":
        recoil = math.sin(phase*math.pi); shake = math.sin(phase*math.tau*3)*recoil
        add_location(arm, "root", y=.18*recoil, z=.045*recoil); add_rotation(arm, "root", x=-.16*recoil, z=.06*shake); add_rotation(arm, "head", x=.24*recoil, z=-.12*shake)
        for name in ("spine_01", "spine_front", "core"): add_rotation(arm, name, x=-.14*recoil, z=.05*shake)
    elif clip == "Faint":
        fall = phase*phase*(3-2*phase); add_location(arm, "root", y=.16*fall, z=-.18*fall); add_rotation(arm, "root", x=1.08*fall, z=.12*fall); add_rotation(arm, "head", x=-.32*fall)
        for name in ("spine_01", "spine_rear", "core"): add_rotation(arm, name, x=.28*fall)
        for side in ("L", "R"):
            for region in ("front", "rear"): add_rotation(arm, f"{side}_{region}_leg_upper", x=.48*fall)
            add_rotation(arm, f"{side}_leg_upper", x=.55*fall); add_rotation(arm, f"{side}_arm_upper", x=-.30*fall)
    else:  # Attack
        envelope = math.sin(min(max(phase, 0), 1)*math.pi)
        anticipation = max(0, 1-phase*3); strike = max(0, 1-abs(phase-.52)*4)
        if kind == "Biped":
            add_location(arm, "root", y=-.10*strike, z=.035*envelope); add_rotation(arm, "spine_01", x=-.15*anticipation+.28*strike); add_rotation(arm, "spine_02", x=.22*strike)
            add_rotation(arm, "L_arm_upper", x=-.35*anticipation+1.0*strike, y=-.18*strike); add_rotation(arm, "R_arm_upper", x=-.25*anticipation+.82*strike, y=.18*strike)
            add_rotation(arm, "L_arm_lower", x=.52*strike); add_rotation(arm, "R_arm_lower", x=.45*strike); add_rotation(arm, "head", x=-.16*strike)
        elif kind == "Quadruped":
            add_location(arm, "root", y=-.18*strike, z=.04*envelope); add_rotation(arm, "spine_rear", x=-.08*anticipation+.14*strike); add_rotation(arm, "spine_front", x=-.24*strike)
            add_rotation(arm, "neck", x=.32*strike); add_rotation(arm, "head", x=-.38*strike); add_rotation(arm, "tail", y=.28*envelope, z=.18*counter*envelope)
            for side in ("L", "R"): add_rotation(arm, f"{side}_front_leg_upper", x=-.22*strike)
        elif kind == "Serpentine":
            for index in range(8): add_rotation(arm, f"body_{index+1:02d}", z=.34*envelope*math.sin(index*.68+phase*math.pi), x=.05*strike)
            add_location(arm, "root", y=-.16*strike); add_rotation(arm, "head", x=-.48*strike, z=.16*wave)
        elif kind == "Avian":
            add_location(arm, "root", y=-.12*strike, z=.12*envelope); add_rotation(arm, "spine_front", x=-.18*strike); add_rotation(arm, "head", x=.28*strike)
            add_rotation(arm, "L_wing", y=-1.05*strike, z=-.18*anticipation); add_rotation(arm, "R_wing", y=1.05*strike, z=.18*anticipation); add_rotation(arm, "tail", x=.20*strike)
        else:
            add_location(arm, "core", y=-.10*strike, z=.16*envelope); add_rotation(arm, "head", x=-.22*strike, z=.12*wave)
            for index in range(3): add_rotation(arm, f"orb_{index+1}", z=(.75+index*.08)*strike*(-1 if index%2 else 1), y=.35*envelope)


def create_actions(arm: bpy.types.Object, kind: str) -> list[str]:
    actions = []; frames = tuple(range(1, 18, 2)); clips = tuple((name, frames) for name in ("Idle", "Walk", "Run", "Attack", "Special", "Hurt", "Faint"))
    arm.animation_data_create()
    for clip, frames in clips:
        action = bpy.data.actions.new(clip); action.use_fake_user = True; arm.animation_data.action = action
        for frame_index, frame in enumerate(frames):
            phase = frame_index / (len(frames) - 1); bpy.context.scene.frame_set(frame); apply_motion_pose(arm, kind, clip, phase)
            for pose in arm.pose.bones:
                pose.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose.name)
                pose.keyframe_insert(data_path="location", frame=frame, group=pose.name)
        actions.append(clip)
    reset_pose(arm); arm.animation_data.action = bpy.data.actions["Idle"]
    bpy.context.scene.frame_start = 1; bpy.context.scene.frame_end = 17; bpy.context.scene.frame_set(1)
    return actions


def uv_unwrap_cage(cage: bpy.types.Object) -> None:
    """Smart-project UV unwrap the cage so baked textures can be exported via GLB."""
    bpy.context.view_layer.objects.active = cage
    cage.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    cage.select_set(False)


def _do_bake(cage: bpy.types.Object, tex_size: int) -> None:
    """Inner bake pass (called by bake_cage_textures; may raise)."""
    prev_engine = bpy.context.scene.render.engine

    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.cycles.samples = 4
    bpy.context.scene.cycles.use_denoising = False
    bpy.context.scene.render.bake.use_pass_direct = False
    bpy.context.scene.render.bake.use_pass_indirect = False
    bpy.context.scene.render.bake.use_pass_color = True
    bpy.context.scene.render.bake.margin = 4

    # Only bake body palette slots (not Eye / Pupil / Mouth — those stay flat)
    body_slots = [
        s for s in cage.material_slots
        if s.material and not any(tag in s.material.name for tag in ("_Eye", "_Pupil", "_Mouth"))
    ]

    col_targets: dict[str, tuple] = {}
    norm_targets: dict[str, tuple] = {}

    for slot in body_slots:
        mat = slot.material
        nodes = mat.node_tree.nodes

        col_img = bpy.data.images.new(f"TEX_COL_{mat.name}", tex_size, tex_size, alpha=False)
        col_img.colorspace_settings.name = "sRGB"
        norm_img = bpy.data.images.new(f"TEX_NRM_{mat.name}", tex_size, tex_size, alpha=False)
        norm_img.colorspace_settings.name = "Non-Color"
        # Initialise normal image to flat (0,0,1) in tangent space
        norm_img.generated_color = (0.5, 0.5, 1.0, 1.0)

        col_node = nodes.new("ShaderNodeTexImage")
        col_node.image = col_img; col_node.location = (-900, 500)
        norm_node = nodes.new("ShaderNodeTexImage")
        norm_node.image = norm_img; norm_node.location = (-900, 250)

        col_targets[mat.name] = (col_img, col_node)
        norm_targets[mat.name] = (norm_img, norm_node)

    bpy.context.view_layer.objects.active = cage
    cage.select_set(True)

    # Pass 1 — base colour
    for slot in body_slots:
        slot.material.node_tree.nodes.active = col_targets[slot.material.name][1]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=4)

    # Pass 2 — tangent-space normal
    for slot in body_slots:
        slot.material.node_tree.nodes.active = norm_targets[slot.material.name][1]
    bpy.ops.object.bake(type="NORMAL", margin=4)

    cage.select_set(False)

    # Replace procedural nodes with baked image textures
    for slot in body_slots:
        mat = slot.material
        tree = mat.node_tree
        nodes = tree.nodes
        links = tree.links

        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        out_node = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not bsdf or not out_node:
            continue

        col_img, col_node = col_targets[mat.name]
        norm_img, norm_node = norm_targets[mat.name]
        keep_ids = {id(bsdf), id(out_node), id(col_node), id(norm_node)}

        # Disconnect procedural links on Base Color / Roughness / Normal
        for lnk in list(links):
            if lnk.to_socket in (bsdf.inputs["Base Color"], bsdf.inputs["Roughness"], bsdf.inputs["Normal"]):
                links.remove(lnk)
        # Remove procedural nodes (keep BSDF, output, the two bake image nodes)
        for node in list(nodes):
            if id(node) not in keep_ids:
                nodes.remove(node)

        col_node.location = (-400, 200)
        links.new(col_node.outputs["Color"], bsdf.inputs["Base Color"])

        norm_node.location = (-400, -80)
        nm = nodes.new("ShaderNodeNormalMap")
        nm.location = (-120, -80)
        nm.space = "TANGENT"
        nm.inputs["Strength"].default_value = 0.85
        links.new(norm_node.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

        # Reconnect BSDF → output if link was lost
        if not any(lnk.from_node == bsdf for lnk in links):
            links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    bpy.context.scene.render.engine = prev_engine


def bake_cage_textures(cage: bpy.types.Object, tex_size: int = 512) -> None:
    """Bake procedural body materials to image textures so GLB carries real texture detail.
    Gracefully skips if Cycles is unavailable or the bake fails."""
    import traceback
    try:
        _do_bake(cage, tex_size)
    except Exception as exc:
        print(f"WARNING: MonGen texture bake skipped — {exc}")
        traceback.print_exc()


def action_motion_metrics(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict[str, float]:
    sample_frames = {"Idle": (1, 5), "Walk": (1, 5), "Run": (1, 5), "Attack": (1, 9), "Special": (1, 9), "Hurt": (1, 7), "Faint": (1, 17)}
    step = max(1, len(mesh.data.vertices) // 384); metrics = {}
    for action_name, frames in sample_frames.items():
        arm.animation_data.action = bpy.data.actions[action_name]; samples = []
        for frame in frames:
            bpy.context.scene.frame_set(frame); evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            samples.append([evaluated.matrix_world @ evaluated.data.vertices[i].co for i in range(0, len(evaluated.data.vertices), step)])
        metrics[action_name] = max((a-b).length for a, b in zip(samples[0], samples[1]))
        if metrics[action_name] <= .002: raise RuntimeError(f"{action_name} deformation is below the production motion floor")
    if len({round(value, 3) for value in metrics.values()}) < 6: raise RuntimeError(f"animation clips lack sufficient motion diversity: {metrics}")
    arm.animation_data.action = bpy.data.actions["Idle"]; bpy.context.scene.frame_set(1)
    return metrics


def export_glb(path: Path, selected_only: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", export_yup=True, export_apply=False,
        export_materials="EXPORT", export_animations=True, export_animation_mode="ACTIONS",
        export_skins=True, export_morph=True, export_normals=True, export_tangents=False,
        export_cameras=False, export_lights=False, export_extras=True,
        export_influence_nb=4, export_all_influences=False,
        use_selection=selected_only,
    )
    if not path.is_file() or path.stat().st_size == 0: raise RuntimeError("GLB export did not produce a file")


def export_lods(mesh: bpy.types.Object, arm: bpy.types.Object, directory: Path) -> list[dict]:
    directory.mkdir(parents=True, exist_ok=True); results = []
    source_triangles = sum(len(poly.vertices) - 2 for poly in mesh.data.polygons)
    for level, ceiling, ratio in ((1, 15000, .50), (2, 5000, .20)):
        target = max(512, min(ceiling, int(source_triangles * ratio)))
        clone = mesh.copy(); clone.data = mesh.data.copy(); clone.name = f"{mesh.name}_LOD{level}"
        bpy.context.collection.objects.link(clone)
        # Remove shape keys before decimating (LODs ship without morph targets)
        if clone.data.shape_keys:
            bpy.context.view_layer.objects.active = clone
            bpy.ops.object.shape_key_remove(all=True)
        for modifier in list(clone.modifiers):
            if modifier.type == "ARMATURE": clone.modifiers.remove(modifier)
        bpy.ops.object.select_all(action="DESELECT"); clone.select_set(True); bpy.context.view_layer.objects.active = clone
        triangles = enforce_triangle_budget(clone, target)
        modifier = clone.modifiers.new(name="Armature", type="ARMATURE"); modifier.object = arm
        clean_weights(clone, arm)
        bpy.ops.object.select_all(action="DESELECT"); clone.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = clone
        path = directory / f"creature-lod{level}.glb"; export_glb(path, selected_only=True)
        results.append({"level": level, "target_triangles": target, "triangles": triangles, "vertices": len(clone.data.vertices), "glb": str(path), "glb_bytes": path.stat().st_size})
        bpy.data.objects.remove(clone, do_unlink=True)
    return results


def main() -> None:
    args = parse_args()
    mesh_path = Path(args.mesh).resolve(); dna_path = Path(args.dna).resolve(); output = Path(args.output).resolve()
    dna = json.loads(dna_path.read_text(encoding="utf8"))
    name = "".join(c if c.isalnum() else "_" for c in dna["name"])
    add_face_rig = not args.allow_missing_face

    clear_scene()

    # --- Phase 2: build retopologized cage over the MC mesh ---
    mc_mesh = import_mesh(mesh_path, name)
    triangles_lod0 = enforce_triangle_budget(mc_mesh, 60000)
    low, high = mesh_bounds(mc_mesh)

    retopo = _load_module("retopo_cage", "retopo_cage.py")
    cage = retopo.build_cage(dna["skeleton"], low, high, mc_mesh)
    # Remove MC mesh now that cage is shrinkwrapped
    bpy.data.objects.remove(mc_mesh, do_unlink=True)

    # Recalculate normals in EDIT mode — more reliable than bmesh heuristic on disconnected geometry
    bpy.context.view_layer.objects.active = cage; cage.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT"); cage.select_set(False)

    # UV unwrap here so textures can be baked after materials are assigned
    uv_unwrap_cage(cage)

    triangles_lod0 = sum(len(poly.vertices) - 2 for poly in cage.data.polygons)
    low, high = mesh_bounds(cage)

    # --- Primary rig ---
    arm = create_armature(name, skeleton_specs(dna["skeleton"], low, high))

    # --- Phase 3: facial bones ---
    facial_bone_names: list[str] = []
    if add_face_rig:
        facial_bone_names = add_facial_bones(arm, dna)

    # --- Bind and weight ---
    bind_automatic(cage, arm)
    repaired, max_influences = clean_weights(cage, arm)

    # --- Phase 3: facial vertex groups ---
    if add_face_rig and facial_bone_names:
        add_facial_vertex_groups(cage, arm, dna)

    # --- Palette and face material assignment ---
    face_material_faces = assign_palette(cage, dna, require_face=add_face_rig)

    # --- Bake procedural body materials to image textures for GLB ---
    bake_cage_textures(cage)

    # --- Phase 3: shape keys (morph targets) ---
    shape_key_names: list[str] = []
    if add_face_rig:
        shape_key_names = add_shape_keys(cage, dna)

    # --- Animation ---
    actions = create_actions(arm, dna["skeleton"])
    action_deltas = action_motion_metrics(cage, arm)
    deformation_delta = action_deltas["Walk"]

    # --- Phase 1: anatomy assets ---
    anatomy_objs: list[dict] = []
    if dna.get("attachments"):
        anatomy_mod = _load_module("anatomy_assets", "anatomy_assets.py")
        anatomy_objs = anatomy_mod.build_all_anatomy(dna, arm, PALETTES)

    # --- Export ---
    cage["mongen_schema_version"] = dna["schemaVersion"]
    cage["mongen_generator_version"] = dna["generatorVersion"]
    cage["mongen_seed"] = str(dna["seed"])
    export_glb(output)

    lods = export_lods(cage, arm, Path(args.lod_dir).resolve()) if args.lod_dir else []
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.blend).resolve()), compress=True)

    report = {
        "blender_version": bpy.app.version_string, "mesh": cage.name,
        "vertices": len(cage.data.vertices), "triangles": triangles_lod0, "triangle_budget": 60000,
        "vertices_before_weld": cage.get("mongen_vertices_before_weld", 0),
        "bones": len(arm.data.bones), "deform_bones": sum(b.use_deform for b in arm.data.bones),
        "facial_bones": len(facial_bone_names), "shape_keys": shape_key_names,
        "anatomy_objects": len(anatomy_objs),
        "vertex_groups": len(cage.vertex_groups), "repaired_unweighted_vertices": repaired,
        "max_influences": max_influences, "actions": actions,
        "deformation_test_max_delta": deformation_delta, "action_motion_max_delta": action_deltas,
        "animation_profile": dna["skeleton"], "face_material_faces": face_material_faces,
        "lods": lods, "glb": str(output), "glb_bytes": output.stat().st_size,
    }
    text = json.dumps(report, indent=2, sort_keys=True)
    print("MONGEN_REPORT " + json.dumps(report, sort_keys=True))
    if args.report: Path(args.report).resolve().write_text(text + "\n", encoding="utf8")


if __name__ == "__main__": main()
