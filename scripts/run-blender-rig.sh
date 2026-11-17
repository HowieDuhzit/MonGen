#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MESH_PATH="${1:-$ROOT_DIR/artifacts/emberling-r32.obj}"
DNA_PATH="${2:-$ROOT_DIR/examples/emberling.dna.json}"
OUTPUT_PATH="${3:-$ROOT_DIR/artifacts/emberling-rigged.glb}"

blender --background --factory-startup --python "$ROOT_DIR/blender/rig_export.py" -- \
  --mesh "$MESH_PATH" --dna "$DNA_PATH" --output "$OUTPUT_PATH" \
  --report "$ROOT_DIR/artifacts/emberling-rig-report.json" \
  --blend "$ROOT_DIR/artifacts/emberling-rigged.blend"

blender --background --factory-startup --python "$ROOT_DIR/blender/verify_glb.py" -- \
  --glb "$OUTPUT_PATH" --report "$ROOT_DIR/artifacts/emberling-glb-verification.json"
