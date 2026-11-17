#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BLEND_PATH="${1:-$ROOT_DIR/artifacts/emberling-rigged.blend}"
SHEET_PATH="${2:-$ROOT_DIR/artifacts/emberling-sprites.png}"
META_PATH="${3:-$ROOT_DIR/artifacts/emberling-sprites.json}"
FRAMES_DIR="${4:-$ROOT_DIR/artifacts/emberling-sprite-frames}"

blender --background --factory-startup --python "$ROOT_DIR/blender/render_sprites.py" -- \
  --blend "$BLEND_PATH" --output "$SHEET_PATH" --metadata "$META_PATH" --frames-dir "$FRAMES_DIR"
python "$ROOT_DIR/blender/verify_sprites.py" --sheet "$SHEET_PATH" --metadata "$META_PATH"
