import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runWebGpuMesh } from "./lib/run-webgpu-mesh.mjs";

function args(argv) {
  const out={adapter:"swiftshader"};
  for (let i=0;i<argv.length;i++) {
    const key=argv[i];
    if (!["--dna","--output","--report","--resolution","--adapter","--vertex-capacity","--preview","--azimuth"].includes(key)) throw new Error(`unknown argument: ${key}`);
    out[key.slice(2).replace("-","_")]=argv[++i];
  }
  if (!out.dna || !out.output) throw new Error("usage: generate-mesh.mjs --dna FILE --output FILE [--preview FILE.png] [--report FILE] [--resolution N] [--adapter swiftshader|hardware]");
  return out;
}

const options=args(process.argv.slice(2));
const dna=JSON.parse(await readFile(options.dna,"utf8"));
const started=Date.now();
if (options.preview) await mkdir(dirname(resolve(options.preview)),{recursive:true});
const result=await runWebGpuMesh({dna,resolutionOverride:options.resolution?Number(options.resolution):undefined,vertexCapacity:options.vertex_capacity?Number(options.vertex_capacity):undefined,adapterMode:options.adapter,previewPath:options.preview?resolve(options.preview):undefined,azimuthDegrees:options.azimuth?Number(options.azimuth):undefined});
const output=resolve(options.output); await mkdir(dirname(output),{recursive:true}); await writeFile(output,result.obj,"utf8");
const report={generator:"WebGPU SDF + Marching Cubes",adapterMode:options.adapter,adapter:result.adapter??{},vertices:result.vertices,triangles:result.triangles,resolution:options.resolution?Number(options.resolution):dna.morphology.volumeResolution,phenotype:result.phenotype,preview:result.previewStats,durationMs:Date.now()-started};
if (options.report) { const path=resolve(options.report); await mkdir(dirname(path),{recursive:true}); await writeFile(path,JSON.stringify(report,null,2)+"\n","utf8"); }
console.log(`GPU mesh: ${result.vertices} vertices, ${result.triangles} triangles -> ${output}`);
