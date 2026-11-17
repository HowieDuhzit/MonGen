# MonGen

Deterministic procedural creature generation, targeting WebGPU mesh generation
and a headless Blender export/render pipeline.

## Step 1: Creature DNA

The current implementation defines and validates the versioned DNA contract:

- `schemas/creature-dna.schema.json` is the JSON Schema 2020-12 contract.
- `src/dna/types.ts` provides the matching immutable TypeScript interfaces.
- `src/dna/validate.ts` adds runtime and semantic validation.
- `src/dna/determinism.ts` defines canonical serialization and the PRNG that a
  later WGSL implementation can reproduce bit-for-bit.
- `examples/emberling.dna.json` is a valid deterministic seed document.

Install dependencies and verify Step 1:

```bash
npm install
npm test
```

## Determinism contract

Exact output is defined by the tuple `(canonical DNA, generatorVersion)`. The
generator version pins every output-affecting algorithm and catalog: skeleton
templates, SDF construction, lookup tables, palettes, texture noise, attachment
assets, and export settings. All random choices must use `Mulberry32`; do not use
`Math.random()`. GPU work that affects topology must use integer decisions or
explicitly quantized values so driver-dependent floating-point edge cases cannot
silently change the mesh.

## Step 2: WebGPU SDF and Marching Cubes

`src/gpu/mesh-generator.ts` implements a two-pass WebGPU pipeline. The first
compute pass evaluates smooth-unioned spheres, tapered capsules, oriented
ellipsoids, and rounded boxes into a volume. The
second runs classic 256-case Marching Cubes, appends position/normal vertices and
indices, reports overflow, and performs a bounded readback. `compileMorphology`
maps every skeleton family and attachment socket into primitives. The stable
`src/gpu/anatomy-catalog.ts` catalog supplies four genuinely different variants
for each of nine active part pools; its numeric variant indices are pinned by
`generatorVersion`. `encodeObj`
serializes the resulting unrigged static mesh for Blender.

The implementation requests no optional GPU features. A caller supplies its
owned `GPUDevice` and must handle adapter selection, device loss, and recovery at
the application boundary.

Run the actual headless GPU smoke test with:

```bash
npm run test:gpu
```

It forces Chromium's SwiftShader WebGPU adapter, compiles both WGSL modules,
executes both compute passes at resolution 32, and writes
`artifacts/emberling-r32.obj`. Post-readback triangle sorting removes
nondeterministic atomic append order from the exported bytes.

## Step 3: Headless Blender rig and GLB

`blender/rig_export.py` imports the OBJ in Y-up coordinates, welds duplicate
Marching Cubes vertices, removes degenerate geometry, builds the selected
skeleton template, applies Blender bone-heat weights, limits every vertex to
four normalized influences, assigns the elemental palette plus deterministic
eye/pupil/mouth materials, adds skeleton-specific Idle, Walk, Run, Attack,
Special, Hurt, and Faint actions with nine authored keys per clip,
tests every clip's deformation signature, and exports animated GLBs. LOD0 is
capped at 60k triangles; LOD1 and LOD2 target 50%
and 20% while also respecting 15k and 5k ceilings. `blender/verify_glb.py`
re-imports every level into a clean scene and checks the skin contract.

```bash
scripts/run-blender-rig.sh
npm run test:blender
```

The second command exercises all five skeleton templates and runs the Khronos
glTF Validator against the retained Emberling artifact.

## Step 4: Orthographic pixel-art sprite sheet

`blender/render_sprites.py` renders eight poses for each of seven actions
from eight 45-degree directions. Every source render is square, processed
through Blender Pixelate and Posterize compositor nodes, reduced to an effective
64-pixel canvas, and enlarged exactly 2x with nearest-neighbor sampling. A
deformation-aware prepass computes one union envelope per direction across all
seven clips. Registration and scale therefore remain stable across animation
changes while preserving a validated safety margin in each 128x128 cell. The
result is one indexed 1024x7168 PNG with a matching frame/timing manifest.

```bash
npm run test:sprites
```

## Step 5: End-to-end headless pipeline

Generate every deliverable from one DNA document:

```bash
scripts/mongen.sh --dna examples/emberling.dna.json
```

The command validates each stage before atomically publishing a directory under
`artifacts/generated/`. It contains the canonical DNA, raw OBJ, tri-planar
WebGPU preview, animated LOD0/1/2 GLBs, indexed sprite atlas, frame metadata,
validation reports, and a recursive SHA-256 manifest.
Pass `--keep-intermediates` to retain the Blender scene and 448 source frames.
SwiftShader is the deterministic default; `--adapter hardware` trades strict
cross-host reproducibility for throughput. `MONGEN_CPUSET=0-11` optionally pins
the complete process tree with `taskset`.

## WebGPU tri-planar material preview

The preview renderer consumes the same interleaved position/normal mesh used by
OBJ export. Its WGSL fragment stage samples one seeded repeatable texture through
the XY, XZ, and YZ planes, blends those projections from the world-space normal,
then maps the result through the DNA element's three-color palette and selected
Solid, Spots, Stripes, Bands, or Mottled pattern. The stylized four-band light,
rim response, and deterministic facial landmarks remain readable without a UV
unwrap.

Generate an OBJ and a headless material preview together:

```bash
node scripts/generate-mesh.mjs --dna examples/emberling.dna.json \
  --output artifacts/emberling-preview.obj --preview artifacts/emberling-preview.png
```

## Interactive Creature Lab

Start the local WebGPU editor:

```bash
npm run dev
```

The Creature Lab edits the validated DNA contract, regenerates a lower-resolution
preview without changing the chosen export resolution, keeps GPU render resources
persistent while orbiting, and supports deterministic mutation, random seed-based
generation, JSON import/copy/download, attachments through the canonical JSON,
and live topology/timing metrics. Drag the viewport to orbit.

Normal browser GPUs use a persistent direct-canvas renderer, so orbiting only
updates the camera uniform. Browsers that reject WebGPU presentation—most
notably headless SwiftShader—preserve the current DNA and automatically switch
to the slower offscreen-render/readback compatibility path.

Run its real headless interaction test with `npm run test:editor`.

## Production quality gates

Five golden creatures cover Biped, Quadruped, Serpentine, Avian, and Floating
shape languages under `examples/golden/`. Run their real WebGPU shaders and
visual/topology checks with:

```bash
npm run test:quality
```

The gate requires distinct deterministic renders and silhouette classes,
non-trivial modular anatomy, readable square framing, and meshes between 1,500
and 60,000 triangles. These are engineering gates, not a substitute for an art
director: compare `artifacts/quality-roster/` visually whenever morphology,
materials, or catalog data changes.

Seeded v0.4 morphology also selects one of three archetypes per skeleton family
(15 total), plus independent bulk, stance, taper, posture, feature-scale, eye,
and palette traits. Run `npm run test:diversity` to render all 15 archetypes and
reject duplicate previews or silhouette fingerprints. Inspect
`artifacts/diversity-roster/diversity-montage.png` for the art-direction pass.

Animation is not shared generic noise. Bipeds use counter-swinging limbs and
torso overlap; quadrupeds breathe, trot, and lunge; serpents propagate body
waves; avians coordinate wings, tail, and legs; floating creatures bob their
core while phased orbit bones move around it. Blender and clean GLB re-import
both reject clips that are static or have duplicate measured motion signatures.

Batch a directory of DNA documents with resource-bounded workers:

```bash
scripts/mongen-batch.sh --input-dir examples --output-dir artifacts/generated
```

The default worker count is the minimum of one worker per four logical CPUs,
one worker per 4 GiB available RAM, and eight workers. Override it with
`--jobs N` after measuring the target Proxmox guest. Required host commands are
Node.js, Chromium with WebGPU, Blender, ImageMagick, jq, and sha256sum.
