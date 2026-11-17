#!/usr/bin/env python3
"""Import a produced GLB into a clean scene and assert its rig contract."""
import argparse, json, sys
from pathlib import Path
import bpy

argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
parser=argparse.ArgumentParser(); parser.add_argument("--glb",required=True); parser.add_argument("--report"); args=parser.parse_args(argv)
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path(args.glb).resolve()))
arms=[o for o in bpy.data.objects if o.type=="ARMATURE"]
meshes=[o for o in bpy.data.objects if o.type=="MESH" and any(m.type=="ARMATURE" for m in o.modifiers)]
if len(meshes)!=1 or len(arms)!=1: raise RuntimeError(f"expected one skinned mesh and armature, got {len(meshes)} and {len(arms)}")
mesh,arm=meshes[0],arms[0]; modifiers=[m for m in mesh.modifiers if m.type=="ARMATURE"]
if len(modifiers)!=1 or modifiers[0].object!=arm: raise RuntimeError("imported mesh is not bound to imported armature")
if not mesh.vertex_groups: raise RuntimeError("imported mesh has no skin weights")
actions=sorted(action.name for action in bpy.data.actions)
required_actions={"Idle","Walk","Run","Attack","Special","Hurt","Faint"}
if not required_actions.issubset(actions): raise RuntimeError(f"missing required actions: {actions}")
arm.animation_data_create(); step=max(1,len(mesh.data.vertices)//384)
action_frames={"Idle":(1,5),"Walk":(1,5),"Run":(1,5),"Attack":(1,9),"Special":(1,9),"Hurt":(1,7),"Faint":(1,17)}; action_deltas={}
for action_name,frames in action_frames.items():
    arm.animation_data.action=bpy.data.actions[action_name]; samples=[]
    for frame in frames:
        bpy.context.scene.frame_set(frame); evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        samples.append([evaluated.matrix_world@evaluated.data.vertices[i].co for i in range(0,len(evaluated.data.vertices),step)])
    action_deltas[action_name]=max((a-b).length for a,b in zip(samples[0],samples[1]))
    if action_deltas[action_name]<=.002: raise RuntimeError(f"round-tripped {action_name} action is below the production motion floor")
if len({round(value,3) for value in action_deltas.values()})<6: raise RuntimeError(f"round-tripped actions lack distinct motion signatures: {action_deltas}")
animation_delta=action_deltas["Walk"]
# Facial rig validation (gated: only when facial bones are present)
bone_names={b.name for b in arm.data.bones}
facial_bones=bone_names & {"jaw","L_eye","R_eye"}
shape_key_names=[]
if facial_bones:
    required_shape_keys={"Neutral","Alert","Angry","Hurt","Faint"}
    actual_shape_keys={kb.name for kb in mesh.data.shape_keys.key_blocks} if mesh.data.shape_keys else set()
    missing=required_shape_keys-actual_shape_keys
    if missing: raise RuntimeError(f"facial bones present but shape keys missing: {missing}")
    shape_key_names=sorted(actual_shape_keys)
report={"meshes":len(meshes),"armatures":len(arms),"vertices":len(mesh.data.vertices),"triangles":len(mesh.data.polygons),
  "bones":len(arm.data.bones),"facial_bones":sorted(facial_bones),"shape_keys":shape_key_names,
  "vertex_groups":len(mesh.vertex_groups),"actions":actions,"materials":len(mesh.data.materials),
  "roundtrip_animation_max_delta":animation_delta,"roundtrip_action_max_delta":action_deltas}
print("MONGEN_VERIFY "+json.dumps(report,sort_keys=True))
if args.report: Path(args.report).resolve().write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf8")
