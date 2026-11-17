#!/usr/bin/env python3
"""Exercise every MonGen skeleton through rigging, GLB export, and re-import."""
import json
import subprocess
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
DNA=json.loads((ROOT/"examples/emberling.dna.json").read_text())
MESH=ROOT/"artifacts/emberling-r32.obj"
SKELETONS=("Biped","Quadruped","Serpentine","Avian","Floating")

with tempfile.TemporaryDirectory(prefix="mongen-blender-test-") as directory:
    temp=Path(directory)
    for skeleton in SKELETONS:
        dna={**DNA,"name":f"Test{skeleton}","skeleton":skeleton,"attachments":[]}
        dna_path=temp/f"{skeleton}.json"; glb_path=temp/f"{skeleton}.glb"
        dna_path.write_text(json.dumps(dna),encoding="utf8")
        commands=(
            ["blender","--background","--factory-startup","--python",str(ROOT/"blender/rig_export.py"),"--","--mesh",str(MESH),"--dna",str(dna_path),"--output",str(glb_path),"--allow-missing-face"],
            ["blender","--background","--factory-startup","--python",str(ROOT/"blender/verify_glb.py"),"--","--glb",str(glb_path)],
        )
        for command in commands:
            result=subprocess.run(command,cwd=ROOT,text=True,capture_output=True)
            if result.returncode:
                print(result.stdout); print(result.stderr); raise SystemExit(result.returncode)
        print(f"{skeleton}: {glb_path.stat().st_size} bytes, rig/export/import passed")
