import { Mulberry32 } from "./determinism";
import { ELEMENT_TYPES, SKELETON_TYPES, SURFACE_PATTERNS, type CreatureDNA } from "./types";

const round=(value:number)=>Math.round(value*1000)/1000;
const range=(rng:Mulberry32,min:number,max:number)=>round(min+rng.nextFloat()*(max-min));
const pick=<T>(rng:Mulberry32,values:readonly T[]):T=>values[Math.floor(rng.nextFloat()*values.length)];
const vary=(rng:Mulberry32,value:number,min:number,max:number,amount=.18)=>round(Math.min(max,Math.max(min,value*(1+(rng.nextFloat()*2-1)*amount))));

// Element-appropriate surface bounds: [rMin,rMax,mMin,mMax].
// Remaps raw RNG outputs without adding extra RNG calls so seed ↔ creature is still 1-to-1.
const ELEMENT_SURFACE:{[k:string]:[number,number,number,number]}={
  Metal:[.08,.42,.55,.90],Water:[.08,.40,.00,.18],Ice:[.06,.32,.00,.16],
  Earth:[.50,.92,.00,.12],Plant:[.40,.85,.00,.10],Shadow:[.15,.55,.00,.25],
  Light:[.06,.28,.00,.14],Air:[.08,.34,.00,.12],
};

/** Create a fully reproducible creature from a caller-supplied uint32 seed. */
export function randomizeDNA(template:CreatureDNA,seed:number):CreatureDNA {
  const rng=new Mulberry32(seed>>>0);
  const body=[range(rng,.65,1.65),range(rng,.65,1.55),range(rng,.55,1.45)] as const;
  const head=[range(rng,.38,.92),range(rng,.38,.92),range(rng,.38,.92)] as const;
  const skeleton=pick(rng,SKELETON_TYPES);
  const element=pick(rng,ELEMENT_TYPES);
  const limbLength=range(rng,.45,1.55),limbThickness=range(rng,.12,.38),tailLength=range(rng,.2,2.4),sdfSmoothness=range(rng,.004,.018);
  const paletteVariant=rng.nextUint32()&255;
  // Element-biased pattern weights: [Solid, Spots, Stripes, Bands, Mottled]
  const ELEM_PAT:{[k:string]:number[]}={
    Fire:[3,0,5,1,1],Electric:[2,0,6,1,1],Metal:[5,0,2,3,0],
    Water:[3,4,1,0,2],Ice:[4,2,0,3,1],Air:[4,1,1,2,2],
    Earth:[2,0,0,3,5],Plant:[2,3,0,1,4],Shadow:[5,0,1,1,3],
    Neutral:[2,3,2,1,3],Light:[4,0,2,5,0],
  };
  const pw=ELEM_PAT[element]??[1,1,1,1,1],pt=pw.reduce((a,b)=>a+b,0);
  const rawPat=rng.nextFloat()*pt;
  let cumW=0,patIdx=0;
  for(let i=0;i<pw.length;i++){cumW+=pw[i];if(rawPat<cumW){patIdx=i;break;}}
  const pattern=SURFACE_PATTERNS[patIdx];
  const patternScale=range(rng,1.4,8);
  const rawR=range(rng,.18,.92),rawM=range(rng,0,.72);
  const b=ELEMENT_SURFACE[element];
  const roughness=b?round(b[0]+(rawR-.18)/.74*(b[1]-b[0])):rawR;
  const metallic=b?round(b[2]+rawM/.72*(b[3]-b[2])):rawM;
  // Randomize anatomy variant (0-3) per attachment; pool and socket stay from template
  const attachments=template.attachments.map(node=>
    node.part.pool==="None"?node:{...node,part:{...node.part,variant:Math.floor(rng.nextFloat()*4) as 0|1|2|3}}
  );
  return {...template,seed:seed>>>0,name:`Mon-${(seed>>>0).toString(16).padStart(8,"0")}`,
    skeleton,element,attachments,
    morphology:{...template.morphology,bodyScale:body,headScale:head,limbLength,limbThickness,tailLength,sdfSmoothness},
    surface:{paletteVariant,pattern,patternScale,roughness,metallic},
  };
}

/** One stable, bounded mutation step. Repeating from identical DNA is identical. */
export function mutateDNA(dna:CreatureDNA):CreatureDNA {
  const rng=new Mulberry32((dna.seed^0xa511e9b3)>>>0);
  const mutateVec=(v:CreatureDNA["morphology"]["bodyScale"],min:number,max:number)=>v.map(value=>vary(rng,value,min,max)) as unknown as typeof v;
  return {...dna,seed:rng.nextUint32(),
    morphology:{...dna.morphology,bodyScale:mutateVec(dna.morphology.bodyScale,.2,3),headScale:mutateVec(dna.morphology.headScale,.15,2),limbLength:vary(rng,dna.morphology.limbLength,.1,10),limbThickness:vary(rng,dna.morphology.limbThickness,.02,5),tailLength:vary(rng,Math.max(dna.morphology.tailLength,.02),0,20),sdfSmoothness:vary(rng,dna.morphology.sdfSmoothness,.01,2)},
    surface:{...dna.surface,paletteVariant:rng.nextUint32()&255,patternScale:vary(rng,dna.surface.patternScale,.01,100),roughness:vary(rng,Math.max(dna.surface.roughness,.02),0,1),metallic:vary(rng,Math.max(dna.surface.metallic,.02),0,1)},
  };
}
