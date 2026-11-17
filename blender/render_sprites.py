#!/usr/bin/env python3
"""Render an animated MonGen .blend into an 8-direction pixel-art atlas."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector


DIRECTIONS = (
    ("south", 0), ("southwest", 45), ("west", 90), ("northwest", 135),
    ("north", 180), ("northeast", 225), ("east", 270), ("southeast", 315),
)
BASE_ANIMATIONS = (
    ("Idle",    (1, 3, 5, 7, 9, 11, 13, 15), (125,)*8,                          True),
    ("Walk",    (1, 3, 5, 7, 9, 11, 13, 15), (90,)*8,                           True),
    ("Run",     (1, 3, 5, 7, 9, 11, 13, 15), (65,)*8,                           True),
    ("Attack",  (1, 3, 5, 7, 9, 11, 13, 15), (80,65,55,55,70,85,100,120),       False),
    ("Special", (1, 3, 5, 7, 9, 11, 13, 15), (100,80,70,60,60,75,95,130),       False),
    ("Hurt",    (1, 3, 5, 7, 9, 11, 13, 15), (70,60,70,85,100,110,120,130),     False),
    ("Faint",   (1, 3, 5, 7, 9, 11, 13, 15), (90,90,100,110,120,140,180,260),   False),
)
# Clip → (shape_key_name, weight) — drives facial expression morph targets before render
CLIP_EXPRESSION = {
    "Idle": ("Neutral", 0.6), "Walk": ("Neutral", 0.8), "Run": ("Alert", 0.7),
    "Attack": ("Angry", 1.0), "Special": ("Alert", 0.9), "Hurt": ("Hurt", 1.0), "Faint": ("Faint", 1.0),
}
CELL_SIZE = 128
RENDER_SIZE = 256
EFFECTIVE_PIXEL_SIZE = 64
PALETTE_COLORS = 32


def build_animation_table(timing_mult: float) -> tuple:
    """Scale all per-frame durations by timing_mult (clamped ≥16ms)."""
    result = []
    for name, frames, durations, loop in BASE_ANIMATIONS:
        scaled = tuple(max(16, round(d * timing_mult)) for d in durations)
        result.append((name, frames, scaled, loop))
    return tuple(result)


def parse_args() -> argparse.Namespace:
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    parser=argparse.ArgumentParser()
    parser.add_argument("--blend",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--metadata",required=True)
    parser.add_argument("--frames-dir",required=True)
    parser.add_argument("--dna",default=None,help="Path to .dna.json for art-direction overrides")
    return parser.parse_args(argv)


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler=(target-obj.location).to_track_quat("-Z","Y").to_euler()


def setup_compositor(scene: bpy.types.Scene) -> None:
    group=bpy.data.node_groups.get("MonGen Pixel Art") or bpy.data.node_groups.new("MonGen Pixel Art","CompositorNodeTree")
    group.nodes.clear()
    if not any(item.item_type=="SOCKET" and item.in_out=="OUTPUT" for item in group.interface.items_tree):
        group.interface.new_socket(name="Image",in_out="OUTPUT",socket_type="NodeSocketColor")
    render=group.nodes.new("CompositorNodeRLayers")
    pixelate=group.nodes.new("CompositorNodePixelate"); pixelate.inputs["Size"].default_value=2
    posterize=group.nodes.new("CompositorNodePosterize"); posterize.inputs["Steps"].default_value=6
    output=group.nodes.new("NodeGroupOutput")
    group.links.new(render.outputs["Image"],pixelate.inputs["Color"])
    group.links.new(pixelate.outputs["Color"],posterize.inputs["Image"])
    group.links.new(posterize.outputs["Image"],output.inputs["Image"])
    scene.compositing_node_group=group


def setup_world_and_lights(scene: bpy.types.Scene, center: Vector, extent: float,
                            palette_temp_bias: float = 0.0) -> None:
    world=bpy.data.worlds.new("MonGen Black Void") if not scene.world else scene.world
    scene.world=world
    background=world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value=(0,0,0,1); background.inputs["Strength"].default_value=0
    # Shift key light warmth by palette_temp_bias: positive → warmer (more red), negative → cooler (more blue)
    key_r = min(1.0, max(0.0, 1.0 + palette_temp_bias * 0.20))
    key_g = min(1.0, max(0.0, 0.82 - palette_temp_bias * 0.08))
    key_b = min(1.0, max(0.0, 0.62 - palette_temp_bias * 0.28))
    for name,location,energy,size,color in (
        ("Key",  center+Vector((-extent,-extent,extent*1.8)), 900*extent,  extent*2.0, (key_r, key_g, key_b)),
        ("Fill", center+Vector((extent,0,extent*.8)),         350*extent,  extent*2.5, (0.35,0.55,1.0)),
        ("Rim",  center+Vector((0,extent,extent*1.2)),        600*extent,  extent*1.5, (1.0,0.25,0.08)),
    ):
        data=bpy.data.lights.new(name,"AREA"); data.energy=energy; data.shape="DISK"; data.size=size; data.color=color
        light=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(light); light.location=location; look_at(light,center)


def setup_scene(scene: bpy.types.Scene, mesh: bpy.types.Object, arm: bpy.types.Object,
                palette_temp_bias: float = 0.0) -> tuple[bpy.types.Object,bpy.types.Object]:
    scene.render.engine="BLENDER_EEVEE"
    scene.render.resolution_x=RENDER_SIZE; scene.render.resolution_y=RENDER_SIZE; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"; scene.render.image_settings.color_mode="RGB"; scene.render.image_settings.color_depth="8"; scene.render.image_settings.compression=100
    scene.render.film_transparent=False; scene.render.use_file_extension=True; scene.render.use_persistent_data=True
    scene.view_settings.view_transform="Standard"; scene.view_settings.look="Medium High Contrast"; scene.view_settings.exposure=0; scene.view_settings.gamma=1
    scene.camera=None
    low=Vector(tuple(min((mesh.matrix_world@Vector(c))[i] for c in mesh.bound_box) for i in range(3)))
    high=Vector(tuple(max((mesh.matrix_world@Vector(c))[i] for c in mesh.bound_box) for i in range(3)))
    center=(low+high)*.5; dimensions=high-low; radius_xy=math.hypot(dimensions.x*.5,dimensions.y*.5)
    framing=max(dimensions.z+radius_xy*.4,radius_xy*2)*1.28
    extent=max(dimensions.length,1.0)
    turntable=bpy.data.objects.new("MonGen Turntable",None); bpy.context.collection.objects.link(turntable); turntable.location=(center.x,center.y,low.z)
    for obj in (mesh,arm):
        world=obj.matrix_world.copy(); obj.parent=turntable; obj.matrix_world=world
    target=Vector((center.x,center.y,low.z+dimensions.z*.48))
    camera_data=bpy.data.cameras.new("MonGen Orthographic Camera"); camera_data.type="ORTHO"; camera_data.ortho_scale=framing
    camera=bpy.data.objects.new("MonGen Orthographic Camera",camera_data); bpy.context.collection.objects.link(camera)
    angle=math.radians(18); distance=extent*5
    camera.location=target+Vector((0,-math.cos(angle)*distance,math.sin(angle)*distance)); look_at(camera,target); scene.camera=camera
    setup_world_and_lights(scene, target, extent, palette_temp_bias); setup_compositor(scene)
    return turntable,camera


def run_magick(*arguments: str) -> None:
    subprocess.run(["magick",*arguments],check=True)


def projected_bounds(camera: bpy.types.Object,mesh: bpy.types.Object) -> tuple[float,float,float,float]:
    bpy.context.view_layer.update()
    evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    camera_inverse=camera.matrix_world.inverted()
    evaluated_mesh=evaluated.to_mesh()
    try:
        points=[camera_inverse @ (evaluated.matrix_world @ vertex.co) for vertex in evaluated_mesh.vertices]
    finally:
        evaluated.to_mesh_clear()
    return min(point.x for point in points),max(point.x for point in points),min(point.y for point in points),max(point.y for point in points)


def build_camera_profiles(camera: bpy.types.Object, mesh: bpy.types.Object, arm: bpy.types.Object,
                           turntable: bpy.types.Object, animations: tuple,
                           margin: float=1.18) -> tuple[Vector,dict[str,dict[str,float]]]:
    """One union envelope per direction prevents animation-dependent camera zoom."""
    base_location=camera.location.copy(); profiles={}
    for direction_name,degrees in DIRECTIONS:
        camera.location=base_location; turntable.rotation_euler.z=math.radians(degrees); bounds=[math.inf,-math.inf,math.inf,-math.inf]
        for action_name,source_frames,_,_ in animations:
            arm.animation_data.action=bpy.data.actions[action_name]
            for source_frame in source_frames:
                bpy.context.scene.frame_set(source_frame); left,right,bottom,top=projected_bounds(camera,mesh)
                bounds=[min(bounds[0],left),max(bounds[1],right),min(bounds[2],bottom),max(bounds[3],top)]
        width=bounds[1]-bounds[0]; height=bounds[3]-bounds[2]
        profiles[direction_name]={"centerX":(bounds[0]+bounds[1])*.5,"centerY":(bounds[2]+bounds[3])*.5,"orthoScale":max(width,height,.01)*margin}
    return base_location,profiles


def apply_camera_profile(camera: bpy.types.Object,base_location: Vector,profile: dict[str,float]) -> None:
    camera.location=base_location
    bpy.context.view_layer.update()
    camera.location+=camera.matrix_world.to_quaternion() @ Vector((profile["centerX"],profile["centerY"],0))
    camera.data.ortho_scale=profile["orthoScale"]


def set_expression(mesh: bpy.types.Object, key_name: str, weight: float) -> None:
    """Set a single shape key to `weight` and zero all others."""
    if not mesh.data.shape_keys:
        return
    for kb in mesh.data.shape_keys.key_blocks:
        kb.value = weight if kb.name == key_name else 0.0


def main() -> None:
    args=parse_args(); blend=Path(args.blend).resolve(); output=Path(args.output).resolve()
    metadata=Path(args.metadata).resolve(); frames_dir=Path(args.frames_dir).resolve()
    output.parent.mkdir(parents=True,exist_ok=True); frames_dir.mkdir(parents=True,exist_ok=True)

    # Art direction from DNA
    timing_mult = 1.0; palette_temp_bias = 0.0
    if args.dna:
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location("mongen_utils", Path(__file__).parent / "mongen_utils.py")
        _utils = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_utils)
        dna = json.loads(Path(args.dna).resolve().read_text(encoding="utf8"))
        art = dna.get("artDirection", {})
        if "timingMultiplier" in art:
            timing_mult = float(art["timingMultiplier"])
        elif dna.get("skeleton") and dna.get("seed"):
            cfg = _utils.get_archetype_config(dna["skeleton"], int(dna["seed"]))
            timing_mult = cfg.get("timing_multiplier", 1.0)
            if "paletteTemperatureBias" not in art:
                palette_temp_bias = cfg.get("palette_temp_bias", 0.0)
        if "paletteTemperatureBias" in art:
            palette_temp_bias = float(art["paletteTemperatureBias"])

    animations = build_animation_table(timing_mult)

    bpy.ops.wm.open_mainfile(filepath=str(blend))
    meshes=[o for o in bpy.context.scene.objects if o.type=="MESH" and any(m.type=="ARMATURE" for m in o.modifiers)]
    arms=[o for o in bpy.context.scene.objects if o.type=="ARMATURE"]
    if len(meshes)!=1 or len(arms)!=1: raise RuntimeError(f"expected one skinned mesh and armature, found {len(meshes)} and {len(arms)}")
    mesh,arm=meshes[0],arms[0]
    turntable,camera=setup_scene(bpy.context.scene, mesh, arm, palette_temp_bias)
    camera_base,camera_profiles=build_camera_profiles(camera, mesh, arm, turntable, animations)
    records=[]; ordered=[]; row=0
    for action_name,source_frames,durations,loop in animations:
        action=bpy.data.actions.get(action_name)
        if not action: raise RuntimeError(f"missing action {action_name}")
        arm.animation_data_create(); arm.animation_data.action=action
        # Set facial expression for this clip
        expr_key, expr_weight = CLIP_EXPRESSION.get(action_name, ("Neutral", 1.0))
        set_expression(mesh, expr_key, expr_weight)
        for direction_name,degrees in DIRECTIONS:
            turntable.rotation_euler.z=math.radians(degrees)
            apply_camera_profile(camera,camera_base,camera_profiles[direction_name])
            for frame_index,(source_frame,duration) in enumerate(zip(source_frames,durations)):
                bpy.context.scene.frame_set(source_frame)
                stem=f"{action_name.lower()}_{direction_name}_{frame_index:02d}"
                raw=frames_dir/f"{stem}_raw.png"; final=frames_dir/f"{stem}.png"
                bpy.context.scene.render.filepath=str(raw); bpy.ops.render.render(write_still=True)
                run_magick(str(raw),"-filter","box","-resize",f"{EFFECTIVE_PIXEL_SIZE}x{EFFECTIVE_PIXEL_SIZE}!","-colors",str(PALETTE_COLORS),"-dither","None","-filter","point","-resize",f"{CELL_SIZE}x{CELL_SIZE}!","-alpha","off","-type","Palette",f"PNG8:{final}")
                raw.unlink(); ordered.append(str(final))
                records.append({"name":stem,"animation":action_name.lower(),"direction":direction_name,"directionDegrees":degrees,"frame":frame_index,
                  "sourceFrame":source_frame,"durationMs":duration,"x":frame_index*CELL_SIZE,"y":row*CELL_SIZE,"w":CELL_SIZE,"h":CELL_SIZE})
            row+=1
    columns=max(len(animation[1]) for animation in animations)
    run_magick("montage",*ordered,"-tile",f"{columns}x{row}","-geometry",f"{CELL_SIZE}x{CELL_SIZE}+0+0","-background","black","-alpha","off","-type","Palette",f"PNG8:{output}")
    run_magick(str(output),"-colors",str(PALETTE_COLORS),"-dither","None","-type","Palette","-strip","-define","png:compression-level=9","-define","png:compression-filter=5",f"PNG8:{output}")
    manifest={"schemaVersion":"1.1.0","image":output.name,"width":CELL_SIZE*columns,"height":CELL_SIZE*row,
      "cell":{"width":CELL_SIZE,"height":CELL_SIZE,"effectivePixelGrid":EFFECTIVE_PIXEL_SIZE},
      "layout":{"columns":columns,"rows":row,"directions":[d[0] for d in DIRECTIONS],"animationOrder":[a[0].lower() for a in animations]},
      "animations":{name.lower():{"frames":len(frames),"directions":8,"rowStart":i*8,"loop":loop,"durationsMs":list(durations)} for i,(name,frames,durations,loop) in enumerate(animations)},
      "cameraProfiles":camera_profiles,"timingMultiplier":timing_mult,"paletteTemperatureBias":palette_temp_bias,
      "frames":records}
    metadata.write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n",encoding="utf8")
    print("MONGEN_SPRITES "+json.dumps({"sheet":str(output),"bytes":output.stat().st_size,"frames":len(records),"width":manifest["width"],"height":manifest["height"]},sort_keys=True))


if __name__=="__main__": main()
