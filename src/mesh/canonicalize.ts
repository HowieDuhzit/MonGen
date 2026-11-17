import type { GeneratedMesh } from "../gpu/mesh-generator";

/**
 * Removes nondeterministic atomic-append ordering from the GPU result. Marching
 * Cubes emits unshared triangle vertices, so complete triangle records can be
 * sorted lexicographically without changing topology or winding.
 */
export function canonicalizeMesh(mesh: GeneratedMesh): GeneratedMesh {
  if (mesh.vertices.length % 24 !== 0) throw new RangeError("mesh vertex data does not contain complete triangles");
  const triangles: Float32Array[]=[];
  for (let offset=0;offset<mesh.vertices.length;offset+=24) triangles.push(mesh.vertices.slice(offset,offset+24));
  triangles.sort((a,b)=>{
    for (let i=0;i<24;i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  });
  const vertices=new Float32Array(mesh.vertices.length);
  triangles.forEach((triangle,index)=>vertices.set(triangle,index*24));
  return {vertices,indices:Uint32Array.from({length:vertices.length/8},(_,index)=>index)};
}
