import type { PartPool } from "../dna";

export type ActivePartPool=Exclude<PartPool,"None">;
export interface AnatomyVariant {
  readonly name:string;
  readonly length:number;
  readonly breadth:number;
  readonly depth:number;
  readonly taper:number;
  readonly segments:number;
  readonly sweep:number;
}

const variants=(names:readonly string[], values:readonly (readonly [number,number,number,number,number,number])[]):readonly AnatomyVariant[]=>names.map((name,index)=>{
  const [length,breadth,depth,taper,segments,sweep]=values[index]; return{name,length,breadth,depth,taper,segments,sweep};
});

/** Stable, generator-versioned modular anatomy. Variant indices are serialized in DNA. */
export const ANATOMY_CATALOG:Readonly<Record<ActivePartPool,readonly AnatomyVariant[]>>={
  Horn:variants(["Crown","Ram","Needle","Antler"],[[.8,.24,.18,.03,1,0],[.68,.34,.24,.08,2,.28],[1.05,.16,.13,.015,1,.04],[.88,.22,.18,.025,3,.42]]),
  Ear:variants(["Round","Fennec","Droop","Tuft"],[[.45,.34,.18,.25,1,0],[.88,.32,.15,.08,1,.12],[.65,.38,.20,.18,2,-.35],[.72,.26,.14,.04,2,.24]]),
  Fin:variants(["Fan","Sail","Blade","Frill"],[[.62,.48,.16,.12,2,.18],[.95,.52,.12,.04,3,.06],[.8,.28,.10,.02,1,.30],[.55,.58,.14,.10,4,.44]]),
  Wing:variants(["Bud","Swift","Raptor","Moth"],[[.62,.42,.18,.14,2,.12],[1.0,.34,.12,.06,3,.22],[1.18,.46,.16,.04,4,.32],[.92,.7,.10,.08,4,.48]]),
  Spine:variants(["Nub","Crest","Saw","Quill"],[[.38,.26,.22,.10,1,0],[.68,.24,.18,.04,2,.08],[.58,.30,.20,.03,4,.18],[.92,.14,.12,.01,3,.25]]),
  Leaf:variants(["Sprout","Broadleaf","Fern","Petal"],[[.48,.30,.12,.12,2,.16],[.68,.52,.10,.08,1,.08],[.82,.28,.08,.03,4,.36],[.54,.46,.12,.10,3,.46]]),
  Crystal:variants(["Shard","Cluster","Crown","Geode"],[[.62,.22,.20,.01,1,.06],[.72,.24,.18,.01,3,.30],[.9,.20,.16,.01,4,.48],[.48,.38,.30,.05,5,.62]]),
  Flame:variants(["Ember","Torch","Wildfire","Wisp"],[[.45,.34,.24,.12,2,.10],[.72,.34,.22,.05,3,.20],[.62,.48,.25,.04,4,.52],[.9,.24,.16,.02,3,.72]]),
  Armor:variants(["Plate","Pauldrons","Carapace","Runic"],[[.48,.50,.18,.12,1,.04],[.42,.64,.22,.10,2,.18],[.72,.58,.20,.08,3,.30],[.56,.46,.16,.05,4,.45]]),
};

export function anatomyVariant(pool:ActivePartPool,variant:number):AnatomyVariant {
  const options=ANATOMY_CATALOG[pool]; return options[variant%options.length];
}
