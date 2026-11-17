#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR=""; OUTPUT_DIR="$ROOT_DIR/artifacts/generated"; JOBS=""; ADAPTER="swiftshader"; RESOLUTION=""
usage() { echo "Usage: scripts/mongen-batch.sh --input-dir DIR [--output-dir DIR] [--jobs N] [--adapter swiftshader|hardware] [--resolution N]"; }
while (($#)); do
  case "$1" in
    --input-dir) INPUT_DIR="${2:?missing value}"; shift 2;;
    --output-dir) OUTPUT_DIR="${2:?missing value}"; shift 2;;
    --jobs) JOBS="${2:?missing value}"; shift 2;;
    --adapter) ADAPTER="${2:?missing value}"; shift 2;;
    --resolution) RESOLUTION="${2:?missing value}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2;;
  esac
done
[[ -n "$INPUT_DIR" && -d "$INPUT_DIR" ]] || { usage >&2; exit 2; }
if [[ -z "$JOBS" ]]; then
  CPU_JOBS=$(( $(nproc) / 4 )); ((CPU_JOBS<1)) && CPU_JOBS=1
  MEM_JOBS=$(( $(awk '/MemAvailable/{print int($2/4194304)}' /proc/meminfo) )); ((MEM_JOBS<1)) && MEM_JOBS=1
  JOBS="$CPU_JOBS"; ((JOBS>MEM_JOBS)) && JOBS="$MEM_JOBS"; ((JOBS>8)) && JOBS=8
fi
[[ "$JOBS" =~ ^[1-9][0-9]*$ ]] || { echo "--jobs must be a positive integer" >&2; exit 2; }
mapfile -d '' FILES < <(find "$INPUT_DIR" -maxdepth 1 -type f -name '*.json' -print0 | sort -z)
((${#FILES[@]})) || { echo "No JSON DNA files found in $INPUT_DIR" >&2; exit 2; }
echo "MonGen batch: ${#FILES[@]} creatures, $JOBS concurrent workers"
export ROOT_DIR OUTPUT_DIR ADAPTER RESOLUTION
printf '%s\0' "${FILES[@]}" | xargs -0 -n1 -P "$JOBS" bash -c '
  args=(--dna "$1" --output-dir "$OUTPUT_DIR" --adapter "$ADAPTER")
  [[ -z "$RESOLUTION" ]] || args+=(--resolution "$RESOLUTION")
  "$ROOT_DIR/scripts/mongen.sh" "${args[@]}"
' _
echo "MonGen batch complete: $OUTPUT_DIR"

