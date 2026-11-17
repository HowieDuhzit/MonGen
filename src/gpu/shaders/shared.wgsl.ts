export const SDF_SHARED_WGSL = /* wgsl */ `
struct VolumeParams {
  minBounds: vec3<f32>,
  isoLevel: f32,
  maxBounds: vec3<f32>,
  smoothness: f32,
  dimensions: vec3<u32>,
  primitiveCount: u32,
  vertexCapacity: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
};

struct SdfPrimitive {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  rotation: vec4<f32>,
  aux: vec4<f32>,  // aux.x = per-primitive smoothness override (0 = use volume global)
};

fn sphereSdf(p: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  return length(p - center) - radius;
}

fn capsuleSdf(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

fn taperedCapsuleSdf(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radiusA: f32, radiusB: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - mix(radiusA, radiusB, h);
}

fn inverseRotate(p: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
  let v = -q.xyz;
  return p + 2.0 * cross(v, cross(v, p) + q.w * p);
}

fn ellipsoidSdf(p: vec3<f32>, center: vec3<f32>, radii: vec3<f32>, rotation: vec4<f32>) -> f32 {
  let local = inverseRotate(p - center, rotation);
  let safeRadii = max(radii, vec3<f32>(1e-4));
  let k0 = length(local / safeRadii);
  let k1 = length(local / (safeRadii * safeRadii));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

fn roundedBoxSdf(p: vec3<f32>, center: vec3<f32>, halfSize: vec3<f32>, rounding: f32, rotation: vec4<f32>) -> f32 {
  let local = inverseRotate(p - center, rotation);
  let q = abs(local) - max(halfSize - vec3<f32>(rounding), vec3<f32>(1e-4));
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - rounding;
}

fn primitiveSdf(p: vec3<f32>, primitive: SdfPrimitive) -> f32 {
  let kind = primitive.c.w;
  if (kind < 0.5) { return sphereSdf(p, primitive.a.xyz, primitive.a.w); }
  if (kind < 1.5) { return taperedCapsuleSdf(p, primitive.a.xyz, primitive.b.xyz, primitive.a.w, primitive.b.w); }
  if (kind < 2.5) { return ellipsoidSdf(p, primitive.a.xyz, primitive.c.xyz, primitive.rotation); }
  return roundedBoxSdf(p, primitive.a.xyz, primitive.c.xyz, primitive.a.w, primitive.rotation);
}

fn smoothMin(a: f32, b: f32, k: f32) -> f32 {
  let safeK = max(k, 1e-6);
  let h = max(safeK - abs(a - b), 0.0) / safeK;
  return min(a, b) - h * h * safeK * 0.25;
}
`;
