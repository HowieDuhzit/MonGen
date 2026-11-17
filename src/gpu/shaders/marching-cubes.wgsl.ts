import { SDF_SHARED_WGSL } from "./shared.wgsl";

export const MARCHING_CUBES_WGSL = /* wgsl */ `
${SDF_SHARED_WGSL}

struct MeshVertex { position: vec4<f32>, normal: vec4<f32> };
struct Counters { vertexCount: atomic<u32>, overflow: atomic<u32>, _pad0: u32, _pad1: u32 };

@group(0) @binding(0) var<uniform> volume: VolumeParams;
@group(0) @binding(1) var<storage, read> primitives: array<SdfPrimitive>;
@group(0) @binding(2) var<storage, read> field: array<f32>;
@group(0) @binding(3) var<storage, read> triangleTable: array<i32>;
@group(0) @binding(4) var<storage, read_write> vertices: array<MeshVertex>;
@group(0) @binding(5) var<storage, read_write> indices: array<u32>;
@group(0) @binding(6) var<storage, read_write> counters: Counters;

const CORNERS = array<vec3<u32>, 8>(
  vec3<u32>(0,0,0), vec3<u32>(1,0,0), vec3<u32>(1,1,0), vec3<u32>(0,1,0),
  vec3<u32>(0,0,1), vec3<u32>(1,0,1), vec3<u32>(1,1,1), vec3<u32>(0,1,1)
);
const EDGES = array<vec2<u32>, 12>(
  vec2<u32>(0,1), vec2<u32>(1,2), vec2<u32>(2,3), vec2<u32>(3,0),
  vec2<u32>(4,5), vec2<u32>(5,6), vec2<u32>(6,7), vec2<u32>(7,4),
  vec2<u32>(0,4), vec2<u32>(1,5), vec2<u32>(2,6), vec2<u32>(3,7)
);

fn fieldIndex(p: vec3<u32>) -> u32 {
  return p.x + volume.dimensions.x * (p.y + volume.dimensions.y * p.z);
}
fn gridToWorld(p: vec3<u32>) -> vec3<f32> {
  let uvw = vec3<f32>(p) / vec3<f32>(volume.dimensions - vec3<u32>(1));
  return mix(volume.minBounds, volume.maxBounds, uvw);
}
fn sceneSdf(p: vec3<f32>) -> f32 {
  var distance = 1e20;
  for (var i = 0u; i < volume.primitiveCount; i++) {
    let primitive = primitives[i];
    let d = primitiveSdf(p, primitive);
    let ex = primitive.aux.x;
    let k = select(select(volume.smoothness, ex, ex > 1e-5 && ex < 0.012), max(ex, volume.smoothness), ex >= 0.012);
    distance = smoothMin(distance, d, k);
  }
  return distance;
}
fn normalAt(p: vec3<f32>) -> vec3<f32> {
  let step = (volume.maxBounds - volume.minBounds) / vec3<f32>(volume.dimensions - vec3<u32>(1));
  let e = max(min(min(step.x, step.y), step.z) * 0.5, 1e-5);
  return normalize(vec3<f32>(
    sceneSdf(p + vec3<f32>(e,0,0)) - sceneSdf(p - vec3<f32>(e,0,0)),
    sceneSdf(p + vec3<f32>(0,e,0)) - sceneSdf(p - vec3<f32>(0,e,0)),
    sceneSdf(p + vec3<f32>(0,0,e)) - sceneSdf(p - vec3<f32>(0,0,e))
  ));
}
fn edgeVertex(cell: vec3<u32>, edgeIndex: u32) -> vec3<f32> {
  let edge = EDGES[edgeIndex];
  let g0 = cell + CORNERS[edge.x];
  let g1 = cell + CORNERS[edge.y];
  let v0 = field[fieldIndex(g0)];
  let v1 = field[fieldIndex(g1)];
  let denominator = v1 - v0;
  let t = select(clamp((volume.isoLevel - v0) / denominator, 0.0, 1.0), 0.5, abs(denominator) < 1e-8);
  return mix(gridToWorld(g0), gridToWorld(g1), t);
}

@compute @workgroup_size(8, 8, 4)
fn polygonize(@builtin(global_invocation_id) cell: vec3<u32>) {
  if (any(cell >= volume.dimensions - vec3<u32>(1))) { return; }
  var caseIndex = 0u;
  for (var corner = 0u; corner < 8u; corner++) {
    if (field[fieldIndex(cell + CORNERS[corner])] < volume.isoLevel) {
      caseIndex |= 1u << corner;
    }
  }
  let row = caseIndex * 16u;
  var count = 0u;
  for (var i = 0u; i < 16u; i += 3u) {
    if (triangleTable[row + i] < 0) { break; }
    count += 3u;
  }
  if (count == 0u) { return; }
  let base = atomicAdd(&counters.vertexCount, count);
  if (base + count > volume.vertexCapacity) {
    atomicOr(&counters.overflow, 1u);
    return;
  }
  for (var i = 0u; i < count; i++) {
    let p = edgeVertex(cell, u32(triangleTable[row + i]));
    vertices[base + i] = MeshVertex(vec4<f32>(p, 1.0), vec4<f32>(normalAt(p), 0.0));
    indices[base + i] = base + i;
  }
}
`;
