import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { CreatureDNA, SkeletonType } from "../src/dna";
import { createTriangleTable } from "../src/gpu/marching-cubes-table";
import { compileDiversityTraits, compileMorphology, compilePhenotype } from "../src/gpu/morphology";
import { packPrimitives, packVolumeParams } from "../src/gpu/layout";
import { encodeObj } from "../src/mesh/obj";
import { canonicalizeMesh } from "../src/mesh/canonicalize";
import { createElementPalette, createMaterialTexture, packMaterialUniforms, PATTERN_IDS } from "../src/gpu/material";
import { ANATOMY_CATALOG } from "../src/gpu/anatomy-catalog";

const example=JSON.parse(readFileSync(join(process.cwd(),"examples/emberling.dna.json"),"utf8")) as CreatureDNA;

test("classic Marching Cubes table contains 256 valid rows", () => {
  const table=createTriangleTable(); assert.equal(table.length,4096);
  for (let row=0;row<256;row++) {
    const values=table.slice(row*16,row*16+16); const sentinel=values.indexOf(-1);
    const used=sentinel < 0 ? 16 : sentinel;
    assert.equal(used%3,0,`case ${row} has partial triangle`);
    for (let i=0;i<used;i++) assert.ok(values[i]>=0&&values[i]<12,`case ${row} has invalid edge`);
    for (let i=used;i<16;i++) assert.equal(values[i],-1,`case ${row} has data after sentinel`);
  }
});

test("all skeleton families compile into finite SDF primitives", () => {
  const skeletons: SkeletonType[]=["Biped","Quadruped","Serpentine","Avian","Floating"];
  for (const skeleton of skeletons) {
    const dna={...example,skeleton},phenotype=compilePhenotype(dna),primitives=compileMorphology(dna); assert.ok(primitives.length>10);
    const packed=new Float32Array(packPrimitives(primitives));
    assert.equal(packed.length*4,primitives.length*80); assert.ok(packed.every(Number.isFinite));
    assert.equal(phenotype.face.eyes.length,2); assert.ok(phenotype.silhouetteClass.startsWith(skeleton));
  }
});

test("the modular anatomy catalog exposes four named, distinct variants per pool",()=>{
  for(const [pool,variants] of Object.entries(ANATOMY_CATALOG)){
    assert.equal(variants.length,4,pool); assert.equal(new Set(variants.map(value=>value.name)).size,4,pool);
    assert.ok(variants.every(value=>value.length>0&&value.breadth>0&&value.segments>0),pool);
  }
});

test("seed sweeps reach all three archetypes and eye styles in every skeleton family",()=>{
  const skeletons:SkeletonType[]=["Biped","Quadruped","Serpentine","Avian","Floating"];
  for(const skeleton of skeletons){
    const archetypes=new Set<string>(),eyeStyles=new Set<number>(),classes=new Set<string>();
    for(let seed=0;seed<48;seed++){const dna={...example,skeleton,seed},traits=compileDiversityTraits(dna),phenotype=compilePhenotype(dna);archetypes.add(traits.archetype);eyeStyles.add(traits.eyeStyle);classes.add(phenotype.silhouetteClass);}
    assert.equal(archetypes.size,3,`${skeleton} archetypes`); assert.equal(eyeStyles.size,3,`${skeleton} eye styles`); assert.ok(classes.size>=24,`${skeleton} silhouette diversity`);
  }
});

test("volume uniform packer follows the documented 64-byte layout", () => {
  const packed=packVolumeParams({minBounds:[-1,-2,-3],maxBounds:[4,5,6],dimensions:[32,64,96],isoLevel:0.25,smoothness:0.1,vertexCapacity:1234},7);
  const view=new DataView(packed); assert.equal(packed.byteLength,64);
  assert.equal(view.getFloat32(12,true),0.25); assert.equal(view.getUint32(44,true),7); assert.equal(view.getUint32(48,true),1234);
});

test("OBJ export writes indexed triangles and normals", () => {
  const vertices=new Float32Array([0,0,0,1,0,1,0,0, 1,0,0,1,0,1,0,0, 0,0,1,1,0,1,0,0]);
  const obj=encodeObj({vertices,indices:new Uint32Array([0,1,2])},"Test Creature");
  assert.match(obj,/^o Test_Creature/m); assert.match(obj,/^vn 0 1 0/m); assert.match(obj,/^f 1\/\/1 2\/\/2 3\/\/3/m);
});

test("canonical mesh order is independent of atomic triangle append order", () => {
  const a=new Float32Array(24).fill(2),b=new Float32Array(24).fill(1);
  const mesh=canonicalizeMesh({vertices:new Float32Array([...a,...b]),indices:new Uint32Array(6)});
  assert.equal(mesh.vertices[0],1); assert.equal(mesh.vertices[24],2);
  assert.deepEqual([...mesh.indices],[0,1,2,3,4,5]);
});

test("tri-planar material inputs are deterministic and DNA-sensitive", () => {
  const a=createMaterialTexture(example,64),b=createMaterialTexture(example,64);
  assert.deepEqual(a,b); assert.equal(a.length,64*64*4); assert.ok(a.some((value,index)=>index%4!==3&&value!==a[0]));
  const changed=createMaterialTexture({...example,seed:example.seed+1},64);
  assert.notDeepEqual(a,changed);
  const palette=createElementPalette(example); assert.equal(palette.length,12); assert.ok(palette.every(Number.isFinite));
  assert.equal(PATTERN_IDS.Stripes,2);
});

test("material uniform packer matches the 304-byte WGSL face contract", () => {
  const matrix=new Float32Array(16); matrix[0]=matrix[5]=matrix[10]=matrix[15]=1;
  const packed=packMaterialUniforms(matrix,matrix,example,[0,1,0],[1,2,3]);
  const view=new DataView(packed); assert.equal(packed.byteLength,304);
  assert.equal(view.getFloat32(176,true),example.surface.patternScale);
  assert.equal(view.getFloat32(188,true),PATTERN_IDS[example.surface.pattern]);
  assert.equal(view.getFloat32(216,true),3);
  assert.ok(view.getFloat32(236,true)>0);
  assert.ok(view.getFloat32(260,true)>0);
});
