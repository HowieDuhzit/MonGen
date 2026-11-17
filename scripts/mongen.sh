#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DNA=""; OUTPUT_ROOT="$ROOT_DIR/artifacts/generated"; ADAPTER="swiftshader"; RESOLUTION=""; KEEP_INTERMEDIATES=0

usage() { echo "Usage: scripts/mongen.sh --dna FILE [--output-dir DIR] [--adapter swiftshader|hardware] [--resolution N] [--keep-intermediates]"; }
while (($#)); do
  case "$1" in
    --dna) DNA="${2:?missing --dna value}"; shift 2 ;;
    --output-dir) OUTPUT_ROOT="${2:?missing --output-dir value}"; shift 2 ;;
    --adapter) ADAPTER="${2:?missing --adapter value}"; shift 2 ;;
    --resolution) RESOLUTION="${2:?missing --resolution value}"; shift 2 ;;
    --keep-intermediates) KEEP_INTERMEDIATES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -n "$DNA" ]] || { usage >&2; exit 2; }
[[ "$ADAPTER" == "swiftshader" || "$ADAPTER" == "hardware" ]] || { echo "Invalid adapter: $ADAPTER" >&2; exit 2; }
DNA="$(realpath "$DNA")"; OUTPUT_ROOT="$(realpath -m "$OUTPUT_ROOT")"
[[ -f "$DNA" ]] || { echo "DNA file not found: $DNA" >&2; exit 2; }

for command in node blender chromium magick jq sha256sum; do command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 127; }; done
[[ -d "$ROOT_DIR/node_modules" ]] || { echo "Run npm install before using the pipeline" >&2; exit 2; }
mkdir -p "$OUTPUT_ROOT"
NAME="$(jq -er '.name' "$DNA")"; SEED="$(jq -er '.seed' "$DNA")"
SLUG="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g;s/^-+|-+$//g')"
[[ -n "$SLUG" && "$SEED" =~ ^[0-9]+$ ]] || { echo "DNA name/seed cannot form a safe output identifier" >&2; exit 2; }
FINAL_DIR="$OUTPUT_ROOT/$SLUG-$SEED"
[[ ! -e "$FINAL_DIR" ]] || { echo "Refusing to overwrite existing result: $FINAL_DIR" >&2; exit 3; }
STAGE="$(mktemp -d "$OUTPUT_ROOT/.mongen-${SLUG}-${SEED}.XXXXXX")"
cleanup() { [[ -d "$STAGE" ]] && rm -rf -- "$STAGE"; }
trap cleanup EXIT INT TERM
mkdir -p "$STAGE/reports" "$STAGE/frames" "$STAGE/lods" "$STAGE/publish/reports" "$STAGE/publish/lods"
cp -- "$DNA" "$STAGE/dna.json"

run() { if [[ -n "${MONGEN_CPUSET:-}" ]]; then taskset -c "$MONGEN_CPUSET" "$@"; else "$@"; fi; }
SECONDS=0
GPU_ARGS=(--dna "$STAGE/dna.json" --output "$STAGE/creature.obj" --preview "$STAGE/preview.png" --report "$STAGE/reports/gpu.json" --adapter "$ADAPTER")
[[ -z "$RESOLUTION" ]] || GPU_ARGS+=(--resolution "$RESOLUTION")
run node "$ROOT_DIR/scripts/generate-mesh.mjs" "${GPU_ARGS[@]}"
run blender --background --factory-startup --python "$ROOT_DIR/blender/rig_export.py" -- \
  --mesh "$STAGE/creature.obj" --dna "$STAGE/dna.json" --output "$STAGE/creature.glb" \
  --blend "$STAGE/creature.blend" --lod-dir "$STAGE/lods" --report "$STAGE/reports/rig.json"
run blender --background --factory-startup --python "$ROOT_DIR/blender/verify_glb.py" -- \
  --glb "$STAGE/creature.glb" --report "$STAGE/reports/glb-roundtrip.json"
run node "$ROOT_DIR/scripts/validate-glb.mjs" "$STAGE/creature.glb" "$STAGE/reports/gltf-validator.json"
for level in 1 2; do
  run blender --background --factory-startup --python "$ROOT_DIR/blender/verify_glb.py" -- \
    --glb "$STAGE/lods/creature-lod${level}.glb" --report "$STAGE/reports/glb-lod${level}-roundtrip.json"
  run node "$ROOT_DIR/scripts/validate-glb.mjs" "$STAGE/lods/creature-lod${level}.glb" "$STAGE/reports/gltf-lod${level}-validator.json"
done
run blender --background --factory-startup --python "$ROOT_DIR/blender/render_sprites.py" -- \
  --blend "$STAGE/creature.blend" --output "$STAGE/sprites.png" --metadata "$STAGE/sprites.json" --frames-dir "$STAGE/frames"
run python "$ROOT_DIR/blender/verify_sprites.py" --sheet "$STAGE/sprites.png" --metadata "$STAGE/sprites.json" --report "$STAGE/reports/sprites.json"

cp -- "$STAGE/dna.json" "$STAGE/creature.obj" "$STAGE/creature.glb" "$STAGE/preview.png" "$STAGE/sprites.png" "$STAGE/sprites.json" "$STAGE/publish/"
cp -- "$STAGE/reports/"*.json "$STAGE/publish/reports/"
cp -- "$STAGE/lods/"*.glb "$STAGE/publish/lods/"
if ((KEEP_INTERMEDIATES)); then cp -- "$STAGE/creature.blend" "$STAGE/publish/"; cp -a -- "$STAGE/frames" "$STAGE/publish/"; fi
ELAPSED="$SECONDS"
export MONGEN_MANIFEST_DIR="$STAGE/publish" MONGEN_MANIFEST_NAME="$NAME" MONGEN_MANIFEST_SEED="$SEED" MONGEN_MANIFEST_ADAPTER="$ADAPTER" MONGEN_MANIFEST_SECONDS="$ELAPSED"
node --input-type=module <<'NODE'
import {createHash} from "node:crypto"; import {readdir,readFile,writeFile} from "node:fs/promises"; import {join,relative} from "node:path";
const root=process.env.MONGEN_MANIFEST_DIR;
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]))).flat();}
const paths=(await files(root)).filter(p=>!p.endsWith("manifest.json")).sort();
const artifacts={}; for(const path of paths){const data=await readFile(path); artifacts[relative(root,path)]={bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")};}
const manifest={schemaVersion:1,name:process.env.MONGEN_MANIFEST_NAME,seed:Number(process.env.MONGEN_MANIFEST_SEED),adapterMode:process.env.MONGEN_MANIFEST_ADAPTER,durationSeconds:Number(process.env.MONGEN_MANIFEST_SECONDS),artifacts};
await writeFile(join(root,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
NODE
mv -- "$STAGE/publish" "$FINAL_DIR"
echo "MonGen complete: $FINAL_DIR"
echo "GLB: $FINAL_DIR/creature.glb"
echo "Sprites: $FINAL_DIR/sprites.png"
