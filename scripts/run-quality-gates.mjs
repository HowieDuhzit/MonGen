import {createHash} from "node:crypto";
import {mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {runWebGpuMesh} from "./lib/run-webgpu-mesh.mjs";

const root=resolve(process.argv[2]??"artifacts/quality-roster");
await mkdir(root,{recursive:true});
const dnaDir=resolve("examples/golden");
const dnaFiles=(await readdir(dnaDir)).filter(name=>name.endsWith(".dna.json")).sort();
const roster=[];
for(const filename of dnaFiles){
  const dna=JSON.parse(await readFile(join(dnaDir,filename),"utf8"));
  const slug=basename(filename,".dna.json"),preview=join(root,`${slug}.png`);
  const result=await runWebGpuMesh({dna,resolutionOverride:64,previewPath:preview,azimuthDegrees:25});
  const png=await readFile(preview),pngSha256=createHash("sha256").update(png).digest("hex");
  const failures=[];
  if((result.triangles??0)<1500)failures.push("triangle floor");
  if((result.triangles??Infinity)>60000)failures.push("triangle budget");
  if((result.phenotype?.primitiveCount??0)<12)failures.push("anatomy richness");
  if((result.phenotype?.attachmentPrimitiveCount??0)<1)failures.push("attachment catalog");
  if((result.previewStats?.foregroundPixels??0)<12000)failures.push("readable framing");
  roster.push({name:dna.name,skeleton:dna.skeleton,element:dna.element,vertices:result.vertices,triangles:result.triangles,pngSha256,preview:basename(preview),phenotype:result.phenotype,previewStats:result.previewStats,failures});
  console.log(`${dna.name}: ${result.triangles} triangles, ${result.phenotype?.primitiveCount} primitives, ${failures.length?`FAIL ${failures.join(", ")}`:"pass"}`);
}
const hashes=new Set(roster.map(entry=>entry.pngSha256));
const silhouettes=new Set(roster.map(entry=>entry.phenotype?.silhouetteClass));
const summary={gateVersion:1,resolution:64,creatures:roster,distinctPreviewHashes:hashes.size,distinctSilhouetteClasses:silhouettes.size,passed:roster.every(entry=>entry.failures.length===0)&&hashes.size===roster.length&&silhouettes.size===roster.length};
await writeFile(join(root,"quality-report.json"),JSON.stringify(summary,null,2)+"\n");
if(!summary.passed)throw new Error(`quality roster failed; see ${join(root,"quality-report.json")}`);
