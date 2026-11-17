import { Mulberry32, type AttachmentNodeDNA, type CreatureDNA, type Quaternion, type Vec3 } from "../dna";
import type { SdfPrimitive } from "./layout";
import { anatomyVariant } from "./anatomy-catalog";

const Q_ID:Quaternion=[0,0,0,1];
const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scale=(v:Vec3,n:number):Vec3=>[v[0]*n,v[1]*n,v[2]*n];
const rotate=(v:Vec3,q:Quaternion):Vec3=>{const[x,y,z,w]=q,uv:Vec3=[y*v[2]-z*v[1],z*v[0]-x*v[2],x*v[1]-y*v[0]],uuv:Vec3=[y*uv[2]-z*uv[1],z*uv[0]-x*uv[2],x*uv[1]-y*uv[0]];return add(v,add(scale(uv,2*w),scale(uuv,2)));};
const axisAngle=(axis:Vec3,angle:number):Quaternion=>{const length=Math.hypot(...axis)||1,s=Math.sin(angle/2)/length;return[axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(angle/2)];};

export interface FaceLandmarks {
  readonly eyes:readonly [{readonly center:Vec3;readonly radius:number},{readonly center:Vec3;readonly radius:number}];
  readonly mouth:{readonly center:Vec3;readonly radius:number};
  readonly pupilScale:number;
  readonly expression:number;
  readonly style:number;
}
export interface DiversityTraits {readonly archetypeIndex:number;readonly archetype:string;readonly bodyBulk:number;readonly headBias:number;readonly stance:number;readonly limbTaper:number;readonly posture:number;readonly featureScale:number;readonly eyeStyle:number;}
export interface CompiledPhenotype {readonly primitives:readonly SdfPrimitive[];readonly face:FaceLandmarks;readonly diversity:DiversityTraits;readonly attachmentPrimitiveCount:number;readonly silhouetteClass:string;}

const ARCHETYPES:Record<CreatureDNA["skeleton"],readonly [string,string,string]>={Biped:["Titan","Runner","Imp"],Quadruped:["Prowler","Bulwark","Grazer"],Serpentine:["Cobra","Eel","Wyrm"],Avian:["Raptor","Owl","Swift"],Floating:["Jelly","Orbiter","Monolith"]};
export function compileDiversityTraits(dna:CreatureDNA):DiversityTraits {
  const rng=new Mulberry32((dna.seed^0xd1a7e25)>>>0),archetypeIndex=Math.floor(rng.nextFloat()*3);
  return{archetypeIndex,archetype:ARCHETYPES[dna.skeleton][archetypeIndex],bodyBulk:.82+rng.nextFloat()*.38,headBias:.82+rng.nextFloat()*.42,stance:.78+rng.nextFloat()*.48,limbTaper:.68+rng.nextFloat()*.48,posture:(rng.nextFloat()-.5)*.30,featureScale:.78+rng.nextFloat()*.50,eyeStyle:Math.floor(rng.nextFloat()*3)};
}

interface SkeletonAnchors {head:Vec3;headRadii:Vec3;shoulders:Vec3;tail:Vec3;back:Vec3;}
function anchors(dna:CreatureDNA):SkeletonAnchors {
  const m=dna.morphology,h=m.headScale,t=compileDiversityTraits(dna),posture=t.posture;
  // Per-archetype head scale — Biped[0]=Titan(bulky), [1]=Runner(sleek), [2]=Imp(large-head cute)
  // Wyrm head: 1.24 (dragon menace); Eel head: 0.74 (small eel head); Cobra hood: 1.28 (wide flare)
  const archetypeHeadScale:Record<CreatureDNA["skeleton"],readonly [number,number,number]>={Biped:[.78,.72,1.62],Quadruped:[.85,.74,.88],Serpentine:[1.28,.74,1.24],Avian:[.86,1.48,.74],Floating:[.98,.82,.68]};
  const hb=t.headBias*archetypeHeadScale[dna.skeleton][t.archetypeIndex];
  // All heads are now 25-35% bigger than before — Pokemon-style prominent heads
  // Grazer qap raised to 0.40 (was 0.16) so head clears the tall deep-chested body barrel (bY=1.05)
  if(dna.skeleton==="Quadruped"){const qap=[-.10,.04,.68][t.archetypeIndex];return{head:[0,1.32+posture+qap,m.bodyScale[1]*.86],headRadii:[h[0]*.88*hb,h[1]*.84*hb,h[2]*.92*hb],shoulders:[0,1.02,m.bodyScale[1]*.34],tail:[0,.94,-m.bodyScale[1]*.58],back:[0,1.28,0]};}
  if(dna.skeleton==="Biped")return{head:[0,2.14+posture,.06],headRadii:[h[0]*.90*hb,h[1]*.88*hb,h[2]*.86*hb],shoulders:[0,1.42,0],tail:[0,.82,-.2],back:[0,1.45,-.18]};
  if(dna.skeleton==="Serpentine"){const shs=[[1.12,.70,1.00],[.80,.98,.94],[.98,.98,1.10]][t.archetypeIndex];return{head:[0,1.08+posture,m.tailLength*.52],headRadii:[h[0]*.88*hb*shs[0],h[1]*.78*hb*shs[1],h[2]*.98*hb*shs[2]],shoulders:[0,.82,m.tailLength*.30],tail:[0,.48,-m.tailLength*.62],back:[0,1.12,m.tailLength*.12]};}
  if(dna.skeleton==="Avian"){const avHeadY=[2.10,1.96,1.84][t.archetypeIndex];return{head:[0,avHeadY+posture,.42],headRadii:[h[0]*.78*hb,h[1]*.80*hb,h[2]*.82*hb],shoulders:[0,1.18,0],tail:[0,.92,-.52],back:[0,1.38,-.08]};}
  return{head:[0,1.58+posture,.26],headRadii:[h[0]*.88*hb,h[1]*.84*hb,h[2]*.88*hb],shoulders:[0,1.15,0],tail:[0,.78,-.35],back:[0,1.40,-.12]};
}

export function compileFaceLandmarks(dna:CreatureDNA):FaceLandmarks {
  const a=anchors(dna),traits=compileDiversityTraits(dna),rng=new Mulberry32((dna.seed^0xfaceb00c)>>>0),styleScale=[.88,1.06,1.38][traits.eyeStyle],r=Math.min(...a.headRadii)*(.40+rng.nextFloat()*.12)*styleScale,spacing=a.headRadii[0]*([.36,.43,.50][traits.eyeStyle]+rng.nextFloat()*.08);
  // Archetype personality: Titan=fierce(negative), Runner=alert(neutral), Imp=happy/cute(positive)
  const eyeYbias=[.08,.14,.22][traits.archetypeIndex],expBias=[-.20,.10,.30][traits.archetypeIndex];
  const eyeY=a.head[1]+a.headRadii[1]*(eyeYbias+(rng.nextFloat()-.5)*.06),eyeZ=a.head[2]+a.headRadii[2]*1.00;
  const rawExp=rng.nextFloat()*2-1,expression=Math.max(-1,Math.min(1,rawExp*.72+expBias));
  return{eyes:[{center:[-spacing,eyeY,eyeZ],radius:r},{center:[spacing,eyeY,eyeZ],radius:r}],mouth:{center:[0,a.head[1]-a.headRadii[1]*.22,a.head[2]+a.headRadii[2]*.98],radius:r*(1.05+rng.nextFloat()*.3)},pupilScale:.34+rng.nextFloat()*.28,expression,style:traits.eyeStyle};
}

function addAttachment(primitives:SdfPrimitive[],node:AttachmentNodeDNA,anchor:Vec3):number {
  if(node.part.pool==="None")return 0;
  const countBefore=primitives.length,s=node.transform.scale,q=node.transform.rotation,spec=anatomyVariant(node.part.pool,node.part.variant);
  const localBase=add(anchor,node.transform.position),pair=node.mirror==="X";
  const sides=pair?[-1,1]:[1];
  for(const sign of sides){
    const offset=pair?(Math.abs(node.transform.position[0])||s[0]*.42)*sign:node.transform.position[0];
    const base:Vec3=[anchor[0]+offset,localBase[1],localBase[2]];
    const up=rotate([0,s[1]*spec.length,s[2]*spec.sweep],q),forward=rotate([0,s[1]*spec.sweep,s[2]*spec.length],q);
    switch(node.part.pool){
      case"Horn":for(let segment=0;segment<spec.segments;segment++){const start=add(base,scale(up,segment/spec.segments)),end=add(base,scale(up,(segment+1)/spec.segments));primitives.push({kind:"taperedCapsule",start,end,startRadius:s[0]*spec.breadth*(1-segment/spec.segments*.55),endRadius:Math.max(.01,s[0]*spec.taper)});}break;
      // Spine: flat blade ellipsoids — reads as dorsal crest plates not needle spikes
      case"Spine":for(let seg=0;seg<spec.segments;seg++){const frac=(seg+.5)/spec.segments;const center=add(base,scale(up,frac));const h=(s[1]*spec.length+s[2]*Math.abs(spec.sweep))/spec.segments,w=s[0]*spec.breadth*(1-seg/spec.segments*.42);primitives.push({kind:"ellipsoid",center,radii:[w*.88,h,s[2]*spec.depth*.64],rotation:q});}break;
      case"Ear":primitives.push({kind:"ellipsoid",center:add(base,scale(up,.46)),radii:[s[0]*spec.breadth,s[1]*spec.length*.58,s[2]*spec.depth],rotation:q});break;
      case"Fin":case"Leaf":for(let segment=0;segment<Math.min(spec.segments,3);segment++)primitives.push({kind:"ellipsoid",center:add(add(base,scale(up,.42)),[sign*segment*s[0]*.10,0,-segment*s[2]*.05]),radii:[s[0]*spec.depth,s[1]*spec.length*.55,s[2]*spec.breadth],rotation:q});break;
      case"Wing":{// Chunky wing lobe — adds wing area; morphology wing handles the pointed tip separately
        const wX=s[0]*spec.length*.78,wZ=Math.max(s[2]*spec.length*.48,.16);
        primitives.push({kind:"ellipsoid",center:add(base,[sign*wX*.52,-s[1]*.24,-wZ*.30]),radii:[wX*.50,.22+s[1]*spec.breadth*.08,wZ*.68],rotation:q});break;}
      // Crystal: cap at 3 shards — chunky gem facets, not a needle fan
      case"Crystal":{const nc=Math.min(spec.segments,3);for(let shard=0;shard<nc;shard++){const tip=add(base,rotate([(shard-(nc-1)*.5)*s[0]*spec.sweep*.45,s[1]*(spec.length+shard*.08),s[2]*.12],q));primitives.push({kind:"taperedCapsule",start:base,end:tip,startRadius:s[0]*spec.breadth,endRadius:Math.max(s[0]*spec.breadth*.32,.028)});}break;}
      case"Flame":for(let flame=0;flame<spec.segments;flame++){const start=add(base,[0,flame*s[1]*.16,0]);primitives.push({kind:"ellipsoid",center:add(start,scale(forward,.28)),radii:[s[0]*spec.breadth*(1-flame*.1),s[1]*spec.length*(.52-flame*.06),s[2]*spec.depth],rotation:axisAngle([1,0,0],-.35-spec.sweep*.2)});}break;
      // Armor: shorter in X, taller in Y, high rounding → sits on shoulder as a cap not a flat table
      case"Armor":for(let plate=0;plate<Math.min(spec.segments,3);plate++){const hW=s[0]*spec.breadth*.58,hH=s[1]*spec.depth*1.90,hD=s[2]*spec.length*.64;primitives.push({kind:"roundedBox",center:add(add(base,scale(up,.20+plate*.08)),[0,0,-plate*s[2]*.18]),halfSize:[hW,hH,hD],rounding:Math.min(hW,hH,hD)*.48,rotation:q});}break;
    }
  }
  return primitives.length-countBefore;
}

export function compilePhenotype(dna:CreatureDNA):CompiledPhenotype {
  const m=dna.morphology,a=anchors(dna),traits=compileDiversityTraits(dna),rng=new Mulberry32((dna.seed^0x91e10da5)>>>0),p:SdfPrimitive[]=[],bulk=traits.bodyBulk,arch=traits.archetypeIndex;
  // STRUCT=0.022: structural body parts — organic blend gives Pokemon-like cohesion; SHARP/DETAIL for fine features
  const SHARP=0.004,DETAIL=0.010,STRUCT=0.022;
  const ellipsoid=(center:Vec3,radii:Vec3,rotation:Quaternion=Q_ID)=>p.push({kind:"ellipsoid",center,radii,rotation,smooth:STRUCT});
  const tapered=(start:Vec3,end:Vec3,ra:number,rb:number)=>p.push({kind:"taperedCapsule",start,end,startRadius:ra,endRadius:rb,smooth:STRUCT});
  const sphere=(center:Vec3,radius:number)=>p.push({kind:"sphere",center,radius,smooth:STRUCT});
  const box=(center:Vec3,halfSize:Vec3,rounding:number,rotation:Quaternion=Q_ID)=>p.push({kind:"roundedBox",center,halfSize,rounding,rotation,smooth:STRUCT});
  const taperedS=(start:Vec3,end:Vec3,ra:number,rb:number,s:number)=>p.push({kind:"taperedCapsule",start,end,startRadius:ra,endRadius:rb,smooth:s});
  const sphereS=(center:Vec3,radius:number,s:number)=>p.push({kind:"sphere",center,radius,smooth:s});
  const face=compileFaceLandmarks(dna);

  if(dna.skeleton==="Quadruped"){
    // EXTREME archetype divergence: Prowler=sleek low predator, Bulwark=armored tank, Grazer=tall elegant ungulate
    const width=[.52,1.72,1.10][arch],height=[.62,1.06,.56][arch],length=[1.66,.60,1.24][arch];
    const bY=[.76,.70,.92][arch];  // Grazer belly at 0.92: tall deer/horse stand, body stays below head Y=2.00
    if(arch===1){// Bulwark: ultra-wide armored tank (Rhyperior/Donphan — massive and low)
      box([0,bY,0],[m.bodyScale[0]*.58*bulk*width,m.bodyScale[2]*.36*height,m.bodyScale[1]*.32*length],.04*bulk);
      for(const side of [-1,1])box([side*m.bodyScale[0]*.48*width,bY+.18,m.bodyScale[1]*.08],[m.bodyScale[0]*.26*bulk,m.bodyScale[2]*.30,m.bodyScale[1]*.22],.06);
      ellipsoid([0,bY-.02,-m.bodyScale[1]*.14*length],[m.bodyScale[0]*.50*bulk*width,m.bodyScale[2]*.32*height,m.bodyScale[1]*.22*length]);
    }else if(arch===2){// Grazer: unified barrel body — ellipsoids (not box) for smooth ribcage
      // Fixed Y radii decouple barrel height from bodyScale[2] so head at Y=2.00 always shows neck
      ellipsoid([0,bY,m.bodyScale[1]*.06*length],[m.bodyScale[0]*.28*width,.34,m.bodyScale[1]*.54*length]);
      // Chest/withers swell: forward bulge gives horse shoulder profile
      ellipsoid([0,bY+.14,m.bodyScale[1]*.30*length],[m.bodyScale[0]*.30*width,.36,m.bodyScale[1]*.22*length]);
    }else{// Prowler: low sleek horizontal predator slab (Arcanine/Luxray/Lycanroc)
      box([0,bY,0],[m.bodyScale[0]*.32*bulk*width,m.bodyScale[2]*.26*height,m.bodyScale[1]*.64*length],.12*bulk);
      ellipsoid([0,bY+.08,-m.bodyScale[1]*.34*length],[m.bodyScale[0]*.30*width,m.bodyScale[2]*.36*height,m.bodyScale[1]*.28*length]);
      ellipsoid([0,bY+.16,m.bodyScale[1]*.32*length],[m.bodyScale[0]*.34*bulk*width,m.bodyScale[2]*.40*height,m.bodyScale[1]*.18*length]);
    }
    const qnw=[.86,1.24,.92][arch],qnt=[.60,.86,.64][arch];
    // Grazer neck uses fixed Y offset (body top ≈ bY+0.36=1.28) so neck always exits body visibly
    const neckBaseY=arch===2?bY+.52:bY+m.bodyScale[2]*.65*height;
    const neckBase:Vec3=[0,neckBaseY,m.bodyScale[1]*.46*length],neckTop:Vec3=[0,a.head[1]-.12,a.head[2]-.10];
    tapered(neckBase,neckTop,m.limbThickness*qnw,m.limbThickness*qnt);
    ellipsoid(a.head,a.headRadii);
    const[mxS,myS,mzS]=arch===0?[.46,.32,.94]:arch===1?[.90,.58,.44]:[.40,.28,1.14];
    const mDY=arch===2?-.28:arch===1?-.10:-.14;
    ellipsoid([0,a.head[1]+mDY,a.head[2]+a.headRadii[2]*.52],[a.headRadii[0]*mxS,a.headRadii[1]*myS,a.headRadii[2]*mzS]);
    // 3-segment legs: thigh → knee → shin+hock → foot — archetype-specific fixed Y anatomy
    // Fixed knee Y avoids the blobby ratio issue (thigh length must be ≥2x thigh radius)
    const lThk=m.limbThickness*[.92,1.36,.64][arch];
    const kY=[.28,.24,.50][arch];  // Prowler knee lower → longer thigh, Bulwark=squat, Grazer=mid for 2.4:1 thigh ratio
    for(const x of [-m.bodyScale[0]*.28*traits.stance,m.bodyScale[0]*.28*traits.stance])for(const z of [-m.bodyScale[1]*.42*length,m.bodyScale[1]*.36*length]){
      const thighY=bY-m.bodyScale[2]*.06*height;
      tapered([x,thighY,z],[x,kY,z*.88],lThk*1.00,lThk*.58);   // thigh: radius 1.0x not 1.48 → proper 2:1 length/width ratio
      ellipsoid([x,kY,z*.88],[lThk*.50,lThk*.46,lThk*.52]);      // knee joint bulge
      if(z<0){const hkZ=z-m.bodyScale[1]*.18,hkY=kY*.52+.04;   // rear leg: hock joint creates backward S-bend
        tapered([x,kY,z*.88],[x,hkY,hkZ],lThk*.54,lThk*.42);
        ellipsoid([x,hkY,hkZ],[lThk*.42,lThk*.38,lThk*.42]);
        tapered([x,hkY,hkZ],[x,.06,z-m.bodyScale[1]*.04],lThk*.42,lThk*.36*traits.limbTaper);
      }else{tapered([x,kY,z*.88],[x,.08,z+.06],lThk*.54,lThk*.38*traits.limbTaper);}
      ellipsoid([x,.08,z+(z>0?.12:-.12)],[lThk*.94,lThk*.36,lThk*1.22]);
      if(arch!==2){for(let t=0;t<3;t++){const cx=x+(t-1)*lThk*.38,cz=z+(z>0?.26:.18),cDir=z>0?1:-1;taperedS([cx,.06,cz],[cx+(t-1)*lThk*.06,-.01,cz+cDir*lThk*.38*traits.limbTaper],lThk*.20,.005,SHARP);}}
      else{box([x,.04,z+(z>0?.10:-.10)],[lThk*.16*traits.limbTaper,lThk*.32,lThk*.18*traits.limbTaper],.04);}
    }
    const tailCurlY=[.54,.04,.04][arch],tailZS=[.56,.26,1.14][arch];
    let tail=a.tail;for(let i=1;i<=4;i++){const t0=(i-1)/4,t=i/4,next:Vec3=[Math.sin(t*Math.PI)*m.bodyScale[0]*.10,a.tail[1]+t*.18+Math.sin(t*Math.PI)*tailCurlY,a.tail[2]-t*m.tailLength*tailZS];tapered(tail,next,m.limbThickness*(.88-t0*.26),m.limbThickness*(.88-t*.26));tail=next;}
    // All ears in main: Prowler=tall pointed, Bulwark=wide flat tabs, Grazer=long narrow horse ears
    if(arch===1)for(const side of [-1,1])tapered([side*a.headRadii[0]*.62,a.head[1]+a.headRadii[1]*.10,a.head[2]],[side*a.headRadii[0]*.98,a.head[1]+a.headRadii[1]*.42,a.head[2]-.04],m.limbThickness*.40,.022);
    else if(arch===0)for(const side of [-1,1])tapered([side*a.headRadii[0]*.44,a.head[1]+a.headRadii[1]*.22,a.head[2]],[side*a.headRadii[0]*.60,a.head[1]+a.headRadii[1]*1.16,a.head[2]-.08],m.limbThickness*.46,.016);
    else for(const side of [-1,1])tapered([side*a.headRadii[0]*.26,a.head[1]+a.headRadii[1]*.30,a.head[2]-.04],[side*a.headRadii[0]*.38,a.head[1]+a.headRadii[1]*1.34,a.head[2]-.12],m.limbThickness*.22,.010);
  }else if(dna.skeleton==="Biped"){
    // EXTREME archetype divergence: Titan=inverted-triangle powerhouse, Runner=lean athletic tower, Imp=round chibi
    const width=[1.72,.56,1.12][arch],height=[.74,1.58,.54][arch],depth=[1.14,.60,1.06][arch];
    if(arch===0){// Titan: wide box chest tapering to narrow hip block (Tyranitar/Machamp inverted triangle)
      box([0,1.22,.02],[m.bodyScale[0]*.56*bulk*width,m.bodyScale[2]*.42*height,m.bodyScale[1]*.30*depth],.10*bulk);
      box([0,.50,0],[m.bodyScale[0]*.30*width,m.bodyScale[2]*.20,m.bodyScale[1]*.24*depth],.08);
      tapered([0,.70,0],[0,.98,.02],m.bodyScale[0]*.26*width,m.bodyScale[0]*.44*bulk*width);
      for(const side of [-1,1])ellipsoid([side*m.limbThickness*.76,1.72,0],[m.limbThickness*.46,m.limbThickness*.58,m.limbThickness*.34]);
    }else if(arch===1){// Runner: tall lean torso — smooth ellipsoids for organic athletic form (Blaziken/Gallade tower)
      ellipsoid([0,1.04,.0],[m.bodyScale[0]*.22*bulk*width,m.bodyScale[2]*.58*height,m.bodyScale[1]*.22*depth]);
      ellipsoid([0,.50,0],[m.bodyScale[0]*.18*width,m.bodyScale[2]*.16,m.bodyScale[1]*.18*depth]);
      ellipsoid([0,1.46,.02],[m.bodyScale[0]*.22*bulk*width,m.bodyScale[2]*.28*height,m.bodyScale[1]*.20*depth]);
    }else{// Imp: sphere belly dominates everything; tiny chest sits on top (Clefairy/Jigglypuff/Snorlax chibi)
      sphere([0,.82,.18],m.bodyScale[0]*.50*bulk);
      ellipsoid([0,1.26,.02],[m.bodyScale[0]*.34*bulk*width,m.bodyScale[2]*.22*height,m.bodyScale[1]*.26*depth]);
      ellipsoid([0,.50,0],[m.bodyScale[0]*.38*width,m.bodyScale[2]*.24,m.bodyScale[1]*.30*depth]);
    }
    // Neck: connects from arch-specific chest top to just below head — avoids neck embedded in chest
    const chestTopY=arch===0?1.22+m.bodyScale[2]*.42*height:arch===1?1.04+m.bodyScale[2]*.58*height:0.82+m.bodyScale[0]*.50*bulk;
    const nw=[1.04,.62,.62][arch],nt=[.72,.44,.44][arch];
    tapered([0,chestTopY,.02],[0,a.head[1]-.14,.04],m.limbThickness*nw,m.limbThickness*nt);
    ellipsoid(a.head,a.headRadii);
    // Muzzle/chin: Titan=wide square jaw, Runner=narrow elongated, Imp=tiny cute
    const[cxS,cyS,czS]=arch===0?[.74,.46,.60]:arch===1?[.44,.38,.74]:[.50,.34,.54];
    ellipsoid([0,a.head[1]-.18,a.head[2]+a.headRadii[2]*.52],[a.headRadii[0]*cxS,a.headRadii[1]*cyS,a.headRadii[2]*czS]);
    // Legs: Titan=stocky, Runner=long athletic, Imp=short cute + wide stance (chibi waddle)
    const legTopY=[.74,.90,.72][arch],bkneeY=[.40,.54,.38][arch];
    const legStance=[1.18,1.10,1.32][arch];
    const legThk=[1.26,.86,.96][arch];
    for(const side of [-1,1]){
      const x=side*m.bodyScale[0]*.20*traits.stance*legStance;
      tapered([x,legTopY,0],[x,bkneeY,.04],m.limbThickness*1.32*legThk,m.limbThickness*.92*legThk);
      ellipsoid([x,bkneeY,.08],[m.limbThickness*.70*legThk,m.limbThickness*.76*legThk,m.limbThickness*1.04]);
      tapered([x,bkneeY,.04],[x,.08,.10],m.limbThickness*.92*legThk,m.limbThickness*.66*traits.limbTaper*legThk);
      const footW=arch===0?1.18:arch===2?1.22:.88;
      ellipsoid([x,.07,.20],[m.limbThickness*footW,m.limbThickness*.50,m.limbThickness*1.38]);
      for(let t=0;t<3;t++){const cx=x+(t-1)*m.limbThickness*.36;taperedS([cx,.07,.30],[cx+(t-1)*m.limbThickness*.07,-.01,.38+m.limbThickness*.44*traits.limbTaper],m.limbThickness*.22,.005,SHARP);}
      // Arm shoulder X = actual chest edge per archetype (Titan=wide box, Runner=narrow, Imp=sphere radius)
      // Old 0.50*bulk*width placed Runner shoulder 2.6× too far out, creating T-bar silhouette
      const chestHalfW=arch===0?m.bodyScale[0]*.56*bulk*width:arch===1?m.bodyScale[0]*.22*bulk*width:m.bodyScale[0]*.50*bulk;
      const shX=chestHalfW+m.bodyScale[0]*.03;
      const sY=chestTopY-.10;
      const shoulder:Vec3=[side*shX,sY,0],elbow:Vec3=[side*(shX+m.limbLength*.18),sY-.40,.06],hand:Vec3=[side*(shX+m.limbLength*.36+m.bodyScale[0]*.10),sY-.72,.14];
      // Archetype arm thickness: Titan=massive (Machoke style), Runner=lean, Imp=normal
      const armU=[1.44,.82,.92][arch],armL=[1.24,.70,.82][arch];
      tapered(shoulder,elbow,m.limbThickness*.80*armU,m.limbThickness*.60*armU);
      tapered(elbow,hand,m.limbThickness*.60*armL,m.limbThickness*.46*armL*traits.limbTaper);
      // Hand size: Titan=large fist, Runner=lean hand, Imp=round chubby paw (Clefairy/Jigglypuff style)
      const handW=[.78,.60,.94][arch],handH=[.80,.66,.90][arch];
      ellipsoid(hand,[m.limbThickness*handW,m.limbThickness*handH,m.limbThickness*.56]);
      // Hand claws: 3 small finger stubs extending from hand — Charmander/Treecko basic claw anatomy
      for(let fi=0;fi<3;fi++)taperedS([hand[0]+(fi-1)*m.limbThickness*.38,hand[1]-.04,hand[2]],[hand[0]+(fi-1)*m.limbThickness*.42,hand[1]-.10,hand[2]+m.limbThickness*.48],m.limbThickness*.22,.006,SHARP);
      // Runner wrist blade: forward-pointing combat spike at wrist (Blaziken/Gallade gauntlet style)
      if(arch===1)taperedS([hand[0],hand[1]+.06,hand[2]+.04],[hand[0],hand[1]-.06,hand[2]+m.limbLength*.26*traits.featureScale],m.limbThickness*.26,.005,DETAIL);
    }
    // Tail: Pokemon bipeds almost always have one — curves behind lower torso
    // Titan=heavy thick tail, Runner=lean dynamic tail, Imp=small cute tail
    const bipedTailThick=[1.28,.80,.70][arch];
    if(m.tailLength>0.3){
      let tc:Vec3=[0,.70,-.14];
      for(let i=1;i<=4;i++){const t0=(i-1)/4,t=i/4,next:Vec3=[0,.64-t*.12,-.12-t*m.tailLength*.42];tapered(tc,next,m.limbThickness*bipedTailThick*(.86-t0*.24),m.limbThickness*bipedTailThick*(.86-t*.24));tc=next;}
    }
  }else if(dna.skeleton==="Serpentine"){
    const girth=[1.02,.70,1.28][arch],writhe=[.86,1.38,1.06][arch];
    // Coil frequency: Cobra=slow wide coils, Eel=fast tight wiggles, Wyrm=majestic gentle curves
    const coilFreq=[1.8,2.8,1.4][arch];
    // S-curve snaking; girth peaks at midsection then tapers to neck; Cobra=hood-neck bulge, Wyrm=chest swell
    const girthAt=(u:number)=>{let g=m.bodyScale[0]*(0.20+Math.sin(u*Math.PI)*.12+(1-u)*.06)*girth;if(arch===0)g+=m.bodyScale[0]*Math.max(0,Math.sin((u-.72)*Math.PI*2.2)*.16)*girth;else if(arch===2)g+=m.bodyScale[0]*Math.max(0,Math.sin((u-.80)*Math.PI*1.8)*.10)*girth;return g;};
    let previous=a.tail;for(let i=1;i<=15;i++){const t0=(i-1)/15,t=i/15,next:Vec3=[Math.sin(t*Math.PI*coilFreq)*m.bodyScale[0]*.24*writhe,.48+Math.sin(t*Math.PI*1.5)*.72+t*.28,a.tail[2]+t*m.tailLength*.90];tapered(previous,next,girthAt(t0),girthAt(t));previous=next;}
    // Neck taper into large distinctive head
    tapered(previous,add(a.head,scale(a.headRadii,-.55)),m.bodyScale[0]*.12*girth,m.limbThickness*.58);
    ellipsoid(a.head,a.headRadii);
    ellipsoid([0,a.head[1]-.12,a.head[2]+a.headRadii[2]*.48],[a.headRadii[0]*.65,a.headRadii[1]*.42,a.headRadii[2]*.72]);
    if(arch===2){// Wyrm neck frill: lateral head plates (Noivern/Dragonite neck frill — distinguishes dragon from snake)
      const fp=a.headRadii[0]*1.06;
      for(const side of [-1,1]){
        ellipsoid([a.head[0]+side*fp*1.22,a.head[1]-a.headRadii[1]*.28,a.head[2]-a.headRadii[2]*.28],[fp*.30,fp*.64,fp*.13]);
        ellipsoid([a.head[0]+side*fp*.84,a.head[1]-a.headRadii[1]*.46,a.head[2]-a.headRadii[2]*.52],[fp*.22,fp*.46,fp*.11]);
      }
    }
    // Wyrm only: vestigial foreleg claws at body base (Dragonair → Dragonite transition echo)
    if(arch===2)for(const side of [-1,1]){const cz=a.tail[2]+m.tailLength*.22;tapered([side*m.bodyScale[0]*.14,.78,cz],[side*(m.bodyScale[0]*.14+m.limbLength*.28),.64,cz+.10],m.limbThickness*.58,m.limbThickness*.20);taperedS([side*(m.bodyScale[0]*.14+m.limbLength*.28),.64,cz+.10],[side*(m.bodyScale[0]*.14+m.limbLength*.36),.56,cz+m.limbThickness*.46],m.limbThickness*.20,.006,SHARP);}
  }else if(dna.skeleton==="Avian"){
    // Swift: wider body; all archetypes now use membrane ellipsoids instead of needle-ray feathers
    const width=[.94,1.28,1.14][arch],height=[.94,1.14,.82][arch],length=[1.04,.86,1.10][arch],wing=[1.54,.92,.92][arch];
    // Body: egg-shaped torso (not box) for smooth organic silhouette
    ellipsoid([0,1.04,-.04],[m.bodyScale[0]*.46*width,m.bodyScale[2]*.44*height,m.bodyScale[1]*.42*length]);
    // Breast keel: forward sternum protrusion
    ellipsoid([0,1.12,.16],[m.bodyScale[0]*.34*width,m.bodyScale[2]*.36*height,m.bodyScale[1]*.26*length]);
    // Neck: from body top to head — body top ≈ 1.04 + bsZ*0.44*height
    const avBodyTopY=1.04+m.bodyScale[2]*.46*height;
    const avianNeckBase:Vec3=[0,avBodyTopY,.10];
    tapered(avianNeckBase,[0,a.head[1]-.14,a.head[2]-.10],m.limbThickness*.64,m.limbThickness*.42);
    ellipsoid(a.head,a.headRadii);
    // Archetype-specific beak: Raptor=large hooked, Owl=stubby wide, Swift=long pointed
    // Beak: Raptor=large hooked wide, Owl=stubby wider rounded (Noctowl/Decidueye hook), Swift=long pointed (Swellow/Talonflame)
    const beakDrop=[-.22,-.16,-.06][arch],beakLen=[1.44,1.14,2.10][arch],beakW=[.44,.38,.20][arch];
    tapered([0,a.head[1]-.06,a.head[2]+a.headRadii[2]*.72],[0,a.head[1]+beakDrop,a.head[2]+a.headRadii[2]*beakLen],a.headRadii[0]*beakW,.010);
    for(const side of [-1,1]){
      // Wing: chunky 3D segments (not razor membranes) so they read from all angles
      // Root lobe: innermost thick ellipsoid, substantial Y so it doesn't vanish from front
      ellipsoid([side*m.bodyScale[0]*.46*width,1.18,-.08],[m.limbLength*.56*wing,m.limbThickness*1.28,m.bodyScale[1]*.28],axisAngle([0,0,1],side*.22));
      // Panel lobe: mid-wing segment, arch-specific sweep and chord
      const wMidZ=[-.12,-.20,-.32][arch],wChord=[.20,.26,.30][arch];
      ellipsoid([side*(m.bodyScale[0]*.46*width+m.limbLength*.26*wing),1.10,wMidZ],
                [m.limbLength*.26*wing,.22+m.limbThickness*.10,m.bodyScale[1]*wChord],
                axisAngle([0,0,1],side*.30));
      // Wing tip: fat rounded lobe — ellipsoid reads as wing panel, not spike
      const tipMidZ=[-.10,-.16,-.24][arch],tipX=side*(m.bodyScale[0]*.46*width+m.limbLength*.50*wing);
      ellipsoid([tipX,1.04,tipMidZ-.06],[m.limbLength*.18*wing,m.limbThickness*.88,m.bodyScale[1]*.14],axisAngle([0,0,1],side*.22));
      // Two-segment bird leg: upper leg angles forward to knee, tarsus continues to ankle for S-curve stance
      const knee:Vec3=[side*.20,.48,.16];
      tapered([side*.18,.92,.04],knee,m.limbThickness*.66,m.limbThickness*.50);
      tapered(knee,[side*.20,.10,.26],m.limbThickness*.50,m.limbThickness*.34);
      ellipsoid([side*.20,.08,.30],[m.limbThickness*.55,m.limbThickness*.28,m.limbThickness*1.0]);
      // Avian talons: archetype-specific length — Raptor=powerful hunter claws, Owl=broad grip, Swift=streamlined
      const talonLen=[.82,.66,.46][arch],haluxLen=[.78,.56,.34][arch];
      for(let c=0;c<3;c++){const tx=side*.20+(c-1)*m.limbThickness*.34;taperedS([tx,.04,.30],[tx+(c-1)*m.limbThickness*.08,-.01,.30+m.limbThickness*talonLen],m.limbThickness*.18,.005,SHARP);}
      taperedS([side*.20,.04,.24],[side*.20,-.01,.24-m.limbThickness*haluxLen],m.limbThickness*.16,.004,SHARP);
    }
    // Avian tail fan: 3 stubby plumes — fat enough to read as feathery mass, not needle spikes
    for(const side of [-1,0,1])tapered(a.tail,[side*m.bodyScale[0]*.30,.84,a.tail[2]-m.tailLength*.56],m.limbThickness*.80,m.limbThickness*.62);
  }else{
    // EXTREME archetype divergence: Jelly=flat bell, Orbiter=geometric box hub, Monolith=tall crystal spine
    const width=[1.32,.78,.56][arch],height=[.58,1.08,1.60][arch],depth=[1.26,.86,.50][arch];
    if(arch===0){// Jelly: flat wide bell + dome cap, 4 anchor tentacles (Tentacruel/Jellicent anatomy)
      ellipsoid([0,.66,.02],[m.bodyScale[0]*.66*width,m.bodyScale[2]*.16,m.bodyScale[1]*.62*depth]);
      ellipsoid([0,.84,.02],[m.bodyScale[0]*.46*width,m.bodyScale[2]*.28,m.bodyScale[1]*.44*depth]);
      tapered([0,.94,0],[0,a.head[1]-.10,.04],m.limbThickness*.50,m.limbThickness*.38);
      for(let i=0;i<4;i++){const ang=i*Math.PI/2;const ax=Math.cos(ang)*m.bodyScale[0]*.52*width,az=Math.sin(ang)*m.bodyScale[1]*.52*depth;tapered([ax,.68,az],[ax*1.62,.26,az*1.62],m.limbThickness*.44,m.limbThickness*.12);}
    }else if(arch===1){// Orbiter: geometric box body hub + face plate, no tentacles (Rotom/Porygon angular machine)
      box([0,1.04,0],[m.bodyScale[0]*.40*width,m.bodyScale[2]*.46*height,m.bodyScale[1]*.38*depth],.12);
      box([0,a.head[1]-.10,a.head[2]+a.headRadii[2]*.12],[m.bodyScale[0]*.46*width,m.bodyScale[2]*.42*height,m.bodyScale[1]*.10],.04);
      tapered([0,1.36,0],[0,a.head[1]-.10,.04],m.limbThickness*.52,m.limbThickness*.38);
      for(const side of [-1,1])for(const vert of [0,1]){const y=1.04+(vert-.5)*.38*height,ax=side*m.bodyScale[0]*.46*width;tapered([ax,y,0],[ax+side*m.limbLength*.56,y,0],m.limbThickness*.38,m.limbThickness*.14);}
    }else{// Monolith: pure tall narrow column — no neck, head fuses with crystal spine
      tapered([0,.80,0],[0,a.head[1]-.10,.04],m.limbThickness*.52,m.limbThickness*.36);
    }
    ellipsoid(a.head,a.headRadii);
    ellipsoid([0,a.head[1]-.13,a.head[2]+a.headRadii[2]*.42],[a.headRadii[0]*.58,a.headRadii[1]*.42,a.headRadii[2]*.58]);
  }

  // Archetype feature accents
  const f=traits.featureScale;
  if(dna.skeleton==="Quadruped"){
    if(traits.archetypeIndex===0){
      // Neck ruff: mane blobs at body shoulder edge — half-protrude so they read as attached (Arcanine/Luxray)
      // Prowler body halfWidth = bsX*.32*bulk*.52; bY=0.76; height=0.62 are Prowler archetype constants
      const nX=m.bodyScale[0]*.32*bulk*.52,nY=.76+m.bodyScale[2]*.44*.62,nZ=m.bodyScale[1]*.38,ns=m.limbThickness*f*.62;
      for(const s of [-1,1])ellipsoid([s*nX,nY,nZ],[ns*.90,ns,ns*.68]);
      for(const s of [-1,1])ellipsoid([s*nX*.72,nY+ns*.54,nZ],[ns*.58,ns*.76,ns*.46]);
      ellipsoid([0,nY+ns*.70,nZ],[ns*.54,ns*.62,ns*.42]);
      // Chin tuft: elongated fur blob below muzzle jaw — lion/wolf chin beard gives depth to the predator face
      ellipsoid([0,a.head[1]-.40,a.head[2]+a.headRadii[2]*.38],[a.headRadii[0]*.22,a.headRadii[1]*.32,a.headRadii[2]*.16]);
      // Rear haunch: muscular hindquarter bulge — capped so it doesn't exceed body width
      ellipsoid([0,.94,-m.bodyScale[1]*.28],[m.bodyScale[0]*.26,m.bodyScale[2]*.34,m.bodyScale[1]*.30]);
      // Tail curl: arcing segment before the puff for a curled cat/wolf tail volume
      tapered([0,a.tail[1]+.04,a.tail[2]-m.tailLength*.44],[0,a.tail[1]+.22,a.tail[2]-m.tailLength*.60],m.limbThickness*.72*f,m.limbThickness*.56*f);
      // Tail puff: fluffy ball at tail end — Growlithe/Arcanine curled tail (position matches curl endpoint)
      ellipsoid([0,a.tail[1]+.24,a.tail[2]-m.tailLength*.64],[m.limbThickness*.98*f,m.limbThickness*.92*f,m.limbThickness*.86*f]);
    }
    else if(traits.archetypeIndex===1){
      // Brow plate on upper front of head — rhino/armadillo boss plate (hard armor slab)
      box([0,a.head[1]+a.headRadii[1]*.36,a.head[2]+a.headRadii[2]*.44],[a.headRadii[0]*.72*f,a.headRadii[1]*.36,a.headRadii[2]*.42],.08);
      // Nasal horn: forward-pointing cone from nose bridge — Rhyhorn/Rhydon/Nidoking signature feature
      taperedS([0,a.head[1]+a.headRadii[1]*.06,a.head[2]+a.headRadii[2]*.82],[0,a.head[1]+a.headRadii[1]*.22,a.head[2]+a.headRadii[2]*1.46],a.headRadii[0]*.18*f,.010,DETAIL);
      // Body-side shoulder humps — Rhyhorn/Nidoking style bulk
      for(const side of [-1,1])ellipsoid([side*m.bodyScale[0]*.52,1.18,.04],[m.bodyScale[0]*.22*f,m.bodyScale[2]*.22,m.bodyScale[1]*.20]);
      // Dorsal withers hump: massive bison/rhino shoulder crest — Rhydon/Rhyperior silhouette
      ellipsoid([0,1.34,m.bodyScale[1]*.24],[m.bodyScale[0]*.40*f,m.bodyScale[2]*.38,m.bodyScale[1]*.30]);
    }
    else{
      // Neck mane: crest blobs from withers to poll — Rapidash/Arcanine flowing crest
      for(let i=0;i<4;i++){const t=(i+0.5)/4,mz=m.bodyScale[1]*(.53*(1-t)+.76*t),my=1.10*(1-t)+(a.head[1]-.12)*t,sz=m.limbThickness*f*.62*(1-i*.08);ellipsoid([0,my+sz*.68,mz-sz*.36],[sz*.42,sz,sz*.30]);}
      // Side mane tufts: flanking smaller blobs for fuller flowing mane (Rapidash/Xerneas/Sawsbuck mane volume)
      for(let i=0;i<3;i++){const t=(i+0.5)/3,mz=m.bodyScale[1]*(.56*(1-t)+.72*t),my=1.14*(1-t)+(a.head[1]-.14)*t,sz=m.limbThickness*f*.36*(1-i*.06);for(const s of [-1,1])ellipsoid([s*sz*.74,my+sz*.42,mz-sz*.20],[sz*.28,sz*.72,sz*.22]);}
      // Rear haunch: prominent hindquarters — horse/deer powerful stride
      ellipsoid([0,.94,-m.bodyScale[1]*.30],[m.bodyScale[0]*.36*f,m.bodyScale[2]*.30,m.bodyScale[1]*.28]);
      // Tail plume: fluffy white flag-tail at tail tip (Sawsbuck/Xerneas/Stantler deer flag)
      ellipsoid([0,a.tail[1]+.24,a.tail[2]-m.tailLength*.88],[m.limbThickness*.64*f,m.limbThickness*.80,m.limbThickness*.52]);
    }
  }else if(dna.skeleton==="Biped"){
    if(traits.archetypeIndex===0){
      for(const side of [-1,1]){const shX=m.bodyScale[0]*(0.50*bulk*1.72+0.04);ellipsoid([side*shX,1.38,-.02],[m.limbThickness*1.54*f,m.limbThickness*.94,m.limbThickness*1.22]);
        // Bicep mass: upper-arm bulge between shoulder and elbow (Machamp/Tyranitar powerhouse arm definition)
        ellipsoid([side*(shX+m.limbLength*.13),1.20,0],[m.limbThickness*.52*f,m.limbThickness*.68,m.limbThickness*.44]);}
      // Chest plate: forward-facing armor slab — Machoke/Aggron style hard plate
      box([0,1.08,.14],[m.bodyScale[0]*.28*f,m.bodyScale[2]*.22,m.bodyScale[1]*.12],.06);
      // Brow ridge: thick protruding shelf over eyes — Tyranitar/Aggron imposing brow
      for(const side of [-1,1])ellipsoid([side*a.headRadii[0]*.44,a.head[1]+a.headRadii[1]*.16,a.head[2]+a.headRadii[2]*.64],[a.headRadii[0]*.34*f,a.headRadii[1]*.18,a.headRadii[2]*.22]);
      // Dorsal spines: row of armored back plates — Tyranitar/Aggron iconic back armor
      for(let i=0;i<4;i++){const sy=0.82+i*.16,sz=-m.bodyScale[1]*(.13+i*.05),sw=m.limbThickness*f*(1.08-i*.16);taperedS([0,sy+sw*.08,sz],[0,sy+sw*.76,sz-sw*.44],sw*.76,sw*.06,DETAIL);}
    }
    else if(traits.archetypeIndex===1){const lX=m.bodyScale[0]*.20*traits.stance;for(const side of [-1,1]){tapered([side*lX*.82,.78,-.10],[side*(lX+.14*f),.26,-.22],m.limbThickness*.64,m.limbThickness*.16);tapered([side*lX*.82,.44,.14],[side*lX*.70,.18,.28],m.limbThickness*.52*f,m.limbThickness*.11);
        // Calf speed fin: swept backward blade on lower leg (Blaziken talon spur / Sceptile calf spike)
        taperedS([side*lX*.70,.38,.18],[side*lX*.80+side*m.limbThickness*.18*f,.22,.34+m.limbThickness*.38*f],m.limbThickness*.20*f,.005,SHARP);
        // Shoulder blade ridge: prominent scapula at upper back (Blaziken/Sceptile lean athletic back anatomy)
        ellipsoid([side*m.bodyScale[0]*.28,1.34,-.12],[m.limbThickness*.30*f,m.limbThickness*.44,m.limbThickness*.22]);}
      // Speed crest: swept-back dorsal skull ridge (Blaziken/Sceptile aerodynamic head fin)
      taperedS([0,a.head[1]+a.headRadii[1]*.26,a.head[2]+a.headRadii[2]*.22],[0,a.head[1]+a.headRadii[1]*.88,a.head[2]-a.headRadii[2]*.38],m.limbThickness*.36*f,.007,DETAIL);}
    else{
      // Forehead protrusion: above eye level on face front (like Ralts/Kirlia design)
      ellipsoid([0,a.head[1]+a.headRadii[1]*.42,a.head[2]+a.headRadii[2]*.68],[a.headRadii[0]*.42,a.headRadii[1]*.22,a.headRadii[2]*.32]);
      // Antennae: start from upper-side of head, extend clearly above head top
      for(const side of [-1,1]){tapered([side*a.headRadii[0]*.36,a.head[1]+a.headRadii[1]*.58,a.head[2]-.04],[side*(a.headRadii[0]*.48+m.limbLength*.12*f),a.head[1]+a.headRadii[1]+m.limbLength*.28*f,a.head[2]-.10],m.limbThickness*.32*f,.015);
        // Antenna tip orb: Clefairy/Jigglypuff pom-pom at each antenna end
        sphereS([side*(a.headRadii[0]*.48+m.limbLength*.12*f),a.head[1]+a.headRadii[1]+m.limbLength*.28*f,a.head[2]-.10],m.limbThickness*.20*f,SHARP);}
      // Chibi ear tabs: small round-tipped ear stubs on sides of head (Clefairy/Jigglypuff characteristic wide ears)
      for(const side of [-1,1])tapered([side*a.headRadii[0]*.62,a.head[1]+a.headRadii[1]*.24,a.head[2]-.04],[side*a.headRadii[0]*.84,a.head[1]+a.headRadii[1]*.58,a.head[2]-.06],m.limbThickness*.42*f,.022);
      // Cheek pouches: round side-face bumps — Jigglypuff/Chansey chubby-cheek chibi character
      for(const side of [-1,1])ellipsoid([side*a.headRadii[0]*.76,a.head[1]-.12,a.head[2]+a.headRadii[2]*.40],[a.headRadii[0]*.32,a.headRadii[1]*.28,a.headRadii[2]*.18]);
      // Round belly: chibi plump tummy — Jigglypuff/Chansey/Clefairy chubby body shape
      ellipsoid([0,.86,.12],[m.bodyScale[0]*.38*f,m.bodyScale[2]*.38,m.bodyScale[1]*.28]);
      // Imp cute tail tip: small fluffy ball at tail end (Clefairy/Snubbull/Togekiss curl stub)
      if(m.tailLength>0.3)sphere([0,.50,-0.14-m.tailLength*.42],m.limbThickness*.54*f);
    }
  }else if(dna.skeleton==="Serpentine"){
    // Cobra: wide flat hood disc + lateral hood lobes + inner depth ring + visible fangs + forked tongue
    if(traits.archetypeIndex===0){
      ellipsoid([0,a.head[1]-.04,a.head[2]+a.headRadii[2]*.28],[a.headRadii[0]*1.56*f,a.headRadii[1]*.88,a.headRadii[2]*.26]);
      // Inner hood ring: secondary smaller disc gives spectacled cobra 3D depth and marking-ready surface
      ellipsoid([0,a.head[1]-.06,a.head[2]+a.headRadii[2]*.42],[a.headRadii[0]*.92*f,a.headRadii[1]*.54,a.headRadii[2]*.22]);
      // Hood lateral lobes: give 3D depth to the spread hood — visible from front as wide neck flare
      for(const s of [-1,1])ellipsoid([s*a.headRadii[0]*.86*f,a.head[1]+a.headRadii[1]*.06,a.head[2]+a.headRadii[2]*.12],[a.headRadii[0]*.48,a.headRadii[1]*.58,a.headRadii[2]*.16]);
      for(const s of [-.22,.22])taperedS([s*a.headRadii[0],a.head[1]-a.headRadii[1]*.24,a.head[2]+a.headRadii[2]*.80],[s*a.headRadii[0]*.72,a.head[1]-a.headRadii[1]*.52,a.head[2]+a.headRadii[2]*.90],a.headRadii[0]*.10,.008,SHARP);
      // Forked tongue: two thin prongs from mouth
      const tx=a.head[2]+a.headRadii[2]*1.24,ty=a.head[1]-a.headRadii[1]*.28;
      for(const s of [-.16,.16])taperedS([0,ty,tx],[s*a.headRadii[0]*.26,ty-.05,tx+m.limbThickness*.62],.007,.003,SHARP);
    }
    // Eel: lateral body fins + dorsal crest + forked tongue + wide jaw + barbels
    else if(traits.archetypeIndex===1){
      const finZ=a.tail[2]+m.tailLength*.40;for(const side of [-1,1])ellipsoid([side*m.bodyScale[0]*.36,1.24,finZ],[m.limbThickness*.18,m.bodyScale[2]*.40*f,m.bodyScale[0]*.46],axisAngle([0,0,1],side*.22));
      // Second lateral fin set further along body for fuller silhouette (Gyarados mid-body fin pair)
      const finZ2=a.tail[2]+m.tailLength*.62;for(const side of [-1,1])ellipsoid([side*m.bodyScale[0]*.28,1.20,finZ2],[m.limbThickness*.14,m.bodyScale[2]*.30*f,m.bodyScale[0]*.36],axisAngle([0,0,1],side*.22));
      // Dorsal crest: 4 tapered fin spines along mid-dorsal (Eelektross/Gyarados style — pointed tips)
      for(let i=0;i<4;i++){const dz=a.tail[2]+m.tailLength*(.45+i*.07),bh=.78+i*.04;taperedS([0,bh,dz],[0,bh+m.limbThickness*.44*f,dz-m.limbThickness*.08],m.limbThickness*.12,.004,DETAIL);}
      const etx=a.head[2]+a.headRadii[2]*1.22,ety=a.head[1]-a.headRadii[1]*.24;
      for(const s of [-.14,.14])taperedS([0,ety,etx],[s*a.headRadii[0]*.24,ety-.05,etx+m.limbThickness*.58],.007,.003,SHARP);
      // Wide jaw + chin barbels: Gyarados/moray distinctive jaw shape
      ellipsoid([0,a.head[1]-.20,a.head[2]+a.headRadii[2]*.70],[a.headRadii[0]*.78,a.headRadii[1]*.28,a.headRadii[2]*.48]);
      for(const s of [-.16,.16])tapered([s*a.headRadii[0]*.22,a.head[1]-.26,a.head[2]+a.headRadii[2]*.70],[s*a.headRadii[0]*.32,a.head[1]-.52,a.head[2]+a.headRadii[2]*.54],m.limbThickness*.12,.005);
      // Barbel tip: rounded weighted end — Gyarados/Whiscash hanging whisker curl
      for(const s of [-.16,.16])sphereS([s*a.headRadii[0]*.32,a.head[1]-.52,a.head[2]+a.headRadii[2]*.54],m.limbThickness*.18,SHARP);
      // Eel tail fin: wide horizontal paddle at tail tip (moray/electric eel distinctive tail blade)
      ellipsoid([0,a.tail[1]+.06,a.tail[2]-.04],[m.bodyScale[0]*.38*f,m.bodyScale[2]*.12,m.bodyScale[1]*.24]);
    }
    // Wyrm: dorsal spines + lateral winglets + rattle at tail tip (Chinese dragon/Rayquaza style)
    else{const g_w=[1.02,.70,1.28][arch],w_w=[.86,1.38,1.06][arch];for(let i=0;i<5;i++){const t=.48+i*.07,sx=Math.sin(t*Math.PI*2.2)*m.bodyScale[0]*.24*w_w,sy=.48+Math.sin(t*Math.PI*1.5)*.72+t*.28,sz=a.tail[2]+t*m.tailLength*.90,sr=m.bodyScale[0]*(0.20+Math.sin(t*Math.PI)*.12+(1-t)*.06)*g_w,sh=m.bodyScale[2]*f*.26*(1-i*.04);tapered([sx,sy+sr,sz],[sx,sy+sr+sh,sz-.06],m.limbThickness*.38*f,.014);}
      // Lateral winglets: two pairs of small proto-wings along body (Rayquaza/Dragonite lateral fin style)
      for(const side of [-1,1]){tapered([side*m.bodyScale[0]*.22,1.10,a.tail[2]+m.tailLength*.36],[side*m.bodyScale[0]*.54*f,1.06,a.tail[2]+m.tailLength*.26],m.limbThickness*.30*f,.010);tapered([side*m.bodyScale[0]*.20,1.06,a.tail[2]+m.tailLength*.58],[side*m.bodyScale[0]*.46*f,1.02,a.tail[2]+m.tailLength*.48],m.limbThickness*.22*f,.008);}
      // Wyrm neck boss: wide throat bulge below head for majestic dragon neck mass (Rayquaza/Flygon regal neck breadth)
      ellipsoid([0,a.head[1]-a.headRadii[1]*.72,a.head[2]-a.headRadii[2]*.34],[m.bodyScale[0]*.38*f,a.headRadii[1]*.46,m.bodyScale[1]*.22]);
      for(let r=0;r<4;r++)sphereS([0,a.tail[1]+r*.02,a.tail[2]-r*.08],m.bodyScale[0]*.10*g_w*(1-r*.22),SHARP);}
  }else if(dna.skeleton==="Avian"){
    // Raptor: prominent ear tufts + hooked beak tip + pectoral keel (eagle/hawk style)
    if(traits.archetypeIndex===0){
      for(const side of [-1,1])tapered([side*a.headRadii[0]*.36,a.head[1]+a.headRadii[1]*.44,a.head[2]-.06],[side*a.headRadii[0]*.42,a.head[1]+a.headRadii[1]+m.limbLength*.18*f,a.head[2]-.12],m.limbThickness*.38*f,.018);
      // Hooked tip: small curved cap at beak end that drops down sharply (eagle's raptor hook)
      taperedS([0,a.head[1]-.12,a.head[2]+a.headRadii[2]*1.22],[0,a.head[1]-.26,a.head[2]+a.headRadii[2]*1.36],a.headRadii[0]*.16,.010,DETAIL);
      // Pectoral keel: forward-projecting sternum ridge — Braviary/Fearow powerful chest bone
      ellipsoid([0,1.04,.18],[m.bodyScale[0]*.24*f,m.bodyScale[2]*.38,m.bodyScale[1]*.14]);
    }
    // Owl: larger round head + facial disk bumps + neck puff collar + ear tufts (Noctowl/Decidueye style)
    else if(traits.archetypeIndex===1){
      ellipsoid(a.head,[a.headRadii[0]*1.14,a.headRadii[1]*1.12,a.headRadii[2]*.92]);
      for(const side of [-1,1])ellipsoid([side*a.headRadii[0]*.38,a.head[1]+a.headRadii[1]*.22,a.head[2]+a.headRadii[2]*.78],[a.headRadii[0]*.24,a.headRadii[1]*.15,a.headRadii[2]*.14]);
      // Neck puff: wide feather collar at neck base
      for(const side of [-1,1])ellipsoid([side*a.headRadii[0]*.62,a.head[1]-a.headRadii[1]*.22,a.head[2]-.04],[m.limbThickness*.88*f,m.limbThickness*.72,m.limbThickness*.66]);
      // Ear tufts: prominent pointed feather clusters above crown (Noctowl/Decidueye iconic feather horns)
      for(const side of [-1,1])tapered([side*a.headRadii[0]*.52,a.head[1]+a.headRadii[1]*.48,a.head[2]-.04],[side*a.headRadii[0]*.60,a.head[1]+a.headRadii[1]*1.06,a.head[2]-.10],m.limbThickness*.44*f,.016);
    }
    else{
      // Swift aerodynamic chest tuck: streamlined forward-body lobe (Swellow/Talonflame torpedo silhouette)
      ellipsoid([0,1.14,.10],[m.bodyScale[0]*.28*f,m.bodyScale[2]*.30,m.bodyScale[1]*.22]);
      // Swift tail fan: wider plumes — reads as spread tail, not needle spikes
      for(const side of [-1,0,1])tapered(a.tail,[side*m.bodyScale[0]*.44,.78,a.tail[2]-m.tailLength*.80],m.limbThickness*.56,m.limbThickness*.34);
      // Swift wingtip accent: extends the membrane wing tip further out (wing=0.92 for Swift)
      for(const side of [-1,1]){const tipX=side*(m.bodyScale[0]*.46*1.14+m.limbLength*.82*.92);tapered([tipX,1.02,-.46],[tipX+side*m.limbLength*.20*.92,.92,-.62],m.limbThickness*.26*f,m.limbThickness*.06);}
      // Swift head crest: swept-back aerodynamic feather (Swellow/Talonflame streamlined crest)
      tapered([0,a.head[1]+a.headRadii[1]*.18,a.head[2]+a.headRadii[2]*.22],[0,a.head[1]+a.headRadii[1]*.74,a.head[2]-a.headRadii[2]*.36],m.limbThickness*.30*f,.006);
    }
  }else{
    // Jelly: wide flat bell skirt disc + dome crystal cap + 8 fringe lobes + trailing tentacles
    if(traits.archetypeIndex===0){
      ellipsoid([0,.70,.06],[m.bodyScale[0]*.68,m.bodyScale[2]*.10,m.bodyScale[1]*.62]);
      // Bell dome cap: rounded translucent top with central stinger node (Tentacruel/Jellicent bell)
      ellipsoid([0,.80,.06],[m.bodyScale[0]*.42,m.bodyScale[2]*.16,m.bodyScale[1]*.40]);
      sphere([0,.94,.04],m.limbThickness*.22*f);  // central stinger/nucleus node
      for(let i=0;i<8;i++){const angle=i*Math.PI*2/8;ellipsoid([Math.cos(angle)*.68,.64,Math.sin(angle)*.68],[m.limbThickness*1.1*f,m.limbThickness*.60,m.limbThickness*.85]);}
      // Trailing tentacles: 8 sinuous tendrils below bell edge (Tentacruel/Tentaflame style)
      for(let i=0;i<8;i++){const angle=i*Math.PI*2/8+f*.14;const hx=Math.cos(angle)*.46,hz=Math.sin(angle)*.46;const tipY=.04+rng.nextFloat()*.16;tapered([hx,.58,hz],[hx*.82,tipY,hz*.82],m.limbThickness*.16,.006);
        // Tentacle tip orb: Tentacruel/jellyfish bulb at each tendril end
        sphereS([hx*.82,tipY,hz*.82],m.limbThickness*.14,SHARP);}
    }
    // Orbiter: 5 orbiting spheres + equatorial ring + connecting arms + magnetic lens + pole antennae (Magnezone style)
    else if(traits.archetypeIndex===1){
      for(let i=0;i<5;i++){const angle=i*Math.PI*2/5,sz=m.limbThickness*f*(0.50+Math.sin(i*1.3+0.5)*.14),oy=1.20+Math.sin(angle*2)*.22;sphere([Math.cos(angle)*.86,oy,Math.sin(angle)*.86],sz);
        // Connecting arm: thin rod from body center to each orbit sphere
        tapered([0,1.06,0],[Math.cos(angle)*.86,oy,Math.sin(angle)*.86],m.limbThickness*.18,m.limbThickness*.08);}
      for(let i=0;i<8;i++){const angle=i*Math.PI/4;ellipsoid([Math.cos(angle)*.62,1.04,Math.sin(angle)*.62],[m.limbThickness*.18,m.limbThickness*.14,m.limbThickness*.14]);}
      // Central lens disc: flat frontal feature (Magnezone's central body/eye lens)
      ellipsoid([0,a.head[1]-.06,a.head[2]+a.headRadii[2]*.72],[a.headRadii[0]*.52*f,a.headRadii[1]*.42,a.headRadii[2]*.20]);
      // Electromagnetic pole antennae: two top-side spires (Magnezone/Probopass pole feature)
      for(const side of [-1,1])taperedS([side*a.headRadii[0]*.34,a.head[1]+a.headRadii[1]*.52,a.head[2]],[side*a.headRadii[0]*.40,a.head[1]+a.headRadii[1]*1.06,a.head[2]],m.limbThickness*.22*f,.006,DETAIL);
    }
    else{
      // Monolith: smooth pillar with organized crystal growth (Carbink/Diancie/Jirachi style — fewer, thicker gems)
      ellipsoid([0,1.08,.04],[m.bodyScale[0]*.30,m.bodyScale[2]*.50*f,m.bodyScale[1]*.26]);
      // Central apex spire: thick crystal pointing straight up (main star point)
      taperedS([0,1.42,0],[0,2.06,0],m.limbThickness*.42,.018,DETAIL);
      // Upper crystal trio: 3 large gem shards fanning outward (Jirachi star crystal points)
      for(let i=0;i<3;i++){const angle=i*Math.PI*2/3+.18;taperedS([Math.cos(angle)*.22,1.30,Math.sin(angle)*.22],[Math.cos(angle)*.66,1.76+i*.04,Math.sin(angle)*.64],m.limbThickness*.60,.022,SHARP);}
      // Base crown: 3 crystals angling outward-upward at mid-body (crown ring, not spider legs)
      for(let i=0;i<3;i++){const angle=i*Math.PI*2/3+.78;taperedS([Math.cos(angle)*.24,.76,Math.sin(angle)*.24],[Math.cos(angle)*.50,.98,Math.sin(angle)*.48],m.limbThickness*.56*f,.022,SHARP);}
    }
  }

  const eyeAspect:Vec3=traits.eyeStyle===0?[1.40,.78,.58]:traits.eyeStyle===1?[1.0,1.05,.60]:[.72,1.55,.56];
  for(const eye of face.eyes)ellipsoid(eye.center,[eye.radius*eyeAspect[0],eye.radius*eyeAspect[1],eye.radius*eyeAspect[2]]);
  let attachmentPrimitiveCount=0;for(const node of dna.attachments){const anchor=node.socket==="Head"?a.head:node.socket==="Shoulders"?a.shoulders:node.socket==="Tail"?a.tail:a.back;attachmentPrimitiveCount+=addAttachment(p,node,anchor);}
  return{primitives:p,face,diversity:traits,attachmentPrimitiveCount,silhouetteClass:`${dna.skeleton}:${traits.archetype}:b${Math.round(bulk*10)}:h${Math.round(traits.headBias*10)}:s${Math.round(traits.stance*10)}:e${traits.eyeStyle}:${dna.attachments.map(v=>v.part.pool).join("+")||"natural"}`};
}

export function compileMorphology(dna:CreatureDNA):SdfPrimitive[]{return [...compilePhenotype(dna).primitives];}

/** Approximate world-space tail-tip position for accent shading. Returns radius=-1 when inactive. */
export function compileTailTip(dna:CreatureDNA):{tip:Vec3,radius:number} {
  const m=dna.morphology,a=anchors(dna),r=m.limbThickness*.72;
  if(dna.skeleton==="Biped") return m.tailLength>0.3?{tip:[0,.52,-0.12-m.tailLength*.42],radius:r}:{tip:[0,-99,0],radius:-1};
  if(dna.skeleton==="Quadruped") return {tip:[0,a.tail[1]+.18,a.tail[2]-m.tailLength],radius:r};
  if(dna.skeleton==="Serpentine") return {tip:a.tail,radius:m.bodyScale[0]*.10};
  if(dna.skeleton==="Avian") return {tip:[0,a.tail[1]-.06,a.tail[2]-m.tailLength*.65],radius:r*.88};
  return {tip:[0,-99,0],radius:-1};  // Floating: no tail accent
}
