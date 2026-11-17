import { SDF_SHARED_WGSL } from "./shared.wgsl";

export const SDF_VOLUME_WGSL = /* wgsl */ `
${SDF_SHARED_WGSL}

@group(0) @binding(0) var<uniform> volume: VolumeParams;
@group(0) @binding(1) var<storage, read> primitives: array<SdfPrimitive>;
@group(0) @binding(2) var<storage, read_write> field: array<f32>;

fn sceneSdf(p: vec3<f32>) -> f32 {
  var distance = 1e20;
  for (var i = 0u; i < volume.primitiveCount; i++) {
    let primitive = primitives[i];
    let primitiveDistance = primitiveSdf(p, primitive);
    let ex = primitive.aux.x;
    // Fine details (SHARP/DETAIL, ex<0.012): immune to global slider — stay crisp
    // Structural parts (ex>=0.012): slider can boost blobbing above structural baseline
    // Attachment parts (ex==0): use global slider directly
    let k = select(select(volume.smoothness, ex, ex > 1e-5 && ex < 0.012), max(ex, volume.smoothness), ex >= 0.012);
    distance = smoothMin(distance, primitiveDistance, k);
  }
  return distance;
}

fn fieldIndex(p: vec3<u32>) -> u32 {
  return p.x + volume.dimensions.x * (p.y + volume.dimensions.y * p.z);
}

@compute @workgroup_size(8, 8, 4)
fn buildSdf(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= volume.dimensions)) { return; }
  let denominator = vec3<f32>(volume.dimensions - vec3<u32>(1u));
  let uvw = vec3<f32>(gid) / denominator;
  let p = mix(volume.minBounds, volume.maxBounds, uvw);
  field[fieldIndex(gid)] = sceneSdf(p);
}
`;
