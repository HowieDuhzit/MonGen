#!/usr/bin/env python3
"""Validate atlas geometry, metadata coverage, palette mode, and non-empty cells."""
import argparse, json, re, struct, subprocess
from pathlib import Path

parser=argparse.ArgumentParser(); parser.add_argument("--sheet",required=True); parser.add_argument("--metadata",required=True); parser.add_argument("--report"); args=parser.parse_args()
sheet=Path(args.sheet).resolve(); manifest=json.loads(Path(args.metadata).read_text(encoding="utf8")); data=sheet.read_bytes()
if data[:8]!=b"\x89PNG\r\n\x1a\n": raise RuntimeError("sprite sheet is not PNG")
width,height,bit_depth,color_type=struct.unpack(">IIBB",data[16:26])
if (width,height)!=(manifest["width"],manifest["height"]): raise RuntimeError("PNG and metadata dimensions differ")
cell_w,cell_h=manifest["cell"]["width"],manifest["cell"]["height"]
columns,rows=manifest["layout"]["columns"],manifest["layout"]["rows"]
if width!=cell_w*columns: raise RuntimeError("sheet width is not an exact cell multiple")
if height!=cell_h*rows: raise RuntimeError("sheet height is not an exact cell multiple")
if color_type!=3: raise RuntimeError(f"expected indexed PNG color type 3, got {color_type}")
frames=manifest["frames"]
expected_frames=sum(animation["frames"]*animation["directions"] for animation in manifest["animations"].values())
if len(frames)!=expected_frames or len({f["name"] for f in frames})!=expected_frames: raise RuntimeError(f"expected {expected_frames} unique atlas frames")
for frame in frames:
    if frame["w"]!=cell_w or frame["h"]!=cell_h or frame["x"]%cell_w or frame["y"]%cell_h: raise RuntimeError(f"misaligned frame {frame['name']}")
identify=subprocess.run(["magick","identify","-format","%k",str(sheet)],check=True,text=True,capture_output=True)
colors=int(identify.stdout)
if colors>32: raise RuntimeError(f"global sprite palette has {colors} colors; limit is 32")
crop=f"{columns}x{rows}@"
means=subprocess.run(["magick",str(sheet),"-crop",crop,"+repage","-format","%[fx:mean]\n","info:"],check=True,text=True,capture_output=True)
cell_means=[float(value) for value in means.stdout.splitlines() if value.strip()]
if len(cell_means)!=expected_frames or min(cell_means)<=0.0001: raise RuntimeError("one or more atlas cells are empty")
trimmed=subprocess.run(["magick",str(sheet),"-crop",crop,"+repage","-trim","-format","%w %h %X %Y\n","info:"],check=True,text=True,capture_output=True)
boxes=[]
for line in trimmed.stdout.splitlines():
    match=re.fullmatch(r"(\d+) (\d+) ([+-]\d+) ([+-]\d+)",line.strip())
    if not match: raise RuntimeError(f"cannot parse cell bounds: {line}")
    w,h,x,y=map(int,match.groups()); boxes.append((w,h,x,y))
if len(boxes)!=expected_frames: raise RuntimeError("could not measure all atlas cells")
minimum_margin=max(2,cell_w//32)
if any(x<minimum_margin or y<minimum_margin or x+w>cell_w-minimum_margin or y+h>cell_h-minimum_margin for w,h,x,y in boxes): raise RuntimeError(f"sprite foreground violates the {minimum_margin}-pixel safety margin")
signatures=subprocess.run(["magick",str(sheet),"-crop",crop,"+repage","-format","%#\n","info:"],check=True,text=True,capture_output=True).stdout.splitlines()
minimum_distinct_motion=expected_frames
for action_name in manifest["layout"]["animationOrder"]:
    animation=manifest["animations"][action_name]; frame_count=animation["frames"]; row_start=animation["rowStart"]
    direction_signatures={signatures[(row_start+direction)*columns] for direction in range(animation["directions"])}
    if len(direction_signatures)!=animation["directions"]: raise RuntimeError(f"animation {action_name} does not contain eight visually distinct directions")
    for direction in range(animation["directions"]):
        start=(row_start+direction)*columns
        distinct=len(set(signatures[start:start+frame_count])); minimum_distinct_motion=min(minimum_distinct_motion,distinct)
        if distinct<4: raise RuntimeError(f"animation {action_name} direction {direction} has only {distinct} visually distinct frames")
report={"width":width,"height":height,"bitDepth":bit_depth,"indexed":True,"colors":colors,"frames":len(frames),"distinctDirectionsPerAnimation":8,
  "animations":len(manifest["animations"]),"minimumDistinctFramesPerDirection":minimum_distinct_motion,
  "minimumSafetyMargin":min(min(x,y,cell_w-(x+w),cell_h-(y+h)) for w,h,x,y in boxes),"minimumCellMean":min(cell_means),"maximumCellMean":max(cell_means)}
print("MONGEN_SPRITE_VERIFY "+json.dumps(report,sort_keys=True))
if args.report: Path(args.report).resolve().write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf8")
