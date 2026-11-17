import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {basename,join,resolve} from "node:path";
import {compileDiversityTraits} from "../dist/src/gpu/morphology.js";
import {runWebGpuMesh} from "./lib/run-webgpu-mesh.mjs";

const root=resolve(process.argv[2]??"artifacts/diversity-roster");
await mkdir(root,{recursive:true});
const templates={
  Biped:"examples/golden/voltusk.dna.json",
  Quadruped:"examples/golden/mossback.dna.json",
  Serpentine:"examples/golden/ripplet.dna.json",
  Avian:"examples/golden/zephyrix.dna.json",
  Floating:"examples/golden/noctilume.dna.json",
};
const roster=[];
for(const [skeleton,path] of Object.entries(templates)){
  const template=JSON.parse(await readFile(path,"utf8"));
  const selected=new Map();
  for(let seed=0;seed<10000&&selected.size<3;seed++){
    const dna={...template,seed,attachments:[]};
    const traits=compileDiversityTraits(dna);
    if(!selected.has(traits.archetypeIndex))selected.set(traits.archetypeIndex,{dna,traits});
  }
  if(selected.size!==3)throw new Error(`could not discover all ${skeleton} archetypes`);
  for(const {dna,traits} of [...selected.values()].sort((a,b)=>a.traits.archetypeIndex-b.traits.archetypeIndex)){
    dna.name=`${skeleton} ${traits.archetype}`;
    const slug=`${skeleton.toLowerCase()}-${traits.archetype.toLowerCase()}`;
    const preview=join(root,`${slug}.png`);
    const result=await runWebGpuMesh({dna,resolutionOverride:64,previewPath:preview,azimuthDegrees:25});
    const png=await readFile(preview),pngSha256=createHash("sha256").update(png).digest("hex");
    const failures=[];
    if((result.triangles??0)<1200)failures.push("triangle floor");
    if((result.triangles??Infinity)>60000)failures.push("triangle budget");
    if((result.phenotype?.primitiveCount??0)<10)failures.push("anatomy richness");
    if((result.previewStats?.foregroundPixels??0)<9000)failures.push("readable framing");
    roster.push({name:dna.name,skeleton,seed:dna.seed,archetype:traits.archetype,eyeStyle:traits.eyeStyle,
      triangles:result.triangles,primitiveCount:result.phenotype?.primitiveCount,pngSha256,
      silhouetteClass:result.phenotype?.silhouetteClass,preview:basename(preview),previewStats:result.previewStats,failures});
    console.log(`${dna.name}: seed ${dna.seed}, ${result.triangles} triangles, ${failures.length?`FAIL ${failures.join(", ")}`:"pass"}`);
  }
}
const hashes=new Set(roster.map(entry=>entry.pngSha256));
const silhouettes=new Set(roster.map(entry=>entry.silhouetteClass));
const combinations=new Set(roster.map(entry=>`${entry.skeleton}:${entry.archetype}`));
const summary={gateVersion:1,resolution:64,creatures:roster,distinctPreviewHashes:hashes.size,
  distinctSilhouetteClasses:silhouettes.size,distinctSkeletonArchetypes:combinations.size,
  passed:roster.every(entry=>entry.failures.length===0)&&hashes.size===15&&silhouettes.size===15&&combinations.size===15};
await writeFile(join(root,"diversity-report.json"),JSON.stringify(summary,null,2)+"\n");
if(!summary.passed)throw new Error(`diversity roster failed; see ${join(root,"diversity-report.json")}`);
