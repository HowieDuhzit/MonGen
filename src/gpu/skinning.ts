/** CPU-side LBS: weight computation and vertex deformation for animation preview. */
import type { BoneSpec } from "./skeleton";
import { skinningMatrices, m4pt, m4dir } from "./skeleton";
import type { BonePose } from "./skeleton";

function segmentDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2));
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface SkinWeights { weights: Float32Array; indices: Uint8Array; }

/** Compute per-vertex bone influence weights (top-4 by inverse-distance-squared). */
export function computeWeights(vertices: Float32Array, specs: BoneSpec[]): SkinWeights {
  const nv = vertices.length / 8;
  const weights = new Float32Array(nv * 4);
  const indices = new Uint8Array(nv * 4);

  for (let vi = 0; vi < nv; vi++) {
    const px = vertices[vi * 8], py = vertices[vi * 8 + 1], pz = vertices[vi * 8 + 2];
    const dists: [number, number][] = [];
    for (let bi = 0; bi < specs.length; bi++) {
      const s = specs[bi];
      const d = segmentDist(px, py, pz, s.head[0], s.head[1], s.head[2], s.tail[0], s.tail[1], s.tail[2]);
      dists.push([d, bi]);
    }
    dists.sort((a, b) => a[0] - b[0]);
    const top4 = dists.slice(0, 4);
    let wsum = 0;
    for (const [d] of top4) wsum += 1 / (d * d + 1e-4);
    for (let j = 0; j < top4.length; j++) {
      const [d, bi] = top4[j];
      weights[vi * 4 + j] = (1 / (d * d + 1e-4)) / wsum;
      indices[vi * 4 + j] = bi;
    }
  }
  return { weights, indices };
}

/** Apply posed skinning matrices to base vertices, writing result into out (same length as base). */
export function skinVertices(base: Float32Array, skinMats: Float32Array[], weights: Float32Array, indices: Uint8Array, out: Float32Array): void {
  const nv = base.length / 8;
  for (let vi = 0; vi < nv; vi++) {
    const bi = vi * 8;
    const px = base[bi], py = base[bi + 1], pz = base[bi + 2];
    const nx = base[bi + 4], ny = base[bi + 5], nz = base[bi + 6];
    let ox = 0, oy = 0, oz = 0, onx = 0, ony = 0, onz = 0;
    for (let j = 0; j < 4; j++) {
      const w = weights[vi * 4 + j]; if (w < 1e-6) continue;
      const m = skinMats[indices[vi * 4 + j]];
      const [dpx, dpy, dpz] = m4pt(m, px, py, pz);
      const [dnx, dny, dnz] = m4dir(m, nx, ny, nz);
      ox += w * dpx; oy += w * dpy; oz += w * dpz;
      onx += w * dnx; ony += w * dny; onz += w * dnz;
    }
    const nlen = Math.hypot(onx, ony, onz) || 1;
    out[bi] = ox; out[bi + 1] = oy; out[bi + 2] = oz; out[bi + 3] = 1;
    out[bi + 4] = onx / nlen; out[bi + 5] = ony / nlen; out[bi + 6] = onz / nlen; out[bi + 7] = 0;
  }
}

/** Re-export skinningMatrices for use by the renderer. */
export { skinningMatrices, type BonePose };
