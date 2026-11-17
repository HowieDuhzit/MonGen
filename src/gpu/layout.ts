import type { Quaternion, Vec3 } from "../dna";

export const SDF_PRIMITIVE_STRIDE = 80;
export const VOLUME_PARAMS_SIZE = 64;
export const MESH_VERTEX_STRIDE = 32;

/** smooth: per-primitive k override for smoothMin. 0 (default) = use volume.smoothness. */
export type SdfPrimitive =
  | { readonly kind: "sphere"; readonly center: Vec3; readonly radius: number; readonly smooth?: number }
  | { readonly kind: "capsule"; readonly start: Vec3; readonly end: Vec3; readonly radius: number; readonly smooth?: number }
  | { readonly kind: "taperedCapsule"; readonly start: Vec3; readonly end: Vec3; readonly startRadius: number; readonly endRadius: number; readonly smooth?: number }
  | { readonly kind: "ellipsoid"; readonly center: Vec3; readonly radii: Vec3; readonly rotation: Quaternion; readonly smooth?: number }
  | { readonly kind: "roundedBox"; readonly center: Vec3; readonly halfSize: Vec3; readonly rounding: number; readonly rotation: Quaternion; readonly smooth?: number };

export interface VolumeConfig {
  readonly minBounds: Vec3;
  readonly maxBounds: Vec3;
  readonly dimensions: readonly [number, number, number];
  readonly isoLevel: number;
  readonly smoothness: number;
  readonly vertexCapacity: number;
}

export function packPrimitives(primitives: readonly SdfPrimitive[]): ArrayBuffer {
  const data = new Float32Array((SDF_PRIMITIVE_STRIDE / 4) * primitives.length);
  primitives.forEach((primitive, i) => {
    const o = i * 20;  // 20 floats = 80 bytes per primitive
    if (primitive.kind === "sphere") {
      data.set([...primitive.center, primitive.radius], o);
      data.set([...primitive.center, 0], o + 4);
      data.set([0,0,0,0],o+8); data.set([0,0,0,1],o+12);
    } else if (primitive.kind === "capsule" || primitive.kind === "taperedCapsule") {
      const startRadius=primitive.kind === "capsule" ? primitive.radius : primitive.startRadius;
      const endRadius=primitive.kind === "capsule" ? primitive.radius : primitive.endRadius;
      data.set([...primitive.start, startRadius], o);
      data.set([...primitive.end, endRadius], o + 4);
      data.set([0,0,0,1],o+8); data.set([0,0,0,1],o+12);
    } else if (primitive.kind === "ellipsoid") {
      data.set([...primitive.center,0],o); data.set([0,0,0,0],o+4);
      data.set([...primitive.radii,2],o+8); data.set(primitive.rotation,o+12);
    } else {
      data.set([...primitive.center,primitive.rounding],o); data.set([0,0,0,0],o+4);
      data.set([...primitive.halfSize,3],o+8); data.set(primitive.rotation,o+12);
    }
    // meta.x = per-primitive smoothness override (0 = use volume.smoothness)
    data.set([primitive.smooth ?? 0, 0, 0, 0], o + 16);
  });
  return data.buffer;
}

export function packVolumeParams(config: VolumeConfig, primitiveCount: number): ArrayBuffer {
  const bytes = new ArrayBuffer(VOLUME_PARAMS_SIZE);
  const view = new DataView(bytes);
  config.minBounds.forEach((v, i) => view.setFloat32(i * 4, v, true));
  view.setFloat32(12, config.isoLevel, true);
  config.maxBounds.forEach((v, i) => view.setFloat32(16 + i * 4, v, true));
  view.setFloat32(28, config.smoothness, true);
  config.dimensions.forEach((v, i) => view.setUint32(32 + i * 4, v, true));
  view.setUint32(44, primitiveCount, true);
  view.setUint32(48, config.vertexCapacity, true);
  return bytes;
}
