import type { GeneratedMesh } from "../gpu/mesh-generator";

export function encodeObj(mesh: GeneratedMesh, objectName = "MonGenCreature"): string {
  const lines=[`o ${objectName.replace(/[^A-Za-z0-9_.-]/g,"_")}`];
  for (let i=0;i<mesh.vertices.length;i+=8) lines.push(`v ${mesh.vertices[i]} ${mesh.vertices[i+1]} ${mesh.vertices[i+2]}`);
  for (let i=0;i<mesh.vertices.length;i+=8) lines.push(`vn ${mesh.vertices[i+4]} ${mesh.vertices[i+5]} ${mesh.vertices[i+6]}`);
  for (let i=0;i<mesh.indices.length;i+=3) {
    const a=mesh.indices[i]+1,b=mesh.indices[i+1]+1,c=mesh.indices[i+2]+1;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return `${lines.join("\n")}\n`;
}
