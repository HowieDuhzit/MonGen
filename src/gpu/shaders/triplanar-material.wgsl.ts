export const TRIPLANAR_MATERIAL_WGSL=/* wgsl */`
struct SceneUniforms {
  viewProjection: mat4x4<f32>,
  model: mat4x4<f32>,
  palette0: vec4<f32>,
  palette1: vec4<f32>,
  palette2: vec4<f32>,
  material: vec4<f32>,
  lightDirection: vec4<f32>,  // .w = featureVariant ((seed>>>16)&0xFF)/255
  cameraPosition: vec4<f32>,
  eye0: vec4<f32>,
  eye1: vec4<f32>,
  mouth: vec4<f32>,
  personality: vec4<f32>,  // .x=pupilScale .y=expression .z=mouthWidth .w=eyeStyle(0/1/2)
  tailTip: vec4<f32>,       // .xyz=tip world position .w=radius (-1=inactive, no accent)
};
@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(0) @binding(1) var patternTexture: texture_2d<f32>;
@group(0) @binding(2) var patternSampler: sampler;

struct VertexInput { @location(0) position: vec4<f32>, @location(1) normal: vec4<f32> };
struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
};

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let world=scene.model*vec4(input.position.xyz,1.0);
  output.clipPosition=scene.viewProjection*world;
  output.worldPosition=world.xyz;
  output.worldNormal=normalize((scene.model*vec4(input.normal.xyz,0.0)).xyz);
  return output;
}

fn triplanarNoise(position: vec3<f32>, normal: vec3<f32>, scale: f32) -> f32 {
  var weights=pow(abs(normal),vec3(4.0));
  weights/=max(dot(weights,vec3(1.0)),0.0001);
  let x=textureSample(patternTexture,patternSampler,position.yz*scale).r;
  let y=textureSample(patternTexture,patternSampler,position.xz*scale).r;
  let z=textureSample(patternTexture,patternSampler,position.xy*scale).r;
  return dot(vec3(x,y,z),weights);
}

fn patternValue(position: vec3<f32>, normal: vec3<f32>, noise: f32, scale: f32, pattern: f32) -> f32 {
  if (pattern<0.5) {
    // Solid: neutral mid-value; dorsal stripe added in fragmentMain where normal is in scope
    return 0.54+noise*0.07;
  }
  if (pattern<1.5) {
    // Spots: 3D Voronoi so spots are consistent spheres with no triplanar seaming
    // Variable per-spot radius: closest cell hash drives individual spot size (Arcanine/Kangaskhan natural size variety)
    let sPos=position*(scale*0.38)+vec3<f32>(noise*0.14);
    let sCell=floor(sPos);
    var minD=1.0; var spotCellH=0.0;
    for (var iz: i32=-1; iz<=1; iz++) {
      for (var iy: i32=-1; iy<=1; iy++) {
        for (var ix: i32=-1; ix<=1; ix++) {
          let nb=sCell+vec3<f32>(f32(ix),f32(iy),f32(iz));
          let hx=fract(sin(dot(nb,vec3<f32>(127.1,311.7,74.7)))*43758.545);
          let hy=fract(sin(dot(nb,vec3<f32>(269.5,183.3,46.1)))*43758.545);
          let hz=fract(sin(dot(nb,vec3<f32>(419.2,371.4,168.5)))*43758.545);
          let cellD=length(sPos-(nb+vec3<f32>(0.2+hx*0.6,0.2+hy*0.6,0.2+hz*0.6)));
          if (cellD<minD) { minD=cellD; spotCellH=hx; }
        }
      }
    }
    // Spot density cluster: slow noise field modulates where spots cluster vs thin out — leopard/cheetah natural clustering (dense in some areas, sparse elsewhere)
    let densityCluster=sin(position.x*scale*0.28+noise*1.10)*sin(position.y*scale*0.22+noise*0.88)*0.5+0.5;
    // Per-spot radius from nearest cell hash: 0.18–0.36, scaled by density cluster (larger in dense zone)
    let spotR=(0.18+spotCellH*0.18*(0.70+fract(scene.lightDirection.w*7.0)*0.30))*(0.80+densityCluster*0.40);
    let spotOn=1.0-smoothstep(spotR,spotR+0.08,minD);
    // Ring outline just beyond spot edge — darker border for bright spots, lighter for dark spots
    let spotOuter=smoothstep(spotR-0.02,spotR+0.06,minD)*(1.0-smoothstep(spotR+0.06,spotR+0.20,minD));
    let spotDir=select(-1.0,1.0,scene.lightDirection.w>0.50);
    let spotRingDir=select(0.18,-0.18,scene.lightDirection.w>0.50);
    // Light spots: brighter center for bubble-like Chansey/Clefairy roundness; dark spots: slight center fade
    let spotCenterBoost=(1.0-smoothstep(0.0,spotR*0.52,minD))*step(0.50,scene.lightDirection.w)*0.14;
    return 0.50+spotDir*spotOn*0.46+spotOuter*spotRingDir+noise*0.06+spotCenterBoost;
  }
  if (pattern<2.5) {
    // Stripes: direction varies per creature; second harmonic creates thick/thin alternation (Zebstrika/Rapidash style)
    let sa=sin(scene.lightDirection.w*3.14159)*0.52;
    let ca=cos(scene.lightDirection.w*3.14159)*0.52;
    let freq=scale*1.05;
    let tBase=(position.x*ca+position.y*sa+position.z*0.88)*freq+noise*0.45;
    let harmonic=sin(tBase*2.0)*(0.28+scene.lightDirection.w*0.22);
    // Asymmetric 3rd harmonic: creates wide/narrow alternation (Zebstrika thick+thin stripes)
    let asymHarm=sin(tBase*3.0)*(0.06+scene.lightDirection.w*0.10);
    let combined=clamp(sin(tBase)+harmonic+asymHarm,-1.0,1.0);
    // Sharpness varies per creature: crisp lightning stripes vs soft gradient bands
    let sharpness=mix(0.04,0.12,scene.lightDirection.w);
    let stripeVal=smoothstep(-sharpness,sharpness,combined)*0.86+0.07;
    // Belly fade: stripes soften on ventral surface — clearer belly zone (Arcanine/Ninetales/Rapidash belly)
    let sVentral=smoothstep(-0.10,-0.50,normal.y)*0.28;
    return mix(stripeVal,0.54,sVentral);
  }
  if (pattern<3.5) {
    // Bands: 3D-warped rings — XZ drift gives organic curvature like Sandslash plates or Onix boulder joints
    let bandWarpX=sin(position.x*scale*0.48+noise*2.1)*0.12;
    let bandWarpZ=sin(position.z*scale*0.34+noise*1.8)*0.08;
    let band=sin(position.y*scale*1.10+bandWarpX+bandWarpZ+noise*0.18);
    let bandBase=0.10+smoothstep(-0.032,0.032,band)*0.82;
    // Sub-band tonal layering: geologic strata variation within each major ring (Onix boulder layers / Sandslash plate shading)
    let bandStrata=sin(position.y*scale*3.60+noise*0.44)*0.06;
    // Groove seam: dark crack at each band boundary — Onix rock segments / Sandslash scales
    let groove=smoothstep(0.06,0.0,abs(band))*0.20;
    return clamp(bandBase+bandStrata-groove,0.0,1.0);
  }
  // Mottled: three-octave domain-warped organic patches — Flygon/Tyranitar camouflage style
  let warp=sin(position.x*scale*0.42+noise*3.1+0.8)*0.42;
  let s1=sin((position.x*0.38+position.z*0.62)*scale*1.1+noise*1.8+warp);
  let s2=sin((position.y*0.55+position.x*0.45)*scale*0.92+noise*2.3-warp*0.5);
  let s3=sin((position.z*0.72+position.y*0.28)*scale*1.58+noise*1.4+warp*0.62)*0.28;
  // Second frequency: tighter blotches create sub-patch texture within larger regions (Gengar skin texture / Tyranitar camouflage depth)
  let s4=sin((position.x*0.52+position.y*0.48)*scale*2.40+noise*0.95)*0.14;
  let mottleBase=smoothstep(0.24,0.76,s1*0.38+s2*0.38+s3+s4+noise*0.08+0.50);
  // Patch edge shadow: dark joint lines between patches — Tyranitar armor seams / Tropius leaf joints
  let mottleEdge=smoothstep(0.28,0.50,mottleBase)*(1.0-smoothstep(0.50,0.72,mottleBase));
  // Scatter dots: fine dark speckles within dark patches (Flygon/Gabite camouflage surface texture)
  let mScatterC=floor(position*scale*2.80);
  let mScatterH=fract(sin(dot(mScatterC,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let mottleScatter=step(0.88,mScatterH)*(1.0-mottleBase)*0.12;
  return clamp(mottleBase-mottleEdge*0.18-mottleScatter,0.0,1.0);
}

fn palette(value: f32) -> vec3<f32> {
  let v=clamp(value,0.0,1.0);
  // S-curve: pushes darks darker and lights lighter for richer midtone contrast
  let curved=v*v*(3.0-2.0*v);
  let t=curved*2.0;
  if (t<1.0) { return mix(scene.palette0.rgb,scene.palette1.rgb,t); }
  return mix(scene.palette1.rgb,scene.palette2.rgb,t-1.0);
}

// Counter-shading: lighter ventral (chest/belly) surface, slightly darker dorsal (back/top).
// Present on ~95% of Pokemon — it's what makes creatures look like designed characters.
fn bellyValue(normal: vec3<f32>) -> f32 {
  // Chest (biped-style): front-facing surface that isn't on top
  let chest=smoothstep(0.12,0.72,normal.z)*smoothstep(0.38,-0.35,normal.y);
  // Underbelly (quadruped-style): bottom-facing, centered
  let under=smoothstep(-0.12,-0.68,normal.y)*smoothstep(0.62,0.08,abs(normal.x));
  return clamp(max(chest,under),0.0,1.0);
}

fn eyeMask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let radius=max(eye.w,0.001);
  var aspect=vec2<f32>(1.40,0.78);                                // style 0: wide chibi
  if (scene.personality.w>0.5) { aspect=vec2<f32>(1.0,1.05); }  // style 1: round
  if (scene.personality.w>1.5) { aspect=vec2<f32>(0.72,1.55); } // style 2: tall dramatic
  // Squint: angry/hurt expression narrows the eye vertically (like Machamp's scowl)
  let squint=clamp(-scene.personality.y,0.0,1.0)*0.38;
  aspect=vec2<f32>(aspect.x,aspect.y*(1.0-squint));
  let planar=length((position.xy-eye.xy)/(radius*aspect));
  let forward=1.0-smoothstep(radius*1.35,radius*2.15,abs(position.z-eye.z));
  return (1.0-smoothstep(0.78,1.10,planar))*forward;
}

fn pupilMask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let radius=max(eye.w,0.001);
  let expression=scene.personality.y;
  let pupilCenter=eye.xy+vec2<f32>(expression*radius*0.10,-abs(expression)*radius*0.08);
  var pAspect=vec2<f32>(1.0,1.0);
  if (scene.personality.w<0.5) { pAspect=vec2<f32>(1.80,0.52); }  // style 0: horizontal oval pupil
  if (scene.personality.w>1.5) { pAspect=vec2<f32>(0.42,1.78); }  // style 2: vertical slit pupil
  let planar=length((position.xy-pupilCenter)/(radius*scene.personality.x*pAspect));
  let forward=1.0-smoothstep(radius*0.40,radius*1.55,abs(position.z-(eye.z+radius*0.55)));
  return (1.0-smoothstep(0.72,1.08,planar))*forward;
}

fn browMask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let r=max(eye.w,0.001);
  let expression=scene.personality.y;
  let side=select(-1.0,1.0,eye.x>=0.0);
  // Happy: brows raise slightly and tilt outward; angry: tilt inward-down
  let browRaise=max(0.0,expression)*r*0.08;
  let browCenter=eye.xy+vec2<f32>(0.0,r*1.22+browRaise);
  let tilt=side*(max(0.0,-expression)*0.38-max(0.0,expression)*0.14);
  let cs=cos(tilt); let sn=sin(tilt);
  let d=position.xy-browCenter;
  let dLocal=vec2<f32>(cs*d.x+sn*d.y,-sn*d.x+cs*d.y);
  // Angry expression: thicker brow ridge (more imposing); happy: thin and arched
  let browH=mix(0.19,0.28,max(0.0,-expression));
  let ellipse=length(dLocal/(r*vec2<f32>(1.52,browH)));
  let forward=1.0-smoothstep(r*1.35,r*2.15,abs(position.z-eye.z));
  return (1.0-smoothstep(0.78,1.10,ellipse))*forward;
}

fn cheekMask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let r=max(eye.w,0.001);
  let side=select(-1.0,1.0,eye.x>=0.0);
  let cheekCenter=eye.xy+vec2<f32>(side*r*0.55,-r*0.88);
  // Chibi/wide style (0): round circles like Pikachu; other styles: slightly wider ellipse
  let cAspect=select(vec2<f32>(0.38,0.32),vec2<f32>(0.34,0.34),scene.personality.w<0.5);
  let d=length((position.xy-cheekCenter)/(r*cAspect));
  let forward=1.0-smoothstep(r*1.35,r*2.15,abs(position.z-eye.z));
  return (1.0-smoothstep(0.72,1.05,d))*forward;
}

fn noseMask(position: vec3<f32>) -> f32 {
  let r=(max(scene.eye0.w,0.001)+max(scene.eye1.w,0.001))*0.5;
  let midY=(scene.eye0.y+scene.eye1.y)*0.5;
  let fwdZ=(scene.eye0.z+scene.eye1.z)*0.5;
  let noseY=midY-r*1.08;
  let leftD=length((position.xy-vec2<f32>(-r*0.28,noseY))/(r*vec2<f32>(0.15,0.13)));
  let rightD=length((position.xy-vec2<f32>(r*0.28,noseY))/(r*vec2<f32>(0.15,0.13)));
  let forward=1.0-smoothstep(r*1.0,r*2.2,abs(position.z-fwdZ));
  return max(1.0-smoothstep(0.78,1.10,leftD),1.0-smoothstep(0.78,1.10,rightD))*forward;
}

fn mouthMask(position: vec3<f32>) -> f32 {
  let radius=max(scene.mouth.w,0.001);
  let p=position-scene.mouth.xyz;
  let curve=p.y/radius-scene.personality.y*.32*(1.0-(p.x/(radius*2.1))*(p.x/(radius*2.1)));
  let ellipse=length(vec2(p.x/(radius*2.45),curve/.20));
  let forward=1.0-smoothstep(radius*.9,radius*2.2,abs(p.z));
  return (1.0-smoothstep(.72,1.12,ellipse))*forward;
}

fn glintMask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let radius=max(eye.w,0.001);
  let glintCenter=eye.xy+vec2(-radius*.15,radius*.24);
  let planar=length((position.xy-glintCenter)/(radius*.115));
  let forward=1.0-smoothstep(radius*.55,radius*1.8,abs(position.z-(eye.z+radius*.62)));
  return (1.0-smoothstep(.55,1.15,planar))*forward;
}

fn glint2Mask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let radius=max(eye.w,0.001);
  let glintCenter=eye.xy+vec2(radius*.12,-radius*.18);  // lower-right secondary sparkle
  let planar=length((position.xy-glintCenter)/(radius*.065));
  let forward=1.0-smoothstep(radius*.55,radius*1.8,abs(position.z-(eye.z+radius*.60)));
  return (1.0-smoothstep(.55,1.15,planar))*forward;
}

fn glint3Mask(position: vec3<f32>, eye: vec4<f32>) -> f32 {
  let radius=max(eye.w,0.001);
  let glintCenter=eye.xy+vec2(-radius*.28,-radius*.10);  // left-center tiny accent dot (anime 3-star eye)
  let planar=length((position.xy-glintCenter)/(radius*.038));
  let forward=1.0-smoothstep(radius*.55,radius*1.8,abs(position.z-(eye.z+radius*.60)));
  return (1.0-smoothstep(.55,1.15,planar))*forward;
}

// Muzzle/snout lighter oval — present on most Pokemon (Eevee, Pikachu, Charmander, Growlithe style)
fn muzzleMask(position: vec3<f32>) -> f32 {
  let r=(max(scene.eye0.w,0.001)+max(scene.eye1.w,0.001))*0.5;
  let midY=(scene.eye0.y+scene.eye1.y)*0.5;
  let fwdZ=(scene.eye0.z+scene.eye1.z)*0.5;
  let muzzleCY=midY-r*0.72;
  let d=length((position.xy-vec2<f32>(0.0,muzzleCY))/(r*vec2<f32>(0.88,0.58)));
  let forward=1.0-smoothstep(r*1.1,r*2.2,abs(position.z-fwdZ));
  return (1.0-smoothstep(0.72,1.05,d))*forward;
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let normal=normalize(input.worldNormal);
  let view=normalize(scene.cameraPosition.xyz-input.worldPosition);
  let light=normalize(scene.lightDirection.xyz);
  let lightDir=light;
  let fv=scene.lightDirection.w;  // featureVariant
  let crownEyeY=(scene.eye0.y+scene.eye1.y)*0.5;
  let crownEyeW=(scene.eye0.w+scene.eye1.w)*0.5;
  let msMet=clamp(scene.material.z,0.0,1.0);
  // Hoisted material properties — available everywhere in fragmentMain
  let msRgh=clamp(scene.material.y,0.04,1.0);
  let msMetal=smoothstep(0.44,0.62,msMet);
  let msRock=smoothstep(0.62,0.86,msRgh)*(1.0-msMetal);
  let roughness=clamp(scene.material.y,0.04,1.0);
  let metallic=msMet;
  let halfVec=normalize(light+view);
  let pal2Ch=max(scene.palette2.r,max(scene.palette2.g,scene.palette2.b));
  let pal2Sat=(pal2Ch-min(scene.palette2.r,min(scene.palette2.g,scene.palette2.b)))/max(pal2Ch,0.001);
  let organicSkin=clamp((0.32-pal2Sat)*4.5,0.0,1.0)*(1.0-msMetal)*smoothstep(0.28,0.56,msRgh);
  let shinRidgeY=crownEyeW*1.90;
  let wristY=crownEyeW*1.60;
  let blueSheen=clamp((scene.palette2.b-scene.palette2.r)*1.5,0.0,1.0)*(1.0-metallic);
  let elecChargeGate=clamp((scene.palette2.r+scene.palette2.g-scene.palette2.b*3.0-0.40)*2.0,0.0,1.0)*(1.0-metallic);
  let earthDom=clamp((scene.palette2.r*0.40+scene.palette2.g*0.42-scene.palette2.b*0.82-0.20+msRgh*1.0)*2.0,0.0,1.0)*(1.0-metallic)*msRock;
  let sgWaveA=sin(input.worldPosition.y*max(scene.material.x,0.001)*7.20+input.worldPosition.x*max(scene.material.x,0.001)*3.80+fv*2.1)*0.5+0.5;
  let sgWaveB=sin(input.worldPosition.x*max(scene.material.x,0.001)*6.40+input.worldPosition.z*max(scene.material.x,0.001)*4.20+fv*1.7)*0.5+0.5;

  // === Surface pattern ===
  let scale=max(scene.material.x,0.001);
  let noise=triplanarNoise(input.worldPosition,normal,scale*0.18);
  let pat_raw=patternValue(input.worldPosition,normal,noise,scale,scene.material.w);
  // Fade pattern contrast near the face — spots/stripes compressing toward mid-tone so expressions read cleanly
  let faceEyeR=(scene.eye0.w+scene.eye1.w)*0.5;
  let faceYctr=(scene.eye0.y+scene.eye1.y)*0.5;
  let faceZctr=(scene.eye0.z+scene.eye1.z)*0.5;
  let faceProxXY=1.0-smoothstep(faceEyeR*.8,faceEyeR*3.0,length(input.worldPosition.xy-vec2<f32>(0.0,faceYctr)));
  let faceProxZ=1.0-smoothstep(faceEyeR*.8,faceEyeR*2.8,abs(input.worldPosition.z-faceZctr));
  // Fade patterns toward mid-tone on face AND belly — spots/stripes don't bleed into clean color zones (Pokemon design rule)
  let bellyFade=smoothstep(0.24,0.72,bellyValue(normal))*0.52;
  let pat=mix(pat_raw,0.50,max(faceProxXY*faceProxZ*0.45,bellyFade));
  var base=palette(clamp(pat,0.0,1.0));
  // Pattern ink edge darkening: detect pattern color transitions via screen-space derivative and darken the boundary — simulates hand-inked spot/stripe outlines in Pokemon/Digimon art (Arcanine's orange-cream seam, Pikachu's stripe edge); not applied on Solid pattern (material.w < 0.5 = Solid)
  let patEdgeW=clamp(fwidth(pat_raw)*9.0,0.0,1.0)*smoothstep(0.5,1.5,scene.material.w)*(1.0-scene.material.z);
  base=clamp(base*(1.0-patEdgeW*0.18),vec3<f32>(0.0),vec3<f32>(1.0));
  // palBright: element brightness gate — used throughout shader; declared here to avoid forward-reference errors
  let palBright=dot(scene.palette2.rgb,vec3<f32>(0.299,0.587,0.114));
  // Electric/Fire saturation boost: vivid warm palettes pop with extra color intensity (Pikachu/Jolteon yellow-pop)
  let satVivid=clamp((scene.palette2.r+scene.palette2.g*0.70-scene.palette2.b*2.0-0.80)*2.0,0.0,1.0)*(1.0-scene.material.z);
  let satLum=dot(base,vec3<f32>(0.299,0.587,0.114));
  base=clamp(vec3<f32>(satLum)+(base-vec3<f32>(satLum))*(1.0+satVivid*0.22),vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-pattern contrast tuning: different elements have characteristic pattern contrast — Fire/Electric patterns have high contrast (vivid marks against dark base; Charizard's orange against dark belly, Pikachu's stripes), while Water/Ice patterns have lower contrast (soft cool stripes); this elemental contrast identity is a core part of Pokemon character design
  let warmDomPal=clamp((scene.palette2.r-scene.palette2.g*0.60-scene.palette2.b-0.18)*2.8,0.0,1.0);
  let patContrast=mix(0.0,0.20,warmDomPal)*clamp(scene.material.w-0.4,0.0,1.0);
  let patCoolSoften=clamp((scene.palette2.b-scene.palette2.r-0.12)*3.0,0.0,1.0)*clamp(scene.material.w-0.4,0.0,1.0)*(-0.12);
  let patCtrstTotal=patContrast+patCoolSoften;
  base=clamp(vec3<f32>(satLum)+(base-vec3<f32>(satLum))*(1.0+patCtrstTotal),vec3<f32>(0.0),vec3<f32>(1.0));

  // === Dorsal ridge stripe (Solid pattern only) — darkens the center-spine surface ===
  if (scene.material.w<0.5) {
    // Spine stripe: thin dark line along the dorsal ridge (like Arcanine/Ninetales spine marking)
    let spineStripe=smoothstep(0.22,0.06,abs(normal.x))*smoothstep(0.42,0.72,normal.y)*0.26;
    base=mix(base,scene.palette0.rgb,spineStripe*0.82);
    // Back accent bands on 40% of Solid creatures — Pikachu-style dorsal markings on TOP of body
    let backBand=sin(input.worldPosition.y*scale*0.96+noise*0.35)*smoothstep(0.18,0.62,normal.y);
    base=mix(base,scene.palette0.rgb,smoothstep(-0.04,0.04,backBand)*step(fv,0.40)*0.30);
    // Belly segmentation lines: subtle horizontal scale rows on ventral surface (lizard/snake belly effect)
    let bellyV=bellyValue(normal);
    let vLines=smoothstep(-0.03,0.03,sin(input.worldPosition.y*scale*2.4))*bellyV;
    base=clamp(base+vec3<f32>(0.055)*vLines,vec3<f32>(0.0),vec3<f32>(1.0));
    // Tiger stripes: dark Z-axis marks on top/sides for 30% of Solid creatures (Arcanine/Raichu style)
    let tigerS=sin(input.worldPosition.z*scale*1.44+noise*0.82)*smoothstep(-0.10,0.62,normal.y)*smoothstep(0.70,0.28,abs(normal.x));
    base=mix(base,scene.palette0.rgb,smoothstep(-0.04,0.04,tigerS)*step(0.40,fv)*step(fv,0.70)*0.52);
  }

  // Electric/Fire body arc mark: diagonal zigzag chevron body marking on vivid warm-palette creatures — Jolteon lightning fur tufts, Manectric arc crest, Electivire plasma coils; fv 0.25-0.65 gate
  let arcVivid=clamp((scene.palette2.r+scene.palette2.g*0.70-scene.palette2.b*2.0-0.80)*2.0,0.0,1.0)*(1.0-scene.material.z);
  let arcU=(input.worldPosition.y+input.worldPosition.x*0.58)*scale*2.10+fv*3.14;
  let arcZag=abs(fract(arcU)-0.50)*2.0;  // triangular wave 0-1
  let arcBodyGate=smoothstep(-0.10,0.48,normal.y)*smoothstep(0.70,0.30,abs(normal.x));
  let arcMark=smoothstep(0.80,0.92,arcZag)*arcBodyGate*arcVivid*step(0.25,fv)*step(fv,0.65);
  base=clamp(base*(1.0-arcMark*0.22)+scene.palette2.rgb*0.54*arcMark,vec3<f32>(0.0),vec3<f32>(1.0));
  // === Counter-shading (belly/chest lighter, dorsal slightly darker) ===
  // Pokemon rule: ~95% have lighter ventral, darker dorsal. Blend element palette into belly
  // so Fire gets warm-yellow belly, Water gets light-blue, Shadow gets light-purple, etc.
  // Side flank darkening: 3-zone counter-shading (top=dark, sides=mid, belly=light) — standard Pokemon form design
  let flankDarken=smoothstep(0.30,0.72,abs(normal.x))*smoothstep(-0.38,0.30,normal.y)*0.11;
  base=base*(1.0-flankDarken);

  let belly=bellyValue(normal);
  let bellyElementColor=mix(scene.palette1.rgb,scene.palette2.rgb,0.28)*1.06;  // element-tinted belly
  let bellyWhiten=base+(vec3<f32>(1.0)-base)*0.40;  // neutral lighten toward white
  let bellyLightenBias=clamp((palBright-0.30)/0.50,0.0,1.0)*0.16;  // vivid elements (Fire/Electric/Light) shift belly toward cream
  let bellyBright=mix(bellyElementColor,bellyWhiten,0.36+bellyLightenBias);  // Charizard cream / Pikachu cream belly bias for bright elements
  // Harder edge: smoothstep sharpens the body/belly boundary for cleaner region separation (like Pokemon art)
  let bellySharp=smoothstep(0.26,0.64,belly);
  base=mix(base,clamp(bellyBright,vec3<f32>(0.0),vec3<f32>(1.0)),bellySharp*0.90);
  let dorsalDarken=smoothstep(0.28,0.82,normal.y)*0.28;
  base=base*(1.0-dorsalDarken);
  // Lower body weight gradient: below eye-height, surfaces gradually darken toward ground — visual mass and grounding (all creature designs have heavier lower half)
  let lowerWeightY=clamp((crownEyeY-crownEyeW*1.0-input.worldPosition.y)/(crownEyeY),0.0,1.0);
  base=base*(1.0-lowerWeightY*0.14*(1.0-msMet));
  // Extremity color deepening: warm/cool polar elements darken toward vivid hue at body edges (Charizard orange wing tips, Articuno deep blue primaries)
  let extDepthGate=clamp(abs(scene.palette2.r-scene.palette2.b)-0.22,0.0,1.0)*(1.0-msMetal);
  let extDistXZ=smoothstep(0.88,1.38,length(input.worldPosition.xz));
  base=clamp(mix(base,scene.palette2.rgb*0.82,extDistXZ*extDepthGate*0.22),vec3<f32>(0.0),vec3<f32>(1.0));

  // === Ventral scale rings: Z-direction segmentation on undersurface — snake belly plates / pokemon belly scales ===
  let underBelly=smoothstep(-0.12,-0.68,normal.y)*smoothstep(0.62,0.08,abs(normal.x));
  let scaleRings=smoothstep(-0.018,0.018,sin(input.worldPosition.z*scale*1.72+noise*0.28))*underBelly;
  base=clamp(base+vec3<f32>(0.036)*scaleRings,vec3<f32>(0.0),vec3<f32>(1.0));

  // === Chest accent mark (72% of creatures): lighter oval on front chest, like Charmander/Eevee ===
  // The element's lightest palette color naturally makes Fire=warm belly, Water=light-blue belly, etc.
  let chestA=smoothstep(0.25,0.54,normal.z)*smoothstep(0.72,0.30,abs(normal.x))*smoothstep(0.62,0.36,normal.y)*smoothstep(-0.10,0.22,normal.y)*step(fv,0.72);
  let accentColor=mix(scene.palette1.rgb,scene.palette2.rgb,0.86);
  base=mix(base,accentColor,chestA*0.58);
  // Belly oval: element-bright explicit oval patch at belly center (Pikachu/Eevee/Vaporeon belly mark)
  let bpEyeR=(scene.eye0.w+scene.eye1.w)*0.5;
  let bpCenterY=(scene.eye0.y+scene.eye1.y)*0.5-bpEyeR*3.6;
  let bpDist=length(vec2<f32>(input.worldPosition.x/(bpEyeR*1.44),(input.worldPosition.y-bpCenterY)/(bpEyeR*1.12)));
  let bpFwd=smoothstep(0.15,0.46,normal.z)*smoothstep(-0.12,0.15,normal.y);
  let bellyOval=(1.0-smoothstep(0.68,1.05,bpDist))*bpFwd*step(fv,0.75);  // 75% of creatures get belly oval
  base=mix(base,clamp(scene.palette2.rgb*0.96,vec3<f32>(0.0),vec3<f32>(1.0)),bellyOval*0.44);

  // === Muzzle/snout lighter area — 82% of creatures get a lighter oval snout (Eevee/Pikachu/Growlithe) ===
  // Positioned below and between the eyes using eye world positions as scale-independent reference.
  // Color blends from mid-palette toward bright-palette so Fire=warm peach, Water=light-blue, etc.
  let muzzleBlend=muzzleMask(input.worldPosition)*step(fv,0.82);
  let muzzleColor=mix(scene.palette1.rgb,scene.palette2.rgb,0.58);
  base=mix(base,clamp(muzzleColor*1.04,vec3<f32>(0.0),vec3<f32>(1.0)),muzzleBlend*0.44);

  // === Chest sigil marks — bilateral glowing element circles on sternum on ~14% of creatures (Xerneas/Arceus/Hoopa sacred body marks) ===
  // Fires at very low fv (0-0.14) — these creatures have no other special body marks, making the sigil their ONLY identifier
  let sigilY=crownEyeY-crownEyeW*1.72;
  let sigilR=crownEyeW*0.26;
  let sigilFwd=smoothstep(0.22,0.52,normal.z)*smoothstep(0.10,-0.10,normal.y);
  let sigilL=smoothstep(sigilR,sigilR*0.65,length(vec2<f32>(input.worldPosition.x-crownEyeW*0.64,input.worldPosition.y-sigilY)));
  let sigilRt=smoothstep(sigilR,sigilR*0.65,length(vec2<f32>(input.worldPosition.x+crownEyeW*0.64,input.worldPosition.y-sigilY)));
  let sigilGlow=max(sigilL,sigilRt)*sigilFwd*step(fv,0.14);
  base=mix(base,clamp(scene.palette2.rgb*1.32,vec3<f32>(0.0),vec3<f32>(1.0)),sigilGlow*0.68);
  // === Neck collar — bright palette ring at neck base on 35% of creatures (Eevee/Growlithe/Arcanine style) ===
  let collarEyeR=(scene.eye0.w+scene.eye1.w)*0.5;
  let collarY=(scene.eye0.y+scene.eye1.y)*0.5-collarEyeR*2.8;
  let collarBand=smoothstep(collarY,collarY+collarEyeR*.56,input.worldPosition.y)*(1.0-smoothstep(collarY+collarEyeR*.56,collarY+collarEyeR*1.52,input.worldPosition.y));
  let collarRing=collarBand*smoothstep(0.72,0.28,abs(normal.y))*step(fv,0.35);
  base=mix(base,clamp(scene.palette2.rgb*1.10,vec3<f32>(0.0),vec3<f32>(1.0)),collarRing*0.58);

  // === Tail tip accent — Pikachu's yellow ball, Charmander's fire color, etc. ===
  // 58% of creatures get a LIGHT tip (palette2 tint), 42% get a DARK tip (palette0)
  // tipDist declared here (outside if) so emission glow can reference it after var lit= is declared
  let tipDist=select(1000.0,length(input.worldPosition-scene.tailTip.xyz),scene.tailTip.w>0.0);
  if (scene.tailTip.w > 0.0) {
    let tipBlend=1.0-smoothstep(0.0,scene.tailTip.w*1.8,tipDist);  // sharper boundary = more defined tip color region
    let tipAccent=select(scene.palette0.rgb*0.70,scene.palette2.rgb*1.12,fv>0.58);
    base=mix(base,clamp(tipAccent,vec3<f32>(0.0),vec3<f32>(1.0)),tipBlend*0.76);
  }

  // === Foot/paw darkening — Pokemon paws/claws are always darker than the body ===
  let pawDark=smoothstep(0.22,0.03,input.worldPosition.y);
  base=mix(base,scene.palette0.rgb*0.62,pawDark*0.48);
  // Claw toe separation: dark sinusoidal grooves at regular X intervals near foot — toe/claw boundary definition (Charizard/Mewtwo/Blaziken digit joints)
  let toeSep=step(0.034,abs(sin(input.worldPosition.x*scale*5.40)))*smoothstep(0.14,0.0,input.worldPosition.y)*smoothstep(0.14,0.32,input.worldPosition.z);
  base=clamp(base*(1.0-toeSep*0.36),vec3<f32>(0.0),vec3<f32>(1.0));
  // Claw tip: element-tinted — dark types get charcoal palette0, Water/Ice get blue-white, others get cream (Mewtwo purple / Articuno blue-white / Charizard cream claws)
  let clawTip=smoothstep(0.08,0.0,input.worldPosition.y)*smoothstep(0.08,0.24,input.worldPosition.z);
  let clawDarkGate=clamp((0.45-palBright)*3.5,0.0,1.0);
  let clawCoolGate=clamp((scene.palette2.b-scene.palette2.r-0.14)*3.0,0.0,1.0);
  let clawDark=clamp(scene.palette0.rgb*0.64+vec3<f32>(0.04,0.04,0.06),vec3<f32>(0.0),vec3<f32>(1.0));
  let clawTipColor=mix(mix(vec3<f32>(0.88,0.82,0.64),clawDark,clawDarkGate*0.72),vec3<f32>(0.72,0.80,0.92),clawCoolGate*0.64);
  base=mix(base,clawTipColor,clawTip*0.55);
  // Paw sole pads: dark pinkish-brown circles on the underside of the foot — Eevee/Lucario/Arcanine/Mewtwo visible paw pad detail
  let padBottom=smoothstep(-0.10,-0.56,normal.y)*smoothstep(0.13,0.02,input.worldPosition.y)*(1.0-clamp(scene.material.z,0.0,1.0));
  let padColor=clamp(mix(vec3<f32>(0.52,0.22,0.26),scene.palette0.rgb*0.56,clamp((palBright-0.20)/0.40,0.0,1.0)*0.48),vec3<f32>(0.0),vec3<f32>(1.0));
  base=mix(base,padColor,padBottom*0.50);
  // Wrist/ankle accent bands: darker ring at limb extremity joints — Mewtwo/Lucario/Blaziken/Typhlosion visible joint marking (35% of creatures, fv≤0.35); lateral-only gate prevents bleeding to belly
  let ankleLevel=crownEyeW*0.28;
  let ankleBand=smoothstep(ankleLevel+crownEyeW*0.16,ankleLevel+crownEyeW*0.04,abs(input.worldPosition.y-ankleLevel))*smoothstep(0.24,0.52,abs(normal.x))*(1.0-msMet)*step(fv,0.35);
  let wristLevel=crownEyeW*1.12;
  let wristBand=smoothstep(wristLevel+crownEyeW*0.16,wristLevel+crownEyeW*0.04,abs(input.worldPosition.y-wristLevel))*smoothstep(0.24,0.52,abs(normal.x))*(1.0-msMet)*step(fv,0.35);
  base=mix(base,clamp(scene.palette0.rgb*0.74,vec3<f32>(0.0),vec3<f32>(1.0)),max(ankleBand,wristBand)*0.40);
  // Knee joint band: darker ring at knee height — gives the leg a three-segment structure (thigh/knee/lower-leg) similar to Lucario/Blaziken/Charizard knee joint marking; anatomically distinct from ankle band and wrist band
  let kneeLevel=crownEyeY-crownEyeW*3.20;
  let kneeBand=smoothstep(kneeLevel+crownEyeW*0.14,kneeLevel+crownEyeW*0.04,abs(input.worldPosition.y-kneeLevel))*smoothstep(0.28,0.58,abs(normal.x))*(1.0-msMet)*step(fv,0.60);
  base=mix(base,clamp(scene.palette0.rgb*0.78,vec3<f32>(0.0),vec3<f32>(1.0)),kneeBand*0.30);
  // Joint crease micro-texture: fine sinusoidal crease lines run around wrist/ankle joint band — skin-fold texture at bend points (Mewtwo/Lucario/Blaziken limb joint detail quality)
  let creaseWave=sin(input.worldPosition.y*scale*22.0+noise*1.4)*0.5+0.5;
  let creaseLine=step(0.88,creaseWave)*max(ankleBand,wristBand)*(1.0-msMet);
  base=clamp(base*(1.0-creaseLine*0.18),vec3<f32>(0.0),vec3<f32>(1.0));

  // Lateral extremity accent: outermost side surfaces (wing tips / wide shoulders) pick up palette2 tint
  // Fires at |x| > 1.10 — only reaches avian wing tips and wide-stance limb extremes, not torso
  let lateralExt=smoothstep(1.10,1.58,abs(input.worldPosition.x))*smoothstep(0.22,0.58,abs(normal.x));
  // Wing/extremity accent: base is palette2; warm-dominant creatures (Charizard/Dragonite) shift wing membrane toward cool complement for cross-element wing color contrast
  // warmGate computed here (mirrors warmDom gate used later in micro-texture section)
  let warmGateWing=clamp((scene.palette2.r-scene.palette2.g*0.60-scene.palette2.b-0.18)*2.8,0.0,1.0);
  let wingComplement=clamp(vec3<f32>(1.0)-scene.palette2.rgb*0.58,vec3<f32>(0.12),vec3<f32>(0.88));
  let wingBaseColor=mix(scene.palette2.rgb*1.06,wingComplement,warmGateWing*0.64);
  base=mix(base,clamp(wingBaseColor,vec3<f32>(0.0),vec3<f32>(1.0)),lateralExt*0.34);

  // Belly/back boundary crisp edge: at the exact transition between belly and dorsal color zones, darken the boundary edge — makes the belly patch read as a clean intentional color region (Charizard belly/back sharp boundary, Blastoise blue-cream seam, Eevee cream-chest edge); based on screen-space pattern derivative
  let bellyEdgeDark=fwidth(bellyValue(normal))*5.5;
  base=clamp(base*(1.0-clamp(bellyEdgeDark,0.0,1.0)*(1.0-msMet)*0.12),vec3<f32>(0.0),vec3<f32>(1.0));

  // === Crown highlight — top of head catches the most light in Pokemon concept art ===
  // Eye position gives a creature-size-independent reference: crown = above the eye tops.
  // Scales correctly from tiny Imp bipeds to long Serpentine heads.
  let crownHeight=smoothstep(crownEyeY+crownEyeW*0.8,crownEyeY+crownEyeW*2.8,input.worldPosition.y);
  let crownFacing=smoothstep(0.68,0.92,normal.y);
  base=clamp(mix(base,base*1.10+scene.palette2.rgb*0.05,crownHeight*crownFacing*0.24),vec3<f32>(0.0),vec3<f32>(1.0));
  // Spine ridge highlight: narrow bright catchlight running along dorsal centerline — 3D spine definition (Charizard/Arcanine/Mewtwo/Dragonite back quality)
  let spineX=smoothstep(crownEyeW*0.18,crownEyeW*0.04,abs(input.worldPosition.x));
  let spineY=smoothstep(crownEyeY-crownEyeW*0.20,crownEyeY,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*4.0,crownEyeY+crownEyeW*5.5,input.worldPosition.y));
  let spineTop=smoothstep(0.58,0.80,normal.y);
  base=clamp(base+vec3<f32>(1.0)*spineX*spineY*spineTop*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Back stripe mark: dark element-tinted line along dorsal spine on ~20% of creatures — Arcanine/Typhlosion/Absol characteristic back marking
  let backStripeX=smoothstep(crownEyeW*0.24,crownEyeW*0.08,abs(input.worldPosition.x));
  let backStripeTop=smoothstep(0.50,0.76,normal.y);
  base=mix(base,clamp(scene.palette0.rgb*0.72,vec3<f32>(0.0),vec3<f32>(1.0)),backStripeX*spineY*backStripeTop*step(0.48,fv)*step(fv,0.68)*0.52);
  // Trapezius upper-back highlight: the trapezius muscle spans from the nape of the neck to the shoulders, sloping outward; when lit from above, its angled surface catches overhead light as a broad triangular highlight on the upper-back lateral zones — Machamp, Mewtwo, Arcanine, Blaziken all show this trapezoidal bright zone on the upper back in 3/4 rear view; gives creatures physical mass and musculature on the dorsal side
  let trapYTop=crownEyeY-crownEyeW*0.24;
  let trapYBot=crownEyeY-crownEyeW*0.80;
  let trapBand=smoothstep(trapYBot,trapYTop,input.worldPosition.y)*(1.0-smoothstep(trapYTop,trapYTop+crownEyeW*0.40,input.worldPosition.y));
  let trapLat=smoothstep(crownEyeW*0.14,crownEyeW*0.68,abs(input.worldPosition.x))*organicSkin*(1.0-msMet);
  let trapFace=smoothstep(0.36,0.64,normal.y)*smoothstep(0.12,0.40,abs(normal.x))*smoothstep(-0.02,-0.30,normal.z);
  base=clamp(base+vec3<f32>(1.0)*trapBand*trapLat*trapFace*0.07,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shoulder blade catchlight: flat broad brightness on upward-and-lateral-facing surfaces in the shoulder zone — the scapula region catches the key light on its angled flat plane (Charizard/Blastoise/Mewtwo/Dragonite shoulder blade highlight visible in official 3D renders; gives the body back a multi-surface quality rather than one continuous dome)
  let scapulaY=crownEyeY-crownEyeW*1.70;
  let scapulaZone=smoothstep(scapulaY-crownEyeW*0.70,scapulaY,input.worldPosition.y)*(1.0-smoothstep(scapulaY,scapulaY+crownEyeW*0.50,input.worldPosition.y));
  let scapulaFace=smoothstep(0.38,0.66,normal.y)*smoothstep(0.32,0.54,abs(normal.x));
  base=clamp(base+vec3<f32>(1.0)*scapulaZone*scapulaFace*(1.0-msMet)*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Forehead mark: element-tinted accent between the brows on 25% of creatures (Raichu crest / Latios Y-mark)
  let fMarkY=crownEyeY+crownEyeW*0.20;
  let fMarkDist=length(vec2<f32>(input.worldPosition.x/(crownEyeW*0.38),(input.worldPosition.y-fMarkY)/(crownEyeW*0.30)));
  let fMarkFwd=smoothstep(0.16,0.52,normal.z);
  let fMarkBlend=(1.0-smoothstep(0.62,1.08,fMarkDist))*fMarkFwd*step(fv,0.25);
  base=mix(base,clamp(scene.palette0.rgb*0.76,vec3<f32>(0.0),vec3<f32>(1.0)),fMarkBlend*0.62);
  // V-chevron mark: second type on 13% of creatures (fv 0.25–0.38) — inverted V wing accent (Pidgeot/Latias style)
  let fvChev=step(0.25,fv)*step(fv,0.38);
  let chevX=abs(input.worldPosition.x)/(crownEyeW*0.44);
  let chevY=(input.worldPosition.y-fMarkY)/(crownEyeW*0.28);
  let chevDist=max(chevY-chevX,-chevY)-0.08;  // inverted V shape
  let chevBlend=clamp(1.0-chevDist/0.18,0.0,1.0)*fMarkFwd*fvChev;
  base=mix(base,clamp(scene.palette2.rgb*1.10,vec3<f32>(0.0),vec3<f32>(1.0)),chevBlend*0.52);
  // Forehead highlight: soft brightness just above the eyes (between brow and crown) — forward-facing
  let foreheadY=crownEyeY+crownEyeW*0.42;
  let foreheadBand=smoothstep(foreheadY-crownEyeW*0.20,foreheadY,input.worldPosition.y)*(1.0-smoothstep(foreheadY,foreheadY+crownEyeW*0.36,input.worldPosition.y));
  let foreheadFront=smoothstep(0.18,0.52,normal.z);
  base=clamp(base+vec3<f32>(1.0)*foreheadBand*foreheadFront*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nasal bridge median crease: faint darkening line running from forehead to nose tip — Arcanine/Mewtwo/Charizard face depth; present on 70% of creatures to add facial definition
  let nasalX=smoothstep(crownEyeW*0.09,crownEyeW*0.03,abs(input.worldPosition.x));
  let nasalYT=smoothstep(crownEyeY-crownEyeW*0.88,crownEyeY-crownEyeW*0.24,input.worldPosition.y);
  let nasalYB=1.0-smoothstep(crownEyeY-crownEyeW*0.24,crownEyeY-crownEyeW*1.56,input.worldPosition.y);
  let nasalFwd=smoothstep(0.22,0.54,normal.z)*smoothstep(0.06,-0.10,abs(normal.x));
  base=clamp(base*(1.0-nasalX*nasalYT*nasalYB*nasalFwd*(1.0-msMet)*step(fv,0.70)*0.15),vec3<f32>(0.0),vec3<f32>(1.0));
  // Nose bridge catchlight: center-face vertical brightness strip gives face depth and 3D anatomy (Pokemon/Disney face quality)
  let noseBridgeX=smoothstep(crownEyeW*0.28,crownEyeW*0.04,abs(input.worldPosition.x));
  let noseBridgeFwd=smoothstep(0.26,0.58,normal.z)*smoothstep(0.14,-0.18,abs(normal.x));
  let noseBridgeY=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.10,crownEyeY+crownEyeW*1.20,input.worldPosition.y));
  base=clamp(base+vec3<f32>(0.94,0.92,0.88)*noseBridgeX*noseBridgeFwd*noseBridgeY*0.13,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nose root shadow: subtle darkening at bridge of nose between brows — anatomical forehead-nose junction depth (Eevee/Charizard face quality)
  let noseRootY=crownEyeY-crownEyeW*0.26;
  let noseRootBand=smoothstep(noseRootY-crownEyeW*0.15,noseRootY+crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(noseRootY+crownEyeW*0.06,noseRootY+crownEyeW*0.32,input.worldPosition.y));
  let noseRootX=smoothstep(crownEyeW*0.30,crownEyeW*0.08,abs(input.worldPosition.x));
  let noseRootFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(0.08,-0.16,abs(normal.x));
  base=clamp(base*(1.0-noseRootBand*noseRootX*noseRootFwd*0.12),vec3<f32>(0.0),vec3<f32>(1.0));
  // Alar nose-wing shadow: the slightly flared lateral base of the nose (alar region) casts a shadow on the cheek just below it — this shadow crescent between nose wing and upper lip is present in all detailed face renders (Arcanine, Mewtwo, Gardevoir, Eevee); defines the nose as a separate anatomical feature from the cheek
  let alarY=crownEyeY-crownEyeW*1.28;
  let alarX=crownEyeW*0.28;
  let alarShadow0=smoothstep(alarX*1.60,alarX*0.60,abs(input.worldPosition.x-alarX))*smoothstep(alarY-crownEyeW*0.20,alarY,input.worldPosition.y)*(1.0-smoothstep(alarY,alarY+crownEyeW*0.16,input.worldPosition.y));
  let alarShadow1=smoothstep(alarX*1.60,alarX*0.60,abs(input.worldPosition.x+alarX))*smoothstep(alarY-crownEyeW*0.20,alarY,input.worldPosition.y)*(1.0-smoothstep(alarY,alarY+crownEyeW*0.16,input.worldPosition.y));
  let alarFwd=smoothstep(0.22,0.52,normal.z)*smoothstep(0.10,-0.10,abs(normal.x));
  base=clamp(base*(1.0-max(alarShadow0,alarShadow1)*alarFwd*(1.0-msMet)*0.14),vec3<f32>(0.0),vec3<f32>(1.0));
  // Horn/spine keratin color gradient: horns and dorsal spines are made of keratin that grows lighter at the insertion base (tan/bone color) and darker toward the tip (dark brown/black) — Charizard's horn tips are near-black, Rhyhorn's horn is pale at the base; the base of each horn blends toward a pale bone color while the tip darkens; this gives all horned Pokemon their natural "grown" look vs painted-on horns
  let hornKerBase=smoothstep(crownEyeY+crownEyeW*0.06,crownEyeY+crownEyeW*0.60,input.worldPosition.y)*spineX*spineY*(1.0-msMet)*step(fv,0.72)*0.22;
  base=mix(base,vec3<f32>(0.82,0.74,0.60)*0.90,hornKerBase*0.28);
  let hornKerTip=smoothstep(crownEyeY+crownEyeW*1.80,crownEyeY+crownEyeW*2.60,input.worldPosition.y)*spineX*(1.0-msMet)*step(fv,0.72)*0.22;
  base=mix(base,vec3<f32>(0.10,0.08,0.06),hornKerTip*0.36);
  // Brow ridge shadow: subtle darkening across the brow arch just above each eye — overhanging brow gives character (Charizard/Lucario/Blaziken/Machamp strong brow quality)
  let browRidgeY=crownEyeY+crownEyeW*0.48;
  let browBand=smoothstep(browRidgeY-crownEyeW*0.26,browRidgeY,input.worldPosition.y)*(1.0-smoothstep(browRidgeY,browRidgeY+crownEyeW*0.38,input.worldPosition.y));
  let browLat=smoothstep(crownEyeW*0.36,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.28,abs(input.worldPosition.x)));
  let browFwd=smoothstep(0.14,0.46,normal.z)*smoothstep(0.12,-0.14,normal.y);
  base=clamp(base*(1.0-browBand*browLat*browFwd*step(0.42,fv)*0.18),vec3<f32>(0.0),vec3<f32>(1.0));
  // Cheek shadow: lateral face beside nose area darkens — cheekbone depth (Eevee/Pikachu chisel-face anatomy)
  let cheekShadowX=smoothstep(crownEyeW*0.22,crownEyeW*0.60,abs(input.worldPosition.x));
  let cheekShadowY=smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.36,crownEyeY+crownEyeW*0.28,input.worldPosition.y));
  let cheekShadowFwd=smoothstep(0.18,0.48,normal.z);
  base=clamp(base*(1.0-cheekShadowX*cheekShadowY*cheekShadowFwd*0.16),vec3<f32>(0.0),vec3<f32>(1.0));
  // Eye-level marking stripe: dark horizontal band through eye area on 18% of creatures (Arcanine/Luxray mask)
  let eyeStripeH=smoothstep(crownEyeY-crownEyeW*0.38,crownEyeY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.06,crownEyeY+crownEyeW*0.38,input.worldPosition.y));
  let eyeStripeFwd=smoothstep(0.10,0.46,normal.z)*smoothstep(0.40,0.10,abs(normal.x));
  base=mix(base,scene.palette0.rgb,eyeStripeH*eyeStripeFwd*step(0.82,fv)*0.30);
  // Neck collar zone: distinct color band at neck level separating head from body — Arcanine mane collar, Manectric arc-crest base, Mewtwo body-tone break; 40% of creatures (fv 0.30-0.70)
  let neckBandY=crownEyeY-crownEyeW*1.60;
  let neckBandMask=smoothstep(neckBandY-crownEyeW*0.40,neckBandY,input.worldPosition.y)*(1.0-smoothstep(neckBandY,neckBandY+crownEyeW*0.46,input.worldPosition.y))*smoothstep(0.08,0.52,normal.z)*(1.0-msMet)*step(0.30,fv)*step(fv,0.70);
  let neckCollarColor=mix(clamp(scene.palette1.rgb*1.14,vec3<f32>(0.0),vec3<f32>(1.0)),clamp(scene.palette0.rgb*0.72,vec3<f32>(0.0),vec3<f32>(1.0)),step(palBright,0.40));
  base=mix(base,neckCollarColor,neckBandMask*0.38);
  // Fire/Dragon lower neck flame collar accent: distinct warm-tinted color shift at the lower neck/chest junction — Typhlosion fire collar, Arcanine amber-gold chest mane, Charizard lower-neck warm hue shift; warm-dominant creatures only
  let collarFireY=crownEyeY-crownEyeW*1.88;
  let collarFireBand=smoothstep(collarFireY-crownEyeW*0.44,collarFireY,input.worldPosition.y)*(1.0-smoothstep(collarFireY,collarFireY+crownEyeW*0.58,input.worldPosition.y))*smoothstep(0.10,0.48,normal.z)*(1.0-msMet)*warmDomPal;
  base=clamp(base+vec3<f32>(0.22,0.08,0.0)*collarFireBand*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Throat/chin lightening: forward-facing surface between chin and chest is element-lighter (Charizard/Dragonair)
  let throatY=crownEyeY-crownEyeW*1.84;
  let throatBand=smoothstep(throatY-crownEyeW*0.72,throatY,input.worldPosition.y)*(1.0-smoothstep(throatY,throatY+crownEyeW*1.30,input.worldPosition.y));
  let throatFwd=smoothstep(0.20,0.52,normal.z)*smoothstep(-0.28,0.28,normal.y);
  base=mix(base,clamp(mix(base,scene.palette2.rgb*1.06,0.40),vec3<f32>(0.0),vec3<f32>(1.0)),throatBand*throatFwd*0.38);
  // Muscle definition: subtle vertical highlight bands on lateral smooth non-metal body surfaces — Machamp/Blaziken/Mewtwo musculature
  let muscleBodyGate=smoothstep(crownEyeY,crownEyeY-crownEyeW*0.80,input.worldPosition.y);
  let muscleSide=smoothstep(0.34,0.56,abs(normal.x))*(1.0-clamp(scene.material.z,0.0,1.0))*smoothstep(0.54,0.34,scene.material.y)*muscleBodyGate*0.48;
  let muscleRib=sin(input.worldPosition.y*scale*3.60+noise*0.22)*0.5+0.5;
  base=clamp(base+vec3<f32>(1.0)*smoothstep(0.62,0.82,muscleRib)*muscleSide*0.09,vec3<f32>(0.0),vec3<f32>(1.0));
  // Vertical brow accent line: dark narrow stripe above each eye running toward forehead on ~22% of creatures (Lucario/Machamp/Medicham brow scar marking)
  let browAccentX=smoothstep(crownEyeW*0.66,crownEyeW*0.46,abs(abs(input.worldPosition.x)-crownEyeW*0.82));
  let browAccentY=smoothstep(crownEyeY+crownEyeW*0.14,crownEyeY+crownEyeW*0.82,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.82,crownEyeY+crownEyeW*1.36,input.worldPosition.y));
  let browAccentFwd=smoothstep(0.14,0.48,normal.z)*smoothstep(0.20,-0.04,abs(normal.x));
  base=mix(base,clamp(scene.palette0.rgb*0.72,vec3<f32>(0.0),vec3<f32>(1.0)),browAccentX*browAccentY*browAccentFwd*step(0.20,fv)*step(fv,0.42)*0.42);
  // Cheek marking: circular pigmented spot at lateral lower face on ~30% of creatures — Pikachu/Meowth cheek feature (bold second color accent)
  let cheekSpotY=crownEyeY-crownEyeW*0.52;
  let cheekSpotXBase=crownEyeW*1.14;
  let cheekSpotR=crownEyeW*0.36;
  let cheekDist=length(vec2<f32>(abs(input.worldPosition.x)-cheekSpotXBase,input.worldPosition.y-cheekSpotY));
  let cheekSpotMask=smoothstep(cheekSpotR,cheekSpotR*0.72,cheekDist)*smoothstep(0.18,0.46,normal.z);
  let cheekSpotColor=clamp(mix(scene.palette2.rgb*1.38,scene.palette0.rgb*0.78,step(palBright,0.55)),vec3<f32>(0.0),vec3<f32>(1.0));
  base=mix(base,cheekSpotColor,cheekSpotMask*step(0.68,fv)*0.72);
  // Dorsal spine stripe: narrow back marking on ~30% of creatures (Arcanine/Typhlosion/Dragonite spine coloring)
  let dorsalStripe=smoothstep(0.55,0.84,normal.y)*smoothstep(0.28,0.06,abs(normal.x))*step(0.35,fv)*step(fv,0.65);
  base=mix(base,clamp(scene.palette0.rgb*0.86,vec3<f32>(0.0),vec3<f32>(1.0)),dorsalStripe*0.50);
  // Limb accent bands: subtle element-dark horizontal rings at limb mid-points on ~50% of creatures (Arcanine/Typhlosion joint bands)
  let limbX=abs(input.worldPosition.x);
  let limbBand=sin(input.worldPosition.y*scale*1.80+noise*0.28)*smoothstep(0.22,0.54,limbX)*smoothstep(0.72,0.46,limbX);
  base=mix(base,clamp(scene.palette0.rgb*0.82,vec3<f32>(0.0),vec3<f32>(1.0)),smoothstep(-0.04,0.04,limbBand)*step(0.25,fv)*step(fv,0.75)*0.16);
  // Shoulder accent mark: darker element-band on lateral shoulder surface on ~28% of creatures (Lucario/Blaziken/Machamp shoulder definition)
  let shoulderMarkY=crownEyeY-crownEyeW*1.4;
  let shoulderMarkH=smoothstep(shoulderMarkY-crownEyeW*0.6,shoulderMarkY,input.worldPosition.y)*(1.0-smoothstep(shoulderMarkY,shoulderMarkY+crownEyeW*0.9,input.worldPosition.y));
  let shoulderMarkX=smoothstep(0.44,0.72,abs(normal.x));
  base=mix(base,clamp(scene.palette0.rgb*0.84,vec3<f32>(0.0),vec3<f32>(1.0)),shoulderMarkH*shoulderMarkX*step(0.35,fv)*step(fv,0.63)*0.34);
  // Knee cap catchlight: forward-facing lower body surface at knee height catches soft key ambient — joint anatomy definition (Charizard/Blaziken)
  let kneeH=smoothstep(crownEyeY-crownEyeW*3.8,crownEyeY-crownEyeW*2.8,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*2.8,crownEyeY-crownEyeW*1.8,input.worldPosition.y));
  let kneeFront=smoothstep(0.24,0.52,normal.z)*smoothstep(0.28,0.58,abs(normal.x));
  base=clamp(base+vec3<f32>(1.0,0.99,0.96)*kneeH*kneeFront*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ear inner coloring: forward-facing surfaces above the crown get element-light tint (Pikachu/Eevee inner ear)
  let earTopY=crownEyeY+crownEyeW*2.2;
  let earHeight=smoothstep(earTopY-crownEyeW*0.5,earTopY+crownEyeW*1.0,input.worldPosition.y);
  let earLateral=smoothstep(0.22,0.55,abs(normal.x));
  let earForward=smoothstep(0.0,0.44,normal.z);
  let earInner=earHeight*earLateral*earForward*step(fv,0.65);
  // Dark-type inner ear: warm lavender-pink for Shadow/dark creatures (Gengar/Darkrai vivid inner ear contrast)
  let earInnerDark=vec3<f32>(0.76,0.58,0.72);
  let earInnerNorm=clamp(mix(scene.palette1.rgb,scene.palette2.rgb,0.44)*0.90,vec3<f32>(0.0),vec3<f32>(1.0));
  let earInnerColor=mix(earInnerNorm,earInnerDark,step(palBright,0.38));
  base=mix(base,earInnerColor,earInner*0.36);
  // Inner ear warm blush: pink-coral flesh SSS tones on inner ear for non-shadow creatures — Pikachu/Eevee/Mewtwo warm inner ear quality
  let earBlushGate=earInner*(1.0-step(palBright,0.38))*(1.0-msMet)*0.30;
  base=clamp(base+vec3<f32>(0.42,0.08,0.12)*earBlushGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ear canal depth shadow: the inner ear opening (auditory meatus) is a dark oval pit at the center of the inner-ear face — always darkest pixel on the ear; gives ears 3D depth and reads as "real anatomy"; present on creatures with pointed or cup-shaped ears (Pikachu, Umbreon, Mewtwo, Eevee, Charizard)
  let earCanalDist=length(input.worldPosition.xyz-vec3<f32>(select(crownEyeW*0.70,-crownEyeW*0.70,fv<0.50),crownEyeY+crownEyeW*0.10,0.0));
  let earCanalDepth=smoothstep(crownEyeW*0.16,crownEyeW*0.04,earCanalDist)*earInner*(1.0-msMet);
  base=mix(base,vec3<f32>(0.04,0.02,0.02),earCanalDepth*0.68);
  // Ear tip dark accent: very top of ear structure carries the darkest palette color — Pikachu dark-brown tips, Eevee brown outer rim, Espeon dark purple; present on 72% of creatures
  let earTipBand=smoothstep(earTopY+crownEyeW*0.72,earTopY+crownEyeW*1.40,input.worldPosition.y)*(1.0-msMet)*step(fv,0.72);
  base=mix(base,clamp(scene.palette0.rgb*0.72,vec3<f32>(0.0),vec3<f32>(1.0)),earTipBand*earLateral*0.60);

  // === Element micro-texture — surface detail that reinforces material identity ===
  // Applied to base before lighting so specular+toon react to it naturally.
  // Metal: anisotropic brushed grain lines (like brushed-metal Pokemon such as Metagross).
  // Rough/matte (Earth/Plant): cell-noise scale stipple (like Tyranitar/Ferroseed).
  // Smooth/low-roughness (Water/Ice): sine-interference ripple (like Vaporeon/Lapras).
  // Intensities are deliberately subtle (±9-14%) so primary pattern stays dominant.
  let msRough=smoothstep(0.38,0.62,msRgh)*(1.0-msMetal);
  let msSmooth=(1.0-smoothstep(0.06,0.26,msRgh))*(1.0-msMetal);
  let msBrush=sin(input.worldPosition.x*36.0+input.worldPosition.y*5.0)*0.5+0.5;
  let msCell=floor(input.worldPosition*12.96);
  let msHash=fract(sin(dot(msCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let msScaleDot=smoothstep(0.52,0.70,msHash);
  let msRipple=sin(input.worldPosition.x*18.0+noise*3.6)*sin(input.worldPosition.z*16.6+noise*2.8)*0.5+0.5;
  let msMicro=(msBrush-0.5)*msMetal*0.18+(msScaleDot-0.5)*msRough*0.15+(msRipple-0.5)*msSmooth*0.12;
  base=clamp(base*(1.0+msMicro),vec3<f32>(0.0),vec3<f32>(1.0));
  // Rock crackle: high-roughness (Earth/Ground) surfaces show dark fissures (Onix/Boldore/Rhyhorn surface texture)
  let rockCrack=step(0.88,msHash)*msRock*0.26;
  base=clamp(base*(1.0-rockCrack),vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth pebble mosaic: very-rough earth/ground surfaces show color-varied pebble cells (Golem/Geodude stone texture)
  let pebCell=floor(input.worldPosition*scale*5.40);
  let pebHash=fract(sin(dot(pebCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let pebEdge=length(fract(input.worldPosition*scale*5.40)-0.5);
  let pebLine=smoothstep(0.36,0.44,pebEdge)*msRock*0.16;
  let pebTone=(pebHash-0.5)*msRock*0.12;
  base=clamp(base*(1.0-pebLine)*(1.0+pebTone),vec3<f32>(0.0),vec3<f32>(1.0));
  // Reptile/Dragon scale grid: warm-dominant moderate-rough surfaces show staggered hex scales (Charizard/Dragonite/Tyranitar)
  let warmDom=clamp((scene.palette2.r-scene.palette2.g*0.60-scene.palette2.b-0.18)*2.8,0.0,1.0)*smoothstep(0.34,0.62,msRgh)*(1.0-msMetal);
  let scRow=floor(input.worldPosition.y*scale*3.60);
  let scUoff=input.worldPosition.x*scale*4.20+(scRow*0.50);
  let scVoff=input.worldPosition.y*scale*3.60;
  let scFractU=fract(scUoff)-0.50; let scFractV=fract(scVoff)-0.50;
  let scaleEdge=smoothstep(0.36,0.44,max(abs(scFractU),abs(scFractV)))*warmDom*0.20;
  base=clamp(base*(1.0-scaleEdge),vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale face brightening: convex center of each scale catches light — Charizard/Salamence raised-scale shimmer
  let scaleFace=smoothstep(0.26,0.06,max(abs(scFractU),abs(scFractV)))*warmDom*0.09;
  base=clamp(base+vec3<f32>(0.96,0.94,0.88)*scaleFace,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale center saturation boost: center of each scale is more vivid/saturated than the darker edge — reptile scales are iridescent in center, desaturated at edge borders (Charizard/Salamence scale color variation)
  let scaleCenterLuma=dot(base,vec3<f32>(0.299,0.587,0.114));
  let scaleCenterVivid=smoothstep(0.18,0.04,max(abs(scFractU),abs(scFractV)))*warmDom*0.12;
  base=clamp(mix(vec3<f32>(scaleCenterLuma),base,1.0+scaleCenterVivid),vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale cell tonal variation: each scale cell has a small random ±8% brightness variation — natural reptile/dragon scale irregularity (Charizard/Salamence/Flygon non-uniform scale coloring)
  let scaleCellH=fract(sin(dot(vec2<f32>(floor(scUoff),floor(scVoff)),vec2<f32>(127.1,311.7)))*43758.545);
  let scaleCellTone=(scaleCellH*2.0-1.0)*warmDom*0.08;
  base=clamp(base*(1.0+scaleCellTone),vec3<f32>(0.0),vec3<f32>(1.0));
  // Dragon/Reptile belly-back gradient: warm-rough (Dragon) creatures lighten underside with pale cream and deepen dorsal — Dragonite cream belly/green back, Salamence pale belly/blue-red back, Charizard orange belly/grey-green back
  let dragonBelly=warmDom*clamp((0.50-normal.y)/0.60,0.0,1.0)*smoothstep(0.10,0.40,normal.z)*0.18;
  let dragonBack=warmDom*clamp((normal.y-0.24)/0.50,0.0,1.0)*(1.0-smoothstep(0.40,0.70,normal.z))*0.14;
  base=clamp(base+vec3<f32>(0.18,0.12,0.04)*dragonBelly-vec3<f32>(0.08,0.06,0.04)*dragonBack,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water scale seams: blue-dominant moderate-roughness surfaces show subtle tighter scale rows (Gyarados/Kingdra/Feraligatr blue scale body)
  let waterScaleGate=clamp((scene.palette2.b-scene.palette2.r-0.14)*3.5,0.0,1.0)*smoothstep(0.28,0.52,msRgh)*(1.0-msMetal)*0.60;
  let wsRow=floor(input.worldPosition.y*scale*4.40);
  let wsOff=fract(wsRow*0.50)*0.50;
  let wsFractU=fract((input.worldPosition.x+wsOff*0.60)*scale*4.80)-0.50;
  let wsFractV=fract(input.worldPosition.y*scale*4.40)-0.50;
  let wsEdge=smoothstep(0.38,0.46,max(abs(wsFractU),abs(wsFractV)))*waterScaleGate*0.16;
  base=clamp(base*(1.0-wsEdge),vec3<f32>(0.0),vec3<f32>(1.0));
  // Water scale face brightening: convex scale center catches specular — Gyarados/Kingdra blue scale gloss (mirrors warm scaleFace)
  let wsFace=smoothstep(0.28,0.08,max(abs(wsFractU),abs(wsFractV)))*waterScaleGate*0.11;
  base=clamp(base+vec3<f32>(0.86,0.94,1.0)*wsFace,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire lava surface cracks: rough red-dominant surfaces show dark magma fissures with warm inner glow (Magmar/Camerupt/Slugma lava texture)
  let fireRed=clamp((scene.palette2.r-scene.palette2.b-0.40)*3.0,0.0,1.0)*smoothstep(0.38,0.62,msRgh)*(1.0-msMetal);
  let lavaCell=floor(input.worldPosition*scale*3.80);
  let lavaUV=fract(input.worldPosition*scale*3.80)-0.50;
  let lavaCrack=smoothstep(0.34,0.44,length(lavaUV))*fireRed;
  base=clamp(base*(1.0-lavaCrack*0.36)+vec3<f32>(0.72,0.12,0.0)*lavaCrack*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth rock chip texture: high-roughness neutral surfaces show angular micro-crevice seams between irregular rock facets (Geodude/Rhyhorn/Onix/Aggron rock chip detail)
  let rockGate=clamp((msRgh-0.52)/0.30,0.0,1.0)*(1.0-msMetal)*clamp((1.0-scene.palette2.b*1.70+0.48)*2.5,0.0,1.0);
  let chipCell=floor(input.worldPosition*scale*5.20);
  let chipH=fract(sin(dot(chipCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let chipUV=fract(input.worldPosition*scale*5.20)-0.50;
  let chipEdge=max(abs(chipUV.x),max(abs(chipUV.y),abs(chipUV.z)))-(0.34+chipH*0.12);
  base=clamp(base*(1.0-smoothstep(0.0,0.06,chipEdge)*rockGate*0.20),vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal armor plate seams: high-metallic smooth surfaces show horizontal panel joints with subtle groove/edge (Metagross/Magnezone/Genesect)
  let metalSeamGate=msMetal*smoothstep(0.36,0.14,msRgh);
  let plateRow=fract(input.worldPosition.y*scale*1.72+input.worldPosition.x*scale*0.28)-0.50;
  let plateGroove=smoothstep(0.39,0.46,abs(plateRow))*metalSeamGate;
  let plateRidge=smoothstep(0.45,0.47,abs(plateRow))*metalSeamGate;
  base=clamp(base*(1.0-plateGroove*0.24)+vec3<f32>(0.24)*plateRidge*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal wear arc scratches: circular arc marks on polished metal from grinding/collision wear (Metagross/Aggron/Aegislash worn chrome)
  let scratchGate=msMetal*smoothstep(0.36,0.14,msRgh);
  let scratchA=sin(input.worldPosition.x*scale*8.80+input.worldPosition.y*scale*2.40)*0.5+0.5;
  let scratchB=sin(input.worldPosition.x*scale*6.40-input.worldPosition.z*scale*3.20)*0.5+0.5;
  let scratchMark=step(0.93,max(scratchA,scratchB))*scratchGate;
  base=clamp(base*(1.0-scratchMark*0.22)+vec3<f32>(0.26)*scratchMark*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal rivet/bolt marks: regular circular rivet and bolt-head impressions in metal armor surface — Metagross cross-bolts, Genesect rivet pattern, Magnezone metal knobs, Aegislash hilt studs
  let rivetGate=msMetal*smoothstep(0.36,0.14,msRgh);
  let rivetCell=floor(input.worldPosition*scale*2.20);
  let rivetH=fract(sin(dot(rivetCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let rivetR=length(fract(input.worldPosition*scale*2.20)-0.50)*2.0;
  let rivetDot=smoothstep(0.32,0.22,rivetR)*step(0.78,rivetH)*rivetGate;
  let rivetEdge=smoothstep(0.22,0.26,rivetR)*smoothstep(0.32,0.28,rivetR)*rivetGate*step(0.78,rivetH);
  base=clamp(base*(1.0-rivetDot*0.20)+vec3<f32>(0.32,0.38,0.46)*rivetDot*0.28+vec3<f32>(0.74,0.80,0.88)*rivetEdge*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant leaf veins: green-dominant rough surfaces get subtle midrib lines (Ivysaur/Shaymin/Celebi leaf quality)
  // Gates: palette2.g dominates, blue is low (not Water), moderate roughness (not Metal/smooth)
  let plantDom=clamp((scene.palette2.g-scene.palette2.r-max(0.0,scene.palette2.b-0.40)*2.0-0.10)*2.5,0.0,1.0)*smoothstep(0.28,0.48,msRgh)*(1.0-msMetal);
  let veinH=sin(input.worldPosition.y*scale*2.20+sin(input.worldPosition.x*scale*1.80)*0.44)*0.5+0.5;
  let veinLine=step(0.88,veinH)*plantDom*0.20;
  base=clamp(base*(1.0-veinLine),vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant vine tendrils: sinuous winding network across green surfaces (Bulbasaur/Torterra body vine pattern)
  let vinePath=sin(input.worldPosition.y*scale*1.40+sin(input.worldPosition.x*scale*2.10)*0.52)*0.5+0.5;
  let vineB=sin(input.worldPosition.x*scale*1.60+sin(input.worldPosition.z*scale*1.80)*0.48)*0.5+0.5;
  let vineGate=step(0.88,max(vinePath,vineB))*plantDom*0.14;
  base=clamp(base*(1.0-vineGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant petal dots: circular bright spots on green surfaces — flower bud/petal pattern (Roserade/Shaymin/Ivysaur flower marks)
  let petalCell=floor(input.worldPosition*scale*2.20);
  let petalHx=fract(sin(dot(petalCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let petalHy=fract(sin(dot(petalCell,vec3<f32>(269.5,183.3,46.1)))*43758.545);
  let petalHz=fract(sin(dot(petalCell,vec3<f32>(419.2,371.4,168.5)))*43758.545);
  let petalCenter=petalCell+vec3<f32>(0.2+petalHx*0.6,0.2+petalHy*0.6,0.2+petalHz*0.6);
  let petalDist=length(input.worldPosition*scale*2.20-petalCenter);
  let petalMark=step(0.90,petalHx)*smoothstep(0.30,0.18,petalDist)*plantDom*0.18;
  let petalPollen=step(0.90,petalHx)*smoothstep(0.08,0.04,petalDist)*plantDom*0.28;  // bright yellow pollen center dot
  base=clamp(base+vec3<f32>(0.92,0.98,0.70)*petalMark+vec3<f32>(1.0,0.92,0.18)*petalPollen,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant leaf-scale shingle: green surfaces show roof-tile overlapping leaf scales — Leafeon/Tropius leaf body
  let leafScaleGate=plantDom*smoothstep(0.42,0.24,msRgh)*0.65;
  let leafRow=floor(input.worldPosition.y*scale*0.88);
  let leafOff=fract(leafRow*0.50)*0.50;
  let leafUVx=fract((input.worldPosition.x+leafOff*0.70)*scale*1.66)-0.50;
  let leafUVy=fract(input.worldPosition.y*scale*0.88)-0.50;
  let leafH2=fract(sin(dot(vec2<f32>(leafRow,floor((input.worldPosition.x+leafOff*0.70)*scale*1.66)),vec2<f32>(127.1,311.7)))*43758.545);
  let leafEllipse=length(vec2<f32>(leafUVx*0.72,leafUVy));
  let leafEdge=smoothstep(0.38,0.44,leafEllipse)*leafScaleGate;
  let leafTip=(1.0-smoothstep(0.14,0.36,leafEllipse))*smoothstep(-0.08,0.08,leafUVy)*leafScaleGate;
  base=clamp(base*(1.0-leafEdge*0.18)+vec3<f32>(0.02,0.08,0.0)*leafTip*(0.80+leafH2*0.40)*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water caustic dappling: blue-smooth surfaces show circular ripple-ring light (Vaporeon/Milotic/Gyarados underwater caustic)
  let waterBlue=clamp((scene.palette2.b-scene.palette2.r-0.20)*3.5,0.0,1.0)*smoothstep(0.28,0.10,msRgh)*(1.0-msMetal);
  let causticR=length(input.worldPosition.xz)*scale*3.20+noise*0.64;
  let causticRing=sin(causticR)*0.5+0.5;
  base=clamp(base+vec3<f32>(0.70,0.88,1.0)*smoothstep(0.76,0.94,causticRing)*waterBlue*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric-type body crackling veins: yellow/electric palettes show dark energy-vein branches (Jolteon/Raichu/Ampharos)
  let elecDom=clamp((scene.palette2.r+scene.palette2.g-scene.palette2.b*3.0-0.60)*2.0,0.0,1.0)*(1.0-msMetal)*(1.0-msRock);
  let elecVeinA=sin(input.worldPosition.y*scale*3.10+input.worldPosition.x*scale*1.70+noise*1.2)*0.5+0.5;
  let elecVeinB=sin(input.worldPosition.x*scale*2.80+input.worldPosition.z*scale*2.10+noise*0.9)*0.5+0.5;
  let elecVein=step(0.90,max(elecVeinA,elecVeinB))*elecDom*0.22;
  base=clamp(base*(1.0-elecVein),vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric zigzag chevrons: triangle-wave diagonal marks on back (Pikachu/Raichu/Jolteon lightning back pattern)
  let boltTileX=fract(abs(input.worldPosition.x)*scale*1.84);
  let boltZig=abs(boltTileX-0.50)*2.20+input.worldPosition.y*scale*1.24;
  let boltChev=step(0.91,fract(boltZig))*elecDom*smoothstep(0.34,0.64,normal.y)*0.24;
  base=clamp(mix(base,scene.palette0.rgb*0.78,boltChev),vec3<f32>(0.0),vec3<f32>(1.0));
  // Avian wing feather barbs: lateral wing-area surfaces get fine parallel barb lines (Swellow/Pidgeot/Talonflame feather vane texture)
  let featherGate=smoothstep(0.56,0.80,abs(normal.x))*smoothstep(0.70,1.12,abs(input.worldPosition.x))*(1.0-msMetal)*smoothstep(0.14,0.52,msRgh);
  let barb=sin(input.worldPosition.y*scale*7.20+input.worldPosition.x*scale*0.28+noise*0.22)*0.5+0.5;
  base=clamp(base*(1.0-step(0.88,barb)*featherGate*0.14),vec3<f32>(0.0),vec3<f32>(1.0));
  // Wing membrane radial veins: dark spoke-lines fanning from wing root outward — Charizard/Aerodactyl/Dragonite membrane anatomy
  let wingVeinGate=lateralExt*(1.0-msMetal)*smoothstep(0.22,0.56,msRgh)*0.65;
  let wingRootY=crownEyeY-crownEyeW*1.30;
  let wvDx=abs(input.worldPosition.x)-1.02;
  let wvDy=input.worldPosition.y-wingRootY;
  let wvAngle=atan2(wvDy,max(wvDx,0.02));
  let wingVein=step(0.88,sin(wvAngle*5.0)*0.5+0.5);
  let wingVeinFine=step(0.94,sin(wvAngle*11.0+wvDx*scale*1.60)*0.5+0.5);
  base=clamp(base*(1.0-max(wingVein*0.22,wingVeinFine*0.12)*wingVeinGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow-type void deepening: dark-dominant palettes get extra surface darkness in recesses (Gengar/Darkrai/Spiritomb)
  let shadowDom=clamp((0.28-palBright)*5.0,0.0,1.0)*(1.0-msMetal);
  let shadowRecess=smoothstep(0.30,0.60,noise)*shadowDom*0.14;
  base=clamp(base*(1.0-shadowRecess),vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow desaturation: supernatural darkness pulls color toward grey-violet (Gengar ethereal body desaturation)
  let baseLuma=dot(base,vec3<f32>(0.299,0.587,0.114));
  let shadowDesat=shadowDom*0.18;
  base=clamp(mix(base,vec3<f32>(baseLuma)*0.92+vec3<f32>(0.03,0.02,0.06),shadowDesat),vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow rune marks: sinusoidal arc bands suggesting arcane script across dark bodies (Gengar/Darkrai/Spiritomb rune quality)
  let runeA=sin(input.worldPosition.y*scale*0.96+noise*0.36)*cos(input.worldPosition.x*scale*1.44+noise*0.28);
  let runeB=sin(input.worldPosition.z*scale*1.20+input.worldPosition.x*scale*0.78);
  let runeMark=smoothstep(0.72,0.90,abs(runeA))*smoothstep(0.66,0.88,abs(runeB))*shadowDom*0.22;
  base=clamp(base*(1.0-runeMark*0.50)+scene.palette1.rgb*runeMark*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Smooth extremity brightening: Ice/Water/Light smooth surfaces get pale frost at raised geometry
  // and forward surfaces — crown of head, dorsal fin tips, muzzle (Articuno crown, Vaporeon dorsal, Milotic face)
  let frostGate=smoothstep(0.28,0.12,scene.material.y)*(1.0-scene.material.z);
  let frostRaise=smoothstep(1.30,1.72,input.worldPosition.y);
  let frostFwd=smoothstep(0.22,0.54,normal.z)*smoothstep(-0.12,0.20,normal.y);
  let frostExtremity=max(frostRaise*0.72,frostFwd*0.38)*frostGate;
  base=mix(base,clamp(mix(base,vec3<f32>(0.92,0.96,1.0),0.58),vec3<f32>(0.0),vec3<f32>(1.0)),frostExtremity*0.26);
  // Ice frost cells: irregular polygonal frost crystal facets on surface — frozen glass anatomy (Articuno/Glaceon/Regice)
  let iceOnly=clamp((scene.palette2.b-scene.palette2.r-0.18)*3.0,0.0,1.0)*frostGate;
  let fcID=floor(input.worldPosition*scale*2.40);
  let fcHash=fract(sin(dot(fcID,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let fcUV=fract(input.worldPosition*scale*2.40)-0.50;
  let fcEdge=smoothstep(0.30,0.44,length(fcUV))*(fcHash*0.40+0.60);
  base=clamp(base+vec3<f32>(0.90,0.96,1.0)*fcEdge*iceOnly*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Air/Wind breeze streaks: teal-to-cyan smooth palettes get diagonal flowing streak marks (Suicune/Togekiss/Rayquaza)
  let airTeal=clamp((scene.palette2.g+scene.palette2.b-scene.palette2.r*2.0-0.32)*2.8,0.0,1.0)*(1.0-msMetal)*smoothstep(0.44,0.14,msRgh);
  let breezeU=input.worldPosition.x*scale*3.20-input.worldPosition.z*scale*1.60+noise*1.2;
  let breezeStreak=step(0.90,sin(breezeU)*0.50+0.50)*airTeal*0.16;
  base=clamp(base+vec3<f32>(0.60,0.84,0.95)*breezeStreak,vec3<f32>(0.0),vec3<f32>(1.0));
  // Cloud/Air puff texture: near-white bright palettes get soft multi-octave wisps (Altaria/Swablu/Togekiss cloud body)
  let cloudWhite=clamp((min(scene.palette2.r,min(scene.palette2.g,scene.palette2.b))-0.50)*4.0,0.0,1.0)*(1.0-msMetal)*smoothstep(0.36,0.12,msRgh);
  let cA=fract(sin(dot(floor(input.worldPosition*scale*2.80),vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let cB=fract(sin(dot(floor(input.worldPosition*scale*5.60+vec3<f32>(7.4,3.1,5.8)),vec3<f32>(311.7,74.7,127.1)))*43758.545);
  let cloudPuff=smoothstep(0.52,0.80,cA*0.60+cB*0.40)*cloudWhite*0.14;
  base=clamp(base+vec3<f32>(0.96,0.97,1.0)*cloudPuff,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice crystal lattice: low-roughness blue-dominant surfaces show hexagonal frost facet pattern (Froslass/Glalie/Cryogonal/Articuno crystal body)
  let iceXtalGate=clamp((scene.palette2.b+scene.palette2.g*0.60-scene.palette2.r*2.50+0.48)*2.5,0.0,1.0)*(1.0-msMetal)*smoothstep(0.26,0.06,msRgh);
  let xtalCell=floor(input.worldPosition*scale*1.80);
  let xtalH=fract(sin(dot(xtalCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let xtalUV=fract(input.worldPosition*scale*1.80)-0.50;
  let xtalDist=max(abs(xtalUV.x)*0.86+abs(xtalUV.y)*0.50,abs(xtalUV.y));
  let xtalEdge=smoothstep(0.36,0.42,xtalDist);
  base=clamp(base*(1.0-xtalEdge*iceXtalGate*0.14)+vec3<f32>(0.76,0.88,1.0)*xtalH*iceXtalGate*0.04,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric circuit-trace texture: warm-bright high-roughness palettes show faint grid circuit lines (Jolteon/Electabuzz/Electrode surface hum)
  let elecCircuitGate=clamp((scene.palette2.r+scene.palette2.g-scene.palette2.b*2.80-0.30)*2.5,0.0,1.0)*(1.0-msMetal)*smoothstep(0.32,0.54,msRgh);
  let circX=step(0.94,fract(input.worldPosition.x*scale*3.40+noise*0.22))*elecCircuitGate*0.10;
  let circY=step(0.94,fract(input.worldPosition.y*scale*3.40+noise*0.18))*elecCircuitGate*0.10;
  base=clamp(base+vec3<f32>(0.92,0.98,0.32)*(circX+circY),vec3<f32>(0.0),vec3<f32>(1.0));
  // Neutral/Organic skin pore stipple: low-saturation natural palettes show tiny mottled pore texture (Eevee/Meowth/Snorlax organic skin)
  // Gates on low chroma (channels near each other) + medium roughness — fires for Natural/brown/beige palettes
  let skinCell=floor(input.worldPosition*scale*7.20);
  let skinHash=fract(sin(dot(skinCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let skinPore=step(0.88,skinHash)*organicSkin*0.10;
  base=clamp(base*(1.0-skinPore),vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur direction lines: low-saturation smooth organics get subtle downward-flowing hair lines (Eevee/Growlithe/Arcanine fur quality)
  let furGate=organicSkin*smoothstep(0.38,0.16,msRgh);
  // Fur flows radially from spine: normal.x component leans strands outward from body center — Eevee/Arcanine natural gravity-follow fur direction
  let furFlowU=input.worldPosition.y*scale*10.20+normal.x*scale*1.60+noise*0.36;
  let furLine=sin(furFlowU)*0.5+0.5;
  base=clamp(base*(1.0-step(0.90,furLine)*furGate*0.13),vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur clump borders: coarser secondary frequency groups fine strands into tufts — Eevee/Arcanine fur strand grouping quality
  let furClump=sin(input.worldPosition.y*scale*2.10+normal.x*scale*0.40+noise*0.30)*0.5+0.5;
  base=clamp(base*(1.0-step(0.94,furClump)*furGate*0.09),vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur shaft inner tone: center of each fur strand is slightly lighter than the outer cortex — Eevee/Arcanine/Growlithe two-tone fur strand (inner hair shaft vs outer cortex creates visible depth in each strand)
  let furSoft=sin(furFlowU-noise*0.18)*0.5+0.5;
  base=clamp(base+vec3<f32>(0.06,0.04,0.02)*step(0.92,furSoft)*furGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Organic extremity warmth: warm pink-blush at thin exposed surfaces — blood close to surface on Pikachu/Eevee/Meowth ear tips
  let organicExtH=smoothstep(1.28,1.70,input.worldPosition.y);
  let organicExt=organicSkin*(earHeight*earLateral*0.52+organicExtH*0.30);
  base=clamp(base+vec3<f32>(0.22,0.06,0.04)*organicExt*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Skin vascularity warm blush gradient: blood vessels are more superficial in high-circulation zones — face/cheek has warmest blush, then the palms/soles, then torso, and limbs are coolest/palest; modeled as a Y-height-based warm tint shift on organic creatures that makes the head/face zone slightly pinker and the legs/arms slightly more neutral; Eevee's face is distinctly warmer than its paws, Pikachu's cheeks are the warmest on its body
  let vascularWarm=organicSkin*(1.0-metallic)*smoothstep(0.24,0.04,roughness)*0.14;
  let vascFaceZone=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY+crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.80,crownEyeY+crownEyeW*1.40,input.worldPosition.y))*vascularWarm;
  let vascLimbCool=smoothstep(crownEyeY-crownEyeW*1.80,crownEyeY-crownEyeW*2.80,input.worldPosition.y)*vascularWarm*0.40;
  base=clamp(base+vec3<f32>(0.08,0.02,0.01)*vascFaceZone-vec3<f32>(0.02,0.02,0.01)*vascLimbCool,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neutral warm cream belly coat: low-saturation organic creatures have warm pale cream on the ventral/chest surface — Eevee cream chest patch, Snorlax pale front, Meowth cream neck, Jigglypuff flush belly
  let creamBelly=organicSkin*clamp((0.48-normal.y)/0.56,0.0,1.0)*smoothstep(0.16,0.46,normal.z);
  base=clamp(base+vec3<f32>(0.14,0.09,0.04)*creamBelly*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal midline spine crease: faint darkening groove along the back centerline — Arcanine mane-ridge, Blaziken muscle midline, Typhlosion back ridge, Dragonite dorsal crest; 55% of creatures (fv 0.28-0.83)
  let dorsalMidX=smoothstep(crownEyeW*0.12,crownEyeW*0.04,abs(input.worldPosition.x));
  let dorsalUpFace=smoothstep(0.28,0.58,normal.y)*smoothstep(0.22,-0.08,abs(normal.z));
  let dorsalBodyY=smoothstep(crownEyeY-crownEyeW*2.20,crownEyeY-crownEyeW*1.0,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY+crownEyeW*0.60,input.worldPosition.y));
  base=clamp(base*(1.0-dorsalMidX*dorsalUpFace*dorsalBodyY*(1.0-msMet)*step(0.28,fv)*step(fv,0.83)*0.14),vec3<f32>(0.0),vec3<f32>(1.0));
  // Element skin-tone tint: the base body color is very faintly pushed toward the element characteristic hue — Fire bodies read very slightly warmer/orange, Water bodies read slightly cooler/blue, Shadow bodies read slightly violet; this is baked into official Pokemon creature design (Charizard's skin is warmer-toned than Blastoise's which is cooler-toned, matching their elements regardless of actual palette)
  let elemSkinTint=scene.palette2.rgb*clamp(palBright-0.24,0.0,1.0)*(1.0-msMetal)*0.04;
  base=clamp(base+elemSkinTint,vec3<f32>(0.0),vec3<f32>(1.0));
  // Surface micro-noise color vividity: noise peaks carry slightly more vivid color than valleys — surface micro-geometry interaction gives organic vibrancy (Eevee/Bulbasaur/Charizard body surface color depth vs flat uniform color)
  let microLuma=dot(base,vec3<f32>(0.299,0.587,0.114));
  let microVivid=(noise*2.0-1.0)*(1.0-msMetal)*clamp(palBright-0.28,0.0,1.0)*0.06;
  base=clamp(mix(vec3<f32>(microLuma),base,1.0+microVivid),vec3<f32>(0.0),vec3<f32>(1.0));

  // Micro-bump normal perturbation: noise gradient disturbs lighting normal for surface texture variation
  // Applied to lighting only (not base color) — simulates surface irregularity on smooth/rough non-metal (Eevee fur, Bulbasaur skin)
  let bumpStr=(1.0-msMet)*smoothstep(0.18,0.56,msRgh)*0.22;
  // Scale dome bump: each scale cell acts as a tiny convex dome — Charizard/Gyarados scales look individually raised (not flat painted)
  let scaleDome=vec3<f32>(scFractU*warmDom*0.34+wsFractU*waterScaleGate*0.40,scFractV*warmDom*0.34+wsFractV*waterScaleGate*0.40,0.0);
  // Water surface wave perturbation: blue-smooth surfaces perturb the bump normal with a frozen wave pattern — Vaporeon/Milotic liquid surface shimmer quality
  let waterWaveBlue=clamp((scene.palette2.b-scene.palette2.r)*1.5,0.0,1.0)*(1.0-msMetal)*smoothstep(0.28,0.10,msRgh);
  let wavePerturb=vec3<f32>(sin(input.worldPosition.x*scale*2.80+fv*6.28),0.0,cos(input.worldPosition.z*scale*2.50+fv*4.72))*0.06*waterWaveBlue;
  let bumpNormal=normalize(normal+vec3<f32>(dpdx(noise),dpdy(noise),0.0)*bumpStr+scaleDome*0.28+wavePerturb);

  // === 4-band cel shading — dark shadow floor for high drama ===
  let d=max(dot(bumpNormal,light),0.0);
  let e=0.013;  // tighter band edges = crisper Pokemon-style cel shadow transitions
  // 4-band cel shading: darker shadow floor; dark-palette creatures (Shadow) get wider shadow regions for drama
  let darkBoost=step(palBright,0.35)*0.08;
  let toon=0.03+smoothstep(0.10-e+darkBoost,0.10+e+darkBoost,d)*0.24+smoothstep(0.36-e,0.36+e,d)*0.26+smoothstep(0.62-e,0.62+e,d)*0.26+smoothstep(0.84-e,0.84+e,d)*0.23;

  // === Specular with palette-brightness boost ===
  let rawSpec=pow(max(dot(normal,halfVec),0.0),mix(240.0,10.0,roughness));
  let hardSpec=smoothstep(0.66,0.82,rawSpec);  // tighter window = crisper cartoon highlight
  // Roughness attenuates specular: matte Earth/Plant surfaces appear dull, smooth Water/Metal stay glossy
  let specMix=clamp((0.32+palBright*0.38+metallic*0.72)*(1.0-roughness*0.52),0.0,1.0);
  // Metal: specular shifts toward white (chrome-like); non-metal keeps element color
  let specBase=mix(scene.palette2.rgb,vec3<f32>(1.0),metallic*0.72);
  let specColor=mix(vec3<f32>(hardSpec*0.88),specBase*hardSpec*1.85,specMix);
  // Element-tinted specular hue: on organic/scale creatures, the specular highlight takes on a subtle element hue because the colored pigment layer (melanin, chromatophore) lies immediately below the clear keratin layer — light bouncing back through the keratin carries a slight color; Charizard's orange scale specular, Vaporeon's faint blue-tint specular, Leafeon's green-amber scale spec; modeled as a subtle blend toward palette2 color in the specular for non-metallic organic creatures
  let elemSpecHue=mix(specColor,clamp(specColor*0.76+specBase*0.40,vec3<f32>(0.0),vec3<f32>(1.0)),organicSkin*(1.0-metallic)*0.18);

  // === Fresnel / rim — scaled by palette brightness; metallic adds strong grazing highlight ===
  let fresnel=1.0-max(dot(normal,view),0.0);
  // Crisp toon rim: non-metal gets a clean band (Pokemon ink-style lit ring); metal gets smooth chrome gradient
  let rimGrad=pow(fresnel,2.2);
  let rimStep=smoothstep(0.58,0.72,fresnel);
  let rim=mix(rimStep,rimGrad,metallic);
  let rimStrength=0.28+palBright*0.50+metallic*0.32;
  // Metal rim shifts toward white at grazing angles (chrome edge); others keep palette tint
  let rimColor=mix(scene.palette2.rgb,vec3<f32>(1.0),metallic*0.52)*2.4;
  // Rim light vertical sky/ground gradient: the rim highlight varies vertically — upper body catches warm sky-dome edge tint, lower body catches cool ground-shadow rim; this means the rim at the crown of the head is fractionally warmer and the rim at the feet is fractionally cooler; seen in all outdoor Pokemon official art (Mewtwo rim at head is orange-warm, at feet is blue-cool); models the sky-to-ground environment gradient the creature lives in
  let rimSkyBias=smoothstep(crownEyeY-crownEyeW*0.50,crownEyeY+crownEyeW*1.20,input.worldPosition.y)*0.06;
  let rimGroundBias=smoothstep(crownEyeY+crownEyeW*0.0,crownEyeY-crownEyeW*2.80,input.worldPosition.y)*0.04;
  let rimColorGraded=rimColor+vec3<f32>(rimSkyBias*0.40,rimSkyBias*0.14,-rimSkyBias*0.20)+vec3<f32>(-rimGroundBias*0.10,rimGroundBias*0.06,rimGroundBias*0.30);

  // lightSheen: near-white bright-palette gate for Light/Air glow effects and outline narrowing — declared before outline use
  let lightSheen=clamp((min(scene.palette2.r,min(scene.palette2.g,scene.palette2.b))-0.60)*3.5,0.0,1.0)*(1.0-metallic);
  // === Silhouette darkening — crisp illustration outline; metallic gets narrower chrome edge; Shadow/dark gets bolder wider band ===
  let outlineWidth=mix(0.80,0.72,metallic);
  // Shadow/dark = wider ink-line (Gengar/Darkrai); Light/Air bright = narrower softer outline (Togekiss/Articuno ethereal edge)
  let outlineDark=step(palBright,0.36)*0.07;
  let outlineLight=lightSheen*0.06;
  let outlineStart=clamp(mix(0.64,0.57,outlineDark)-outlineLight,0.52,0.72);
  let outlineEdge=smoothstep(outlineStart,outlineWidth,fresnel);

  // === Compose body shading ===
  // Element-tinted shadows: use palette0 as shadow ambient so Fire shadows glow dark-red,
  // Water glows dark-blue, etc. Only fills when toon < 0.5 (shadow regions).
  // Dark elements (Shadow/Earth low-palBright) get deeper shadows for more dramatic presence
  let shadowAmbient=scene.palette0.rgb*mix(0.15,0.07,step(palBright,0.35));
  // Warm key light: subtle amber tint in fully-lit regions — late-afternoon studio quality (all Pokemon official renders)
  let keyWarm=smoothstep(0.52,0.84,toon);
  let keyLightColor=vec3<f32>(1.0+keyWarm*0.035,1.0+keyWarm*0.014,1.0-keyWarm*0.030);
  var lit=base*toon*keyLightColor+shadowAmbient*max(0.0,1.0-toon*2.0);
  // Element-tinted shadow fill: warm amber for Fire/Electric, cool blue for Water/Ice, deep violet for Shadow, neutral blue-purple default
  // (Pokemon painted shadow technique — shadows carry element hue, never pure black)
  let shdWarm=clamp((scene.palette2.r-scene.palette2.b-0.28)*3.5,0.0,1.0);
  let shdCool=clamp((scene.palette2.b-scene.palette2.r-0.12)*2.5,0.0,1.0);
  let shdDark=clamp((0.30-palBright)*4.5,0.0,1.0)*(1.0-metallic);
  let shdBase=mix(vec3<f32>(0.04,0.03,0.14),vec3<f32>(0.02,0.06,0.18),shdCool);
  let shdBlend=mix(mix(shdBase,vec3<f32>(0.14,0.07,0.01),shdWarm),vec3<f32>(0.06,0.01,0.18),shdDark);
  let shadowRegion=max(0.0,1.0-toon*2.4);
  lit=clamp(lit+shdBlend*shadowRegion*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Terminator line wrap light: vivid element-color glow exactly at the shadow/lit transition band — cel anime wrap light (Charizard warm edge / Vaporeon blue edge / Pikachu yellow edge)
  let termLine=smoothstep(0.28,0.36,toon)*(1.0-smoothstep(0.36,0.54,toon))*(1.0-metallic)*0.22;
  lit=clamp(lit+scene.palette2.rgb*termLine*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Terminator inner shadow band: narrow darkening band at the inner edge of the shadow transition — deepens the cel shading drama exactly like Pokemon/Digimon hand-painted shadow lines; the shadow just inside the terminator is always distinctively dark in official art
  let termShadow=smoothstep(0.10,0.20,toon)*(1.0-smoothstep(0.20,0.30,toon))*(1.0-metallic)*0.20;
  lit=lit*(1.0-termShadow*0.20);
  // Pre-shadow color desaturation: colors desaturate just before entering full shadow — at the soft terminator transition between lit and shadow, Pokemon official art shows a brief desaturation (colors briefly wash out before going dark); this matches how subtractive color mixing works in anime cell paint and is a hallmark of Gen 3+ quality
  let preShadowZone=smoothstep(0.20,0.30,toon)*(1.0-smoothstep(0.30,0.42,toon))*(1.0-metallic);
  let preShadowLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=mix(lit,mix(vec3<f32>(preShadowLuma),lit,0.62),preShadowZone*0.28);
  // Genshin-style outer shadow: second harder cel band just inside the main shadow, slightly darker and shifted in hue — this is the technique that creates the "depth within shadow" visible in Genshin Impact and modern Pokemon renders; standard shadows have one band but professional anime cel shading uses a second inner band with a subtly different color
  let outerShadow=smoothstep(0.04,0.10,toon)*(1.0-smoothstep(0.10,0.20,toon))*(1.0-metallic);
  let outerShadowHue=mix(scene.palette0.rgb*0.72,vec3<f32>(0.04,0.04,0.12),clamp((0.38-palBright)*3.0,0.0,1.0));
  lit=mix(lit,clamp(lit*0.62+outerShadowHue*0.22,vec3<f32>(0.0),vec3<f32>(1.0)),outerShadow*0.36);
  // Element shadow ambient tint: dark-side fill light takes on element temperature — Fire/Dragon shadows read amber-warm, Water/Ice shadows read cool blue-violet; this is why Charizard's shadow reads orange and Vaporeon's reads blue-purple in official renders; each element has a recognizable shadow color
  let elemShadowFill=smoothstep(0.22,0.0,toon)*(1.0-metallic)*0.06;
  let warmShadTint=vec3<f32>(0.54,0.22,0.04)*warmDom;
  let coolShadTint=vec3<f32>(0.04,0.14,0.44)*clamp((scene.palette2.b-scene.palette2.r-0.12)*3.0,0.0,1.0);
  lit=clamp(lit+(warmShadTint+coolShadTint)*elemShadowFill,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow zone subtle noise variation: faint randomized brightness variation in the fully shadowed region — simulates hand-painted shadow texture in Pokemon/Digimon art where shadow areas have micro-variation to prevent dead flat fills; the shadow zone is never a pure flat color in quality animation art
  let shadowNoiseCell=floor(input.worldPosition*scale*9.0);
  let shadowNoise=(fract(sin(dot(shadowNoiseCell,vec3<f32>(127.1,311.7,74.7)))*43758.545)-0.50)*0.10;
  let shadowNoiseStr=smoothstep(0.18,0.0,toon)*(1.0-metallic);
  lit=clamp(lit*(1.0+shadowNoise*shadowNoiseStr),vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-specific shadow texture: beyond generic noise, each element type has a characteristic shadow variation pattern — Fire: warm ripple noise (heat shimmer), Water: wave-pattern shadow (dappled light through water), Electric: angular crack noise (charge lines); this is a signature element-identity quality marker
  let elemShadowZone=smoothstep(0.14,0.0,toon)*(1.0-metallic);
  let fireRipple=sin(input.worldPosition.y*scale*4.20+input.worldPosition.x*scale*2.80+fv*3.14)*0.5+0.5;
  let waterWave2=sin(input.worldPosition.x*scale*3.60+input.worldPosition.z*scale*2.40+fv*2.72)*0.5+0.5;
  let elecCrack=step(0.90,fract(sin(dot(floor(input.worldPosition*scale*2.40),vec3<f32>(127.1,311.7,74.7)))*43758.545));
  let elemShadTex=mix(mix(fireRipple*0.08*warmDom,waterWave2*0.06*clamp((scene.palette2.b-scene.palette2.r-0.18)*3.0,0.0,1.0),clamp(scene.palette2.b-scene.palette2.r,0.0,1.0)),elecCrack*0.06*elecChargeGate,elecChargeGate*0.60);
  lit=clamp(lit+scene.palette2.rgb*elemShadTex*elemShadowZone,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular shadow mask: specular is attenuated in shadow regions — confirmed Genshin Impact technique; in shadow areas the specular contribution is reduced to prevent "specular in shadow" which looks CG and non-painted (official Pokemon renders never show a specular dot in the dark shadow zone)
  let specShadowMask=clamp(toon*2.8,0.0,1.0);
  // Nape sagittal fur/mane ridge highlight: the central raised dorsal ridge from the top of the skull to between the shoulder blades catches overhead direct light as a bright stripe down the midline — Arcanine's iconic mane ridge, Jolteon's electric spiky ridge, Vaporeon's dorsal fin line, Eevee's neck ruff midline all show this bright sagittal stripe in overhead lighting; it's what makes the creature's back look sculpted rather than a smooth dome
  let napeRidgeX=smoothstep(crownEyeW*0.12,crownEyeW*0.02,abs(input.worldPosition.x));
  let napeRidgeY=smoothstep(crownEyeY-crownEyeW*0.20,crownEyeY+crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.80,crownEyeY+crownEyeW*1.40,input.worldPosition.y));
  let napeRidgeFace=smoothstep(0.42,0.68,normal.y)*smoothstep(0.10,-0.10,abs(normal.z))*(1.0-metallic)*organicSkin*smoothstep(0.44,0.66,toon)*specShadowMask;
  let napeRidgeSpec=pow(max(dot(normal,halfVec),0.0),16.0)*napeRidgeX*napeRidgeY*napeRidgeFace;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*napeRidgeSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular occlusion proxy: surfaces facing away from the key light direction are in self-shadow and their specular should receive an additional attenuation — prevents the specular lobe from bleeding into shadow-facing surfaces; computed as a geometry-aware NdotL proxy applied before spec composite (Genshin + all PBR renderers do this)
  let specOccProxy=clamp(dot(normal,lightDir)*2.4+0.28,0.0,1.0);
  lit+=mix(elemSpecHue,base*hardSpec*2.0,metallic)*0.70*specShadowMask*specOccProxy;
  // Bilateral SSS terminator glow: the Genshin Impact SSS technique — element-hue glows on BOTH sides of the cel shadow terminator, not just the lit side; this bilateral warmth is the characteristic "alive" quality of miHoYo and Game Freak skin shaders (the terminator line between lit and dark is always warm/colored, never purely cold or neutral)
  let bilateralSSSWidth=smoothstep(0.15,0.28,toon)*(1.0-smoothstep(0.28,0.50,toon));
  let bilateralSSSColor=mix(vec3<f32>(0.62,0.22,0.08)*warmDom,scene.palette2.rgb*0.60,clamp(1.0-warmDom*1.8,0.0,1.0));
  lit=clamp(lit+bilateralSSSColor*bilateralSSSWidth*(1.0-metallic)*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ambient fill specular: a gentle wide specular from the fill light direction — fills in the subtle highlight on the shadow side of the creature suggesting a large soft environment fill source; prevents fill-side from being completely dead; Genshin Impact and Pokemon S/S use a broad ambient fill specular that wraps the entire shadow hemisphere
  let ambFillDir=normalize(vec3<f32>(0.62,-0.38,-0.58));
  let ambFillH=normalize(ambFillDir+view);
  let ambFillSpec=pow(max(dot(normal,ambFillH),0.0),8.0)*(1.0-metallic)*smoothstep(0.06,0.28,toon)*smoothstep(0.44,0.26,toon)*0.10;
  lit=clamp(lit+mix(vec3<f32>(0.60,0.70,0.88),scene.palette2.rgb*0.60,0.30)*ambFillSpec,vec3<f32>(0.0),vec3<f32>(1.0));
  // Secondary fill light specular: a second, dimmer specular lobe from the fill light direction (left-rear) — all professional creature renders use at least a two-light setup; the fill specular is cooler, dimmer, and broader than the key; creates the "other side" shine seen on Mewtwo/Charizard/Lucario renders
  let fillLightDir=normalize(vec3<f32>(-0.58,0.28,0.62));
  let fillHalfVec=normalize(fillLightDir+view);
  let fillSpecD=pow(max(dot(normal,fillHalfVec),0.0),mix(80.0,6.0,roughness))*(1.0-roughness*0.72)*(1.0-metallic);
  let fillSpecStr=smoothstep(0.34,0.56,toon)*0.14;
  lit=clamp(lit+vec3<f32>(0.72,0.80,1.0)*fillSpecD*fillSpecStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Calf posterior roundness fill: the gastrocnemius (calf) is a round posterior muscle below the knee — it catches secondary fill light from behind-left, creating a subtle bright region on the back of the lower leg; Lucario, Blaziken, Mewtwo show this rounded calf fill that makes legs look muscularly three-dimensional rather than flat; posterior-facing lower leg at shin Y
  let calfZone=smoothstep(shinRidgeY-crownEyeW*0.60,shinRidgeY-crownEyeW*0.0,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY,shinRidgeY+crownEyeW*0.60,input.worldPosition.y));
  let calfLat=smoothstep(crownEyeW*0.68,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let calfBack=smoothstep(-0.20,-0.58,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.24,0.50,toon);
  let calfFillSpec=pow(max(dot(normal,fillHalfVec),0.0),16.0)*calfZone*calfLat*calfBack;
  lit=clamp(lit+vec3<f32>(0.66,0.76,0.92)*calfFillSpec*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Back-rim fill rim: posterior-facing surfaces (back-facing, away from key light) catch a cool fill from behind-right — standard three-point rig back rim light that creates the separation between creature and background; cooler than the key rim and only on clearly back-facing surfaces; makes creatures pop off the background by brightening the back silhouette
  let backRimDir=normalize(vec3<f32>(0.44,0.18,-0.80));
  let backRimH=normalize(backRimDir+view);
  let backRimFace=smoothstep(-0.20,-0.60,normal.z)*smoothstep(0.28,0.52,abs(normal.x)+abs(normal.y)*0.40)*(1.0-metallic);
  let backRimSpec=pow(max(dot(normal,backRimH),0.0),12.0)*smoothstep(0.24,0.50,toon)*backRimFace;
  lit=clamp(lit+mix(vec3<f32>(0.56,0.72,1.0),scene.palette2.rgb*0.40+vec3<f32>(0.60),0.25)*backRimSpec*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Bony/scale hard surface specular: non-organic high-roughness surfaces (beak, horn, claw shafts, thick scale edges) have a distinct tight specular with less SSS — bone and keratin surface quality (Charizard horn glint, Mewtwo brow ridge, Blaziken claw shaft)
  let bonySpec=warmDom*smoothstep(0.36,0.58,roughness)*smoothstep(0.68,0.56,roughness)*(1.0-metallic)*pow(max(dot(normal,halfVec),0.0),160.0)*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.86,0.82,0.72)*bonySpec*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Battle wear scuff marks: on the tips of horns, ridges of armor plates, and bony protrusions, high-contact battle damage leaves lighter wear zones — Mewtwo's bone-point tips, Aerodactyl's wing claw, Charizard's horn tips; worn pale by repeated impact; subtle lighter tone at geometry extremities gated by high-roughness hard surfaces
  let wearScuffGate=warmDom*smoothstep(0.52,0.72,roughness)*(1.0-metallic)*0.30;
  let wearTipZone=smoothstep(crownEyeY+crownEyeW*2.0,crownEyeY+crownEyeW*4.0,input.worldPosition.y)*spineX;
  let wearLateral=smoothstep(1.30,1.70,abs(input.worldPosition.x))*smoothstep(-0.10,0.20,normal.y);
  let wearGate=(wearTipZone+wearLateral*0.50)*wearScuffGate;
  let wearLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(lit,mix(vec3<f32>(wearLuma),lit*1.15,0.60),clamp(wearGate,0.0,1.0)*0.20),vec3<f32>(0.0),vec3<f32>(1.0));
  // Armor plate gloss hardening: back/dorsal flat-polygon armor segments (Metagross chest plate, Aggron back plates, Bastiodon brow plate) are smoother and harder than adjacent body skin — each plate reads as a distinct tighter specular lobe; detected as posterior-facing upward normals at mid-roughness
  let armorPlateGate=smoothstep(0.36,0.56,roughness)*smoothstep(0.60,0.48,roughness)*metallic*smoothstep(0.48,0.72,normal.y);
  let armorPlateSpec=pow(max(dot(normal,halfVec),0.0),220.0)*armorPlateGate*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.80,0.84,0.90)*armorPlateSpec*0.38,vec3<f32>(0.0),vec3<f32>(1.0));
  // Chest plate concave fill: where the chest plate curves inward (concave sternum region of Metal/Armor types), it catches fill light from the floor and the opposite chest side — Metagross/Steelix/Scizor chest concavity; computed as the region where the normal faces upward-inward and y is in chest range, with a cooler fill light contribution
  let chestConcaveGate=metallic*smoothstep(0.36,0.56,roughness)*smoothstep(crownEyeY-crownEyeW*0.20,crownEyeY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.60,crownEyeY+crownEyeW*1.10,input.worldPosition.y));
  let chestConcaveFill=smoothstep(-0.10,0.30,normal.y)*smoothstep(0.42,0.20,normal.z)*smoothstep(0.16,0.36,abs(normal.x))*0.20;
  lit=clamp(lit+scene.palette0.rgb*0.60*chestConcaveFill*chestConcaveGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sharp specular dot: crisp cartoon single-point highlight on smooth surfaces (Pokemon high-gloss shine)
  // Only fires at absolute peak of specular lobe; roughness-gated so matte surfaces stay dull
  let sharpDot=step(0.90,rawSpec)*clamp((0.35-roughness)/0.35,0.0,1.0);
  let sharpDotStr=mix(0.62,1.18,clamp((0.22-roughness)/0.22,0.0,1.0));
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*sharpDot*sharpDotStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular bloom halo: soft glow ring around the sharp spec dot — "glass" specular quality of Pokemon 3DS/Switch renders
  let specHalo=pow(max(dot(normal,halfVec),0.0),14.0)*clamp((0.54-roughness)/0.54,0.0,1.0)*(1.0-metallic)*0.30;
  lit=clamp(lit+vec3<f32>(0.98,0.99,1.0)*specHalo,vec3<f32>(0.0),vec3<f32>(1.0));
  // High-spec surface micro-shimmer: on the very smoothest surfaces (low roughness), a faint high-frequency spatial sparkle from micro-facets catches the key light at individual pixels — the difference between a dull smooth surface and a polished gemstone surface is this micro-scale sparkle field; used in Genshin Impact's weapon materials and Pokemon's shell/crystal materials; gate on specular peak and very low roughness
  let microShimGate=smoothstep(0.12,0.0,roughness)*(1.0-metallic)*clamp(palBright-0.26,0.0,1.0)*specShadowMask;
  let microShimCell=floor(input.worldPosition*scale*22.0+vec3<f32>(fv*13.0,fv*9.0,fv*7.0));
  let microShimH=fract(sin(dot(microShimCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let microShimNH=fract(sin(dot(microShimCell+vec3<f32>(0.3,0.7,0.5),vec3<f32>(311.7,74.7,127.1)))*43758.545);
  let microShimFire=step(0.96,microShimH)*step(0.60,microShimNH)*microShimGate*smoothstep(0.72,0.90,rawSpec);
  lit=clamp(lit+vec3<f32>(0.98,0.96,0.92)*microShimFire*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular Fresnel element tint: specular highlight tints toward element color at oblique angles — non-metal creatures (Eevee/Vaporeon/Charizard) show element hue in specular at mid-grazing angles (Fire catches orange-gold, Water blue-teal)
  let specFresnelTint=smoothstep(0.30,0.68,fresnel)*(1.0-metallic)*clamp((palBright-0.32)/0.38,0.0,1.0)*0.12;
  lit=clamp(lit+scene.palette2.rgb*specFresnelTint*smoothstep(0.40,0.68,rawSpec),vec3<f32>(0.0),vec3<f32>(1.0));
  // Metallic anisotropic: brushed-metal highlight stretches horizontally — Metagross/Aggron/Scizor chrome
  let anisoStretch=clamp(abs(dot(halfVec,vec3<f32>(1.0,0.0,0.0)))*2.8-1.0,0.0,1.0);
  let anisoHigh=pow(max(dot(normal,halfVec),0.0),mix(64.0,10.0,anisoStretch));
  lit=clamp(lit+mix(base,vec3<f32>(1.0),0.70)*anisoHigh*metallic*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal plate edge glint: armor seam edges catch a secondary directional specular (Metagross/Aggron chrome joint lines)
  let plateEdgeGlint=plateRidge*metalSeamGate*rawSpec*0.72;
  lit=clamp(lit+vec3<f32>(0.88,0.94,1.0)*plateEdgeGlint,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal plasma channeling: armor groove seams emit element-colored energy plasma — conduit lines on chrome armor (WarGreymon/Metagross/Aegislash energy conduits)
  let plasmaGlow=plateGroove*metallic*clamp((palBright-0.22)/0.40,0.0,1.0)*0.22;
  lit=clamp(lit+scene.palette2.rgb*1.18*plasmaGlow,vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth mineral facet glint: rock fissure ridges catch a warm pale specular — light bouncing off quartz/mica faces (Onix/Boldore/Geodude)
  let rockFacetSpec=smoothstep(0.74,0.88,msHash)*msRock*rawSpec*0.56;
  lit=clamp(lit+vec3<f32>(0.84,0.80,0.70)*rockFacetSpec,vec3<f32>(0.0),vec3<f32>(1.0));
  // Stone/rock subsurface moss tint: upward-facing rock surfaces of Plant+Rock combined creatures accumulate green-grey lichen moss in their crevices — Golem has green moss tinting on upward faces; this is also the wet-rock green tint; gate on msRock + green-tinted palette
  let mossTintGate=msRock*clamp((scene.palette2.g-scene.palette2.r*0.80-scene.palette2.b*0.60+0.04)*2.5,0.0,1.0)*(1.0-metallic)*smoothstep(0.40,0.68,normal.y);
  lit=clamp(lit+vec3<f32>(0.18,0.32,0.06)*mossTintGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth crystal gem points: isolated bright gem-sparkle flashes — quartz/emerald/ruby crystal catches in Boldore/Geodude/Sableye
  let crystalGem=step(0.96,msHash)*msRock*step(0.90,rawSpec);
  let crystalColor=mix(vec3<f32>(1.0,0.96,0.82),clamp(scene.palette2.rgb*1.30,vec3<f32>(0.0),vec3<f32>(1.0)),clamp((1.0-palBright)*1.5,0.0,1.0));
  lit=clamp(lit+crystalColor*crystalGem*1.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal surface polish striations: fine axial scratch lines on polished metal — Metagross/Aggron/Scizor precision machined surface
  let polishScratchGate=metallic*smoothstep(0.50,0.76,metallic)*(1.0-roughness)*0.48;
  let scrDir1=input.worldPosition.x*scale*14.0+input.worldPosition.y*scale*2.8+fv*11.0;
  let scrDir2=input.worldPosition.z*scale*11.0+input.worldPosition.y*scale*1.6+fv*7.0;
  let scrLine=max(step(0.94,fract(sin(floor(scrDir1)*87.45)*43758.545)),step(0.95,fract(sin(floor(scrDir2)*63.29)*43758.545)))*polishScratchGate;
  lit=clamp(lit+vec3<f32>(0.94,0.96,1.0)*scrLine*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal environment reflection: fake two-point probe — cool sky on upward faces, warm earth on underside (Steelix/Metagross chrome)
  let metalProbe=metallic*smoothstep(0.50,0.86,metallic)*(1.0-roughness);
  let metalSkyFace=smoothstep(0.32,0.62,normal.y)*metalProbe;
  let metalGndFace=smoothstep(-0.38,-0.66,normal.y)*metalProbe;
  lit=clamp(lit+vec3<f32>(0.38,0.50,0.66)*metalSkyFace*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  lit=clamp(lit+vec3<f32>(0.54,0.40,0.22)*metalGndFace*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Thin-film optical interference: extremely smooth high-metallic surfaces produce rainbow color banding from thin-film interference (like a petrol spill or tempered steel) — Metagross' body plates, Scizor's carapace, Aegislash's blade show subtle rainbow patterning at different angles; controlled by view angle to normal (dot product phase); low amplitude (3%) to stay subtle
  let thinFilmGate=metallic*smoothstep(0.86,1.0,metallic)*smoothstep(0.18,0.0,roughness)*smoothstep(0.28,0.52,toon);
  let thinFilmPhase=dot(normal,view)*6.28+fv*3.14;
  let thinFilmColor=vec3<f32>(sin(thinFilmPhase)*0.5+0.5,sin(thinFilmPhase+2.094)*0.5+0.5,sin(thinFilmPhase+4.189)*0.5+0.5);
  lit=clamp(lit+thinFilmColor*thinFilmGate*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal iridescent oil-film: view-angle thin-film interference color shift at grazing angles on polished metal (Metagross/Steelix/Magnezone rainbow chrome)
  let filmPhase=fresnel*4.20+normal.y*1.80+fv*3.14;
  let filmColor=vec3<f32>(sin(filmPhase)*0.5+0.5,sin(filmPhase+2.094)*0.5+0.5,sin(filmPhase+4.189)*0.5+0.5);
  let filmStr=metallic*smoothstep(0.12,0.38,fresnel)*smoothstep(0.62,0.84,metallic)*(1.0-roughness);
  lit=clamp(lit+filmColor*filmStr*0.09,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal micro-glint sparkles: tiny high-specular dots scattered across polished metal — Metagross/Steelix/Aegislash surface glint under light (each cell has perturbed normal producing a discrete specular flash)
  let mspkGate=metallic*smoothstep(0.50,0.76,metallic)*(1.0-roughness)*0.52;
  let mspkCell=floor(input.worldPosition*scale*9.20);
  let mspkH=fract(sin(dot(mspkCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let mspkNormal=normalize(normal+vec3<f32>(mspkH*2.0-1.0,fract(mspkH*7.3)*2.0-1.0,0.0)*0.24);
  let mspkSpec=step(0.95,pow(max(dot(mspkNormal,halfVec),0.0),220.0))*step(0.80,mspkH)*mspkGate;
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*mspkSpec*0.88,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metal resonance rings: faint concentric interference rings on polished chrome from near-normal to grazing view (Metagross/Aegislash radar-ping chrome)
  let resonR=length(input.worldPosition.xz)*scale*3.20+input.worldPosition.y*scale*0.44;
  let resonRing=sin(resonR+fv*6.28)*0.5+0.5;
  let resonStr=metallic*smoothstep(0.55,0.80,metallic)*(1.0-roughness)*smoothstep(0.08,0.32,fresnel)*0.055;
  lit=clamp(lit+vec3<f32>(0.82,0.88,1.0)*smoothstep(0.78,0.92,resonRing)*resonStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Soft specular halo: smooth/wet non-metal surfaces get a broader glow around the specular peak (Vaporeon pearl)
  let softSpec=smoothstep(0.38,0.66,rawSpec)*(1.0-roughness)*(1.0-metallic)*0.12;
  lit=clamp(lit+mix(scene.palette2.rgb,vec3<f32>(1.0),0.58)*softSpec,vec3<f32>(0.0),vec3<f32>(1.0));
  // Satin body highlight: very smooth non-metallic surfaces carry a wide diffuse directional bloom — ceramic/porcelain creature quality (Mewtwo/Togekiss/Mew satin finish)
  let satinGate=(1.0-roughness)*(1.0-roughness)*(1.0-metallic)*clamp(palBright-0.36,0.0,1.0)*0.16;
  let satinD=max(dot(normal,halfVec),0.0);
  lit=clamp(lit+vec3<f32>(1.0,0.99,0.97)*pow(satinD,8.0)*satinGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Smooth ceramic subsurface glow: very smooth non-metal surfaces emit faint element-hue subsurface radiance in the directional lit zone — ceramic/satin skin light diffusion quality; makes Mewtwo/Gardevoir/Milotic/Eevee smooth body read as "luminous from within" rather than a dull opaque surface
  let ceramicSSSGate=(1.0-roughness)*(1.0-roughness)*(1.0-metallic)*clamp(palBright-0.30,0.0,1.0)*0.06;
  lit=clamp(lit+scene.palette2.rgb*pow(max(dot(normal,halfVec),0.0),5.0)*ceramicSSSGate*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lit zone surface micro-grain: very fine random brightness variation in fully illuminated areas — physical surfaces under strong light show micro-texture that distinguishes them from perfectly smooth CG; most visible on rough organic surfaces (Snorlax/Golem belly, Charizard underbelly); adds realism without pattern repetition
  let microGrainCell=floor(input.worldPosition*scale*16.0);
  let microGrainH=(fract(sin(dot(microGrainCell,vec3<f32>(127.1,311.7,74.7)))*43758.545)-0.50)*0.06;
  let microGrainStr=smoothstep(0.60,0.84,toon)*(1.0-metallic)*(roughness*0.44+0.20);
  lit=clamp(lit*(1.0+microGrainH*microGrainStr),vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-specific surface micro-noise on lit surfaces: each element type has a characteristic sub-pixel surface texture modulation that appears on the lit side; Fire/Dragon skin has a thermal shimmer ripple (different from shadow ripple — this is on the LIT side and has warm orange-amber hue variation); Water has a gentle prismatic interference shimmer; Earth/Plant has cell-noise pigment variation; these micro-textures are visible in close-up renders of Charizard scales, Vaporeon skin, Leafeon bark texture; they make the lit surface feel physically real rather than uniformly colored
  let fireShimCell=floor(input.worldPosition*scale*8.20);
  let fireShimH=fract(sin(dot(fireShimCell,vec3<f32>(17.1,83.7,41.7)))*27831.5)*2.0-1.0;
  let fireShim=fireShimH*warmDom*smoothstep(0.58,0.80,toon)*(1.0-metallic)*0.08;
  let waterShimH=sin(input.worldPosition.x*scale*9.40+input.worldPosition.z*scale*6.80+fv*4.32)*sin(input.worldPosition.y*scale*7.10+fv*3.17);
  let waterShim=waterShimH*blueSheen*smoothstep(0.56,0.78,toon)*(1.0-metallic)*0.06;
  let earthCell=floor(input.worldPosition*scale*5.80);
  let earthShimH=fract(sin(dot(earthCell,vec3<f32>(91.3,173.7,59.3)))*31728.4)*2.0-1.0;
  let earthShim=earthShimH*earthDom*smoothstep(0.54,0.76,toon)*(1.0-metallic)*0.07;
  lit=clamp(lit+vec3<f32>(0.40,0.16,0.0)*fireShim+vec3<f32>(-0.04,0.04,0.12)*waterShim+vec3<f32>(0.12,0.08,-0.04)*earthShim,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal ridge specular: smooth back-spine surface catches an extra narrow highlight (Gyarados/Arcanine/Dragonite dorsal gleam)
  let dorsalSpec2Gate=smoothstep(0.46,0.76,normal.y)*smoothstep(0.30,0.08,abs(normal.x))*(1.0-roughness*0.70);
  let dorsalSpec2=pow(max(dot(normal,halfVec),0.0),280.0)*dorsalSpec2Gate;
  lit=clamp(lit+vec3<f32>(0.94,0.97,1.0)*dorsalSpec2*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice crystal micro-facets: cool bright surfaces show tiny tilted specular flecks (Glaceon/Articuno/Froslass crystal facets)
  let iceFacetGate=clamp(palBright-0.52,0.0,1.0)*clamp((scene.palette2.b+scene.palette2.g*0.5-scene.palette2.r*1.5-0.22)*3.5,0.0,1.0)*smoothstep(0.28,0.06,roughness)*(1.0-metallic);
  let facetCell=floor(input.worldPosition*scale*3.60);
  let facetHash=fract(sin(dot(facetCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let facetTilt=vec3<f32>(facetHash-0.5,fract(facetHash*3.73+0.33)-0.5,0.82);
  let facetNorm=normalize(facetTilt);
  let facetSpec=pow(max(dot(facetNorm,halfVec),0.0),160.0)*iceFacetGate;
  lit=clamp(lit+vec3<f32>(0.88,0.94,1.0)*facetSpec*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crystal prism refraction streaks: angled light bands through Ice/Light crystals (Starmie prism / Suicune aurora / Froslass shimmer)
  let crystalRefractGate=smoothstep(0.26,0.06,roughness)*(1.0-metallic)*clamp((scene.palette2.b+scene.palette2.g*0.5-scene.palette2.r*1.5-0.15)*4.0,0.0,1.0)*clamp(palBright-0.35,0.0,1.0);
  let crystalStripe=sin(input.worldPosition.x*scale*2.80+input.worldPosition.z*scale*1.20)*0.5+0.5;
  let crystalRefract=smoothstep(0.76,0.94,crystalStripe)*crystalRefractGate;
  lit=clamp(lit+vec3<f32>(0.90,0.96,1.0)*crystalRefract*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-tinted specular peak: vivid non-metal element palettes color their specular highlights — Fire specular is warm-orange, Water is aqua-blue, Electric is golden-yellow, Plant is green-yellow; not pure white (only pale/neutral elements have near-white spec); this is the "signature highlight color" that makes each type's lighting read distinctly
  let elemSpecZone=smoothstep(0.62,0.86,rawSpec)*(1.0-metallic)*clamp((palBright-0.40)/0.32,0.0,1.0)*0.09;
  lit=clamp(lit+scene.palette2.rgb*elemSpecZone,vec3<f32>(0.0),vec3<f32>(1.0));
  // Claw/talon tip specular: the very tips of claws and toes (worldPosition.y near ground, forward-facing) catch a tiny bright specular from hard keratin — Eevee/Pikachu/Lucario/Blaziken sharp claw tip glint; keratin is harder and smoother than surrounding skin so it catches tighter specular
  let clawTipSpec=clawTip*(1.0-metallic)*pow(max(dot(normal,halfVec),0.0),120.0)*0.70;
  lit=clamp(lit+vec3<f32>(0.94,0.96,1.0)*clawTipSpec*0.66,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dragon/Reptile scale iridescent specular: warm-moderate-rough scale surfaces produce chromatic iridescence at mid-angle specular — Dragonite amber-green flash, Salamence blue-red shimmer, Flygon emerald highlight; critical quality differentiator for reptile/dragon types
  let dragonIridGate=warmDom*(1.0-metallic)*0.55;
  let dragonIridPhase=dot(halfVec,bumpNormal)*4.20+normal.y*1.40+fv*3.14;
  let dragonIrid=vec3<f32>(sin(dragonIridPhase)*0.5+0.5,sin(dragonIridPhase+2.094)*0.5+0.5,sin(dragonIridPhase+4.189)*0.5+0.5);
  let dragonIridSpec=smoothstep(0.18,0.58,rawSpec)*dragonIridGate;
  lit=clamp(lit+dragonIrid*dragonIridSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale upper-edge rim highlight: thin bright specular line along the top lit edge of each reptile scale — Charizard/Dragonite/Salamence scale highlight technique; scale edges catch direct light for "individually raised" scale appearance
  let scaleTopEdge=smoothstep(0.44,0.48,scFractV+0.50)*(1.0-smoothstep(0.48,0.50,scFractV+0.50))*warmDom*smoothstep(0.50,0.72,toon);
  lit=clamp(lit+vec3<f32>(0.92,0.94,0.98)*scaleTopEdge*rawSpec*0.56,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale cell-center specular: each individual scale catches a tight bright highlight at its center, reading each scale as a separate raised panel catching direct light — Dragonite/Salamence/Flygon scale count visible; more convincing than broad sheen alone
  let scaleCellSpec=smoothstep(0.44,0.18,max(abs(scFractU),abs(scFractV)))*warmDom*smoothstep(0.60,0.82,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.97,1.0)*scaleCellSpec*rawSpec*0.40,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale edge micro-specular: the very raised edge (rim) between adjacent scales catches the sharpest most brilliant specular — in Charizard/Garchomp/Flygon renders there is a crisp bright hairline along each scale edge that's brighter even than the scale center; produced by the peak of the scale rim geometry
  let scaleEdgeMicro=smoothstep(0.46,0.50,max(abs(scFractU),abs(scFractV)))*warmDom*smoothstep(0.64,0.84,toon)*smoothstep(0.22,0.06,roughness);
  lit=clamp(lit+vec3<f32>(0.98,0.96,0.90)*scaleEdgeMicro*rawSpec*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire/Electric body heat: warm energy types show inner glow on bright lit surfaces (ember warmth)
  let fireGlow=clamp((scene.palette2.r-scene.palette2.b-0.30)*2.0,0.0,1.0)*(1.0-metallic);
  let heatFill=smoothstep(0.52,0.86,toon)*fireGlow;
  lit=clamp(lit+scene.palette2.rgb*heatFill*0.09,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire shadow-side inner warmth: dark shadowed regions of fire creatures show dim amber subsurface warmth — ember glow within (Magmar/Typhlosion/Arcanine)
  let fireShadowWarm=fireGlow*smoothstep(0.28,0.08,toon)*0.14;
  lit=clamp(lit+vec3<f32>(0.90,0.36,0.04)*fireShadowWarm,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire crown upward convection: hot gas rising above a fire creature warms the crown of the head — Charizard's fire-breather head, Typhlosion's volcano crown, Magmar head glow; the top of a fire creature's head receives upward warm convection fill from its own element, independent of the key light direction
  let fireCrownGate=fireGlow*smoothstep(crownEyeY+crownEyeW*0.20,crownEyeY+crownEyeW*1.40,input.worldPosition.y)*smoothstep(0.44,0.22,roughness);
  let fireCrownUpface=smoothstep(0.28,0.58,normal.y)*(1.0-metallic)*smoothstep(0.22,0.44,toon);
  lit=clamp(lit+vec3<f32>(0.98,0.64,0.14)*fireCrownGate*fireCrownUpface*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Back plate subsurface heat gradient: the dorsal spine plates of Fire creatures (Charizard/Arcanine/Rapidash) are slightly warmer on their upper surfaces from residual body heat that concentrates at the dorsal fin bases — visible as a warm amber glow on the upper surface of spine/fin protrusions and the back between them; distinct from direct fireGlow which is element-color; this is the secondary thermal signature
  let backHeatGate=fireGlow*spineY*smoothstep(0.38,0.64,normal.y)*(1.0-metallic)*smoothstep(0.30,0.54,toon)*0.36;
  lit=clamp(lit+vec3<f32>(0.56,0.18,0.02)*backHeatGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tail base flame scorch: charred warm-dark zone at body-to-tail-tip junction on fire creatures (Charmander/Charizard flame base darkening)
  if (scene.tailTip.w > 0.0) {
    let scorch=smoothstep(scene.tailTip.w*1.8,scene.tailTip.w*0.6,tipDist)*fireGlow;
    lit=clamp(lit*(1.0-scorch*0.20),vec3<f32>(0.0),vec3<f32>(1.0));
  }
  // Dragon scale iridescence: warm-dominant scaled surfaces shift amber-to-teal at grazing angles — Charizard/Dragonite/Salamence scale shimmer
  let dragonIriStr=warmDom*(1.0-metallic)*smoothstep(0.18,0.44,fresnel)*smoothstep(0.32,0.58,roughness);
  let dragonPhase=fresnel*3.50+normal.y*1.20;
  let dragonIriColor=mix(vec3<f32>(0.94,0.68,0.22),vec3<f32>(0.22,0.70,0.52),sin(dragonPhase)*0.5+0.5);
  lit=clamp(lit+dragonIriColor*dragonIriStr*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant bioluminescent spores: scattered yellow-green emission points on smooth green surfaces (Amoonguss spore caps / Bulbasaur bulb glow / Shaymin pollen)
  let plantGlowGate=plantDom*smoothstep(0.42,0.16,msRgh)*0.50;
  let sporeCell=floor(input.worldPosition*scale*5.20);
  let sporeH=fract(sin(dot(sporeCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let sporeDot=smoothstep(0.93,0.95,sporeH)*plantGlowGate;
  lit=clamp(lit+vec3<f32>(0.58,0.92,0.12)*sporeDot*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  lit+=rimColorGraded*rim*rimStrength;
  // Diffuse wrap light: organic skin and smooth surfaces let some key light "wrap" slightly into the shadow zone — in all official Pokemon art, the transition from lit to shadow is never perfectly abrupt; there's a soft wrap region where you can still see skin color before going fully dark (standard anime/cartoon lighting using "half-Lambert" wrap); especially visible on round heads, bellies, and shoulders
  let diffuseWrap=smoothstep(0.0,0.24,toon)*smoothstep(0.28,0.12,toon)*organicSkin*0.22;
  lit=clamp(lit+scene.palette1.rgb*diffuseWrap*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Vertical rim gradient: rim light is stronger at the top of the body and fades toward feet — top-lit studio lighting setup used in all Pokemon/Digimon official renders; the key light comes from above, so the rim is brightest at the crown and shoulders and fades to near-zero at feet
  let vertRimGrad=clamp((input.worldPosition.y-crownEyeY*0.2)/(crownEyeY*1.8),0.0,1.0);
  let rimVertStr=rim*rimStrength*smoothstep(0.0,0.5,vertRimGrad)*0.20;
  lit=clamp(lit+rimColorGraded*rimVertStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-specific rim hue shift: the rim light takes on a strong element-characteristic tint beyond just palette2 — Fire gets warm amber, Water gets cyan-cool, Electric gets yellow-white, Shadow gets violet-blue, Ice gets pale cyan, Earth gets russet; this element rim tint is what makes each Pokemon's silhouette instantly recognizable (Charizard orange rim vs Vaporeon cyan rim vs Gengar violet rim)
  let rimElemTint=mix(mix(mix(vec3<f32>(1.0,0.82,0.40),vec3<f32>(0.40,0.82,1.0),clamp((scene.palette2.b-warmDom)*2.0,0.0,1.0)),vec3<f32>(0.96,0.98,0.44),clamp((scene.palette2.r+scene.palette2.g-scene.palette2.b*2.0-0.30)*2.0,0.0,1.0)),vec3<f32>(0.72,0.52,1.0),clamp((0.36-palBright)*4.0,0.0,1.0));
  let rimElemStr=smoothstep(0.62,0.82,fresnel)*(1.0-metallic)*0.14;
  lit=clamp(lit+rimElemTint*rimElemStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Secondary cool fill rim: blue-grey rim lighting on shadow-side silhouette — standard two-point studio rim in every official Pokemon render; keeps creature edges readable and 3D on both sides
  let fillRimStr=smoothstep(0.58,0.74,fresnel)*smoothstep(0.32,0.12,toon)*(1.0-metallic)*0.18;
  lit=clamp(lit+vec3<f32>(0.40,0.52,0.72)*fillRimStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Silhouette inner AO darkening band: just inside the silhouette rim (fresnel 0.44-0.62), a subtle darkening creates the impression of rounded mass and prevents the body from looking "inflated" — in all studio portrait lighting setups and official Pokemon/Genshin character renders, there's a soft shadow band just inside the bright rim that adds depth and keeps the rim from blooming out; this inner-rim shadow is the difference between a 3D sphere and a flat disc with a bright ring; it also prevents fresnel self-transparency (the "lit from behind" issue that makes characters look like paper)
  let silInnerAO=smoothstep(0.44,0.60,fresnel)*(1.0-smoothstep(0.60,0.74,fresnel))*(1.0-metallic)*smoothstep(0.12,0.28,toon)*0.18;
  lit=lit*(1.0-silInnerAO*0.14);
  // Upper-body key light warm rim band: a horizontal bright band at the very top of the torso and head transition (just below crown) catches the strongest overhead key light at the point where the surface normal is closest to vertical — Charizard's crown highlight, Dragonite's head-top key, Lucario's crown; it's the highest-lit ring on the whole body and makes the creature look like it's lit from a high studio key
  let upperBodyKeyRimY=crownEyeY+crownEyeW*0.50;
  let upperBodyKeyBand=smoothstep(upperBodyKeyRimY-crownEyeW*0.60,upperBodyKeyRimY,input.worldPosition.y)*(1.0-smoothstep(upperBodyKeyRimY,upperBodyKeyRimY+crownEyeW*0.40,input.worldPosition.y));
  let upperBodyKeyFace=smoothstep(0.46,0.78,normal.y)*(1.0-metallic)*smoothstep(0.54,0.78,toon);
  lit=clamp(lit+mix(vec3<f32>(1.0,0.96,0.90),scene.palette2.rgb*0.80+vec3<f32>(0.20),warmDom*0.50)*upperBodyKeyBand*upperBodyKeyFace*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-appropriate fill light: warm bounce for Fire/Electric/Light, cool for Water/Ice/Shadow
  let fillD=max(dot(normal,vec3<f32>(-0.48,0.22,0.62)),0.0);
  let fillWarmCool=clamp((palBright-0.50)*2.0,-1.0,1.0);
  let fillColor=vec3<f32>(0.50+fillWarmCool*0.18,0.60,0.88-fillWarmCool*0.16);
  lit+=base*fillColor*fillD*0.15;
  // Ground-reflected bounce: subtle warm/cool fill from below-and-behind — three-point lighting completeness
  let groundFillD=max(dot(normal,vec3<f32>(0.0,-0.82,0.22)),0.0)*(1.0-metallic);
  let groundWarm=mix(vec3<f32>(0.80,0.56,0.24),vec3<f32>(0.32,0.44,0.64),clamp(palBright,0.0,1.0));
  lit+=base*groundWarm*groundFillD*0.04;
  // Sky dome ambient: upward-facing surfaces catch soft cool daylight from the sky hemisphere — four-point studio dome used in every Pokemon/Digimon official render
  let skyDomeAmt=clamp(normal.y,0.0,1.0)*(1.0-metallic)*0.055;
  lit=clamp(lit+vec3<f32>(0.52,0.62,0.78)*base*skyDomeAmt,vec3<f32>(0.0),vec3<f32>(1.0));
  // Non-metallic smooth environment gloss: low-roughness non-metal creatures (Vaporeon/Milotic/Articuno/Togekiss) show a soft dual-probe env tint — cool blue from sky above, warm ochre from ground below, giving "exists in a world" quality
  let envGlossGate=(1.0-metallic)*smoothstep(0.34,0.10,roughness)*clamp(palBright-0.28,0.0,1.0);
  lit=clamp(lit+vec3<f32>(0.52,0.64,0.80)*base*smoothstep(0.28,0.58,normal.y)*envGlossGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  lit=clamp(lit+vec3<f32>(0.72,0.58,0.36)*base*smoothstep(-0.30,-0.60,normal.y)*envGlossGate*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Strong outline: near-black at silhouette; dark-palette creatures (Shadow) get full-black edge
  // Light/Air ethereal soft outline: bright-palette creatures reduce outline opacity for divine/angel aesthetic — Togekiss/Gardevoir/Clefable softer edge quality vs dark-type bold ink lines
  let outlineStr=mix(0.90,0.96,step(palBright,0.35))*(1.0-lightSheen*0.28);
  // Element-tinted outline: darkest palette hue at 8% value — Pikachu outline is dark-gold not black; Vaporeon is dark-blue; matches Pokemon official art
  // Element-tinted outline color: the outline ink absorbs element color — Fire types get a dark amber outline, Electric a dark yellow, Water a dark navy, Shadow a deep purple-void; this is a quality difference between early Pokemon sprites (pure black outline) and modern Pokemon 3D (element-hued dark ink); each element gets a unique dark outline color
  let elemOutlineShift=scene.palette0.rgb*warmDom*0.04+scene.palette0.rgb*blueSheen*0.06+scene.palette0.rgb*shadowDom*0.08;
  let outlineTintColor=clamp(scene.palette0.rgb*0.09+elemOutlineShift,vec3<f32>(0.0),vec3<f32>(0.06));
  lit=mix(lit,outlineTintColor,outlineEdge*outlineStr);
  // Inner edge highlight: narrow bright band just inside the silhouette outline — in Genshin Impact and professional anime game shaders, a tiny bright rim runs just inside the ink edge; it pops the character off the background (all Studio 3D Pokemon and Genshin characters have this inner-edge glow quality)
  let innerEdgeGate=smoothstep(outlineStart-0.10,outlineStart,fresnel)*(1.0-smoothstep(outlineStart,outlineStart+0.08,fresnel))*(1.0-outlineEdge)*(1.0-metallic)*smoothstep(0.36,0.62,toon);
  let innerEdgeTint=mix(vec3<f32>(1.0,0.96,0.90),clamp(scene.palette2.rgb*1.10+vec3<f32>(0.08),vec3<f32>(0.0),vec3<f32>(1.0)),clamp(palBright-0.30,0.0,1.0)*0.48);
  lit=clamp(lit+innerEdgeTint*innerEdgeGate*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow ghostly edge: near-silhouette of dark ghost-type creatures shifts to pale violet-grey — ethereal transparency impression (Haunter/Gengar ghost body edge)
  let shadowGhost=step(palBright,0.38)*(1.0-metallic)*smoothstep(0.46,0.66,fresnel)*(1.0-outlineEdge);
  lit=mix(lit,scene.palette1.rgb*0.52+vec3<f32>(0.04,0.02,0.08),shadowGhost*0.22);
  // Shadow type negative outline: very dark Ghost/Shadow creatures at very high outline-zone fresnel show a faint eerie glow just beyond the dark outline — as if the creature's darkness is glowing — Gengar purple edge-glow beyond the black line; the outline zone brightens toward the element color for dark creatures only
  let negOutlineGate=shadowDom*outlineEdge*smoothstep(outlineWidth-0.04,outlineWidth,fresnel)*(1.0-metallic)*0.40;
  lit=clamp(lit+scene.palette1.rgb*negOutlineGate*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Air cloud fringe: pale/bright-dominant creatures brighten near the silhouette edge — soft atmospheric haze instead of hard dark ring (Togekiss/Altaria/Whimsicott cloud body)
  let airCloudFringe=lightSheen*smoothstep(0.52,0.70,fresnel)*(1.0-outlineEdge)*0.18;
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*airCloudFringe,vec3<f32>(0.0),vec3<f32>(1.0));
  // Air/Wind body translucency shimmer: Air-element creatures with very bright/near-white palettes are slightly translucent — Togekiss/Altaria/Whimsicott have thin fluffy bodies where you can see slight brightness variation at edges from overlapping layers; at mid-bright tones the body scatters some backlight giving a shimmer not from direct light but from diffuse scatter
  let airTransGate=lightSheen*smoothstep(0.32,0.14,roughness)*(1.0-metallic)*smoothstep(0.22,0.40,fresnel)*smoothstep(0.12,0.28,toon)*smoothstep(0.44,0.26,toon);
  let airTransShimmer=sin(input.worldPosition.x*scale*4.20+input.worldPosition.z*scale*3.60+fv*2.8)*0.5+0.5;
  lit=clamp(lit+vec3<f32>(0.98,0.99,1.0)*airTransGate*airTransShimmer*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow zone ambient cool cast: when the diffuse term falls into pure shadow (toon ≈ 0), the shadow color gets a slight cool-blue-violet shift — in all professional anime and Pokemon art the shadows are never neutral grey but slightly shifted toward cool violet or blue (Charizard shadows are warm-violet, Vaporeon shadows are blue, Eevee shadows are cool grey-blue); this makes the toon shadow zone feel atmospherically lit rather than dead-flat
  let shadowCoolCast=smoothstep(0.16,0.02,toon)*(1.0-metallic)*0.18;
  let coolCastColor=mix(vec3<f32>(0.68,0.72,0.90),scene.palette0.rgb*0.28+vec3<f32>(0.72,0.72,0.90),clamp(palBright-0.26,0.0,1.0));
  lit=clamp(lit*(1.0-shadowCoolCast)+coolCastColor*shadowCoolCast*(1.0-shadowDom*0.60),vec3<f32>(0.0),vec3<f32>(1.0));
  // Air/Sky sky luminous haze body: Air/Flying creatures (Togekiss, Altaria, Lugia, Swellow) absorb sky-ambient diffusely through their low-density cloud bodies — they appear to glow with the ambient sky color from within, not just reflect the key light; they look luminous because they are; modeled as a cyan-sky ambient fill on shadow-side surfaces of air-palette creatures
  let airSkyHaze=lightSheen*smoothstep(0.04,0.28,toon)*smoothstep(0.50,0.30,toon)*(1.0-metallic)*0.30;
  lit=clamp(lit+vec3<f32>(0.70,0.82,1.0)*airSkyHaze*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow type aura corona: dark/Ghost/Shadow creatures emanate a barely-visible dark-hued corona beyond the outline — Gengar/Darkrai/Chandelure; the outline has a secondary soft outer glow ring of the element color at very low opacity
  let shadowCorona=shadowDom*smoothstep(outlineStart+0.06,outlineStart+0.18,fresnel)*(1.0-smoothstep(outlineStart+0.18,outlineStart+0.38,fresnel))*(1.0-metallic);
  lit=clamp(lit+scene.palette2.rgb*shadowCorona*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Light type divine aura diffusion: near-white bright-palette Light/Fairy/Psychic creatures radiate a broad all-body glow — Togekiss/Jirachi/Arceus/Xerneas whole-body radiance; the entire body is brighter than any specific specular and has a diffuse warm-cream to cool-white radiance from within; distinct from element ambient particle which is point-based
  let divineAuraGate=lightSheen*(1.0-metallic)*0.36;
  let divineAuraBody=smoothstep(0.34,0.62,toon)*divineAuraGate;
  let divineAuraEdge=smoothstep(0.44,0.62,fresnel)*(1.0-smoothstep(0.62,0.82,fresnel))*divineAuraGate;
  lit=clamp(lit+vec3<f32>(0.98,0.97,0.94)*(divineAuraBody*0.10+divineAuraEdge*0.22),vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth/Rock granulite sparkle: matte high-roughness Earth-type surfaces show faint mica/quartz crystal glint — individual mineral grains reflect the key light; Geodude/Onix/Rhydon/Golem rock surface has the occasional bright mineral point visible in art and 3D render
  let granCell=floor(input.worldPosition*scale*10.0+vec3<f32>(fv*5.2,fv*8.7,fv*3.9));
  let granH=fract(sin(dot(granCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let granSpec=step(0.97,granH)*earthDom*smoothstep(0.38,0.62,toon);
  lit=clamp(lit+vec3<f32>(0.90,0.88,0.84)*granSpec*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Rock/Earth crystal inclusion: inside dense rock-type creatures (Regirock, Lycanroc, Tyranitar, Terrakion) there are larger mineral inclusions — quartz veins, feldspar crystals — that catch the key light as broader, softer specular patches distinct from the fine granulite sparkle; these give the rock surface a "geological specimen" quality; larger scale, softer specular
  let cristCell=floor(input.worldPosition*scale*3.60+vec3<f32>(fv*7.1,fv*4.8,fv*9.2));
  let cristH=fract(sin(dot(cristCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let cristN=normalize(normal+vec3<f32>((cristH-0.50)*0.36,fract(cristH*4.2+0.1)-0.50,(cristH-0.50)*0.18)*0.28);
  let cristSpec=pow(max(dot(cristN,halfVec),0.0),18.0)*step(0.82,cristH)*earthDom*smoothstep(0.36,0.60,toon)*specShadowMask;
  lit=clamp(lit+mix(vec3<f32>(0.96,0.94,0.90),vec3<f32>(0.80,0.90,1.0),cristH)*cristSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Muscle separation groove shadow: on muscular bipeds (Machamp, Blaziken, Mewtwo, Lucario), the groove between adjacent muscle bundles is always a shadow depression — modeled as a periodic darkening pattern perpendicular to the muscle fiber direction (horizontal on chest, vertical on arms); ~0.8× body-scale frequency; visible as subtle alternating shadow bands on the torso front
  let muscleGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.38,0.62,roughness)*smoothstep(0.40,0.62,toon)*step(fv,0.60)*0.20;
  let muscleFreq=scale*2.20;
  let muscleArmWave=sin(input.worldPosition.y*muscleFreq+fv*1.2)*0.5+0.5;
  let muscleTorsoWave=sin(input.worldPosition.x*muscleFreq*1.30+fv*2.1)*0.5+0.5;
  let muscleGroove=max(step(0.86,muscleArmWave)*smoothstep(0.44,0.68,abs(normal.x))*smoothstep(crownEyeW*0.80,crownEyeW*1.20,abs(input.worldPosition.x)),step(0.86,muscleTorsoWave)*smoothstep(0.42,0.68,normal.z)*smoothstep(crownEyeW*0.20,crownEyeW*0.76,abs(input.worldPosition.x)));
  let muscleGrooveY=smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.40,crownEyeY+crownEyeW*0.20,input.worldPosition.y));
  lit=lit*(1.0-muscleGroove*muscleGrooveY*muscleGrooveGate*0.10);
  // Air/Wind diagonal speed markings: cool-bright Air palettes show faint diagonal stroke lines — Pidgeot/Lugia/Swellow wind trail body pattern; gate on slight blue-over-red dominance
  let airGustGate=lightSheen*clamp((scene.palette2.b-scene.palette2.r+0.04)*14.0,0.0,1.0)*smoothstep(0.24,0.52,normal.z)*(1.0-metallic)*0.48;
  let gustCoarse=(input.worldPosition.x-input.worldPosition.y)*scale*3.20+fv*4.0;
  let gustFine=(input.worldPosition.x-input.worldPosition.y)*scale*6.40+fv*8.0;
  let gustStroke=max(step(0.88,fract(sin(floor(gustCoarse)*87.45+floor(gustCoarse*0.5)*43.2)*43758.545)),step(0.92,fract(sin(floor(gustFine)*63.29)*43758.545)));
  lit=clamp(lit+vec3<f32>(0.94,0.97,1.0)*gustStroke*airGustGate*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tail emission glow: vivid elements (Fire/Electric/Light) radiate color beyond the tip
  if (scene.tailTip.w > 0.0) {
    let tipGlowStr=clamp((palBright-0.55)/0.30,0.0,1.0);
    let tipGlow=(1.0-smoothstep(scene.tailTip.w*2.4,scene.tailTip.w*7.0,tipDist))*tipGlowStr;
    lit=clamp(lit+select(scene.palette0.rgb*0.22,scene.palette2.rgb*0.30,fv>0.58)*tipGlow*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  }
  // Tail shaft element gradient: element-characteristic hue bleeds from tip back along tail shaft — Charizard tail shaft warming toward flame, Vaporeon blue-teal fade, Ninetales cream-to-gold nine-tails; cohesive tail coloring on 65% of creatures (fv ≤ 0.65)
  if (scene.tailTip.w > 0.0) {
    let tailShaftBlend=smoothstep(scene.tailTip.w*8.0,scene.tailTip.w*3.0,tipDist)*step(fv,0.65);
    lit=clamp(lit+scene.palette2.rgb*tailShaftBlend*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
    // Tail taper chromatic gradient: as the tail tapers from thick base to thin tip, the color systematically shifts toward the element accent — Fire type tail goes from body-orange to bright amber-white at tip (Charizard), Water goes from blue to pale cyan (Vaporeon), Electric shifts from yellow to electric-white (Raichu/Pikachu); modeled as a blend from palette0 at base to palette2 at tip via tipDist factor; the thin-tissue tip also shows more SSS glow
    let tailTaperBlend=smoothstep(scene.tailTip.w*5.0,scene.tailTip.w*1.0,tipDist);
    let tailTaperColor=mix(scene.palette0.rgb*0.80,scene.palette2.rgb*0.90+vec3<f32>(0.10),tailTaperBlend);
    base=mix(base,clamp(tailTaperColor,vec3<f32>(0.0),vec3<f32>(1.0)),tailTaperBlend*0.36*organicSkin*(1.0-metallic));
    let tailTaperBright=smoothstep(scene.tailTip.w*2.0,scene.tailTip.w*0.40,tipDist)*clamp(palBright-0.28,0.0,1.0)*(1.0-metallic)*organicSkin;
    lit=clamp(lit+scene.palette2.rgb*tailTaperBright*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
    // Tail sweep motion stripe: the tail tip shows a faint diagonal speed line where the tip has swept laterally — visible on Pikachu, Raichu, Arcanine, Charizard sprite sheets; this is a horizontal gradient from normal color to bright as if the tail just swept left/right; single-pass approximation of motion blur stripe on tail tip using x-position gradient
    let sweepGate=smoothstep(scene.tailTip.w*0.60,scene.tailTip.w*0.0,tipDist)*clamp((palBright-0.42)/0.36,0.0,1.0)*(1.0-metallic);
    let sweepDir=clamp((input.worldPosition.x-scene.tailTip.x)/(scene.tailTip.w*0.90),0.0,1.0);
    lit=clamp(lit+scene.palette2.rgb*sweepDir*sweepGate*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  }
  // Plant chlorophyll backlit glow: green-dominant leaf surfaces transmit sunlight through tissue — Leafeon/Tropius/Shaymin sunlit leaf luminance
  let chloroBacklit=max(0.0,-dot(bumpNormal,light))*plantDom*(1.0-metallic)*smoothstep(0.32,0.08,roughness);
  lit=clamp(lit+vec3<f32>(0.32,0.64,0.08)*chloroBacklit*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant photosynthetic ambient fill: Plant-dominant creatures emit faint green ambient from chlorophyll fluorescence in shadow regions — Bulbasaur/Leafeon/Tropius shadow-side green warmth; shadow zones glow distinctly green rather than cold grey
  let chloroAmbient=plantDom*(1.0-metallic)*smoothstep(0.22,0.04,toon);
  lit=clamp(lit+vec3<f32>(0.10,0.42,0.06)*chloroAmbient*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant inner body glow: plant-dominant creatures emit faint warm-lime from all smooth body surfaces — Bulbasaur/Leafeon/Tropius internal chlorophyll radiance; surfaces have distinctive living-green emission quality
  let plantBodyGlow=plantDom*(1.0-metallic)*smoothstep(0.44,0.22,roughness)*0.40;
  lit=clamp(lit+vec3<f32>(0.22,0.52,0.04)*plantBodyGlow*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant bud/flower center warm glow: the reproductive structures on Plant-type Pokemon (Venusaur flower, Sunflora petals, Tropius fruit, Cherrim bloom) emit a warm yellow-amber glow from their center — photosynthetic energy concentrates at floral tissue; modeled as bright warm-yellow radiance at the lateral extremity tips of plant creatures in a warm centered region
  let budGlow=plantDom*lateralExt*(1.0-metallic)*smoothstep(0.24,0.14,roughness)*smoothstep(0.04,0.22,toon)*clamp(palBright-0.22,0.0,1.0)*0.28;
  lit=clamp(lit+vec3<f32>(0.96,0.84,0.14)*budGlow*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant leaf vein light transmission: backlit leaf-bearing creatures show leaf vein structure as bright branching lines where the thin vein channels transmit more light — Bulbasaur bulb, Leafeon fronds, Tropius leaf wings; veins are lighter in backlight because they're just slightly denser than the translucent membrane and redirect light along their length
  let leafVeinGate=plantDom*(1.0-metallic)*smoothstep(0.22,0.06,roughness)*smoothstep(0.08,0.22,toon)*smoothstep(0.40,0.22,toon);
  let lvA=sin(input.worldPosition.y*scale*9.60+input.worldPosition.x*scale*3.80+fv*2.3)*0.5+0.5;
  let lvB=sin(input.worldPosition.x*scale*8.40-input.worldPosition.z*scale*4.20+fv*1.7)*0.5+0.5;
  let leafVeinLine=step(0.88,lvA+lvB*0.40)*leafVeinGate;
  lit=clamp(lit+vec3<f32>(0.60,0.90,0.32)*leafVeinLine*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant chlorophyll SSS: plant-type leaf surfaces transmit warm yellow-green light through their thin membranes when backlit — Bulbasaur bulb glow, Leafeon frond transmitted light, Tropius wing leaf SSS; the chlorophyll absorbs red and blue and transmits warm yellow-green; this makes plant-type creatures glow uniquely green when viewed against a bright sky
  let leafSSSGate=plantDom*lateralExt*(1.0-metallic)*smoothstep(0.08,0.30,fresnel)*smoothstep(0.04,0.24,toon)*organicSkin*0.26;
  let leafSSSBacklit=max(0.0,-dot(bumpNormal,lightDir))*leafSSSGate;
  lit=clamp(lit+mix(vec3<f32>(0.60,0.90,0.14),scene.palette2.rgb*0.70+vec3<f32>(0.30),0.40)*leafSSSBacklit*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal crest SSS: thin central spine/crest/fin surfaces transmit element backlight — Vaporeon dorsal fin, Raichu ear, Lugia back crest, Leafeon fronds (narrow ridge receives backlight through thin tissue)
  let dorsalCrestSSS=spineX*spineY*max(0.0,-dot(bumpNormal,light))*(1.0-metallic)*smoothstep(0.18,0.50,fresnel)*0.18;
  lit=clamp(lit+scene.palette2.rgb*dorsalCrestSSS*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal spine tip emission: the very tip of dorsal spine/fin/crest geometry concentrates element energy and glows brighter — Vaporeon fin tip, Raichu ear tip, Dragonite wing tip concentration point; spineX*spineY peak is very narrow, emitting at the topmost point of the ridge
  let spineTipEmit=spineX*spineY*smoothstep(0.72,0.94,spineX*spineY)*(1.0-metallic)*clamp((palBright-0.24)/0.40,0.0,1.0)*0.20;
  lit=clamp(lit+scene.palette2.rgb*spineTipEmit*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Horn/spine element pulse: the very tip of the spine/horn above crownEyeY+crownEyeW*3 shows a faint colored pulse visible as a brightness wave — Rapidash horn, Sceptile tail spines, Aerodactyl head crest; adds the feeling the creature's spines are alive with energy; modulated by fv seed and height
  let hornTipY=crownEyeY+crownEyeW*3.20;
  let hornTipZone=smoothstep(hornTipY,hornTipY+crownEyeW*2.0,input.worldPosition.y)*(1.0-metallic)*spineX*clamp((palBright-0.28)/0.42,0.0,1.0);
  let hornPulseWave=sin(input.worldPosition.y*scale*2.80+fv*9.0)*0.5+0.5;
  lit=clamp(lit+scene.palette2.rgb*hornTipZone*hornPulseWave*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Vertebra/spine rhythm highlights: along the dorsal spine center, small periodic bright dot-peaks at vertebral intervals — suggests individual spine bones catching overhead light; visible on Arcanine/Tyranitar/Feraligatr dorsal spine; pattern of raised bumps along the back makes the back look alive rather than smooth
  let vertebraFreq=scale*4.60;
  let vertebraWave=sin(input.worldPosition.y*vertebraFreq+fv*2.0)*0.5+0.5;
  let vertebraPeak=smoothstep(0.82,0.96,vertebraWave)*spineX*spineY*smoothstep(0.30,0.54,normal.y)*(1.0-metallic)*smoothstep(0.36,0.58,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*vertebraPeak*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inter-vertebral dorsal shadow furrow: between each pair of vertebral highlight dots, a corresponding narrow dark trough from the inter-vertebral space — the alternating bright-peaks/dark-troughs of the vertebral column give the back a distinctly segmented organic quality; Arcanine, Tyranitar, Feraligatr backs show this vertebral corrugation; the shadow between each vertebral bright point deepens the overall spine anatomy effect
  let vertebraFurrow=smoothstep(0.12,0.28,vertebraWave)*(1.0-smoothstep(0.28,0.52,vertebraWave))*spineX*spineY*smoothstep(0.30,0.54,normal.y)*(1.0-metallic)*smoothstep(0.36,0.58,toon)*0.26;
  lit=lit*(1.0-vertebraFurrow*0.14);
  // Paraspinal erector spine groove shadows: the paired paraspinal (erector spinae) muscles create two bilateral vertical shadow channels flanking the vertebral column — the spine column runs center-bright (from vertebraPeak highlights) while the paraspinal grooves are darker bilateral channels ~0.28-0.54 crownEyeW lateral from center; on Pokemon like Mewtwo, Charizard, Blaziken from behind, these bilateral darker columns flanking the spine give the back its powerful muscular "double-ridge" anatomy read
  let paraSpGrooveX=smoothstep(crownEyeW*0.22,crownEyeW*0.42,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.42,crownEyeW*0.64,abs(input.worldPosition.x)));
  let paraSpGrooveBack=smoothstep(-0.12,-0.46,normal.z)*smoothstep(0.16,0.38,normal.y)*smoothstep(0.06,0.18,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.12,0.28,toon);
  lit=lit*(1.0-paraSpGrooveX*spineY*paraSpGrooveBack*0.12);
  // Spine crest tip ambient glow: the very topmost tips of dorsal spines catch soft ambient sky-dome light from above — upward-facing + high-elevation spine tips pick up a faint element-tinted ambient glow at the extreme tip of each spine; Charizard wing tips, Venusaur bulb tip, Rapidash horn tip all glow with this ambient-sky contribution; adds bioluminescent quality to creature extremities
  let spineTipY=crownEyeY+crownEyeW*2.80;
  let spineTipZone=smoothstep(spineTipY,spineTipY+crownEyeW*2.0,input.worldPosition.y)*spineX*spineY;
  let spineTipGlow=spineTipZone*(1.0-metallic)*smoothstep(0.14,0.36,toon)*clamp(palBright-0.18,0.0,1.0);
  lit=clamp(lit+scene.palette2.rgb*0.60*spineTipGlow*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tricep posterior shadow: the back of each upper arm (posterior-lateral surface from shoulder to elbow) is always in shadow from overhead key light — gives arms their sculpted cylinder quality by darkening the unseen-from-front face; Lucario, Mewtwo, Machamp show this dark tricep zone that makes arms read as 3D solid masses
  let tricepZone=smoothstep(crownEyeY-crownEyeW*0.44,crownEyeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*1.30,input.worldPosition.y));
  let tricepLat=smoothstep(crownEyeW*0.80,crownEyeW*1.20,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let tricepBack=smoothstep(-0.10,-0.48,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*smoothstep(0.06,0.22,toon);
  lit=lit*(1.0-tricepZone*tricepLat*tricepBack*0.24);
  // Horn base insertion shadow: where the horn/spine inserts into the skull, a narrow dark ring hugs the base — a concave shadow crease separating the horn from the head (visible on Rhydon, Nidoking, Heracross, Rapidash); gated to the crownEyeY level and narrow center-spine zone; prevents the horn from looking like it's floating
  let hornBaseY=crownEyeY+crownEyeW*0.06;
  let hornBaseBand=smoothstep(0.08,0.0,abs(input.worldPosition.y-hornBaseY)/(crownEyeW*0.14+0.001));
  let hornBaseRing=hornBaseBand*spineX*smoothstep(0.40,0.60,spineY)*smoothstep(0.0,0.25,normal.y)*smoothstep(0.28,0.52,toon)*(1.0-metallic);
  lit=lit*(1.0-hornBaseRing*0.26);
  // Dorsal fin interior color shift: the thin membrane between dorsal fin spines transmits the element color through translucent SSS — Vaporeon fin membrane, Shaymin-Sky wing membrane, Flygon wing; forward-scatter through thin geometry (high fresnel, very low NdotL); thin areas near spine but not spine center
  let finMembraneGate=(1.0-metallic)*spineY*smoothstep(crownEyeW*0.06,crownEyeW*0.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.16,crownEyeW*0.30,abs(input.worldPosition.x)))*smoothstep(0.0,0.30,fresnel)*smoothstep(0.28,0.52,toon);
  lit=clamp(lit+scene.palette2.rgb*0.36*finMembraneGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Circuit/data line pattern: Shadow/Electric/Metal creatures show faint glowing circuit-board line patterns on their surface — Machinedramon circuit lines, Magnamite/Magnezone magnetic field lines, Metagross neural network lines; these are fine bright lines running in perpendicular X-Y grid directions on the surface; distinct from regular cracks/scratches because they glow element-color
  let circuitGate=(shadowDom+elecChargeGate+metallic*0.40)*(1.0-organicSkin)*smoothstep(0.30,0.54,toon)*clamp(palBright-0.14,0.0,1.0)*0.30;
  let circHX=fract(sin(floor(input.worldPosition.x*scale*4.20)*77.31+fv*3.14)*43758.545);
  let circHY=fract(sin(floor(input.worldPosition.y*scale*4.20)*61.17+fv*2.07)*43758.545);
  let circLineX=smoothstep(0.01,0.0,fract(input.worldPosition.x*scale*4.20)-0.5)*step(0.78,circHX);
  let circLineY=smoothstep(0.01,0.0,fract(input.worldPosition.y*scale*4.20)-0.5)*step(0.78,circHY);
  let circuitLine=max(circLineX,circLineY)*circuitGate;
  lit=clamp(lit+scene.palette2.rgb*0.80*circuitLine*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric body inner charge glow: Electric-palette creatures show faint yellow-warm whole-body glow from internal electrostatic charge — Pikachu/Jolteon/Raichu body warmth, the low-level electric aura that colors the entire lit surface faintly yellow; distinct from surface sparks and rim arcs
  let elecBodyCharge=elecChargeGate*(1.0-roughness*0.58)*smoothstep(0.24,0.48,toon)*0.05;
  lit=clamp(lit+vec3<f32>(0.92,0.92,0.18)*elecBodyCharge,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric arc micro-discharge: Jolteon/Raichu/Manectric show tiny bright branching arc segments on body surface — lightning-bolt micro-patterns at high frequency that spark on the body; not just a glow but actual arc-segment geometry from a hash-based branching pattern
  let arcCell=floor(input.worldPosition*scale*6.80+vec3<f32>(fv*9.1,fv*4.3,fv*6.8));
  let arcH=fract(sin(dot(arcCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let arcBranch=fract(sin(dot(arcCell+vec3<f32>(1.0,0.0,0.0),vec3<f32>(311.7,74.7,127.1)))*43758.545);
  let arcGlow=step(0.94,arcH)*step(0.72,arcBranch)*elecChargeGate*smoothstep(0.38,0.56,toon);
  lit=clamp(lit+vec3<f32>(0.92,0.96,1.0)*arcGlow*0.50,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric corona discharge radius: around the body of an Electric type, there is a very soft light-blue-white halo at distances just beyond the specular zone, from the corona ionizing air — Pikachu/Jolteon/Raichu/Manectric "electric aura" at body silhouette; different from the rim light, this is specifically at mid-rim distances only and specifically for electric palettes
  let coronaGate=elecChargeGate*smoothstep(0.60,0.74,fresnel)*(1.0-smoothstep(0.74,0.88,fresnel))*(1.0-outlineEdge)*smoothstep(0.28,0.54,toon)*0.24;
  lit=clamp(lit+vec3<f32>(0.88,0.94,1.0)*coronaGate*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water caustic body scatter: Water-type bodies in strong backlit/top-lit conditions show refracted light caustic patterns (wavy bright patches) — Vaporeon/Suicune/Kyogre body receives caustic scatter light from the water surface above; visible as bright wobbly network patterns on the body skin
  let waterDom=clamp((scene.palette2.b-scene.palette2.r*1.50-0.12)*2.5,0.0,1.0)*(1.0-metallic);
  let causticA=sin(input.worldPosition.x*scale*5.20+input.worldPosition.z*scale*3.80+fv*2.1)*0.5+0.5;
  let causticB=sin(input.worldPosition.z*scale*4.60+input.worldPosition.y*scale*2.40+fv*3.4)*0.5+0.5;
  let causticMask=smoothstep(0.80,0.96,causticA*causticB)*waterDom*smoothstep(0.52,0.74,toon);
  lit=clamp(lit+vec3<f32>(0.78,0.90,1.0)*causticMask*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crystal subsurface glow: Ice/Crystal creatures have an inner glow from light penetrating the translucent crystal body and scattering — Lapras/Regice/Glaceon body; the crystal interior glows brighter in midtones than the pure-lit zone because light enters, scatters, and exits from the sides; cool blue-white internal glow
  let crystalGlowGate=iceXtalGate*smoothstep(0.24,0.08,roughness)*(1.0-metallic)*smoothstep(0.18,0.38,toon)*smoothstep(0.58,0.44,toon);
  lit=clamp(lit+vec3<f32>(0.72,0.88,1.0)*crystalGlowGate*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crystal facet scatter: each large crystal facet on ice/gem creatures faces a slightly different direction — individual facets create independent point-like specular highlights that appear scattered across the crystal body (Glaceon/Articuno/Regice crystal crown scatter); simulated by randomly perturbing the specular normal per cell and checking if the perturbed normal hits the light
  let xtalFacetCell=floor(input.worldPosition*scale*2.40+vec3<f32>(fv*8.0,fv*5.0,fv*6.0));
  let xtalFacetH=fract(sin(dot(xtalFacetCell,vec3<f32>(127.1,311.7,74.7)))*43758.545)*2.0-1.0;
  let xtalFacetN=fract(sin(dot(xtalFacetCell+vec3<f32>(0.5,0.0,0.0),vec3<f32>(311.7,74.7,127.1)))*43758.545)*2.0-1.0;
  let xtalFacetNormal=normalize(normal+vec3<f32>(xtalFacetH,xtalFacetN,xtalFacetH*xtalFacetN)*0.28);
  let xtalFacetSpec=pow(max(dot(xtalFacetNormal,halfVec),0.0),180.0)*iceXtalGate*specShadowMask*smoothstep(0.40,0.62,toon);
  lit=clamp(lit+vec3<f32>(0.94,0.98,1.0)*xtalFacetSpec*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice/crystal prism color dispersion: ice and crystal facets split white light into prismatic rainbow at certain viewing angles — Glaceon's ice crystals, Abomasnow's frost, Articuno's wings; the dispersion manifests as a faint red-to-violet spectral band at the brightest facet positions; varies by view angle (dot of view and half-vector)
  let prismGate=iceXtalGate*smoothstep(0.20,0.04,roughness)*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask;
  let prismPhase=dot(view,halfVec)*3.14+fv*2.0;
  let prismColor=vec3<f32>(smoothstep(0.30,0.50,sin(prismPhase)*0.5+0.5),smoothstep(0.20,0.50,sin(prismPhase+2.094)*0.5+0.5),smoothstep(0.10,0.50,sin(prismPhase+4.189)*0.5+0.5));
  lit=clamp(lit+prismColor*xtalFacetSpec*prismGate*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pink/violet palette body blush: pink-to-rose dominant palettes (high R+B relative to G) show warm blush-rose subsurface glow — Clefairy/Jigglypuff/Sylveon characteristic soft pink body; the creature reads as "soft and warm" with a living pink color warmth different from hard elemental colors
  let pinkDomGate=clamp((scene.palette2.r*0.72+scene.palette2.b*0.52-scene.palette2.g*2.0+0.18)*3.0,0.0,1.0)*(1.0-metallic);
  let pinkBodyBlush=pinkDomGate*smoothstep(0.34,0.60,toon)*(1.0-roughness*0.50)*0.07;
  lit=clamp(lit+vec3<f32>(0.72,0.18,0.38)*pinkBodyBlush,vec3<f32>(0.0),vec3<f32>(1.0));
  // Psychic/Fairy aura swirling streak: pink-dominant creatures show faint curved energy streams on the body surface rotating around the body — Gardevoir psychic aura, Sylveon ribbon energy, Clefairy fairy dust; slow sinusoidal curved paths at body scale that add the feeling the creature emanates psychic energy in motion
  let psychicAuraGate=pinkDomGate*smoothstep(0.38,0.24,roughness)*(1.0-metallic)*smoothstep(0.32,0.56,toon)*0.36;
  let auraPath=sin(input.worldPosition.x*scale*2.40+input.worldPosition.y*scale*3.80+fv*5.0)*cos(input.worldPosition.z*scale*2.80+fv*3.2);
  let auraStreak=smoothstep(0.86,0.96,abs(auraPath))*psychicAuraGate;
  lit=clamp(lit+vec3<f32>(0.94,0.60,0.92)*auraStreak*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Psychic telekinesis concentric ring: Espeon, Mewtwo, Gardevoir, Alakazam emit concentric pulsing ripple rings of psychic energy across the body surface — like a stone dropped in water but centered on the creature's body core; these rings are low-amplitude and slow, representing the psychic field emanating from within; distinct from the aura streak (which is directional) — these are circular radiating from center
  let psychRingDist=length(input.worldPosition.xy)/(crownEyeW*1.40+0.001);
  let psychRingWave=sin(psychRingDist*10.0-fv*18.0)*0.5+0.5;
  let psychRingGate=pinkDomGate*smoothstep(0.30,0.50,fresnel)*(1.0-metallic)*smoothstep(0.30,0.54,toon)*step(fv,0.70)*0.24;
  let psychRing=smoothstep(0.82,0.94,psychRingWave)*psychRingGate;
  lit=clamp(lit+vec3<f32>(0.90,0.50,0.96)*psychRing*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Aquatic fin iridescence: Water-type lateral extremities (fins, tail membranes) show mother-of-pearl rainbow at grazing angles — Vaporeon dorsal fin, Milotic tail, Gyarados fin extremity; wet aquatic membranes have distinctive opalescent shimmer distinct from body scales
  let finIridGate=blueSheen*smoothstep(0.28,0.06,roughness)*(1.0-metallic);
  let finIridPhase=input.worldPosition.x*scale*2.80+dot(halfVec,normal)*3.40+fv*4.20;
  let finIridColor=vec3<f32>(sin(finIridPhase)*0.5+0.5,sin(finIridPhase+2.094)*0.5+0.5,sin(finIridPhase+4.189)*0.5+0.5);
  lit=clamp(lit+finIridColor*lateralExt*smoothstep(0.52,0.72,fresnel)*finIridGate*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wing membrane leading edge specular: the thickened cartilage leading edge of a wing (Charizard, Aerodactyl, Dragonite, Togekiss) catches the key light as a brighter specular than the membrane — leading edge is the hardest, most light-catching part; produces a bright "wing rib" line from viewer's left or right
  let wingLeadEdge=lateralExt*smoothstep(0.70,0.88,abs(normal.x))*smoothstep(0.20,0.04,abs(normal.y))*(1.0-metallic)*smoothstep(0.20,0.42,roughness)*smoothstep(0.58,0.80,roughness);
  let wingLeadSpec=pow(max(dot(normal,halfVec),0.0),48.0)*wingLeadEdge*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*wingLeadSpec*0.34,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wing cross-vein secondary highlight: on insect and bat-style wings (Flygon, Dragonite, Scyther, Lugia), secondary veins run perpendicular to the main radial veins at ~60-70% span radius — each cross-vein catches a highlight at a slightly different angle than the main veins creating a web-like pattern of specular lines; the combination of main veins + cross veins is what distinguishes anatomically-modeled wings from a plain flat membrane; visible as a faint second set of bright lines orthogonal to wing radial direction
  let crossVeinGate=lateralExt*(1.0-msMetal)*smoothstep(0.14,0.36,msRgh)*smoothstep(0.36,0.22,msRgh)*smoothstep(0.42,0.64,toon)*specShadowMask*0.28;
  let crossVeinFreqY=scale*5.80;
  let crossVeinA=sin(input.worldPosition.y*crossVeinFreqY+fv*3.0)*0.5+0.5;
  let crossVeinLine=step(0.88,crossVeinA)*crossVeinGate*smoothstep(0.48,0.68,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*crossVeinLine*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur direction sheen: aligned fur fibers catch light specifically when viewed perpendicular to the fur growth direction — Eevee's chest ruff sheen, Arcanine's mane highlight, Umbreon's smooth body sheen; models the anisotropic fur highlight perpendicular to the vertical body axis
  let furSheenGate=furGate*(1.0-metallic)*smoothstep(0.44,0.68,toon)*0.44;
  let furTangent=normalize(vec3<f32>(0.0,1.0,0.0)-(normal*dot(normal,vec3<f32>(0.0,1.0,0.0))));
  let furAnisH=dot(furTangent,halfVec);
  let furSheenSpec=pow(clamp(1.0-furAnisH*furAnisH,0.0,1.0),12.0)*furSheenGate;
  lit=clamp(lit+mix(vec3<f32>(1.0,0.97,0.92),scene.palette2.rgb*0.90,0.35)*furSheenSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Feather barb highlight: Avian creatures (Pidgeot, Swellow, Togekiss, Staraptor) have individual feather barb specular — fine parallel lines perpendicular to the feather shaft axis; very high frequency pattern of thin bright stripes along the lateral-extending feather surfaces; distinct from fur because feathers are flat and rigid and catch light along their edge
  let featherBarbGate=lateralExt*smoothstep(0.38,0.20,roughness)*(1.0-metallic)*(1.0-organicSkin)*smoothstep(0.40,0.62,toon)*0.50;
  let featherBarbFreq=scale*16.0;
  let featherBarbA=sin(input.worldPosition.z*featherBarbFreq+input.worldPosition.y*featherBarbFreq*0.40+fv*8.0)*0.5+0.5;
  let featherBarbLine=step(0.90,featherBarbA)*featherBarbGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*featherBarbLine*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Serpentine body lateral flattening highlight: snake-body creatures (Arbok, Seviper, Rayquaza, Milotic) have a flattened mid-body cross-section — the side-facing surfaces catch the key light as a broad bright stripe along the maximum-width zone; makes cylindrical SDF snakes read as properly flattened in the mid-section
  let serpFlatLateral=smoothstep(0.58,0.82,abs(normal.x))*smoothstep(0.22,0.06,abs(normal.y))*(1.0-metallic)*smoothstep(0.36,0.58,toon)*0.22;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.93)*serpFlatLateral*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Organic warm body fill: low-saturation organic skin (Eevee/Pikachu/Meowth/Snorlax) glows faint warm-peach in lit zone from subsurface blood-warmth — makes organic creatures feel alive and warm vs cold inanimate objects; most visible on pale/neutral creatures where the pink-orange undertone reads through
  let organicBodyWarm=organicSkin*smoothstep(0.38,0.72,toon)*(1.0-metallic)*0.07;
  lit=clamp(lit+vec3<f32>(0.24,0.08,0.04)*organicBodyWarm,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly thermal warmth: living creature underbellies radiate subtle peach-warm fill from internal body heat — in Pokemon art, the belly area always has a slightly warmer, pinker cast than the back (Eevee/Pikachu/Snorlax warm belly center); this is the internal body temperature showing through thin ventral skin
  let bellyTherm=belly*(1.0-metallic)*smoothstep(0.36,0.62,toon)*clamp(palBright-0.20,0.0,1.0)*0.05;
  lit=clamp(lit+vec3<f32>(0.22,0.06,0.04)*bellyTherm,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow element subsurface violet: dark-palette Shadow creatures show violet-blue from within — Gengar's purple inner luminance, Darkrai's blue-violet body, Spiritomb's shadow depths; deep shadow types have an eerie inner glow in mid-tone regions that's not ambient (it comes from within)
  let shadowSubsurface=shadowDom*(1.0-metallic)*smoothstep(0.14,0.38,toon)*smoothstep(0.54,0.26,roughness)*0.08;
  lit=clamp(lit+vec3<f32>(0.28,0.04,0.54)*shadowSubsurface,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water-type iridescent fresnel: blue-dominant palettes get cool shimmer at grazing angles (Vaporeon/Milotic)
  lit=clamp(lit+vec3<f32>(0.10,0.32,0.68)*blueSheen*rim*rimStrength*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wet surface broad gloss: Water/Ice low-roughness gets wide secondary specular (Vaporeon wet coat / Lapras shell)
  let wetGloss=clamp((0.32-roughness)/0.32,0.0,1.0)*(1.0-metallic);
  let wetSpec=pow(max(dot(normal,halfVec),0.0),32.0)*wetGloss;
  lit=clamp(lit+vec3<f32>(0.85,0.92,1.0)*wetSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water sub-surface back-scatter: blue-smooth surfaces glow cyan in shadow where backlit — light diffusing through semi-translucent water flesh (Vaporeon/Milotic/Lapras translucency)
  let waterSSS=blueSheen*smoothstep(0.34,0.08,roughness)*(1.0-metallic)*clamp(-dot(normal,light)*1.80,0.0,1.0)*smoothstep(0.30,0.06,toon)*0.18;
  lit=clamp(lit+vec3<f32>(0.18,0.66,0.90)*waterSSS,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice shadow depth tint: shadow zones on smooth ice creatures shift to cool blue-grey — red/warm wavelengths absorbed through ice bulk (Glaceon/Articuno/Lapras ice-core shadow)
  let iceBlueGate=clamp((scene.palette2.b+scene.palette2.g*0.60-scene.palette2.r*2.50+0.48)*2.5,0.0,1.0)*(1.0-metallic)*smoothstep(0.28,0.06,roughness);
  let iceShadowBlue=iceBlueGate*smoothstep(0.22,0.04,toon)*0.16;
  lit=clamp(lit*(1.0-iceShadowBlue)+vec3<f32>(0.40,0.60,0.88)*iceShadowBlue,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice creature milky-blue SSS: real ice has subsurface light scattering that gives it a milky-translucent quality — Lapras/Articuno/Regice/Glaceon body reads as thick, slightly luminous ice from the inside; modeled as a blue-white glow proportional to the thickness of the body (strongest in shadow zones, giving ice its characteristic interior glow even on dark surfaces)
  let iceSSSGate=iceBlueGate*organicSkin*smoothstep(0.08,0.30,toon)*smoothstep(0.54,0.32,toon)*0.22;
  let iceSSSThick=smoothstep(0.60,0.10,abs(normal.z))*smoothstep(0.12,0.04,abs(normal.y))*iceSSSGate;
  lit=clamp(lit+vec3<f32>(0.68,0.84,1.0)*iceSSSThick*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice breath fog condensate: Ice-type creatures exhale supercooled air that condenses as a faint milky-white mist near their mouth — Articuno, Lapras, Glaceon, Regice; visible as a very subtle bright haze in the face-forward zone of ice creatures on the shadow side especially; simulated as near-mouth forward-facing luminance
  let iceFogGate=iceBlueGate*smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY+crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.60,input.worldPosition.y));
  let iceFogFwd=smoothstep(0.38,0.66,normal.z)*smoothstep(0.16,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.04,0.24,toon)*smoothstep(0.46,0.28,toon);
  lit=clamp(lit+vec3<f32>(0.82,0.90,1.0)*iceFogGate*iceFogFwd*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Light/Air luminous body glow: high-brightness all-channel palettes emit faint ambient radiance (Togekiss/Clefairy)
  lit=clamp(lit+scene.palette2.rgb*lightSheen*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Light pulse wave: gentle luminescent radiance wave across fairy/light bodies (Togekiss aura / Sylveon ribbon glow)
  let lightPulse=sin(input.worldPosition.y*scale*1.20+input.worldPosition.x*scale*0.80)*0.5+0.5;
  let lightWave=smoothstep(0.72,0.92,lightPulse)*lightSheen*0.08;
  lit=clamp(lit+vec3<f32>(1.0,0.92,0.86)*lightWave,vec3<f32>(0.0),vec3<f32>(1.0));
  // Holographic shimmer: Light/Fairy bright near-neutral palettes rotate spectral hues at grazing angles (Gardevoir/Sylveon/Starmie)
  let holoPhase=normal.x*2.80+normal.y*1.40+fv*6.28;
  let holoColor=vec3<f32>(sin(holoPhase)*0.50+0.50,sin(holoPhase+2.094)*0.50+0.50,sin(holoPhase+4.189)*0.50+0.50);
  lit=clamp(lit+holoColor*lightSheen*rim*rimStrength*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Light/Fairy sparkle dust: floating star emission points scattered across bright bodies (Clefairy/Sylveon/Togekiss sparkle aura)
  let fspkCell=floor(input.worldPosition*scale*7.20);
  let fspkHash=fract(sin(dot(fspkCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let fspkSize=fract(sin(dot(fspkCell,vec3<f32>(311.7,74.7,127.1)))*43758.545)*0.36+0.14;
  let fspkFract=fract(input.worldPosition*scale*7.20)-0.50;
  let fspkDot=smoothstep(fspkSize*0.22,fspkSize*0.04,length(fspkFract))*step(0.80,fspkHash)*lightSheen;
  lit=clamp(lit+vec3<f32>(0.98,0.96,1.0)*fspkDot*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Air/Cloud body edge luminous dissolve: bright smooth creatures (Altaria/Togekiss/Lugia/Swablu) have no hard silhouette edge — their bodies dissolve into soft luminous bloom at the rim; cloud and airy types radiate pale white-blue light at their perimeter as if the body itself becomes light at the edges
  let airCloudGate=lightSheen*smoothstep(0.38,0.08,roughness)*(1.0-metallic);
  let airEdgeSoften=smoothstep(0.62,0.84,fresnel)*airCloudGate;
  lit=clamp(lit+clamp(scene.palette2.rgb*0.90+vec3<f32>(0.08,0.08,0.12),vec3<f32>(0.0),vec3<f32>(1.0))*airEdgeSoften*0.28,vec3<f32>(0.0),vec3<f32>(1.0));

  // Light/Fairy divine inner radiance: at oblique view angles where surface faces away from viewer, bright creatures emit a warm golden glow from within — Arceus/Xerneas/Sylveon/Clefable divine presence; Air-dominant gets cooler pearl-white variant
  let lightDivineGate=lightSheen*clamp((palBright-0.72)/0.18,0.0,1.0)*(1.0-metallic)*0.32;
  let innerFaceAngle=clamp(0.5-dot(bumpNormal,view)*0.5,0.0,1.0);
  let divineGlow=smoothstep(0.22,0.58,innerFaceAngle)*lightDivineGate;
  let divineTint=mix(vec3<f32>(1.0,0.88,0.52),vec3<f32>(0.92,0.96,1.0),clamp((scene.palette2.b-scene.palette2.r+0.04)*10.0,0.0,1.0));
  lit=clamp(lit+divineTint*divineGlow*0.13,vec3<f32>(0.0),vec3<f32>(1.0));
  // Light/Air extremity luminous glow: bright-palette creatures emit soft element-pale glow from limb extremities and wingtips — Togekiss winglet glow, Sylveon ribbon-tip luminance, Gardevoir sleeve-tip radiance; light bleeds from thin extremities
  let lightExtGlow=lightSheen*(1.0-metallic)*smoothstep(1.20,1.60,abs(input.worldPosition.x))*0.30;
  lit=clamp(lit+clamp(scene.palette2.rgb*1.20+vec3<f32>(0.10,0.10,0.06),vec3<f32>(0.0),vec3<f32>(1.0))*lightExtGlow*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire/Dragon lateral heat glow: fire-dominant creatures radiate warm amber-orange from limb extremities — Arcanine paw ember glow, Charizard claw tip radiance, Typhlosion shoulder flame-heat; fire radiates outward from the thin parts of the body (where the element escapes most)
  let fireExtGlow=warmDom*(1.0-metallic)*smoothstep(1.15,1.58,abs(input.worldPosition.x))*0.38;
  lit=clamp(lit+vec3<f32>(0.94,0.38,0.04)*fireExtGlow*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice/Water cool-white rim: high-brightness blue palettes get a pale ice shimmer at silhouette (Articuno/Lapras)
  let iceSheen=clamp(palBright-0.55,0.0,1.0)*clamp((scene.palette2.b-scene.palette2.r-0.10)*2.0,0.0,1.0)*(1.0-metallic);
  lit=clamp(lit+vec3<f32>(0.72,0.84,1.0)*iceSheen*rim*rimStrength*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice core glow: faint blue-white light from within icy body viewed at oblique angles — Articuno/Glaceon/Regice inner ice luminescence
  let iceCore=max(0.0,dot(bumpNormal,-view))*iceXtalGate*smoothstep(0.22,0.04,roughness);
  lit=clamp(lit+vec3<f32>(0.50,0.78,1.0)*iceCore*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water belly teal pool: blue-smooth creatures show faint teal-cyan pool reflection on their underside — Vaporeon/Milotic/Lapras characteristic aquatic habitat lighting, belly glows cyan-teal as if above open water
  let waterPoolGate=clamp((scene.palette2.b-scene.palette2.r-0.20)*3.0,0.0,1.0)*smoothstep(0.26,0.08,roughness)*(1.0-metallic);
  let poolUnder=smoothstep(-0.08,-0.52,normal.y)*smoothstep(0.44,0.08,input.worldPosition.y);
  lit=clamp(lit+vec3<f32>(0.10,0.58,0.72)*base*poolUnder*waterPoolGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water shimmer: blue-dominant smooth surfaces show undulating surface-sparkle waves (Vaporeon/Milotic/Gyarados wet scales)
  let waterShimmer=clamp((scene.palette2.b-scene.palette2.r-0.18)*3.0,0.0,1.0)*smoothstep(0.26,0.08,roughness)*(1.0-metallic);
  let shimWave=sin(input.worldPosition.x*scale*2.80+input.worldPosition.y*scale*2.20+noise*1.6)*0.5+0.5;
  lit=clamp(lit+vec3<f32>(0.46,0.70,1.0)*step(0.82,shimWave)*waterShimmer*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water caustic light: ripple-refraction bright spots on blue-smooth surfaces — Vaporeon/Milotic/Gyarados underwater caustic dappling
  let causticGate=clamp((scene.palette2.b-scene.palette2.r-0.15)*3.5,0.0,1.0)*smoothstep(0.28,0.08,roughness)*(1.0-metallic)*0.55;
  let cauA=sin(input.worldPosition.x*scale*4.20+input.worldPosition.y*scale*2.80+noise*1.8)*0.5+0.5;
  let cauB=sin(input.worldPosition.y*scale*3.60+input.worldPosition.z*scale*2.20+noise*1.2)*0.5+0.5;
  lit=clamp(lit+vec3<f32>(0.50,0.82,1.0)*step(0.86,cauA*cauB)*causticGate*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water surface bead rivulet pattern: wet aquatic creatures (Vaporeon, Milotic, Blastoise after water attack) show surface water beading as a regular pattern of small bright lenslet dots — each water bead is a tiny convex lens focusing the key light into a bright point, creating a characteristic "just emerged from water" surface pattern distinct from dry surface speculars; denser and finer than the existing wet drop pattern
  let beadGate=blueSheen*smoothstep(0.14,0.04,roughness)*(1.0-metallic)*smoothstep(0.40,0.62,toon)*0.24;
  let beadCell=floor(input.worldPosition*scale*11.0+vec3<f32>(fv*4.7,fv*6.1,fv*3.3));
  let beadHash=fract(sin(dot(beadCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let beadAge=fract(sin(dot(beadCell+vec3<f32>(1.0,0.0,0.0),vec3<f32>(311.7,74.7,127.1)))*43758.545);
  let beadShape=step(0.80,beadHash)*step(beadHash,0.96)*step(0.34,beadAge);
  let beadNorm=normalize(normal+vec3<f32>((beadHash-0.88)*2.0,(beadAge-0.50),(beadHash-0.88))*0.24);
  let beadSpec=pow(max(dot(beadNorm,halfVec),0.0),200.0)*beadShape*beadGate*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.92,0.96,1.0)*beadSpec*0.60,vec3<f32>(0.0),vec3<f32>(1.0));
  // Aquatic gill color accent: water/aquatic type creatures (Vaporeon, Feraligatr, Blastoise, Milotic) have gill structures at the neck-lateral area with a distinctly lighter/more saturated color — the gill membranes are thinner and more vascular, glowing slightly brighter; present on ~40% of water-type creatures (fv ≤ 0.40)
  let gillY=crownEyeY-crownEyeW*0.42;
  let gillBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-gillY)/(crownEyeW*0.18+0.001));
  let gillLat=smoothstep(crownEyeW*0.28,crownEyeW*0.64,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.64,crownEyeW*0.90,abs(input.worldPosition.x)));
  let gillFwd=smoothstep(0.18,0.48,abs(normal.x))*smoothstep(0.12,-0.04,abs(normal.y))*(1.0-metallic)*organicSkin*blueSheen*smoothstep(0.08,0.24,toon)*step(fv,0.40);
  lit=clamp(lit+mix(vec3<f32>(0.38,0.72,0.94),scene.palette2.rgb*0.80+vec3<f32>(0.20),0.50)*gillBand*gillLat*gillFwd*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water droplet highlights: tiny bright beads on wet smooth surfaces (Vaporeon after rain, Milotic wet scales)
  let wetDropGate=clamp((scene.palette2.b-scene.palette2.r-0.22)*3.5,0.0,1.0)*smoothstep(0.20,0.06,roughness)*(1.0-metallic);
  let dropCell=floor(input.worldPosition*scale*5.80);
  let dropHash=fract(sin(dot(dropCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let dropBase=fract(sin(dot(dropCell,vec3<f32>(269.5,183.3,46.1)))*43758.545);
  let wetDrop=step(0.94,dropHash)*step(0.52,dropBase)*wetDropGate;
  lit=clamp(lit+vec3<f32>(0.90,0.95,1.0)*wetDrop*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water wave-distorted secondary specular: wave-perturbed surface normal on blue-smooth creatures creates distributed specular lobe — Vaporeon/Milotic liquid surface shifting-specular quality
  let waveSpecGate=clamp((scene.palette2.b-scene.palette2.r-0.20)*3.0,0.0,1.0)*smoothstep(0.24,0.08,roughness)*(1.0-metallic);
  let waveDistNormal=normalize(bumpNormal+wavePerturb*2.0);
  let waveSpec=pow(max(dot(waveDistNormal,halfVec),0.0),24.0)*waveSpecGate;
  lit=clamp(lit+vec3<f32>(0.82,0.92,1.0)*waveSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric/Fire energy sparks: vivid warm palettes scatter bright micro-dots (Jolteon static crackle, Arcanine ember sparks)
  let energyVivid=clamp((scene.palette2.r+scene.palette2.g*0.70-scene.palette2.b*2.0-0.80)*3.0,0.0,1.0)*(1.0-metallic);
  let spkCell=floor(input.worldPosition*scale*4.20);
  let spkHash=fract(sin(dot(spkCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let spkBase=fract(sin(dot(spkCell,vec3<f32>(269.5,183.3,46.1)))*43758.545);
  let sparkDot=step(0.92,spkHash)*step(0.40,spkBase)*energyVivid;
  lit=clamp(lit+vec3<f32>(0.94,0.98,1.0)*sparkDot*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric rim discharge: bright yellow sparks specifically at silhouette of Electric creatures — Jolteon/Raichu static aura at edges
  let elecRimGate=clamp((scene.palette2.r+scene.palette2.g-scene.palette2.b*3.5-0.50)*2.5,0.0,1.0)*(1.0-metallic);
  let rimDischarge=step(0.92,spkHash)*step(0.40,spkBase)*elecRimGate*smoothstep(0.50,0.68,fresnel);
  lit=clamp(lit+vec3<f32>(0.98,0.96,0.62)*rimDischarge*0.50,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire/Electric energy channels: flowing body veins of inner light on vivid warm creatures (Magmar lava veins / Electivire plasma channels)
  let veinA=sin(input.worldPosition.y*scale*1.54+input.worldPosition.x*scale*0.82+noise*0.48)*0.5+0.5;
  let veinB=cos(input.worldPosition.z*scale*1.26+input.worldPosition.y*scale*0.64+noise*0.36)*0.5+0.5;
  let veinFlow=step(0.87,max(veinA,veinB))*energyVivid*0.18;
  lit=clamp(lit+clamp(scene.palette2.rgb*1.20,vec3<f32>(0.0),vec3<f32>(1.0))*veinFlow,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire/Dragon face heat radiance: forward-facing head surfaces on fire-dominant creatures emit faint amber inner self-illumination — Charizard face-heat shimmer, Arcanine flame-mane warm glow, Typhlosion fire-collar ambient
  let fireFaceH=smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY+crownEyeW*1.20,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*1.20,crownEyeY+crownEyeW*2.00,input.worldPosition.y));
  let fireFaceFwd=smoothstep(0.22,0.58,normal.z)*(1.0-metallic);
  lit=clamp(lit+vec3<f32>(0.90,0.42,0.05)*fireGlow*fireFaceH*fireFaceFwd*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Face element color catch: forward-facing head surfaces in bright lit zone receive element-hue tint — face reads as element-colored (Pikachu yellow face, Vaporeon cool-blue face, Charizard amber face, Espeon violet face)
  let faceLightCast=fireFaceH*smoothstep(0.50,0.76,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.56,0.82,toon)*(1.0-metallic)*0.08;
  lit=clamp(lit+scene.palette2.rgb*faceLightCast,vec3<f32>(0.0),vec3<f32>(1.0));

  // Smooth element surface bloom: bright smooth non-metal creatures emit faint even element-hue radiance — luminous from within quality (Vaporeon/Togekiss/Articuno glow)
  let smoothBloom=(1.0-roughness)*(1.0-metallic)*clamp((palBright-0.48)/0.30,0.0,1.0)*0.06;
  lit=clamp(lit+scene.palette2.rgb*smoothBloom,vec3<f32>(0.0),vec3<f32>(1.0));
  // === Curvature crevice shadows — simulates hand-painted junction darkening ===
  // Screen-space normal derivatives detect where two body parts meet (arm-to-shoulder,
  // leg-to-body), matching how Pokemon artists paint darker areas at geometry junctions.
  let nDx=dpdx(normal); let nDy=dpdy(normal);
  let curvature=length(nDx)+length(nDy);
  let crevice=smoothstep(0.04,0.18,curvature)*0.40*smoothstep(0.06,0.40,dot(normal,view));
  // Curvature-boosted outline at joints: high-curvature screen areas (limb-body junctions, anatomy seams) receive extra dark outline — matches Pokemon hand-drawn quality where lines are thicker at body joints (Charizard/Mewtwo/Lucario joint line quality)
  let curveOutlineBoost=smoothstep(0.08,0.22,curvature)*smoothstep(0.52,0.68,fresnel)*0.08;
  lit=mix(lit,outlineTintColor,curveOutlineBoost*0.60);
  // Shadow/Dark type crevice glow: deep crevices emit element-colored radiance (Gengar/Darkrai void aura)
  let shadowGlow=step(palBright,0.36)*clamp(metallic*(-1.0)+1.0,0.0,1.0);
  lit=lit*(1.0-crevice*mix(1.0,0.60,shadowGlow));
  lit=clamp(lit+scene.palette2.rgb*crevice*shadowGlow*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow void cracks: dark-element surfaces show glowing energy fracture lines (Darkrai/Spiritomb void cracks)
  let voidCA=fract(sin(dot(floor(input.worldPosition*scale*2.20),vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let voidCB=fract(sin(dot(floor(input.worldPosition*scale*4.40+vec3<f32>(2.8,5.3,1.9)),vec3<f32>(74.7,127.1,311.7)))*43758.545);
  let voidCrack=smoothstep(0.76,0.94,max(voidCA,voidCB))*shadowGlow*0.16;
  lit=clamp(lit+scene.palette1.rgb*1.30*voidCrack,vec3<f32>(0.0),vec3<f32>(1.0));
  // All-element crevice subsurface: vivid non-shadow, non-metal recesses glow with faint element hue (Charizard warm seams, Vaporeon cool shadows)
  let creviceElemStr=clamp((palBright-0.44)/0.40,0.0,1.0)*(1.0-shadowGlow)*(1.0-metallic);
  lit=clamp(lit+scene.palette2.rgb*crevice*creviceElemStr*0.09,vec3<f32>(0.0),vec3<f32>(1.0));
  // Rough surface element scatter: high-roughness non-metal surfaces scatter element hue in diffuse layer — Earth/Dragon/Ground type rough skin feels element-saturated (Garchomp/Rhyperior/Dragonite rough skin hue absorption)
  let roughElemScatter=clamp((msRgh-0.40)/0.40,0.0,1.0)*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.28,0.58,toon)*0.08;
  lit=clamp(lit+scene.palette2.rgb*roughElemScatter*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth/Rock terracotta ground warmth: high-roughness warm-palette (non-blue) creatures get warm sienna-brown ambient on their underside from ground-bounce light — Onix/Golem/Rhyperior/Garchomp earth ambient; stone surfaces absorb warm reflected light from dry soil or rocky terrain they walk on
  let earthDomGate=clamp((msRgh-0.50)/0.30,0.0,1.0)*(1.0-metallic)*clamp(scene.palette2.r-scene.palette2.b-0.06,0.0,1.0);
  let earthGndFill=smoothstep(-0.02,-0.44,normal.y)*earthDomGate*smoothstep(0.08,0.32,toon);
  lit=clamp(lit+vec3<f32>(0.46,0.24,0.08)*earthGndFill*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral body contact shadow: outer lateral body-sides near ground pick up contact shadow from environment — creature looks solidly grounded (Snorlax/Blastoise/Dragonite wide-body side shadow)
  let lateralContactShadow=smoothstep(0.22,0.0,input.worldPosition.y)*smoothstep(0.34,0.64,abs(normal.x))*(1.0-metallic)*0.16;
  lit=lit*(1.0-lateralContactShadow);
  // Ground proximity AO: downward-facing surfaces near y=0 are darker (contact shadow, grounded feel)
  let groundAO=smoothstep(0.42,0.04,input.worldPosition.y)*smoothstep(0.10,-0.14,normal.y);
  lit=lit*(1.0-groundAO*0.28);
  // Horizon AO: lower lateral surfaces get ambient occlusion from environment — gives legs/arms 3D roundness (studio lighting effect)
  let horizonAO=smoothstep(0.22,0.54,abs(normal.x))*smoothstep(0.54,0.18,input.worldPosition.y)*smoothstep(0.28,0.06,normal.y)*0.14;
  lit=lit*(1.0-horizonAO);

  // Shadow ground mist: dark-dominant creatures darken the lower ground-adjacent surface — supernatural shadow pooling effect (Gengar/Darkrai lingering dark aura)
  let shadowMist=step(palBright,0.38)*(1.0-metallic)*smoothstep(0.28,0.04,input.worldPosition.y)*smoothstep(-0.10,-0.52,normal.y);
  lit=clamp(lit*(1.0-shadowMist*0.24)+scene.palette1.rgb*shadowMist*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow spectral decay: noise-stippled dark dropouts at silhouette edge — Haunter/Gengar body dissolving into shadows, Spiritomb void texture
  let specDecayHash=fract(sin(dot(floor(input.worldPosition*scale*4.80),vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let specDecay=step(0.84,specDecayHash)*shadowGhost*0.40;
  lit=lit*(1.0-specDecay);
  // Shadow type void atmosphere: faint violet-purple atmospheric tint throughout dark-element creature body — Gengar purple-haze body, Darkrai blue-dark atmosphere, Spiritomb void aura; the subtle tint across ALL surfaces (not just edges) is characteristic of Ghost/Dark type quality
  let shadowAtmosGate=step(palBright,0.42)*(1.0-metallic);
  lit=mix(lit,lit*vec3<f32>(0.86,0.82,0.94),shadowAtmosGate*0.08);
  // Bioluminescent body spots: Shadow/Water/Psychic element creatures show faint scattered glowing spots on their body — deep-sea creature bioluminescence (Jellicent/Tentacruel/Chandelure glowing body marks); these are small random bright dots of element color emitted from beneath the skin; distinct from pattern marks because they glow independently of the pattern and fade near specular peaks
  let bioLumiGate=(shadowDom+blueSheen+pinkDomGate)*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*0.24;
  let bioCell=floor(input.worldPosition*scale*3.80+vec3<f32>(fv*13.0,fv*7.0,fv*9.5));
  let bioH=fract(sin(dot(bioCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let bioDot=step(0.96,bioH)*bioLumiGate*smoothstep(0.22,0.40,toon);
  lit=clamp(lit+scene.palette2.rgb*1.20*bioDot*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow void extremity bleed: far lateral extremities of dark creatures emit pale blue-violet void energy from within — Darkrai fingertip glow, Gengar claw void, Spiritomb tendril ends, Chandelure flame wisp tips
  let shadowExtBleed=step(palBright,0.38)*(1.0-metallic)*smoothstep(1.30,1.68,abs(input.worldPosition.x));
  lit=clamp(lit+scene.palette1.rgb*1.20*shadowExtBleed*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wing membrane backlight: lateral extremity surfaces pass element-colored light through thin edges (Charizard/Aerodactyl/Gyarados wing tips)
  let wingThin=smoothstep(1.18,1.72,abs(input.worldPosition.x))*smoothstep(0.30,0.66,abs(normal.x))*(1.0-metallic);
  let wingSSS=max(0.0,-dot(normal,light))*wingThin;
  lit=clamp(lit+scene.palette2.rgb*wingSSS*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water/Ice fin crystal edge: outermost extremity of cool-palette creatures refracts light internally — Vaporeon fin glow / Suicune crystal crown prism
  let finCrystalGate=clamp((scene.palette2.b+scene.palette2.g*0.50-scene.palette2.r*2.0+0.40)*3.0,0.0,1.0)*(1.0-metallic)*smoothstep(0.30,0.08,roughness);
  let finEdgeGlow=smoothstep(1.52,1.80,abs(input.worldPosition.x))*finCrystalGate;
  lit=clamp(lit+vec3<f32>(0.36,0.72,1.0)*finEdgeGlow*0.42,vec3<f32>(0.0),vec3<f32>(1.0));
  // === Subsurface scatter (SSS) approximation — smooth surfaces glow warm when back-lit ===
  // Pikachu's pink ear interior, Vaporeon's translucent fins, etc. Only fires on smooth, non-metal surfaces.
  let thinSurface=clamp(1.0-roughness*2.0,0.0,1.0)*(1.0-metallic);
  let sssBackFill=max(0.0,-dot(normal,light))*thinSurface;
  // SSS color: transmitted light through element body — blue water glows blue, fire glows warm, shadow stays dim
  let sssColor=scene.palette2.rgb*clamp(1.05+palBright*0.32,0.88,1.40);
  lit=clamp(lit+sssColor*sssBackFill*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Jellyfish bell translucency: Water/Ice smooth low-roughness surfaces glow from within under backlight (Tentacruel/Jellicent translucent bell)
  let jellyGate=clamp((scene.palette2.b-scene.palette2.r-0.12)*4.0,0.0,1.0)*smoothstep(0.20,0.06,roughness)*(1.0-metallic);
  let jellyBacklit=max(0.0,-dot(normal,light))*jellyGate;
  lit=clamp(lit+scene.palette2.rgb*jellyBacklit*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Thin-geometry catchlight: high screen-curvature + smooth surface → ear tips, claw tips, fin edges catch ambient (Pikachu ear tips / Vaporeon fin glow)
  let thinGlow=smoothstep(0.16,0.46,curvature)*thinSurface;
  lit=clamp(lit+sssColor*thinGlow*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ear tip backlit SSS: thin top-lateral head geometry glows warm-pink when backlit — Pikachu/Mewtwo/Espeon ear glow
  let earTipY=smoothstep(earTopY,earTopY+crownEyeW*1.40,input.worldPosition.y);
  let earTipBack=max(0.0,-dot(normal,light));
  let earTipSSS=earTipY*earLateral*earTipBack*(1.0-metallic)*(1.0-roughness*0.56);
  let earTipColor=mix(vec3<f32>(0.76,0.34,0.42),scene.palette2.rgb,clamp(palBright-0.28,0.0,1.0));
  lit=clamp(lit+earTipColor*earTipSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Organic warm backlit SSS: low-saturation organic skin transmits warm pink-peach body heat when backlit — Eevee/Growlithe/Meowth alive skin quality (blood circulation visible through thin skin, unlike metal or rock)
  let organicBacklit=max(0.0,-dot(bumpNormal,light))*organicSkin*(1.0-metallic);
  lit=clamp(lit+vec3<f32>(0.76,0.34,0.22)*organicBacklit*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wing membrane backlit translucency: thin lateral extremity surfaces allow warm light through when backlit — Charizard/Dragonite wing membranes glow amber-warm through the thin skin when backlit; Swellow/Pidgeot feather tips glow warm-white; this "see-through thin wing" quality is essential to aerial-type Pokemon reading as lightweight and alive
  let wingBumpSSS=max(0.0,-dot(bumpNormal,light))*lateralExt*(1.0-metallic)*0.50;
  let wingSSTint=mix(vec3<f32>(0.78,0.42,0.14),vec3<f32>(0.72,0.84,0.96),clamp(scene.palette2.b-scene.palette2.r,0.0,1.0));
  lit=clamp(lit+wingSSTint*wingBumpSSS*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur velvet directional sheen: organic smooth low-saturation surfaces show a silky upward-flowing highlight from fur microstructure — Eevee/Ninetales/Arcanine glossy fur quality that shifts with fur flow
  let furVelvetGate=furGate*(1.0-metallic)*0.70;
  let furAnisoD=max(0.0,dot(halfVec,vec3<f32>(normal.x*0.38,1.0,normal.z*0.24)));
  let furSheen=pow(furAnisoD,22.0)*furVelvetGate;
  lit=clamp(lit+clamp(scene.palette2.rgb*0.80+vec3<f32>(0.20,0.18,0.14),vec3<f32>(0.0),vec3<f32>(1.0))*furSheen*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crown dome catchlight: bright overhead specular cap at head top — 3D rounded head quality (Pikachu/Eevee crown light)
  let crownH2=smoothstep(crownEyeY+crownEyeW*1.40,crownEyeY+crownEyeW*2.40,input.worldPosition.y);
  let crownCap=crownH2*smoothstep(0.70,0.92,normal.y)*(1.0-roughness*0.56)*(1.0-metallic)*0.28;
  lit=clamp(lit+vec3<f32>(1.0,1.0,1.0)*crownCap,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crown hair anisotropic specular stripe: thin bright horizontal band across the top of the head — anime/3D Pokemon models have a characteristic hair-shine stripe right on the crown; this is from anisotropic fur reflection along the hair flow axis (Pikachu/Eevee/Arcanine hair stripe); on organic-skin creatures only
  let hairStripeY=crownEyeY+crownEyeW*1.90;
  let hairStripeBand=smoothstep(abs(input.worldPosition.y-hairStripeY)-crownEyeW*0.06,abs(input.worldPosition.y-hairStripeY)-crownEyeW*0.16,0.0)*crownH2*furGate*smoothstep(0.38,0.66,normal.y);
  let hairStripeWidth=smoothstep(crownEyeW*0.90,crownEyeW*0.20,abs(input.worldPosition.x));
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*hairStripeBand*hairStripeWidth*(1.0-roughness*0.52)*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur/hair tip brightening: the very distal tip of fur strands catch the most light and appear slightly lighter than mid-fur — Eevee's ear tip, Arcanine's mane tips, Espeon's tail tips; these would be the lightest zone on the fur silhouette in official art; modeled as the region above the hair stripe that gradually brightens
  let furTipY=crownEyeY+crownEyeW*2.60;
  let furTipZone=smoothstep(furTipY,furTipY+crownEyeW*1.20,input.worldPosition.y)*furGate*(1.0-metallic)*smoothstep(0.36,0.60,toon);
  let furTipBright=furTipZone*clamp(palBright-0.20,0.0,1.0)*0.24;
  lit=clamp(lit+mix(vec3<f32>(1.0,0.98,0.94),scene.palette2.rgb*0.80+vec3<f32>(0.20,0.20,0.20),clamp(palBright-0.50,0.0,1.0)*0.60)*furTipBright,vec3<f32>(0.0),vec3<f32>(1.0));

  // Mid-tone saturation peak: cel mid-tone range (lit between 35-75% of full bright) gets vibrancy boost — official Pokemon art has saturated mid-tones, pale highlights, cool shadows
  let lumBody=dot(lit,vec3<f32>(0.299,0.587,0.114));
  let midToneGate=smoothstep(0.30,0.50,lumBody)*smoothstep(0.88,0.66,lumBody)*(1.0-metallic)*0.20;
  lit=clamp(mix(vec3<f32>(lumBody),lit,1.0+midToneGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Face SSS warmth: very subtle warm subsurface radiance in the ring around each eye (skin/blood circulation — Pikachu/Eevee warm face glow)
  let eye0preSSS=eyeMask(input.worldPosition,scene.eye0);
  let eye1preSSS=eyeMask(input.worldPosition,scene.eye1);
  let faceSSS=smoothstep(0.32,0.60,max(eye0preSSS,eye1preSSS))*(1.0-smoothstep(0.60,0.92,max(eye0preSSS,eye1preSSS)))*smoothstep(0.50,0.72,normal.z)*(1.0-metallic);
  lit=clamp(lit+vec3<f32>(0.62,0.28,0.14)*faceSSS*0.07,vec3<f32>(0.0),vec3<f32>(1.0));
  // Expression-influenced face warmth: positive/happy expression brightens cheek warmth — Pikachu excited blush / Eevee happy glow
  let expressionWarm=max(0.0,scene.personality.y)*faceSSS*(1.0-metallic)*0.13;
  lit=clamp(lit+vec3<f32>(0.32,0.09,0.04)*expressionWarm,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shoulder cap catchlight: upper-lateral surfaces at shoulder height catch key light (Blaziken/Arcanine muscle highlight)
  let shoulderCapY=crownEyeY-crownEyeW*1.8;
  let shoulderCap=smoothstep(shoulderCapY,shoulderCapY+crownEyeW*1.0,input.worldPosition.y)*(1.0-smoothstep(shoulderCapY+crownEyeW*1.0,shoulderCapY+crownEyeW*2.2,input.worldPosition.y))*smoothstep(0.36,0.68,abs(normal.x))*smoothstep(0.52,0.78,normal.y)*0.12;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*shoulderCap,vec3<f32>(0.0),vec3<f32>(1.0));
  // Armpit inner shadow: the inner face of raised arms (downward-facing lateral surface at shoulder height) receives deep body-to-arm contact shadow — Mewtwo/Lucario/Blaziken/Charizard armpit areas are always darkly shadowed in official renders; essential for bipeds reading as having distinct arms rather than wide torso wedges
  let armpitY=crownEyeY-crownEyeW*1.52;
  let armpitZone=smoothstep(armpitY-crownEyeW*0.58,armpitY,input.worldPosition.y)*(1.0-smoothstep(armpitY,armpitY+crownEyeW*0.72,input.worldPosition.y));
  let armpitFace=smoothstep(0.38,0.62,abs(normal.x))*smoothstep(-0.06,-0.34,normal.y);
  lit=lit*(1.0-armpitZone*armpitFace*(1.0-metallic)*0.22);
  // Neck-head junction AO: soft shadow where head sphere meets upper neck — creates visual separation between head and body (Pikachu/Eevee/Arcanine head-neck detachment quality)
  let neckJuncY=crownEyeY-crownEyeW*1.30;
  let neckJuncBand=smoothstep(neckJuncY-crownEyeW*0.32,neckJuncY,input.worldPosition.y)*(1.0-smoothstep(neckJuncY,neckJuncY+crownEyeW*0.22,input.worldPosition.y));
  let neckJuncFwd=smoothstep(-0.04,0.52,normal.z)*smoothstep(0.50,0.18,abs(normal.x));
  lit=lit*(1.0-neckJuncBand*neckJuncFwd*0.18);
  // Chest volume forward catchlight: forward-facing chest-height surface catches a broad diffuse highlight — 3D torso volume (Charizard/Arcanine/Blaziken chest forward lighting)
  let chestCapY=crownEyeY-crownEyeW*2.80;
  let chestCatch=smoothstep(chestCapY-crownEyeW*0.50,chestCapY,input.worldPosition.y)*(1.0-smoothstep(chestCapY,chestCapY+crownEyeW*1.40,input.worldPosition.y))*smoothstep(0.30,0.66,normal.z)*smoothstep(0.22,0.04,abs(normal.x))*(1.0-metallic)*0.10;
  lit=clamp(lit+vec3<f32>(0.96,0.95,0.92)*chestCatch,vec3<f32>(0.0),vec3<f32>(1.0));
  // Hip/upper-leg shadow ring: annular AO shadow at the hip joint where legs meet body — anatomical joint depth (Blaziken/Lucario/Charizard hip crease quality) on 60% of creatures (fv ≤ 0.60)
  let hipJuncY=crownEyeY-crownEyeW*3.80;
  let hipBand=smoothstep(hipJuncY-crownEyeW*0.28,hipJuncY,input.worldPosition.y)*(1.0-smoothstep(hipJuncY,hipJuncY+crownEyeW*0.20,input.worldPosition.y));
  let hipLat=smoothstep(0.28,0.56,abs(normal.x));
  lit=lit*(1.0-hipBand*hipLat*step(fv,0.60)*0.16);
  // Body muscle convexity diffuse lift: the broadest forward-facing surface of the torso (chest and upper belly) catches maximum key light diffuse; this is the muscle-bulk broadening highlight that makes creatures look powerful or round depending on body type; more prominent on larger creatures (Charizard/Snorlax/Dragonite broad chest)
  let torsoY=crownEyeY-crownEyeW*2.40;
  let torsoFront=smoothstep(torsoY-crownEyeW*1.20,torsoY,input.worldPosition.y)*(1.0-smoothstep(torsoY,torsoY+crownEyeW*1.60,input.worldPosition.y));
  let torsoFwd=smoothstep(0.42,0.72,normal.z)*smoothstep(0.16,0.04,abs(normal.x))*(1.0-metallic);
  let muscleLift=torsoFront*torsoFwd*smoothstep(0.48,0.70,toon)*0.08;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*muscleLift,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper chest sternum specular: the sternum (center chest line) catches the most direct key light on the front-facing torso — a thin bright vertical stripe at x≈0 in the upper chest zone (Mewtwo/Lucario/Charizard sternum highlight); adds readable chest-depth even without normal maps
  let sternumX=smoothstep(crownEyeW*0.12,crownEyeW*0.04,abs(input.worldPosition.x));
  let sternumY=smoothstep(torsoY-crownEyeW*0.60,torsoY+crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.20,torsoY+crownEyeW*1.0,input.worldPosition.y));
  let sternumFwd=smoothstep(0.50,0.80,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.56,0.78,toon);
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.95)*sternumX*sternumY*sternumFwd*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Round body mid-width specular: on plump/round creatures, the widest cross-section creates a broad diffuse specular band along the lateral equator — Snorlax/Jigglypuff/Pikachu/Blastoise spherical body highlight; the widest zone faces sideways and catches less key light normally, but the gentle wrap of a large soft source creates a wider specular disk at the equatorial zone; gated on both lateral normals and organic bodies
  let midWidthGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.60,toon)*smoothstep(0.40,0.22,roughness);
  let midWidthLat=smoothstep(0.46,0.72,abs(normal.x))*smoothstep(0.16,0.04,abs(normal.y))*smoothstep(0.14,-0.04,abs(normal.z));
  let midWidthY=smoothstep(torsoY-crownEyeW*1.60,torsoY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.60,torsoY+crownEyeW*0.60,input.worldPosition.y));
  let midWidthSpec=pow(max(dot(normal,halfVec),0.0),16.0)*midWidthGate*midWidthLat*midWidthY*specShadowMask;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*midWidthSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sternocleidomastoid neck muscle ridge: the diagonal neck muscle from behind the ear to the sternum creates a diagonal bright ridge on the forward-lateral neck — Mewtwo, Lucario, Blaziken, Machamp all show this diagonal neck muscle catchlight that runs from temple-area to clavicle at ~30° to the vertical; gives the neck sculptural quality and creature intelligence/presence
  let SCMbaseX=crownEyeW*0.38;
  let SCMvec=normalize(vec2<f32>(SCMbaseX,crownEyeY-crownEyeW*0.10)-vec2<f32>(crownEyeW*0.14,crownEyeY+crownEyeW*0.42));
  let SCMproj=abs((input.worldPosition.x-crownEyeW*0.26)*SCMvec.y-(input.worldPosition.y-(crownEyeY-crownEyeW*0.30))*SCMvec.x);
  let SCMband=smoothstep(crownEyeW*0.10,crownEyeW*0.04,SCMproj)*organicSkin*(1.0-metallic)*smoothstep(0.44,0.66,toon)*specShadowMask;
  let SCMlatR=smoothstep(crownEyeW*0.12,crownEyeW*0.44,input.worldPosition.x);
  let SCMlatL=smoothstep(-crownEyeW*0.12,-crownEyeW*0.44,input.worldPosition.x);
  let SCMzone=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.16,crownEyeY+crownEyeW*0.42,input.worldPosition.y));
  let SCMfwd=smoothstep(0.26,0.52,normal.z)*smoothstep(0.22,0.44,abs(normal.x));
  let SCMspec=pow(max(dot(normal,halfVec),0.0),28.0)*SCMband*(SCMlatR+SCMlatL)*SCMzone*SCMfwd;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*SCMspec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Platysma neck tension line: the thin platysma muscle creates a slight diagonal tension ridge running from jaw corner down to lower neck when the creature is in alert stance — visible on Mewtwo, Gardevoir, Gallade as a faint diagonal shadow just lateral to the SCM that parallels and slightly offsets the SCM ridge; gives the neck a multi-layered anatomy read instead of a smooth tube; only on ~45% of creatures (fv > 0.55)
  let platysmaY=smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.30,crownEyeY+crownEyeW*0.24,input.worldPosition.y));
  let platysmaLat=smoothstep(crownEyeW*0.22,crownEyeW*0.48,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.48,crownEyeW*0.72,abs(input.worldPosition.x)))*(1.0-metallic)*organicSkin;
  let platysmaFwd=smoothstep(0.22,0.48,abs(normal.x))*smoothstep(0.08,0.22,normal.z)*smoothstep(0.08,0.22,toon)*step(0.55,fv);
  lit=lit*(1.0-platysmaY*platysmaLat*platysmaFwd*0.12);
  // Cervical lymph node warm SSS: the submandibular lymph node cluster (just under the angle of the jaw, bilaterally) creates a subtle warm rounded bump visible on pale smooth organic creatures — on Gardevoir, Espeon, Mewtwo, Sylveon you can see a faint warmth under the jaw-neck junction that differentiates the jaw underside from the neck; it's warm because it has rich blood supply just below thin skin
  let lymphNodeGate=organicSkin*(1.0-metallic)*smoothstep(0.28,0.06,roughness)*clamp(palBright-0.36,0.0,1.0)*step(fv,0.44)*0.20;
  let lymphLat=smoothstep(crownEyeW*0.20,crownEyeW*0.44,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.44,crownEyeW*0.64,abs(input.worldPosition.x)));
  let lymphY=smoothstep(crownEyeY-crownEyeW*0.18,crownEyeY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.04,crownEyeY+crownEyeW*0.14,input.worldPosition.y));
  let lymphFace=smoothstep(0.24,0.52,normal.z)*smoothstep(-0.04,-0.26,normal.y)*smoothstep(0.10,0.28,abs(normal.x));
  let lymphSSS=max(0.0,-dot(normal,lightDir))*lymphLat*lymphY*lymphFace*lymphNodeGate;
  lit=clamp(lit+vec3<f32>(0.62,0.22,0.16)*lymphSSS*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral body horizon line: the extreme side-facing edge of the torso (x=±max) receives a very faint secondary fill from an implied environment side light — prevents the sides from going uniformly flat and makes the creature appear to occupy a 3D environment (seen in all studio Pokemon renders and Genshin character turn-arounds)
  let lateralHorizon=smoothstep(0.68,0.88,abs(normal.x))*smoothstep(0.18,0.04,abs(normal.z))*smoothstep(0.24,0.04,abs(normal.y))*(1.0-metallic)*smoothstep(0.10,0.28,toon)*smoothstep(0.52,0.36,toon);
  lit=clamp(lit+scene.palette1.rgb*0.54*lateralHorizon*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Rib cage lateral highlight: on lean/thin bipedal creatures, the rib cage creates horizontal ridges on the lateral side of the torso that catch a wider lateral light — Mewtwo's visible rib lines, Garchomp's lean flank, Lucario's angular sides; thin horizontal bright bands at rib intervals on the lateral-facing torso at shoulder-to-waist height; only on creatures with < 0.30 roughness (smooth skin over ribs)
  let ribGate=organicSkin*smoothstep(0.28,0.08,roughness)*(1.0-metallic)*smoothstep(0.40,0.62,toon)*0.36;
  let ribFreq=scale*3.80;
  let ribWave=sin(input.worldPosition.y*ribFreq+fv*2.5)*0.5+0.5;
  let ribBand=smoothstep(0.78,0.90,ribWave)*smoothstep(0.44,0.68,abs(normal.x))*smoothstep(0.14,0.04,abs(normal.y));
  let ribZone=smoothstep(torsoY-crownEyeW*1.80,torsoY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.40,torsoY+crownEyeW*0.40,input.worldPosition.y));
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*ribBand*ribZone*ribGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Knee and elbow joint highlight dots: tiny bright oval at the forward-top of each knee and elbow joint — anatomical prominence catchlights that make limbs read as 3D rounded (Lucario/Blaziken/Arcanine joint quality); two bands at knee and elbow height
  let elbowY=crownEyeY-crownEyeW*2.10;
  let kneeY=crownEyeY-crownEyeW*3.70;
  let kneeBandHL=smoothstep(kneeY-crownEyeW*0.18,kneeY,input.worldPosition.y)*(1.0-smoothstep(kneeY,kneeY+crownEyeW*0.18,input.worldPosition.y));
  // Popliteal hollow shadow: the hollow at the back of the knee (where leg bends) always has deep shadow from self-occlusion — seen on Blaziken/Lucario/Charizard bent-knee stance; the posterior knee is always darker and more occluded; modeled as back-facing at knee-height below knee band
  let poplGate=(1.0-metallic)*smoothstep(0.08,0.24,toon)*smoothstep(0.46,0.26,toon);
  let poplFaceBack=smoothstep(-0.08,-0.40,normal.z)*smoothstep(0.14,0.04,abs(normal.x));
  lit=lit*(1.0-kneeBandHL*poplFaceBack*poplGate*0.24);
  let jointHL=smoothstep(0.50,0.80,abs(normal.x))*smoothstep(0.28,0.58,normal.y)*smoothstep(0.18,0.44,normal.z)*(1.0-metallic)*(1.0-roughness*0.60);
  let elbowBand=smoothstep(elbowY-crownEyeW*0.18,elbowY,input.worldPosition.y)*(1.0-smoothstep(elbowY,elbowY+crownEyeW*0.18,input.worldPosition.y));
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*(elbowBand+kneeBandHL)*jointHL*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Knee cap forward specular: the patella / front-facing kneecap protrusion at the exact knee height catches a forward-facing specular highlight — in all bipedal Pokemon (Lucario, Blaziken, Mewtwo) the knee cap is the hardest most prominent feature at the kneecap height and produces a distinctive elliptical forward specular; biped-specific anatomy detail
  let kneecapFwd=smoothstep(0.44,0.72,normal.z)*smoothstep(0.20,0.06,abs(normal.x))*smoothstep(0.12,-0.16,normal.y)*(1.0-metallic)*smoothstep(0.54,0.76,toon);
  let kneecapSpec=pow(max(dot(normal,halfVec),0.0),72.0)*kneeBandHL*kneecapFwd*specShadowMask;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.94)*kneecapSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Hip iliac crest highlight: the top edge of the iliac crest (hip bone) protrudes just below the lower torso and catches a slight specular from the key light — gives bipeds a distinct hip shape and body-to-leg anatomical separation; Gardevoir's flaring hip, Blaziken's hip-waist junction, Mewtwo's hip bone both protrude slightly and catch this overhead glint; on organic bipeds only
  let hipCrestY=crownEyeY-crownEyeW*1.14;
  let hipCrestBand=smoothstep(0.08,0.0,abs(input.worldPosition.y-hipCrestY)/(crownEyeW*0.12+0.001));
  let hipCrestLat=smoothstep(crownEyeW*0.56,crownEyeW*0.88,abs(input.worldPosition.x))*organicSkin*(1.0-metallic);
  let hipCrestFace=smoothstep(0.28,0.52,normal.y)*smoothstep(0.20,0.04,abs(normal.z))*smoothstep(0.44,0.68,toon)*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*hipCrestBand*hipCrestLat*hipCrestFace*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior superior iliac spine (ASIS) forward specular: the very front-facing point of the hip bone (ASIS), at the most anterior and lateral hip protrusion, catches a tight forward specular when the creature faces front — Mewtwo, Gardevoir, Gallade, Blaziken all have this subtle hip-front highlight just below the waist that gives the pelvis its angular frame; a small forward-facing highlight at hip-front, slightly lateral of center
  let asisY=crownEyeY-crownEyeW*1.22;
  let asisBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-asisY));
  let asisLat=smoothstep(crownEyeW*0.52,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.06,abs(input.worldPosition.x)))*organicSkin*(1.0-metallic);
  let asisSpec=pow(max(dot(normal,halfVec),0.0),56.0)*asisBand*asisLat*smoothstep(0.36,0.62,normal.z)*smoothstep(0.16,0.04,abs(normal.y))*specShadowMask*smoothstep(0.44,0.66,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*asisSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Temporal skull prominence specular: the temporal bone protrusion above and in front of the ear catches overhead light as a small smooth specular — skull top-lateral bone prominence visible on Mewtwo, Charizard, Gardevoir; a subtle rounded specular on the outer-upper face at temple height
  let temporalSpecX=smoothstep(crownEyeW*1.04,crownEyeW*0.64,abs(abs(input.worldPosition.x)-crownEyeW*0.80));
  let temporalSpecY=smoothstep(crownEyeY+crownEyeW*0.30,crownEyeY+crownEyeW*0.64,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.64,crownEyeY+crownEyeW*1.0,input.worldPosition.y));
  let temporalSpecFace=smoothstep(0.38,0.62,normal.y)*smoothstep(0.24,0.48,abs(normal.x))*(1.0-metallic)*smoothstep(0.48,0.68,toon)*specShadowMask;
  let temporalSpec=pow(max(dot(normal,halfVec),0.0),24.0)*temporalSpecX*temporalSpecY*temporalSpecFace;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*temporalSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Palmar warm blush: the inner-facing surface of hands/feet (the palmar/plantar surface) has a warmer, pinker, more vascular skin tone than the dorsal surface — on organic creatures the palm reads as a slightly different color, giving hand anatomy definition; visible on Mewtwo's wide palms, Lucario's blue-palmed hands; modeled as warm tint on backward-facing foot/hand surface at low Y
  let palmarY=crownEyeW*1.30;
  let palmarBand=smoothstep(palmarY-crownEyeW*0.40,palmarY,input.worldPosition.y)*(1.0-smoothstep(palmarY,palmarY+crownEyeW*0.40,input.worldPosition.y));
  let palmarLat=smoothstep(crownEyeW*0.80,crownEyeW*1.20,abs(input.worldPosition.x))*organicSkin*(1.0-metallic);
  let palmarFace=smoothstep(-0.10,-0.44,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*smoothstep(0.06,0.20,toon)*0.12;
  lit=clamp(lit+vec3<f32>(0.24,0.06,0.04)*palmarBand*palmarLat*palmarFace,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-specific palm/sole color: many Pokemon have distinctly different palm/sole colors that signal their element type — Lucario's blue paws (Fighting/Steel/Aura), Mewtwo's pale lavender palms (Psychic), Charizard's cream-orange palms (Fire), Vaporeon's light blue paws (Water); the palm color is an extension of the element palette and is a character-defining mark; the existing palmar warm tint is extended with element-specific accent color
  let palmElemColor=mix(vec3<f32>(0.96,0.76,0.46),scene.palette1.rgb*0.70+vec3<f32>(0.30),0.50)*warmDom+mix(vec3<f32>(0.54,0.74,0.96),scene.palette1.rgb*0.70+vec3<f32>(0.30),0.50)*blueSheen+mix(vec3<f32>(0.86,0.84,0.40),scene.palette1.rgb*0.70+vec3<f32>(0.30),0.50)*elecChargeGate+mix(vec3<f32>(0.78,0.90,0.54),scene.palette1.rgb*0.70+vec3<f32>(0.30),0.50)*plantDom+mix(vec3<f32>(0.72,0.54,0.84),scene.palette1.rgb*0.70+vec3<f32>(0.30),0.50)*pinkDomGate;
  let palmElemStr=clamp(warmDom+blueSheen+elecChargeGate+plantDom+pinkDomGate,0.0,1.0)*organicSkin*(1.0-metallic)*step(fv,0.72);
  let palmElemFace=smoothstep(-0.06,-0.40,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.04,0.18,toon)*0.24;
  base=mix(base,clamp(palmElemColor,vec3<f32>(0.0),vec3<f32>(1.0)),palmarBand*palmarLat*palmElemFace*palmElemStr);
  // Lateral torso plane gradient: body transitions from a brighter front through element-tinted side to a deeper back; this is the single biggest illusion of real volume — the same technique used in Pokemon Sword/Shield NPR shading to give broad-surface creatures (Snorlax, Metagross, Garchomp) massive presence; the side-plane receives a soft element hue shift while the back is desaturated/darkened
  let latSide=smoothstep(0.22,0.60,abs(normal.x))*smoothstep(0.60,0.22,abs(normal.y))*smoothstep(0.04,0.40,toon)*(1.0-metallic)*organicSkin;
  let latBack=smoothstep(-0.08,-0.50,normal.z)*smoothstep(0.30,0.0,abs(normal.x))*smoothstep(0.04,0.28,toon)*(1.0-metallic);
  let elemSideTint=mix(vec3<f32>(0.96,0.44,0.06),scene.palette1.rgb*0.60+vec3<f32>(0.40),0.50)*warmDom+mix(vec3<f32>(0.10,0.26,0.60),scene.palette1.rgb*0.60+vec3<f32>(0.40),0.50)*blueSheen+mix(vec3<f32>(0.92,0.86,0.14),scene.palette1.rgb*0.70+vec3<f32>(0.30),0.50)*elecChargeGate+mix(vec3<f32>(0.22,0.62,0.22),scene.palette1.rgb*0.60+vec3<f32>(0.40),0.50)*plantDom;
  let sideTintStr=clamp(warmDom+blueSheen+elecChargeGate+plantDom,0.0,1.0);
  let neutralSide=vec3<f32>(0.72,0.74,0.78);
  let lateralSideTint=mix(neutralSide,elemSideTint,sideTintStr);
  lit=clamp(lit+lateralSideTint*latSide*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  lit=lit*(1.0-latBack*0.12);
  // Creature core element warmth: faint element-hue radiance concentrated at body center (chest area, near body axis) — creature feels alive, emanating element energy from within (all Pokemon types radiate their essence from their core)
  let coreY=crownEyeY-crownEyeW*2.80;
  let coreProximity=smoothstep(1.20,0.0,abs(input.worldPosition.x))*smoothstep(coreY-crownEyeW*1.20,coreY,input.worldPosition.y)*(1.0-smoothstep(coreY,coreY+crownEyeW*2.0,input.worldPosition.y));
  let coreGlow=coreProximity*(1.0-metallic)*clamp((palBright-0.30)/0.40,0.0,1.0)*0.04;
  lit=clamp(lit+scene.palette2.rgb*coreGlow,vec3<f32>(0.0),vec3<f32>(1.0));
  // === Eye aura — vivid elements (Fire/Electric/Light/Ice/Air) project a faint halo around each eye ===
  // Applied before sclera so the sclera paints cleanly on top; only the outer ring stays visible.
  // Dark/matte elements (Shadow/Earth/Water) have palBright ≤ 0.50, so glowStr ≈ 0 and this is a no-op.
  let eye0pre=eye0preSSS;
  let eye1pre=eye1preSSS;
  // Ear tip SSS backlight: thin ear pinnae transmit warm blood-pink light when backlit — Eevee, Pikachu, Sylveon, Glaceon ears glow pinkish-red when they're between viewer and light; the thinner the tip the stronger the glow; this is the "rabbit ear held up to sun" effect
  let earTipSSSZone=smoothstep(earTopY+crownEyeW*0.30,earTopY+crownEyeW*1.20,input.worldPosition.y)*earLateral*(1.0-msMet)*organicSkin;
  let earTipSSSBack=max(0.0,-dot(normal,lightDir))*smoothstep(0.04,0.24,toon)*0.34;
  lit=clamp(lit+mix(vec3<f32>(0.60,0.14,0.10),scene.palette2.rgb*0.60+vec3<f32>(0.40),clamp(palBright-0.20,0.0,1.0))*earTipSSSZone*earTipSSSBack*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Zygomatic cheekbone arch specular: the cheekbone prominence below the outer eye catches a bright forward-up specular — makes the face look sculpted and high-cheeked (Mewtwo, Gardevoir, Lucario, Zoroark all have prominent zygomatic ridge that catches light); visible from 3/4 angle and front
  let zygomX=smoothstep(crownEyeW*0.56,crownEyeW*1.0,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.0,crownEyeW*1.36,abs(input.worldPosition.x)));
  let zygomY=smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.68,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.68,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let zygomFace=smoothstep(0.38,0.62,normal.y)*smoothstep(0.18,0.38,abs(normal.x))*smoothstep(0.08,-0.04,abs(normal.z))*(1.0-metallic)*organicSkin*smoothstep(0.44,0.66,toon)*specShadowMask;
  let zygomSpec=pow(max(dot(normal,halfVec),0.0),22.0)*zygomX*zygomY*zygomFace;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*zygomSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Infraorbital rim highlight: the flat bone shelf just below each eye socket (the infraorbital margin of the zygomatic-maxilla junction) catches overhead key light as a faint horizontal lit plane — Mewtwo, Gardevoir, Espeon, Gallade show this subtle flat-lit surface below the eye that separates the dark socket from the lit cheek; without it the face reads as uniformly lit from eye to chin; narrow horizontal strip just below eye center, forward-and-slightly-upward facing
  let infraOrbY0=scene.eye0.y-scene.eye0.w*0.58;
  let infraOrbY1=scene.eye1.y-scene.eye1.w*0.58;
  let infraOrb0=smoothstep(crownEyeW*0.06,crownEyeW*0.0,abs(input.worldPosition.y-infraOrbY0))*smoothstep(scene.eye0.w*0.60,scene.eye0.w*0.16,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let infraOrb1=smoothstep(crownEyeW*0.06,crownEyeW*0.0,abs(input.worldPosition.y-infraOrbY1))*smoothstep(scene.eye1.w*0.60,scene.eye1.w*0.16,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let infraOrbFace=smoothstep(0.36,0.58,normal.y)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.06,-0.04,abs(normal.z))*(1.0-metallic)*organicSkin*smoothstep(0.44,0.66,toon)*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*max(infraOrb0,infraOrb1)*infraOrbFace*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  let eyePreBlend=max(eye0pre,eye1pre);
  let eyeAura=smoothstep(0.0,0.15,eyePreBlend)*(1.0-smoothstep(0.15,0.38,eyePreBlend));
  let eyeGlowStr=clamp((palBright-0.55)/0.38,0.0,1.0);
  lit=clamp(lit+scene.palette2.rgb*eyeAura*eyeGlowStr*0.48,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow/Dark type eerie eye glow: dark creatures emit supernatural palette aura (Gengar/Darkrai/Spiritomb)
  let shadowEyeGlowStr=clamp((0.32-palBright)*5.0,0.0,1.0)*(1.0-metallic);
  lit=clamp(lit+scene.palette1.rgb*eyeAura*shadowEyeGlowStr*0.36,vec3<f32>(0.0),vec3<f32>(1.0));

  // === Eye socket shadow — dark ring at eye perimeter: Pokemon eyes look "set into" the face ===
  let eyeSocketBlend=max(smoothstep(0.0,0.05,eye0pre)*(1.0-smoothstep(0.05,0.18,eye0pre)),smoothstep(0.0,0.05,eye1pre)*(1.0-smoothstep(0.05,0.18,eye1pre)));
  lit=lit*(1.0-eyeSocketBlend*0.36);
  // Under-eye shadow: subtle crescent of deeper shadow just below each eye — face depth and expression (Charizard/Blastoise/Garchomp under-eye crease quality)
  let underEye0=clamp((scene.eye0.y-input.worldPosition.y-scene.eye0.w*0.30)/(scene.eye0.w*0.48),0.0,1.0)*smoothstep(scene.eye0.w*1.40,scene.eye0.w*0.68,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)));
  let underEye1=clamp((scene.eye1.y-input.worldPosition.y-scene.eye1.w*0.30)/(scene.eye1.w*0.48),0.0,1.0)*smoothstep(scene.eye1.w*1.40,scene.eye1.w*0.68,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)));
  lit=lit*(1.0-max(underEye0,underEye1)*0.18);
  // Brow shadow cast on upper eye: overhanging brow ridge casts contact shadow onto top of eye socket — deepens facial expression (Charizard/Lucario/Gengar heavy-brow shadow quality); present on 58% of creatures (fv ≥ 0.42)
  let brow0Cast=smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.08,input.worldPosition.y)*smoothstep(crownEyeY-crownEyeW*0.04,crownEyeY+crownEyeW*0.08,input.worldPosition.y)*smoothstep(crownEyeW*1.10,crownEyeW*0.50,abs(input.worldPosition.x))*smoothstep(0.22,0.54,normal.z)*(1.0-msMet)*step(0.42,fv);
  lit=lit*(1.0-brow0Cast*0.16);
  // Deep eye socket AO: the eye sits recessed in the skull — a diffuse darkening ring in the outer socket rim (between eye edge and brow base) simulates contact AO from the bony socket walls; making eyes look sunken and expressive rather than surface-applied (Mewtwo/Gardevoir/Gengar deep-set eye quality)
  let socketAO0=smoothstep(scene.eye0.w*1.62,scene.eye0.w*0.92,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*(1.0-eye0pre)*smoothstep(crownEyeW*0.90,crownEyeW*0.30,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let socketAO1=smoothstep(scene.eye1.w*1.62,scene.eye1.w*0.92,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*(1.0-eye1pre)*smoothstep(crownEyeW*0.90,crownEyeW*0.30,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  lit=lit*(1.0-max(socketAO0,socketAO1)*0.22);
  // Temporal fossa shadow: the shallow depression between the brow ridge and cheekbone at the temple catches very little light — present on all bipedal creature faces; in Pokemon art it reads as a subtle darkening region at the side-top of the face (Charizard, Mewtwo, Garchomp temple shadow)
  let templeX=smoothstep(crownEyeW*1.10,crownEyeW*0.52,abs(input.worldPosition.x));
  let templeYZone=smoothstep(crownEyeY-crownEyeW*0.24,crownEyeY+crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.20,crownEyeY+crownEyeW*0.70,input.worldPosition.y));
  let templeLat=smoothstep(0.16,0.42,abs(normal.x))*smoothstep(0.22,0.06,abs(normal.z))*(1.0-metallic);
  lit=lit*(1.0-templeX*templeYZone*templeLat*0.18);

  // Inter-eye nose bridge highlight: the narrow vertical strip of face between and above the two eyes catches direct forward key light and is brighter than the surrounding eye sockets — gives dimensional nasal bridge (Pikachu/Eevee nose bridge catchlight that separates left/right eye sockets)
  let bridgeX=smoothstep(crownEyeW*0.42,crownEyeW*0.12,abs(input.worldPosition.x));
  let bridgeY=smoothstep(crownEyeY-crownEyeW*0.10,crownEyeY+crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.60,input.worldPosition.y));
  let bridgeFwd=smoothstep(0.42,0.68,normal.z)*smoothstep(0.16,0.04,abs(normal.x))*(1.0-metallic);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*bridgeX*bridgeY*bridgeFwd*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Back-of-head sphere shadow: the posterior of the cranium sphere is away from forward key light and receives no specular — creates the essential head-sphere shadow gradient; without this, the head looks like a flat disc instead of a sphere (every 3D Pokemon head has this back-cap shadow)
  let backHeadShadow=smoothstep(-0.06,-0.46,normal.z)*smoothstep(crownEyeY+crownEyeW*0.80,crownEyeY+crownEyeW*2.20,input.worldPosition.y)*(1.0-metallic)*0.18;
  lit=lit*(1.0-backHeadShadow*0.24);
  // === Face features ===
  let eye0=eye0pre;  // reuse pre-computed mask from aura pass
  let eye1=eye1pre;
  let eyeBlend=max(eye0,eye1);
  let pupilBlend=max(pupilMask(input.worldPosition,scene.eye0),pupilMask(input.worldPosition,scene.eye1));
  let mouthBlend=mouthMask(input.worldPosition);
  let glintBlend=max(glintMask(input.worldPosition,scene.eye0),glintMask(input.worldPosition,scene.eye1));
  let glint2Blend=max(glint2Mask(input.worldPosition,scene.eye0),glint2Mask(input.worldPosition,scene.eye1));
  let glint3Blend=max(glint3Mask(input.worldPosition,scene.eye0),glint3Mask(input.worldPosition,scene.eye1));
  let browBlend=max(browMask(input.worldPosition,scene.eye0),browMask(input.worldPosition,scene.eye1));
  // Cheeks on 42% of creatures (fv >= 0.58), nose dots on 85% (fv <= 0.85)
  let cheekBlend=max(cheekMask(input.worldPosition,scene.eye0),cheekMask(input.worldPosition,scene.eye1))*step(0.58,fv);
  let noseBlend=noseMask(input.worldPosition)*step(fv,0.85);

  // Iris color: vivid palette shade that contrasts against the white sclera.
  // For dark elements (Shadow/Water/Electric): palette2*1.55 is vivid and readable.
  // For light elements (Air/Ice/Light/Metal): palette2 is near-white → use palette0*1.2 instead.
  let irisFromLight=clamp(scene.palette2.rgb*1.55,vec3<f32>(0.0),vec3<f32>(1.0));
  let irisFromDark=clamp(scene.palette0.rgb*1.20,vec3<f32>(0.0),vec3<f32>(1.0));
  let irisColor=select(irisFromLight,irisFromDark,palBright>=0.72);
  // Iris depth luminance gradient: the iris of a real eye is not uniformly colored — the pupillary zone (center) is darker/deeper and the peripheral zone (limbal ring edge) is darker too, with the brightest zone in a torus at ~60-70% radius; mimics the convex lens-over-iris depth cue that gives eyes a glass-ball roundness (Espeon/Gardevoir/Vaporeon eye depth)
  let irisDepthRing=smoothstep(0.50,0.64,eyeBlend)*(1.0-smoothstep(0.64,0.78,eyeBlend));
  let irisDepthDark=smoothstep(0.78,0.64,eyeBlend)*0.12+smoothstep(0.44,0.56,eyeBlend)*0.08;
  // Iris fills the full inner eye (between outline ring and pupil) — the Pokemon way
  let irisInner=smoothstep(0.44,0.72,eyeBlend);
  let irisBlend=irisInner*(1.0-clamp(pupilBlend*2.8,0.0,1.0));
  // Iris radial striation lines: the iris has fine radial fibers visible at close range — Espeon, Gardevoir, Vaporeon, Sylveon eyes show radiating fiber lines in the iris creating a flower-like texture; modeled as a low-amplitude sine-based pattern radiating from iris center; adds the biological detail that separates photorealistic game eyes from anime-flat circles
  let eyeCenter=select(scene.eye0.xy,scene.eye1.xy,eye1pre>eye0pre);
  let eyeR=select(scene.eye0.w,scene.eye1.w,eye1pre>eye0pre);
  let striaDelta=input.worldPosition.xy-eyeCenter;
  let striaAngle=atan2(striaDelta.y,striaDelta.x);
  let striaDist=length(striaDelta)/max(eyeR,0.001);
  let striaLine=sin(striaAngle*12.0+fv*6.28)*0.5+0.5;
  let striaBlend=smoothstep(0.20,0.40,striaDist)*(1.0-smoothstep(0.70,0.90,striaDist))*max(eye0pre,eye1pre)*irisInner*step(fv,0.62)*0.18;
  let striaDark=smoothstep(0.82,0.95,striaLine)*striaBlend;
  let striaLight=smoothstep(0.05,0.20,striaLine)*(1.0-smoothstep(0.20,0.40,striaLine))*striaBlend;

  // Sclera: element-tinted eye whites — Fire warm-cream, Water cool-blue, Electric faint yellow, Shadow lilac-gray
  let scleraBase=vec3<f32>(0.95,0.97,1.00);
  let scleraWarmGate=clamp((scene.palette2.r-scene.palette2.g*0.60-scene.palette2.b-0.18)*2.8,0.0,1.0);
  let scleraCoolGate=clamp((scene.palette2.b-scene.palette2.r-0.10)*2.5,0.0,1.0);
  let scleraElecGate=clamp((scene.palette2.r+scene.palette2.g-scene.palette2.b*2.80-0.30)*2.5,0.0,1.0);
  let scleraVoidGate=clamp((0.42-palBright)*3.0,0.0,1.0)*(1.0-metallic);
  let scleraTint=clamp(scleraBase+scleraWarmGate*vec3<f32>(0.04,-0.03,-0.12)*0.48+scleraCoolGate*vec3<f32>(-0.07,-0.03,0.04)*0.48+scleraElecGate*vec3<f32>(0.03,0.01,-0.14)*0.44+scleraVoidGate*vec3<f32>(-0.09,-0.09,-0.04)*0.40,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sclera top-to-bottom luminance gradient: the upper sclera is slightly darker (in shadow from the eyelid) and the lower sclera is slightly brighter (lit from below) — all Pixar/Pokemon/Genshin 3D eye renders show this gradient on the whites; without it, the whites look flat and uniform; subtle but critical for eye realism
  let scleraTopDark=clamp((input.worldPosition.y-select(scene.eye0.y,scene.eye1.y,eye1pre>eye0pre))/(select(scene.eye0.w,scene.eye1.w,eye1pre>eye0pre)*0.60),0.0,1.0);
  let scleraGraded=mix(scleraTint*1.06,scleraTint*0.90,scleraTopDark);
  lit=mix(lit,clamp(scleraGraded,vec3<f32>(0.0),vec3<f32>(1.0)),smoothstep(0.02,0.18,eyeBlend)*0.98);
  // Eye dome specular: Digimon Cyber Sleuth-style large soft specular dome covering the entire eye sphere — makes eyes look like smooth glass spheres with a broad highlight from the key light; this is distinct from the iris rim spec and catch-lights; it's the wide ambient-like gloss on the eyeball surface (all 3D Digimon Cyber Sleuth and Pokemon character eyes)
  let eyeDomeSpec=smoothstep(0.02,0.70,eyeBlend)*softSpec*(1.0-roughness*0.40)*0.60;
  lit=clamp(lit+vec3<f32>(0.88,0.92,0.98)*eyeDomeSpec*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sclera wet film: broad specular dome on the moist eye surface — makes eyes look alive (all Pokemon/Digimon eyes)
  let scleraRim=smoothstep(0.02,0.20,eyeBlend)*(1.0-smoothstep(0.20,0.68,eyeBlend));
  lit=clamp(lit+vec3<f32>(0.94,0.97,1.0)*scleraRim*softSpec*2.40,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dark outline ring: crisp contour between sclera and iris — signature Pokemon eye shape
  let eyeOutline=smoothstep(0.08,0.24,eyeBlend)*(1.0-smoothstep(0.52,0.70,eyeBlend));
  lit=mix(lit,vec3<f32>(0.02,0.02,0.02),eyeOutline*0.94);          // dark eye outline ring
  // Iris: radial gradient — center 32% brighter; outer edge slightly darker for "deep eye" ring (Pokemon standard)
  let irisHighlight=clamp(irisColor*1.32,vec3<f32>(0.0),vec3<f32>(1.0));
  let irisGrad=mix(irisColor,irisHighlight,irisInner*0.65);
  let irisEdgeDark=smoothstep(0.72,0.50,eyeBlend)*0.22;
  // Apply depth ring brightening in the bright torus zone then overall darkening at center and edge
  let irisFinalPre=irisGrad*(1.0-irisEdgeDark);
  let irisFinal=clamp(irisFinalPre*(1.0+irisDepthRing*0.22)*(1.0-irisDepthDark),vec3<f32>(0.0),vec3<f32>(1.0));
  lit=mix(lit,irisFinal,irisBlend*0.96);                            // vivid element-colored iris fills eye
  // Apply iris striation — darkens at fiber lines and brightens between them
  lit=clamp(lit*(1.0-striaDark*0.22)+lit*striaLight*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris/sclera boundary chromatic aberration fringe: right at the outer edge of the iris, the corneal lens refracts light differently by wavelength — a faint chromatic fringe: red on one side, blue on the other; in Pokemon 3D eye renders and Genshin close-up shots this fringe is subtle but present; it's the optical quality that distinguishes glass-ball eyes from plastic eyes; only visible at the iris boundary ring
  let chromFringeDist=select(length(input.worldPosition.xy-scene.eye0.xy)/max(scene.eye0.w,0.001),length(input.worldPosition.xy-scene.eye1.xy)/max(scene.eye1.w,0.001),eye1pre>eye0pre);
  let chromFringeRing=smoothstep(0.34,0.38,chromFringeDist)*(1.0-smoothstep(0.38,0.44,chromFringeDist));
  let chromFringeEye=max(eye0pre,eye1pre)*irisBlend*chromFringeRing*0.20;
  lit=clamp(lit+vec3<f32>(0.36,0.0,-0.24)*chromFringeEye,vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris-rim specular ring: bright ring at outer iris perimeter — glassy spherical sheen between iris and outline (all 3D Pokemon models)
  let irisRimSpec=smoothstep(0.46,0.56,eyeBlend)*(1.0-smoothstep(0.58,0.68,eyeBlend));
  lit=mix(lit,clamp(irisFinal*1.48+vec3<f32>(0.08,0.04,0.0),vec3<f32>(0.0),vec3<f32>(1.0)),irisRimSpec*0.42);
  // Iris radial spokes: subtle darker sector lines within iris — Gardevoir/Mewtwo/Lucario iris texture depth
  let irisVec0=(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z));
  let irisVec1=(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z));
  let irisAngle=select(atan2(irisVec0.x,irisVec0.y),atan2(irisVec1.x,irisVec1.y),eye1pre>eye0pre);
  let irisSpoke=sin(irisAngle*6.0)*0.5+0.5;
  let irisSpokeBlend=smoothstep(0.44,0.70,eyeBlend)*(1.0-smoothstep(0.70,0.84,eyeBlend))*smoothstep(0.58,0.72,irisSpoke)*0.18;
  lit=clamp(lit*mix(1.0,0.82,irisSpokeBlend),vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris micro-texture: within the iris region, fine hash noise produces subtle variation in the iris color — the real iris has fibrous texture; this is a faint stochastic variation that prevents the iris from looking like a flat color disc; visible in close-up renders of Pokemon 3D models and Genshin eyes; intensity is low (≈4%) to avoid overwhelming the iris color
  let irisCell=floor(input.worldPosition.xyz*140.0+vec3<f32>(fv*17.0,fv*11.0,fv*9.0));
  let irisTexH=fract(sin(dot(irisCell,vec3<f32>(127.1,311.7,74.7)))*43758.545)*2.0-1.0;
  let irisTexBlend=irisBlend*(1.0-smoothstep(0.64,0.80,eyeBlend))*0.06;
  lit=clamp(lit*(1.0+irisTexH*irisTexBlend),vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris center warmth gradient: the pupillary zone of the iris (center 30-40%) is subtly warmer/more amber than the peripheral iris — this is caused by the reflective tapetum lucidum behind the pupil radiating warm amber back through the iris; in high-quality anime/Pokemon eyes (Espeon, Gardevoir, Sylveon, Togekiss) the iris center glows slightly more golden-warm than the outer iris; this prevents the iris from being a single flat hue and adds the "lit from within" quality
  let irisCenterWarm=smoothstep(0.64,0.76,eyeBlend)*irisBlend*(1.0-smoothstep(0.0,0.24,toon))*0.14;
  lit=clamp(lit+vec3<f32>(0.28,0.12,-0.04)*irisCenterWarm,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lower iris crescent: bright aqua-white highlight at iris bottom — anime eye depth (Pikachu/Eevee eye quality)
  let irisLow0=clamp((scene.eye0.y-input.worldPosition.y)/(scene.eye0.w*0.42),0.0,1.0)*eye0pre;
  let irisLow1=clamp((scene.eye1.y-input.worldPosition.y)/(scene.eye1.w*0.42),0.0,1.0)*eye1pre;
  let irisLowBlend=max(irisLow0,irisLow1);
  lit=mix(lit,clamp(mix(irisFinal,vec3<f32>(0.70,0.88,1.0),0.52)*1.15,vec3<f32>(0.0),vec3<f32>(1.0)),irisLowBlend*irisBlend*0.46);
  // Upper iris shadow: slight darkening at iris top from virtual eyelid — deeper, more expressive eye (Pikachu/Eevee quality)
  let irisTop0=clamp((input.worldPosition.y-scene.eye0.y)/(scene.eye0.w*0.42),0.0,1.0)*eye0pre;
  let irisTop1=clamp((input.worldPosition.y-scene.eye1.y)/(scene.eye1.w*0.42),0.0,1.0)*eye1pre;
  let irisTopBlend=max(irisTop0,irisTop1);
  lit=mix(lit,irisFinal*0.74,irisTopBlend*irisBlend*0.30);
  // Pupil shape variant: ~28% of creatures (fv < 0.28) have vertical-slit reptile pupils — Arbok/Seviper/Gyarados/Rayquaza slit pupil instead of round; the slit is computed by masking the round pupil with a vertical band
  let pupilSlit=clamp(1.0-abs(input.worldPosition.x-select(scene.eye0.x,scene.eye1.x,eye1pre>eye0pre))/(select(scene.eye0.w,scene.eye1.w,eye1pre>eye0pre)*0.18),0.0,1.0);
  let pupilFinal=mix(pupilBlend,pupilBlend*pupilSlit,step(fv,0.28));
  lit=mix(lit,vec3<f32>(0.016,0.010,0.032),pupilFinal);             // near-black pupil (round or slit)
  // Shadow/Dark type eye glow: dark-palette creatures emit element-color radiance from eye ring and pupil — Gengar red eyes, Darkrai crimson glow, Chandelure flame pupils; the single most recognizable Shadow Pokemon visual identity
  let shadowEyeGate=clamp((0.38-palBright)/0.18,0.0,1.0)*(1.0-metallic);
  let eyeGlowRing=smoothstep(0.44,0.72,eyeBlend)*(1.0-smoothstep(0.72,0.92,eyeBlend));
  lit=clamp(lit+scene.palette1.rgb*1.40*eyeGlowRing*shadowEyeGate*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  lit=clamp(lit+scene.palette2.rgb*1.30*pupilBlend*shadowEyeGate*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pupil void depth gradient: the pupil is not uniform black but has a subtle radial depth gradient — the very center of the pupil is fractionally lighter (the fundus reflex) while the outer pupil edge is the darkest black; this "deep hole" gradient is what makes anime/game pupils look like real eyes with depth rather than flat discs; creates the illusion that the pupil extends inward through the eye body
  let pupDepthDist0=length(input.worldPosition.xy-scene.eye0.xy)/(scene.eye0.w*0.22+0.001);
  let pupDepthDist1=length(input.worldPosition.xy-scene.eye1.xy)/(scene.eye1.w*0.22+0.001);
  let pupDepthRing=max(smoothstep(1.0,0.60,pupDepthDist0)*pupilBlend*eye0pre,smoothstep(1.0,0.60,pupDepthDist1)*pupilBlend*eye1pre);
  let pupDepthCenter=max(smoothstep(0.18,0.0,pupDepthDist0)*eye0pre,smoothstep(0.18,0.0,pupDepthDist1)*eye1pre)*pupilBlend;
  lit=mix(lit,vec3<f32>(0.01,0.008,0.016),pupDepthRing*0.70);
  lit=mix(lit,vec3<f32>(0.06,0.04,0.10),pupDepthCenter*0.42);
  // Pupil depth point: tiny purple-blue inner reflection above-center of pupil — eye depth cue (anime/Pokemon quality eyes)
  let pupRef0=smoothstep(scene.eye0.w*0.11,scene.eye0.w*0.04,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y+scene.eye0.w*0.09,scene.eye0.z)))*eye0pre;
  let pupRef1=smoothstep(scene.eye1.w*0.11,scene.eye1.w*0.04,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y+scene.eye1.w*0.09,scene.eye1.z)))*eye1pre;
  lit=mix(lit,vec3<f32>(0.18,0.14,0.38),max(pupRef0,pupRef1)*0.72);
  // Pupil internal catchlight: tiny white star within dark pupil — distinguishes alive eyes from glass-bead quality (Pokemon 3D model standard)
  let pupGL0=smoothstep(scene.eye0.w*0.07,scene.eye0.w*0.02,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x+scene.eye0.w*0.07,scene.eye0.y+scene.eye0.w*0.13,scene.eye0.z)))*eye0pre;
  let pupGL1=smoothstep(scene.eye1.w*0.07,scene.eye1.w*0.02,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x+scene.eye1.w*0.07,scene.eye1.y+scene.eye1.w*0.13,scene.eye1.z)))*eye1pre;
  lit=mix(lit,vec3<f32>(0.94,0.97,1.0),max(pupGL0,pupGL1)*0.82);
  // Secondary eye catchlight: smaller cooler reflection lower-left — twin-catchlight eyes give alive expressive quality (anime/Pokemon standard)
  let pupSec0=smoothstep(scene.eye0.w*0.055,scene.eye0.w*0.018,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x-scene.eye0.w*0.14,scene.eye0.y-scene.eye0.w*0.09,scene.eye0.z)))*eye0pre;
  let pupSec1=smoothstep(scene.eye1.w*0.055,scene.eye1.w*0.018,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x-scene.eye1.w*0.14,scene.eye1.y-scene.eye1.w*0.09,scene.eye1.z)))*eye1pre;
  lit=mix(lit,vec3<f32>(0.68,0.80,0.96),max(pupSec0,pupSec1)*0.40);
  // Cornea diffraction star: at the exact center of the main catchlight, the cornea surface creates a faint 4-point star diffraction pattern — visible in Pokemon Sword/Shield 3D models and Genshin Impact close-up renders; the star arms extend horizontally and vertically from the brightest catchlight point; only 25% of creatures (fv < 0.25) where eye is very clear and large
  let domEye=select(scene.eye0,scene.eye1,eye1pre>eye0pre);
  let domEyePre=max(eye0pre,eye1pre);
  let starCenter=input.worldPosition.xyz-vec3<f32>(domEye.x+domEye.w*0.08,domEye.y+domEye.w*0.14,domEye.z);
  let starArmH=clamp(1.0-abs(starCenter.y)/(domEye.w*0.03),0.0,1.0)*smoothstep(domEye.w*0.18,domEye.w*0.04,abs(starCenter.x));
  let starArmV=clamp(1.0-abs(starCenter.x)/(domEye.w*0.03),0.0,1.0)*smoothstep(domEye.w*0.18,domEye.w*0.04,abs(starCenter.y));
  let starDiffract=max(starArmH,starArmV)*domEyePre*step(fv,0.25)*irisBlend;
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*starDiffract*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Eye iris orbit ring highlight: a thin bright crescent-ring just at the border between sclera and iris limbal zone — present in all high-quality 3D eye renders including Pokemon Sword/Shield and Genshin; this limbal ring highlight adds the final dimensionality cue that the iris is a sphere set behind a cornea lens; makes the eye look convex and alive at the point of maximum glass effect
  let irisOrbit0=smoothstep(scene.eye0.w*0.26,scene.eye0.w*0.18,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*(1.0-smoothstep(scene.eye0.w*0.18,scene.eye0.w*0.10,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z))))*eye0pre;
  let irisOrbit1=smoothstep(scene.eye1.w*0.26,scene.eye1.w*0.18,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*(1.0-smoothstep(scene.eye1.w*0.18,scene.eye1.w*0.10,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z))))*eye1pre;
  lit=clamp(lit+vec3<f32>(0.84,0.90,0.98)*max(irisOrbit0,irisOrbit1)*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris limbal dark ring: the very outermost edge of the iris, where it meets the sclera, is always the darkest part of the iris — the limbal ring is biologically the boundary of the cornea; in all high-quality Pokemon/Digimon eyes (Pikachu, Eevee, Lucario, Renamon, Agumon) the limbal ring is a clearly visible dark circle that defines the iris shape; without it eyes look soft and flat
  let limb0Dist=length(input.worldPosition.xy-scene.eye0.xy);
  let limb1Dist=length(input.worldPosition.xy-scene.eye1.xy);
  let limbalRing0=smoothstep(scene.eye0.w*0.32,scene.eye0.w*0.28,limb0Dist)*(1.0-smoothstep(scene.eye0.w*0.28,scene.eye0.w*0.20,limb0Dist))*eye0pre*irisBlend;
  let limbalRing1=smoothstep(scene.eye1.w*0.32,scene.eye1.w*0.28,limb1Dist)*(1.0-smoothstep(scene.eye1.w*0.28,scene.eye1.w*0.20,limb1Dist))*eye1pre*irisBlend;
  lit=lit*(1.0-max(limbalRing0,limbalRing1)*0.38);
  // Upper eyelid palpebral gloss: the very top edge of the upper eyelid (the palpebral border where lash line meets sclera) catches a narrow specular glint — this thin bright crescent just above the iris at the 11-1 o'clock position is what gives Pokemon/Genshin eyes their "dewy eyelid" quality; makes eyes look like they have a wet, slightly curved eyelid catching the key light
  let lidTopGloss0=clamp(1.0-abs(input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.56))/(scene.eye0.w*0.08),0.0,1.0)*smoothstep(scene.eye0.w*0.60,scene.eye0.w*0.20,abs(input.worldPosition.x-scene.eye0.x))*eye0pre*(1.0-irisBlend);
  let lidTopGloss1=clamp(1.0-abs(input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.56))/(scene.eye1.w*0.08),0.0,1.0)*smoothstep(scene.eye1.w*0.60,scene.eye1.w*0.20,abs(input.worldPosition.x-scene.eye1.x))*eye1pre*(1.0-irisBlend);
  lit=clamp(lit+vec3<f32>(0.90,0.92,0.96)*max(lidTopGloss0,lidTopGloss1)*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Horizontal catchlight streak: thin bright bar across upper iris — "window reflection" seen in all modern Pokemon/Digimon 3D eyes
  let hclBand0=clamp(1.0-abs(input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.20))/(scene.eye0.w*0.054),0.0,1.0)*smoothstep(scene.eye0.w*0.54,scene.eye0.w*0.16,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let hclBand1=clamp(1.0-abs(input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.20))/(scene.eye1.w*0.054),0.0,1.0)*smoothstep(scene.eye1.w*0.54,scene.eye1.w*0.16,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  lit=mix(lit,vec3<f32>(0.96,0.98,1.0),max(hclBand0,hclBand1)*irisBlend*0.56);
  // Eye environment reflection: the glassy cornea surface reflects a blurred version of the surrounding environment — in all Pokemon 3D renders and Genshin eyes, the iris has a broad low-opacity reflection of the sky (top-half bright/blue) and ground (bottom-half warm/dark); this gives depth and life without a real reflection probe
  let eyeEnvDir=vec3<f32>(0.0,1.0,0.0);  // sky direction
  let eyeEnvRefl=max(dot(normal,eyeEnvDir),0.0);
  let eyeEnvGround=max(-dot(normal,eyeEnvDir),0.0);
  let eyeEnvSky=vec3<f32>(0.38,0.56,0.80)*eyeEnvRefl*0.22;
  let eyeEnvFloor=vec3<f32>(0.32,0.22,0.14)*eyeEnvGround*0.10;
  let eyeEnvBlend=smoothstep(0.46,0.70,eyeBlend)*(1.0-smoothstep(0.70,0.86,eyeBlend));
  lit=clamp(lit+clamp(eyeEnvSky+eyeEnvFloor,vec3<f32>(0.0),vec3<f32>(1.0))*eyeEnvBlend*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-tinted mouth: base dark-pink shifts toward element palette0 for warmer/cooler personality (Charizard warm / Vaporeon cool / Gengar dark)
  let mouthTint=mix(vec3<f32>(0.22,0.042,0.068),clamp(scene.palette0.rgb*0.68,vec3<f32>(0.0),vec3<f32>(1.0)),clamp((palBright-0.30)/0.40,0.0,1.0)*0.32);
  lit=mix(lit,mouthTint,mouthBlend);
  // Tongue interior: graduated red-pink in the lower half of the mouth cavity — inner mouth tissue (Pikachu/Eevee/Arcanine open mouth detail)
  let tongueDepth=clamp((scene.mouth.y-input.worldPosition.y)/max(scene.mouth.w,0.001)*1.40,0.0,1.0);
  let tongueTint=mix(vec3<f32>(0.68,0.16,0.20),vec3<f32>(0.82,0.28,0.24),tongueDepth*0.60);
  lit=mix(lit,tongueTint,mouthBlend*tongueDepth*0.36);
  // Tongue wet-gloss SSS: the tongue is a highly vascular, wet, translucent organ — it has strong SSS where backlit light transmits through the tongue body making it glow dark-red; in all high-quality Pokemon renders (Pikachu, Eevee, Arcanine lolling tongue) the tongue tip in backlight has a deep warm-red transmitted SSS distinct from the normal diffuse pink; the surface gloss is also higher than skin
  let tongueWetSSS=mouthBlend*(1.0-tongueDepth)*max(0.0,-dot(normal,lightDir))*smoothstep(0.08,0.26,toon)*0.30;
  lit=clamp(lit+vec3<f32>(0.40,0.04,0.02)*tongueWetSSS*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  let tongueGlossSpec=pow(max(dot(normal,halfVec),0.0),90.0)*mouthBlend*(1.0-tongueDepth*0.60)*smoothstep(0.38,0.62,normal.z)*smoothstep(0.44,0.66,toon)*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.94,0.88,0.86)*tongueGlossSpec*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tongue tip brightening: the very tip of the tongue (farthest from throat, lowest tongueDepth) catches overhead light and is slightly brighter and lighter-pink than the rest; in all Pokemon open-mouth illustrations the tongue tip is distinctly lighter (Pikachu/Arcanine/Eevee lolling tongue); simulated by reducing the tone toward the tongue tip
  let tongueTipBlend=mouthBlend*(1.0-tongueDepth)*smoothstep(0.38,0.72,toon)*0.30;
  lit=clamp(lit+vec3<f32>(0.44,0.12,0.14)*tongueTipBlend*0.40,vec3<f32>(0.0),vec3<f32>(1.0));
  // Gum tissue blush: the gum tissue at the top of the mouth interior (above tongue level) has a distinct mucosal pink — visible in Pokemon 3D models when mouth is open; upper mouth half (negative tongue depth) shows the gum ridge color which is slightly brighter and less red than the tongue
  let gumDepth=clamp((input.worldPosition.y-scene.mouth.y)/max(scene.mouth.w,0.001)*1.60,0.0,1.0);
  let gumTint=vec3<f32>(0.72,0.24,0.28);
  lit=mix(lit,gumTint,mouthBlend*gumDepth*0.28);
  // Tooth enamel bright zone: the teeth at the upper edge of the mouth interior catch overhead key light as a bright cream-white band — all open-mouthed Pokemon (Charizard, Arcanine, Arbok, Beedrill) show bright white tooth enamel as the brightest element in the mouth interior; gated to the top of the mouth at gumDepth peak, forward-facing surfaces
  let toothBright=mouthBlend*gumDepth*smoothstep(0.38,0.60,normal.z)*smoothstep(0.52,0.72,toon)*0.60;
  let toothColor=mix(vec3<f32>(0.92,0.88,0.80),vec3<f32>(0.96,0.94,0.90),gumDepth);
  lit=mix(lit,toothColor,toothBright);
  // Fang/tooth tip point specular: the very tips of exposed canine teeth and fangs catch a tiny, tight point specular — the hardest, most reflective material in the body; Arcanine's exposed fangs, Charizard's teeth visible in render, Arbok/Seviper fang tips all glint with a near-white specular point; computed as a very tight spec at the uppermost tooth enamel zone (gumDepth maximum)
  let fangTipSpec=mouthBlend*step(0.88,gumDepth)*smoothstep(0.44,0.62,normal.z)*smoothstep(0.68,0.84,toon)*rawSpec;
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*fangTipSpec*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lower lip warmth: bottom half of mouth catches warm bounce light — lip volume depth (Pikachu/Eevee lip definition)
  let lowerLipWarm=mouthBlend*clamp((scene.mouth.y-input.worldPosition.y)/max(scene.mouth.w,0.001)*1.8,0.0,1.0);
  lit=clamp(lit+vec3<f32>(0.36,0.09,0.05)*lowerLipWarm*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Chin-to-chest AO: surfaces just below mouth face forward-downward, casting self-shadow — jaw depth (Growlithe/Charizard chin crease)
  let chinY=scene.mouth.y-scene.mouth.w*0.82;
  let chinBand=smoothstep(scene.mouth.w*1.4,scene.mouth.w*0.18,abs(input.worldPosition.y-chinY))*smoothstep(-0.04,-0.30,normal.y)*smoothstep(0.22,0.48,normal.z)*0.20;
  lit=lit*(1.0-chinBand);
  // Mouth corner crease shadow: the dark pinched crease at each lateral corner of the mouth — absent in simple spherical-mouth creatures; the folded skin in the commissure casts a distinct small shadow that gives faces character and age (Pikachu, Eevee, Arcanine, Charizard mouth corner definition); computed as tight proximity to the lateral extent of the mouth at mouth height
  let mouthCornerL=smoothstep(scene.mouth.w*1.20,scene.mouth.w*0.50,length(input.worldPosition.xyz-vec3<f32>(scene.mouth.x+scene.mouth.w*0.86,scene.mouth.y,scene.mouth.z)));
  let mouthCornerR=smoothstep(scene.mouth.w*1.20,scene.mouth.w*0.50,length(input.worldPosition.xyz-vec3<f32>(scene.mouth.x-scene.mouth.w*0.86,scene.mouth.y,scene.mouth.z)));
  let mouthCornerShadow=(mouthCornerL+mouthCornerR)*(1.0-mouthBlend*2.0)*smoothstep(0.06,0.28,toon)*(1.0-metallic)*0.22;
  lit=lit*(1.0-clamp(mouthCornerShadow,0.0,1.0)*0.20);
  // Lip tissue color zone: the skin immediately at the mouth perimeter (lip ring) is slightly redder/more vascular than surrounding face — in Pokemon art (Arcanine, Eevee, Charizard, Dragonite) the lip/snout tissue is a different shade from the broader cheek; gives mouth anatomical definition even when closed; a ring of slightly warmer-pink tissue around the mouth radius
  let lipZoneDist=length(input.worldPosition.xy-scene.mouth.xy);
  let lipRing=smoothstep(scene.mouth.w*1.28,scene.mouth.w*0.90,lipZoneDist)*(1.0-smoothstep(scene.mouth.w*0.90,scene.mouth.w*0.60,lipZoneDist))*(1.0-mouthBlend)*organicSkin*(1.0-metallic)*smoothstep(0.22,0.50,normal.z)*0.18;
  lit=clamp(lit+vec3<f32>(0.28,0.06,0.04)*lipRing,vec3<f32>(0.0),vec3<f32>(1.0));
  // Vermilion lip border specular: the sharp demarcation line where the lip tissue meets the surrounding face skin (the vermilion border / philtrum edge) creates a crisp bright specular ridge — in Gardevoir, Espeon, Mewtwo, Delphox the lip border is one of the most clearly readable fine-detail face features; it's a hard edge specular along the perimeter ring of the mouth that's brighter than either the face or the lip itself; gives mouth definition even in profile view
  let vermBorderDist=length(input.worldPosition.xy-scene.mouth.xy);
  let vermBorderRing=smoothstep(scene.mouth.w*1.38,scene.mouth.w*1.24,vermBorderDist)*(1.0-smoothstep(scene.mouth.w*1.24,scene.mouth.w*1.10,vermBorderDist));
  let vermBorderFwd=smoothstep(0.28,0.56,normal.z)*smoothstep(0.14,0.04,abs(normal.x))*smoothstep(0.06,-0.08,abs(normal.y))*(1.0-metallic)*organicSkin*specShadowMask*smoothstep(0.44,0.66,toon);
  let vermBorderSpec=pow(max(dot(normal,halfVec),0.0),52.0)*vermBorderRing*vermBorderFwd*(1.0-mouthBlend);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*vermBorderSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sub-mental mentolabial groove shadow: the horizontal skin crease between the bottom of the chin and the beginning of the neck (mentolabial sulcus) is always in shadow — a narrow horizontal dark band at chin-to-neck junction that defines the chin as a separate anatomical protrusion from the neck below it; Mewtwo, Gardevoir, Lucario, Gallade all show this horizontal crease that makes the chin look like it truly projects forward rather than melding smoothly into the neck; a thin horizontal shadow band just below chin projection
  let subMentonY=scene.mouth.y-scene.mouth.w*2.10;
  let subMentonBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-subMentonY));
  let subMentonX=smoothstep(crownEyeW*0.32,crownEyeW*0.06,abs(input.worldPosition.x));
  let subMentonFace=smoothstep(0.28,0.54,normal.z)*smoothstep(-0.04,-0.26,normal.y)*(1.0-metallic)*organicSkin*smoothstep(0.08,0.24,toon);
  lit=lit*(1.0-subMentonBand*subMentonX*subMentonFace*0.18);
  // Forehead crystal gem: bright specular oval gem on forehead of ~10% of creatures — Espeon/Gardevoir/Xerneas third-eye crystal
  let gemFwd=smoothstep(0.22,0.52,normal.z)*smoothstep(0.12,-0.12,abs(normal.x));
  let gemDist2=length(vec2<f32>(input.worldPosition.x/(crownEyeW*0.14),(input.worldPosition.y-(crownEyeY+crownEyeW*0.14))/(crownEyeW*0.12)));
  let gemFace=step(fv,0.10)*gemFwd*(1.0-smoothstep(0.76,1.20,gemDist2));
  lit=mix(lit,clamp(scene.palette2.rgb*1.42,vec3<f32>(0.0),vec3<f32>(1.0)),gemFace*0.78);
  let gemSpec=step(fv,0.10)*gemFwd*step(0.94,rawSpec)*(1.0-smoothstep(0.22,0.44,gemDist2));
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*gemSpec,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-tinted glints: warm for Fire/Electric, cool for Water/Ice, neutral default (Charizard warm-white / Vaporeon cool-white)
  let glintWarm=clamp((scene.palette2.r-scene.palette2.b-0.28)*3.5,0.0,1.0)*0.08;
  let glintTint=vec3<f32>(1.0+glintWarm,1.0,1.0-glintWarm);
  lit=mix(lit,clamp(glintTint,vec3<f32>(0.0),vec3<f32>(1.0)),glintBlend);  // primary eye glint
  lit=mix(lit,vec3<f32>(0.92,0.96,1.0),glint2Blend*0.76);          // secondary eye sparkle
  lit=mix(lit,vec3<f32>(0.96,0.98,1.0),glint3Blend*0.60);          // third accent dot (anime 3-star eye)
  // Fourth eye micro-sparkle: lower-left tiny catch-light completing anime 4-point eye highlight system — Eevee/Leafeon/Sylveon 4-star eye quality (the smallest lower catch-light that makes the eye look wet/dimensional)
  let glint4Blend=max(smoothstep(scene.eye0.w*0.18,scene.eye0.w*0.06,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x-scene.eye0.w*0.22,scene.eye0.y-scene.eye0.w*0.26,scene.eye0.z)))*eye0pre,smoothstep(scene.eye1.w*0.18,scene.eye1.w*0.06,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x-scene.eye1.w*0.22,scene.eye1.y-scene.eye1.w*0.26,scene.eye1.z)))*eye1pre);
  lit=mix(lit,vec3<f32>(0.88,0.92,1.0),glint4Blend*0.48);           // lower-left micro-sparkle (4th anime eye catch-light)
  lit=mix(lit,scene.palette0.rgb*0.38,browBlend*0.92);              // element-tinted dark brows
  // Supraorbital brow ridge highlight: the brow bone prominence above each eye catches a direct forward specular — makes the eye sockets look deeply set (Charizard/Mewtwo/Lucario brow bone quality); the brow catches the brightest point on the upper face and casts a shadow onto the eyelid below; computed as the highest-Y point adjacent to each eye, forward-facing
  let browRidgeHL=browBlend*smoothstep(0.40,0.72,normal.z)*smoothstep(0.10,0.28,normal.y)*(1.0-metallic)*smoothstep(0.56,0.80,toon)*specShadowMask;
  let browRidgeSpec=pow(max(dot(normal,halfVec),0.0),48.0)*browRidgeHL;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*browRidgeSpec*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Glabellar furrow: the central hollow between the two eyebrows (the glabella / brow furrow zone) is slightly darker — catching less key-light than the surrounding brow bone; present in ~65% of creatures with expressive faces; Blaziken, Mewtwo, Gallade, Zoroark all have this inter-brow shadow that makes the face look more intelligent and expressive; fv-gated
  let glabellarX=smoothstep(crownEyeW*0.22,crownEyeW*0.06,abs(input.worldPosition.x));
  let glabellarY=smoothstep(crownEyeY+crownEyeW*0.06,crownEyeY+crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.30,crownEyeY+crownEyeW*0.56,input.worldPosition.y));
  let glabellarFwd=smoothstep(0.28,0.54,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*(1.0-metallic)*organicSkin*smoothstep(0.12,0.30,toon)*step(0.35,fv);
  lit=lit*(1.0-glabellarX*glabellarY*glabellarFwd*0.14);
  // Medial brow corrugator crease: between the two brows, above the glabellar furrow, the corrugator muscle creates two short diagonal pinch creases angling inward-upward from the medial brow — in Pokemon like Blaziken, Mewtwo, Gallade these short diagonal shadows above the glabella give a determined/focused expression even at rest; modeled as two short diagonal dark bands at ~±15° from vertical flanking the center
  let corruX0=smoothstep(crownEyeW*0.22,crownEyeW*0.06,abs(input.worldPosition.x-crownEyeW*0.14));
  let corruX1=smoothstep(crownEyeW*0.22,crownEyeW*0.06,abs(input.worldPosition.x+crownEyeW*0.14));
  let corruY=smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.46,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.46,crownEyeY+crownEyeW*0.60,input.worldPosition.y));
  let corruFwd=smoothstep(0.28,0.54,normal.z)*smoothstep(0.08,0.04,abs(normal.y))*(1.0-metallic)*organicSkin*smoothstep(0.10,0.26,toon)*step(0.50,fv);
  lit=lit*(1.0-max(corruX0,corruX1)*corruY*corruFwd*0.10);
  // Ground plane ambient bounce: the underside of the creature body (belly, chin, leg undersides, arm undersides) receives a faint warm ground-reflected ambient that separates the creature visually from empty air and implies it's standing above a lit surface — every Pokemon official render and Digimon Cyber Sleuth model shows this warm undertone on the belly/chin/arm undersides; without it the underside looks the same gray as the dark shadow side
  let groundBounce=smoothstep(-0.10,-0.60,normal.y)*0.22;
  let groundBounceColor=mix(vec3<f32>(0.40,0.28,0.14),scene.palette1.rgb*0.44+vec3<f32>(0.28,0.18,0.08),clamp(palBright-0.18,0.0,1.0));
  lit=clamp(lit+groundBounceColor*groundBounce*(1.0-metallic*0.60)*smoothstep(0.08,0.24,toon)*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Supratrochlear forehead vein: on pale smooth organic creatures, a faint blue-purple vein trace runs vertically up the forehead center from the glabella toward the hairline — visible in Gardevoir's forehead, Mewtwo's skull, some Digimon (Renamon) foreheads; modeled as a very subtle cool blue-violet vascular SSS stripe on the central forward-facing forehead; gated to ~28% of creatures (smooth, bright, organic)
  let foreheadVeinGate=organicSkin*(1.0-metallic)*smoothstep(0.24,0.06,roughness)*clamp(palBright-0.44,0.0,1.0)*step(fv,0.28)*0.22;
  let foreheadVeinX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(input.worldPosition.x));
  let foreheadVeinY=smoothstep(crownEyeY+crownEyeW*0.24,crownEyeY+crownEyeW*1.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*1.10,crownEyeY+crownEyeW*1.60,input.worldPosition.y));
  let foreheadVeinFwd=smoothstep(0.32,0.58,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.10,0.04,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.18,0.10,0.38)*foreheadVeinX*foreheadVeinY*foreheadVeinFwd*foreheadVeinGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inner cheek SSS warmth: the cheek flesh between eye and mouth is slightly warmer in SSS — blood circulation near the surface creates pink-amber warmth in the cheek area; distinct from cheek blush (which is more pink and pattern-based); this is a subtle sub-millimeter tissue warmth (Eevee/Pikachu/Arcanine cheek warmth quality)
  let cheekSSSGate=cheekBlend*organicSkin*(1.0-metallic)*(1.0-muzzleBlend)*smoothstep(0.08,0.28,toon)*0.28;
  lit=clamp(lit+vec3<f32>(0.50,0.14,0.08)*cheekSSSGate*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral cheek backlit SSS glow: when the key light is lateral (hitting the side of the face), the cheek flesh transmits warm salmon-orange SSS around the jaw silhouette edge — this is the signature "backlit cheek glow" visible on every professionally rendered Pokemon character from the side (Gardevoir backlit silhouette glow, Mewtwo jaw glow, Espeon side-face SSS); modeled as a warm contribution on side-facing normals proportional to back-face lighting
  let latCheekSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.28,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.30;
  let latCheekLat=smoothstep(crownEyeW*0.28,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.60,crownEyeW*0.90,abs(input.worldPosition.x)));
  let latCheekY=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY+crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.30,crownEyeY+crownEyeW*0.90,input.worldPosition.y));
  let latCheekFace=smoothstep(0.28,0.52,abs(normal.x))*smoothstep(0.08,0.22,normal.z)*smoothstep(0.12,0.04,abs(normal.y));
  let latCheekSSS=max(0.0,-dot(normal,lightDir))*latCheekLat*latCheekY*latCheekFace*latCheekSSSGate;
  lit=clamp(lit+mix(vec3<f32>(0.78,0.26,0.14),scene.palette0.rgb*0.60+vec3<f32>(0.40,0.12,0.06),clamp(palBright-0.40,0.0,1.0))*latCheekSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Diagonal eye catchlight: a very thin bright diagonal streak across the pupil area at 45° — the "window frame" or "sky slit" secondary catchlight visible in high-quality anime and Pokemon official eye illustrations; adds the final touch that makes the eye feel like it's looking out through a glass cornea; only on ~35% of creatures (fv ≥ 0.65)
  let diagCatchEye=select(scene.eye0,scene.eye1,eye1pre>eye0pre);
  let diagVec=input.worldPosition.xyz-vec3<f32>(diagCatchEye.x,diagCatchEye.y,diagCatchEye.z);
  let diagProj=(diagVec.x-diagVec.y)*0.707;
  let diagStreak=clamp(1.0-abs(diagProj)/(diagCatchEye.w*0.08),0.0,1.0)*smoothstep(diagCatchEye.w*0.70,diagCatchEye.w*0.20,length(diagVec.xy))*max(eye0pre,eye1pre)*step(0.65,fv)*irisBlend;
  lit=clamp(lit+vec3<f32>(0.88,0.92,0.98)*diagStreak*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lower eyelid rim highlight: faint bright line along the very bottom edge of the eye socket — makes eyes appear moist and alive; standard technique in all 3D anime character renders (Studio Ghibli, Pokemon, Genshin); the wet lower lid separates eye from cheek and adds emotional depth
  let eyelidLow0=smoothstep(scene.eye0.w*1.30,scene.eye0.w*0.80,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*clamp((scene.eye0.y-input.worldPosition.y-scene.eye0.w*0.56)/(scene.eye0.w*0.22),0.0,1.0)*eye0pre;
  let eyelidLow1=smoothstep(scene.eye1.w*1.30,scene.eye1.w*0.80,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*clamp((scene.eye1.y-input.worldPosition.y-scene.eye1.w*0.56)/(scene.eye1.w*0.22),0.0,1.0)*eye1pre;
  lit=clamp(lit+vec3<f32>(0.82,0.88,0.96)*max(eyelidLow0,eyelidLow1)*0.38,vec3<f32>(0.0),vec3<f32>(1.0));
  // Eye inner corner highlight: tiny bright dot at the inner nasal corner of each eye — the tear duct catchlight that every high-quality anime eye has; makes the eye read as "wet glass" from all angles (Eevee/Pikachu/Espeon inner eye glow quality)
  let tearDuct0=smoothstep(scene.eye0.w*0.13,scene.eye0.w*0.05,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x+scene.eye0.w*0.60,scene.eye0.y-scene.eye0.w*0.08,scene.eye0.z)))*eye0pre;
  let tearDuct1=smoothstep(scene.eye1.w*0.13,scene.eye1.w*0.05,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x-scene.eye1.w*0.60,scene.eye1.y-scene.eye1.w*0.08,scene.eye1.z)))*eye1pre;
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*max(tearDuct0,tearDuct1)*0.54,vec3<f32>(0.0),vec3<f32>(1.0));
  // Periorbital vascularization warmth: the ring of tissue surrounding each eye (the eyelid skin, conjunctival vessels, periorbital fat) is one of the most vascularized areas of the face — it shows a distinctive pink-warm SSS ring visible on all pale-skinned Pokemon; on Gardevoir, Espeon, Mewtwo, Togekiss there is a warm-pink ring at 1.2-1.8 eye radii that is distinctly warmer than the surrounding cheek; it's the "flushed around the eyes" warmth that makes faces look alive; distinct from the cheek blush which is lower and more lateral
  let periOrbGate=organicSkin*(1.0-metallic)*clamp(palBright-0.30,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.24;
  let periOrb0=smoothstep(scene.eye0.w*1.82,scene.eye0.w*1.16,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*(1.0-smoothstep(scene.eye0.w*1.16,scene.eye0.w*0.84,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z))))*eye0pre;
  let periOrb1=smoothstep(scene.eye1.w*1.82,scene.eye1.w*1.16,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*(1.0-smoothstep(scene.eye1.w*1.16,scene.eye1.w*0.84,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z))))*eye1pre;
  let periOrbSSS=max(0.0,-dot(normal,lightDir))*max(periOrb0,periOrb1)*periOrbGate;
  lit=clamp(lit+mix(vec3<f32>(0.70,0.20,0.12),scene.palette0.rgb*0.50+vec3<f32>(0.50,0.10,0.06),clamp(palBright-0.44,0.0,1.0))*periOrbSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Secondary eye catchlight: a small secondary specular dot offset below-left from the main catchlight at ~20% iris radius — in all high-quality anime eyes (Pikachu, Espeon, Togekiss, Gardevoir, Renamon) there are always at least 2 catchlights, the second being a smaller secondary softer dot that implies the creature is in an environment with multiple light sources; this secondary dot is what separates professional anime eye rendering from flat single-catchlight eyes
  let domEye2=select(scene.eye0,scene.eye1,eye1pre>eye0pre);
  let secCatchPos=vec3<f32>(domEye2.x-domEye2.w*0.28,domEye2.y-domEye2.w*0.22,domEye2.z);
  let secCatch=smoothstep(domEye2.w*0.16,domEye2.w*0.06,length(input.worldPosition.xyz-secCatchPos))*max(eye0pre,eye1pre)*irisBlend*step(fv,0.78);
  lit=clamp(lit+vec3<f32>(0.86,0.90,0.96)*secCatch*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial canthal caruncle pink dot: the small pink mucosal tissue at the inner corner of each eye (lacrimal caruncle) catches its own tiny bright pink-red highlight — visible in all anime/game eyes as a tiny warm-pink dot at the nasal-side eye corner; Mewtwo, Gardevoir, Espeon, Umbreon, Renamon all show this; completes the eye anatomy by giving the inner corner a distinct pink tissue anchor
  let caruncle0Pos=vec3<f32>(scene.eye0.x+scene.eye0.w*0.76,scene.eye0.y,scene.eye0.z);
  let caruncle1Pos=vec3<f32>(scene.eye1.x-scene.eye1.w*0.76,scene.eye1.y,scene.eye1.z);
  let caruncle0=smoothstep(scene.eye0.w*0.18,scene.eye0.w*0.06,length(input.worldPosition.xyz-caruncle0Pos))*eye0pre*(1.0-irisBlend)*smoothstep(0.10,0.28,toon);
  let caruncle1=smoothstep(scene.eye1.w*0.18,scene.eye1.w*0.06,length(input.worldPosition.xyz-caruncle1Pos))*eye1pre*(1.0-irisBlend)*smoothstep(0.10,0.28,toon);
  lit=clamp(lit+vec3<f32>(0.80,0.18,0.18)*max(caruncle0,caruncle1)*0.42,vec3<f32>(0.0),vec3<f32>(1.0));
  // Eye outer temporal canthus shadow: the outer corner of each eye (lateral canthus at the temple side) has a shadow from the outer eyelid fold — creates the classic "almond eye" defined outer corner that distinguishes anime eyes from circles; visible in all high-quality Pokemon/Genshin eye renders; the outer corner is slightly darker and more defined than the lateral sclera
  let cantShadow0=smoothstep(scene.eye0.w*0.28,scene.eye0.w*0.12,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x-scene.eye0.w*0.70,scene.eye0.y+scene.eye0.w*0.04,scene.eye0.z)))*eye0pre*(1.0-irisBlend)*(1.0-metallic)*smoothstep(0.10,0.28,toon);
  let cantShadow1=smoothstep(scene.eye1.w*0.28,scene.eye1.w*0.12,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x+scene.eye1.w*0.70,scene.eye1.y+scene.eye1.w*0.04,scene.eye1.z)))*eye1pre*(1.0-irisBlend)*(1.0-metallic)*smoothstep(0.10,0.28,toon);
  lit=lit*(1.0-max(cantShadow0,cantShadow1)*0.24);
  // Upper eyelid crease shadow: soft dark arc just above each iris at eyelid fold — creates the crescent shadow at top of iris from the overhanging eyelid; this "lid shadow" is what makes anime eyes look deep and emotive rather than flat (all character Pokemon eyes quality)
  let lidCrease0=clamp((input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.52))/(scene.eye0.w*0.30),0.0,1.0)*smoothstep(scene.eye0.w*0.80,scene.eye0.w*0.42,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*eye0pre;
  let lidCrease1=clamp((input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.52))/(scene.eye1.w*0.30),0.0,1.0)*smoothstep(scene.eye1.w*0.80,scene.eye1.w*0.42,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*eye1pre;
  lit=lit*(1.0-max(lidCrease0,lidCrease1)*0.28);
  // Sub-ocular dark arc: the skin immediately below each eye socket has a subtle shadow crescent — the bony orbital rim casts a shadow down the cheek; visible in Mewtwo, Gardevoir, Lucario, Charizard as the classic "under-eye definition arc" that distinguishes eyes from cheeks; this is what makes anime eyes look anatomically embedded rather than painted on
  let subOc0Y=scene.eye0.y-scene.eye0.w*0.72;
  let subOc1Y=scene.eye1.y-scene.eye1.w*0.72;
  let subOcArc0=smoothstep(scene.eye0.w*1.10,scene.eye0.w*0.62,length(input.worldPosition.xy-vec2<f32>(scene.eye0.x,subOc0Y)))*(1.0-smoothstep(scene.eye0.w*0.62,scene.eye0.w*0.28,length(input.worldPosition.xy-vec2<f32>(scene.eye0.x,subOc0Y))))*eye0pre*(1.0-metallic)*smoothstep(0.08,0.26,toon)*0.22;
  let subOcArc1=smoothstep(scene.eye1.w*1.10,scene.eye1.w*0.62,length(input.worldPosition.xy-vec2<f32>(scene.eye1.x,subOc1Y)))*(1.0-smoothstep(scene.eye1.w*0.62,scene.eye1.w*0.28,length(input.worldPosition.xy-vec2<f32>(scene.eye1.x,subOc1Y))))*eye1pre*(1.0-metallic)*smoothstep(0.08,0.26,toon)*0.22;
  lit=lit*(1.0-clamp(subOcArc0+subOcArc1,0.0,1.0)*0.18);
  // Upper lid cast shadow on sclera: the upper eyelid overhangs the top of the eyeball, casting a crisp shadow onto the upper sclera (white of the eye) — this lid-on-sclera shadow is the #1 quality differentiator between flat cartoon eyes and realistic anime/Pokemon eyes; without it the sclera top appears uniformly bright which makes the eye look flat; the shadow is a crescent that hugs the top of each eye circle on the scleral white zone above the iris
  let lidSclShadow0=clamp((input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.30))/(scene.eye0.w*0.32),0.0,1.0)*smoothstep(scene.eye0.w*0.74,scene.eye0.w*0.28,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*eye0pre*(1.0-irisBlend)*(1.0-metallic)*smoothstep(0.08,0.24,toon);
  let lidSclShadow1=clamp((input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.30))/(scene.eye1.w*0.32),0.0,1.0)*smoothstep(scene.eye1.w*0.74,scene.eye1.w*0.28,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*eye1pre*(1.0-irisBlend)*(1.0-metallic)*smoothstep(0.08,0.24,toon);
  lit=lit*(1.0-max(lidSclShadow0,lidSclShadow1)*0.26);
  // Upper lid shadow on iris: the eyelid also casts a dark crescent shadow onto the TOP portion of the iris itself — this is the same overhang as the sclera shadow but projects onto the iris zone; it makes the top 25% of the iris darker than the bottom, which is a key depth cue (the eye socket recesses backward from the eyelid); in all Pixar/Pokemon/Genshin high-quality eyes this iris-top darkening is what makes the iris look like it's set behind a cornea lens rather than being a flat disc; this is separate from irisDepthDark which darkens uniformly
  let lidIrisShadow0=clamp((input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.22))/(scene.eye0.w*0.28),0.0,1.0)*smoothstep(scene.eye0.w*0.62,scene.eye0.w*0.24,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*eye0pre*irisBlend*(1.0-metallic)*smoothstep(0.10,0.26,toon);
  let lidIrisShadow1=clamp((input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.22))/(scene.eye1.w*0.28),0.0,1.0)*smoothstep(scene.eye1.w*0.62,scene.eye1.w*0.24,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*eye1pre*irisBlend*(1.0-metallic)*smoothstep(0.10,0.26,toon);
  lit=lit*(1.0-max(lidIrisShadow0,lidIrisShadow1)*0.22);
  // Corneal broad dome specular: the entire visible face of the eyeball (cornea surface) has a very wide, low-intensity specular from the curved glass dome — this is NOT the narrow catchlight dot but the broad blurred reflection that makes the eye look like a wet convex glass; present on both eyes, it spans the full eye disc as a very soft brighten in the lit zone; Genshin Impact eyes, Pokemon Legends eyes, all high-quality 3D eyes have this broad dome highlight
  let cornDome0=smoothstep(scene.eye0.w*1.10,scene.eye0.w*0.20,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x+scene.eye0.w*0.08,scene.eye0.y+scene.eye0.w*0.22,scene.eye0.z)))*eye0pre*smoothstep(0.10,0.28,toon);
  let cornDome1=smoothstep(scene.eye1.w*1.10,scene.eye1.w*0.20,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x-scene.eye1.w*0.08,scene.eye1.y+scene.eye1.w*0.22,scene.eye1.z)))*eye1pre*smoothstep(0.10,0.28,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*max(cornDome0,cornDome1)*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Buccinator cheek concavity shadow: the buccinator muscle area at mid-cheek lateral creates a slight depression between the zygomatic arch above and the masseter below — always slightly darker than adjacent surfaces; visible on Mewtwo, Gardevoir, Gallade, Blaziken as the "hollow cheek" that gives faces angular character vs smooth balloon faces; gated on organic creatures with visible facial structure
  let buccX=crownEyeW*0.62;
  let buccXBand=smoothstep(crownEyeW*0.14,crownEyeW*0.04,abs(abs(input.worldPosition.x)-buccX));
  let buccY=crownEyeY-crownEyeW*0.36;
  let buccYBand=smoothstep(crownEyeW*0.24,crownEyeW*0.06,abs(input.worldPosition.y-buccY));
  let buccFwd=smoothstep(0.24,0.50,normal.z)*smoothstep(0.20,0.42,abs(normal.x))*smoothstep(0.10,-0.08,abs(normal.y))*(1.0-metallic)*organicSkin*smoothstep(0.08,0.22,toon)*step(fv,0.72);
  lit=lit*(1.0-buccXBand*buccYBand*buccFwd*0.16);
  let cheekBase=vec3<f32>(0.94,0.52,0.56);
  let cheekTinted=mix(cheekBase,clamp(scene.palette2.rgb*1.12,vec3<f32>(0.0),vec3<f32>(1.0)),0.55);
  lit=mix(lit,cheekTinted,cheekBlend*0.70);                          // element-tinted blush
  // Cheekbone highlight: a bright curved stripe just above and lateral to the cheek blush catches the key light on the cheekbone prominence — all high-quality anime character renders show a thin cheekbone highlight above the blush area (Pikachu, Eevee, Mewtwo, Lucario face quality); small creatures have prominent cheekbones
  let cheekBoneY=crownEyeY-crownEyeW*0.16;
  let cheekBoneX=crownEyeW*0.48;
  let cheekBoneZone=smoothstep(crownEyeW*0.24,crownEyeW*0.06,abs(input.worldPosition.y-cheekBoneY))*smoothstep(cheekBoneX+crownEyeW*0.22,cheekBoneX-crownEyeW*0.06,abs(input.worldPosition.x)-cheekBoneX*0.50)*(1.0-cheekBlend*1.80);
  let cheekBoneFwd=smoothstep(0.28,0.58,normal.z)*smoothstep(0.20,0.44,abs(normal.x))*(1.0-metallic)*smoothstep(0.52,0.76,toon);
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.94)*cheekBoneZone*cheekBoneFwd*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Round cheek puff side specular: on chubby round-faced creatures (Pikachu, Snorlax, Jigglypuff, Clefairy, Blissey), the maximum lateral extent of the cheek's spherical mass catches a side fill specular — gives round cheeks their "puffed ball" quality; the widest lateral face surface catches the lateral fill from the side; separate from cheekbone highlight (cheekbone is upper face at an angle, this is the maximum lateral width of the chubby face)
  let cheekPuffX=smoothstep(crownEyeW*0.84,crownEyeW*1.14,abs(input.worldPosition.x));
  let cheekPuffY=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.08,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.08,crownEyeY+crownEyeW*0.30,input.worldPosition.y));
  let cheekPuffFace=smoothstep(0.60,0.82,abs(normal.x))*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.14,-0.08,abs(normal.z))*(1.0-metallic)*organicSkin*smoothstep(0.40,0.60,toon)*specShadowMask;
  let cheekPuffSpec=pow(max(dot(normal,fillHalfVec),0.0),16.0)*cheekPuffX*cheekPuffY*cheekPuffFace;
  lit=clamp(lit+mix(vec3<f32>(0.70,0.80,0.96),scene.palette2.rgb*0.50+vec3<f32>(0.50),0.30)*cheekPuffSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nostril dots: element-palette tinted dark (warm dark for Fire/Earth, cool for Water/Ice, neutral otherwise)
  let noseHue=mix(vec3<f32>(0.12,0.07,0.04),mix(vec3<f32>(0.04,0.06,0.12),vec3<f32>(0.020,0.012,0.035),clamp(scene.palette2.b-scene.palette2.r,0.0,1.0)),step(0.50,scene.palette2.b));
  lit=mix(lit,noseHue,noseBlend*0.85);                              // element-tinted nostril dots
  // Tiny specular glint on nose — wet-nose highlight (Pikachu/Eevee style)
  lit=clamp(lit+vec3<f32>(0.95,0.97,1.0)*noseBlend*rawSpec*0.42,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire nostril ember glow: Fire-dominant creatures have internal heat; nostrils glow with deep ember-orange-red suggesting a furnace inside — Charizard/Arcanine/Typhlosion nostril heat glow; separate from nose specular (this is pure emission, not specular); warm subsurface heat radiating from within
  let nostrEmber=noseBlend*warmDom*(1.0-metallic)*clamp(palBright-0.28,0.0,1.0)*0.40;
  lit=clamp(lit+vec3<f32>(0.88,0.26,0.04)*nostrEmber,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nostril warm SSS: the thin nasal tissue immediately around the nostril openings transmits warm pink-red blood-light from within — Eevee, Arcanine, Growlithe, Mewtwo nostril SSS glow; the thin skin on the rim of each nostril is backlit by blood circulation and appears distinctly pink/amber even in cool lighting; separate from the nostrEmber which is fire-type specific
  let nostrSSSGate=noseBlend*organicSkin*(1.0-warmDom)*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.32;
  lit=clamp(lit+vec3<f32>(0.42,0.12,0.08)*nostrSSSGate*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Philtrum highlight: the narrow vertical strip of skin between the nose tip and upper lip catches the forward key light as a bright vertical highlight — distinguishes nose from lip and gives the muzzle region forward-face 3D quality (Arcanine/Mewtwo/Lucario muzzle definition); this is the single brightest point of the snout that defines the nose-to-mouth gradient
  let philtrumY=scene.mouth.y+scene.mouth.w*1.20;
  let philtrumZone=smoothstep(philtrumY-scene.mouth.w*0.60,philtrumY,input.worldPosition.y)*(1.0-smoothstep(philtrumY,philtrumY+scene.mouth.w*0.52,input.worldPosition.y));
  let philtrumX=smoothstep(scene.mouth.w*0.22,scene.mouth.w*0.04,abs(input.worldPosition.x));
  let philtrumFwd=smoothstep(0.38,0.66,normal.z)*smoothstep(0.12,-0.12,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.44,0.66,toon)*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*philtrumZone*philtrumX*philtrumFwd*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Muzzle lateral shadow: the sides of the snout/muzzle protrusion are in shadow relative to the forward-facing tip — the muzzle reads as a 3D protrusion only when its sides are darker than its tip; Arcanine, Eevee, Charmander, Growlithe all show this lateral shadow that gives the snout its "pop forward" 3D quality; on creatures with visible muzzle, the lateral surface near the snout base is darker
  let muzzleLateralShadow=muzzleBlend*smoothstep(0.36,0.64,abs(normal.x))*smoothstep(0.06,-0.10,normal.z)*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  lit=lit*(1.0-muzzleLateralShadow*0.20);
  // Nasolabial fold shadow: the diagonal skin crease from the nostril base down to the mouth corner — always recessed and dark; this is the single most powerful cue for facial 3D structure on all biped character designs; Mewtwo, Gardevoir, Lucario, Blaziken, Renamon, Agumon all show this shadow crease separating the muzzle protrusion from the cheek plane
  let nasLabX=crownEyeW*0.30;
  let nasLabYLow=scene.mouth.y+scene.mouth.w*0.64;
  let nasLabYHigh=scene.mouth.y+scene.mouth.w*1.76;
  let nasLabBandX=smoothstep(crownEyeW*0.12,crownEyeW*0.03,abs(abs(input.worldPosition.x)-nasLabX));
  let nasLabBandY=smoothstep(nasLabYLow,nasLabYHigh,input.worldPosition.y)*(1.0-smoothstep(nasLabYHigh,nasLabYHigh+crownEyeW*0.18,input.worldPosition.y));
  let nasLabFold=nasLabBandX*nasLabBandY*muzzleBlend*smoothstep(0.24,0.52,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*(1.0-metallic)*organicSkin*smoothstep(0.08,0.26,toon);
  lit=lit*(1.0-nasLabFold*0.22);
  // Philtrum medial groove shadow: the vertical central groove of the philtrum (between the two raised philtral ridges from the nose base to the upper lip center) is always in shadow — a narrow dark central line from the nose-base down to the lip center; completes the philtrum anatomy; the existing philtrum highlight added bilateral columns while this adds the shadow between them; Mewtwo, Gardevoir, Espeon, Gallade philtrum groove visible from front view
  let philtGrooveX=smoothstep(scene.mouth.w*0.07,scene.mouth.w*0.0,abs(input.worldPosition.x));
  let philtGrooveY=smoothstep(scene.mouth.y+scene.mouth.w*0.86,scene.mouth.y+scene.mouth.w*1.16,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.16,scene.mouth.y+scene.mouth.w*1.60,input.worldPosition.y));
  let philtGrooveFwd=smoothstep(0.30,0.54,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*(1.0-metallic)*organicSkin*smoothstep(0.08,0.24,toon);
  lit=lit*(1.0-philtGrooveX*philtGrooveY*philtGrooveFwd*0.14);
  // Jugular/carotid lateral neck SSS: on light-skinned smooth organic creatures, the lateral neck shows a faint blue-violet subsurface tint from large superficial blood vessels (jugular vein, carotid artery) visible through thin skin — Gardevoir's neck, Eevee's ruff lateral, Mewtwo's neck, Espeon's neck all show this subtle vascular quality that reads as "living tissue"; modeled as a blue-purple SSS component on the lateral forward-facing neck surface at mid-neck height; absent on metallic, dark-skinned, or rough-surfaced creatures
  let jugularVeinGate=organicSkin*(1.0-metallic)*smoothstep(0.30,0.06,roughness)*smoothstep(0.08,0.22,toon)*clamp(palBright-0.38,0.0,1.0)*0.28;
  let jugularLat=smoothstep(crownEyeW*0.16,crownEyeW*0.42,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.42,crownEyeW*0.68,abs(input.worldPosition.x)));
  let jugularY=smoothstep(crownEyeY-crownEyeW*0.38,crownEyeY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.06,crownEyeY+crownEyeW*0.22,input.worldPosition.y));
  let jugularFace=smoothstep(0.36,0.58,abs(normal.x))*smoothstep(0.08,0.24,normal.z)*smoothstep(0.12,-0.06,abs(normal.y));
  let jugularSSS=max(0.0,-dot(normal,lightDir))*jugularVeinGate*jugularLat*jugularY*jugularFace;
  lit=clamp(lit+vec3<f32>(0.32,0.16,0.52)*jugularSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inner ankle crease shadow: the medial ankle (inside of the lower leg joint, where the tibia meets the talus) has a concavity shadow from bone protrusion; visible on upright bipeds standing still — Lucario, Blaziken, Mewtwo — as a small dark crescent on the inner-lateral ankle; this gives the ankle joint its "pinched" anatomy vs a smooth taper
  let innerAnkleY=crownEyeW*0.50;
  let innerAnkleBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-innerAnkleY)/(crownEyeW*0.14+0.001));
  let innerAnkleLat=smoothstep(crownEyeW*0.50,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.10,abs(input.worldPosition.x)))*(1.0-metallic)*organicSkin;
  let innerAnkleFace=smoothstep(0.22,0.54,abs(normal.x))*smoothstep(-0.06,-0.34,normal.y)*smoothstep(0.06,0.22,toon);
  lit=lit*(1.0-innerAnkleBand*innerAnkleLat*innerAnkleFace*0.22);
  // Ankle malleolus dorsal protrusion specular: the lateral ankle bone (malleolus) protrudes on both sides just above the foot — a small oval bright highlight on the lateral ankle at foot-base height; Lucario, Blaziken, Mewtwo all have this visible ankle bone protrusion; makes bipedal ankles look anatomically articulated rather than smooth taper; present on both inner and outer ankle sides
  let malleolY=crownEyeW*0.48;
  let malleolBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-malleolY)/(crownEyeW*0.12+0.001));
  let malleolLat=smoothstep(crownEyeW*0.68,crownEyeW*1.0,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.0,crownEyeW*1.26,abs(input.worldPosition.x)))*(1.0-metallic)*organicSkin;
  let malleolFwd=smoothstep(0.28,0.54,abs(normal.x))*smoothstep(0.10,-0.08,abs(normal.y))*specShadowMask*smoothstep(0.44,0.66,toon);
  let malleolSpec=pow(max(dot(normal,halfVec),0.0),36.0)*malleolBand*malleolLat*malleolFwd;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*malleolSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Occiput posterior bounce highlight: the back of the skull is a dome that catches secondary bounce light from the ground/environment below-behind; in official Pokemon 3/4 view renders, the back of the head is not uniformly dark but has a subtle soft bounce halo (Eevee's back-head, Pikachu's back skull, Mewtwo's occipital bulge); modeled as a soft secondary fill on the back-facing upper skull surface
  let occipY=crownEyeY+crownEyeW*1.10;
  let occipZone=smoothstep(occipY-crownEyeW*0.60,occipY,input.worldPosition.y)*(1.0-smoothstep(occipY,occipY+crownEyeW*0.80,input.worldPosition.y));
  let occipBack=smoothstep(-0.14,-0.52,normal.z)*smoothstep(0.14,0.44,normal.y)*(1.0-metallic)*smoothstep(0.14,0.36,toon);
  let occipBounceColor=mix(vec3<f32>(0.32,0.38,0.56),scene.palette2.rgb*0.50+vec3<f32>(0.50),0.30);
  lit=clamp(lit+occipBounceColor*occipZone*occipBack*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior nape-to-crown hairline rim highlight: the very top edge of the posterior skull (where the skull dome meets the upper nape) creates a crisp rim catchlight when lit from above and behind — in Pokemon 3/4 rear view renders (Charizard, Dragonite, Mewtwo) this posterior crown rim is the brightest point on the dark-side silhouette and is what makes the head dome read as 3D rather than flat; the highlight runs along the top arc of the skull from side to side
  let napcRimY=crownEyeY+crownEyeW*1.28;
  let napcRimBand=smoothstep(crownEyeW*0.10,crownEyeW*0.0,abs(input.worldPosition.y-napcRimY));
  let napcRimX=smoothstep(crownEyeW*0.90,crownEyeW*0.24,abs(input.worldPosition.x));
  let napcRimFace=smoothstep(-0.10,-0.38,normal.z)*smoothstep(0.38,0.60,normal.y)*smoothstep(0.08,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask;
  let napcRimSpec=pow(max(dot(normal,halfVec),0.0),12.0)*napcRimBand*napcRimX*napcRimFace;
  lit=clamp(lit+rimColorGraded*napcRimSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Muzzle tip gloss: broad specular on snout gives wet/alive quality (Growlithe/Arcanine muzzle)
  lit=clamp(lit+vec3<f32>(0.90,0.92,0.95)*muzzleBlend*rawSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Muzzle skin warmth: faint pink-tan subsurface on snout — living face quality (Growlithe/Eevee muzzle blush)
  lit=clamp(lit+vec3<f32>(0.28,0.08,0.04)*muzzleBlend*(1.0-metallic)*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Mouth interior wet gloss: the inside of the mouth cavity catches a broad wet specular from overhead light — wet-mouth quality (Pikachu/Eevee open mouth interior, Arcanine gaping mouth reveal); tooth enamel in the upper portion is glossy
  let mouthInteriorGloss=mouthBlend*smoothstep(0.38,0.60,normal.z)*smoothstep(0.50,0.74,toon)*(1.0-metallic)*rawSpec*0.44;
  lit=clamp(lit+vec3<f32>(0.90,0.92,0.96)*mouthInteriorGloss,vec3<f32>(0.0),vec3<f32>(1.0));
  // Rostral snout tip accent: the very tip of the snout (forward-most point of the muzzle) has a slightly different color and higher specular — on organic creatures (Arcanine/Eevee/Growlithe) it is a slightly darker moist spot; on scaled creatures it's a keratinous point; in all cases it is the single most forward-facing point of the whole head and catches a sharp specular; this accent separates nose from muzzle and makes the face feel anatomically complete
  let rostralTipDist=length(input.worldPosition.xy-scene.mouth.xy+vec2<f32>(0.0,-scene.mouth.w*0.80));
  let rostralTipZone=smoothstep(scene.mouth.w*0.30,scene.mouth.w*0.06,rostralTipDist)*muzzleBlend*(1.0-metallic)*organicSkin;
  let rostralTipColor=mix(vec3<f32>(0.28,0.12,0.08),scene.palette0.rgb*0.54,clamp(palBright-0.20,0.0,1.0));
  base=mix(base,rostralTipColor,rostralTipZone*0.22);
  let rostralTipSpec=pow(max(dot(normal,halfVec),0.0),90.0)*rostralTipZone*smoothstep(0.40,0.64,normal.z)*specShadowMask*smoothstep(0.50,0.70,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.98,1.0)*rostralTipSpec*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crown dome top highlight: the very top of the skull (highest Y point of the head) catches a direct key-light catchlight — a broad soft oval on the crown that is the brightest point on the head in top-three-quarter view; Pikachu/Eevee/Mewtwo/Charizard all have this crown glow that reads as "the head is round and real"; the crown spec is softer than facial specs
  let crownDomeY=crownEyeY+crownEyeW*0.80;
  let crownDomeZone=smoothstep(crownDomeY-crownEyeW*0.40,crownDomeY,input.worldPosition.y)*(1.0-smoothstep(crownDomeY,crownDomeY+crownEyeW*1.0,input.worldPosition.y));
  let crownDomeFace=smoothstep(0.60,0.90,normal.y)*smoothstep(0.20,0.04,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.44,0.66,toon)*specShadowMask;
  let crownDomeSpec=pow(max(dot(normal,halfVec),0.0),10.0)*crownDomeZone*crownDomeFace;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*crownDomeSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ground proximity warmth: the very lowest part of the creature (near Y=0, the ground level) picks up scattered terrain light — warm green-brown from grass/earth or warm grey from concrete; this "ground bounce" AO brightening at the feet level makes the creature appear to actually stand on a surface rather than float; organic creatures get warm grass-earth, metallic/rock get warm grey-brown
  let groundProxGate=smoothstep(crownEyeW*0.50,0.0,input.worldPosition.y)*(1.0-metallic)*smoothstep(0.04,0.20,toon)*0.18;
  let groundProxColor=mix(vec3<f32>(0.36,0.46,0.24),vec3<f32>(0.40,0.32,0.20),warmDom)*0.60;
  lit=clamp(lit+groundProxColor*groundProxGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neck ruff/collar ring highlight: at the neck-to-shoulder transition many Pokemon have a raised color collar — Arcanine, Typhlosion, Blaziken, Ninetales — a subtle bright band at the crown Y minus ~0.40 eye-widths that catches overhead light on forward-upward facing surfaces; this is the anatomical collar where the neck widens into shoulders
  let neckCollarY=crownEyeY-crownEyeW*0.38;
  let neckCollarBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-neckCollarY)/(crownEyeW*0.10+0.001));
  let neckCollarFace=smoothstep(0.18,0.48,normal.y)*smoothstep(0.22,0.52,normal.z)*(1.0-metallic)*smoothstep(0.38,0.58,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*neckCollarBand*neckCollarFace*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Collarbone cast shadow: the clavicle bone casts a faint narrow shadow below it on the upper chest — a subtle horizontal dark line on the forward-facing chest just below the neck base; Mewtwo, Lucario, Gardevoir, Blaziken show this anatomical chest shadow just below the neck connection; modeled as a narrow horizontal dark band at the neck-to-chest junction on forward-facing surfaces
  let claBoneY=crownEyeY-crownEyeW*0.52;
  let claBoneBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-claBoneY)/(crownEyeW*0.08+0.001));
  let claBoneFwd=smoothstep(0.28,0.56,normal.z)*smoothstep(0.26,0.06,abs(normal.x))*(1.0-metallic)*smoothstep(0.14,0.30,toon);
  let claBoneLat=smoothstep(crownEyeW*0.36,crownEyeW*0.80,abs(input.worldPosition.x));
  lit=lit*(1.0-claBoneBand*claBoneFwd*claBoneLat*0.16);
  // Suprasternal jugular notch shadow: the dimple at the center base of the throat (the suprasternal notch between the clavicle heads) is a small deep shadow — on bipedal creatures with a visible neck/chest separation (Mewtwo, Gardevoir, Gallade, Blaziken), this central depression just above the sternum top casts a concentrated shadow; it's the anatomical marker separating the neck column from the chest plane and is one of the most subtle but recognizable anatomy cues in character design
  let supSternY=crownEyeY-crownEyeW*0.62;
  let supSternX=smoothstep(crownEyeW*0.20,crownEyeW*0.04,abs(input.worldPosition.x));
  let supSternBand=smoothstep(crownEyeW*0.06,crownEyeW*0.0,abs(input.worldPosition.y-supSternY));
  let supSternFwd=smoothstep(0.30,0.58,normal.z)*smoothstep(-0.04,-0.22,normal.y)*(1.0-metallic)*organicSkin*smoothstep(0.12,0.28,toon);
  lit=lit*(1.0-supSternX*supSternBand*supSternFwd*0.20);
  // Sternoclavicular joint bilateral protrusion: the medial ends of the clavicles, where they articulate with the sternum manubrium at the two sternoclavicular joints, create two small bilateral bony prominences flanking the suprasternal notch — visible as two small forward-pointing specular dots on each side of the central notch shadow; on Mewtwo, Gardevoir, Gallade these bilateral protrusion dots are visible in front view and complete the neck-to-chest anatomical vocabulary
  let sclvY=crownEyeY-crownEyeW*0.58;
  let sclvXL=input.worldPosition.x-crownEyeW*0.24;
  let sclvXR=input.worldPosition.x+crownEyeW*0.24;
  let sclvDotL=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(vec2<f32>(sclvXL,input.worldPosition.y-sclvY)));
  let sclvDotR=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(vec2<f32>(sclvXR,input.worldPosition.y-sclvY)));
  let sclvFwd=smoothstep(0.32,0.58,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*(1.0-metallic)*organicSkin*specShadowMask*smoothstep(0.44,0.66,toon);
  let sclvSpec=pow(max(dot(normal,halfVec),0.0),68.0)*max(sclvDotL,sclvDotR)*sclvFwd;
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*sclvSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Infraclavicular fossa shadow: the shallow bilateral hollow just below the collarbone and above the pectoralis major creates a pair of concave shadows that are the single strongest anatomical read in character design at the upper chest — on Mewtwo, Gardevoir, Gallade, Lucario these infraclavicular hollows (one on each side of the sternum) are what make the neck-to-chest transition look like it has real bone structure; without them the chest looks like a single smooth dome connecting directly to the neck
  let infraclavY=crownEyeY-crownEyeW*0.68;
  let infraclavYBand=smoothstep(crownEyeW*0.14,crownEyeW*0.04,abs(input.worldPosition.y-infraclavY));
  let infraclavLat=smoothstep(crownEyeW*0.22,crownEyeW*0.50,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.50,crownEyeW*0.80,abs(input.worldPosition.x)));
  let infraclavFwd=smoothstep(0.24,0.52,normal.z)*smoothstep(-0.04,-0.28,normal.y)*smoothstep(0.10,0.24,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.10,0.26,toon);
  lit=lit*(1.0-infraclavYBand*infraclavLat*infraclavFwd*0.18);
  // Umbilical mid-abdomen surface fold: at the mid-abdomen level, the soft belly tissue folds slightly at the waist-to-belly transition creating a horizontal skin crease — Mewtwo's belly segmentation, Machamp's abdominal fold, Lucario's abdomen crease; on smooth bipeds this subtle line at waist level adds a "plush body" read and separates the round belly from the angular torso; similar to a nasolabial fold but horizontal on the torso front
  let umbilicalY=crownEyeY-crownEyeW*1.44;
  let umbilicalBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-umbilicalY));
  let umbilicalX=smoothstep(crownEyeW*0.36,crownEyeW*0.08,abs(input.worldPosition.x));
  let umbilicalFwd=smoothstep(0.28,0.56,normal.z)*smoothstep(-0.04,-0.22,normal.y)*(1.0-metallic)*organicSkin*smoothstep(0.10,0.28,toon)*step(0.38,fv);
  lit=lit*(1.0-umbilicalBand*umbilicalX*umbilicalFwd*0.12);
  // Armpit/axilla shadow: on bipeds and quadrupeds, the hollow between the arm and torso is always deeply self-occluded — the inside of the shoulder joint never receives direct light from above; Lucario, Charizard, Blaziken all show a hard crescent of shadow where the upper arm meets the rib cage; modeled as downward-facing lateral surface at upper-arm height, attenuated by lateral position
  let axillaGate=(1.0-metallic)*smoothstep(0.06,0.22,toon)*0.30;
  let axillaY=crownEyeY-crownEyeW*0.55;
  let axillaBand=smoothstep(0.10,0.0,abs(input.worldPosition.y-axillaY)/(crownEyeW*0.24+0.001));
  let axillaLat=smoothstep(crownEyeW*0.60,crownEyeW*1.0,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.0,crownEyeW*1.40,abs(input.worldPosition.x)));
  let axillaFace=smoothstep(-0.20,-0.52,normal.y)*smoothstep(0.20,0.04,abs(normal.z));
  lit=lit*(1.0-axillaBand*axillaLat*axillaFace*axillaGate*0.28);
  // Lateral waist compression AO: the side of the torso at the waist indentation (mid-torso between chest and hips) receives a slight AO shadow from the narrowing of the body — the waist is thinner than the chest and hips so the lateral surfaces at waist level are more occluded than at shoulder or hip; creates the characteristic "hourglass waist" depth shadow that separates lean characters from barrel-shapes; visible on Gardevoir, Mewtwo, Gallade lateral views as a slight darkening at the narrowest body point
  let waistAOY=crownEyeY-crownEyeW*1.0;
  let waistAOZone=smoothstep(waistAOY-crownEyeW*0.50,waistAOY,input.worldPosition.y)*(1.0-smoothstep(waistAOY,waistAOY+crownEyeW*0.50,input.worldPosition.y));
  let waistAOLat=smoothstep(crownEyeW*0.36,crownEyeW*0.70,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.70,crownEyeW*1.0,abs(input.worldPosition.x)));
  let waistAOFace=smoothstep(0.38,0.64,abs(normal.x))*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.12,0.04,abs(normal.z))*(1.0-metallic)*organicSkin*smoothstep(0.08,0.22,toon);
  lit=lit*(1.0-waistAOZone*waistAOLat*waistAOFace*0.14);
  // Sub-deltoid posterior arm groove shadow: just below the deltoid cap, on the posterior-lateral surface of the upper arm, there's a concave groove where the deltoid muscle attachment ends and the tricep/bicep lateral head begins — this creates a small crescent shadow just below the shoulder cap on the back of the arm; on Mewtwo, Machamp, Gardevoir, Blaziken this small shadow groove separates the deltoid cap from the arm cylinder and makes the shoulder look truly muscular with a separate attachment
  let subDeltY=smoothstep(crownEyeY-crownEyeW*0.40,crownEyeY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.80,input.worldPosition.y));
  let subDeltLat=smoothstep(crownEyeW*0.86,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let subDeltBack=smoothstep(-0.06,-0.42,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.08,0.24,toon);
  lit=lit*(1.0-subDeltY*subDeltLat*subDeltBack*0.16);
  // Neck-to-chin bounce warmth: the underside of the chin and jaw receives warm diffuse bounce light from the upper chest/neck — in official Pokemon art the chin always has a warm fill that keeps it from going completely dark; this is the neck-bounce fill (Pikachu chin-fill warmth, Charizard jaw bounce, Eevee neck-to-chin soft warm light)
  let chinBounceY=crownEyeY-crownEyeW*0.28;
  let chinBounceZone=smoothstep(chinBounceY-crownEyeW*0.70,chinBounceY,input.worldPosition.y)*(1.0-smoothstep(chinBounceY,chinBounceY+crownEyeW*0.32,input.worldPosition.y));
  let chinBounceFace=smoothstep(-0.04,-0.38,normal.y)*smoothstep(0.18,0.50,normal.z)*(1.0-metallic)*smoothstep(0.06,0.28,toon);
  lit=clamp(lit+vec3<f32>(0.64,0.32,0.14)*chinBounceZone*chinBounceFace*0.14,vec3<f32>(0.0),vec3<f32>(1.0));

  // Under-jaw mandibular shadow: the area immediately below the chin/jaw bone, facing downward, is permanently in shadow from the jaw mass above — this sub-mental shadow region is present in every professionally-rendered creature (Arcanine, Charizard, Mewtwo, Dragonite) and is the single most important shadow for "chin reads as three-dimensional" quality; modeled as downward-facing chin-height narrow zone
  let jawLineY=scene.mouth.y-scene.mouth.w*1.80;
  let jawLineBand=smoothstep(jawLineY-scene.mouth.w*0.80,jawLineY,input.worldPosition.y)*(1.0-smoothstep(jawLineY,jawLineY+scene.mouth.w*0.22,input.worldPosition.y));
  let jawLineDown=smoothstep(-0.22,-0.58,normal.y)*smoothstep(0.22,0.04,abs(normal.z))*smoothstep(0.18,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.04,0.18,toon);
  lit=lit*(1.0-jawLineBand*jawLineDown*0.28);
  // Element body atmospheric haze: very faint element-hue volumetric-style atmospheric tint across the entire body at mid-brightness — Fire types have a warm amber haze (body feels hot), Electric types have a yellow-white crackle, Water types have cool blue-tinted mist, Shadow types have purple-void; this is NOT the same as SSS or aura — it's a subtle base brightness tint applied across all surfaces that are not in shadow; gives each creature a characteristic "type atmosphere"
  let elemHazeStr=smoothstep(0.30,0.58,toon)*(1.0-metallic)*0.06;
  let fireHaze=vec3<f32>(0.96,0.42,0.04)*warmDom;
  let waterHaze=vec3<f32>(0.04,0.28,0.60)*blueSheen;
  let elecHaze=vec3<f32>(0.92,0.90,0.40)*elecChargeGate;
  let shadowHaze=vec3<f32>(0.28,0.04,0.36)*shadowDom;
  let elemHaze=clamp(fireHaze+waterHaze+elecHaze+shadowHaze,vec3<f32>(0.0),vec3<f32>(1.0));
  lit=clamp(lit+elemHaze*elemHazeStr,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly edge SSS bleed: narrow warm-peach band at the exact body/belly transition — organic subsurface scatter where skin is thinnest at the boundary (Pikachu/Eevee/Arcanine belly edge softness in official art)
  let bellyEdgeBand=smoothstep(0.20,0.38,belly)*(1.0-smoothstep(0.38,0.60,belly))*(1.0-metallic);
  lit=clamp(lit+vec3<f32>(0.22,0.06,0.04)*bellyEdgeBand*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly texture micro-variation: the pale belly region of organic creatures has extremely fine texture variation — individual scale plate edges, skin pore clusters, and subtle pigment variation in the belly plates; Pikachu/Eevee/Snorlax belly is not uniformly smooth but has very fine bright/dark pattern; modeled as low-frequency cell noise within the belly mask
  let bellyTexCell=floor(input.worldPosition*scale*5.20+vec3<f32>(fv*4.3,fv*2.7,fv*5.9));
  let bellyTexH=(fract(sin(dot(bellyTexCell,vec3<f32>(127.1,311.7,74.7)))*43758.545)-0.5)*2.0;
  let bellyTexGate=smoothstep(0.36,0.66,belly)*organicSkin*(1.0-metallic)*0.10;
  lit=clamp(lit+lit*bellyTexH*bellyTexGate*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neck underside SSS bounce: ventral neck skin (facing downward-forward) receives warm subsurface bounce light from the throat-body cavity — in all quadruped and biped Pokemon renders, the underside of the neck/throat is always slightly warmer than expected because internal warmth and ground bounce both converge there; moist-skin organic look (Dragonite throat, Arcanine chest throat, Eevee ruff)
  let neckUnderY=crownEyeY-crownEyeW*0.90;
  let neckUnderZone=smoothstep(neckUnderY-crownEyeW*0.60,neckUnderY,input.worldPosition.y)*(1.0-smoothstep(neckUnderY,neckUnderY+crownEyeW*0.60,input.worldPosition.y));
  let neckUnderFace=smoothstep(-0.08,-0.44,normal.y)*smoothstep(0.14,0.42,normal.z)*organicSkin*(1.0-metallic)*smoothstep(0.10,0.32,toon);
  lit=clamp(lit+vec3<f32>(0.38,0.12,0.05)*neckUnderZone*neckUnderFace*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neck wrinkle crease shadow: at the neck-to-chest junction, skin bunches into fine horizontal creases — darkening micro-bands perpendicular to the vertical body axis in the neck transition zone; organic creatures (Dragonite, Snorlax, Arcanine, Pikachu neck) have visible skin bunching here that adds character and age to the character design
  let neckCreaseY=crownEyeY-crownEyeW*0.70;
  let neckCreaseZone=smoothstep(neckCreaseY-crownEyeW*0.40,neckCreaseY,input.worldPosition.y)*(1.0-smoothstep(neckCreaseY,neckCreaseY+crownEyeW*0.40,input.worldPosition.y));
  let neckCreaseWave=sin(input.worldPosition.y*scale*18.0+fv*3.0)*0.5+0.5;
  let neckCreaseFold=step(0.86,neckCreaseWave)*neckCreaseZone*organicSkin*(1.0-metallic)*smoothstep(0.24,0.48,toon)*0.32;
  lit=lit*(1.0-neckCreaseFold*0.10);
  // Mid-body temperature transition: at the waist band (where torso meets pelvis/lower body), a subtle warm-cool cross-gradient appears in official art — the upper torso carries more of the key light warm temperature and the lower body begins to fall off into the cooler fill zone; this transition makes bipeds read as taller and more elegantly proportioned (Mewtwo/Lucario/Gardevoir waist quality)
  let waistY=crownEyeY-crownEyeW*3.0;
  let waistBand=smoothstep(waistY-crownEyeW*0.80,waistY,input.worldPosition.y)*(1.0-smoothstep(waistY,waistY+crownEyeW*0.80,input.worldPosition.y));
  let waistWarmCool=mix(vec3<f32>(0.06,0.01,-0.03),vec3<f32>(-0.04,0.0,0.06),clamp(1.0-warmDom,0.0,1.0));
  lit=clamp(lit+waistWarmCool*waistBand*(1.0-metallic)*smoothstep(0.36,0.62,toon)*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pattern luminance compensation: where pattern markings darken or lighten the base, the lit-zone brightness is partially restored to prevent marks from washing out in full sun or going too dark in shadow — hand-painted illustration preserves mark readability across all lighting conditions (Pokemon art marks always stay readable)
  let patLumComp=clamp(scene.material.w-0.3,0.0,1.0)*(1.0-metallic)*smoothstep(0.52,0.76,toon);
  let patLumShift=(pat_raw-0.5)*(-0.10)*patLumComp;
  lit=clamp(lit+lit*patLumShift,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ground proximity shadow — mimics ambient occlusion at base of creature
  let groundShadow=smoothstep(0.22,0.0,input.worldPosition.y)*0.22;
  lit=lit*(1.0-groundShadow);
  // AO proxy: belly/underside darkens near ground — simulates the dark underbelly shadow in Pokemon art
  let aoProxy=smoothstep(0.30,0.08,input.worldPosition.y)*smoothstep(-0.35,-0.68,normal.y)*0.18;
  lit=lit*(1.0-aoProxy);
  // Floor diffuse irradiance color bleed: the underside of the creature receives a faint diffuse bounce off the studio floor — in Pokemon 3D official renders and Genshin Impact, the floor provides a colored upward fill (neutral warm-grey by default); downward-facing surfaces catch this floor irradiance, giving the feet, belly underside, and lower cloak a subtle bounce glow
  let floorBounce=smoothstep(-0.20,-0.68,normal.y)*(1.0-metallic)*smoothstep(0.08,0.26,toon)*0.14;
  let floorColor=mix(vec3<f32>(0.42,0.38,0.32),scene.palette0.rgb*0.60+vec3<f32>(0.12,0.10,0.08),clamp(palBright-0.30,0.0,1.0)*0.42);
  lit=clamp(lit+floorColor*floorBounce*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element sky hemisphere irradiance: the sky hemisphere is tinted by the creature's element color — a subtle ambient that's distinct from the key light; upward-facing surfaces (+Y normal) receive a gentle element-colored wash; Genshin / Sygna-Suit style ambient that unifies the creature with its element type without being garish; stronger on bright/vivid palettes
  let skyHemiGate=smoothstep(0.20,0.72,normal.y)*(1.0-metallic)*clamp((palBright-0.28)/0.44,0.0,1.0)*smoothstep(0.18,0.44,toon);
  let skyHemiIrrad=scene.palette2.rgb*0.22+vec3<f32>(0.04,0.06,0.10)*0.30;
  lit=clamp(lit+skyHemiIrrad*skyHemiGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Gluteal rear haunch bounce: the posterior haunches and gluteal mass of bipeds and quadrupeds catch a cool ground-bounce fill from below-behind — Blaziken's rear, Arcanine's haunches, Mewtwo's posterior mass all show this cool secondary bounce that separates the rear silhouette from pure dark; a cool secondary fill on posterior-facing downward surfaces at hip-to-knee height
  let haunchY=crownEyeY-crownEyeW*1.30;
  let haunchZone=smoothstep(haunchY-crownEyeW*0.60,haunchY,input.worldPosition.y)*(1.0-smoothstep(haunchY,haunchY+crownEyeW*0.40,input.worldPosition.y));
  let haunchBack=smoothstep(-0.14,-0.54,normal.z)*smoothstep(-0.04,-0.38,normal.y)*smoothstep(0.16,0.36,toon)*(1.0-metallic);
  lit=clamp(lit+mix(vec3<f32>(0.40,0.52,0.72),scene.palette2.rgb*0.40+vec3<f32>(0.60),0.30)*haunchZone*haunchBack*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Gastrocnemius warm SSS: the posterior calf muscle has a high concentration of blood capillaries near the surface of thin-skinned biped creatures — a faint warm-pink subsurface glow on the back of the lower leg at mid-calf height; backlit calf shows SSS from blood and muscle; Gardevoir's legs, Mewtwo's calves, Blaziken's lower legs all show this warm living-tissue glow on the back-leg silhouette; adds the "filled with blood" quality that separates organic from mannequin-plastic
  let gastroSSS=max(0.0,-dot(normal,lightDir))*haunchZone*smoothstep(-0.20,-0.52,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.24;
  lit=clamp(lit+mix(vec3<f32>(0.50,0.12,0.10),scene.palette0.rgb*0.40+vec3<f32>(0.60,0.20,0.10),clamp(palBright-0.22,0.0,1.0))*gastroSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior thigh hamstring shadow groove: on the back of the thigh between hip and knee, the two major hamstring tendons (biceps femoris and semitendinosus) create a visible medial groove on the posterior thigh surface — in characters like Mewtwo, Blaziken, Gardevoir the posterior thigh is not uniformly dark but has a central groove that makes the leg look muscular rather than sausage-like; modeled as a narrow central Y-aligned shadow strip on the posterior-facing leg at thigh height
  let hamstringY=smoothstep(kneeY+crownEyeW*0.20,kneeY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.60,haunchY+crownEyeW*0.20,input.worldPosition.y));
  let hamstringMidX=smoothstep(crownEyeW*0.16,crownEyeW*0.06,abs(abs(input.worldPosition.x)-crownEyeW*0.60));
  let hamstringBack=smoothstep(-0.10,-0.44,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*(1.0-metallic)*organicSkin*smoothstep(0.08,0.22,toon);
  lit=lit*(1.0-hamstringY*hamstringMidX*hamstringBack*0.14);
  // Lumbar lower-back curve highlight: the lumbar region of the lower back (above the hips, below the thorax) has a distinctive inward curve that catches overhead rear key light — Blaziken, Mewtwo, Gardevoir, Gallade all have a bright upward-facing lumbar region between shoulder blades and hips visible from 3/4 rear view; this "kidney region" bright oval is what gives bipedal creatures their hourglass silhouette read
  let lumbarY=crownEyeY-crownEyeW*0.90;
  let lumbarZone=smoothstep(lumbarY-crownEyeW*0.60,lumbarY,input.worldPosition.y)*(1.0-smoothstep(lumbarY,lumbarY+crownEyeW*0.40,input.worldPosition.y));
  let lumbarMidX=smoothstep(crownEyeW*0.30,crownEyeW*0.08,abs(input.worldPosition.x));
  let lumbarBack=smoothstep(-0.14,-0.54,normal.z)*smoothstep(0.32,0.56,normal.y)*(1.0-metallic)*organicSkin*smoothstep(0.32,0.52,toon)*specShadowMask;
  let lumbarSpec=pow(max(dot(normal,halfVec),0.0),14.0)*lumbarZone*lumbarMidX*lumbarBack;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*lumbarSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial thigh inner-face shadow: the inner surface of each thigh (facing medially, toward the midline between the legs) is permanently self-shadowed by the opposite leg — on bipeds standing straight, the inner thigh surfaces face each other and receive no direct light; gives legs their tubular 3D quality (Lucario, Blaziken, Mewtwo standing posture inner thigh shadow)
  let medThighY=crownEyeY-crownEyeW*1.30;
  let medThighZone=smoothstep(medThighY-crownEyeW*0.60,medThighY,input.worldPosition.y)*(1.0-smoothstep(medThighY,medThighY+crownEyeW*0.50,input.worldPosition.y));
  let medThighLat=smoothstep(crownEyeW*0.24,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.60,crownEyeW*1.0,abs(input.worldPosition.x)))*(1.0-metallic)*organicSkin;
  let medThighFace=smoothstep(0.10,0.40,abs(normal.x)*(1.0-sign(input.worldPosition.x)*sign(normal.x)*1.0))*smoothstep(0.06,0.20,toon);
  lit=lit*(1.0-medThighZone*medThighLat*clamp(medThighFace,0.0,1.0)*0.18);
  // Medial inner-leg ambient fill: the inner-facing surfaces of the legs pick up soft blue-sky fill from the open sky between the legs — a cool ambient on the medial surface prevents it from going pure black and gives leg-gap depth; in Digimon and Pokemon sprite art the leg gap always has a gentle sky fill separating leg tubes from each other
  let medLegFill=smoothstep(crownEyeW*0.04,crownEyeW*0.52,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*1.0,abs(input.worldPosition.x)));
  let medLegInward=clamp(-sign(input.worldPosition.x)*normal.x,0.0,1.0)*smoothstep(0.12,0.36,abs(normal.x))*(1.0-metallic)*smoothstep(0.06,0.22,toon);
  let medLegY=smoothstep(crownEyeY-crownEyeW*2.60,crownEyeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.40,input.worldPosition.y));
  lit=clamp(lit+vec3<f32>(0.44,0.54,0.74)*medLegFill*medLegInward*medLegY*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Cranial back-of-head crescent: the rear of the skull just above the neck is always deeply shadowed — the back-of-head never receives key light and is lit only by sky fill; modeled as backward-facing zone at crown level; Charizard, Mewtwo, Blaziken back-of-skull crescent shadow creates the head-is-round silhouette read
  let occipCrescentY=crownEyeY+crownEyeW*0.40;
  let occipCrescentZone=smoothstep(occipCrescentY-crownEyeW*0.60,occipCrescentY,input.worldPosition.y)*(1.0-smoothstep(occipCrescentY,occipCrescentY+crownEyeW*0.70,input.worldPosition.y));
  let occipCrescentBack=smoothstep(-0.14,-0.60,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.06,0.22,toon);
  lit=lit*(1.0-occipCrescentZone*occipCrescentBack*0.20);
  // Tail root lateral crease shadow: the junction where the tail inserts into the rump has a narrow horizontal shadow crease on the lateral faces; gives anatomical weight to the tail; visible on all tailed Pokemon and Digimon (Charizard, Agumon, Machamp tail-base crease)
  let tailRootY=crownEyeY-crownEyeW*1.80;
  let tailRootBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-tailRootY)/(crownEyeW*0.14+0.001));
  let tailRootLateral=smoothstep(0.22,0.56,abs(normal.x))*smoothstep(0.20,0.0,abs(normal.z))*tailRootBand*(1.0-metallic)*(1.0-tipDist)*smoothstep(0.28,0.48,toon);
  lit=lit*(1.0-tailRootLateral*0.22);

  // Silhouette element halo: vivid elements project a broad element-hue glow along the entire silhouette beyond just the rim — Charizard orange aura at edges, Pikachu yellow outer glow, Vaporeon cyan-white perimeter; this is different from the rim light (which is tighter and specular-based) — the halo is a broad diffuse emission from the silhouette (official Pokemon key-art quality)
  let haloGate=smoothstep(0.68,0.82,fresnel)*clamp((palBright-0.44)/0.36,0.0,1.0)*(1.0-metallic)*smoothstep(0.28,0.58,toon);
  lit=clamp(lit+scene.palette2.rgb*haloGate*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Claw and talon tip point brightening: the extreme tip of each claw/talon catches a tiny specular flash from the sharp point geometry — Mewtwo/Charizard/Lucario claw tip glint quality; makes claws look sharp and hard
  let clawTipPoint=clawTip*smoothstep(0.0,-0.04,input.worldPosition.y)*smoothstep(0.22,0.36,input.worldPosition.z)*(1.0-metallic)*rawSpec*0.50;
  lit=clamp(lit+vec3<f32>(0.96,0.97,1.0)*clawTipPoint,vec3<f32>(0.0),vec3<f32>(1.0));
  // Finger/toe tip pad spherical highlight: on the rounded padded tip of each digit at the paw level, there's an overhead specular on the very top of the pad — the toe-pad sphere catches key light exactly at its zenith; Mewtwo's rounded finger-tip pads, Eevee's paw-tip pads, Pikachu's paw tips all have this small bright oval at the very top of each toe; modeled as a tight upward+forward specular at clawTip level
  let padTipSpec=clawTip*smoothstep(0.12,-0.06,input.worldPosition.y)*smoothstep(0.36,0.54,normal.y)*(1.0-metallic)*organicSkin;
  let padTipSpecV=pow(max(dot(normal,halfVec),0.0),64.0)*padTipSpec*specShadowMask*smoothstep(0.42,0.64,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*padTipSpecV*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Interdigital web SSS: on aquatic creatures (Vaporeon, Feraligatr, Blastoise, Politoed) and some others, the thin skin between digits transmits light as SSS when backlit — the web skin glows warm-pink/blue at the toe gaps when the creature is partially backlit; this "finger web glow" is characteristic of aquatic/amphibious Pokemon; modeled as SSS at claw-tip height and lateral extremity
  let webGate=blueSheen*clawTip*smoothstep(0.42,0.64,fresnel)*(1.0-metallic)*organicSkin*smoothstep(0.06,0.24,toon)*0.22;
  let webSSS=max(0.0,-dot(normal,lightDir))*webGate;
  lit=clamp(lit+mix(vec3<f32>(0.48,0.16,0.10),scene.palette2.rgb*0.70+vec3<f32>(0.30),0.60)*webSSS*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Under-claw deep shadow: the underside of claw tips (negative normal.y at claw tip zone) is in deep occlusion — the concave inner surface of claws never receives direct light; this shadow makes claws look sharp and 3D (Charizard/Mewtwo/Lucario claw inner shadow quality)
  let underClawShadow=clawTip*smoothstep(-0.30,-0.62,normal.y)*(1.0-metallic)*0.36;
  lit=lit*(1.0-underClawShadow);
  // Fire breath heat distortion shimmer: fire-type creatures have heat-shimmer scintillation on the forward-facing neck and chin skin — Charizard, Typhlosion, Magmar; the skin near the mouth/breath zone has a high-frequency shimmer from heat waves affecting the local normal; modeled as very fine-frequency perlin-like variation on the neck zone adding to the bump normal; distinct from the throat thermal (which is a flat glow, this is a texture)
  let heatShimmerGate=warmDom*organicSkin*(1.0-metallic)*smoothstep(0.36,0.58,toon)*clamp(palBright-0.28,0.0,1.0)*0.18;
  let heatShimmerY=smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.30,crownEyeY+crownEyeW*0.20,input.worldPosition.y));
  let heatWaveA=sin(input.worldPosition.x*scale*22.0+input.worldPosition.z*scale*18.0+fv*14.0)*0.5+0.5;
  let heatWaveB=sin(input.worldPosition.y*scale*16.0+input.worldPosition.x*scale*14.0+fv*11.0)*0.5+0.5;
  let heatShimmerSpec=pow(max(dot(normalize(bumpNormal+vec3<f32>(heatWaveA-0.50,heatWaveB-0.50,0.0)*0.12),halfVec),0.0),90.0)*heatShimmerGate*heatShimmerY*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.82,0.44)*heatShimmerSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Throat thermal gradient: Fire-dominant creatures radiate heat from within their throat — the skin above the chest at chin/jaw level glows a warm amber-orange from internal fire breath heat; Charizard and Typhlosion show this flame-belly warm glow at the neck base; distinct from chin bounce (which is cool ambient fill)
  let throatThermalY=crownEyeY-crownEyeW*0.60;
  let throatThermalZone=smoothstep(throatThermalY-crownEyeW*0.60,throatThermalY,input.worldPosition.y)*(1.0-smoothstep(throatThermalY,throatThermalY+crownEyeW*0.30,input.worldPosition.y));
  let throatThermalFace=smoothstep(-0.10,-0.44,normal.y)*smoothstep(0.10,0.36,normal.z)*(1.0-metallic)*smoothstep(0.08,0.30,toon);
  let throatThermalGate=warmDom*clamp(palBright-0.26,0.0,1.0)*0.22;
  lit=clamp(lit+vec3<f32>(0.90,0.34,0.04)*throatThermalZone*throatThermalFace*throatThermalGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal spine/crest rim highlight: the absolute top of the creature (highest Y, near spine center) catches a bright top-light rim — the crown of the head, top of dorsal fin, and tallest spine tip all pick up skylight from above; all official Pokemon art shows this bright crown catch on top of the creature silhouette (Charizard crown, Vaporeon dorsal top, Mewtwo crown)
  let dorsalRimGate=smoothstep(0.60,0.80,normal.y)*smoothstep(crownEyeY+crownEyeW*0.40,crownEyeY+crownEyeW*1.20,input.worldPosition.y)*(1.0-metallic)*smoothstep(0.44,0.66,toon);
  let dorsalRimColor=mix(vec3<f32>(0.92,0.88,0.84),scene.palette2.rgb*0.70+vec3<f32>(0.30),0.30);
  lit=clamp(lit+dorsalRimColor*dorsalRimGate*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly sphere apple-highlight: on rounded plump creatures, the forward-facing lower belly zone has a broad oval specular area like the highlight on a sphere/apple — Snorlax/Jigglypuff/Blastoise/Pikachu round belly front specular; the absolute forward-facing center of the belly sphere where the normal points most directly at the viewer catches the broadest key-light specular; separate from the lateral mid-width spec
  let bellyAppleGate=smoothstep(0.50,0.80,belly)*(1.0-metallic)*organicSkin*smoothstep(0.44,0.68,toon)*0.18;
  let bellyAppleFwd=pow(max(dot(normal,vec3<f32>(0.0,0.0,1.0)),0.0),8.0)*bellyAppleGate*specShadowMask;
  lit=clamp(lit+mix(vec3<f32>(1.0,0.98,0.94),scene.palette2.rgb*0.60+vec3<f32>(0.40),0.24)*bellyAppleFwd*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly sphere roundness AO: the very bottom of a round belly sphere receives a faint darkening ring from self-AO — makes the belly look like an inflated sphere rather than a flat disc; the underside receives less ambient because the curved belly blocks the lower hemisphere (Snorlax/Pikachu/Jigglypuff round belly depth)
  let bellyRoundAO=smoothstep(0.58,0.80,belly)*smoothstep(-0.32,-0.58,normal.y)*(1.0-metallic)*0.18;
  lit=lit*(1.0-bellyRoundAO*0.20);
  // Pattern zone boundary brightness pop: where the pattern transitions to base color, the leading edge of the brighter zone gets a brief brightness boost — hand-painted illustration effect where markers and inks brighten at zone boundaries; makes markings pop with Pokemon official art clarity
  let patBound=clamp(fwidth(pat_raw)*12.0,0.0,1.0)*clamp(scene.material.w-0.3,0.0,1.0)*(1.0-metallic);
  let patBoundBright=patBound*smoothstep(0.40,0.70,toon)*0.12;
  lit=clamp(lit+lit*patBoundBright,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element ambient particle field: Fire/Electric/Light creatures have faint floating micro-bright dots in the air around them (Charizard ember sparks barely visible, Jolteon electrostatic float, Togekiss divine sparkle); adds living elemental ambiance
  let particleGate=clamp((palBright-0.62)/0.26,0.0,1.0)*(1.0-metallic)*warmDom*0.30+lightSheen*0.50;
  let partCell=floor(input.worldPosition*scale*3.40+vec3<f32>(fv*7.3,fv*3.1,fv*5.8));
  let partH=fract(sin(dot(partCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let partFine=fract(input.worldPosition*scale*3.40+vec3<f32>(fv*7.3,fv*3.1,fv*5.8))-0.5;
  let partDot=smoothstep(0.10,0.04,length(partFine))*step(0.95,partH)*particleGate;
  lit=clamp(lit+scene.palette2.rgb*partDot*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Limb top highlight band: the very top surface of each limb (at shoulder/thigh height) catches a thin bright stripe from overhead key light — this is the limb-form highlight that separates arm from torso in all 3D anime character renders; cylindrical limbs need a top highlight to read as round (Blaziken/Lucario/Arcanine upper limb quality)
  let limbTopFace=smoothstep(0.58,0.82,normal.y)*smoothstep(0.28,0.50,abs(normal.x));
  let limbTopY=smoothstep(crownEyeY-crownEyeW*2.0,crownEyeY-crownEyeW*1.0,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.0,crownEyeY+crownEyeW*0.5,input.worldPosition.y));
  let limbTopHighlight=limbTopFace*limbTopY*(1.0-metallic)*smoothstep(0.52,0.78,toon)*0.16;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.93)*limbTopHighlight,vec3<f32>(0.0),vec3<f32>(1.0));
  // Under-arm armpit AO: the region directly under each arm shoulder (facing inward toward torso, upward-blocked) receives strong contact AO from the arm against the body — Pikachu, Eevee, Lucario, Charizard all have a dark pinch under the arm that visually separates limb from torso; this is the single most critical AO region for creature silhouette readability
  let underArmY=crownEyeY-crownEyeW*1.60;
  let underArmZone=smoothstep(underArmY-crownEyeW*0.40,underArmY,input.worldPosition.y)*(1.0-smoothstep(underArmY,underArmY+crownEyeW*0.40,input.worldPosition.y));
  let underArmInward=smoothstep(0.34,0.60,abs(normal.x))*smoothstep(-0.08,-0.36,normal.y)*(1.0-metallic)*0.22;
  lit=lit*(1.0-underArmZone*underArmInward*0.28);
  // Pattern color vibrancy lift: pattern-present regions in well-lit zones get color saturation boost — pattern features (stripes, spots) should appear vivid, not washed, when lit; matches how Pokemon official art makes markings jump out with enhanced saturation compared to base body
  let patVibrancy=smoothstep(0.56,0.80,toon)*(1.0-metallic)*clamp(scene.material.w-0.4,0.0,0.6)*0.22;
  let pvLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(vec3<f32>(pvLuma),lit,1.0+patVibrancy),vec3<f32>(0.0),vec3<f32>(1.0));
  // Joint fold skin texture: the skin at bend points (elbow/knee crease) shows faint micro-wrinkle lines in the direction perpendicular to the joint axis — organic texture on living creatures vs clean game characters (Pikachu/Eevee/Mewtwo elbow fold quality); this is the subtle skin fold texture visible in close-up renders
  let jointFoldGate=organicSkin*smoothstep(0.36,0.62,toon)*(1.0-metallic)*0.48;
  let elbFoldW=sin(input.worldPosition.z*scale*14.0+input.worldPosition.x*scale*6.0+fv*5.0)*0.5+0.5;
  let elbFold=step(0.88,elbFoldW)*elbowBand*jointFoldGate;
  let kneeFoldW=sin(input.worldPosition.z*scale*14.0+input.worldPosition.x*scale*5.0+fv*3.7)*0.5+0.5;
  let kneeFold=step(0.88,kneeFoldW)*kneeBandHL*jointFoldGate;
  lit=lit*(1.0-(elbFold+kneeFold)*0.12);
  // Inner knee skin tension horizontal wrinkle shadow: when the leg bends, the skin on the inside of the knee (the popliteal hollow) creates horizontal compression wrinkles from skin bunching — these are darker lines perpendicular to the limb axis at the posterior knee; distinct from the popliteal hollow shadow (which is a depth shadow) — these are skin-texture wrinkles; gives knees realistic skin texture
  let kneeTensionGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.60,toon)*0.30;
  let kneeTensionW=sin(input.worldPosition.z*scale*18.0+fv*4.2)*0.5+0.5;
  let kneeTensionLine=step(0.90,kneeTensionW)*kneeBandHL*kneeTensionGate*smoothstep(-0.08,-0.44,normal.z)*smoothstep(0.14,0.04,abs(normal.y));
  lit=lit*(1.0-kneeTensionLine*0.10);
  // Upper back fill light: the dorsal surface at upper-back height (between shoulder blades and spine top) catches a cool secondary fill from the fill light direction — gives the back volume and prevents the rear from being flat; visible in 3/4-rear view of Mewtwo, Arcanine, Charizard; a broad soft back-fill highlight
  let upBackGate=(1.0-metallic)*smoothstep(0.36,0.60,toon)*0.18;
  let upBackZone=smoothstep(torsoY-crownEyeW*0.60,torsoY+crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.20,torsoY+crownEyeW*0.80,input.worldPosition.y));
  let upBackFace=smoothstep(-0.20,-0.56,normal.z)*smoothstep(0.24,0.50,normal.y)*smoothstep(0.16,0.04,abs(normal.x));
  let upBackSpec=pow(max(dot(normal,fillHalfVec),0.0),8.0)*upBackZone*upBackFace*upBackGate;
  lit=clamp(lit+mix(vec3<f32>(0.50,0.62,0.88),scene.palette2.rgb*0.50+vec3<f32>(0.50),0.28)*upBackSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scapular poster shadow patches: on the back, each shoulder blade (scapula) creates a slightly darker shadow zone on the skin immediately around and below it — the skin stretched over the scapula is at a slightly different angle than the central spine and lateral body, creating bilateral shadow patches that flank the bright spine midline; on Mewtwo, Gallade, Blaziken, Gardevoir the interscapular region shows these bilateral darker patches flanking the bright vertebral column; this creates the "T" shaped anatomy read on the upper back
  let scapShadowY=smoothstep(torsoY-crownEyeW*0.20,torsoY+crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.40,torsoY+crownEyeW*1.20,input.worldPosition.y));
  let scapShadowLat=smoothstep(crownEyeW*0.28,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.60,crownEyeW*0.94,abs(input.worldPosition.x)));
  let scapShadowBack=smoothstep(-0.14,-0.48,normal.z)*smoothstep(0.08,0.26,normal.y)*smoothstep(0.16,0.30,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.10,0.26,toon);
  lit=lit*(1.0-scapShadowY*scapShadowLat*scapShadowBack*0.14);
  // Elbow point (olecranon) specular: the posterior point of the elbow joint is the hardest surface and catches a distinctive tight specular when the arm is extended — Mewtwo's elbow sphere, Gardevoir's arm joint, Lucario's arm elbow — this elliptical highlight on the posterior-lateral elbow gives arms their "hinged machinery" quality; posterior arm at elbow height
  let elbowPointGate=(1.0-metallic)*organicSkin*specShadowMask*smoothstep(0.44,0.68,toon);
  let elbowPointLat=smoothstep(crownEyeW*0.80,crownEyeW*1.18,abs(input.worldPosition.x));
  let elbowPointBack=smoothstep(-0.06,-0.44,normal.z)*smoothstep(0.16,0.04,abs(normal.y));
  let elbowPointSpec=pow(max(dot(normal,halfVec),0.0),80.0)*elbowBand*elbowPointLat*elbowPointBack*elbowPointGate;
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*elbowPointSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Knee front meniscus specular: the convex dome of the kneecap has a forward-facing crescent specular that is different from the posterior olecranon — the front patella catches key light as an upward-curved bright spot; Blaziken, Lucario, Scizor knee-fronts show this as a small ellipse at the exact knee height, forward and upward facing; makes bipedal stance look anatomically grounded
  let patellGate=(1.0-metallic)*organicSkin*specShadowMask*smoothstep(0.44,0.68,toon);
  let patellLat=smoothstep(crownEyeW*0.72,crownEyeW*1.10,abs(input.worldPosition.x));
  let patellFwd=smoothstep(0.36,0.62,normal.z)*smoothstep(0.14,0.04,abs(normal.x))*smoothstep(0.12,0.30,normal.y);
  let patellSpec=pow(max(dot(normal,halfVec),0.0),64.0)*kneeBandHL*patellLat*patellFwd*patellGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*patellSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pectoral anterior fold highlight: the boundary line where the chest-front meets the arm at the shoulder creates a subtle bright fold catching overhead light — in biped Pokemon (Blaziken, Mewtwo, Machamp, Gardevoir) this pec-to-arm junction is one of the key anatomy reads that shows the creature has distinct arm vs chest muscle; a diagonal-to-horizontal bright crease just lateral of center chest
  let pectFoldGate=(1.0-metallic)*organicSkin*specShadowMask*smoothstep(0.40,0.64,toon)*0.22;
  let pectFoldY=crownEyeY-crownEyeW*0.58;
  let pectFoldBand=smoothstep(0.07,0.0,abs(input.worldPosition.y-pectFoldY)/(crownEyeW*0.12+0.001));
  let pectFoldLat=smoothstep(crownEyeW*0.36,crownEyeW*0.72,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.72,crownEyeW*1.02,abs(input.worldPosition.x)));
  let pectFoldFwd=smoothstep(0.34,0.60,normal.z)*smoothstep(0.16,-0.04,abs(normal.y));
  let pectFoldSpec=pow(max(dot(normal,halfVec),0.0),28.0)*pectFoldBand*pectFoldLat*pectFoldFwd*pectFoldGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*pectFoldSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lower pectoral boundary shadow: the lower border of the chest muscle (pectoralis major inferior margin) creates a horizontal shadow crease across the mid-chest, separating the rounded chest protrusion from the flatter upper-abdomen below — visible on Mewtwo, Machamp, Gallade, Blaziken as a horizontal dark line at ~pec-bottom height; gives the chest its distinct rounded-muscle-above vs. flat-belly-below character
  let lowPecY=crownEyeY-crownEyeW*0.80;
  let lowPecBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-lowPecY));
  let lowPecX=smoothstep(crownEyeW*0.42,crownEyeW*0.12,abs(input.worldPosition.x));
  let lowPecFwd=smoothstep(0.26,0.54,normal.z)*smoothstep(-0.04,-0.22,normal.y)*(1.0-metallic)*organicSkin*smoothstep(0.10,0.28,toon);
  lit=lit*(1.0-lowPecBand*lowPecX*lowPecFwd*0.14);
  // Sub-patellar tendon ridge specular: the patellar tendon runs vertically from the bottom of the kneecap to the tibial tuberosity — a short vertical tendon band just below the kneecap that catches a narrow bright specular; visible on Blaziken, Lucario, Mewtwo as a vertical bright strip immediately below the knee specular, connecting kneecap to shin; gives the knee anatomical completeness and the vertical tendon quality of realistic leg anatomy
  let subPatY=kneeY-crownEyeW*0.12;
  let subPatBandY=smoothstep(crownEyeW*0.06,crownEyeW*0.0,abs(input.worldPosition.y-subPatY)/(crownEyeW*0.14+0.001));
  let subPatLat=smoothstep(crownEyeW*0.62,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.08,abs(input.worldPosition.x)));
  let subPatMidX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(abs(input.worldPosition.x)-crownEyeW*0.76));
  let subPatFwd=smoothstep(0.38,0.62,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.10,0.28,normal.y)*(1.0-metallic)*organicSkin*specShadowMask*smoothstep(0.44,0.66,toon);
  let subPatSpec=pow(max(dot(normal,halfVec),0.0),52.0)*subPatBandY*subPatLat*subPatMidX*subPatFwd;
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*subPatSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Jaw muscle shadow dimple: the masseter muscle area on the lateral face (cheek-jaw junction) creates a shadow hollow where the jaw muscle inserts into the cheekbone — subtle darkening visible on Charizard, Mewtwo, Gallade; this subtle shadow is what makes cartoon faces look like they have jaw bone structure
  let jawMuscleX=smoothstep(crownEyeW*0.96,crownEyeW*0.52,abs(abs(input.worldPosition.x)-crownEyeW*0.80));
  let jawMuscleY=smoothstep(scene.mouth.y+scene.mouth.w*0.40,scene.mouth.y+scene.mouth.w*1.20,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.20,scene.mouth.y+scene.mouth.w*2.0,input.worldPosition.y));
  let jawMuscleFace=smoothstep(0.14,0.40,abs(normal.x))*smoothstep(0.08,-0.10,normal.y)*(1.0-metallic)*smoothstep(0.10,0.28,toon);
  lit=lit*(1.0-jawMuscleX*jawMuscleY*jawMuscleFace*0.16);
  // Surface tension specularity: smooth element surfaces where light grazes at exactly flat-on angle get an extra very tight peak from the surface tension effect — water/ice/satin surfaces show a distinct elongated glare at near-flat view angles (Vaporeon/Milotic/Articuno body surface at oblique angles)
  let surfaceTensionGate=smoothstep(0.28,0.08,roughness)*(1.0-metallic)*clamp(palBright-0.30,0.0,1.0);
  let tensionAngle=clamp(1.0-abs(dot(normal,view))*1.20,0.0,1.0);
  let surfaceTension=pow(tensionAngle,14.0)*surfaceTensionGate*smoothstep(0.48,0.72,toon);
  lit=clamp(lit+mix(vec3<f32>(1.0),clamp(scene.palette2.rgb*1.10,vec3<f32>(0.0),vec3<f32>(1.0)),0.40)*surfaceTension*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fin/wing membrane translucency: thin fin membranes (Vaporeon, Gyarados, Lugia, Flygon, Togekiss) transmit backlit light — when the creature is between the viewer and the light, the membrane glows with a warm tint; modeled as backlight-facing fresnel on non-solid surfaces
  let finWaterMemGate=blueSheen*(1.0-metallic)*smoothstep(0.38,0.62,fresnel)*smoothstep(0.04,0.22,toon)*0.28;
  let finMembraneBacklit=clamp(1.0-dot(normal,lightDir)*1.10,0.0,1.0);
  lit=clamp(lit+scene.palette2.rgb*finMembraneBacklit*finWaterMemGate*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly plate secondary color: many Pokemon have a distinctly lighter/different-colored belly (Charizard cream belly, Feraligatr teal underside, Tyranitar dark-tan belly, Snorlax beige front vs blue-black back) — modeled as a palette1-tinted color overlay on the forward-facing underside of the torso, fading at the sides; this gives front-view silhouette variety and marks the belly as a separate skin region
  let bellyPlateBand=belly*smoothstep(0.46,0.72,normal.z)*smoothstep(0.14,0.04,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.32,0.56,toon);
  let bellyPlateColor=mix(scene.palette1.rgb*0.90+vec3<f32>(0.10),vec3<f32>(0.92,0.90,0.86),clamp(palBright-0.20,0.0,1.0)*0.50);
  base=mix(base,clamp(bellyPlateColor,vec3<f32>(0.0),vec3<f32>(1.0)),bellyPlateBand*0.30);
  // Metallic edge microflake specular: micro-facet sparkle near glancing angles on Metal-element creatures (Metagross, Lucario, Scizor, Excadrill) — high roughness metals show distributed microflake scatter instead of a single mirror lobe; each micro-cell independently catches the key light producing a scattered sparkle field
  let microflakeGate=metallic*smoothstep(0.22,0.50,roughness)*smoothstep(0.54,0.76,fresnel);
  let mfCell=floor(input.worldPosition*scale*8.0+vec3<f32>(fv*11.3,fv*7.1,fv*9.4));
  let mfH=fract(sin(dot(mfCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let mfAngle=fract(sin(dot(mfCell+vec3<f32>(0.5),vec3<f32>(311.7,74.7,127.1)))*43758.545)*6.283;
  let mfNormalPerturb=normalize(normal+vec3<f32>(cos(mfAngle),sin(mfAngle),0.0)*0.22*mfH);
  let mfSpec=pow(max(dot(mfNormalPerturb,halfVec),0.0),120.0)*step(0.70,mfH)*microflakeGate;
  lit=clamp(lit+vec3<f32>(0.90,0.88,0.86)*mfSpec*0.46,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metallic warm/cool specular split: polished metal surfaces are warmer at their direct-lit specular peak and cooler at their fresnel rim — Metagross, Lucario, Aggron, Steelix show a characteristic warm-gold specular core surrounded by a cool-blue rim reflection that is the defining quality of "game-quality metallic shader"; the key light is warm so its specular is warm, but the sky reflection at glancing angles is cool
  let metalWarmCool=metallic*smoothstep(0.44,0.70,toon);
  let metalSpecWarm=pow(max(dot(normal,halfVec),0.0),32.0)*metalWarmCool*smoothstep(0.60,0.90,dot(normal,halfVec))*specShadowMask;
  let metalFresnel=smoothstep(0.52,0.76,fresnel)*metallic;
  lit=clamp(lit+vec3<f32>(0.96,0.80,0.44)*metalSpecWarm*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  lit=clamp(lit+vec3<f32>(0.50,0.62,0.90)*metalFresnel*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Subsurface thickness gradient: organics (skin, ears, fins) are thinner at extremities and thicker at body core — backlit extremity regions glow with warmth (Eevee ears, Ralts cape, Gardevoir dress, Togekiss wings); SSS falloff is simulated by proximity to body center and normal pointing away from center
  let sssThicknessGate=organicSkin*(1.0-metallic)*clamp(1.0-dot(normal,vec3<f32>(0.0,0.0,1.0))*0.8,0.0,1.0)*smoothstep(0.08,0.24,toon)*smoothstep(0.44,0.30,toon);
  let sssThicknessDist=clamp((1.0-length(input.worldPosition.xy)*scale*0.56),0.0,1.0);
  let sssThicknessColor=mix(vec3<f32>(0.94,0.52,0.28),scene.palette1.rgb*0.80,clamp(1.0-warmDom*1.5,0.0,1.0));
  lit=clamp(lit+sssThicknessColor*sssThicknessGate*(1.0-sssThicknessDist)*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Toon band edge micro-shimmer: at the boundary between adjacent cel bands, a very narrow shimmer line appears — this is the "inner glow at toon boundary" visible in Genshin NPR, Pokemon Gen 8, and Digimon Cyber Sleuth; prevents harsh hard band edges from looking jaggy and adds quality
  let toonEdge0=smoothstep(0.08,0.12,toon)*(1.0-smoothstep(0.12,0.18,toon));
  let toonEdge1=smoothstep(0.32,0.36,toon)*(1.0-smoothstep(0.36,0.42,toon));
  let toonEdge2=smoothstep(0.58,0.62,toon)*(1.0-smoothstep(0.62,0.68,toon));
  let toonEdgeAll=(toonEdge0+toonEdge1+toonEdge2)*(1.0-metallic)*0.22;
  lit=clamp(lit+lit*toonEdgeAll*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Height-based atmospheric tint: tall creatures (Charizard, Gyarados, Lugia, Rayquaza) show slight cool-haze desaturation in lower body from simulated atmospheric depth — makes large creatures read as "big" by adding the cool-blue atmospheric scattering of distance; applied as a downward Y-gradient
  let atmHazeGate=(1.0-metallic)*clamp(crownEyeW*1.60-0.80,0.0,1.0);
  let atmHazeGrad=clamp(1.0-(input.worldPosition.y-0.20)/(crownEyeW*4.0+0.001),0.0,1.0);
  let atmHazeLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  let atmHazeTint=mix(lit,mix(vec3<f32>(atmHazeLuma),lit,0.78)+vec3<f32>(0.008,0.008,0.022),atmHazeGrad*atmHazeGate*0.20);
  lit=clamp(atmHazeTint,vec3<f32>(0.0),vec3<f32>(1.0));
  // High altitude top color shift: the very top of a tall creature receives skylight from overhead that is slightly bluer/cooler than the key light — Rayquaza's upper body is slightly differently hued than the lower body, Lugia's crown is slightly lighter and cooler; for creatures taller than 1× crownEyeW, the top 20% shifts toward the sky ambient tint
  let altTopGate=(1.0-metallic)*clamp((input.worldPosition.y-(crownEyeY+crownEyeW*0.40))/(crownEyeW*0.80),0.0,1.0)*smoothstep(0.42,0.64,toon);
  let altTopSky=vec3<f32>(-0.02,-0.01,0.04);
  lit=clamp(lit+altTopSky*altTopGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metallic clearcoat: high-metallic smooth surfaces have a secondary thin clear lacquer layer that adds a bright specular above the metallic specular — car paint / Metagross / Scizor; the clearcoat is slightly bluer and tighter than the underlying metallic spec and visible at a slightly different angle
  let clearcoatGate=metallic*smoothstep(0.30,0.08,roughness);
  let clearcoatRefl=pow(max(dot(normal,halfVec),0.0),360.0)*clearcoatGate*specShadowMask*specOccProxy;
  let clearcoatFresnel=pow(clamp(1.0-dot(normal,view),0.0,1.0),5.0);
  lit=clamp(lit+vec3<f32>(0.84,0.88,0.96)*(clearcoatRefl+clearcoatFresnel*clearcoatGate*0.12)*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Skin pore micro-shadow: organic skin surfaces show a barely-perceptible high-frequency micro-variation in brightness from individual pores and skin cell clusters — extremely subtle, only present on matte organic skin (not metallic, not smooth), creates natural skin texture without needing a dedicated normal map; analogous to Genshin skin roughness micro-detail
  let skinPoreGate=organicSkin*smoothstep(0.55,0.76,roughness)*(1.0-metallic)*smoothstep(0.42,0.62,toon)*0.14;
  let poreCell=floor(input.worldPosition*scale*14.0+vec3<f32>(fv*3.7,fv*5.3,fv*4.1));
  let poreSeed=fract(sin(dot(poreCell,vec3<f32>(127.1,311.7,74.7)))*43758.545);
  lit=lit*(1.0-poreSeed*poreSeed*skinPoreGate*0.08);
  // Scale body iridescence: at oblique viewing angles, Dragon/Metal scale-covered bodies show faint spectral color shift — Dragonite/Flygon/Metagross characteristic scale-body iridescence at edges; only fires on warm-dominant (Dragon/Fire gated) smooth surfaces
  let scaleIridGate=warmDom*smoothstep(0.18,0.04,roughness)*(1.0-metallic)*smoothstep(0.52,0.70,fresnel);
  let scaleIridPhase=input.worldPosition.y*scale*2.40+input.worldPosition.x*scale*1.20+fv*3.14;
  let scaleIridColor=vec3<f32>(sin(scaleIridPhase)*0.5+0.5,sin(scaleIridPhase+2.094)*0.5+0.5,sin(scaleIridPhase+4.189)*0.5+0.5);
  lit=clamp(lit+scaleIridColor*scaleIridGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal saturation boost: upward-facing surfaces in well-lit zones get slightly higher saturation — Pokemon art makes dorsal surfaces more vivid than lateral/ventral faces (Charizard's back is more saturated than its belly)
  let dorsalSatGate=smoothstep(0.54,0.80,normal.y)*smoothstep(0.62,0.84,toon)*(1.0-metallic)*0.12;
  let dorsalLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(vec3<f32>(dorsalLuma),lit,1.0+dorsalSatGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Limb extremity desaturation gradient: as limbs extend outward from body center (beyond 1.3× crownEyeW laterally), they gradually desaturate and lighten slightly — Pikachu arm tips are paler than torso, Charizard wing tips lighter, Arcanine leg fur lighter at paw; gives creature visual weight by concentrating color at core and fading toward periphery
  let extDesat=smoothstep(crownEyeW*1.20,crownEyeW*1.80,abs(input.worldPosition.x))*(1.0-metallic)*0.22;
  let extDesatLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(lit,vec3<f32>(extDesatLuma)*1.06,extDesat),vec3<f32>(0.0),vec3<f32>(1.0));
  // Vivid element self-emission: bright vivid elements (Fire, Electric, Light, Psychic) have a very subtle full-body ambient self-glow — like a warm ember or electric charge radiating from within the body at 2-4% intensity; distinct from element specular and halo; makes creatures feel energetically alive rather than passively lit; gated on high palBright and non-metallic
  let selfEmitGate=clamp((palBright-0.50)/0.30,0.0,1.0)*(1.0-metallic)*0.04;
  lit=clamp(lit+scene.palette2.rgb*selfEmitGate*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Light/Fairy-type radiant aura: Togekiss, Gardevoir, Sylveon, Xerneas emit a soft warm-gold/pink body radiance that is distinct from simple bright elements — they look like they're made of concentrated light, with a full-body warm haze that makes them appear to emanate from within; modeled as element-pink + warm-gold mix on all surfaces, strongest at silhouette
  let lightFairyGate=pinkDomGate*clamp(palBright-0.52,0.0,1.0)*(1.0-metallic)*smoothstep(0.12,0.36,toon)*0.24;
  let lightFairyHaze=mix(vec3<f32>(0.98,0.80,0.44),scene.palette2.rgb*0.60+vec3<f32>(0.40),0.50);
  lit=clamp(lit+lightFairyHaze*lightFairyGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dragon spine anisotropic iridescence: dragon-type dorsal spines and ridge scales catch light with angle-dependent hue shift — Dragonair glowing orbs, Rayquaza ridge bands, Salamence scale shimmer; anisotropic scattering along the spine Y-axis makes the spine ridge shift from one hue to another as the viewing angle changes; distinct from general iridescence
  let dragonSpineGate=warmDom*spineX*spineY*smoothstep(0.20,0.04,roughness)*(1.0-metallic)*smoothstep(0.48,0.70,toon)*clamp(palBright-0.24,0.0,1.0)*specShadowMask;
  let dragonAnisoH=normalize(vec3<f32>(0.0,1.0,0.0)-(normal*dot(normal,vec3<f32>(0.0,1.0,0.0))));
  let dragonAnisoSpec=pow(max(dot(dragonAnisoH,halfVec),0.0)*0.60+max(dot(normal,halfVec),0.0)*0.40,14.0)*dragonSpineGate;
  let dragonSpinePhase=dot(view,halfVec)*4.0+fv*3.0;
  let dragonIridColor=vec3<f32>(smoothstep(0.30,0.60,sin(dragonSpinePhase)*0.5+0.5),smoothstep(0.20,0.55,sin(dragonSpinePhase+2.094)*0.5+0.5),smoothstep(0.10,0.55,sin(dragonSpinePhase+4.189)*0.5+0.5));
  lit=clamp(lit+dragonIridColor*dragonAnisoSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Side flank fill sheen: lateral-facing surfaces in mid-toon zone receive secondary element-hue fill — creates the three-zone rendering quality (bright top, element-lit sides, cool shadow bottom) seen in all Gen 3+ Pokemon/Digimon renders
  let flankFillGate=smoothstep(0.34,0.52,abs(normal.x))*smoothstep(0.38,0.52,toon)*smoothstep(0.62,0.42,toon)*(1.0-metallic)*0.09;
  lit=clamp(lit+scene.palette2.rgb*flankFillGate*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Global lit zone saturation amplification: in the fully lit zones (toon > 0.62), colors become more saturated because strong key light boosts apparent chroma — this is a basic property of intense light on saturated pigments and is why official Pokemon art always looks more vivid in the lit area than in the shadow; modeled as a controlled saturation increase in the lit half of the toon range using desaturated-to-vivid blend; prevents the lit side from looking "washed out"
  let globalSatBoost=smoothstep(0.62,0.84,toon)*(1.0-metallic)*0.10;
  let globalSatLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(vec3<f32>(globalSatLuma),lit,1.0+globalSatBoost),vec3<f32>(0.0),vec3<f32>(1.0));
  // Pattern mark pigment SSS bleed: at the edges of color pattern marks (spots, stripes, bands), the darker pigment layer absorbs into the adjacent lighter skin via SSS diffusion — creates a narrow warm-pink bleed zone about 2-4% of creature width at each mark boundary; visible in close-up Pokemon renders as a slight pink-peach fringe around Pikachu's yellow-to-brown stripe boundary, Arcanine's orange-to-cream boundary; separates flat stencil patterns from organic-feeling marks
  let patBleedAlpha=textureSample(patternTexture,patternSampler,vec2<f32>(input.worldPosition.x*scale*0.5+0.5,input.worldPosition.y*scale*0.5+0.5)).a;
  let patBleedEdge=clamp(abs(fwidth(patBleedAlpha))*3.0,0.0,1.0);
  let patBleedSSS=patBleedEdge*organicSkin*(1.0-metallic)*smoothstep(0.38,0.60,toon)*0.20;
  lit=clamp(lit+mix(vec3<f32>(0.48,0.12,0.04),scene.palette1.rgb*0.60+vec3<f32>(0.24,0.06,0.02),clamp(palBright-0.20,0.0,1.0))*patBleedSSS,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ear cast shadow on head: each ear pinna protrudes from the lateral skull and casts a shadow on the adjacent head surface below-and-behind the ear base — Pikachu's iconic shadow behind each ear, Eevee's inner-ear shadow on face, Espeon's ear shadow on temple; without this shadow ears look pasted-on; a dark patch on the lateral-upper head just posterior to where each ear attaches; gated on fv ≤ 0.65 to match creatures with anatomically visible ear pinnae (same gate as earInner)
  let earCastShadowGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(fv,0.65)*0.20;
  let earCastShadowY0=smoothstep(earTopY-crownEyeW*0.60,earTopY-crownEyeW*0.24,input.worldPosition.y)*(1.0-smoothstep(earTopY-crownEyeW*0.24,earTopY+crownEyeW*0.18,input.worldPosition.y));
  let earCastShadowLat=smoothstep(crownEyeW*0.42,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*1.10,abs(input.worldPosition.x)));
  let earCastShadowBack=smoothstep(0.04,-0.28,normal.z)*smoothstep(0.16,0.38,normal.y)*smoothstep(0.20,0.44,abs(normal.x));
  lit=lit*(1.0-earCastShadowY0*earCastShadowLat*earCastShadowBack*earCastShadowGate*0.22);
  // Muzzle/snout undershadow on throat: the forward-protruding muzzle blocks overhead light from reaching the throat/neck surface directly below — the chin-to-throat corridor is always darker than the cheek; Arcanine, Eevee, Charmander, Growlithe, Agumon all show a distinct shadow under the snout on the throat; without this the muzzle looks flat and non-projecting; a forward-facing shadow on the throat column just below the mouth, wider than the narrow chinBand and extending further down the neck
  let muzzleUnderShadowGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.28;
  let muzzleUnderY=smoothstep(scene.mouth.y-scene.mouth.w*0.60,scene.mouth.y-scene.mouth.w*0.20,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.20,scene.mouth.y+scene.mouth.w*0.60,input.worldPosition.y));
  let muzzleUnderX=smoothstep(crownEyeW*0.44,crownEyeW*0.14,abs(input.worldPosition.x));
  let muzzleUnderFwd=smoothstep(0.20,0.54,normal.z)*smoothstep(0.12,-0.24,normal.y)*smoothstep(0.14,0.04,abs(normal.x));
  lit=lit*(1.0-muzzleUnderY*muzzleUnderX*muzzleUnderFwd*muzzleUnderShadowGate*0.18);
  // Specular peak internal corona: a wider, dimmer secondary specular lobe that surrounds the primary specular peak — when the main specular hits maximum (rawSpec ≈ 1.0) a soft broader halo forms around it; simulates real microfacet highlight spread and matches Gen 8/9 Pokemon renders where tight specular discs always have a soft surrounding glow; the corona lobe uses a lower exponent (broader) than the primary spec and is tinted slightly warm to feel like the light source's penumbra; present on organic and specular-ready surfaces; gated to prevent firing on rough matte creatures
  let specCoronaGate=smoothstep(0.36,0.18,roughness)*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.44,0.68,toon)*specShadowMask;
  let specCoronaRaw=pow(max(dot(normal,halfVec),0.0),14.0);
  let specCoronaInner=pow(max(dot(normal,halfVec),0.0),52.0);
  let specCoronaBand=clamp(specCoronaRaw-specCoronaInner*0.80,0.0,1.0)*specCoronaGate;
  let specCoronaColor=mix(vec3<f32>(0.94,0.90,0.82),scene.palette2.rgb*0.38+vec3<f32>(0.62,0.60,0.56),clamp(palBright-0.30,0.0,1.0));
  lit=clamp(lit+specCoronaColor*specCoronaBand*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fin/wing webbing SSS translucency: thin fin or wing membranes let backlight through — Vaporeon's dorsal fin glows blue-cyan when backlit, Gyarados's lateral fins transmit orange-red light, Flygon's wings are translucent green; the webbing is thinnest at the outer edge and thickest at the body attachment spine; SSS color is element-tinted, present only on Air/Water/Plant/Shadow creatures with lateral extent (lateralExt gate) and thin membranes; distinct from the tailTipSSS which is sphere-based
  let finWebSSSGate=lateralExt*(1.0-metallic)*smoothstep(0.04,0.20,toon)*clamp(palBright-0.20,0.0,1.0)*0.26;
  let finWebBack=max(0.0,-dot(normal,lightDir));
  let finWebEdgeDist=smoothstep(crownEyeW*0.80,crownEyeW*1.60,abs(input.worldPosition.x));
  let finWebFin=smoothstep(0.12,0.40,abs(normal.x))*smoothstep(0.24,0.04,abs(normal.y));
  let finWebSSS=finWebBack*finWebEdgeDist*finWebFin*finWebSSSGate;
  let finWebColor=mix(vec3<f32>(0.40,0.66,0.96),scene.palette2.rgb*0.72+vec3<f32>(0.16,0.18,0.20),clamp(palBright-0.28,0.0,1.0));
  lit=clamp(lit+finWebColor*finWebSSS*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Bicep apex forward specular: the highest point of the bicep muscle at the front of the upper arm catches a sharp specular from the key light — a small oval of brightness on the anterior-facing upper arm between shoulder and elbow height; Machamp, Mewtwo, Lucario, Blaziken, Conkeldurr all show this bicep peak highlight that indicates muscular volume and differentiated upper/lower arm anatomy; without it upper arm reads as uniformly cylindrical
  let bicepApexGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.20;
  let bicepApexY=smoothstep(elbowY+crownEyeW*0.40,elbowY+crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.80,elbowY+crownEyeW*1.30,input.worldPosition.y));
  let bicepApexLat=smoothstep(crownEyeW*0.80,crownEyeW*1.14,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.14,crownEyeW*1.48,abs(input.worldPosition.x)));
  let bicepApexFace=smoothstep(0.28,0.56,normal.z)*smoothstep(0.12,0.30,normal.y)*smoothstep(0.14,0.04,abs(normal.x));
  let bicepApexSpec=pow(max(dot(normal,halfVec),0.0),40.0)*bicepApexY*bicepApexLat*bicepApexFace*bicepApexGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*bicepApexSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior shin tibial crest highlight: the sharp anterior ridge of the lower leg (the tibia crest, the "shinbone" ridge) catches overhead key light as a narrow elongated bright line — Blaziken's leg, Lucario's ankle crest, Mewtwo's lower leg all show a bright narrow front-shin highlight running from knee to ankle; without it the lower leg reads as a uniform cone cylinder; modeled as a forward-and-slightly-upward facing surface at narrow X width between knee and ankle height
  let shinCrestGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let shinCrestY=smoothstep(kneeY-crownEyeW*0.10,kneeY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.40,kneeY-crownEyeW*1.30,input.worldPosition.y));
  let shinCrestLat=smoothstep(crownEyeW*0.54,crownEyeW*0.82,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.82,crownEyeW*1.12,abs(input.worldPosition.x)));
  let shinCrestMidX=smoothstep(crownEyeW*0.12,crownEyeW*0.04,abs(abs(input.worldPosition.x)-crownEyeW*0.68));
  let shinCrestFace=smoothstep(0.34,0.62,normal.z)*smoothstep(0.12,0.28,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  let shinCrestSpec=pow(max(dot(normal,halfVec),0.0),60.0)*shinCrestY*shinCrestLat*shinCrestMidX*shinCrestFace*shinCrestGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*shinCrestSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sub-ocular tear-trough shadow: the concave groove between the lower eyelid and the cheek (the nasojugal fold / tear-trough) creates a permanent shadow crescent — in all high-quality game characters this dark crescent is the primary cue that the eye socket is recessed into the face rather than flush; Mewtwo, Gardevoir, Espeon, Sylveon all show a subtle dark arc below each eye; without it the face looks plastic-flat from eye to chin; a narrow concave shadow arc just below the eye lower rim at the cheek-lid junction
  let tearTroughGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.26;
  let tearTrough0Y=scene.eye0.y-scene.eye0.w*0.70;
  let tearTrough1Y=scene.eye1.y-scene.eye1.w*0.70;
  let tearTrough0=smoothstep(crownEyeW*0.08,crownEyeW*0.0,abs(input.worldPosition.y-tearTrough0Y)/(crownEyeW*0.16+0.001))*smoothstep(scene.eye0.w*0.80,scene.eye0.w*0.18,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let tearTrough1=smoothstep(crownEyeW*0.08,crownEyeW*0.0,abs(input.worldPosition.y-tearTrough1Y)/(crownEyeW*0.16+0.001))*smoothstep(scene.eye1.w*0.80,scene.eye1.w*0.18,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let tearTroughFace=smoothstep(0.24,0.52,normal.z)*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-max(tearTrough0,tearTrough1)*tearTroughFace*tearTroughGate*0.20);
  // Lip commissure corner shadow: at the outer corners of the mouth where the upper and lower lip meet, a small pinch of tissue creates a subtle shadow — the mouth corner dimple/shadow; visible on all characters with defined mouths (Arcanine, Mewtwo, Lucario, Agumon, Renamon); gives the mouth its "closed smile" shape read even at neutral expression; a small dark region at the lateral extent of the mouth at mouthBlend level
  let commissureGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.24;
  let commissure0X=input.worldPosition.x-scene.mouth.w*0.96;
  let commissure1X=input.worldPosition.x+scene.mouth.w*0.96;
  let commissure0=smoothstep(scene.mouth.w*0.14,scene.mouth.w*0.04,length(vec2<f32>(commissure0X,input.worldPosition.y-scene.mouth.y)));
  let commissure1=smoothstep(scene.mouth.w*0.14,scene.mouth.w*0.04,length(vec2<f32>(commissure1X,input.worldPosition.y-scene.mouth.y)));
  let commissureFwd=smoothstep(0.30,0.58,normal.z)*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.10,0.26,abs(normal.x));
  lit=lit*(1.0-max(commissure0,commissure1)*commissureFwd*commissureGate*0.18);
  // Medial inner-thigh adductor shadow: the inner face of each thigh faces the other leg, so it receives less direct light and more shadowing — the inter-thigh corridor is always darker; all bipedal creatures with distinct legs (Blaziken, Mewtwo, Lucario, Machamp, Agumon) show darker inner thighs that give the legs their separated, dimensional read; modeled as lateral-inward-facing surface at mid-thigh height between knee and hip
  let adductorShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let adductorY=smoothstep(kneeY+crownEyeW*0.20,kneeY+crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.70,kneeY+crownEyeW*1.60,input.worldPosition.y));
  let adductorLat=smoothstep(crownEyeW*0.64,crownEyeW*0.34,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.34,crownEyeW*0.06,abs(input.worldPosition.x)));
  let adductorFace=smoothstep(0.14,0.44,abs(normal.x))*smoothstep(0.08,-0.14,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-adductorY*adductorLat*adductorFace*adductorShadGate*0.18);
  // Lateral orbital brow arch specular: the outer superior rim of the eye socket (the lateral portion of the supraorbital margin where it angles laterally) is a bony protrusion that catches key light as a faint elongated arc — Gardevoir's brow ridge, Espeon's brow, Mewtwo's forehead bony ridge; this is what gives the face its "strong brow" sculpted read from the 3/4 angle; a soft arc above and outside each eye catching forward-upward light
  let latBrowArchGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let latBrowArch0X=smoothstep(scene.eye0.w*0.40,scene.eye0.w*0.10,abs(input.worldPosition.x-(scene.eye0.x+scene.eye0.w*0.60)));
  let latBrowArch1X=smoothstep(scene.eye1.w*0.40,scene.eye1.w*0.10,abs(input.worldPosition.x-(scene.eye1.x-scene.eye1.w*0.60)));
  let latBrowArch0Y=smoothstep(scene.eye0.w*0.16,scene.eye0.w*0.04,abs(input.worldPosition.y-(scene.eye0.y+scene.eye0.w*1.20)))*eye0pre;
  let latBrowArch1Y=smoothstep(scene.eye1.w*0.16,scene.eye1.w*0.04,abs(input.worldPosition.y-(scene.eye1.y+scene.eye1.w*1.20)))*eye1pre;
  let latBrowArchFace=smoothstep(0.36,0.62,normal.y)*smoothstep(0.10,0.28,abs(normal.x))*smoothstep(0.06,-0.08,abs(normal.z));
  let latBrowArchSpec=pow(max(dot(normal,halfVec),0.0),36.0)*max(latBrowArch0X*latBrowArch0Y,latBrowArch1X*latBrowArch1Y)*latBrowArchFace*latBrowArchGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*latBrowArchSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Thyroid cartilage protrusion (Adam's apple): on larger/older creature archetypes (fv ≥ 0.55) a small forward-pointing cartilage projection on the anterior neck catches a tight specular — present on Mewtwo, Lucario, Machamp, Blaziken neck; the single most powerful "strong throat anatomy" cue in all professional character designs; a tiny oval of brightness at the anterior neck just below the chin, facing forward-and-slightly-upward
  let thyroidGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.55,fv)*0.18;
  let thyroidY=crownEyeY-crownEyeW*0.72;
  let thyroidDist=length(vec2<f32>(input.worldPosition.x,input.worldPosition.y-thyroidY));
  let thyroidZone=smoothstep(crownEyeW*0.12,crownEyeW*0.04,thyroidDist);
  let thyroidFace=smoothstep(0.40,0.70,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.14,0.28,normal.y);
  let thyroidSpec=pow(max(dot(normal,halfVec),0.0),80.0)*thyroidZone*thyroidFace*thyroidGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*thyroidSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior heel calcaneus roundness highlight: the heel bone (calcaneus) is the rounded posterior protrusion of the foot — it catches a bright posterior-up specular when the creature stands; gives the foot its defined "heel lobe" anatomy that separates it from a featureless leg terminus; visible on Blaziken, Mewtwo, Lucario, Charizard from side and back view; a rounded bright zone on the posterior-facing heel surface at ground level
  let heelCalcGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let heelCalcY=smoothstep(crownEyeW*0.42,crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.18,crownEyeW*0.0,input.worldPosition.y));
  let heelCalcLat=smoothstep(crownEyeW*0.72,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.06,crownEyeW*1.40,abs(input.worldPosition.x)));
  let heelCalcBack=smoothstep(-0.14,-0.50,normal.z)*smoothstep(0.28,0.52,normal.y)*smoothstep(0.12,0.04,abs(normal.x));
  let heelCalcSpec=pow(max(dot(normal,halfVec),0.0),44.0)*heelCalcY*heelCalcLat*heelCalcBack*heelCalcGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*heelCalcSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // AO color bleed: ambient occlusion regions (dark concavities) are not uniformly dark — they are tinted by the nearest element palette color due to color interreflection between adjacent surfaces; Charizard crevices have amber-dark not cold-grey, Vaporeon recesses are blue-dark; very subtle, 6% intensity, big perceptual impact on "living color" quality
  let aoColorBleed=smoothstep(0.16,0.0,toon)*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0);
  lit=clamp(lit+scene.palette0.rgb*aoColorBleed*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Back-rim key light wrap: the very rear/top surface of the creature (facing directly away from the key light) still receives a tiny wrap of key-light due to the large source and translucent skin — Eevee's back catches just a glimmer of the warm key on the far side; prevents backs from going completely element-flat and adds dimensional roundness
  let backRimWrap=smoothstep(-0.62,-0.88,dot(normal,lightDir))*(1.0-metallic)*smoothstep(0.04,0.22,toon)*smoothstep(0.42,0.26,toon);
  let backRimColor=mix(vec3<f32>(0.86,0.72,0.48)*warmDom,scene.palette2.rgb*0.60,clamp(1.0-warmDom*1.6,0.0,1.0));
  lit=clamp(lit+backRimColor*backRimWrap*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior trapezius shoulder shadow: the trapezius muscle creates a slope from the neck base out to the shoulder top — the posterior surface of this slope facing downward-back catches less light and darkens; on Mewtwo, Charizard, Incineroar, Lucario the upper back between neck and shoulder is one of the darkest anatomical zones in the back rendering; a shadow zone on the posterior-downward-lateral facing surface at shoulder height
  let trapShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.24;
  let trapShadY=smoothstep(crownEyeY-crownEyeW*1.20,crownEyeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.40,input.worldPosition.y));
  let trapShadLat=smoothstep(crownEyeW*0.40,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.30,abs(input.worldPosition.x)));
  let trapShadBack=smoothstep(-0.10,-0.44,normal.z)*smoothstep(-0.14,-0.38,normal.y)*smoothstep(0.14,0.34,abs(normal.x));
  lit=lit*(1.0-trapShadY*trapShadLat*trapShadBack*trapShadGate*0.20);
  // Ventral forearm flexor SSS warmth: the front (anterior) face of the forearm is dominated by the flexor muscle group which is thinner-skinned and sits closer to blood vessels — it transmits a warmer SSS glow than the dorsal brachioradialis side; Mewtwo and Lucario forearms show this warm-front-arm contrast with cooler dorsal; modeled as a subtle warm SSS blush on the forward-facing forearm surface between elbow and wrist
  let flexorSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.24,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.22;
  let flexorY=smoothstep(wristY+crownEyeW*0.10,elbowY-crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.30,elbowY+crownEyeW*0.10,input.worldPosition.y));
  let flexorLat=smoothstep(crownEyeW*0.76,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-metallic);
  let flexorFace=smoothstep(0.22,0.52,normal.z)*smoothstep(0.10,0.04,abs(normal.x))*smoothstep(0.10,-0.10,normal.y);
  let flexorSSS=max(0.0,-dot(normal,lightDir))*flexorY*flexorLat*flexorFace*flexorSSSGate;
  lit=clamp(lit+vec3<f32>(0.62,0.22,0.14)*flexorSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal interosseous hand specular: between the metacarpal bones on the back of the paw/hand, the dorsal interosseous muscles create tiny convex bumps that catch top light as a secondary specular pattern — fills in the texture between the tendon ridges; adds the micro-topography that distinguishes a highly detailed hand mesh; Lucario, Machamp, Incineroar dorsal paw surfaces show this between-tendon texture; spaced between the tendon ridge positions
  let dorInterGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.18;
  let dorInterY=smoothstep(wristY+crownEyeW*0.04,wristY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.04,wristY-crownEyeW*0.28,input.worldPosition.y));
  let dorInterLat=smoothstep(crownEyeW*0.76,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-metallic);
  let dorInterPhase=fract(abs(input.worldPosition.x)/crownEyeW*3.60+0.50)*3.14159;
  let dorInterBump=pow(max(sin(dorInterPhase),0.0),8.0);
  let dorInterFace=smoothstep(-0.04,-0.26,normal.z)*smoothstep(0.36,0.58,normal.y)*smoothstep(0.08,0.02,abs(normal.x))*specShadowMask*smoothstep(0.44,0.68,toon);
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*dorInterBump*dorInterY*dorInterLat*dorInterFace*dorInterGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Body-part junction micro-shadow: the narrow seam where torso meets limb/head/tail receives concentrated contact-AO — where two SDF blobs merge there is always a slightly concave region that traps less ambient light; models the tighter dark ring at attachment points (Eevee neck ring, Arcanine leg-to-body crease, Charizard shoulder fold)
  let junctionY0=crownEyeY-crownEyeW*0.60;   // neck-to-head
  let junctionY1=crownEyeY-crownEyeW*1.60;   // shoulder-to-torso
  let junctionY2=crownEyeY-crownEyeW*3.20;   // hip-to-thigh
  let juncBand=(smoothstep(abs(input.worldPosition.y-junctionY0)-crownEyeW*0.06,abs(input.worldPosition.y-junctionY0)-crownEyeW*0.16,0.0)+smoothstep(abs(input.worldPosition.y-junctionY1)-crownEyeW*0.08,abs(input.worldPosition.y-junctionY1)-crownEyeW*0.18,0.0)+smoothstep(abs(input.worldPosition.y-junctionY2)-crownEyeW*0.06,abs(input.worldPosition.y-junctionY2)-crownEyeW*0.16,0.0))*clamp(1.0,0.0,1.0);
  let juncAO=clamp(juncBand,0.0,1.0)*smoothstep(0.28,0.06,abs(normal.y))*(1.0-metallic)*0.12;
  lit=lit*(1.0-juncAO);
  // Medial knee inner condyle shadow: the medial side of the knee (inner face) where the tibial condyle meets the femoral condyle is self-shadowed — the medial knee face looks darker than the front and outer side of the knee; gives the knee its full 3D read; on Blaziken, Lucario, Mewtwo the inner medial knee is always significantly darker than the lateral knee face; complements the kneecap forward specular by darkening the inner knee shadow
  let medKneeShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let medKneeShadY=smoothstep(kneeY-crownEyeW*0.18,kneeY,input.worldPosition.y)*(1.0-smoothstep(kneeY,kneeY+crownEyeW*0.22,input.worldPosition.y));
  let medKneeShadLat=smoothstep(crownEyeW*0.64,crownEyeW*0.38,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.38,crownEyeW*0.10,abs(input.worldPosition.x)));
  let medKneeShadFace=smoothstep(0.20,0.48,abs(normal.x))*smoothstep(0.08,-0.16,normal.z)*smoothstep(0.08,0.02,abs(normal.y))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-medKneeShadY*medKneeShadLat*medKneeShadFace*medKneeShadGate*0.20);
  // Olecranon posterior elbow point specular: the tip of the ulna (olecranon process) is the single bony point at the very back of the elbow — it protrudes posteriorly and catches an overhead back specular; on Mewtwo, Lucario, Gallade the elbow tip is a distinct bright spot on the extended arm posterior; gives the arm its "pointy elbow" definition which is crucial for character silhouette from the side; a small oval on the posterior-facing elbow tip at elbowY
  let olecranonGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let olecranonY=smoothstep(elbowY-crownEyeW*0.10,elbowY,input.worldPosition.y)*(1.0-smoothstep(elbowY,elbowY+crownEyeW*0.12,input.worldPosition.y));
  let olecranonLat=smoothstep(crownEyeW*0.86,crownEyeW*1.18,abs(input.worldPosition.x))*(1.0-metallic);
  let olecranonBack=smoothstep(-0.18,-0.56,normal.z)*smoothstep(0.28,0.52,normal.y)*smoothstep(0.12,0.04,abs(normal.x));
  let olecranonSpec=pow(max(dot(normal,halfVec),0.0),60.0)*olecranonY*olecranonLat*olecranonBack*olecranonGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*olecranonSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crown-of-head parietal top highlight: the very top-center of the skull (vertex/parietal boss) is the highest point of the head and catches the overhead key light at maximum intensity — a broad soft bright zone at the skull crown; Mewtwo's round skull top, Eevee's head dome, Espeon's forehead, Pikachu's head top all have a distinct top-head brightness that gives the skull its "round dome" quality; this is the primary cue that the head is a sphere not a flat disk
  let parietalGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.20;
  let parietalY=smoothstep(crownEyeY+crownEyeW*0.60,crownEyeY+crownEyeW*1.20,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*1.20,crownEyeY+crownEyeW*1.80,input.worldPosition.y));
  let parietalX=smoothstep(crownEyeW*0.52,crownEyeW*0.14,abs(input.worldPosition.x));
  let parietalFace=smoothstep(0.62,0.88,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.x));
  let parietalSpec=pow(max(dot(normal,halfVec),0.0),16.0)*parietalY*parietalX*parietalFace*parietalGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*parietalSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice crystal prismatic scatter: Ice-dominant creatures with smooth surfaces scatter faint spectral light from crystalline structure — Glaceon/Articuno/Regice prism scatter; thin rainbowing at oblique view angles distinct from plain specular
  let iceXtalPrismGate=iceXtalGate*smoothstep(0.30,0.54,fresnel)*(1.0-metallic)*smoothstep(0.32,0.52,toon);
  let icePrismPhase=dot(halfVec,normal)*4.20+input.worldPosition.y*scale*1.80+fv*3.14;
  let icePrismColor=vec3<f32>(sin(icePrismPhase)*0.5+0.5,sin(icePrismPhase+2.094)*0.5+0.5,sin(icePrismPhase+4.189)*0.5+0.5);
  lit=clamp(lit+icePrismColor*iceXtalPrismGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element highlight tint: specular peak takes on element hue rather than pure white — Arcanine orange-gold specular, Vaporeon blue-teal specular, Espeon violet specular; Pokemon official renders always tint specular toward element (not just white)
  let elemHighTint=smoothstep(0.74,0.92,rawSpec)*(1.0-metallic)*clamp((palBright-0.30)/0.40,0.0,1.0)*0.18;
  let specHueTint=mix(vec3<f32>(1.0),clamp(scene.palette2.rgb*1.12+vec3<f32>(0.08),vec3<f32>(0.0),vec3<f32>(1.0)),0.44);
  lit=clamp(lit+specHueTint*elemHighTint,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper pectoral forward curved highlight: the pectoralis major creates a curved upper plate at the chest — its superior surface (facing upward-forward) catches key light as a broad shallow specular arc; Machamp, Mewtwo, Incineroar, Blaziken all have a bright upper pec arc that reads from the 3/4 front angle; distinct from the sternal midline highlight; a broad forward-upward-facing surface at upper torso height with slight lateral width
  let upPecHLGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.20;
  let upPecHLY=smoothstep(crownEyeY-crownEyeW*0.76,crownEyeY-crownEyeW*0.50,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.50,crownEyeY-crownEyeW*0.28,input.worldPosition.y));
  let upPecHLX=smoothstep(crownEyeW*0.46,crownEyeW*0.22,abs(input.worldPosition.x));
  let upPecHLFace=smoothstep(0.46,0.70,normal.y)*smoothstep(0.16,0.40,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  let upPecHLSpec=pow(max(dot(normal,halfVec),0.0),20.0)*upPecHLY*upPecHLX*upPecHLFace*upPecHLGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*upPecHLSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior calf Achilles tendon specular: the Achilles tendon at the back of the ankle is a ropelike structure that catches a narrow posterior specular — on Blaziken, Lucario, Mewtwo the back-ankle tendon is a bright narrow highlight running from mid-calf to heel; gives the posterior lower leg its characteristic "tendon-defined" quality; modeled as a narrow posterior-facing ridge at lateral-medial center at the lower calf/upper ankle position
  let achilTendGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let achilTendY=smoothstep(crownEyeW*0.42,crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.22,crownEyeW*0.0,input.worldPosition.y));
  let achilTendLat=smoothstep(crownEyeW*0.64,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.14,abs(input.worldPosition.x)));
  let achilTendMidX=smoothstep(crownEyeW*0.10,crownEyeW*0.02,abs(abs(input.worldPosition.x)-crownEyeW*0.77));
  let achilTendBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.20,0.44,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  let achilTendSpec=pow(max(dot(normal,halfVec),0.0),56.0)*achilTendY*achilTendLat*achilTendMidX*achilTendBack*achilTendGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*achilTendSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inter-finger web shadow: between the digit bases (where toes/fingers meet the palm/foot) a thin web of skin creates concave self-shadowing — the inter-digit web shadows are crucial for making paws/hands look articulated rather than mitten-like; Arcanine, Charizard, Pikachu paw detail, Machamp hand detail all show these dark notches between digit bases; modeled as small dark zones at lateral paw width between tendon ridges, at wrist height
  let webShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.20;
  let webShadY=smoothstep(wristY-crownEyeW*0.30,wristY-crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.22,wristY-crownEyeW*0.14,input.worldPosition.y));
  let webShadLat=smoothstep(crownEyeW*0.66,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.40,abs(input.worldPosition.x)));
  let webShadPhase=fract(abs(input.worldPosition.x)/crownEyeW*2.80)*3.14159;
  let webShadNotch=1.0-pow(max(sin(webShadPhase),0.0),4.0);
  let webShadFace=smoothstep(-0.06,-0.28,normal.z)*smoothstep(0.22,0.44,normal.y)*smoothstep(0.12,0.26,abs(normal.x))*smoothstep(0.12,0.28,toon);
  lit=lit*(1.0-webShadNotch*webShadY*webShadLat*webShadFace*webShadGate*0.18);
  // Foot arch underside shadow: the concave arch between toe-balls and heel is permanently shaded by self-occlusion — in all 3D Pokemon games (including Go, Sword/Shield) the underside arch of the foot is always deeply dark; the arch never receives direct light; modeled as downward-facing interior foot surface at toe-root height
  let footArchY=crownEyeW*0.18;
  let footArchBand=smoothstep(0.0,footArchY,input.worldPosition.y)*(1.0-smoothstep(footArchY,footArchY*2.40,input.worldPosition.y));
  let footArchFace=smoothstep(-0.36,-0.72,normal.y)*(1.0-metallic)*smoothstep(0.06,0.22,toon)*0.20;
  lit=lit*(1.0-footArchBand*footArchFace*0.28);
  // Anterior superior iliac spine pelvic protrusion: the forward-projecting bony landmark at the front crest of the pelvis (the ASIS point) creates a small protrusion at the lateral-anterior hip that catches key light — on Blaziken, Lucario, Mewtwo, Gardevoir the ASIS creates a small bright point at the belt-line on each side; adds the critical hip-forward bony definition that distinguishes a detailed character mesh from an undifferentiated torso blob; a small specular at each lateral hip front crease point at hip height
  let asisLowerGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let asisLowerY=smoothstep(crownEyeY-crownEyeW*1.82,crownEyeY-crownEyeW*1.62,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.62,crownEyeY-crownEyeW*1.46,input.worldPosition.y));
  let asisLowerLat=smoothstep(crownEyeW*0.76,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.36,abs(input.worldPosition.x)));
  let asisLowerFwd=smoothstep(0.30,0.60,normal.z)*smoothstep(0.20,0.40,normal.y)*smoothstep(0.14,0.28,abs(normal.x));
  let asisLowerSpec=pow(max(dot(normal,halfVec),0.0),60.0)*asisLowerY*asisLowerLat*asisLowerFwd*asisLowerGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*asisLowerSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sub-mandibular jaw shadow: the lower jaw creates an overhang of the submandibular region — the underside of the chin/jaw always has a deep AO shadow from the jaw mass above; this is the primary depth cue that separates chin from throat and makes the head read as having a chin projection rather than a flat face termination; present on all creatures with facial definition; a shadow band on the chin underside and throat top at jaw-bottom height
  let subMandGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.28;
  let subMandY=scene.mouth.y-scene.mouth.w*1.90;
  let subMandBand=smoothstep(crownEyeW*0.10,crownEyeW*0.04,abs(input.worldPosition.y-subMandY)/(crownEyeW*0.20+0.001));
  let subMandX=smoothstep(crownEyeW*0.50,crownEyeW*0.14,abs(input.worldPosition.x));
  let subMandFace=smoothstep(-0.16,-0.52,normal.y)*smoothstep(0.12,0.38,normal.z)*smoothstep(0.12,0.04,abs(normal.x));
  lit=lit*(1.0-subMandBand*subMandX*subMandFace*subMandGate*0.22);
  // Forehead mid-brow warm SSS band: the central forehead (the glabella area between the brows) transmits a faint warm SSS from the internal cranial cavity blood supply — this is the warm "forehead flush" visible on all biped character designs especially Gardevoir, Espeon, Sylveon, Jigglypuff; the forehead above the brows has subtly warmer skin SSS than the rest of the face; adds the characteristic warm-to-cool gradient from forehead down to chin
  let foreheadSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.26,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.20;
  let foreheadSSSY=smoothstep(crownEyeY+crownEyeW*0.20,crownEyeY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.60,crownEyeY+crownEyeW*1.10,input.worldPosition.y));
  let foreheadSSSX=smoothstep(crownEyeW*0.50,crownEyeW*0.12,abs(input.worldPosition.x));
  let foreheadSSSFace=smoothstep(0.24,0.54,normal.z)*smoothstep(0.08,-0.12,abs(normal.y))*smoothstep(0.08,0.02,abs(normal.x));
  let foreheadSSS=max(0.0,-dot(normal,lightDir))*foreheadSSSY*foreheadSSSX*foreheadSSSFace*foreheadSSSGate;
  lit=clamp(lit+vec3<f32>(0.68,0.24,0.16)*foreheadSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Chin point forward specular: the most forward-projecting point of the chin (mentum) catches a tight forward specular from the key light — the chin tip is the second-most projected anatomical feature on the face after the nose; on Mewtwo, Lucario, Blaziken, Gardevoir the chin point is a distinct bright small oval at the most frontal chin position; gives chin definition separate from the jaw mass
  let chinPointDist=length(input.worldPosition.xy-vec2<f32>(0.0,scene.mouth.y-scene.mouth.w*1.70));
  let chinPointZone=smoothstep(scene.mouth.w*0.36,scene.mouth.w*0.10,chinPointDist);
  let chinPointFwd=smoothstep(0.38,0.66,normal.z)*smoothstep(0.14,-0.16,abs(normal.x))*smoothstep(0.10,-0.16,normal.y)*(1.0-metallic)*smoothstep(0.50,0.70,toon)*specShadowMask;
  let chinPointSpec=pow(max(dot(normal,halfVec),0.0),60.0)*chinPointZone*chinPointFwd;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*chinPointSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral foot outer edge highlight: the outer edge of the foot/paw (the lateral border from pinky toe to heel) catches a wrap specular from the lateral fill light — all creatures standing on a flat surface show a bright outer foot-edge when viewed from 3/4 front; Pikachu's paw outer edge, Mewtwo's foot outer, Charizard's three-toed foot outer — makes feet look like they're properly grounded on a surface
  let footEdgeY=crownEyeW*0.22;
  let footEdgeBand=smoothstep(footEdgeY-crownEyeW*0.14,footEdgeY,input.worldPosition.y)*(1.0-smoothstep(footEdgeY,footEdgeY+crownEyeW*0.20,input.worldPosition.y));
  let footEdgeLat=smoothstep(crownEyeW*1.04,crownEyeW*1.32,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let footEdgeFace=smoothstep(0.50,0.76,abs(normal.x))*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.14,-0.16,normal.z)*smoothstep(0.40,0.62,toon)*specShadowMask;
  let footEdgeSpec=pow(max(dot(normal,fillHalfVec),0.0),18.0)*footEdgeBand*footEdgeLat*footEdgeFace;
  lit=clamp(lit+vec3<f32>(0.70,0.78,0.94)*footEdgeSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral SCM neck cylinder specular: the sternocleidomastoid is the largest visible neck muscle — its rounded lateral surface at the side-front of the neck catches a lateral key specular as the broadest convex surface; on Mewtwo, Lucario, Arcanine the side of the neck is a distinct convex bright zone that separates it from the face and shoulder; a wide shallow specular on the lateral-forward neck at eye-to-shoulder height with wider spread than the existing SCMband darkening
  let scmLateralGate=organicSkin*(1.0-metallic)*smoothstep(0.40,0.64,toon)*specShadowMask*0.22;
  let scmLateralY=smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*0.26,input.worldPosition.y));
  let scmLateralLat=smoothstep(crownEyeW*0.26,crownEyeW*0.56,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.56,crownEyeW*0.82,abs(input.worldPosition.x)));
  let scmLateralFace=smoothstep(0.38,0.66,abs(normal.x))*smoothstep(0.14,0.32,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  let scmLateralSpec=pow(max(dot(normal,halfVec),0.0),14.0)*scmLateralY*scmLateralLat*scmLateralFace*scmLateralGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*scmLateralSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral rib cage intercostal shadow: the intercostal spaces between rib arcs on the lateral torso create subtle horizontal shadow bands — Machamp, Arcanine, Charizard, Incineroar all show lateral rib shadows on the side of the torso that give the torso its "ribbed" organic quality from the 3/4 angle; modeled as horizontal shadow bands on the lateral-facing torso surface between shoulder and hip height
  let intercostGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*smoothstep(0.44,0.22,roughness)*0.18;
  let intercostY=smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY-crownEyeW*0.96,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.96,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let intercostLat=smoothstep(crownEyeW*0.54,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*1.12,abs(input.worldPosition.x)));
  let intercostWave=sin(input.worldPosition.y*scale*4.40+fv*1.80)*0.5+0.5;
  let intercostBand=smoothstep(0.62,0.74,intercostWave)*(1.0-smoothstep(0.74,0.86,intercostWave));
  let intercostFace=smoothstep(0.44,0.68,abs(normal.x))*smoothstep(0.08,-0.10,abs(normal.z))*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-intercostBand*intercostY*intercostLat*intercostFace*intercostGate*0.16);
  // Scapular spine dorsal highlight: the spine of the scapula is a bony ridge that runs diagonally from the medial border outward-upward to the acromion on the posterior shoulder — it catches overhead-posterior key light as a narrow elongated specular; visible on Mewtwo, Charizard, Lucario posterior shoulder; adds the upper back structural read that Pokemon official art always includes; a diagonal bright line on the posterior-upper shoulder between the neck and arm
  let scapSpineGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.20;
  let scapSpineY=smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let scapSpineLat=smoothstep(crownEyeW*0.50,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.24,abs(input.worldPosition.x)));
  let scapSpineBack=smoothstep(-0.16,-0.56,normal.z)*smoothstep(0.40,0.64,normal.y)*smoothstep(0.18,0.34,abs(normal.x));
  let scapSpineSpec=pow(max(dot(normal,halfVec),0.0),36.0)*scapSpineY*scapSpineLat*scapSpineBack*scapSpineGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*scapSpineSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Mid-limb lateral cylinder wrap light: the widest lateral point of each upper-arm cylinder catches fill light from the side — on round arms (Lucario, Blaziken, Arcanine, Mewtwo) the side of the arm at its maximum width catches a soft lateral key-fill specular; this is what makes cylindrical arms look round rather than flat; computed as lateral-facing surface at upper-arm height
  let midArmWrapGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.58,toon)*0.18;
  let midArmWrapY=crownEyeY-crownEyeW*0.80;
  let midArmWrapBand=smoothstep(midArmWrapY-crownEyeW*0.50,midArmWrapY,input.worldPosition.y)*(1.0-smoothstep(midArmWrapY,midArmWrapY+crownEyeW*0.50,input.worldPosition.y));
  let midArmWrapLat=smoothstep(crownEyeW*1.04,crownEyeW*1.36,abs(input.worldPosition.x))*(1.0-metallic);
  let midArmWrapFace=smoothstep(0.66,0.88,abs(normal.x))*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.12,-0.10,abs(normal.z));
  let midArmWrapSpec=pow(max(dot(normal,halfVec),0.0),12.0)*midArmWrapBand*midArmWrapLat*midArmWrapFace*midArmWrapGate*specShadowMask;
  lit=clamp(lit+mix(vec3<f32>(0.60,0.70,0.88),scene.palette2.rgb*0.60+vec3<f32>(0.40),0.30)*midArmWrapSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sub-orbital cheek volume SSS: the malar fat pad (cheek fullness below the eye) is one of the thickest subcutaneous fat regions on the face — it transmits a warm SSS glow especially at the cheek-to-chin transition under the eye; Arcanine, Charizard, Espeon, Mewtwo all show warm cheek SSS glow below the eye; the lateral cheek just below the eye socket level; distinct from the existing cheekSSS which is more lateral and from behind
  let subOrbCheekGate=organicSkin*(1.0-metallic)*clamp(palBright-0.28,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.24;
  let subOrbCheek0Y=scene.eye0.y-scene.eye0.w*1.20;
  let subOrbCheek1Y=scene.eye1.y-scene.eye1.w*1.20;
  let subOrbCheek0=smoothstep(scene.eye0.w*1.20,scene.eye0.w*0.40,length(vec2<f32>(input.worldPosition.x-scene.eye0.x,input.worldPosition.y-subOrbCheek0Y)))*eye0pre;
  let subOrbCheek1=smoothstep(scene.eye1.w*1.20,scene.eye1.w*0.40,length(vec2<f32>(input.worldPosition.x-scene.eye1.x,input.worldPosition.y-subOrbCheek1Y)))*eye1pre;
  let subOrbCheekFace=smoothstep(0.26,0.54,normal.z)*smoothstep(0.08,-0.16,abs(normal.y))*smoothstep(0.06,0.02,abs(normal.x));
  let subOrbCheekSSS=max(0.0,-dot(normal,lightDir))*max(subOrbCheek0,subOrbCheek1)*subOrbCheekFace*subOrbCheekGate;
  lit=clamp(lit+vec3<f32>(0.70,0.22,0.14)*subOrbCheekSSS*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral ankle double malleolus protrusion: both the medial and lateral malleolus (ankle knobs) protrude at the side of the ankle — two distinct small bony ovals on each side of the ankle at crownEyeW*0.28 height; Blaziken's ankles, Mewtwo, Lucario all show these distinct ankle-bone protrusions that give the ankle its characteristic profile; the lateral malleolus is slightly lower than medial, creating an asymmetric double knob; modeled as two tight specular discs per side
  let malleolBothGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let malleolYLow=crownEyeW*0.28;
  let malleolYHigh=crownEyeW*0.38;
  let malleolDotLow=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-malleolYLow))*smoothstep(crownEyeW*0.82,crownEyeW*1.14,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.14,crownEyeW*1.36,abs(input.worldPosition.x)));
  let malleolDotHigh=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-malleolYHigh))*smoothstep(crownEyeW*0.66,crownEyeW*0.96,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.96,crownEyeW*1.18,abs(input.worldPosition.x)));
  let malleolDoubleFwd=smoothstep(0.44,0.70,abs(normal.x))*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.14,-0.08,abs(normal.z));
  let malleolDoubleSpec=pow(max(dot(normal,halfVec),0.0),72.0)*max(malleolDotLow,malleolDotHigh)*malleolDoubleFwd*malleolBothGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*malleolDoubleSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal foot metatarsal ridge specular: the five metatarsal bones on the top of the foot create a fan of ridges visible through the skin — analogous to the hand dorsal tendons but shorter and rounder; Charizard, Blaziken, Arcanine, Mewtwo dorsal foot surface shows this metatarsal top-lighting; adds the distinct anatomical topography of a foot versus a smooth featureless toe-stub; top-lit, on the dorsal (upward-facing) foot surface at toe-base height
  let metaFtGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.18;
  let metaFtY=smoothstep(crownEyeW*0.40,crownEyeW*0.24,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.24,crownEyeW*0.08,input.worldPosition.y));
  let metaFtLat=smoothstep(crownEyeW*0.58,crownEyeW*1.0,abs(input.worldPosition.x))*(1.0-metallic);
  let metaFtPhase=fract(abs(input.worldPosition.x)/crownEyeW*3.20)*3.14159;
  let metaFtRidge=pow(max(sin(metaFtPhase),0.0),10.0);
  let metaFtFace=smoothstep(0.50,0.76,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.12,0.04,abs(normal.x))*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*metaFtRidge*metaFtY*metaFtLat*metaFtFace*metaFtGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Footpad ground contact: downward-facing surfaces at the lowest point of the body receive darker AO from terrain contact — feet/paws read as bearing the creature's weight (Arcanine/Pikachu/Charizard foot-to-ground contact shadow quality)
  let footpadGate=smoothstep(-0.40,-0.72,normal.y)*smoothstep(0.18,0.04,input.worldPosition.y)*(1.0-metallic)*0.18;
  lit=lit*(1.0-footpadGate*0.30);
  // Element color contamination in lit zone: the maximum-lit surface picks up a very faint element hue rather than washing to pure white — Pikachu's brightest yellow stays yellow, Vaporeon bright spot stays cyan-tinged; official Pokemon art never goes pure white on the specular, always keeps element color
  let litZoneElemTint=smoothstep(0.76,0.94,toon)*(1.0-metallic)*clamp((palBright-0.26)/0.44,0.0,1.0)*0.08;
  lit=clamp(lit+scene.palette2.rgb*litZoneElemTint*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Large-scale hand-painted color variation: low-frequency spatial color variation across the creature body — official Pokemon art looks hand-painted because of subtle regional hue/value variation; the chest reads slightly warmer than the sides, the spine slightly cooler than flanks; this is the "vertex color bake" quality seen in high-end game characters
  let paintVar=fract(sin(dot(floor(input.worldPosition*scale*0.60),vec3<f32>(127.1,311.7,74.7)))*43758.545)*2.0-1.0;
  let paintVarStr=(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*0.06;
  let paintVarLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(vec3<f32>(paintVarLuma),lit,1.0+paintVar*paintVarStr),vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper arm posterior tricep shadow: the posterior (back-facing) surface of the upper arm is shadowed when the arm hangs at rest — the tricep muscle mass creates a flat posterior surface that faces away from the standard key light; Mewtwo, Lucario, Machamp all show the back of the upper arm as significantly darker than the front/side bicep face; creates the arm's "in-the-round" 3D read from all angles; a shadow on the posterior-facing upper arm surface between shoulder and elbow
  let tricepShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let tricepShadY=smoothstep(elbowY+crownEyeW*0.16,elbowY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.60,elbowY+crownEyeW*1.30,input.worldPosition.y));
  let tricepShadLat=smoothstep(crownEyeW*0.82,crownEyeW*1.18,abs(input.worldPosition.x))*(1.0-metallic);
  let tricepShadBack=smoothstep(-0.12,-0.54,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.14,0.30,abs(normal.x));
  lit=lit*(1.0-tricepShadY*tricepShadLat*tricepShadBack*tricepShadGate*0.20);
  // Lateral hip greater trochanter protrusion: the greater trochanter is the bony prominence at the very outside of the hip — the widest lateral point of the entire body at hip level; Mewtwo, Blaziken, Lucario, Machamp all show a distinct lateral hip protrusion that catches a tight lateral-up specular from the side fill; gives the hips their "wide" quality and separates them from the leg below; a small protrusion specular at the maximum lateral extent at hip height
  let trochGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let trochY=smoothstep(crownEyeY-crownEyeW*1.90,crownEyeY-crownEyeW*1.62,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.62,crownEyeY-crownEyeW*1.36,input.worldPosition.y));
  let trochLat=smoothstep(crownEyeW*0.96,crownEyeW*1.30,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.30,crownEyeW*1.60,abs(input.worldPosition.x)));
  let trochFace=smoothstep(0.56,0.82,abs(normal.x))*smoothstep(0.14,0.36,normal.y)*smoothstep(0.10,0.04,abs(normal.z));
  let trochSpec=pow(max(dot(normal,halfVec),0.0),32.0)*trochY*trochLat*trochFace*trochGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*trochSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sclera white-of-eye brightening: the sclera (white of the eye) is whiter and more forward-bright than the surrounding face skin — this is the primary cue that the eye is a separate material from skin; in all Pokemon (Pikachu, Eevee, Mewtwo, Gengar) the white around the iris is significantly brighter than face skin; without scleral brightening the eye looks flush with the face; a brightening in the ring between the iris and the eye outline on forward-facing eye surface
  let scleraGate=(1.0-metallic)*smoothstep(0.44,0.68,toon)*0.28;
  let sclera0=smoothstep(scene.eye0.w*0.46,scene.eye0.w*0.72,length(input.worldPosition.xy-scene.eye0.xy)*(1.0+eye0pre*0.0))*(1.0-smoothstep(scene.eye0.w*0.72,scene.eye0.w*0.96,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let sclera1=smoothstep(scene.eye1.w*0.46,scene.eye1.w*0.72,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.72,scene.eye1.w*0.96,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let scleraBright=max(sclera0,sclera1)*scleraGate*smoothstep(0.22,0.54,normal.z)*smoothstep(0.10,0.04,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.96,0.96,0.98)*scleraBright*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Crystal refraction color dispersion: Ice/crystal surfaces refract light into wavelength-separated prismatic patches — not just rainbow iridescence but actual separated color bands visible in the body like looking through a prism (Regice/Froslass/Suicune crystal crown dispersion quality)
  let dispGate=iceXtalGate*smoothstep(0.32,0.08,roughness)*(1.0-metallic)*smoothstep(0.20,0.44,fresnel);
  let dispOff=vec3<f32>(input.worldPosition.x*scale*3.60+fv*2.1,input.worldPosition.y*scale*3.60+fv*1.8,input.worldPosition.z*scale*3.60+fv*2.6);
  let dispR=fract(sin(dot(floor(dispOff+vec3<f32>(0.5,0.0,0.0)),vec3<f32>(127.1,311.7,74.7)))*43758.545);
  let dispB=fract(sin(dot(floor(dispOff-vec3<f32>(0.5,0.0,0.0)),vec3<f32>(311.7,74.7,127.1)))*43758.545);
  let dispColor=vec3<f32>(step(0.88,dispR)*0.40,0.0,step(0.88,dispB)*0.40);
  lit=clamp(lit+dispColor*dispGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly sag shadow: the bottom of the belly sphere sags slightly and its lower face catches less fill light — round creatures look heavier due to the underside shadow ring (Snorlax/Blastoise/Charmander belly shadow ring from body weight)
  let bellyBotSag=smoothstep(0.62,0.80,belly)*smoothstep(-0.50,-0.72,normal.y)*(1.0-metallic)*0.16;
  lit=lit*(1.0-bellyBotSag*0.24);
  // Iris limbal ring darkening: the limbus — the border between the iris and the sclera — is always darker and more saturated than the mid-iris; in all Pokemon with large eyes (Eevee, Pikachu, Espeon, Jigglypuff) the outer edge of the colored iris is noticeably darker, creating a ring that makes the iris "pop" forward and catches ambient light as a dark frame; this is the single most powerful eye depth cue in illustrated characters; modeled as a darkening ring at the iris outer boundary
  let limbalOuterGate=(1.0-metallic)*smoothstep(0.44,0.68,toon)*0.30;
  let limbalOuter0=smoothstep(scene.eye0.w*0.40,scene.eye0.w*0.44,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.44,scene.eye0.w*0.52,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let limbalOuter1=smoothstep(scene.eye1.w*0.40,scene.eye1.w*0.44,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.44,scene.eye1.w*0.52,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let limbalOuterFwd=smoothstep(0.20,0.50,normal.z)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-max(limbalOuter0,limbalOuter1)*limbalOuterFwd*limbalOuterGate*0.36);
  // Nostril shadow pit: nostrils (when present, fv ≥ 0.42) are tiny dark oval recesses at the base of the nose — the two nostril openings face downward-forward and are always strongly shaded because they are deep concave pits; Arcanine, Charizard, Growlithe, Pikachu, Mewtwo all have clearly defined dark nostril pits that read as holes even at small scale; the single clearest anatomical face cue below the eye level; two small ovals at the lateral base of the nose facing down-forward
  let nostrilGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.42,fv)*0.32;
  let nostrilMidY=scene.mouth.y+scene.mouth.w*0.68;
  let nostril0=smoothstep(scene.mouth.w*0.12,scene.mouth.w*0.04,length(vec2<f32>(input.worldPosition.x-scene.mouth.w*0.20,input.worldPosition.y-nostrilMidY)));
  let nostril1=smoothstep(scene.mouth.w*0.12,scene.mouth.w*0.04,length(vec2<f32>(input.worldPosition.x+scene.mouth.w*0.20,input.worldPosition.y-nostrilMidY)));
  let nostrilFwd=smoothstep(0.22,0.50,normal.z)*smoothstep(0.0,-0.28,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-max(nostril0,nostril1)*nostrilFwd*nostrilGate*0.34);
  // Mid-torso linea alba vertical groove: the linea alba is the vertical midline depression on the anterior abdomen between the left and right rectus abdominis muscles — a narrow central shadow groove running from sternum to pelvis; Machamp, Incineroar, Blaziken, Conkeldurr all show this midline groove that defines a muscular torso; gives the abdomen its characteristic "two-column" abdominal read; a narrow central shadow on forward-facing mid-torso surface; gated on fv ≥ 0.50 for more developed body archetypes
  let lineaAlbaGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.50,fv)*0.26;
  let lineaAlbaX=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.x));
  let lineaAlbaY=smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY-crownEyeW*0.84,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.84,crownEyeY-crownEyeW*0.46,input.worldPosition.y));
  let lineaAlbaFwd=smoothstep(0.30,0.60,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.08,-0.10,abs(normal.y));
  lit=lit*(1.0-lineaAlbaX*lineaAlbaY*lineaAlbaFwd*lineaAlbaGate*0.20);
  // Shadow color shift: the deepest shadow region takes on a very faint complementary hue rather than pure near-black — warm-element creatures have cool blue-violet shadows (Pikachu yellow-to-violet shadow), cool-element creatures have warm amber shadows; hallmark of professional illustration color theory used in all official Pokemon art
  let deepShadowGate=smoothstep(0.12,0.0,toon)*(1.0-metallic)*clamp(palBright-0.20,0.0,1.0);
  let shadowComplementTint=mix(vec3<f32>(0.08,0.06,0.22),vec3<f32>(0.22,0.10,0.04),warmDom);
  lit=clamp(lit+shadowComplementTint*deepShadowGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element hue rotation in shadow zone: the shadow region (toon < 0.22) shifts hue toward a slightly different angle than the lit zone — in the official Pokemon-style shader, shadows are not just darker versions of the lit color but slightly shift in hue (warm creature: shadow shifts red-to-purple, cool creature: shadow shifts blue-to-green-teal); this is the "shadow hue bias" found in Genshin's cel pass and Pokemon Sword/Shield's toon material
  let shadowHueBias=smoothstep(0.22,0.06,toon)*(1.0-metallic)*0.12;
  let shadowHueShift=mix(vec3<f32>(0.0,-0.04,0.06),vec3<f32>(0.04,0.0,-0.06),warmDom);
  lit=clamp(lit+shadowHueShift*shadowHueBias*clamp(palBright-0.22,0.0,1.0),vec3<f32>(0.0),vec3<f32>(1.0));
  // Orbital socket depth AO: the eye socket is a concave bony recess — the ring just outside the eye catches less ambient light than the cheek or forehead due to the socket depth; a subtle AO darkening ring centered on each eye at slightly larger than eyeRadius defines the socket depth; Gardevoir, Espeon, Mewtwo all have visible socket AO that gives the face its "deep set eyes" quality; this is the primary depth cue distinguishing eyes-set-into-skull from eyes-on-flat-face
  let orbitSocketGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.26;
  let orbitSocket0=smoothstep(scene.eye0.w*0.80,scene.eye0.w*1.60,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*1.60,scene.eye0.w*2.20,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let orbitSocket1=smoothstep(scene.eye1.w*0.80,scene.eye1.w*1.60,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*1.60,scene.eye1.w*2.20,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let orbitSocketFwd=smoothstep(0.20,0.54,normal.z)*smoothstep(0.10,0.24,abs(normal.x));
  lit=lit*(1.0-max(orbitSocket0,orbitSocket1)*orbitSocketFwd*orbitSocketGate*0.18);
  // Posterior knee popliteal fossa shadow: the popliteal fossa is the diamond-shaped concavity behind the knee joint — always deeply shadowed when the leg is extended; in all bipedal creatures the back-of-knee is the darkest surface area on the lower limb; Blaziken, Mewtwo, Lucario all show this posterior-knee dark zone; gives the leg its correct joint-articulated read from the back; a shadow on the posterior-facing knee surface between the hamstring and calf muscle bellies
  let poplitealGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.28;
  let poplitealY=smoothstep(kneeY-crownEyeW*0.14,kneeY,input.worldPosition.y)*(1.0-smoothstep(kneeY,kneeY+crownEyeW*0.18,input.worldPosition.y));
  let poplitealLat=smoothstep(crownEyeW*0.64,crownEyeW*0.94,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.94,crownEyeW*1.24,abs(input.worldPosition.x)));
  let poplitealBack=smoothstep(-0.12,-0.56,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.14,0.30,abs(normal.x));
  lit=lit*(1.0-poplitealY*poplitealLat*poplitealBack*poplitealGate*0.24);
  // Brow shadow on upper eye: the supraorbital brow ridge overhangs the eye socket — it casts a shadow on the upper iris and sclera, making the top of the eye socket darker; this is the primary cue that the brow projects forward of the eye; Mewtwo, Gardevoir, Lucario, Aggron brow overhangs create a clear top-eye shadow; a shadow on the upper portion of each eye (the region where iris meets upper lid) from the brow mass above; strengthens brow prominence
  let browOverhangGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*0.26;
  let browOverhang0=smoothstep(scene.eye0.w*0.28,scene.eye0.w*0.02,abs(input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.40)))*(1.0-smoothstep(scene.eye0.w*0.40,scene.eye0.w*0.72,abs(input.worldPosition.x-scene.eye0.x)))*eye0pre;
  let browOverhang1=smoothstep(scene.eye1.w*0.28,scene.eye1.w*0.02,abs(input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.40)))*(1.0-smoothstep(scene.eye1.w*0.40,scene.eye1.w*0.72,abs(input.worldPosition.x-scene.eye1.x)))*eye1pre;
  let browOverhangFwd=smoothstep(0.22,0.54,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.10,-0.04,normal.y);
  lit=lit*(1.0-max(browOverhang0,browOverhang1)*browOverhangFwd*browOverhangGate*0.22);
  // Pearlescent/nacre shell material: Water-Ice creatures with very low roughness and rounded shell-like geometry show nacre/pearl material — smooth mother-of-pearl bicolor shimmer at all angles; Lapras shell, Slowbro tail, Cloyster shell, Shellder, Vaporeon smooth body; distinct from plain specular because it shifts from one hue to another rather than white
  let nacreGate=blueSheen*smoothstep(0.08,0.28,roughness)*smoothstep(0.40,0.22,roughness)*(1.0-metallic)*smoothstep(0.24,0.50,toon);
  let nacrePhaseFwd=dot(normal,vec3<f32>(0.0,0.0,1.0))*3.14+fv*1.57;
  let nacreColor=mix(vec3<f32>(0.94,0.90,1.0),vec3<f32>(0.70,0.96,0.96),sin(nacrePhaseFwd)*0.5+0.5);
  lit=clamp(lit+nacreColor*nacreGate*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire-source temperature gradient: Fire-dominant creatures are hotter near their fire source (tail tip/hands/head) and cooler toward body center — the gradient from amber-hot to neutral-warm gives Fire types their characteristic "heat radiating outward" color quality (Charizard's tail tip is bright orange-white, body is dark orange, underbelly is pale cream); simulated by warming extremities
  let fireTempGrad=warmDom*(1.0-metallic)*smoothstep(1.10,1.60,abs(input.worldPosition.x))*smoothstep(0.28,0.52,toon)*0.12;
  lit=clamp(lit+vec3<f32>(0.96,0.62,0.08)*fireTempGrad,vec3<f32>(0.0),vec3<f32>(1.0));
  // Floating/Ghost creature translucency simulation: Shadow and Dark types at low brightness show faint light-through-body quality at the silhouette rim — Haunter/Gastly/Mismagius body dissolves at edges revealing colors beyond; simulates creature being semi-opaque (not fully solid); the edge brightens toward transparency
  let ghostTrans=step(palBright,0.35)*clamp(metallic*(-1.0)+1.0,0.0,1.0)*smoothstep(0.70,0.84,fresnel)*(1.0-outlineEdge);
  lit=clamp(lit+scene.palette2.rgb*1.10*ghostTrans*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tail tip warm-glow SSS: the tail tip is the thinnest organic tissue on the creature, so light scatters through it — Pikachu, Eevee, Sylveon, Ninetales, Vulpix tail tip SSS glow; when the tail tip is sufficiently far from the body and faces light, it glows with a warm element-colored translucency; present on organic/fur creatures with visible tail tip only
  if (scene.tailTip.w > 0.0) {
    let tailTipSSSDist=smoothstep(scene.tailTip.w*3.0,scene.tailTip.w*0.0,tipDist);
    let tailTipSSSBack=smoothstep(-0.10,-0.50,dot(normal,lightDir))*(1.0-metallic)*organicSkin*smoothstep(0.04,0.18,toon);
    let tailTipSSSColor=mix(vec3<f32>(0.60,0.22,0.08),scene.palette2.rgb*0.80+vec3<f32>(0.20),clamp(palBright-0.30,0.0,1.0));
    lit=clamp(lit+tailTipSSSColor*tailTipSSSDist*tailTipSSSBack*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  }
  // Pupil catch-light micro-specular: inside the pupil (the darkest region of each eye) a tiny bright catch-light disc simulates the key light reflection in the liquid anterior surface of the eye — the classic "sparkle in the eye" that distinguishes living eyes from lifeless ones; all Pokemon Gen 3+ art has this micro-catch-light; a very small tight bright dot offset from center toward the key light direction in each pupil zone
  let pupilCLGate=(1.0-metallic)*smoothstep(0.62,0.88,toon)*0.26;
  let pupilCL0Off=vec2<f32>(scene.eye0.x+scene.eye0.w*0.14,scene.eye0.y+scene.eye0.w*0.18);
  let pupilCL1Off=vec2<f32>(scene.eye1.x+scene.eye1.w*0.14,scene.eye1.y+scene.eye1.w*0.18);
  let pupilCL0=smoothstep(scene.eye0.w*0.08,scene.eye0.w*0.02,length(input.worldPosition.xy-pupilCL0Off))*eye0pre;
  let pupilCL1=smoothstep(scene.eye1.w*0.08,scene.eye1.w*0.02,length(input.worldPosition.xy-pupilCL1Off))*eye1pre;
  let pupilCLFwd=smoothstep(0.26,0.56,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.98,0.98,1.0)*max(pupilCL0,pupilCL1)*pupilCLFwd*pupilCLGate*0.60,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal spine fin SSS glow: on creatures with spines/fins on the back (fv-varied), the thin membrane between spine tips transmits backlight as a warm-to-cool SSS glow — Vaporeon dorsal fin, Serperior crest, Charizard back ridge; the inter-spine webbing is thinner than the body so light passes through more readily; when the creature is backlit the fin glows with element color; spines are at scale lateral extent
  let spineSSSGate=spineX*(1.0-metallic)*smoothstep(0.04,0.18,toon)*clamp(palBright-0.18,0.0,1.0)*0.24;
  let spineSSSBack=max(0.0,-dot(normal,lightDir));
  let spineSSSTop=smoothstep(earTopY-crownEyeW*0.50,earTopY+crownEyeW*0.80,input.worldPosition.y);
  let spineSSSLat=smoothstep(crownEyeW*0.36,crownEyeW*0.86,abs(input.worldPosition.x));
  let spineSSSFin=smoothstep(0.18,0.44,abs(normal.x))*smoothstep(0.14,0.06,abs(normal.y));
  let spineSSS=spineSSSBack*spineSSSTop*spineSSSLat*spineSSSFin*spineSSSGate;
  let spineSSSColor=mix(vec3<f32>(0.38,0.54,0.92),scene.palette2.rgb*0.68+vec3<f32>(0.12,0.14,0.16),clamp(palBright-0.22,0.0,1.0));
  lit=clamp(lit+spineSSSColor*spineSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral torso arm-cast shadow: the arm hangs at the side and its mass creates a soft penumbra shadow on the lateral torso just behind and below the armpit — a darker zone on the lateral outer torso below the armpit/shoulder; all bipedal characters (Mewtwo, Lucario, Blaziken) show this arm-body occlusion shadow on the outer ribcage; adds the depth cue that the arm is a separate volume from the torso; posterior-lateral facing at upper torso height
  let armCastTorsoGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let armCastY=smoothstep(crownEyeY-crownEyeW*1.36,crownEyeY-crownEyeW*0.86,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.86,crownEyeY-crownEyeW*0.44,input.worldPosition.y));
  let armCastLat=smoothstep(crownEyeW*0.70,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.04,crownEyeW*1.32,abs(input.worldPosition.x)));
  let armCastBack=smoothstep(-0.08,-0.40,normal.z)*smoothstep(0.12,0.38,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-armCastY*armCastLat*armCastBack*armCastTorsoGate*0.16);
  // Crown-to-waist element gradient: vertical element color warming/cooling from head to hips — Charizard head is more orange than lower body, Vaporeon head is more teal, Pikachu top is yellow; creates organic life-gradient (blood/heat concentrates toward core and head)
  let bodyGradH=clamp((input.worldPosition.y-(crownEyeY-crownEyeW*4.0))/(crownEyeW*4.0),0.0,1.0);
  let bodyGradTint=scene.palette2.rgb*bodyGradH*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*0.07;
  lit=clamp(lit+bodyGradTint,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neck forward-face highlight: the front of the neck (facing forward at eye level) catches a distinctive specular from the key light — creates neck-to-face 3D depth and distinguishes head from torso (Pikachu/Eevee/Charizard neck light quality)
  let neckFwdY=crownEyeY-crownEyeW*1.0;
  let neckFwdZone=smoothstep(neckFwdY-crownEyeW*0.80,neckFwdY-crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(neckFwdY-crownEyeW*0.20,neckFwdY+crownEyeW*0.50,input.worldPosition.y));
  let neckFwdFace=smoothstep(0.30,0.58,normal.z)*smoothstep(0.20,0.04,abs(normal.x))*(1.0-metallic)*0.10;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*neckFwdZone*neckFwdFace,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper eyelid crease shadow: the fold of skin at the upper eyelid crease (the supratarsal fold / double eyelid crease) creates a shadow just above the lid border — this narrow shadow above the eyelid is the primary depth cue that the eyelid is raised and overhangs the eye; Mewtwo, Gardevoir, Espeon, Sylveon all have this lid crease shadow that gives the eye its "hooded lid" quality; a shadow band just inside the upper lid rim at the crease fold height
  let lidCreaseGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*0.26;
  let lidFoldY0=scene.eye0.y+scene.eye0.w*0.54;
  let lidFoldY1=scene.eye1.y+scene.eye1.w*0.54;
  let lidFold0=smoothstep(crownEyeW*0.06,crownEyeW*0.0,abs(input.worldPosition.y-lidFoldY0)/(crownEyeW*0.10+0.001))*smoothstep(scene.eye0.w*0.68,scene.eye0.w*0.18,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let lidFold1=smoothstep(crownEyeW*0.06,crownEyeW*0.0,abs(input.worldPosition.y-lidFoldY1)/(crownEyeW*0.10+0.001))*smoothstep(scene.eye1.w*0.68,scene.eye1.w*0.18,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let lidCreaseFwd=smoothstep(0.24,0.54,normal.z)*smoothstep(0.08,-0.08,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-max(lidFold0,lidFold1)*lidCreaseFwd*lidCreaseGate*0.24);
  // Heel skin fold posterior SSS: the posterior heel skin is relatively thin and overlies the Achilles tendon bursa — it glows with a faint warm SSS from the lateral light; gives the heel its "thin skin over bone" quality visible on Blaziken, Mewtwo, Lucario close-up heel; distinct from the Achilles tendon specular (bone-like) this is the skin warmth quality; posterior-facing at heel height
  let heelFoldGate=organicSkin*(1.0-metallic)*clamp(palBright-0.24,0.0,1.0)*smoothstep(0.10,0.26,toon)*0.20;
  let heelFoldY=smoothstep(crownEyeW*0.38,crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.18,crownEyeW*0.04,input.worldPosition.y));
  let heelFoldLat=smoothstep(crownEyeW*0.60,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-metallic);
  let heelFoldBack=smoothstep(-0.16,-0.60,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*smoothstep(0.10,0.24,abs(normal.x));
  let heelFoldSSS=max(0.0,-dot(normal,lightDir))*heelFoldY*heelFoldLat*heelFoldBack*heelFoldGate;
  lit=clamp(lit+vec3<f32>(0.64,0.22,0.14)*heelFoldSSS*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior sternal notch shadow: the suprasternal notch (jugular notch) is the small U-shaped depression at the top center of the sternum between the two clavicle heads — it creates a shadow at the very center of the upper chest; Mewtwo, Lucario, Blaziken all show this small central dark notch that is the meeting point of both clavicles; adds the midline chest-top anatomical definition; a small central shadow at the sternum top between the two sternocleidomastoid attachment points
  let sternalNotchGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.24;
  let sternalNotchY=crownEyeY-crownEyeW*0.52;
  let sternalNotchDist=length(vec2<f32>(input.worldPosition.x,input.worldPosition.y-sternalNotchY));
  let sternalNotchZone=smoothstep(crownEyeW*0.10,crownEyeW*0.04,sternalNotchDist);
  let sternalNotchFwd=smoothstep(0.26,0.56,normal.z)*smoothstep(0.10,0.04,abs(normal.x))*smoothstep(0.12,0.28,normal.y);
  lit=lit*(1.0-sternalNotchZone*sternalNotchFwd*sternalNotchGate*0.26);
  // Chin cleft dimple: a small central shadow at the chin creates a chin cleft / dimple — gives face character and dimension on 28% of creatures (fv ≥ 0.72); a tiny vertical dark crease at chin center, slightly below the mouth; present on Machamp, Mewtwo, Conkeldurr-style bipeds
  let chinCleftY=scene.mouth.y-scene.mouth.w*1.50;
  let chinCleftZone=clamp(1.0-abs(input.worldPosition.y-chinCleftY)/(scene.mouth.w*0.14+0.001),0.0,1.0);
  let chinCleftX=clamp(1.0-abs(input.worldPosition.x)/(scene.mouth.w*0.12+0.001),0.0,1.0);
  let chinCleftFwd=smoothstep(0.30,0.58,normal.z)*smoothstep(0.16,0.04,abs(normal.x))*(1.0-metallic);
  lit=lit*(1.0-chinCleftZone*chinCleftX*chinCleftFwd*step(0.72,fv)*0.18);
  // Nape of neck shadow: the posterior neck (between skull base and upper dorsal spine) receives a deeper shadow — the skull overhangs the nape in side view; all bipedal Pokemon and Digimon show a distinct dark nape zone (Mewtwo/Lucario/Charizard posterior neck shadow quality); separate from the forward neck-face highlight zone
  let napeY=crownEyeY-crownEyeW*0.80;
  let napeZone=smoothstep(napeY-crownEyeW*0.60,napeY,input.worldPosition.y)*(1.0-smoothstep(napeY,napeY+crownEyeW*0.38,input.worldPosition.y));
  let napeBack=smoothstep(-0.10,-0.52,normal.z)*smoothstep(0.22,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.12,0.36,toon);
  lit=lit*(1.0-napeZone*napeBack*0.20);
  // Upper lip philtrum column catch-light: the two vertical ridges of the philtrum (the column-like raised strips flanking the central philtrum groove) catch forward key light as two narrow parallel bright strips — the philtrum columns are slightly convex and face forward-upward; on Arcanine, Mewtwo, Eevee, Growlithe the philtrum columns are bright while the central groove is darker; gives the upper lip its "cupid's bow" 3D definition; two narrow forward-facing strips flanking the central philtrum shadow
  let philColGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.20;
  let philCol0X=smoothstep(scene.mouth.w*0.18,scene.mouth.w*0.06,abs(input.worldPosition.x-scene.mouth.w*0.08));
  let philCol1X=smoothstep(scene.mouth.w*0.18,scene.mouth.w*0.06,abs(input.worldPosition.x+scene.mouth.w*0.08));
  let philColY=smoothstep(scene.mouth.y+scene.mouth.w*0.64,scene.mouth.y+scene.mouth.w*0.90,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.90,scene.mouth.y+scene.mouth.w*1.16,input.worldPosition.y));
  let philColFace=smoothstep(0.38,0.66,normal.z)*smoothstep(0.10,-0.08,abs(normal.x))*smoothstep(0.10,0.22,normal.y);
  let philColSpec=pow(max(dot(normal,halfVec),0.0),44.0)*max(philCol0X,philCol1X)*philColY*philColFace*philColGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*philColSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral rib intercostal AO band: a subtle horizontal shadow line between each rib pair on the lateral torso from AO at the rib edge — distinct from the earlier intercostal wave shadow; this is the specific AO darkening exactly at the rib-to-intercostal transition rather than between ribs; Arcanine, Machamp, Incineroar all show these sharp dark rib edge lines on the side torso that give a "ribbed" textural quality
  let ribEdgeGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*smoothstep(0.50,0.30,roughness)*step(fv,0.58)*0.18;
  let ribEdgeY=smoothstep(crownEyeY-crownEyeW*1.70,crownEyeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let ribEdgeLat2=smoothstep(crownEyeW*0.60,crownEyeW*1.0,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.0,crownEyeW*1.30,abs(input.worldPosition.x)));
  let ribEdgeWave=abs(sin(input.worldPosition.y*scale*4.80+fv*1.60));
  let ribEdgeLine=smoothstep(0.84,0.92,ribEdgeWave);
  let ribEdgeFace=smoothstep(0.50,0.74,abs(normal.x))*smoothstep(0.10,-0.08,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.y));
  lit=lit*(1.0-ribEdgeLine*ribEdgeY*ribEdgeLat2*ribEdgeFace*ribEdgeGate*0.14);
  // Glabella anterior forehead specular: the glabella (the flat bony surface between the brows above the nose bridge) is a forward-facing flat surface that catches a small centered specular from the key light — gives the face its midline upper-nose-to-brow structural read; Mewtwo, Gardevoir, Lucario, Gallade all show this central brow-to-nasal-root bright zone; an oval at center-forehead just above where the nose meets the brow
  let glabellaGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let glabellaY=smoothstep(crownEyeY+crownEyeW*0.08,crownEyeY+crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.52,input.worldPosition.y));
  let glabellaX=smoothstep(crownEyeW*0.24,crownEyeW*0.06,abs(input.worldPosition.x));
  let glabellaFace=smoothstep(0.36,0.64,normal.z)*smoothstep(0.08,-0.04,abs(normal.x))*smoothstep(0.10,-0.06,abs(normal.y));
  let glabellaSpec=pow(max(dot(normal,halfVec),0.0),28.0)*glabellaY*glabellaX*glabellaFace*glabellaGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*glabellaSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neck side lateral shadow: the left and right sides of the neck cylinder are always in shadow from the lateral perspective — the sternocleidomastoid shadow zone; when viewed from front the neck sides are dark; Mewtwo's neck, Arcanine's neck, Dragonite's neck show this lateral-dark quality that separates head from torso; a dark zone on the outer lateral surface of the neck at Y=crownEyeY−0.30 to −0.80
  let neckSideY=crownEyeY-crownEyeW*0.55;
  let neckSideBand=smoothstep(neckSideY-crownEyeW*0.50,neckSideY,input.worldPosition.y)*(1.0-smoothstep(neckSideY,neckSideY+crownEyeW*0.28,input.worldPosition.y));
  let neckSideLat=smoothstep(crownEyeW*0.22,crownEyeW*0.48,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.48,crownEyeW*0.72,abs(input.worldPosition.x)))*(1.0-metallic)*smoothstep(0.08,0.24,toon);
  let neckSideFace=smoothstep(0.14,0.44,abs(normal.x))*smoothstep(0.08,-0.12,normal.z);
  lit=lit*(1.0-neckSideBand*neckSideLat*neckSideFace*0.20);
  // Inner wrist fold shadow: where the wrist bends, the inside (medial anterior) surface creates a concavity that self-shadows — the fold of skin at the wrist crease is always darker than the top of the wrist; Mewtwo's wrist, Lucario's wrist, Gallade's armlet all show this medial-forward concavity dark
  let wristInnerY=crownEyeW*1.72;
  let wristInnerBand=smoothstep(0.10,0.0,abs(input.worldPosition.y-wristInnerY)/(crownEyeW*0.14+0.001));
  let wristInnerLat=smoothstep(crownEyeW*0.86,crownEyeW*1.20,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let wristInnerFace=smoothstep(-0.04,-0.36,normal.y)*smoothstep(0.18,0.44,abs(normal.x))*smoothstep(0.06,0.22,toon);
  lit=lit*(1.0-wristInnerBand*wristInnerLat*wristInnerFace*0.20);
  // Head-to-chest cast shadow: the skull mass creates a soft cast shadow on the upper chest below — the forward-facing chest just below the neckFwdZone is slightly darker than if it were fully lit (since the head blocks some top-fill); all official Pokemon art and Genshin show this upper chest shadow under the chin (Pikachu throat shadow, Mewtwo chest-under-chin dark zone, Charizard front neck shadow)
  let headCastShadowY=crownEyeY-crownEyeW*1.60;
  let headCastZone=smoothstep(headCastShadowY+crownEyeW*0.28,headCastShadowY,input.worldPosition.y)*(1.0-smoothstep(headCastShadowY,headCastShadowY-crownEyeW*0.52,input.worldPosition.y));
  let headCastFwd=smoothstep(0.22,0.54,normal.z)*smoothstep(0.26,0.04,abs(normal.x))*(1.0-metallic)*smoothstep(0.18,0.38,toon);
  lit=lit*(1.0-headCastZone*headCastFwd*0.18);
  // Achilles heel crease shadow: the concavity just above the heel on the posterior side of the ankle, where the Achilles tendon meets the calcaneus, always holds a deep shadow — on creatures that stand upright (Lucario, Blaziken, Mewtwo) this posterior heel-ankle shadow is visible from behind; modeled as a narrow posterior-facing dark line at the heel height
  let achillesY=crownEyeW*0.36;
  let achillesBand=smoothstep(0.06,0.0,abs(input.worldPosition.y-achillesY)/(crownEyeW*0.14+0.001));
  let achillesLat=smoothstep(crownEyeW*0.70,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let achillesBack=smoothstep(-0.10,-0.52,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*smoothstep(0.06,0.20,toon);
  lit=lit*(1.0-achillesBand*achillesLat*achillesBack*0.24);
  // Upper torso overhang cast shadow: large-chested or heavy-bellied creatures (Snorlax, Machamp, Arcanine) have a chest that overhangs the belly, casting a shadow on the mid-front torso just below the pectoral line; gives heavy creatures their mass quality; a shadow below the chest overhang line on forward-facing lower torso
  let overhangY=torsoY-crownEyeW*0.60;
  let overhangZone=smoothstep(overhangY-crownEyeW*0.60,overhangY,input.worldPosition.y)*(1.0-smoothstep(overhangY,overhangY+crownEyeW*0.28,input.worldPosition.y));
  let overhangFwd=smoothstep(0.24,0.54,normal.z)*smoothstep(0.20,0.04,abs(normal.x))*smoothstep(-0.04,-0.28,normal.y)*(1.0-metallic)*smoothstep(0.12,0.30,toon);
  lit=lit*(1.0-overhangZone*overhangFwd*0.14);
  // Posterior coccyx/tail-base shadow: at the very base of the tail where it attaches to the posterior lower torso, a shadow collects from the tail mass overhanging the buttocks — this is the deepest posterior shadow on biped/quadruped creatures and defines the tail-root anatomy; Arcanine, Charizard, Pikachu, Mewtwo all show this shadow pocket at the tail attachment; gives the tail its "emerging from the body" quality rather than looking pasted on; a shadow at the lower posterior torso just above the tail origin at Y=kneeY+0.80*crownEyeW
  let coccyxShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.24;
  let coccyxY=smoothstep(kneeY+crownEyeW*0.60,kneeY+crownEyeW*0.86,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.86,kneeY+crownEyeW*1.14,input.worldPosition.y));
  let coccyxX=smoothstep(crownEyeW*0.36,crownEyeW*0.10,abs(input.worldPosition.x));
  let coccyxBack=smoothstep(-0.10,-0.52,normal.z)*smoothstep(-0.14,-0.36,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-coccyxY*coccyxX*coccyxBack*coccyxShadGate*0.22);
  // Iris depth-gradient radial darkening: the iris is not uniformly colored — it has a subtle radial gradient darkening toward the periphery (limbus) and a slightly lighter inner ring around the pupil; this is the "iris depth cue" that makes eyes look three-dimensional rather than flat discs; all Gen 3+ Pokemon eyes, all Digimon eyes show this inner-bright/outer-dark iris gradation; modeled as a darkening band that increases from center to outer iris edge within the iris zone
  let irisDepthGate=(1.0-metallic)*smoothstep(0.44,0.68,toon)*0.26;
  let irisDepthDark0=smoothstep(scene.eye0.w*0.16,scene.eye0.w*0.42,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.42,scene.eye0.w*0.52,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre*irisBlend;
  let irisDepthDark1=smoothstep(scene.eye1.w*0.16,scene.eye1.w*0.42,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.42,scene.eye1.w*0.52,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre*irisBlend;
  let irisDepthFwd=smoothstep(0.22,0.54,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-max(irisDepthDark0,irisDepthDark1)*irisDepthFwd*irisDepthGate*0.28);
  // Contact shadow under standing foot: the foot pressing against the ground creates a very tight AO shadow at the exact contact edge — the thin dark seam where paw meets floor is the primary "creature is actually standing on a surface" cue; Pikachu, Arcanine, Charizard paw-to-floor contact line; without it the creature appears to hover; modeled as a very low Y darkening that is strongest at the ground level and fades upward over a small distance
  let contactShadowGate=(1.0-metallic)*smoothstep(0.06,0.22,toon)*0.30;
  let contactShadowY=smoothstep(crownEyeW*0.04,0.0,input.worldPosition.y);
  let contactShadowFace=smoothstep(-0.20,-0.50,normal.y)*smoothstep(crownEyeW*0.80,crownEyeW*1.50,abs(input.worldPosition.x));
  lit=lit*(1.0-contactShadowY*contactShadowFace*contactShadowGate*0.26);
  // Anisotropic scale sheen: warm-element/metallic/scaly creatures (Charizard, Aggron, Garchomp, Dragonite) have scale surfaces that reflect with an anisotropic directional sheen — the reflection streak follows scale orientation (horizontal) rather than being isotropic; simulated as a horizontal-direction tangent-space specular that produces a streak band wider in the horizontal axis; distinct from the existing scale specular; gated on warm+non-organic (scale surface) creatures
  let anisoScaleGate=warmDom*(1.0-organicSkin)*smoothstep(0.40,0.64,toon)*specShadowMask*(1.0-metallic*0.50)*0.22;
  let anisoHoriz=pow(max(dot(normal,halfVec),0.0),6.0)*pow(max(abs(dot(normal,vec3<f32>(0.0,1.0,0.0)))-0.40,0.0),2.0);
  let anisoVert=pow(max(dot(normal,halfVec),0.0),80.0);
  let anisoSheen=mix(anisoHoriz,anisoVert,0.30)*anisoScaleGate;
  lit=clamp(lit+mix(vec3<f32>(0.96,0.82,0.56),vec3<f32>(0.96,0.94,0.90),metallic*0.60)*anisoSheen*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ventral palm/sole flexor crease shadow: the palm surface (facing downward/inward when hand is relaxed) has a skin crease at the base of the fingers and at the palm heel — this crease shadow on the ventral paw surface is the single most important cue for "this is a hand, not a blob"; Lucario, Mewtwo, Incineroar paw undersides all show these palm creases; modeled as a shadow on the downward-facing/ventral paw surface at finger-base height
  let palmCreaseGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let palmCreaseY=smoothstep(wristY-crownEyeW*0.28,wristY-crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.20,wristY-crownEyeW*0.12,input.worldPosition.y));
  let palmCreaseLat=smoothstep(crownEyeW*0.68,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.06,crownEyeW*1.36,abs(input.worldPosition.x)));
  let palmCreaseFace=smoothstep(-0.24,-0.56,normal.y)*smoothstep(0.12,0.02,abs(normal.z))*smoothstep(0.12,0.26,abs(normal.x));
  lit=lit*(1.0-palmCreaseY*palmCreaseLat*palmCreaseFace*palmCreaseGate*0.18);
  // Tail coil underside shadow: the underside of the tail (when it curves around/downward) self-shadows as the tail mass blocks ground bounce from below — on Pikachu, Eevee, Charizard, Arcanine the underside of the tail is consistently darker than the topside because it faces away from both the key and the ground bounce; gives the tail "round cross-section" quality from any viewing angle; modeled as a posterior-downward-facing shadow on the tail radius at varying heights
  let tailUnderShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let tailUnderY=smoothstep(crownEyeY-crownEyeW*3.80,crownEyeY-crownEyeW*2.20,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*2.20,crownEyeY-crownEyeW*1.80,input.worldPosition.y));
  let tailUnderLat=smoothstep(crownEyeW*0.12,crownEyeW*0.48,abs(input.worldPosition.x))*(1.0-metallic);
  let tailUnderBack=smoothstep(-0.14,-0.60,normal.y)*smoothstep(-0.08,-0.32,normal.z)*smoothstep(0.10,0.24,abs(normal.x));
  lit=lit*(1.0-tailUnderY*tailUnderLat*tailUnderBack*tailUnderShadGate*0.18);
  // Knuckle/claw ridge forward specular: the knuckle joints on the back of the paw/hand catch a narrow ridge specular from the key light — creates dimensional hand anatomy visible on Lucario, Mewtwo, Machamp; lateral extremity at wrist height, forward-facing ridge
  let knuckleSpecY=crownEyeW*1.10;
  let knuckleZone=smoothstep(abs(input.worldPosition.y-knuckleSpecY)-crownEyeW*0.10,abs(input.worldPosition.y-knuckleSpecY)-crownEyeW*0.20,0.0)*smoothstep(0.30,0.54,normal.z)*smoothstep(0.20,0.44,abs(normal.x))*(1.0-metallic)*specShadowMask;
  let knuckleSpec=pow(max(dot(normal,halfVec),0.0),96.0)*knuckleZone*smoothstep(0.48,0.72,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*knuckleSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wrist/ankle wrap highlight: the thinnest point of the lower limb just above the hand/foot catches a wrap highlight from lateral light — Mewtwo's thin wrists, Blaziken's ankle wrap, Gallade's wrist guard all have this pale ring; lighter than the arm body because skin is thinnest there (more SSS through) and it faces more normals outward
  let wristWrapBand=smoothstep(0.08,0.0,abs(input.worldPosition.y-wristY)/(crownEyeW*0.12+0.001));
  let wristLat=smoothstep(crownEyeW*0.90,crownEyeW*1.30,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let wristHL=wristWrapBand*wristLat*smoothstep(0.20,0.44,abs(normal.x))*smoothstep(0.42,0.64,toon)*0.20;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*wristHL*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Forearm dorsal brachioradialis ridge specular: the rounded muscle ridge on the dorsal (back) side of the forearm, running from the lateral elbow to the wrist, catches overhead key light as a faint elongated specular — Mewtwo, Lucario, Blaziken, Gallade all show this back-of-forearm brightness that gives the forearm its muscular convex dorsal profile; distinct from the bicep (upper arm) and wrist wrap; appears as a long oval on the dorsal-outward-facing forearm surface between elbow and wrist height
  let forearmDorsalY=smoothstep(elbowY-crownEyeW*0.20,elbowY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.60,wristY+crownEyeW*0.20,input.worldPosition.y));
  let forearmDorsalLat=smoothstep(crownEyeW*0.94,crownEyeW*1.24,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let forearmDorsalFace=smoothstep(-0.08,-0.36,normal.z)*smoothstep(0.32,0.56,normal.y)*smoothstep(0.22,0.44,abs(normal.x))*specShadowMask*smoothstep(0.40,0.64,toon);
  let forearmDorsalSpec=pow(max(dot(normal,halfVec),0.0),18.0)*forearmDorsalY*forearmDorsalLat*forearmDorsalFace;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*forearmDorsalSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal hand extensor tendon ridge: on the back of the paw/hand, four extensor tendons run from the knuckle joints up the dorsal surface, each creating a narrow raised specular ridge — visible on Lucario, Incineroar, Scizor, Blaziken paws; adds the distinct knuckle-to-wrist ridge anatomy that separates a generic paw from a character-specific hand; four radial ridges spaced laterally, fading at wrist and knuckle ends
  let handTendonY=smoothstep(wristY+crownEyeW*0.08,wristY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.06,wristY-crownEyeW*0.32,input.worldPosition.y));
  let handTendonLat=smoothstep(crownEyeW*0.74,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let tendonPhase=fract(abs(input.worldPosition.x)/crownEyeW*3.60)*3.14159;
  let tendonRidge=pow(max(sin(tendonPhase),0.0),12.0);
  let handTendonFace=smoothstep(-0.06,-0.28,normal.z)*smoothstep(0.28,0.52,normal.y)*smoothstep(0.10,0.04,abs(normal.x))*specShadowMask*smoothstep(0.44,0.66,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*tendonRidge*handTendonY*handTendonLat*handTendonFace*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Knuckle box dorsal specular: the metacarpophalangeal joints (knuckles) are the widest, flattest part of the dorsal paw and form a distinct top-lit plateau; on Machamp, Lucario, Incineroar, Scizor the knuckle row reads as 3-4 distinct specular dots across the top of the paw; adds the key structural read that separates articulated hands from featureless blobs at the limb end
  let knuckleY=smoothstep(wristY-crownEyeW*0.36,wristY-crownEyeW*0.24,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.24,wristY-crownEyeW*0.12,input.worldPosition.y));
  let knuckleLat=smoothstep(crownEyeW*0.66,crownEyeW*1.12,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let knucklePhase=fract(abs(input.worldPosition.x)/crownEyeW*2.60+0.16)*3.14159;
  let knuckleDot=pow(max(sin(knucklePhase),0.0),22.0);
  let knuckleFace=smoothstep(0.40,0.62,normal.y)*smoothstep(0.18,0.04,abs(normal.x))*smoothstep(0.12,0.04,abs(normal.z))*specShadowMask*smoothstep(0.44,0.68,toon);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*knuckleDot*knuckleY*knuckleLat*knuckleFace*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Patellar tendon lateral groove shadow: on each side of the patellar tendon (which runs from the kneecap down to the tibial tuberosity) there is a groove between the tendon and the condyle — these two shadow grooves frame the tendon and give the anterior knee its "defined kneecap" look; Blaziken, Mewtwo, Lucario knees all show these lateral tendon-groove shadows flanking the bright kneecap; add the two dark lines that frame the kneecap from below
  let patTenGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.22;
  let patTenGrooveY=smoothstep(kneeY-crownEyeW*0.20,kneeY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.10,kneeY,input.worldPosition.y));
  let patTenGrooveLat=smoothstep(crownEyeW*0.40,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.60,crownEyeW*0.80,abs(input.worldPosition.x)));
  let patTenGrooveFwd=smoothstep(0.28,0.58,normal.z)*smoothstep(0.12,-0.08,normal.y)*smoothstep(0.20,0.38,abs(normal.x));
  lit=lit*(1.0-patTenGrooveY*patTenGrooveLat*patTenGrooveFwd*patTenGrooveGate*0.20);
  // Lower lip forward catch-light specular: the lower lip (vermilion border) is the most moistened and rounded forward-projecting surface of the mouth — it catches the key light as a bright oval with strong specular; distinct from the vermilion border ring spec (which is at the edge); this is the main lower lip wetness highlight; all Pokemon with visible mouths (Arcanine, Charizard, Mewtwo, Agumon) show a bright lower lip surface; a wider oval specular on the anterior lower lip surface
  let lowerLipGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.24;
  let lowerLipY=smoothstep(scene.mouth.y+scene.mouth.w*0.50,scene.mouth.y+scene.mouth.w*0.68,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.68,scene.mouth.y+scene.mouth.w*0.88,input.worldPosition.y));
  let lowerLipX=smoothstep(scene.mouth.w*0.72,scene.mouth.w*0.22,abs(input.worldPosition.x));
  let lowerLipFace=smoothstep(0.36,0.66,normal.z)*smoothstep(0.12,0.28,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  let lowerLipSpec=pow(max(dot(normal,halfVec),0.0),32.0)*lowerLipY*lowerLipX*lowerLipFace*(1.0-mouthBlend*0.70)*lowerLipGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*lowerLipSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial epicondyle inner elbow shadow: the medial epicondyle is the bony bump on the inner side of the elbow — the inner elbow region is always slightly shadowed compared to the outer lateral elbow; on Mewtwo, Lucario, Blaziken, Gallade the inner/medial elbow face is darker; gives the elbow its correct "round from all sides" topology by darkening the medial inner face; a shadow on the medial-inward-facing elbow surface at elbowY
  let medEpiGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let medEpiY=smoothstep(elbowY-crownEyeW*0.12,elbowY,input.worldPosition.y)*(1.0-smoothstep(elbowY,elbowY+crownEyeW*0.14,input.worldPosition.y));
  let medEpiLat=smoothstep(crownEyeW*0.70,crownEyeW*0.42,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.42,crownEyeW*0.16,abs(input.worldPosition.x)));
  let medEpiFace=smoothstep(0.20,0.48,abs(normal.x))*smoothstep(0.10,-0.16,normal.z)*smoothstep(0.08,0.02,abs(normal.y))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-medEpiY*medEpiLat*medEpiFace*medEpiGate*0.20);
  // Deltoid shadow drop on upper arm: the deltoid muscle creates a rounded peak at the very top of the arm, which casts a short crescent shadow onto the upper arm surface just below the shoulder peak — visible as a dark arc under the shoulder cap on Mewtwo, Machamp, Charizard, Lucario; the feature makes the shoulder feel round and muscular rather than attached at a flat plane; modeled as a concave shadow crescent just below elbowY+0.90*crownEyeW on the lateral outer arm
  let deltShadYLow=elbowY+crownEyeW*0.82;
  let deltShadYHigh=elbowY+crownEyeW*1.16;
  let deltShadY=smoothstep(deltShadYLow,mix(deltShadYLow,deltShadYHigh,0.40),input.worldPosition.y)*(1.0-smoothstep(mix(deltShadYLow,deltShadYHigh,0.62),deltShadYHigh,input.worldPosition.y));
  let deltShadLat=smoothstep(crownEyeW*0.76,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let deltShadFace=smoothstep(0.14,0.40,abs(normal.x))*smoothstep(0.16,0.04,abs(normal.y))*smoothstep(0.08,-0.14,normal.z)*smoothstep(0.08,0.24,toon)*specShadowMask;
  lit=lit*(1.0-deltShadY*deltShadLat*deltShadFace*0.18);
  // Mid-limb inter-joint darkening: between every joint highlight (shoulder, elbow, wrist, hip, knee, ankle), the middle of each limb segment is fractionally darker — the bead-necklace anatomy principle used on Charizard's arm, Mewtwo's thighs, Garchomp's segments; created via sinusoidal AO along the limb Y axis that dims between specular bands; makes limbs read as segmented rather than uniform tubes
  let limbSegFreq=scale*2.60;
  let limbSegWave=sin(input.worldPosition.y*limbSegFreq+fv*1.80)*0.5+0.5;
  let limbSegAO=smoothstep(0.42,0.56,limbSegWave)*(1.0-smoothstep(0.56,0.72,limbSegWave));
  let limbSegLat=smoothstep(crownEyeW*0.64,crownEyeW*1.20,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let limbSegZone=smoothstep(wristY-crownEyeW*0.20,elbowY+crownEyeW*1.40,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*1.40,elbowY+crownEyeW*1.80,input.worldPosition.y));
  lit=lit*(1.0-limbSegAO*limbSegLat*limbSegZone*smoothstep(0.08,0.24,toon)*0.14);
  // Wrist/ankle secondary color accent band: many Pokemon carry a contrasting accent band at the wrist/ankle joint — Gallade's white cuff, Mewtwo's purple wrist, Lucario's blue paw-to-arm band, Gardevoir's sleeve edge, Incineroar's white chest-to-arm boundary; this fv-gated ring adds the palette1 hue accent at the wrist and ankle joint position, making limb-end anatomy clearly distinct and character-defining
  let accentBandGate=step(fv,0.68)*(1.0-metallic)*smoothstep(0.28,0.52,toon)*0.36;
  let accentWristRing=smoothstep(0.06,0.0,abs(input.worldPosition.y-crownEyeW*1.56)/(crownEyeW*0.10+0.001))*smoothstep(crownEyeW*0.78,crownEyeW*1.24,abs(input.worldPosition.x))*accentBandGate;
  let accentAnkleRing=smoothstep(0.06,0.0,abs(input.worldPosition.y-crownEyeW*0.46)/(crownEyeW*0.10+0.001))*smoothstep(crownEyeW*0.60,crownEyeW*1.0,abs(input.worldPosition.x))*accentBandGate*step(fv,0.48);
  let accentRing=clamp(accentWristRing+accentAnkleRing,0.0,1.0)*organicSkin;
  let accentRingColor=mix(scene.palette1.rgb*0.80+vec3<f32>(0.20),scene.palette2.rgb*0.70+vec3<f32>(0.30),step(fv,0.34));
  base=mix(base,clamp(accentRingColor,vec3<f32>(0.0),vec3<f32>(1.0)),accentRing*0.44);
  // Eye socket concavity shadow: eyes sit recessed into the skull, so the tissue immediately surrounding each eye is always slightly darker — occlusion from the brow ridge above and cheek below (Charizard, Mewtwo, Garchomp show deep-set socket shadow around the eye that makes the iris pop); wider ring than eye itself, one-sided darkening
  let eyeSockGate=(1.0-metallic)*smoothstep(0.04,0.20,toon)*0.24;
  let sock0R=scene.eye0.w*1.60;
  let sock1R=scene.eye1.w*1.60;
  let sock0Dist=length(input.worldPosition.xy-scene.eye0.xy);
  let sock1Dist=length(input.worldPosition.xy-scene.eye1.xy);
  let sockRing=max(smoothstep(sock0R,sock0R*0.72,sock0Dist)*(1.0-smoothstep(sock0R*0.50,sock0R*0.20,sock0Dist))*eye0pre,smoothstep(sock1R,sock1R*0.72,sock1Dist)*(1.0-smoothstep(sock1R*0.50,sock1R*0.20,sock1Dist))*eye1pre);
  lit=lit*(1.0-sockRing*eyeSockGate*0.24);
  // Warm terminator band: narrow element-warm hue exactly at the shadow/lit boundary — occlusion bounce-light effect seen in all Pokemon official art where orange/cyan warmth bleeds into the terminator line (Charizard warm orange crescent at shadow edge; Vaporeon cool-cyan at water-body terminator)
  let terminatorBand=smoothstep(0.08,0.22,toon)*smoothstep(0.44,0.28,toon)*(1.0-metallic);
  let warmTermTint=mix(vec3<f32>(0.72,0.28,0.04)*warmDom,scene.palette2.rgb*0.56,clamp(1.0-warmDom*2.0,0.0,1.0));
  lit=clamp(lit+warmTermTint*terminatorBand*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral gastrocnemius teardrop highlight: the medial and lateral gastrocnemius heads create two teardrop-shaped muscle bellies on the posterior calf — their widest outer curve catches lateral light as a teardrop-shaped specular; Blaziken, Lucario, Mewtwo, Charizard calf cross-sections always show these twin specular lobes on the back of the lower leg; makes the calf look like a real muscle group rather than a cylinder; a double-lobe specular on the posterior lateral calf surface between knee and ankle
  let gasSpecGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.20;
  let gasSpecY=smoothstep(kneeY-crownEyeW*0.20,kneeY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.60,kneeY-crownEyeW*1.10,input.worldPosition.y));
  let gasSpecLat=smoothstep(crownEyeW*0.58,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.20,abs(input.worldPosition.x)));
  let gasMidPhase=fract(abs(input.worldPosition.x)/crownEyeW*1.60)*3.14159;
  let gasLobe=pow(max(sin(gasMidPhase),0.0),8.0);
  let gasSpecBack=smoothstep(-0.14,-0.56,normal.z)*smoothstep(0.36,0.60,normal.y)*smoothstep(0.18,0.34,abs(normal.x));
  let gasSpecular=pow(max(dot(normal,halfVec),0.0),28.0)*gasSpecY*gasSpecLat*gasLobe*gasSpecBack*gasSpecGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*gasSpecular*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Mandibular prognathism jaw side shadow: the lower jaw (mandible) projects forward and the lateral corners (mandibular angles) create side-jaw shadows — the shadow on the lateral jaw surface just below the cheekbone is one of the strongest "jaw definition" cues; Machamp, Mewtwo, Blaziken, Conkeldurr all show prominent jaw-angle shadows that give the lower face its squared "strong jaw" quality; a shadow on the lateral-lower-forward jaw surface between chin and ear height
  let jawAngGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(fv,0.60)*0.24;
  let jawAngY=smoothstep(scene.mouth.y-scene.mouth.w*0.60,scene.mouth.y-scene.mouth.w*0.24,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.24,scene.mouth.y+scene.mouth.w*0.40,input.worldPosition.y));
  let jawAngLat=smoothstep(crownEyeW*0.48,crownEyeW*0.78,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.78,crownEyeW*1.06,abs(input.worldPosition.x)));
  let jawAngFace=smoothstep(0.24,0.52,abs(normal.x))*smoothstep(0.10,-0.12,normal.z)*smoothstep(0.08,0.02,abs(normal.y));
  lit=lit*(1.0-jawAngY*jawAngLat*jawAngFace*jawAngGate*0.18);
  // Iridescent chitin back-plate sheen: Shadow, Metal, Plant, and Earth creatures with non-organic surfaces (organicSkin < 0.4) develop an iridescent sheen on their dorsal/back surfaces — chitin, carapace, and mineral plates catch light with oil-slick hue rotation; Scizor's red chitin, Volcarona's scales, Kabutops shell; modeled as a smooth hue-rotating specular layer strongest on posterior-facing surfaces
  let chitinIridGate=(1.0-organicSkin)*(1.0-metallic)*smoothstep(0.36,0.58,toon)*specShadowMask*(shadowDom+plantDom+earthDom+msMetal*0.40)*clamp(1.0,0.0,1.0)*0.24;
  let chitinIridPhase=dot(normal,halfVec)*3.14+fv*2.72+input.worldPosition.y*scale*1.30;
  let chitinColor=vec3<f32>(sin(chitinIridPhase)*0.5+0.5,sin(chitinIridPhase+2.094)*0.5+0.5,sin(chitinIridPhase+4.189)*0.5+0.5);
  let chitinSpec=pow(max(dot(normal,halfVec),0.0),22.0)*smoothstep(-0.10,-0.40,normal.z)*smoothstep(0.10,0.26,normal.y)*chitinIridGate;
  lit=clamp(lit+chitinColor*chitinSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tail base AO: the root of the tail where it joins the hip receives a dark contact shadow ring — Charizard/Arcanine/Vaporeon tail-root shadow gives anatomical depth (tail is clearly separate from body)
  if (scene.tailTip.w > 0.0) {
    let tailBaseY=crownEyeY-crownEyeW*4.60;
    let tailBaseRing=smoothstep(tailBaseY+crownEyeW*0.40,tailBaseY,input.worldPosition.y)*(1.0-smoothstep(tailBaseY,tailBaseY-crownEyeW*0.32,input.worldPosition.y));
    let tailBaseLat=smoothstep(0.16,0.48,abs(normal.x))*smoothstep(0.10,-0.20,normal.z);
    lit=lit*(1.0-tailBaseRing*tailBaseLat*(1.0-metallic)*0.20);
  }
  // Scale ridge anisotropy: Dragon/Metal scale rows have a faint directional highlight along the Y axis — gives the characteristic "scale-row shimmer" when viewed at grazing angles (Charizard/Flygon/Metagross metallic ridge lines)
  let scaleAnisGate=warmDom*smoothstep(0.22,0.04,roughness)*(1.0-metallic)*smoothstep(0.48,0.70,toon);
  let anisVec=normalize(vec3<f32>(0.0,1.0,0.0)-(normal*dot(normal,vec3<f32>(0.0,1.0,0.0))));
  let anisH=dot(anisVec,halfVec);
  let anisSpec=pow(max(anisH,0.0),32.0)*scaleAnisGate;
  lit=clamp(lit+vec3<f32>(0.94,0.88,0.78)*anisSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));

  // Tail segment joint accent rings: lighter bands at segment joints — Dragonair, Milotic, Arbok, Rayquaza all have visible segment accent rings; adds anatomy detail and breaks up uniform tail color
  let tailSegFreq=scale*3.0;
  let tailSegWave=sin(input.worldPosition.y*tailSegFreq+fv*4.0)*0.5+0.5;
  let tailSegRing=smoothstep(0.78,0.92,tailSegWave)*(1.0-metallic)*smoothstep(0.30,0.56,toon);
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*tailSegRing*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scale center convex brightening: the center of each scale plate is slightly convex (domed outward) and therefore catches slightly more key light than flat — each scale has its own mini-specular peak at center; creates the characteristic "scale bubble" appearance of Dragonite/Charizard/Flygon scale plate centers; additive bright dot at scale-wave center (away from groove)
  let scaleCenterGate=warmDom*(1.0-metallic)*smoothstep(0.36,0.58,toon)*specShadowMask;
  let sgCenterA=smoothstep(0.60,0.82,sgWaveA)*smoothstep(0.60,0.82,sgWaveB);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.88)*sgCenterA*scaleCenterGate*pow(max(dot(normal,halfVec),0.0),24.0)*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Frontal sinus nose bridge highlight: the nose bridge (dorsum nasi) from brow root down to nose tip is a raised central bone — it catches key light as a narrow vertical bright stripe on the center of the face; Mewtwo, Gardevoir, Gallade, Pikachu/Eevee snout bridge all show this vertical central bright line that reads as the nose projecting forward; it separates the two dark orbit zones and is the structural anchor of the face read
  let frontalSinusGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let frontalSinusY=smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.30,crownEyeY+crownEyeW*0.60,input.worldPosition.y));
  let frontalSinusX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(input.worldPosition.x));
  let frontalSinusFace=smoothstep(0.36,0.62,normal.z)*smoothstep(0.08,-0.04,abs(normal.x))*smoothstep(0.08,-0.06,abs(normal.y));
  let frontalSinusSpec=pow(max(dot(normal,halfVec),0.0),36.0)*frontalSinusY*frontalSinusX*frontalSinusFace*frontalSinusGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*frontalSinusSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Superior gluteal crease fold shadow: at the top of the buttock where the gluteus maximus meets the lower back (the gluteal fold / superior natal cleft) there is a deep crease shadow — this crease shadow is what gives the posterior view of a biped its "clearly has a lower back and buttocks" read; Mewtwo, Blaziken, Lucario, Infernape all show a dark horizontal posterior crease at the waist-to-glute transition; a horizontal shadow at the posterior lower-torso-to-hip junction
  let glutealFoldGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let glutealY=crownEyeY-crownEyeW*2.10;
  let glutealBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-glutealY)/(crownEyeW*0.14+0.001));
  let glutealX=smoothstep(crownEyeW*0.50,crownEyeW*0.14,abs(input.worldPosition.x));
  let glutealBack=smoothstep(-0.12,-0.50,normal.z)*smoothstep(-0.14,-0.36,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-glutealBand*glutealX*glutealBack*glutealFoldGate*0.22);
  // Ear helix inner rim specular: the inner rim/helix of the ear (the curved cartilage ridge on the inner face of the ear pinna) catches forward key light as a bright curved arc — on Pikachu, Eevee, Espeon, Sylveon the inner ear surface shows a bright curved line along the helix; gives ears their "cup-shaped" 3D quality rather than flat paddles; a curved bright specular on the inner-forward-facing ear surface at the helix position just inside the ear outer edge; gated on fv ≤ 0.65
  let earHelixGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(fv,0.65)*0.22;
  let earHelixY=smoothstep(earTopY+crownEyeW*0.20,earTopY+crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(earTopY+crownEyeW*0.80,earTopY+crownEyeW*1.40,input.worldPosition.y));
  let earHelixLat=smoothstep(crownEyeW*0.48,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*1.04,abs(input.worldPosition.x)));
  let earHelixFace=smoothstep(0.24,0.52,normal.z)*smoothstep(0.12,0.32,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y));
  let earHelixSpec=pow(max(dot(normal,halfVec),0.0),32.0)*earHelixY*earHelixLat*earHelixFace*earHelixGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*earHelixSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Under-scale shadow groove: thin dark seam between adjacent scales (Charizard, Garchomp, Flygon) — micro-shadow detail that sells the scale texture without a per-scale normal map
  let scaleGrooveShadow=warmDom*(1.0-metallic)*smoothstep(0.36,0.60,toon);
  let scaleGroove=step(0.92,sgWaveA*sgWaveB)*scaleGrooveShadow;
  lit=lit*(1.0-scaleGroove*0.18);
  // Inter-scale groove SSS: in the narrow channel between scales, the thin skin that bridges the gap transmits element-colored light from within — visible as a very faint colored glow at the bottom of each scale groove; Dragon/Fire scale inter-groove glows amber-warm while Ice glows pale blue; this gives scales a "living" quality as if lit from inside
  let grooveSSSGate=warmDom*scaleGrooveShadow*(1.0-metallic)*smoothstep(0.04,0.22,toon)*0.16;
  lit=clamp(lit+mix(vec3<f32>(0.54,0.18,0.04),scene.palette2.rgb*0.80,clamp(palBright-0.28,0.0,1.0))*grooveSSSGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pectoral/chest forward catch specular: the forward-facing upper chest just above the belly zone gets a wide, soft specular that suggests pectoral muscle mass — biped creatures (Mewtwo, Lucario, Machamp) show a broad pec-highlight that gives them physical presence; gated on organic surfaces and forward normals at upper-torso height
  let pectZoneY=crownEyeY-crownEyeW*1.40;
  let pectZone=smoothstep(pectZoneY-crownEyeW*0.60,pectZoneY,input.worldPosition.y)*(1.0-smoothstep(pectZoneY,pectZoneY+crownEyeW*0.60,input.worldPosition.y));
  let pectFwd=smoothstep(0.30,0.62,normal.z)*smoothstep(0.32,0.06,abs(normal.x))*(1.0-metallic)*organicSkin;
  let pectSpec=pow(max(dot(normal,halfVec),0.0),20.0)*specShadowMask*smoothstep(0.44,0.68,toon)*pectZone*pectFwd;
  lit=clamp(lit+mix(vec3<f32>(1.0,0.97,0.94),scene.palette2.rgb*0.80+vec3<f32>(0.20),0.22)*pectSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Brushed metal scratch anisotropy: machined/brushed metal surfaces (Metagross, Scizor, Steelix) show directional scratch highlights from manufacturing or battle damage; horizontal scratch orientation (perpendicular to scale-row Y anisotropy); adds the characteristic cross-hatch quality of industrial metal surfaces
  let brushedMetalGate=metallic*smoothstep(0.14,0.36,roughness)*smoothstep(0.46,0.30,roughness)*smoothstep(0.36,0.54,toon);
  let scratchVec=normalize(vec3<f32>(1.0,0.0,0.0)-(normal*dot(normal,vec3<f32>(1.0,0.0,0.0))));
  let scratchH=dot(scratchVec,halfVec);
  let scratchSpec=pow(max(scratchH,0.0),22.0)*brushedMetalGate*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.88,0.88,0.92)*scratchSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fire heat-distortion specular shimmer: fire-dominant creatures (Charizard, Arcanine, Flareon) have a heat-shimmer effect above and around their hot regions — the specular appears to "swim" with heat distortion; simulated as a high-frequency spatial noise modulating the specular intensity in hot zones near the body extremities; distinct from the existing warm shimmer; this specific fire shimmer uses the spatial position to offset specular intensity in lit zones
  let heatShimGate=warmDom*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*clamp(palBright-0.22,0.0,1.0)*0.18;
  let heatShimCell=floor(input.worldPosition*scale*14.0+fv*vec3<f32>(3.14,2.72,1.62));
  let heatShimH=fract(sin(dot(heatShimCell,vec3<f32>(127.1,311.7,74.7)))*43758.5)*2.0-1.0;
  let heatShimBright=smoothstep(0.56,0.78,toon)*heatShimH*heatShimGate;
  lit=clamp(lit+vec3<f32>(0.96,0.74,0.28)*heatShimBright*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water element ripple micro-surface: water-dominant creatures (Vaporeon, Gyarados, Lapras) have a ripple micro-texture on their smooth surfaces — small sinusoidal ripple normals that create a soft moving shimmer distinct from the static specular; modeled as two crossed sine waves at different frequencies creating a ripple-pool surface perturbation visible as secondary micro-specs on smooth water-type surfaces
  let waterRippleGate=blueSheen*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*smoothstep(0.40,0.22,roughness)*0.18;
  let waterRipA=sin(input.worldPosition.x*scale*8.20+fv*5.40)*sin(input.worldPosition.z*scale*6.80+fv*3.70)*0.5+0.5;
  let waterRipB=sin(input.worldPosition.x*scale*5.60+fv*3.20+1.57)*sin(input.worldPosition.z*scale*9.40+fv*4.10+0.78)*0.5+0.5;
  let waterRippleSpec=pow(max(waterRipA*waterRipB,0.0),6.0)*waterRippleGate;
  lit=clamp(lit+vec3<f32>(0.72,0.88,0.96)*waterRippleSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric arc-flash luminance burst: electric-dominant creatures (Pikachu, Jolteon, Raichu, Electivire) have brief bright micro-arc flashes on their surface — static electricity arcs that appear as tiny elongated bright filaments at high specular angles; simulated as high-frequency Voronoi-cell based bright filament at silhouette and high-normal angles; distinct from the electric glow; this is the crackling arc quality
  let arcFlashGate=elecChargeGate*(1.0-metallic)*smoothstep(0.44,0.68,toon)*smoothstep(0.58,0.76,fresnel)*0.22;
  let arcFlashCell=floor(input.worldPosition*scale*12.0);
  let arcFlashH=fract(sin(dot(arcFlashCell,vec3<f32>(311.7,74.7,127.1)))*27831.5);
  let arcFlash=step(0.88,arcFlashH)*arcFlashGate;
  lit=clamp(lit+vec3<f32>(0.92,0.96,0.40)*arcFlash*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Deltoid shoulder dome specular: the topmost point of each upper arm (the deltoid cap) catches a strong overhead specular — this is the single most readable "3D muscle" cue on bipedal fighters; Lucario, Blaziken, Machamp, Infernape all have this arm-top bright dome; computed as a specular at the top of the arm outer lateral sphere
  let deltoidZone=smoothstep(crownEyeY-crownEyeW*0.44,crownEyeY-crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*1.10,input.worldPosition.y));
  let deltoidLat=smoothstep(crownEyeW*0.86,crownEyeW*1.26,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let deltoidTop=smoothstep(0.38,0.72,normal.y)*specShadowMask*smoothstep(0.44,0.68,toon);
  let deltoidSpec=pow(max(dot(normal,halfVec),0.0),28.0)*deltoidZone*deltoidLat*deltoidTop;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*deltoidSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant chlorophyll SSS: plant-dominant creatures (Bulbasaur, Venusaur, Leafeon, Serperior) have leaf-like surface tissues rich in chlorophyll that scatter green light from within — when backlit the body has a warm green-to-yellow SSS glow (like sunlight through a leaf); simulated as a warm-green backlit SSS layer on plant creatures with smooth forward-facing surfaces; the chlorophyll SSS is stronger toward the leaf extremities (higher lateral extent) and modulated by plant color saturation
  let chlorophyllGate=plantDom*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*smoothstep(0.06,0.20,toon)*0.28;
  let chlorophyllBack=max(0.0,-dot(normal,lightDir));
  let chlorophyllExt=smoothstep(crownEyeW*0.40,crownEyeW*1.20,abs(input.worldPosition.x))*(1.0-metallic);
  let chlorophyllFwd=smoothstep(0.24,0.54,abs(normal.x))*smoothstep(0.16,0.06,abs(normal.y));
  let chlorophyllSSS=chlorophyllBack*chlorophyllExt*chlorophyllFwd*chlorophyllGate;
  lit=clamp(lit+mix(vec3<f32>(0.28,0.74,0.18),vec3<f32>(0.60,0.84,0.18),clamp(palBright-0.30,0.0,1.0))*chlorophyllSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Air/Wind atmospheric rim haze: air-dominant creatures (Flygon, Beautifly, Altaria, Lugia) have an atmospheric diffusion at their silhouette — the body edges dissolve slightly into a pale atmospheric haze as if seen through scattered light; on cloudy-sky backlit renders this gives them a "cloud creature" ethereal quality; stronger toward the fresnel rim and on light-colored creatures; a pale blue-white additive glow at the silhouette rim on air creatures
  let airSilhouetteGate=(1.0-warmDom)*(1.0-blueSheen)*(1.0-shadowDom)*(1.0-plantDom)*smoothstep(0.50,0.72,fresnel)*(1.0-metallic)*clamp(palBright-0.36,0.0,1.0)*smoothstep(0.36,0.58,toon)*0.18;
  let airSilhouetteColor=mix(vec3<f32>(0.90,0.94,0.98),scene.palette2.rgb*0.40+vec3<f32>(0.54,0.58,0.60),0.30);
  lit=clamp(lit+airSilhouetteColor*airSilhouetteGate*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow/Dark element void absorption: shadow-dominant creatures (Gengar, Zoroark, Umbreon, Darkrai) have a surface that seems to absorb ambient light — where the body faces away from the key light it becomes more deeply dark than organic flesh; a secondary darkening on shadow creatures that makes their dark sides darker; also desaturates the dark side toward near-black; combined effect gives the "this thing is made of actual darkness" visual quality
  let voidAbsorbGate=shadowDom*(1.0-metallic)*smoothstep(0.08,0.0,toon)*clamp(palBright-0.10,0.0,1.0)*0.30;
  let voidAbsorbLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  lit=clamp(mix(vec3<f32>(voidAbsorbLuma)*0.70,lit,0.40)*voidAbsorbGate+lit*(1.0-voidAbsorbGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Tail vertebra rings: the tail body is segmented with ring-like ridges similar to dorsal spine — Dragonair's smooth rings, Charizard's tail segments, Arcanine's tail base — regular sinusoidal bands along the tail Z-axis producing subtle bright lines at each segment junction
  if (scene.tailTip.w > 0.0) {
    let tailDir=normalize(scene.tailTip.xyz-vec3<f32>(0.0,crownEyeY-crownEyeW*3.40,0.0));
    let tailProj=dot(input.worldPosition.xyz-vec3<f32>(0.0,crownEyeY-crownEyeW*3.40,0.0),tailDir);
    let tailSegWave=sin(tailProj*scale*5.20+fv*2.0)*0.5+0.5;
    let tailSegBand=smoothstep(0.78,0.90,tailSegWave)*(1.0-metallic)*smoothstep(0.36,0.58,toon)*(1.0-tipDist*0.50)*organicSkin;
    let tailSegBack=smoothstep(-0.10,-0.40,dot(normal,tailDir))*0.30;
    lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*tailSegBand*tailSegBack*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  }
  // Bicep peak anterior specular: the peak of the bicep (the maximum forward-facing bulge of the upper arm at mid-upper-arm height) catches a tight forward specular — Blaziken, Lucario, Machamp, Infernape bicep top; gives the arm a "flexed muscle" quality; distinct from deltoid (which is at shoulder dome); this is the arm's own specular on the forward-most point of the upper arm
  let bicepPeakZone=smoothstep(crownEyeY-crownEyeW*0.86,crownEyeY-crownEyeW*1.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*1.40,input.worldPosition.y));
  let bicepPeakLat=smoothstep(crownEyeW*0.86,crownEyeW*1.20,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let bicepPeakFwd=smoothstep(0.36,0.66,normal.z)*smoothstep(0.14,0.04,abs(normal.x))*smoothstep(0.08,0.20,normal.y)*specShadowMask*smoothstep(0.44,0.68,toon);
  let bicepPeakSpec=pow(max(dot(normal,halfVec),0.0),40.0)*bicepPeakZone*bicepPeakLat*bicepPeakFwd;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*bicepPeakSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Micro-roughness vertex color variation: the surface roughness varies slightly based on spatial position — like a real creature's skin having different micro-texture regions (smoother around eyes and joints, rougher on back and extremities); modeled as a low-frequency noise added to the effective roughness that slightly brightens or dims the micro-specular response; prevents the "uniform material" quality that makes game creatures read as textured sphere
  let microRghVar=fract(sin(dot(floor(input.worldPosition*scale*1.80),vec3<f32>(171.3,311.7,74.7)))*43758.5)*2.0-1.0;
  let microRghStr=(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.08;
  let microRghSpec=pow(max(dot(normal,halfVec),0.0),18.0)*microRghVar*microRghStr*(1.0-roughness*0.80);
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*max(microRghSpec,0.0)*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior neck skin fold: on the posterior neck just above the shoulder, skin folds create a transverse shadow band — when the creature tilts or extends its neck the posterior skin compresses into folds; a permanent slight shadow on the posterior neck at the neck-to-shoulder junction visible from behind; Arcanine, Charizard, Mewtwo all show this posterior neck-to-shoulder fold shadow; complements the anterior neckFwdZone highlight
  let postNeckFoldGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let postNeckFoldY=crownEyeY-crownEyeW*0.92;
  let postNeckFoldBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-postNeckFoldY)/(crownEyeW*0.14+0.001));
  let postNeckFoldX=smoothstep(crownEyeW*0.36,crownEyeW*0.12,abs(input.worldPosition.x));
  let postNeckFoldBack=smoothstep(-0.12,-0.46,normal.z)*smoothstep(0.14,0.04,abs(normal.y))*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-postNeckFoldBand*postNeckFoldX*postNeckFoldBack*postNeckFoldGate*0.20);
  // Refined deep shadow cave darkening: the deepest concavities (areas of very low toon) receive a secondary darkening pass to push them fully dark; without this the shadow floor set by the global shadow minimum prevents the deepest anatomical shadows from reading as truly dark; axilla, inter-thigh, posterior knee, ear canal all need to go near-black; a multiplicative darkening that only fires in the lowest toon band to deepen existing shadows without affecting lit areas
  let deepCaveDark=smoothstep(0.10,0.0,toon)*(1.0-metallic)*clamp(palBright-0.12,0.0,1.0)*0.22;
  lit=lit*(1.0-deepCaveDark*0.24);
  // Scale plate ridge brightening: a thin bright line sits just at the edge of each scale ridge — the scale plate edge catches specular at a different angle than the plate face, creating the sharp micro-highlight line visible on Charizard, Aggron, and Tyranitar scale plates; purely additive micro-flash at the groove boundary
  let scaleRidgeBright=warmDom*(1.0-metallic)*smoothstep(0.28,0.52,toon)*specShadowMask;
  let sgRidgeA=smoothstep(0.86,0.90,sgWaveA*sgWaveB)*(1.0-scaleGroove);
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.86)*sgRidgeA*scaleRidgeBright*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ventral mid-line stripe: a subtle narrow vertical dark or accent line along the abdominal center; appears on Arcanine, Serperior, Gyarados, and many serpentine/quadruped Pokemon; gated to belly-facing surfaces near the body center line
  let ventralMidGate=(1.0-metallic)*smoothstep(0.12,0.28,bellyValue(normal))*smoothstep(0.36,0.58,toon)*(1.0-shadowDom);
  let ventralMidLine=smoothstep(0.04,0.0,abs(input.worldPosition.x)/(crownEyeW*0.12+0.001))*ventralMidGate*step(fv,0.60);
  lit=lit*(1.0-ventralMidLine*0.16);
  // Sternum forward-chest midline brightening: the breastbone (sternum) runs vertically down the center of the forward-facing chest, creating a slight brightness band from overhead light striking the raised bone ridge; Mewtwo, Machamp, Blaziken, Charizard all show this bright centerline on the anterior chest; defines chest anatomy on bipeds
  let sternumMidX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(input.worldPosition.x));
  let sternumZone=smoothstep(torsoY-crownEyeW*2.0,torsoY-crownEyeW*1.0,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*1.0,torsoY,input.worldPosition.y));
  let sternumMidFwd=smoothstep(0.32,0.60,normal.z)*smoothstep(0.14,-0.04,abs(normal.x))*(1.0-metallic)*organicSkin*smoothstep(0.44,0.68,toon)*specShadowMask;
  let sternumSpec=pow(max(dot(normal,halfVec),0.0),36.0)*sternumMidX*sternumZone*sternumMidFwd;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*sternumSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Abdominal muscle bands: on lean biped creatures without armor, the abdomen shows 3-4 horizontal muscle highlight bands from the rectus abdominis — Machamp, Lucario, Blaziken, Infernape abdominal definition; horizontal bright stripes across the forward-facing lower torso at regular intervals; distinct from the rib cage bands which are above the torso
  let absGate=organicSkin*smoothstep(0.28,0.06,roughness)*(1.0-metallic)*smoothstep(0.40,0.62,toon)*step(fv,0.56)*0.28;
  let absFreq=scale*2.80;
  let absWave=sin(input.worldPosition.y*absFreq+fv*1.5)*0.5+0.5;
  let absBand=smoothstep(0.76,0.90,absWave)*smoothstep(crownEyeW*0.20,crownEyeW*0.06,abs(input.worldPosition.x))*smoothstep(0.32,0.60,normal.z)*smoothstep(0.14,0.04,abs(normal.x));
  let absZone=smoothstep(torsoY-crownEyeW*2.60,torsoY-crownEyeW*1.40,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*1.40,torsoY-crownEyeW*0.60,input.worldPosition.y));
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*absBand*absZone*absGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shin bone ridge specular: the anterior shin ridge (tibia) is a hard protruding bone just under thin skin — on bipeds it catches a distinctive narrow forward specular below the knee that gives legs their angular quality (Lucario's leg ridge, Blaziken's lower leg, Mewtwo's tibia line); forward-facing lower leg at shin height
  let shinBand=smoothstep(0.10,0.0,abs(input.worldPosition.y-shinRidgeY)/(crownEyeW*0.36+0.001));
  let shinLat=smoothstep(crownEyeW*0.72,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-metallic)*organicSkin;
  let shinFwd=smoothstep(0.36,0.62,normal.z)*smoothstep(0.12,0.04,abs(normal.x))*smoothstep(0.44,0.64,toon)*specShadowMask;
  let shinSpec=pow(max(dot(normal,halfVec),0.0),64.0)*shinBand*shinLat*shinFwd;
  lit=clamp(lit+vec3<f32>(0.94,0.92,0.88)*shinSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Superior medial knee crease shadow: just above the kneecap on the medial (inner) side, the quadriceps tendon meets the femoral condyle creating a concave wedge — this concavity is always shadowed on the medial-upper knee; Lucario, Blaziken, Mewtwo all show this upper-inner-knee dark zone that frames the kneecap above; gives the knee its "bone-over-muscle" quality from the front; adds the upper shadow that pairs with the lower patellar tendon groove
  let supMedKneeGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let supMedKneeY=smoothstep(kneeY+crownEyeW*0.06,kneeY+crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.16,kneeY+crownEyeW*0.28,input.worldPosition.y));
  let supMedKneeLat=smoothstep(crownEyeW*0.56,crownEyeW*0.34,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.34,crownEyeW*0.10,abs(input.worldPosition.x)));
  let supMedKneeFace=smoothstep(0.24,0.52,abs(normal.x))*smoothstep(0.10,-0.14,normal.z)*smoothstep(0.08,0.02,abs(normal.y))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-supMedKneeY*supMedKneeLat*supMedKneeFace*supMedKneeGate*0.18);
  // Posterior deltoid-to-latissimus junction: where the deltoid muscle meets the latissimus dorsi on the posterior shoulder there is a distinct shadow crease visible from behind — the posterior shoulder boundary crease on Mewtwo, Lucario, Machamp, Blaziken back view; gives the back shoulder its "muscle group separation" quality; a shadow on the posterior-lateral upper torso at the shoulder-to-back transition at upper arm height
  let deltLatJuncGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let deltLatJuncY=smoothstep(crownEyeY-crownEyeW*0.90,crownEyeY-crownEyeW*1.14,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.14,crownEyeY-crownEyeW*1.40,input.worldPosition.y));
  let deltLatJuncLat=smoothstep(crownEyeW*0.68,crownEyeW*1.02,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.02,crownEyeW*1.32,abs(input.worldPosition.x)));
  let deltLatJuncBack=smoothstep(-0.08,-0.44,normal.z)*smoothstep(0.12,0.32,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-deltLatJuncY*deltLatJuncLat*deltLatJuncBack*deltLatJuncGate*0.18);
  // Lower jaw anterior neck crease: where the floor of the mouth meets the anterior neck below the chin, a transverse skin crease creates a shadow — this anterior throat shadow is different from the chinBand (which is under the chin) in that it runs lower on the throat and is deeper; Arcanine, Charizard, Mewtwo all show a distinct anterior neck crease at the top of the throat column that gives the throat its "tubular" quality; a shadow band below the chin and above the larynx
  let jawNeckCreaseGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let jawNeckCreaseY=scene.mouth.y-scene.mouth.w*2.30;
  let jawNeckCreaseBand=smoothstep(crownEyeW*0.10,crownEyeW*0.02,abs(input.worldPosition.y-jawNeckCreaseY)/(crownEyeW*0.18+0.001));
  let jawNeckCreaseX=smoothstep(crownEyeW*0.40,crownEyeW*0.12,abs(input.worldPosition.x));
  let jawNeckCreaseFwd=smoothstep(0.22,0.52,normal.z)*smoothstep(0.12,-0.14,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-jawNeckCreaseBand*jawNeckCreaseX*jawNeckCreaseFwd*jawNeckCreaseGate*0.18);
  // Limb-to-body contact shadow: soft AO darkening where the upper limb meets the torso — axilla (armpit) and hip insertion shadow; this contact shadow is the single biggest separator between professional Pokemon art and raw SDF shapes; upper lateral body at shoulder height receives shadow from overhanging arm mass
  let limbJunctionGate=(1.0-metallic)*smoothstep(0.08,0.24,abs(normal.x))*smoothstep(0.18,0.44,toon);
  let shoulderBand=smoothstep(0.12,0.0,abs(input.worldPosition.y-(crownEyeY-crownEyeW*0.60))/(crownEyeW*0.22+0.001));
  let hipInsertBand=smoothstep(0.10,0.0,abs(input.worldPosition.y-(crownEyeY-crownEyeW*1.20))/(crownEyeW*0.20+0.001));
  let limbJunction=(shoulderBand+hipInsertBand*0.72)*limbJunctionGate;
  lit=lit*(1.0-clamp(limbJunction,0.0,1.0)*0.18);
  // Light/Fairy element radiance emission: light-dominant creatures (Togekiss, Clefable, Sylveon, Xerneas) emit a faint self-luminous radiance from within — the body appears to glow slightly even in shadow zones; simulated as an additive emission term that lifts the shadow zone luminance toward a pale warm-white glow; gives light-type creatures their "divine light source" quality where they appear to emit rather than just reflect; also lifts the shadow floor to near-white
  let lightEmitGate=lightSheen*smoothstep(0.12,0.0,toon)*(1.0-metallic)*clamp(palBright-0.30,0.0,1.0)*0.28;
  let lightEmitColor=mix(vec3<f32>(0.94,0.92,0.80),scene.palette2.rgb*0.60+vec3<f32>(0.38,0.36,0.30),0.30);
  lit=clamp(lit+lightEmitColor*lightEmitGate*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sky dome ambient upper-face tint: the upper-facing surfaces of the head and shoulders receive a faint cool sky-blue ambient tint from the overhead sky dome — this ambient sky contribution is what gives characters a "photographed outdoors" look rather than studio void; Pikachu's head top catches a slight blue-white from above, Mewtwo's shoulders have a sky-tinted ambient zone; modeled as a faint blue-white added on upward-facing surfaces at head and shoulder height
  let skyAmbGate=(1.0-metallic)*smoothstep(0.44,0.68,toon)*clamp(palBright-0.22,0.0,1.0)*0.14;
  let skyAmbFace=smoothstep(0.44,0.70,normal.y)*smoothstep(crownEyeY+crownEyeW*0.30,crownEyeY+crownEyeW*1.60,input.worldPosition.y);
  lit=clamp(lit+vec3<f32>(0.72,0.80,0.96)*skyAmbFace*skyAmbGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper medial thigh adductor inner shadow: the very inner top of the thigh (where the adductor group meets the groin) is one of the most consistently dark surfaces on a biped — it faces inward and downward, receiving minimal direct or indirect light; Mewtwo, Lucario, Blaziken inner thigh at groin level is always very dark; gives the legs their "separate legs, not a single mass" quality when viewed from the front; a shadow on the very inner-upper thigh surface at hip height
  let upperMedThighGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.24;
  let upperMedThighY=smoothstep(kneeY+crownEyeW*1.10,kneeY+crownEyeW*1.50,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*1.50,kneeY+crownEyeW*1.90,input.worldPosition.y));
  let upperMedThighLat=smoothstep(crownEyeW*0.50,crownEyeW*0.24,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.24,crownEyeW*0.04,abs(input.worldPosition.x)));
  let upperMedThighFace=smoothstep(0.16,0.44,abs(normal.x))*smoothstep(0.10,-0.18,normal.z)*smoothstep(0.10,-0.16,normal.y)*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-upperMedThighY*upperMedThighLat*upperMedThighFace*upperMedThighGate*0.22);
  // Shadow band depth gradient: within the shadow band (toon < 0.22), the shadow isn't a uniform flat value but graduates from lighter gray near the terminator to deeper toward the darkest occlusion — this is the key difference between flat toon shading and Genshin/Pokemon Gen 8+ quality toon shading; surfaces at toon 0.0 are 14% darker than at toon 0.22; prevents the shadow band from looking like flat paint
  let shadowBandGrad=smoothstep(0.22,0.0,toon)*(1.0-metallic)*0.14;
  lit=lit*(1.0-shadowBandGrad);
  // Pattern mark edge darkening: the boundary of each color pattern mark (spots, stripes, patches) has a slightly darker edge ring — Pokemon pattern marks are not flat regions but have edge-shading that gives them a "printed on" with depth quality; this is the difference between flat texture mapping and Pokemon art quality marks; computed as a band at the pattern alpha boundary
  let patAlpha=textureSample(patternTexture,patternSampler,vec2<f32>(input.worldPosition.x*scale*0.5+0.5,input.worldPosition.y*scale*0.5+0.5)).a;
  let patEdgeDark=abs(fwidth(patAlpha))*4.0*(1.0-metallic)*smoothstep(0.28,0.52,toon)*0.22;
  lit=lit*(1.0-clamp(patEdgeDark,0.0,1.0)*0.16);
  // Posterior erector spine column highlight: the two erector spinae muscle columns run parallel to the spine down the entire back — they are the two long cylindrical ridges visible on either side of the vertebral column on the posterior back; catching overhead light as two parallel elongated bright strips; Machamp, Incineroar, Lucario back view shows these columns clearly; adds the back's most important internal anatomy landmark; two narrow back-facing highlights at ±0.20*crownEyeW from midline
  let erectorGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.48,fv)*0.20;
  let erectorY=smoothstep(crownEyeY-crownEyeW*2.20,crownEyeY-crownEyeW*1.20,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.20,crownEyeY-crownEyeW*0.60,input.worldPosition.y));
  let erector0Lat=smoothstep(crownEyeW*0.18,crownEyeW*0.06,abs(input.worldPosition.x-crownEyeW*0.22));
  let erector1Lat=smoothstep(crownEyeW*0.18,crownEyeW*0.06,abs(input.worldPosition.x+crownEyeW*0.22));
  let erectorBack=smoothstep(-0.12,-0.50,normal.z)*smoothstep(0.28,0.52,normal.y)*smoothstep(0.08,0.04,abs(normal.x));
  let erectorSpec=pow(max(dot(normal,halfVec),0.0),32.0)*max(erector0Lat,erector1Lat)*erectorY*erectorBack*erectorGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*erectorSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Eye corneal dome specular: the transparent cornea (the clear dome over the iris/pupil) is one of the highest-gloss surfaces on any character — it produces a very tight, bright, slightly offset specular that's distinct from the iris color; Mewtwo, Pikachu, Eevee, all Pokemon with eyes show this corneal dome highlight as the primary eye "gloss dot"; without it eyes look matte; this is a very bright, very tight (high power) specular sitting on top of all other eye layers
  let cornealGate=(1.0-metallic)*smoothstep(0.62,0.88,toon)*specShadowMask*0.34;
  let corneal0=smoothstep(scene.eye0.w*0.52,scene.eye0.w*0.10,length(input.worldPosition.xy-scene.eye0.xy))*eye0pre;
  let corneal1=smoothstep(scene.eye1.w*0.52,scene.eye1.w*0.10,length(input.worldPosition.xy-scene.eye1.xy))*eye1pre;
  let cornealFwd=smoothstep(0.28,0.60,normal.z)*smoothstep(0.10,0.04,abs(normal.x));
  let cornealSpec=pow(max(dot(normal,halfVec),0.0),180.0)*max(corneal0,corneal1)*cornealFwd*cornealGate;
  lit=clamp(lit+vec3<f32>(1.0,1.0,1.0)*cornealSpec*0.60,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur/hair micro-sheen at silhouette: furry creatures (Eevee, Arcanine, Vulpix, Ninetales, Jolteon) have individual hair fibers at their silhouette that catch backlight as a fine bright fringe — the classic "fur halo" or "hair rim light" quality; modeled as a very bright specular lobe at the fresnel rim zone gated on organic+rough surfaces; gives creature edges a fluffy/hairy softness that hard-surface creatures lack; the single most powerful indicator of fur material
  let furMicroSheen=organicSkin*smoothstep(0.44,0.68,roughness)*(1.0-metallic)*smoothstep(0.70,0.88,fresnel)*smoothstep(0.36,0.58,toon)*0.26;
  let furSheenColor=mix(vec3<f32>(0.94,0.88,0.78),scene.palette2.rgb*0.50+vec3<f32>(0.48,0.44,0.40),clamp(palBright-0.22,0.0,1.0));
  lit=clamp(lit+furSheenColor*furMicroSheen*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow floor guarantee: ensures the darkest shadows are never pure black but always carry a faint element-tinted minimum — official Pokemon art never uses pure black in the shadow zone; even the deepest shadow has a colored ambient floor (Gengar's shadows are purple-dark, Charizard's are dark-amber, Vaporeon's are dark-blue); gives every creature a characteristic dark color identity
  let shadowFloor=clamp(scene.palette0.rgb*0.06+vec3<f32>(0.02,0.02,0.03),vec3<f32>(0.0),vec3<f32>(0.08));
  lit=max(lit,shadowFloor*(1.0-metallic));
  // Ambient edge vignette: very slight darkening toward the periphery of the view frustum — simulates weak environment occlusion at extreme screen edges; keeps creature from looking completely isolated in void; subtle studio box ambience
  let edgeFresnel=fresnel*fresnel*0.04;
  lit=clamp(lit*(1.0-edgeFresnel*smoothstep(0.90,1.0,fresnel)*0.08),vec3<f32>(0.0),vec3<f32>(1.0));
  // Sub-clavicular skin SSS warmth: the skin just below the clavicle and above the pectoral is thin — it transmits a warm SSS glow from blood vessels near the surface; on Gardevoir, Sylveon, Espeon, Mewtwo this region has a slightly warmer, redder tone than the surrounding areas; the sub-clavicular zone between the collarbone and upper pec catches SSS from backlit sources; adds the "living skin" quality that differentiates high-quality character shading
  let subClavSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.28,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.20;
  let subClavY=smoothstep(crownEyeY-crownEyeW*0.36,crownEyeY-crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.18,crownEyeY-crownEyeW*0.04,input.worldPosition.y));
  let subClavX=smoothstep(crownEyeW*0.48,crownEyeW*0.18,abs(input.worldPosition.x));
  let subClavFace=smoothstep(0.28,0.56,normal.z)*smoothstep(0.10,-0.12,abs(normal.y))*smoothstep(0.08,0.02,abs(normal.x));
  let subClavSSS=max(0.0,-dot(normal,lightDir))*subClavY*subClavX*subClavFace*subClavSSSGate;
  lit=clamp(lit+vec3<f32>(0.68,0.24,0.16)*subClavSSS*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral ankle posterior fibula ridge: the fibula bone runs down the outer side of the lower leg and its distal end creates the lateral malleolus — just above the malleolus the fibula shaft creates a narrow ridge along the posterior-outer lower leg; Blaziken, Mewtwo, Lucario show this lateral-posterior lower-leg ridge as a subtle bright line; adds bone structure definition on the outer lower leg; complements the anterior shin crest
  let fibulaRidgeGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.18;
  let fibulaRidgeY=smoothstep(crownEyeW*0.40,crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.22,crownEyeW*0.06,input.worldPosition.y));
  let fibulaRidgeLat=smoothstep(crownEyeW*0.80,crownEyeW*1.12,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.12,crownEyeW*1.36,abs(input.worldPosition.x)));
  let fibulaRidgeMidX=smoothstep(crownEyeW*0.10,crownEyeW*0.04,abs(abs(input.worldPosition.x)-crownEyeW*0.96));
  let fibulaRidgeBack=smoothstep(-0.10,-0.44,normal.z)*smoothstep(0.28,0.52,normal.y)*smoothstep(0.28,0.44,abs(normal.x));
  let fibulaRidgeSpec=pow(max(dot(normal,halfVec),0.0),48.0)*fibulaRidgeY*fibulaRidgeLat*fibulaRidgeMidX*fibulaRidgeBack*fibulaRidgeGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*fibulaRidgeSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Temporal muscle lateral head shadow: the temporalis muscle fills the temporal fossa (the depression above and behind the zygomatic arch on the lateral skull) and creates a slight shadow on the side of the head — on Mewtwo, Gardevoir, Lucario, and large-headed biped creatures the temple region is darker than the forehead; gives the skull its "narrowing temporal zone" quality that makes heads look sculpted rather than spherical; a shadow on the lateral head surface above the zygomatic arch
  let temporalMusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let temporalMusY=smoothstep(crownEyeY+crownEyeW*0.36,crownEyeY+crownEyeW*0.72,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.72,crownEyeY+crownEyeW*1.10,input.worldPosition.y));
  let temporalMusLat=smoothstep(crownEyeW*0.60,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.20,abs(input.worldPosition.x)));
  let temporalMusFace=smoothstep(0.40,0.68,abs(normal.x))*smoothstep(0.14,-0.06,abs(normal.z))*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-temporalMusY*temporalMusLat*temporalMusFace*temporalMusGate*0.16);
  // Dorsal neck ligamentum nuchae ridge: the ligamentum nuchae is a tough midline ligament running from the occiput down the posterior neck to C7 — it creates a narrow raised ridge at the exact midline of the posterior neck that catches posterior-up specular; Mewtwo, Lucario, Charizard, all have this posterior neck midline ridge that gives the back of the neck its "defined spine" quality; a narrow central line on the posterior neck between skull base and shoulder
  let nuchaeRidgeGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.44,fv)*0.18;
  let nuchaeRidgeY=smoothstep(crownEyeY-crownEyeW*1.06,crownEyeY-crownEyeW*0.68,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.68,crownEyeY-crownEyeW*0.38,input.worldPosition.y));
  let nuchaeRidgeX=smoothstep(crownEyeW*0.10,crownEyeW*0.03,abs(input.worldPosition.x));
  let nuchaeRidgeBack=smoothstep(-0.14,-0.54,normal.z)*smoothstep(0.42,0.66,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  let nuchaeRidgeSpec=pow(max(dot(normal,halfVec),0.0),52.0)*nuchaeRidgeY*nuchaeRidgeX*nuchaeRidgeBack*nuchaeRidgeGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*nuchaeRidgeSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior iliac crest back-hip prominence: the iliac crest is the top rim of the pelvis — its posterior edge creates a small bony prominence at the lower back above each buttock; this is the "dimples of Venus" region that catches posterior-up specular on each side; Mewtwo, Blaziken, Gardevoir back view shows these two symmetrical posterior hip prominences that define the lower back anatomy; a small spec on each posterior-lateral lower back at the lumbosacral junction
  let postIliacGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.20;
  let postIliacY=smoothstep(crownEyeY-crownEyeW*2.18,crownEyeY-crownEyeW*2.00,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*2.00,crownEyeY-crownEyeW*1.84,input.worldPosition.y));
  let postIliacLat=smoothstep(crownEyeW*0.32,crownEyeW*0.52,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.74,abs(input.worldPosition.x)));
  let postIliacBack=smoothstep(-0.12,-0.50,normal.z)*smoothstep(0.32,0.56,normal.y)*smoothstep(0.16,0.30,abs(normal.x));
  let postIliacSpec=pow(max(dot(normal,halfVec),0.0),52.0)*postIliacY*postIliacLat*postIliacBack*postIliacGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*postIliacSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris micro-speckle texture: the iris is not uniformly colored but has a radial micro-speckle pattern visible at close range — individual melanin granules create a random-dot texture within the iris zone; this is the "detailed eye" quality distinguishing Gen 5+ Pokemon art from Gen 1-2; modeled as a low-frequency hash noise tinting the iris zone slightly; gated to organic eyes only; creates the iris "depth texture" visual
  let irisSpeckleGate=(1.0-metallic)*smoothstep(0.62,0.88,toon)*0.18;
  let irisSpeckleCell0=floor(input.worldPosition.xy*scale*28.0);
  let irisSpeckleH=fract(sin(dot(irisSpeckleCell0,vec2<f32>(127.1,311.7)))*43758.5)*2.0-1.0;
  let irisSpeckle0=irisSpeckleH*smoothstep(scene.eye0.w*0.10,scene.eye0.w*0.40,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.40,scene.eye0.w*0.52,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let irisSpeckle1=irisSpeckleH*smoothstep(scene.eye1.w*0.10,scene.eye1.w*0.40,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.40,scene.eye1.w*0.52,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let irisSpeckleFwd=smoothstep(0.24,0.54,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  lit=clamp(lit+scene.palette1.rgb*max(irisSpeckle0,irisSpeckle1)*irisSpeckleFwd*irisSpeckleGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));

  // Saturation boost: vivid elements (Fire/Electric/Plant/Light) get +38%, muted get +12%
  let litLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  let satBoost=mix(1.14,1.46,clamp((palBright-0.28)/0.50,0.0,1.0));
  let litSat=clamp(mix(vec3<f32>(litLuma),lit,satBoost),vec3<f32>(0.0),vec3<f32>(1.0));
  // Occiput posterior skull prominence: the occiput (back of skull) has a distinct posterior bulge at the inion — the external occipital protuberance; it creates a rounded posterior-facing highlight at the base of the skull; on Mewtwo, Gardevoir, Espeon the back of the skull shows this dome shape from behind; gives the skull its "round back" quality and shows it projects behind the neck column; a specular at the posterior lower skull at earTopY height on the back
  let occipProminGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.20;
  let occipProminY=smoothstep(crownEyeY+crownEyeW*0.80,crownEyeY+crownEyeW*1.06,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*1.06,crownEyeY+crownEyeW*1.32,input.worldPosition.y));
  let occipProminX=smoothstep(crownEyeW*0.24,crownEyeW*0.06,abs(input.worldPosition.x));
  let occipProminBack=smoothstep(-0.16,-0.58,normal.z)*smoothstep(0.20,0.44,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  let occipProminSpec=pow(max(dot(normal,halfVec),0.0),36.0)*occipProminY*occipProminX*occipProminBack*occipProminGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*occipProminSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Finger/toe flexor crease dark lines at knuckle undersides: the ventral (palm-side) surface of each finger has a flexor crease at each knuckle that creates a permanent dark line — visible on Lucario, Machamp, Incineroar, Scizor paw undersides and gives the impression of articulated digits; modeled as a shadow pattern at the ventral knuckle positions across the ventral paw width
  let fingerCreaseGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.20;
  let fingerCreaseY=smoothstep(wristY-crownEyeW*0.28,wristY-crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.20,wristY-crownEyeW*0.14,input.worldPosition.y));
  let fingerCreaseLat=smoothstep(crownEyeW*0.68,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-metallic);
  let fingerCreaseWave=abs(sin(abs(input.worldPosition.x)/crownEyeW*3.14159));
  let fingerCreaseLine=smoothstep(0.86,0.94,fingerCreaseWave);
  let fingerCreaseFace=smoothstep(-0.22,-0.54,normal.y)*smoothstep(0.10,0.02,abs(normal.z))*smoothstep(0.10,0.24,abs(normal.x));
  lit=lit*(1.0-fingerCreaseLine*fingerCreaseY*fingerCreaseLat*fingerCreaseFace*fingerCreaseGate*0.18);
  // Anterior sternal midline highlight: the sternum (breastbone) runs vertically down the center of the chest and its forward-facing surface catches a narrow central specular from the key light — the central midline of the chest is the brightest narrow strip between the two pectoral masses; Machamp, Mewtwo, Blaziken, Conkeldurr all show this sternal midline highlight that establishes the chest's central symmetry plane; a narrow central forward-facing strip between the pectoral zones
  let sternalHLGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let sternalHLY=smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.50,input.worldPosition.y));
  let sternalHLX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(input.worldPosition.x));
  let sternalHLFace=smoothstep(0.36,0.64,normal.z)*smoothstep(0.10,0.04,abs(normal.x))*smoothstep(0.10,-0.10,abs(normal.y));
  let sternalHLSpec=pow(max(dot(normal,halfVec),0.0),28.0)*sternalHLY*sternalHLX*sternalHLFace*sternalHLGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*sternalHLSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inguinal crease inner hip fold: diagonal fold shadow from ASIS to pubic region — visible on muscular lean characters like Lucario, Machoke; creates a visible anatomical boundary between torso and upper thigh
  let inguinalGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let inguinalY=smoothstep(crownEyeY-crownEyeW*1.98,crownEyeY-crownEyeW*1.74,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.74,crownEyeY-crownEyeW*1.50,input.worldPosition.y));
  let inguinalLat=smoothstep(crownEyeW*0.36,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*1.08,abs(input.worldPosition.x)));
  let inguinalFwd=smoothstep(0.30,0.60,normal.z)*smoothstep(0.12,-0.16,normal.y)*smoothstep(0.10,0.28,abs(normal.x));
  lit=lit*(1.0-inguinalY*inguinalLat*inguinalFwd*inguinalGate*0.20);
  // Gluteal posterior hip rounding: gluteus maximus creates rounded posterior hip highlight from behind — Lucario, Machoke, Kommo-o all show this rounded posterior silhouette; adds a warm bounce on the largest posterior muscle mass
  let gluteHLGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let gluteHLY=smoothstep(crownEyeY-crownEyeW*2.10,crownEyeY-crownEyeW*1.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.80,crownEyeY-crownEyeW*1.50,input.worldPosition.y));
  let gluteHLLat=smoothstep(crownEyeW*0.50,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.24,abs(input.worldPosition.x)));
  let gluteHLBack=smoothstep(-0.18,-0.58,normal.z)*smoothstep(0.22,0.50,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  let gluteHLSpec=pow(max(dot(normal,halfVec),0.0),18.0)*gluteHLY*gluteHLLat*gluteHLBack*gluteHLGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*gluteHLSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Clavicle collarbone ridge specular: the clavicle runs from the sternal notch to each shoulder point creating a slight ridge/highlight at the upper chest-shoulder junction — visible on Lucario, Gardevoir, Mewtwo; the S-curve bone catches key light and produces a narrow elongated specular running laterally at the base of the neck
  let clavicleGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let clavicleY=smoothstep(crownEyeY-crownEyeW*0.68,crownEyeY-crownEyeW*0.52,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.52,crownEyeY-crownEyeW*0.38,input.worldPosition.y));
  let clavicleLat=smoothstep(crownEyeW*0.18,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.60,crownEyeW*0.90,abs(input.worldPosition.x)));
  let clavicleFace=smoothstep(0.36,0.64,normal.y)*smoothstep(0.20,0.42,normal.z)*smoothstep(0.10,0.04,abs(normal.x));
  let clavicleSpec=pow(max(dot(normal,halfVec),0.0),44.0)*clavicleY*clavicleLat*clavicleFace*clavicleGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*clavicleSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Deltoid anterior shoulder cap highlight: the anterior deltoid facet catches the key light at the front-outer shoulder; visible on Lucario, Machoke, Hawlucha — creates the characteristic "capped" shoulder look separating it from the upper arm cylinder and torso; narrow oval specular at the front-lateral shoulder junction
  let deltoidAntGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.24;
  let deltoidAntY=smoothstep(crownEyeY-crownEyeW*0.56,crownEyeY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.36,crownEyeY-crownEyeW*0.18,input.worldPosition.y));
  let deltoidAntLat=smoothstep(crownEyeW*0.78,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.34,abs(input.worldPosition.x)));
  let deltoidAntFace=smoothstep(0.38,0.66,normal.y)*smoothstep(0.20,0.42,normal.z)*smoothstep(0.26,0.48,abs(normal.x));
  let deltoidAntSpec=pow(max(dot(normal,halfVec),0.0),32.0)*deltoidAntY*deltoidAntLat*deltoidAntFace*deltoidAntGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*deltoidAntSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lumbar erector spinae shadow: the erector spinae muscle columns run parallel to the spine on either side creating a central groove/shadow on the lower back — visible on Lucario's back in 3/4 rear view; gives the lower back its characteristic split-column look
  let lumbarShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let lumbarShadY=smoothstep(crownEyeY-crownEyeW*2.00,crownEyeY-crownEyeW*1.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY-crownEyeW*1.22,input.worldPosition.y));
  let lumbarShadX=smoothstep(crownEyeW*0.24,crownEyeW*0.06,abs(input.worldPosition.x));
  let lumbarShadBack=smoothstep(-0.20,-0.56,normal.z)*smoothstep(0.20,0.44,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-lumbarShadY*lumbarShadX*lumbarShadBack*lumbarShadGate*0.22);
  // Nasal bridge dorsum specular: the dorsal surface of the nose/muzzle bridge creates a narrow elongated specular running down the midline — present on Pokemon faces with protruding muzzles (Arcanine, Incineroar, Lycanroc); narrows toward the tip; creates the characteristic "nose shine" that makes faces feel three-dimensional from front-on
  let nasalBridgeGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let nasalBridgeY=smoothstep(scene.mouth.y+scene.mouth.w*0.80,scene.mouth.y+scene.mouth.w*1.60,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.60,scene.mouth.y+scene.mouth.w*2.40,input.worldPosition.y));
  let nasalBridgeX=smoothstep(scene.mouth.w*0.18,scene.mouth.w*0.04,abs(input.worldPosition.x));
  let nasalBridgeFace=smoothstep(0.52,0.78,normal.y)*smoothstep(0.16,0.38,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  let nasalBridgeSpec=pow(max(dot(normal,halfVec),0.0),52.0)*nasalBridgeY*nasalBridgeX*nasalBridgeFace*nasalBridgeGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*nasalBridgeSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Temporal fossa lateral skull shadow: the temporal fossa is a concavity on the side of the skull above the zygomatic arch — creates a shadow pocket on the side of the head that gives the skull its width-narrowing quality above the cheekbones; visible on Mewtwo, Gardevoir, Espeon; the side of the head transitions from cheek roundness to a slight flattening toward the parietal bone
  let tempFossaGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let tempFossaY=smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.50,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.50,crownEyeY+crownEyeW*0.96,input.worldPosition.y));
  let tempFossaLat=smoothstep(crownEyeW*0.56,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.04,abs(input.worldPosition.x)));
  let tempFossaSide=smoothstep(0.44,0.70,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.14,0.28,normal.y);
  lit=lit*(1.0-tempFossaY*tempFossaLat*tempFossaSide*tempFossaGate*0.22);
  // Iliopsoas hip flexor crease: the hip flexor attaches at the anterior pelvis creating a subtle diagonal V-crease from the inner groin pointing up and outward — separates upper thigh from lower abdomen; gives the lower torso-pelvis region that anatomical definition seen on Machoke, Incineroar, Lucario from the front
  let iliopsoasGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.45,fv)*0.18;
  let iliopsoasY=smoothstep(crownEyeY-crownEyeW*2.08,crownEyeY-crownEyeW*1.86,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.86,crownEyeY-crownEyeW*1.66,input.worldPosition.y));
  let iliopsoasLat=smoothstep(crownEyeW*0.18,crownEyeW*0.52,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.78,abs(input.worldPosition.x)));
  let iliopsoasFwd=smoothstep(0.30,0.58,normal.z)*smoothstep(0.04,-0.20,normal.y)*smoothstep(0.12,0.28,abs(normal.x));
  lit=lit*(1.0-iliopsoasY*iliopsoasLat*iliopsoasFwd*iliopsoasGate*0.20);
  // Posterior neck nuchal ligament shadow: the nuchal ligament runs down the posterior midline of the neck creating a central groove and shadow from skull base to upper thoracic spine — gives the back of the neck its characteristic posterior-midline crease; visible on Gardevoir, Mewtwo, Espeon in 3/4 rear view; the groove catches shadow between the bilateral neck muscles
  let nuchalShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let nuchalShadY=smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.40,input.worldPosition.y));
  let nuchalShadX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(input.worldPosition.x));
  let nuchalShadBack=smoothstep(-0.20,-0.60,normal.z)*smoothstep(0.14,0.40,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-nuchalShadY*nuchalShadX*nuchalShadBack*nuchalShadGate*0.22);
  // Supraorbital brow ridge undercut shadow: the supraorbital rim protrudes beyond the eyeball, casting a shadow down onto the eye from above — this is a critical depth cue that makes eyes look recessed into the skull rather than sitting on the surface; present on all well-modeled creature faces including Mewtwo, Lucario, Incineroar; the shadow falls on the upper iris at the 12 o'clock position
  let supraOrbShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.30;
  let supraOrb0Y=smoothstep(scene.eye0.w*0.10,scene.eye0.w*0.04,abs(input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.30)))*smoothstep(scene.eye0.w*0.68,scene.eye0.w*0.22,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let supraOrb1Y=smoothstep(scene.eye1.w*0.10,scene.eye1.w*0.04,abs(input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.30)))*smoothstep(scene.eye1.w*0.68,scene.eye1.w*0.22,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let supraOrbFace=smoothstep(0.28,0.56,normal.z)*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-max(supraOrb0Y,supraOrb1Y)*supraOrbFace*supraOrbShadGate*0.28);
  // Lateral deltoid-tricep seam shadow: the posterior deltoid meets the long head of tricep creating an intermuscular groove running down the lateral-posterior upper arm — creates a crease-shadow that separates the round deltoid cap from the upper arm cylinder; gives arms that muscle-definition look; visible on Machamp, Lucario, Hawlucha rear-lateral views
  let deltTricepGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.42,fv)*0.18;
  let deltTricepY=smoothstep(elbowY+crownEyeW*0.90,elbowY+crownEyeW*1.30,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*1.30,crownEyeY-crownEyeW*0.26,input.worldPosition.y));
  let deltTricepLat=smoothstep(crownEyeW*0.80,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.10,crownEyeW*1.36,abs(input.worldPosition.x)));
  let deltTricepBack=smoothstep(0.06,-0.30,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.38,0.62,abs(normal.x));
  lit=lit*(1.0-deltTricepY*deltTricepLat*deltTricepBack*deltTricepGate*0.20);
  // Plantar arch underfoot shadow: the arch of the foot creates a concave underside shadow between heel and ball — animals and bipedal creatures with feet show this in grounded poses; gives the foot a sense of structure and contact with the ground plane; the arch region of the sole is recessed and catches self-shadow
  let plantarArchGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let plantarArchY=smoothstep(crownEyeW*0.44,crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.14,input.worldPosition.y));
  let plantarArchLat=smoothstep(crownEyeW*0.58,crownEyeW*0.88,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.88,crownEyeW*1.14,abs(input.worldPosition.x)));
  let plantarArchDown=smoothstep(-0.36,-0.68,normal.y)*smoothstep(0.12,0.04,abs(normal.z))*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-plantarArchY*plantarArchLat*plantarArchDown*plantarArchGate*0.22);
  // Lateral pectoral-deltoid groove shadow: where the pectoralis major meets the anterior deltoid there is a vertical groove/shadow — the deltopectoral groove — running from the clavicle toward the armpit; this crease separates the chest from the shoulder and gives the front torso its anatomical definition; present on Machoke, Lucario, Incineroar from the front-lateral view
  let deltPecGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.42,fv)*0.18;
  let deltPecGrooveY=smoothstep(crownEyeY-crownEyeW*0.90,crownEyeY-crownEyeW*0.54,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.54,crownEyeY-crownEyeW*0.24,input.worldPosition.y));
  let deltPecGrooveLat=smoothstep(crownEyeW*0.62,crownEyeW*0.82,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.82,crownEyeW*0.96,abs(input.worldPosition.x)));
  let deltPecGrooveFwd=smoothstep(0.30,0.58,normal.z)*smoothstep(0.14,0.34,normal.y)*smoothstep(0.24,0.46,abs(normal.x));
  lit=lit*(1.0-deltPecGrooveY*deltPecGrooveLat*deltPecGrooveFwd*deltPecGrooveGate*0.22);
  // Posterior calcaneal fat pad shadow: the heel fat pad on the bottom-posterior foot creates a rounded shadow pocket where the Achilles tendon meets the heel bone — gives the heel structure; the underside of the heel projects backward and casts a small shadow on itself from below-behind; critical for grounded poses
  let calcFatPadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let calcFatPadY=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y))*(1.0-metallic);
  let calcFatPadLat=smoothstep(crownEyeW*0.64,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.12,abs(input.worldPosition.x)));
  let calcFatPadBack=smoothstep(-0.28,-0.66,normal.z)*smoothstep(-0.32,-0.60,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-calcFatPadY*calcFatPadLat*calcFatPadBack*calcFatPadGate*0.20);
  // Zygomatic cheekbone catch light: the malar eminence (cheekbone prominence) catches key light at a steep diagonal — this is the highest lateral point on the face and gets a bright catch light that anchors the face width visually; Pikachu, Eevee, Gardevoir all show this cheekbone highlight; placed at eye-width lateral and just below eye level on the forward-lateral face surface
  let zygomaticGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.24;
  let zygomatic0Pos=vec2<f32>(scene.eye0.x+scene.eye0.w*1.10,scene.eye0.y-scene.eye0.w*0.60);
  let zygomatic1Pos=vec2<f32>(scene.eye1.x-scene.eye1.w*1.10,scene.eye1.y-scene.eye1.w*0.60);
  let zygomatic0=smoothstep(crownEyeW*0.12,crownEyeW*0.04,length(input.worldPosition.xy-zygomatic0Pos))*eye0pre;
  let zygomatic1=smoothstep(crownEyeW*0.12,crownEyeW*0.04,length(input.worldPosition.xy-zygomatic1Pos))*eye1pre;
  let zygomaticFace=smoothstep(0.36,0.62,normal.z)*smoothstep(0.16,0.36,normal.y)*smoothstep(0.26,0.48,abs(normal.x));
  let zygomaticSpec=pow(max(dot(normal,halfVec),0.0),48.0)*max(zygomatic0,zygomatic1)*zygomaticFace*zygomaticGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*zygomaticSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior tibialis muscle shadow: the tibialis anterior runs along the lateral shin just lateral to the crest, creating a slight shadow on the medial side of the shin — gives the lower leg its characteristic anterior groove that separates the tibial crest from the muscle belly; visible on bipedal Pokemon in profile
  let tibialMusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.40,fv)*0.16;
  let tibialMusY=smoothstep(kneeY-crownEyeW*0.20,kneeY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.60,kneeY-crownEyeW*1.20,input.worldPosition.y));
  let tibialMusLat=smoothstep(crownEyeW*0.46,crownEyeW*0.68,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.68,crownEyeW*0.84,abs(input.worldPosition.x)));
  let tibialMusFace=smoothstep(0.26,0.54,normal.z)*smoothstep(0.10,-0.12,normal.y)*smoothstep(0.30,0.54,abs(normal.x));
  lit=lit*(1.0-tibialMusY*tibialMusLat*tibialMusFace*tibialMusGate*0.20);
  // Posterior elbow cubital fossa shadow: the back of the elbow has a triangular fossa between the medial and lateral epicondyles — creates a shadow pocket at the posterior elbow point; Lucario, Machoke arm geometry from behind shows this hollow; gives the elbow its characteristic "point" quality rather than a uniformly round surface
  let cubFossaGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let cubFossaY=smoothstep(elbowY-crownEyeW*0.14,elbowY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.04,elbowY+crownEyeW*0.12,input.worldPosition.y));
  let cubFossaLat=smoothstep(crownEyeW*1.10,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*0.54,abs(input.worldPosition.x)));
  let cubFossaBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.08,-0.14,abs(normal.y))*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-cubFossaY*cubFossaLat*cubFossaBack*cubFossaGate*0.22);
  // Infraorbital hollow shadow: the region directly below the cheekbone and above the upper jaw has a slight concave shadow — the infraorbital hollow is present on most realistic creature faces and creates the visual separation between the eye socket's lower rim and the cheek mass; gives faces more aged/structured appearance; Pokemon like Mewtwo and Incineroar show this hollow
  let infraOrbHolGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let infraOrbHol0Y=smoothstep(scene.eye0.w*0.24,scene.eye0.w*0.06,abs(input.worldPosition.y-(scene.eye0.y-scene.eye0.w*0.90)))*smoothstep(scene.eye0.w*0.90,scene.eye0.w*0.30,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let infraOrbHol1Y=smoothstep(scene.eye1.w*0.24,scene.eye1.w*0.06,abs(input.worldPosition.y-(scene.eye1.y-scene.eye1.w*0.90)))*smoothstep(scene.eye1.w*0.90,scene.eye1.w*0.30,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let infraOrbHolFace=smoothstep(0.24,0.52,normal.z)*smoothstep(0.10,-0.20,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  lit=lit*(1.0-max(infraOrbHol0Y,infraOrbHol1Y)*infraOrbHolFace*infraOrbHolGate*0.22);
  // Inner wrist radial tendon specular: two tendons (flexor carpi radialis and palmaris longus) are visible on the inner wrist as raised ridges that catch highlight — the characteristic "wrist tendon" detail seen on Lucario's wrists; creates a narrow parallel double-ridge highlight at the wrist crease on the palmar side
  let wristTendGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.20;
  let wristTendY=smoothstep(wristY+crownEyeW*0.08,wristY+crownEyeW*0.02,input.worldPosition.y)*(1.0-smoothstep(wristY+crownEyeW*0.02,wristY-crownEyeW*0.08,input.worldPosition.y));
  let wristTendLat=smoothstep(crownEyeW*0.76,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-metallic);
  let wristTendPhase=abs(fract(abs(input.worldPosition.x)/crownEyeW*8.0+0.18)-0.50)*2.0;
  let wristTendRidge=smoothstep(0.76,0.94,wristTendPhase);
  let wristTendFace=smoothstep(0.28,0.54,normal.z)*smoothstep(-0.04,-0.24,normal.y)*smoothstep(0.10,0.02,abs(normal.x));
  let wristTendSpec=pow(max(dot(normal,halfVec),0.0),60.0)*wristTendRidge*wristTendY*wristTendLat*wristTendFace*wristTendGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*wristTendSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior femoral biceps femoris shadow: the biceps femoris (hamstring) creates a central groove on the posterior thigh between the lateral and medial heads — visible from behind on muscular bipeds; the groove runs from the gluteal fold toward the popliteal fossa at the back of the knee; gives the thigh its characteristic posterior split-column look
  let bicepsFemGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let bicepsFemY=smoothstep(kneeY+crownEyeW*0.14,kneeY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.60,kneeY+crownEyeW*1.40,input.worldPosition.y));
  let bicepsFemX=smoothstep(crownEyeW*0.20,crownEyeW*0.06,abs(input.worldPosition.x));
  let bicepsFemBack=smoothstep(-0.22,-0.58,normal.z)*smoothstep(0.08,-0.10,abs(normal.y))*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-bicepsFemY*bicepsFemX*bicepsFemBack*bicepsFemGate*0.20);
  // Lateral nasal alar highlight: the lateral edges of the nose/snout flare slightly outward creating a small rounded highlight on the lateral-lower muzzle surface — the "nostril wing" catchlight; on Pokemon with snouts like Arcanine, Lycanroc, Charizard this is a key detail that makes the nose feel three-dimensional; a small bright oval on either side of the muzzle tip
  let nasalAlarGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let nasalAlar0Pos=vec2<f32>(scene.mouth.w*0.72,scene.mouth.y+scene.mouth.w*0.40);
  let nasalAlar1Pos=vec2<f32>(-scene.mouth.w*0.72,scene.mouth.y+scene.mouth.w*0.40);
  let nasalAlar0=smoothstep(crownEyeW*0.10,crownEyeW*0.03,length(input.worldPosition.xy-nasalAlar0Pos));
  let nasalAlar1=smoothstep(crownEyeW*0.10,crownEyeW*0.03,length(input.worldPosition.xy-nasalAlar1Pos));
  let nasalAlarFace=smoothstep(0.36,0.62,normal.z)*smoothstep(0.14,0.34,normal.y)*smoothstep(0.26,0.48,abs(normal.x));
  let nasalAlarSpec=pow(max(dot(normal,halfVec),0.0),44.0)*max(nasalAlar0,nasalAlar1)*nasalAlarFace*nasalAlarGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*nasalAlarSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Carpal bone dorsal wrist angular highlight: the prominent carpal bones on the dorsal wrist create angular highlight facets — the lunate and capitate bones are visible as small angled plateaus when the wrist is extended; gives wrists that structural-bone quality visible on Lucario's distinctive wrist spikes and Blaziken's hand anatomy
  let carpalBoneGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.20;
  let carpalBoneY=smoothstep(wristY+crownEyeW*0.12,wristY+crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(wristY+crownEyeW*0.04,wristY-crownEyeW*0.10,input.worldPosition.y));
  let carpalBoneLat=smoothstep(crownEyeW*0.80,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-metallic);
  let carpalBoneFace=smoothstep(0.40,0.68,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.x));
  let carpalBoneSpec=pow(max(dot(normal,halfVec),0.0),72.0)*carpalBoneY*carpalBoneLat*carpalBoneFace*carpalBoneGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*carpalBoneSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fibula head lateral knee protrusion: the fibular head (top of the fibula) creates a small bony prominence on the lateral-posterior knee that catches highlight — visible on lean-legged bipedal Pokemon from the side/rear; adds the secondary protrusion at the lateral knee that sits just below and behind the main knee cap
  let fibulaHeadGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.48,fv)*0.20;
  let fibulaHeadY=smoothstep(kneeY-crownEyeW*0.12,kneeY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.04,kneeY+crownEyeW*0.08,input.worldPosition.y));
  let fibulaHeadLat=smoothstep(crownEyeW*0.74,crownEyeW*1.00,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.00,crownEyeW*1.22,abs(input.worldPosition.x)));
  let fibulaHeadSide=smoothstep(0.46,0.72,abs(normal.x))*smoothstep(0.08,-0.16,normal.z)*smoothstep(0.12,0.28,normal.y);
  let fibulaHeadSpec=pow(max(dot(normal,halfVec),0.0),64.0)*fibulaHeadY*fibulaHeadLat*fibulaHeadSide*fibulaHeadGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*fibulaHeadSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial epicondyle inner elbow shadow: the medial epicondyle protrusion on the inner elbow creates a shadow on its underside — gives the elbow crease region that anatomical detail showing bone structure through the skin; adds the characteristic shadow notch at the medial elbow crease between the forearm flexor mass and the arm
  let medEpicondGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.40,fv)*0.18;
  let medEpicondY=smoothstep(elbowY-crownEyeW*0.14,elbowY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.04,elbowY+crownEyeW*0.12,input.worldPosition.y));
  let medEpicondLat=smoothstep(crownEyeW*0.96,crownEyeW*0.68,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.68,crownEyeW*0.44,abs(input.worldPosition.x)));
  let medEpicondSide=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(0.12,-0.16,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.14,0.28,normal.y);
  lit=lit*(1.0-medEpicondY*medEpicondLat*medEpicondSide*medEpicondGate*0.20);
  // Anterior superior iliac spine (ASIS) shadow undercut: the ASIS bone point casts a shadow on the upper-anterior thigh just below it — the hard bone protuberance creates a small shadow notch on the lateral-front hip; visible on lean muscular characters like Lucario from the front-lateral; the shadow is the complement to the ASIS highlight above
  let asisUnderGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let asisUnderY=smoothstep(crownEyeY-crownEyeW*1.96,crownEyeY-crownEyeW*1.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.80,crownEyeY-crownEyeW*1.66,input.worldPosition.y));
  let asisUnderLat=smoothstep(crownEyeW*0.80,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.10,crownEyeW*1.34,abs(input.worldPosition.x)));
  let asisUnderFwd=smoothstep(0.30,0.58,normal.z)*smoothstep(0.04,-0.20,normal.y)*smoothstep(0.14,0.30,abs(normal.x));
  lit=lit*(1.0-asisUnderY*asisUnderLat*asisUnderFwd*asisUnderGate*0.22);
  // Posterior ankle retrocalcaneal shadow: the retrocalcaneal bursa/Achilles insertion creates a shadow in the posterior groove between the Achilles tendon and the calcaneal tuberosity — gives the ankle-heel transition its characteristic "notch" above the heel pad; visible on Charizard, Blaziken, and other digitigrade/plantigrade legged Pokemon
  let retroCalcGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let retroCalcY=smoothstep(crownEyeW*0.34,crownEyeW*0.26,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.26,crownEyeW*0.18,input.worldPosition.y));
  let retroCalcLat=smoothstep(crownEyeW*0.66,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.10,abs(input.worldPosition.x)));
  let retroCalcBack=smoothstep(-0.22,-0.60,normal.z)*smoothstep(0.28,0.52,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-retroCalcY*retroCalcLat*retroCalcBack*retroCalcGate*0.22);
  // Lateral epicondyle outer elbow specular: the lateral epicondyle of the humerus is the bony lateral elbow protrusion that catches light from the side/front — gives the outer elbow its angular bony quality; when lit from a 3/4 angle this prominent bone creates a bright catch light; visible on Lucario and muscular-arm characters
  let latEpicondGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.22;
  let latEpicondY=smoothstep(elbowY-crownEyeW*0.12,elbowY-crownEyeW*0.02,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.02,elbowY+crownEyeW*0.14,input.worldPosition.y));
  let latEpicondLat=smoothstep(crownEyeW*0.86,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.16,crownEyeW*1.38,abs(input.worldPosition.x)));
  let latEpicondFace=smoothstep(0.40,0.66,abs(normal.x))*smoothstep(0.14,0.34,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  let latEpicondSpec=pow(max(dot(normal,halfVec),0.0),60.0)*latEpicondY*latEpicondLat*latEpicondFace*latEpicondGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*latEpicondSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior popliteal fossa hollow shadow: the back of the knee is a triangular hollow (popliteal fossa) between the hamstring and gastrocnemius muscles — creates a deep shadow at the posterior knee crease; this shadow separates the thigh from the lower leg and is a key visual indicator of knee articulation; visible on all well-modeled bipedal characters
  let poplitGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.24;
  let poplitY=smoothstep(kneeY-crownEyeW*0.14,kneeY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.04,kneeY+crownEyeW*0.14,input.worldPosition.y));
  let poplitX=smoothstep(crownEyeW*0.56,crownEyeW*0.24,abs(input.worldPosition.x));
  let poplitBack=smoothstep(-0.28,-0.66,normal.z)*smoothstep(0.08,-0.12,abs(normal.y))*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-poplitY*poplitX*poplitBack*poplitGate*0.26);
  // Lower lip labiomental crease shadow: the labiomental fold (the crease between the lower lip and the chin) creates a shadow band running horizontally below the lower lip — present on creatures with defined muzzles/mouths; the shadow separates the lower lip from the chin projection and gives the face more expressive, three-dimensional quality
  let labiomentalGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.26;
  let labiomentalY=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-(scene.mouth.y-scene.mouth.w*0.80)));
  let labiomentalX=smoothstep(crownEyeW*0.44,crownEyeW*0.12,abs(input.worldPosition.x));
  let labiomentalFwd=smoothstep(0.24,0.52,normal.z)*smoothstep(0.08,-0.20,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-labiomentalY*labiomentalX*labiomentalFwd*labiomentalGate*0.22);
  // Anterior ankle extensor retinaculum highlight: the extensor retinaculum is a fibrous band crossing the anterior ankle that holds the extensor tendons down — creates a faint transverse highlight ridge on the dorsal ankle region; gives the ankle that tendon-detail look on lean legged characters like Blaziken, Gallade
  let extRetGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.46,fv)*0.18;
  let extRetY=smoothstep(crownEyeW*0.52,crownEyeW*0.42,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.42,crownEyeW*0.32,input.worldPosition.y));
  let extRetLat=smoothstep(crownEyeW*0.56,crownEyeW*0.82,abs(input.worldPosition.x))*(1.0-metallic);
  let extRetFace=smoothstep(0.36,0.62,normal.z)*smoothstep(0.20,0.40,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  let extRetSpec=pow(max(dot(normal,halfVec),0.0),52.0)*extRetY*extRetLat*extRetFace*extRetGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*extRetSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pronator teres forearm oblique shadow: the pronator teres muscle runs diagonally across the proximal forearm from medial epicondyle to radial shaft creating an oblique shadow on the ventral forearm — gives the forearm its characteristic twisting cylindrical quality; visible on characters with visible arm muscle definition like Machoke or Blaziken
  let pronatorGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.16;
  let pronatorY=smoothstep(elbowY-crownEyeW*0.10,elbowY+crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.30,elbowY+crownEyeW*0.80,input.worldPosition.y));
  let pronatorLat=smoothstep(crownEyeW*0.72,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-metallic);
  let pronatorFace=smoothstep(0.22,0.50,normal.z)*smoothstep(0.12,0.28,abs(normal.x))*smoothstep(0.12,-0.10,normal.y);
  lit=lit*(1.0-pronatorY*pronatorLat*pronatorFace*pronatorGate*0.18);
  // Coracobrachialis inner upper arm shadow: the coracobrachialis creates a subtle shadow on the medial upper arm between the bicep and tricep — the inner-arm shadow hollow that separates the limb from the torso when seen from the front; makes arms feel detached from the body rather than fused; critical for bipedal silhouette readability
  let coracobrachGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.40,fv)*0.20;
  let coracobrachY=smoothstep(elbowY+crownEyeW*0.60,crownEyeY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.36,crownEyeY-crownEyeW*0.16,input.worldPosition.y));
  let coracobrachLat=smoothstep(crownEyeW*0.70,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.06,abs(input.worldPosition.x)));
  let coracobrachInner=smoothstep(0.28,0.54,abs(normal.x))*smoothstep(0.12,-0.14,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-coracobrachY*coracobrachLat*coracobrachInner*coracobrachGate*0.22);
  // Philtrum mid-lip vertical groove shadow: the philtrum is the vertical groove in the upper lip leading from the nose to the Cupid's bow — a midline shadow detail on faces with lips/mouth features; gives faces their distinctive lip/philtrum anatomy; present on characters like Incineroar, Mewtwo, and humanoid Pokemon with visible mouth structure
  let philtrumShadGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.22;
  let philtrumShadY=smoothstep(scene.mouth.y+scene.mouth.w*0.40,scene.mouth.y+scene.mouth.w*0.64,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.64,scene.mouth.y+scene.mouth.w*0.90,input.worldPosition.y));
  let philtrumShadX=smoothstep(crownEyeW*0.06,crownEyeW*0.01,abs(input.worldPosition.x));
  let philtrumShadFwd=smoothstep(0.32,0.60,normal.z)*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-philtrumShadY*philtrumShadX*philtrumShadFwd*philtrumShadGate*0.20);
  // Serratus anterior lateral rib finger shadow: the serratus anterior creates a distinctive "finger" pattern of muscle slips visible on the lateral rib cage — oblique diagonal shadow bands on the lower lateral torso between the pectoral and latissimus; gives the torso that fighter-physique detail visible on Machamp, Incineroar, Kommo-o
  let serratusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.50,fv)*0.16;
  let serratusY=smoothstep(crownEyeY-crownEyeW*1.68,crownEyeY-crownEyeW*1.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.60,input.worldPosition.y));
  let serratusLat=smoothstep(crownEyeW*0.68,crownEyeW*0.96,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.96,crownEyeW*1.22,abs(input.worldPosition.x)));
  let serratusWave=sin((input.worldPosition.y*scale*3.80+abs(input.worldPosition.x)*scale*2.60+fv*2.10))*0.5+0.5;
  let serratusBand=smoothstep(0.60,0.72,serratusWave)*(1.0-smoothstep(0.72,0.84,serratusWave));
  let serratusFace=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(0.10,-0.10,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-serratusBand*serratusY*serratusLat*serratusFace*serratusGate*0.18);
  // Vastus lateralis outer thigh specular: the vastus lateralis is the large quadriceps muscle on the outer thigh that creates a rounded elongated lateral highlight running most of the thigh length — gives the outer thigh its characteristic convex bulge that is visible on muscular bipeds; the widest part of the thigh silhouette on lean characters
  let vastLatGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.22;
  let vastLatY=smoothstep(kneeY+crownEyeW*0.26,kneeY+crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.70,kneeY+crownEyeW*1.60,input.worldPosition.y));
  let vastLatLat=smoothstep(crownEyeW*0.74,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.36,abs(input.worldPosition.x)));
  let vastLatFace=smoothstep(0.44,0.70,abs(normal.x))*smoothstep(0.14,0.34,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  let vastLatSpec=pow(max(dot(normal,halfVec),0.0),14.0)*vastLatY*vastLatLat*vastLatFace*vastLatGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*vastLatSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior calf gastrocnemius medial head highlight: the medial head of the gastrocnemius is the larger, more medially-placed calf muscle that creates a prominent rounded posterior highlight on the upper calf — the characteristic "diamond" calf shape; gives legs their lower-body volume and makes the calf feel like a separate muscle mass from the shin
  let gastrocMedGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let gastrocMedY=smoothstep(kneeY-crownEyeW*0.26,kneeY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.60,kneeY-crownEyeW*1.10,input.worldPosition.y));
  let gastrocMedLat=smoothstep(crownEyeW*0.60,crownEyeW*0.88,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.88,crownEyeW*1.14,abs(input.worldPosition.x)));
  let gastrocMedBack=smoothstep(-0.22,-0.60,normal.z)*smoothstep(0.36,0.58,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  let gastrocMedSpec=pow(max(dot(normal,halfVec),0.0),16.0)*gastrocMedY*gastrocMedLat*gastrocMedBack*gastrocMedGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*gastrocMedSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial tibia flat plane secondary highlight: the medial surface of the tibia has a flat subcutaneous face that catches a secondary wide fill light — gives the inner shin a broad soft glow distinct from the sharper tibial crest; visible on characters with exposed lower legs; the flat face makes the shin look geometrically defined rather than just cylindrical
  let medTibiaGate=organicSkin*(1.0-metallic)*smoothstep(0.30,0.54,toon)*specShadowMask*step(0.36,fv)*0.18;
  let medTibiaY=smoothstep(kneeY-crownEyeW*0.14,kneeY-crownEyeW*0.50,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.50,kneeY-crownEyeW*1.14,input.worldPosition.y));
  let medTibiaLat=smoothstep(crownEyeW*0.46,crownEyeW*0.72,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.72,crownEyeW*0.92,abs(input.worldPosition.x)));
  let medTibiaInner=smoothstep(0.32,0.58,abs(normal.x))*smoothstep(0.14,0.32,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.10,0.04,abs(normal.y));
  let medTibiaSpec=pow(max(dot(normal,halfVec),0.0),8.0)*medTibiaY*medTibiaLat*medTibiaInner*medTibiaGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*medTibiaSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior axillary hollow shadow: the armpit / axillary fossa is a deep hollow between the chest wall, arm, and shoulder that catches shadow — creates the crucial visual separation of the arm from the torso; without this shadow arms look fused; one of the highest-impact anatomical shadows for silhouette readability
  let axillaryGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.26;
  let axillaryY=smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.40,crownEyeY-crownEyeW*0.10,input.worldPosition.y));
  let axillaryLat=smoothstep(crownEyeW*0.62,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*1.00,abs(input.worldPosition.x)));
  let axillaryBack=smoothstep(0.10,-0.30,normal.z)*smoothstep(0.16,0.06,abs(normal.y))*smoothstep(0.32,0.56,abs(normal.x))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-axillaryY*axillaryLat*axillaryBack*axillaryGate*0.28);
  // Mandibular ramus corner jaw shadow: the posterior ramus of the mandible (the vertical part of the jawbone that connects to the skull at the TMJ) creates a shadow at the jaw corner — gives the jaw its characteristic angular corner definition; visible on strong-jawed characters like Incineroar, Kommo-o; the shadow sits at the jaw angle posterior to the muzzle
  let mandRamusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.36,fv)*0.22;
  let mandRamusY=smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.56,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.56,crownEyeY-crownEyeW*0.32,input.worldPosition.y));
  let mandRamusLat=smoothstep(crownEyeW*0.52,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*0.96,abs(input.worldPosition.x)));
  let mandRamusFace=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(0.12,-0.20,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-mandRamusY*mandRamusLat*mandRamusFace*mandRamusGate*0.22);
  // Iliotibial band lateral thigh ridge highlight: the IT band runs down the lateral thigh from the hip to the knee creating a faint ridge highlight on the lateral outer thigh — gives the outer thigh its characteristic planar-facing lateral highlight that Lucario, Machoke show; the IT band fascial thickening creates a slight reflection catchment running the length of the lateral thigh
  let itBandGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.58,toon)*specShadowMask*step(0.42,fv)*0.18;
  let itBandY=smoothstep(kneeY+crownEyeW*0.14,kneeY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.60,crownEyeY-crownEyeW*1.66,input.worldPosition.y));
  let itBandLat=smoothstep(crownEyeW*0.90,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.16,crownEyeW*1.34,abs(input.worldPosition.x)));
  let itBandFace=smoothstep(0.52,0.76,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.12,0.04,abs(normal.y));
  let itBandSpec=pow(max(dot(normal,halfVec),0.0),10.0)*itBandY*itBandLat*itBandFace*itBandGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*itBandSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior subscapular inner shoulder shadow: the subscapularis / inner shoulder blade area creates a deep shadow between the upper arm and the rear torso when the arm is in a neutral position — gives the posterior shoulder its depth and makes the arm feel like it articulates at the scapula; posterior-inner shoulder shadow pocket
  let subscapGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let subscapY=smoothstep(crownEyeY-crownEyeW*0.50,crownEyeY-crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.20,crownEyeY+crownEyeW*0.06,input.worldPosition.y));
  let subscapLat=smoothstep(crownEyeW*0.62,crownEyeW*0.86,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.86,crownEyeW*1.04,abs(input.worldPosition.x)));
  let subscapBack=smoothstep(-0.14,-0.52,normal.z)*smoothstep(0.14,0.06,abs(normal.y))*smoothstep(0.36,0.58,abs(normal.x))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-subscapY*subscapLat*subscapBack*subscapGate*0.24);
  // Anterior forearm extensor digitorum highlight: the extensor digitorum communis is a prominent belly on the dorsal-lateral forearm creating a rounded highlight ridge — visible on characters with defined forearm anatomy; runs from lateral epicondyle toward the wrist on the top of the forearm; a key forearm definition feature on Lucario, Machoke, Blaziken
  let extDigGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.44,fv)*0.18;
  let extDigY=smoothstep(wristY+crownEyeW*0.20,elbowY-crownEyeW*0.44,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.44,elbowY-crownEyeW*0.14,input.worldPosition.y));
  let extDigLat=smoothstep(crownEyeW*0.84,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.10,crownEyeW*1.28,abs(input.worldPosition.x)));
  let extDigFace=smoothstep(0.34,0.60,normal.y)*smoothstep(0.18,0.38,normal.z)*smoothstep(0.14,0.32,abs(normal.x));
  let extDigSpec=pow(max(dot(normal,halfVec),0.0),12.0)*extDigY*extDigLat*extDigFace*extDigGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*extDigSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper lip vermilion catch light: the wet vermilion border of the upper lip has a slightly higher reflectivity and catches a narrow specular at the lip edge — the characteristic lip highlight present on animated game characters; gives the mouth area that glossy-animated-character quality; Incineroar, Mewtwo, and humanoid Pokemon all show this lip-edge specularity
  let vermilionGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.40,fv)*0.24;
  let vermilionY=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-(scene.mouth.y+scene.mouth.w*0.30)));
  let vermilionX=smoothstep(scene.mouth.w*0.68,scene.mouth.w*0.20,abs(input.worldPosition.x));
  let vermilionFace=smoothstep(0.34,0.60,normal.z)*smoothstep(0.12,0.28,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let vermilionSpec=pow(max(dot(normal,halfVec),0.0),48.0)*vermilionY*vermilionX*vermilionFace*vermilionGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*vermilionSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior triceps long head vertical ridge highlight: the long head of the triceps creates a central ridge on the posterior upper arm running from the axilla to the elbow — gives the back of the arm its characteristic central vertical highlight that shows the arm has muscle depth; the long head is the biggest tricep mass and the primary posterior-arm highlight
  let tricepLongGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.44,fv)*0.20;
  let tricepLongY=smoothstep(elbowY+crownEyeW*0.16,elbowY+crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.70,crownEyeY-crownEyeW*0.30,input.worldPosition.y));
  let tricepLongLat=smoothstep(crownEyeW*0.96,crownEyeW*0.72,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.72,crownEyeW*0.50,abs(input.worldPosition.x)));
  let tricepLongBack=smoothstep(-0.24,-0.62,normal.z)*smoothstep(0.44,0.68,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let tricepLongSpec=pow(max(dot(normal,halfVec),0.0),14.0)*tricepLongY*tricepLongLat*tricepLongBack*tricepLongGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*tricepLongSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral malleolus-to-tibia shaft transition shadow: the lateral malleolus protrusion meets the fibular shaft above creating a shadow in the transition zone — gives the lower leg ankle region more complex bony detail; the shadow reads as a distinct bump-shadow pair that signals bone structure; visible on well-defined legs
  let mallShaftGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let mallShaftY=smoothstep(crownEyeW*0.44,crownEyeW*0.34,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.34,crownEyeW*0.24,input.worldPosition.y));
  let mallShaftLat=smoothstep(crownEyeW*0.72,crownEyeW*1.00,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.00,crownEyeW*1.20,abs(input.worldPosition.x)));
  let mallShaftFace=smoothstep(0.40,0.66,abs(normal.x))*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.10,0.04,abs(normal.z));
  lit=lit*(1.0-mallShaftY*mallShaftLat*mallShaftFace*mallShaftGate*0.22);
  // Teres minor / infraspinatus posterior shoulder dome highlight: these rotator cuff muscles create a rounded dome on the posterior shoulder that catches a soft secondary highlight from behind-above — gives the rear shoulder its characteristic "posterior shoulder dome" look; visible on Lucario, Gardevoir, Mewtwo from the 3/4 rear view; the rear shoulder is not flat but rounded outward
  let teresMiGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.60,toon)*specShadowMask*0.20;
  let teresMiY=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.28,crownEyeY,input.worldPosition.y));
  let teresMiLat=smoothstep(crownEyeW*0.72,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.10,crownEyeW*1.38,abs(input.worldPosition.x)));
  let teresMiBack=smoothstep(-0.20,-0.58,normal.z)*smoothstep(0.30,0.54,normal.y)*smoothstep(0.16,0.34,abs(normal.x));
  let teresMiSpec=pow(max(dot(normal,halfVec),0.0),12.0)*teresMiY*teresMiLat*teresMiBack*teresMiGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*teresMiSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inner knee medial condyle saphenous shadow: on the inner knee, the medial condyle of the femur forms a prominent rounded shape that casts a shadow on the medial tibia just below — the saphenous vein groove sits between; gives the inner knee its angular quality vs round outer knee; visible on lean legged characters
  let saphenousGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.42,fv)*0.18;
  let saphenousY=smoothstep(kneeY+crownEyeW*0.08,kneeY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.04,kneeY-crownEyeW*0.18,input.worldPosition.y));
  let saphenousLat=smoothstep(crownEyeW*0.62,crownEyeW*0.44,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.44,crownEyeW*0.26,abs(input.worldPosition.x)));
  let saphenousFace=smoothstep(0.30,0.56,abs(normal.x))*smoothstep(0.10,-0.16,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-saphenousY*saphenousLat*saphenousFace*saphenousGate*0.20);
  // Anterior neck hyoid bone prominence: the hyoid bone creates a subtle horizontal prominence in the anterior neck at the base of the tongue/throat — gives the neck interior its anatomical structure; the slight forward-pointing ridge between the chin and the larynx; adds one more neck bone landmark to complement the thyroid cartilage
  let hyoidGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.52,fv)*0.16;
  let hyoidY=crownEyeY-crownEyeW*0.50;
  let hyoidZone=smoothstep(crownEyeW*0.10,crownEyeW*0.04,abs(input.worldPosition.y-hyoidY))*smoothstep(crownEyeW*0.30,crownEyeW*0.08,abs(input.worldPosition.x));
  let hyoidFace=smoothstep(0.38,0.66,normal.z)*smoothstep(0.10,0.04,abs(normal.x))*smoothstep(0.08,-0.10,abs(normal.y));
  let hyoidSpec=pow(max(dot(normal,halfVec),0.0),60.0)*hyoidZone*hyoidFace*hyoidGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*hyoidSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal extensor carpi radialis forearm specular: the extensor carpi radialis longus and brevis create a prominent ridge on the dorsal-radial forearm — a strong lateral forearm highlight on the thumb-side; runs from lateral epicondyle region to the wrist; gives the forearm its characteristic asymmetric profile (one side thicker than the other); visible on Blaziken, Lucario
  let exCarpiGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.42,fv)*0.18;
  let exCarpiY=smoothstep(wristY+crownEyeW*0.16,elbowY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.60,elbowY-crownEyeW*0.24,input.worldPosition.y));
  let exCarpiLat=smoothstep(crownEyeW*0.74,crownEyeW*1.02,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.02,crownEyeW*1.20,abs(input.worldPosition.x)));
  let exCarpiFace=smoothstep(0.36,0.62,normal.y)*smoothstep(0.14,0.32,normal.z)*smoothstep(0.20,0.40,abs(normal.x));
  let exCarpiSpec=pow(max(dot(normal,halfVec),0.0),10.0)*exCarpiY*exCarpiLat*exCarpiFace*exCarpiGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*exCarpiSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral tibial condyle knee facet specular: the lateral tibial plateau (condyle) at the top of the tibia has a flat facet surface that catches a brief angled highlight — gives the outer knee its angular bony plateau look; sits just below the lateral femoral condyle and creates a small horizontal-facing specular facet at the upper shin level
  let latTibCondGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.46,fv)*0.20;
  let latTibCondY=smoothstep(kneeY-crownEyeW*0.16,kneeY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.06,kneeY+crownEyeW*0.10,input.worldPosition.y));
  let latTibCondLat=smoothstep(crownEyeW*0.66,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.12,abs(input.worldPosition.x)));
  let latTibCondFace=smoothstep(0.48,0.72,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.14,0.32,abs(normal.x));
  let latTibCondSpec=pow(max(dot(normal,halfVec),0.0),56.0)*latTibCondY*latTibCondLat*latTibCondFace*latTibCondGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*latTibCondSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Subgluteal crease shadow: the subgluteal fold is the horizontal shadow line under the buttocks where the gluteus maximus meets the posterior thigh — one of the most reliable visual markers of hip articulation; distinguishes torso mass from leg mass; present on any character where the lower body has defined legs
  let subGlutGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.26;
  let subGlutY=crownEyeY-crownEyeW*2.12;
  let subGlutBand=smoothstep(crownEyeW*0.10,crownEyeW*0.03,abs(input.worldPosition.y-subGlutY));
  let subGlutX=smoothstep(crownEyeW*0.78,crownEyeW*0.24,abs(input.worldPosition.x));
  let subGlutBack=smoothstep(-0.20,-0.58,normal.z)*smoothstep(0.04,-0.18,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-subGlutBand*subGlutX*subGlutBack*subGlutGate*0.26);
  // Posterior anconeus triangular elbow highlight: the anconeus is a small triangular muscle on the posterior-lateral elbow that creates a small angled highlight facet — gives the outer elbow a triangular catch-light that signals the bony/muscular complexity of the elbow region; sits just lateral and distal to the olecranon; visible on Lucario, Machoke from behind
  let anconGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.18;
  let anconY=smoothstep(elbowY-crownEyeW*0.08,elbowY+crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.06,elbowY+crownEyeW*0.22,input.worldPosition.y));
  let anconLat=smoothstep(crownEyeW*0.90,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.16,crownEyeW*1.34,abs(input.worldPosition.x)));
  let anconFace=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(-0.10,-0.40,normal.z)*smoothstep(0.18,0.36,normal.y);
  let anconSpec=pow(max(dot(normal,halfVec),0.0),56.0)*anconY*anconLat*anconFace*anconGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*anconSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial wrist ulnar styloid bump highlight: the ulnar styloid process is the small bony bump on the pinky-side of the wrist — creates a small but precise highlight on the medial wrist; gives the wrist its characteristic bilateral protrusion (radial on thumb-side was already added via malleolus/carpal; ulnar-side adds the symmetric partner)
  let ulnarStyleGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.18;
  let ulnarStyleY=smoothstep(wristY+crownEyeW*0.06,wristY+crownEyeW*0.01,input.worldPosition.y)*(1.0-smoothstep(wristY+crownEyeW*0.01,wristY-crownEyeW*0.08,input.worldPosition.y));
  let ulnarStyleLat=smoothstep(crownEyeW*0.88,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.10,crownEyeW*1.26,abs(input.worldPosition.x)));
  let ulnarStyleFace=smoothstep(0.46,0.72,abs(normal.x))*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.12,-0.10,abs(normal.z));
  let ulnarStyleSpec=pow(max(dot(normal,halfVec),0.0),72.0)*ulnarStyleY*ulnarStyleLat*ulnarStyleFace*ulnarStyleGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*ulnarStyleSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior bicep brachii peak forward specular: the short head of the biceps brachii creates the inner prominence of the bicep peak seen from the front — with the anterior-facing normal it catches the strongest key light highlight; gives the upper arm its characteristic peak-and-valley front profile with two distinct rounds (long head outer, short head inner)
  let bicepShortGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.22;
  let bicepShortY=smoothstep(elbowY+crownEyeW*0.46,elbowY+crownEyeW*0.86,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.86,elbowY+crownEyeW*1.40,input.worldPosition.y));
  let bicepShortLat=smoothstep(crownEyeW*0.76,crownEyeW*0.98,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.98,crownEyeW*1.14,abs(input.worldPosition.x)));
  let bicepShortFace=smoothstep(0.32,0.58,normal.z)*smoothstep(0.24,0.44,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  let bicepShortSpec=pow(max(dot(normal,halfVec),0.0),28.0)*bicepShortY*bicepShortLat*bicepShortFace*bicepShortGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*bicepShortSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sagittal crest dorsal skull keel: some Pokemon (Charizard, Tyranitar, Aggron) have a pronounced skull crest running front-to-back on top of the head — the sagittal crest is a bony ridge separating left and right temporalis muscles; creates a narrow raised highlight running down the top midline of the skull; gates on high fv to appear only on "powerful" archetype variants
  let sagCrestGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.62,fv)*0.22;
  let sagCrestY=smoothstep(crownEyeY+crownEyeW*0.20,crownEyeY+crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.80,crownEyeY+crownEyeW*1.50,input.worldPosition.y));
  let sagCrestX=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.x));
  let sagCrestFace=smoothstep(0.56,0.82,normal.y)*smoothstep(0.06,0.01,abs(normal.z))*smoothstep(0.04,0.01,abs(normal.x));
  let sagCrestSpec=pow(max(dot(normal,halfVec),0.0),24.0)*sagCrestY*sagCrestX*sagCrestFace*sagCrestGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*sagCrestSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior gluteal-thigh SSS warmth: the thin subcutaneous fat and skin over the posterior upper thigh transmits warm red SSS from back-lit positions — gives the rear upper leg a warm glow quality visible in strong back-lighting; complements the flexor-forearm SSS already in place
  let glutSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.18;
  let glutSSSY=smoothstep(kneeY+crownEyeW*0.50,kneeY+crownEyeW*1.10,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*1.10,kneeY+crownEyeW*1.80,input.worldPosition.y));
  let glutSSSLat=smoothstep(crownEyeW*0.60,crownEyeW*0.96,abs(input.worldPosition.x))*(1.0-metallic);
  let glutSSSFace=smoothstep(-0.12,-0.52,normal.z)*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.10,0.04,abs(normal.x));
  let glutSSS=max(0.0,-dot(normal,lightDir))*glutSSSY*glutSSSLat*glutSSSFace*glutSSSGate;
  lit=clamp(lit+vec3<f32>(0.64,0.22,0.14)*glutSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper chest sternal angle (angle of Louis) horizontal highlight: the sternal angle is where the manubrium meets the body of the sternum creating a slight horizontal ridge — gives the upper chest that subtle transverse landmark; on Pokemon like Incineroar it reads as the upper band of the chest markings; a narrow horizontal specular at upper sternum level
  let sternalAngleGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.40,fv)*0.18;
  let sternalAngleY=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-(crownEyeY-crownEyeW*0.46)));
  let sternalAngleX=smoothstep(crownEyeW*0.28,crownEyeW*0.06,abs(input.worldPosition.x));
  let sternalAngleFace=smoothstep(0.34,0.60,normal.z)*smoothstep(0.10,0.04,abs(normal.x))*smoothstep(0.10,-0.10,abs(normal.y));
  let sternalAngleSpec=pow(max(dot(normal,halfVec),0.0),60.0)*sternalAngleY*sternalAngleX*sternalAngleFace*sternalAngleGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*sternalAngleSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior neck splenius capitis lateral shadow: the splenius capitis is a broad neck muscle that creates a lateral shadow band on the posterior neck between the skull base and the trapezius — gives the back of the neck its two-column bilateral shadow flanking the nuchal groove; wider band than the nuchal ligament shadow and sits further lateral
  let spleniusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let spleniusY=smoothstep(crownEyeY-crownEyeW*1.06,crownEyeY-crownEyeW*0.72,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.72,crownEyeY-crownEyeW*0.34,input.worldPosition.y));
  let spleniusLat=smoothstep(crownEyeW*0.16,crownEyeW*0.40,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.40,crownEyeW*0.62,abs(input.worldPosition.x)));
  let spleniusBack=smoothstep(-0.18,-0.54,normal.z)*smoothstep(0.12,0.34,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-spleniusY*spleniusLat*spleniusBack*spleniusGate*0.20);
  // Lateral knee peroneus longus ridge upper shadow: the peroneus longus starts at the fibular head and runs lateral to the calf, creating a ridge shadow on the upper outer lower leg just below the lateral knee — a shadow at the very top lateral shin where the muscle rounds the bone; gives the lateral lower leg profile that secondary mass below the knee
  let peroneusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.42,fv)*0.18;
  let peroneusY=smoothstep(kneeY-crownEyeW*0.16,kneeY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.36,kneeY-crownEyeW*0.68,input.worldPosition.y));
  let peroneusLat=smoothstep(crownEyeW*0.76,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.04,crownEyeW*1.24,abs(input.worldPosition.x)));
  let peroneusFace=smoothstep(0.44,0.70,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.14,-0.10,normal.z);
  lit=lit*(1.0-peroneusY*peroneusLat*peroneusFace*peroneusGate*0.20);
  // Upper forehead frontal bone forward specular: the frontal bone of the forehead has the most forward-facing surface on the head and catches the strongest direct specular from the key light — this is a wide, soft, central forehead highlight that gives the upper face its characteristic dome brightness; Mewtwo, Gardevoir, Espeon all show this
  let frontalBoneGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let frontalBoneY=smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.54,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.54,crownEyeY+crownEyeW*1.00,input.worldPosition.y));
  let frontalBoneX=smoothstep(crownEyeW*0.60,crownEyeW*0.16,abs(input.worldPosition.x));
  let frontalBoneFace=smoothstep(0.42,0.68,normal.z)*smoothstep(0.16,0.34,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let frontalBoneSpec=pow(max(dot(normal,halfVec),0.0),10.0)*frontalBoneY*frontalBoneX*frontalBoneFace*frontalBoneGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*frontalBoneSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inner eyelid caruncle warm SSS: the lacrimal caruncle (inner eye corner) is a warm pink fleshy mass at the medial canthus — creates a tiny warm red-orange glow at the inner corner of each eye; present on all well-rendered anime/game characters including Lucario, Gardevoir; makes eyes look wet and biologically present rather than painted-on
  let caruncSSSGate=(1.0-metallic)*organicSkin*smoothstep(0.10,0.28,toon)*clamp(palBright-0.20,0.0,1.0)*0.24;
  let caruncSSS0Pos=vec2<f32>(scene.eye0.x-scene.eye0.w*0.76,scene.eye0.y);
  let caruncSSS1Pos=vec2<f32>(scene.eye1.x+scene.eye1.w*0.76,scene.eye1.y);
  let caruncSSS0=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(input.worldPosition.xy-caruncSSS0Pos))*eye0pre;
  let caruncSSS1=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(input.worldPosition.xy-caruncSSS1Pos))*eye1pre;
  let caruncleSSS=max(0.0,-dot(normal,lightDir))*max(caruncSSS0,caruncSSS1)*smoothstep(0.24,0.54,normal.z)*caruncSSSGate;
  lit=clamp(lit+vec3<f32>(0.78,0.26,0.16)*caruncleSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal scapular inferior angle tip specular: the inferior angle (lower tip) of the scapula pokes through the skin on lean backs and creates a small sharp point catch light — visible on angular character designs like Mewtwo, Gallade, Gardevoir from behind; a small sharp specular at the lower scapula tip position on the back
  let scapInfAngleGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.18;
  let scapInfAngleY=crownEyeY-crownEyeW*0.90;
  let scapInfAngleLat=crownEyeW*0.84;
  let scapInfAngle0=smoothstep(crownEyeW*0.06,crownEyeW*0.02,length(vec2<f32>(abs(input.worldPosition.x)-scapInfAngleLat,input.worldPosition.y-scapInfAngleY)));
  let scapInfAngleFace=smoothstep(-0.24,-0.60,normal.z)*smoothstep(0.42,0.66,normal.y)*smoothstep(0.14,0.32,abs(normal.x));
  let scapInfAngleSpec=pow(max(dot(normal,halfVec),0.0),72.0)*scapInfAngle0*scapInfAngleFace*scapInfAngleGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*scapInfAngleSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lumbar sacral dimple pair (posterior superior iliac spine dimples): the PSIS creates two bilateral dimple shadows on the lower back just above the sacrum — the "Venus dimples"; present on lean-backed bipedal characters; a pair of bilateral shadow dots at lower lumbar region that signal vertebral structure
  let sacralDimpGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.48,fv)*0.20;
  let sacralDimpY=crownEyeY-crownEyeW*2.30;
  let sacralDimpLat=crownEyeW*0.44;
  let sacralDimp0=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(vec2<f32>(abs(input.worldPosition.x)-sacralDimpLat,input.worldPosition.y-sacralDimpY)));
  let sacralDimpFace=smoothstep(-0.20,-0.58,normal.z)*smoothstep(0.12,0.34,normal.y)*smoothstep(0.14,0.28,abs(normal.x));
  lit=lit*(1.0-sacralDimp0*sacralDimpFace*sacralDimpGate*0.24);
  // Posterior levator scapulae neck pillar shadow: the levator scapulae creates a rounded pillar shadow on the posterior-lateral neck running from the skull base to the upper scapula — gives the back of the neck its characteristic bilateral pillar look with the nuchal groove between; wider and more posterior than the SCM which sits lateral-anterior
  let levScapGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let levScapY=smoothstep(crownEyeY-crownEyeW*1.14,crownEyeY-crownEyeW*0.78,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.78,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let levScapLat=smoothstep(crownEyeW*0.30,crownEyeW*0.52,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.72,abs(input.worldPosition.x)));
  let levScapBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.28,0.50,normal.y)*smoothstep(0.18,0.36,abs(normal.x));
  lit=lit*(1.0-levScapY*levScapLat*levScapBack*levScapGate*0.20);
  // Medial quadriceps vastus medialis oblique (VMO) teardrop sweep: the VMO is the teardrop-shaped muscle just above and medial to the kneecap that creates a distinct oblique-swept specular — gives the lower inner thigh its teardrop quality visible on athletic character designs; catches light at a steeper downward angle than the vastus lateralis
  let vmoGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.48,fv)*0.22;
  let vmoY=smoothstep(kneeY+crownEyeW*0.12,kneeY+crownEyeW*0.46,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.46,kneeY+crownEyeW*0.84,input.worldPosition.y));
  let vmoLat=smoothstep(crownEyeW*0.54,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.00,abs(input.worldPosition.x)));
  let vmoFace=smoothstep(0.28,0.54,abs(normal.x))*smoothstep(0.16,0.36,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.14,0.30,normal.y);
  let vmoSpec=pow(max(dot(normal,halfVec),0.0),18.0)*vmoY*vmoLat*vmoFace*vmoGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*vmoSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Cupid's bow upper lip double peak specular: the Cupid's bow is the double-peaked shape of the upper lip vermilion with a central dip — creates two symmetric specular peaks flanking the philtrum at the upper lip margin; gives anime-style characters their distinctive mouth highlight; present on Incineroar, Mewtwo, and any character with visible mouth shape
  let cupidBowGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.40,fv)*0.22;
  let cupidBowY=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-(scene.mouth.y+scene.mouth.w*0.36)));
  let cupidPeakDist=abs(abs(input.worldPosition.x)-scene.mouth.w*0.36);
  let cupidBowPeaks=smoothstep(scene.mouth.w*0.14,scene.mouth.w*0.04,cupidPeakDist)*(1.0-smoothstep(scene.mouth.w*0.60,scene.mouth.w*0.72,abs(input.worldPosition.x)));
  let cupidBowFace=smoothstep(0.32,0.58,normal.z)*smoothstep(0.14,0.30,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let cupidBowSpec=pow(max(dot(normal,halfVec),0.0),56.0)*cupidBowY*cupidBowPeaks*cupidBowFace*cupidBowGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*cupidBowSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nasolabial fold cheek crease shadow: the nasolabial fold runs from the lateral alar of the nose diagonally down to the mouth corner — a soft diagonal shadow crease on the cheek separating the nasal cheek from the oral cheek; present on characters with expressive faces; gives the cheek region volume and depth by showing the transition between different facial muscle masses
  let nasoLabGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.38,fv)*0.20;
  let nasoLabY=smoothstep(scene.eye0.y-scene.eye0.w*1.40,scene.mouth.y+scene.mouth.w*0.60,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.60,scene.mouth.y+scene.mouth.w*0.90,input.worldPosition.y));
  let nasoLabDiag0=smoothstep(crownEyeW*0.10,crownEyeW*0.03,abs(input.worldPosition.x-scene.mouth.w*0.60-(input.worldPosition.y-scene.mouth.y)*0.40));
  let nasoLabDiag1=smoothstep(crownEyeW*0.10,crownEyeW*0.03,abs(input.worldPosition.x+scene.mouth.w*0.60+(input.worldPosition.y-scene.mouth.y)*0.40));
  let nasoLabFwd=smoothstep(0.30,0.56,normal.z)*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.14,0.30,abs(normal.x));
  lit=lit*(1.0-max(nasoLabDiag0,nasoLabDiag1)*nasoLabY*nasoLabFwd*nasoLabGate*0.20);
  // Coronal suture frontal-parietal ridge: the coronal suture is the joint between the frontal and parietal bones of the skull — creates a subtle transverse elevation at the top-front of the skull that catches light; visible on characters with visible skull structure; gives the upper head geometry that horizontal landmark separating the face-forward bone from the rear skull dome
  let coronalSutGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.52,fv)*0.16;
  let coronalSutY=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-(crownEyeY+crownEyeW*1.02)));
  let coronalSutX=smoothstep(crownEyeW*0.54,crownEyeW*0.14,abs(input.worldPosition.x));
  let coronalSutFace=smoothstep(0.44,0.70,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.06,0.01,abs(normal.x));
  let coronalSutSpec=pow(max(dot(normal,halfVec),0.0),52.0)*coronalSutY*coronalSutX*coronalSutFace*coronalSutGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*coronalSutSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Linea alba vertical abdominal midline shadow: the linea alba is the central tendinous band running from sternum to pubis between the left and right rectus abdominis — creates a central vertical shadow groove on the anterior abdomen; gives the abdomen its characteristic midline that all well-defined torso characters show; Machoke, Incineroar, Lucario all have this
  let abdMidLineGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.48,fv)*0.20;
  let abdMidLineY=smoothstep(crownEyeY-crownEyeW*2.04,crownEyeY-crownEyeW*1.50,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.50,crownEyeY-crownEyeW*0.80,input.worldPosition.y));
  let abdMidLineX=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.x));
  let abdMidLineFwd=smoothstep(0.32,0.58,normal.z)*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-abdMidLineY*abdMidLineX*abdMidLineFwd*abdMidLineGate*0.22);
  // Lateral ankle-shin peroneal groove shadow: the groove between the peroneal muscles and the Achilles complex creates a lateral shadow channel running from the fibula head down to the lateral malleolus — gives the lateral lower leg its characteristic groove that separates the anterior shin from the posterior calf
  let peronealGrvGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let peronealGrvY=smoothstep(kneeY-crownEyeW*0.20,kneeY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.60,crownEyeW*0.36,input.worldPosition.y));
  let peronealGrvLat=smoothstep(crownEyeW*0.86,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.06,crownEyeW*1.22,abs(input.worldPosition.x)));
  let peronealGrvFace=smoothstep(0.06,-0.30,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.44,0.68,abs(normal.x));
  lit=lit*(1.0-peronealGrvY*peronealGrvLat*peronealGrvFace*peronealGrvGate*0.20);
  // Palmar thenar eminence SSS warmth: the thenar eminence (ball of the thumb) is the fleshy pad on the thumb-side of the palm — has good blood supply and shows warm red SSS from the back; gives the hand/paw region that warm fleshy quality at the thenar mass; visible when light backlights the hand
  let thenarSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.18;
  let thenarY=smoothstep(wristY-crownEyeW*0.20,wristY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.40,wristY-crownEyeW*0.62,input.worldPosition.y));
  let thenarLat=smoothstep(crownEyeW*0.86,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-metallic);
  let thenarFace=smoothstep(-0.14,-0.50,normal.z)*smoothstep(0.12,-0.10,abs(normal.y))*smoothstep(0.10,0.04,abs(normal.x));
  let thenarSSS=max(0.0,-dot(normal,lightDir))*thenarY*thenarLat*thenarFace*thenarSSSGate;
  lit=clamp(lit+vec3<f32>(0.62,0.20,0.14)*thenarSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Neck platysma anterior crease shadow: the platysma muscle of the anterior neck creates fine longitudinal shadow bands on the front neck when contracted — gives the neck an animated living-tissue quality; visible on characters with long exposed necks; subtle parallel vertical shadow bands on the anterior neck surface
  let platyBandGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.14;
  let platyBandY=smoothstep(crownEyeY-crownEyeW*1.16,crownEyeY-crownEyeW*0.82,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.82,crownEyeY-crownEyeW*0.42,input.worldPosition.y));
  let platyBandX=smoothstep(crownEyeW*0.40,crownEyeW*0.16,abs(input.worldPosition.x));
  let platysmaWave=abs(sin(input.worldPosition.x*scale*8.0+fv*1.40))*smoothstep(0.60,0.80,abs(sin(input.worldPosition.x*scale*8.0+fv*1.40)));
  let platyBandFwd=smoothstep(0.32,0.58,normal.z)*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-platysmaWave*platyBandY*platyBandX*platyBandFwd*platyBandGate*0.18);
  // Corneal limbal arc highlight: the limbus is the boundary between the cornea and sclera — catches a crescent-shaped specular arc at the outer edge of the iris due to the cornea's surface curvature; gives eyes the "corneal highlight crescent" that makes them look spherically wet; present on all high-quality game character eyes; complements the existing specular catch
  let limbalArcGate=(1.0-metallic)*smoothstep(0.50,0.72,toon)*0.26;
  let limbalArc0=smoothstep(scene.eye0.w*0.60,scene.eye0.w*0.72,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.72,scene.eye0.w*0.84,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let limbalArc1=smoothstep(scene.eye1.w*0.60,scene.eye1.w*0.72,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.72,scene.eye1.w*0.84,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let limbalArcFace=smoothstep(0.30,0.56,normal.z)*smoothstep(0.06,0.01,abs(normal.x))*smoothstep(0.06,0.01,abs(normal.y));
  let limbalArcHL=pow(max(dot(normal,halfVec),0.0),32.0)*max(limbalArc0,limbalArc1)*limbalArcFace*limbalArcGate;
  lit=clamp(lit+vec3<f32>(0.96,0.96,0.98)*limbalArcHL*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior calcaneal Achilles-bone junction transition specular: the Achilles tendon inserts into the posterior-superior calcaneus creating a curved transition ridge that catches a precise highlight — the line where the tendon becomes bone on the posterior heel; gives the ankle its precise anatomical detail of tendon-to-bone transition
  let achilCalcJctGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.18;
  let achilCalcJctY=smoothstep(crownEyeW*0.46,crownEyeW*0.38,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.38,crownEyeW*0.30,input.worldPosition.y));
  let achilCalcJctLat=smoothstep(crownEyeW*0.68,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.12,abs(input.worldPosition.x)));
  let achilCalcJctBack=smoothstep(-0.14,-0.52,normal.z)*smoothstep(0.44,0.66,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  let achilCalcJctSpec=pow(max(dot(normal,halfVec),0.0),72.0)*achilCalcJctY*achilCalcJctLat*achilCalcJctBack*achilCalcJctGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*achilCalcJctSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral shoulder acromion process tip specular: the acromion is the highest bony point of the shoulder — the very tip of the shoulder that sticks out laterally and catches the brightest key light; gives the shoulder its maximum lateral extent catch-light; present on all characters from the front/side; the acromion is wider than the deltoid and creates the shoulder's outermost specular
  let acromionGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.26;
  let acromionY=smoothstep(crownEyeY-crownEyeW*0.38,crownEyeY-crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.18,crownEyeY,input.worldPosition.y));
  let acromionLat=smoothstep(crownEyeW*1.00,crownEyeW*1.28,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.28,crownEyeW*1.52,abs(input.worldPosition.x)));
  let acromionFace=smoothstep(0.40,0.66,normal.y)*smoothstep(0.14,0.30,abs(normal.x))*smoothstep(0.14,0.28,normal.z);
  let acromionSpec=pow(max(dot(normal,halfVec),0.0),40.0)*acromionY*acromionLat*acromionFace*acromionGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*acromionSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper eyelid crease fold shadow: the upper eyelid fold creates a horizontal shadow line above the iris — the characteristic anime "lid shadow" at the top of the eye that gives depth and dramatism; one of the most important single-pixel quality signals in anime character eyes; the upper lid overhang shadow on the iris is what separates flat eyes from deep eyes
  let upperLidShadGate=(1.0-metallic)*organicSkin*smoothstep(0.10,0.28,toon)*0.34;
  let upperLidShad0Y=smoothstep(scene.eye0.w*0.08,scene.eye0.w*0.02,abs(input.worldPosition.y-(scene.eye0.y+scene.eye0.w*0.52)));
  let upperLidShad1Y=smoothstep(scene.eye1.w*0.08,scene.eye1.w*0.02,abs(input.worldPosition.y-(scene.eye1.y+scene.eye1.w*0.52)));
  let upperLidShad0X=smoothstep(scene.eye0.w*0.70,scene.eye0.w*0.26,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let upperLidShad1X=smoothstep(scene.eye1.w*0.70,scene.eye1.w*0.26,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let upperLidShadFace=smoothstep(0.26,0.54,normal.z)*smoothstep(0.08,-0.16,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-max(upperLidShad0Y*upperLidShad0X,upperLidShad1Y*upperLidShad1X)*upperLidShadFace*upperLidShadGate*0.32);
  // Nasal tip apex specular: the very tip of the nose/snout has the smallest radius of curvature and catches a tight bright specular — gives the muzzle tip its characteristic "nose-tip shine" that is present on Pokemon and characters with prominent snouts; one small bright dot at the very front of the snout tip distinguishes a real 3D nose from a painted one
  let nasalTipGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.26;
  let nasalTipY=smoothstep(scene.mouth.y+scene.mouth.w*1.80,scene.mouth.y+scene.mouth.w*2.10,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*2.10,scene.mouth.y+scene.mouth.w*2.46,input.worldPosition.y));
  let nasalTipX=smoothstep(crownEyeW*0.14,crownEyeW*0.04,abs(input.worldPosition.x));
  let nasalTipFace=smoothstep(0.40,0.68,normal.y)*smoothstep(0.18,0.38,normal.z)*smoothstep(0.04,0.01,abs(normal.x));
  let nasalTipSpec=pow(max(dot(normal,halfVec),0.0),80.0)*nasalTipY*nasalTipX*nasalTipFace*nasalTipGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*nasalTipSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Thoracolumbar fascia posterior diamond shadow: the thoracolumbar fascia creates a diamond-shaped flattening on the lower back with rounded corners — gives the posterior lower back its characteristic diamond recess that separates the erector spinae muscles on either side and is bounded by the posterior iliac crests below; present on lean athletic character backs
  let thoracoLumbGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.18;
  let thoracoLumbY=smoothstep(crownEyeY-crownEyeW*2.16,crownEyeY-crownEyeW*1.80,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.80,crownEyeY-crownEyeW*1.44,input.worldPosition.y));
  let thoracoLumbX=smoothstep(crownEyeW*0.36,crownEyeW*0.10,abs(input.worldPosition.x));
  let thoracoLumbBack=smoothstep(-0.18,-0.56,normal.z)*smoothstep(0.12,0.38,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-thoracoLumbY*thoracoLumbX*thoracoLumbBack*thoracoLumbGate*0.22);
  // Limbal ring dark band: the limbal ring is the dark outer ring of the iris at the iris-sclera boundary — makes eyes look larger and more defined; present on all high-quality animated character eyes and is a strong beauty signal; the contrast between the dark limbal ring and the brighter iris interior creates the vivid eye impression
  let outerLimbalGate=(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.36;
  let outerLimbal0=smoothstep(scene.eye0.w*0.56,scene.eye0.w*0.64,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.64,scene.eye0.w*0.72,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let outerLimbal1=smoothstep(scene.eye1.w*0.56,scene.eye1.w*0.64,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.64,scene.eye1.w*0.72,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let outerLimbalFace=smoothstep(0.26,0.52,normal.z)*smoothstep(0.06,0.01,abs(normal.x))*smoothstep(0.06,0.01,abs(normal.y));
  lit=lit*(1.0-max(outerLimbal0,outerLimbal1)*outerLimbalFace*outerLimbalGate*0.36);
  // Lower eyelid tarsus shelf highlight: the lower eyelid has a slight shelf/ledge (the tarsal plate) that catches an upward-reflected fill light — the characteristic lower lid highlight visible on anime/game characters; a thin bright line at the lower lid rim below the iris; makes eyes look correctly constructed with upper shadow + lower highlight
  let lowerTarsusGate=(1.0-metallic)*organicSkin*smoothstep(0.36,0.58,toon)*0.28;
  let lowerTarsus0Y=smoothstep(scene.eye0.w*0.06,scene.eye0.w*0.02,abs(input.worldPosition.y-(scene.eye0.y-scene.eye0.w*0.56)));
  let lowerTarsus1Y=smoothstep(scene.eye1.w*0.06,scene.eye1.w*0.02,abs(input.worldPosition.y-(scene.eye1.y-scene.eye1.w*0.56)));
  let lowerTarsus0X=smoothstep(scene.eye0.w*0.64,scene.eye0.w*0.22,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let lowerTarsus1X=smoothstep(scene.eye1.w*0.64,scene.eye1.w*0.22,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let lowerTarsusFace=smoothstep(0.22,0.50,normal.z)*smoothstep(0.10,0.28,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let lowerTarsusHL=pow(max(dot(normal,halfVec),0.0),40.0)*max(lowerTarsus0Y*lowerTarsus0X,lowerTarsus1Y*lowerTarsus1X)*lowerTarsusFace*lowerTarsusGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*lowerTarsusHL*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior knee popliteal dimple pair: two small dimple shadows flank the popliteal fossa at the backs of the medial and lateral femoral condyles — give the posterior knee its characteristic bilateral dimple pair that bookend the central knee hollow; visible on lean-legged characters from behind
  let poplitDimpGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let poplitDimpY=crownEyeW*0.06;
  let poplitDimp0=smoothstep(crownEyeW*0.07,crownEyeW*0.02,length(vec2<f32>(abs(input.worldPosition.x)-crownEyeW*0.56,input.worldPosition.y-kneeY-poplitDimpY)));
  let poplitDimpFace=smoothstep(-0.28,-0.66,normal.z)*smoothstep(0.08,-0.12,abs(normal.y))*smoothstep(0.26,0.50,abs(normal.x));
  lit=lit*(1.0-poplitDimp0*poplitDimpFace*poplitDimpGate*0.24);
  // Anterior lower eyelid cilia root shadow: the base of the lower eyelashes creates a very fine shadow line at the lower lid margin — gives the eye its complete framing with the lower lash line shadow matching the upper; in anime/game eyes the lower lash line is a thin dark edge that contains the eye below
  let lowerLashGate=(1.0-metallic)*organicSkin*smoothstep(0.10,0.28,toon)*0.28;
  let lowerLash0Y=smoothstep(scene.eye0.w*0.04,scene.eye0.w*0.01,abs(input.worldPosition.y-(scene.eye0.y-scene.eye0.w*0.66)));
  let lowerLash1Y=smoothstep(scene.eye1.w*0.04,scene.eye1.w*0.01,abs(input.worldPosition.y-(scene.eye1.y-scene.eye1.w*0.66)));
  let lowerLash0X=smoothstep(scene.eye0.w*0.60,scene.eye0.w*0.18,abs(input.worldPosition.x-scene.eye0.x))*eye0pre;
  let lowerLash1X=smoothstep(scene.eye1.w*0.60,scene.eye1.w*0.18,abs(input.worldPosition.x-scene.eye1.x))*eye1pre;
  let lowerLashFace=smoothstep(0.24,0.50,normal.z)*smoothstep(0.08,0.22,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-max(lowerLash0Y*lowerLash0X,lowerLash1Y*lowerLash1X)*lowerLashFace*lowerLashGate*0.28);
  // Dorsal hand metacarpophalangeal knuckle bump array: the MP knuckles create a row of small bumps on the back of the hand — gives the hand a sense of finger articulation even at the wrist level; the four knuckle bumps are the key "clue" that this is a hand not just a limb stub; present on Lucario, Machoke, Blaziken
  let mpKnuckleGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.18;
  let mpKnuckleY=smoothstep(wristY-crownEyeW*0.14,wristY-crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.28,wristY-crownEyeW*0.42,input.worldPosition.y));
  let mpKnuckleLat=smoothstep(crownEyeW*0.68,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-metallic);
  let mpKnucklePhase=fract(abs(input.worldPosition.x)/crownEyeW*4.20+0.12)*3.14159;
  let mpKnuckleBump=pow(max(sin(mpKnucklePhase),0.0),12.0);
  let mpKnuckleFace=smoothstep(0.40,0.66,normal.y)*smoothstep(0.12,0.04,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.x))*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*mpKnuckleBump*mpKnuckleY*mpKnuckleLat*mpKnuckleFace*mpKnuckleGate*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Mental protuberance chin tip specular: the mental protuberance (bony chin point) is the most forward-projecting point of the lower face and catches a precise specular — gives the chin its characteristic "pointy catch-light" that reads as a bone pushing through the soft tissue; visible on strong-jawed characters like Incineroar, Kommo-o
  let mentalProcGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.36,fv)*0.22;
  let mentalProcY=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-(scene.mouth.y-scene.mouth.w*1.20)));
  let mentalProcX=smoothstep(crownEyeW*0.16,crownEyeW*0.04,abs(input.worldPosition.x));
  let mentalProcFace=smoothstep(0.30,0.56,normal.z)*smoothstep(0.10,-0.10,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let mentalProcSpec=pow(max(dot(normal,halfVec),0.0),64.0)*mentalProcY*mentalProcX*mentalProcFace*mentalProcGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*mentalProcSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior occipital lateral condyle shadow: the occipital condyles flank the foramen magnum and create lateral shadow pockets at the base of the skull-neck junction — gives the posterior skull-neck transition its angular bilateral structure; visible from behind on characters like Mewtwo, Gardevoir; shadows where skull meets atlas vertebra
  let occipCondGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let occipCondY=crownEyeY-crownEyeW*0.96;
  let occipCondBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-occipCondY)/(crownEyeW*0.16+0.001));
  let occipCondLat=smoothstep(crownEyeW*0.18,crownEyeW*0.34,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.34,crownEyeW*0.50,abs(input.worldPosition.x)));
  let occipCondBack=smoothstep(-0.18,-0.54,normal.z)*smoothstep(0.14,0.36,normal.y)*smoothstep(0.16,0.32,abs(normal.x));
  lit=lit*(1.0-occipCondBand*occipCondLat*occipCondBack*occipCondGate*0.22);
  // Anterior superior thigh sartorius oblique shadow: the sartorius is the longest muscle in the body running diagonally from the ASIS to the medial knee — creates a faint oblique shadow band across the anterior thigh; gives the front of the thigh that oblique anatomical definition separating the quad mass from the inner thigh
  let sartoriusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.50,fv)*0.16;
  let sartoriusY=smoothstep(kneeY+crownEyeW*0.40,crownEyeY-crownEyeW*1.66,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.66,crownEyeY-crownEyeW*1.40,input.worldPosition.y));
  let sartoriusDiag=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs((input.worldPosition.x-(crownEyeY-crownEyeW*1.80-input.worldPosition.y)*0.38)*sign(input.worldPosition.x)));
  let sartoriusFwd=smoothstep(0.28,0.54,normal.z)*smoothstep(0.12,-0.10,normal.y)*smoothstep(0.16,0.32,abs(normal.x));
  lit=lit*(1.0-sartoriusY*sartoriusDiag*sartoriusFwd*sartoriusGate*0.18);
  // Pterion temporal notch shadow: the pterion is the H-shaped suture junction on the lateral skull where four bones meet — creates a subtle shadow depression at the lateral skull temple region between the temporal muscle and the parietal bone; gives the side of the skull its characteristic slight concavity at the temple
  let pterionGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.50,fv)*0.18;
  let pterionY=smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.62,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.62,crownEyeY+crownEyeW*0.96,input.worldPosition.y));
  let pterionLat=smoothstep(crownEyeW*0.74,crownEyeW*0.96,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.96,crownEyeW*1.16,abs(input.worldPosition.x)));
  let pterionSide=smoothstep(0.48,0.74,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.10,0.22,normal.y);
  lit=lit*(1.0-pterionY*pterionLat*pterionSide*pterionGate*0.20);
  // Posterior ear antihelix ridge highlight: the antihelix is the Y-shaped ridge running down the inner ear — from behind/lateral, the posterior ear catches a highlight on the antihelix ridge; present on large-eared characters; gives ears their complex inner topology rather than being a flat flap; visible on Eevee, Pikachu, Sylveon ear backs
  let antihelixGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.38,fv)*0.18;
  let antihelixY=smoothstep(earTopY-crownEyeW*0.80,earTopY-crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(earTopY-crownEyeW*0.20,earTopY+crownEyeW*0.30,input.worldPosition.y));
  let antihelixLat=smoothstep(crownEyeW*0.86,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.16,crownEyeW*1.40,abs(input.worldPosition.x)));
  let antihelixBack=smoothstep(0.04,-0.40,normal.z)*smoothstep(0.24,0.48,normal.y)*smoothstep(0.24,0.48,abs(normal.x));
  let antihelixSpec=pow(max(dot(normal,halfVec),0.0),36.0)*antihelixY*antihelixLat*antihelixBack*antihelixGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*antihelixSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior wrist extensor retinaculum dome: the extensor retinaculum band on the dorsal wrist creates a domed highlight visible from behind — gives the wrist its characteristic dorsal band structure; the retinaculum holds the extensor tendons and creates a slight ridge across the dorsal wrist at wrist crease level; complements the anterior version
  let exRetDomGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.44,fv)*0.16;
  let exRetDomY=smoothstep(wristY+crownEyeW*0.08,wristY+crownEyeW*0.02,input.worldPosition.y)*(1.0-smoothstep(wristY+crownEyeW*0.02,wristY-crownEyeW*0.08,input.worldPosition.y));
  let exRetDomLat=smoothstep(crownEyeW*0.76,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-metallic);
  let exRetDomFace=smoothstep(0.38,0.64,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.x));
  let exRetDomSpec=pow(max(dot(normal,halfVec),0.0),56.0)*exRetDomY*exRetDomLat*exRetDomFace*exRetDomGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*exRetDomSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Infraspinatus posterior shoulder horizontal band highlight: the infraspinatus creates a horizontal ridge/band on the posterior shoulder blade region — a faint horizontal highlight running from the scapular spine down toward the glenohumeral joint; gives the posterior shoulder blade region its characteristic horizontal banding; visible on athletic character backs
  let infraspiGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.60,toon)*specShadowMask*step(0.44,fv)*0.16;
  let infraspiY=smoothstep(crownEyeY-crownEyeW*0.78,crownEyeY-crownEyeW*0.56,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.56,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let infraspiLat=smoothstep(crownEyeW*0.54,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.18,abs(input.worldPosition.x)));
  let infraspiBack=smoothstep(-0.20,-0.56,normal.z)*smoothstep(0.26,0.48,normal.y)*smoothstep(0.14,0.30,abs(normal.x));
  let infraspiSpec=pow(max(dot(normal,halfVec),0.0),16.0)*infraspiY*infraspiLat*infraspiBack*infraspiGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*infraspiSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pupillary ruff specular ring: the pupillary margin of the iris has a slight raised edge that catches a faint ring specular — gives the iris a sense of depth and lens-like curvature; the pupillary sphincter muscle creates a slight rim at the iris-pupil boundary; adds another layer to the eye anatomy on top of limbal darkening
  let pupilRuffGate=(1.0-metallic)*smoothstep(0.50,0.72,toon)*0.22;
  let pupilRuff0=smoothstep(scene.eye0.w*0.22,scene.eye0.w*0.26,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.26,scene.eye0.w*0.30,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre*irisBlend;
  let pupilRuff1=smoothstep(scene.eye1.w*0.22,scene.eye1.w*0.26,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.26,scene.eye1.w*0.30,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre*irisBlend;
  let pupilRuffFace=smoothstep(0.28,0.54,normal.z)*smoothstep(0.06,0.01,abs(normal.x))*smoothstep(0.06,0.01,abs(normal.y));
  let pupilRuffSpec=pow(max(dot(normal,halfVec),0.0),48.0)*max(pupilRuff0,pupilRuff1)*pupilRuffFace*pupilRuffGate;
  lit=clamp(lit+vec3<f32>(0.94,0.94,0.96)*pupilRuffSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Palmar inter-finger web crease shadow: where fingers diverge from the palm there are crease shadows on the palmar side — small shadow notches at the base of each inter-finger web on the ventral hand surface; gives the hand/claw region its articulation detail showing where fingers begin; complements the dorsal knuckle highlight array
  let palmWebGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.18;
  let palmWebY=smoothstep(wristY-crownEyeW*0.44,wristY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.36,wristY-crownEyeW*0.28,input.worldPosition.y));
  let palmWebLat=smoothstep(crownEyeW*0.66,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.36,abs(input.worldPosition.x)));
  let palmWebPhase=fract(abs(input.worldPosition.x)/crownEyeW*3.40+0.14)*3.14159;
  let palmWebNotch=1.0-pow(max(sin(palmWebPhase),0.0),6.0);
  let palmWebDown=smoothstep(-0.06,-0.34,normal.z)*smoothstep(0.20,0.42,normal.y)*smoothstep(0.08,0.18,abs(normal.x));
  lit=lit*(1.0-palmWebNotch*palmWebY*palmWebLat*palmWebDown*palmWebGate*0.18);
  // Dorsal forearm interosseous membrane ridge: the interosseous membrane connecting the radius and ulna creates a very faint dorsal ridge running the length of the forearm midline — gives the forearm its subtle dorsal-midline elevation visible on lean-armed characters; a narrow low-spec highlight running along the back of the forearm
  let interOssMbrGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.46,fv)*0.14;
  let interOssMbrY=smoothstep(wristY+crownEyeW*0.20,elbowY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.60,elbowY-crownEyeW*0.20,input.worldPosition.y));
  let interOssMbrLat=smoothstep(crownEyeW*1.08,crownEyeW*0.82,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.82,crownEyeW*0.60,abs(input.worldPosition.x)));
  let interOssMbrFace=smoothstep(0.28,0.54,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.x));
  let interOssMbrSpec=pow(max(dot(normal,halfVec),0.0),24.0)*interOssMbrY*interOssMbrLat*interOssMbrFace*interOssMbrGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*interOssMbrSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Supraclavicular fossa hollow shadow: the supraclavicular fossa is the hollow depression just above the clavicle between the SCM and trapezius — creates a deep shadow at the base of the neck above the collarbone; one of the most important anatomy-visible shadows on the upper torso; present on Gardevoir, Mewtwo, Lucario; makes the collarbone feel like a raised structure
  let supraClav=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.28;
  let supraClavY=smoothstep(crownEyeY-crownEyeW*0.66,crownEyeY-crownEyeW*0.52,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.52,crownEyeY-crownEyeW*0.38,input.worldPosition.y));
  let supraClavLat=smoothstep(crownEyeW*0.34,crownEyeW*0.62,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.62,crownEyeW*0.84,abs(input.worldPosition.x)));
  let supraClavFwd=smoothstep(0.28,0.56,normal.z)*smoothstep(0.12,0.28,normal.y)*smoothstep(0.14,0.30,abs(normal.x));
  lit=lit*(1.0-supraClavY*supraClavLat*supraClavFwd*supraClav*0.26);
  // Medial patella knee groove: the medial groove between the patella and the medial femoral condyle creates a shadow channel on the inner knee face — gives the knee cap its characteristic bilateral groove framing; the two grooves (medial and lateral) make the patella look like a distinct bony structure rather than a smooth rounded knee
  let patGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let patGrooveY=smoothstep(kneeY+crownEyeW*0.08,kneeY+crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.18,kneeY+crownEyeW*0.30,input.worldPosition.y));
  let patGrooveLat=smoothstep(crownEyeW*0.48,crownEyeW*0.66,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.66,crownEyeW*0.80,abs(input.worldPosition.x)));
  let patGrooveFwd=smoothstep(0.26,0.52,normal.z)*smoothstep(0.10,-0.12,normal.y)*smoothstep(0.24,0.44,abs(normal.x));
  lit=lit*(1.0-patGrooveY*patGrooveLat*patGrooveFwd*patGrooveGate*0.22);
  // Posterior tibiofibular syndesmosis ankle ridge: the posterior tibiofibular ligament/syndesmosis creates a small ridge on the posterior ankle just above the malleoli — gives the ankle its posterior bony ridge that separates the calf from the foot; adds precision to the ankle anatomy below the Achilles tendon
  let tibFibSyndGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.46,fv)*0.16;
  let tibFibSyndY=smoothstep(crownEyeW*0.50,crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.40,crownEyeW*0.32,input.worldPosition.y));
  let tibFibSyndLat=smoothstep(crownEyeW*0.60,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*1.04,abs(input.worldPosition.x)));
  let tibFibSyndBack=smoothstep(-0.18,-0.52,normal.z)*smoothstep(0.32,0.54,normal.y)*smoothstep(0.12,0.26,abs(normal.x));
  let tibFibSyndSpec=pow(max(dot(normal,halfVec),0.0),60.0)*tibFibSyndY*tibFibSyndLat*tibFibSyndBack*tibFibSyndGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*tibFibSyndSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior patella superior pole rounded facet: the superior pole of the kneecap is a rounded prominence that catches key light from the front-above — the top edge of the patella creates a bright rounded highlight at the top of the kneecap; gives the knee its characteristic "kneecap dome" top highlight; present on all well-modeled knees
  let patSuperGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let patSuperY=smoothstep(kneeY+crownEyeW*0.26,kneeY+crownEyeW*0.38,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.38,kneeY+crownEyeW*0.54,input.worldPosition.y));
  let patSuperX=smoothstep(crownEyeW*0.42,crownEyeW*0.18,abs(input.worldPosition.x));
  let patSuperFace=smoothstep(0.36,0.62,normal.y)*smoothstep(0.20,0.40,normal.z)*smoothstep(0.06,0.01,abs(normal.x));
  let patSuperSpec=pow(max(dot(normal,halfVec),0.0),36.0)*patSuperY*patSuperX*patSuperFace*patSuperGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*patSuperSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior forearm muscle belly separation groove: the posterior forearm has a central groove separating the extensor digitorum from the extensor carpi ulnaris — creates a dorsal forearm midline shadow groove running from elbow toward the wrist; gives the dorsal forearm its two-column look that distinguishes it from the round cylindrical alternative
  let postForeGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.16;
  let postForeGrooveY=smoothstep(wristY+crownEyeW*0.20,elbowY-crownEyeW*0.50,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.50,elbowY-crownEyeW*0.18,input.worldPosition.y));
  let postForeGrooveLat=smoothstep(crownEyeW*0.96,crownEyeW*0.74,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.74,crownEyeW*0.52,abs(input.worldPosition.x)));
  let postForeGrooveBack=smoothstep(0.06,-0.30,normal.z)*smoothstep(0.12,0.04,abs(normal.y))*smoothstep(0.36,0.58,normal.y);
  lit=lit*(1.0-postForeGrooveY*postForeGrooveLat*postForeGrooveBack*postForeGrooveGate*0.18);
  // External jugular vein neck shadow band: the external jugular vein creates a faint diagonal shadow band running from behind the ear diagonally down the lateral neck — a visual detail present on lean-necked characters; adds one final piece of neck surface complexity; gives the lateral neck that soft vascular shadow detail
  let extJugGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.50,fv)*0.14;
  let extJugY=smoothstep(crownEyeY-crownEyeW*1.06,crownEyeY-crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*0.34,input.worldPosition.y));
  let extJugDiag=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.x-crownEyeW*0.48-(input.worldPosition.y-crownEyeY+crownEyeW*0.70)*0.30));
  let extJugFace=smoothstep(0.34,0.60,abs(normal.x))*smoothstep(0.14,0.30,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-extJugY*extJugDiag*extJugFace*extJugGate*0.18);
  // Anterior infrapatellar fat pad shadow: the Hoffa's fat pad below the patella and above the patellar ligament creates a shadow in the infrapatellar region — gives the knee its lower shadow pocket below the kneecap; makes the patella look like an elevated structure with shadow below it; present on all correctly modeled knees
  let hofFatPadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let hofFatPadY=smoothstep(kneeY,kneeY-crownEyeW*0.12,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.12,kneeY-crownEyeW*0.28,input.worldPosition.y));
  let hofFatPadX=smoothstep(crownEyeW*0.38,crownEyeW*0.12,abs(input.worldPosition.x));
  let hofFatPadFwd=smoothstep(0.26,0.52,normal.z)*smoothstep(0.04,-0.22,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-hofFatPadY*hofFatPadX*hofFatPadFwd*hofFatPadGate*0.22);
  // Lateral brachial cutaneous nerve forearm transition shadow: at the mid-upper arm level, the lateral margin of the biceps creates a shadow groove separating the bicep from the lateral brachial surface — visible as a lateral upper arm shadow channel; gives the upper arm its characteristic lateral groove between front and side surfaces
  let latBrachCutGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let latBrachCutY=smoothstep(elbowY+crownEyeW*0.50,elbowY+crownEyeW*1.00,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*1.00,elbowY+crownEyeW*1.60,input.worldPosition.y));
  let latBrachCutLat=smoothstep(crownEyeW*0.90,crownEyeW*1.10,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.10,crownEyeW*1.26,abs(input.worldPosition.x)));
  let latBrachCutFace=smoothstep(0.44,0.68,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.12,-0.12,normal.z);
  lit=lit*(1.0-latBrachCutY*latBrachCutLat*latBrachCutFace*latBrachCutGate*0.20);
  // Mentalis chin muscle convexity highlight: the mentalis creates a dome on the tip of the chin that catches a forward highlight — gives the chin its characteristic rounded bump; the mentalis is a paired chin muscle that creates the "mental crease" and the convex chin surface forward of it
  let mentalisGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.36,fv)*0.20;
  let mentalisY=smoothstep(scene.mouth.y-scene.mouth.w*0.96,scene.mouth.y-scene.mouth.w*1.26,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*1.26,scene.mouth.y-scene.mouth.w*1.56,input.worldPosition.y));
  let mentalisX=smoothstep(crownEyeW*0.30,crownEyeW*0.08,abs(input.worldPosition.x));
  let mentalisFwd=smoothstep(0.30,0.56,normal.z)*smoothstep(0.04,-0.14,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let mentalisSpec=pow(max(dot(normal,halfVec),0.0),32.0)*mentalisY*mentalisX*mentalisFwd*mentalisGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*mentalisSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scleral perilimbal bright band: just outside the iris, the conjunctival sclera has a slightly brighter appearance due to light penetrating the thin conjunctival tissue — a subtle bright halo around the iris on the sclera side; gives eyes the appearance of the iris floating inside the eye rather than being painted on the surface
  let periLimbalGate=(1.0-metallic)*smoothstep(0.36,0.58,toon)*0.20;
  let periLimbal0=smoothstep(scene.eye0.w*0.68,scene.eye0.w*0.76,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.76,scene.eye0.w*0.86,length(input.worldPosition.xy-scene.eye0.xy)))*eye0pre;
  let periLimbal1=smoothstep(scene.eye1.w*0.68,scene.eye1.w*0.76,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.76,scene.eye1.w*0.86,length(input.worldPosition.xy-scene.eye1.xy)))*eye1pre;
  let periLimbalFace=smoothstep(0.24,0.50,normal.z)*smoothstep(0.06,0.01,abs(normal.x))*smoothstep(0.06,0.01,abs(normal.y));
  lit=clamp(lit+vec3<f32>(0.94,0.94,0.96)*max(periLimbal0,periLimbal1)*periLimbalFace*periLimbalGate*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral abdominal oblique crease shadow: the external oblique creates a diagonal crease shadow from the lower rib cage obliquely down to the iliac crest — gives the flank/lateral abdomen its characteristic oblique depression that separates the rectus from the lateral wall; present on lean characters with visible trunk anatomy
  let extOblShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.50,fv)*0.16;
  let extOblShadY=smoothstep(crownEyeY-crownEyeW*1.90,crownEyeY-crownEyeW*1.40,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.40,crownEyeY-crownEyeW*0.96,input.worldPosition.y));
  let extOblShadLat=smoothstep(crownEyeW*0.60,crownEyeW*0.86,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.86,crownEyeW*1.08,abs(input.worldPosition.x)));
  let extOblShadFace=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(0.14,0.30,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-extOblShadY*extOblShadLat*extOblShadFace*extOblShadGate*0.20);
  // Sternal notch jugular hollow: the jugular notch (suprasternal notch) at the top of the sternum creates a deep circular shadow hollow at the base of the neck — one of the most distinctive landmarks on the front torso; gives the neck-chest transition its characteristic central dimple; visible on Gardevoir, Mewtwo, Incineroar from the front
  let jugNotchGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.28;
  let jugNotchY=crownEyeY-crownEyeW*0.68;
  let jugNotchDist=length(vec2<f32>(input.worldPosition.x*1.40,input.worldPosition.y-jugNotchY));
  let jugNotchZone=smoothstep(crownEyeW*0.18,crownEyeW*0.06,jugNotchDist);
  let jugNotchFwd=smoothstep(0.26,0.52,normal.z)*smoothstep(0.10,-0.14,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-jugNotchZone*jugNotchFwd*jugNotchGate*0.30);
  // Upper eyelid lateral tear lake highlight: the lateral canthal angle has a small pooling zone where the tear film thickens — creates a small bright glint at the outer eye corner; gives the eye its complete bilateral corner anatomy (inner corner has the caruncle warmth, outer corner has this lateral catch light); completes eye framing
  let lateralCanthGate=(1.0-metallic)*organicSkin*smoothstep(0.50,0.72,toon)*0.22;
  let latCanth0Pos=vec2<f32>(scene.eye0.x+scene.eye0.w*0.80,scene.eye0.y);
  let latCanth1Pos=vec2<f32>(scene.eye1.x-scene.eye1.w*0.80,scene.eye1.y);
  let latCanth0=smoothstep(crownEyeW*0.07,crownEyeW*0.02,length(input.worldPosition.xy-latCanth0Pos))*eye0pre;
  let latCanth1=smoothstep(crownEyeW*0.07,crownEyeW*0.02,length(input.worldPosition.xy-latCanth1Pos))*eye1pre;
  let latCanthFace=smoothstep(0.26,0.52,normal.z)*smoothstep(0.06,0.01,abs(normal.x))*smoothstep(0.06,0.01,abs(normal.y));
  let latCanthSpec=pow(max(dot(normal,halfVec),0.0),56.0)*max(latCanth0,latCanth1)*latCanthFace*lateralCanthGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*latCanthSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tibial tuberosity anterior shin bump: the tibial tuberosity is the bony bump on the anterior proximal tibia where the patellar ligament inserts — creates a distinct frontal protrusion below the knee; gives the upper shin its characteristic anterior bump just below the kneecap; present on all bipedal characters with defined legs
  let tibTubGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.22;
  let tibTubY=smoothstep(kneeY-crownEyeW*0.16,kneeY-crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.30,kneeY-crownEyeW*0.46,input.worldPosition.y));
  let tibTubX=smoothstep(crownEyeW*0.28,crownEyeW*0.08,abs(input.worldPosition.x));
  let tibTubFace=smoothstep(0.36,0.62,normal.z)*smoothstep(0.14,0.32,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  let tibTubSpec=pow(max(dot(normal,halfVec),0.0),44.0)*tibTubY*tibTubX*tibTubFace*tibTubGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*tibTubSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Suboccipital ridge shadow groove: the external occipital protuberance ridge (nuchal ridge/torus) creates a horizontal groove shadow at the skull-neck junction — separates the back of the skull from the neck; gives the posterior head-neck junction its characteristic horizontal shadow line; present on all characters with exposed backs of heads
  let nuchalRidgeGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let nuchalRidgeY=crownEyeY-crownEyeW*1.02;
  let nuchalRidgeBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-nuchalRidgeY)/(crownEyeW*0.14+0.001));
  let nuchalRidgeX=smoothstep(crownEyeW*0.46,crownEyeW*0.12,abs(input.worldPosition.x));
  let nuchalRidgeBack=smoothstep(-0.18,-0.54,normal.z)*smoothstep(0.14,0.36,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-nuchalRidgeBand*nuchalRidgeX*nuchalRidgeBack*nuchalRidgeGate*0.26);
  // Quadriceps tendon patellar ligament anterior shadow: the patellar ligament running from the inferior patella to the tibial tuberosity creates a shadow channel on either side — gives the upper shin below the kneecap its characteristic flanking shadow pair that frames the ligament; makes the front of the knee look like it has real connective structure
  let patLigShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.20;
  let patLigShadY=smoothstep(kneeY,kneeY-crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.22,kneeY-crownEyeW*0.40,input.worldPosition.y));
  let patLigShadLat=smoothstep(crownEyeW*0.20,crownEyeW*0.36,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.36,crownEyeW*0.50,abs(input.worldPosition.x)));
  let patLigShadFwd=smoothstep(0.28,0.54,normal.z)*smoothstep(0.10,-0.16,normal.y)*smoothstep(0.18,0.36,abs(normal.x));
  lit=lit*(1.0-patLigShadY*patLigShadLat*patLigShadFwd*patLigShadGate*0.22);
  // Posterior proximal fibula head-shaft groove shadow: just below the fibular head, the transition to the fibular shaft creates a circumferential shadow groove — gives the lateral knee-to-shin transition its secondary shadow notch below the fibular head highlight already present; adds anatomical precision to the knee-shin anatomy
  let fibShaftGrvGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.16;
  let fibShaftGrvY=smoothstep(kneeY-crownEyeW*0.22,kneeY-crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.30,kneeY-crownEyeW*0.40,input.worldPosition.y));
  let fibShaftGrvLat=smoothstep(crownEyeW*0.80,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.04,crownEyeW*1.20,abs(input.worldPosition.x)));
  let fibShaftGrvFace=smoothstep(0.40,0.66,abs(normal.x))*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.10,0.04,abs(normal.z));
  lit=lit*(1.0-fibShaftGrvY*fibShaftGrvLat*fibShaftGrvFace*fibShaftGrvGate*0.20);
  // Lateral mandibular angular notch shadow: the mandibular notch on the lateral aspect of the lower jaw creates a shadow where the ascending ramus curves up — gives the lateral jaw its characteristic angular shadow that shows the jaw is a separate bony structure with corners; visible on strong-jawed characters from the lateral view
  let mandNotchGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.40,fv)*0.18;
  let mandNotchY=smoothstep(crownEyeY-crownEyeW*0.76,crownEyeY-crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.44,input.worldPosition.y));
  let mandNotchLat=smoothstep(crownEyeW*0.64,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*0.98,abs(input.worldPosition.x)));
  let mandNotchFace=smoothstep(0.38,0.64,abs(normal.x))*smoothstep(0.14,-0.14,normal.z)*smoothstep(0.12,0.26,normal.y);
  lit=lit*(1.0-mandNotchY*mandNotchLat*mandNotchFace*mandNotchGate*0.22);
  // C7 vertebra prominence posterior neck: the C7 vertebra (vertebra prominens) is the most prominent posterior neck vertebra at the base of the neck — creates a small bony protrusion shadow at the posterior neck-thorax junction; present on characters like Mewtwo, Gardevoir with exposed backs; gives the posterior neck its inferior termination bone landmark
  let c7VertGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.46,fv)*0.18;
  let c7VertY=crownEyeY-crownEyeW*1.12;
  let c7VertDist=length(vec2<f32>(input.worldPosition.x*1.20,input.worldPosition.y-c7VertY));
  let c7VertZone=smoothstep(crownEyeW*0.06,crownEyeW*0.02,c7VertDist);
  let c7VertBack=smoothstep(-0.20,-0.60,normal.z)*smoothstep(0.36,0.60,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let c7VertSpec=pow(max(dot(normal,halfVec),0.0),80.0)*c7VertZone*c7VertBack*c7VertGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*c7VertSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal wrist anatomical snuffbox hollow: the anatomical snuffbox is the triangular hollow on the thumb-side of the dorsal wrist between the extensor pollicis longus and brevis tendons — creates a shadow hollow on the radial dorsal wrist; gives the wrist its characteristic thumb-side hollow; visible on lean wrists with visible tendon detail
  let snuffboxGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.48,fv)*0.16;
  let snuffboxY=smoothstep(wristY+crownEyeW*0.12,wristY+crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(wristY+crownEyeW*0.04,wristY-crownEyeW*0.12,input.worldPosition.y));
  let snuffboxLat=smoothstep(crownEyeW*0.78,crownEyeW*1.00,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.00,crownEyeW*1.16,abs(input.worldPosition.x)));
  let snuffboxFace=smoothstep(0.30,0.56,normal.y)*smoothstep(0.14,0.30,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.z));
  lit=lit*(1.0-snuffboxY*snuffboxLat*snuffboxFace*snuffboxGate*0.20);
  // Anterior humeral head round dome specular: the humeral head is a large spherical joint surface that creates a broad dome highlight on the anterior-lateral shoulder where it emerges from the joint — gives the shoulder its characteristic ball-and-socket quality; a wide soft specular at the anterior shoulder joint line
  let humeralHeadGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.22;
  let humeralHeadY=smoothstep(crownEyeY-crownEyeW*0.48,crownEyeY-crownEyeW*0.26,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.26,crownEyeY-crownEyeW*0.04,input.worldPosition.y));
  let humeralHeadLat=smoothstep(crownEyeW*0.80,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.16,crownEyeW*1.40,abs(input.worldPosition.x)));
  let humeralHeadFace=smoothstep(0.36,0.62,normal.z)*smoothstep(0.20,0.40,normal.y)*smoothstep(0.20,0.38,abs(normal.x));
  let humeralHeadSpec=pow(max(dot(normal,halfVec),0.0),8.0)*humeralHeadY*humeralHeadLat*humeralHeadFace*humeralHeadGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*humeralHeadSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Mastoid process post-auricular bump highlight: the mastoid process is the bony protrusion behind each ear — creates a small lateral protrusion catch light at the posterior lower skull just behind the ear attachment; gives the posterior-lateral skull its bilateral bump pair; visible on characters like Mewtwo from behind-lateral
  let mastoidGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.18;
  let mastoidY=smoothstep(earTopY-crownEyeW*1.60,earTopY-crownEyeW*1.30,input.worldPosition.y)*(1.0-smoothstep(earTopY-crownEyeW*1.30,earTopY-crownEyeW*1.00,input.worldPosition.y));
  let mastoidLat=smoothstep(crownEyeW*0.80,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.28,abs(input.worldPosition.x)));
  let mastoidBack=smoothstep(0.04,-0.36,normal.z)*smoothstep(0.22,0.46,normal.y)*smoothstep(0.24,0.46,abs(normal.x));
  let mastoidSpec=pow(max(dot(normal,halfVec),0.0),52.0)*mastoidY*mastoidLat*mastoidBack*mastoidGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*mastoidSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Bicipital groove anterior shoulder channel shadow: the bicipital groove (intertubercular sulcus) is the channel on the anterior humerus where the long head of the bicep tendon runs — creates a vertical shadow groove on the anterior proximal upper arm separating the greater and lesser tuberosities; gives the shoulder-to-arm transition its anatomical detail
  let bicipGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.16;
  let bicipGrooveY=smoothstep(crownEyeY-crownEyeW*0.30,crownEyeY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.10,crownEyeY+crownEyeW*0.10,input.worldPosition.y));
  let bicipGrooveLat=smoothstep(crownEyeW*0.90,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.20,abs(input.worldPosition.x)));
  let bicipGrooveFwd=smoothstep(0.32,0.58,normal.z)*smoothstep(0.12,0.28,normal.y)*smoothstep(0.20,0.38,abs(normal.x));
  lit=lit*(1.0-bicipGrooveY*bicipGrooveLat*bicipGrooveFwd*bicipGrooveGate*0.20);
  // Pulvinar medial eye periorbital SSS: the medial orbital region has very thin skin with visible vascular SSS — creates a warm reddish-pink glow at the inner eye socket just lateral to the bridge of the nose; gives eyes a subtle periorbital coloring that signals biological tissue; complements the caruncle and lacrimal anatomy
  let medOrbSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.24,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.16;
  let medOrb0Pos=vec2<f32>(scene.eye0.x-scene.eye0.w*1.00,scene.eye0.y);
  let medOrb1Pos=vec2<f32>(scene.eye1.x+scene.eye1.w*1.00,scene.eye1.y);
  let medOrb0=smoothstep(crownEyeW*0.22,crownEyeW*0.06,length(input.worldPosition.xy-medOrb0Pos))*eye0pre;
  let medOrb1=smoothstep(crownEyeW*0.22,crownEyeW*0.06,length(input.worldPosition.xy-medOrb1Pos))*eye1pre;
  let medOrbFace=smoothstep(0.22,0.48,normal.z)*smoothstep(0.06,0.02,abs(normal.x))*smoothstep(0.08,-0.10,abs(normal.y));
  let medOrbSSSLight=max(0.0,-dot(normal,lightDir))*max(medOrb0,medOrb1)*medOrbFace*medOrbSSSGate;
  lit=clamp(lit+vec3<f32>(0.70,0.22,0.14)*medOrbSSSLight*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Bicipital tendon distal insertion elbow hollow: the distal biceps tendon inserts into the radial tuberosity creating a groove on the medial-anterior elbow — a shadow hollow at the antecubital fossa medial margin; gives the inner elbow crease its central hollow that is the dominant shadow at the front of the flexed elbow
  let bicipTendInsGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.16;
  let bicipTendInsY=smoothstep(elbowY-crownEyeW*0.06,elbowY+crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.06,elbowY+crownEyeW*0.18,input.worldPosition.y));
  let bicipTendInsLat=smoothstep(crownEyeW*0.86,crownEyeW*0.68,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.68,crownEyeW*0.50,abs(input.worldPosition.x)));
  let bicipTendInsFwd=smoothstep(0.28,0.54,normal.z)*smoothstep(0.04,-0.18,normal.y)*smoothstep(0.20,0.38,abs(normal.x))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-bicipTendInsY*bicipTendInsLat*bicipTendInsFwd*bicipTendInsGate*0.22);
  // Calcaneal tendon full Achilles width highlight: the Achilles tendon at the posterior ankle is a wide robust structure that catches a broad posterior highlight — gives the lower leg its characteristic posterior "tendon band" visible from behind; wider and flatter than the calcaneal groove shadow; the full Achilles cross-section catching back light
  let achilWidthGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.20;
  let achilWidthY=smoothstep(crownEyeW*0.60,crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.36,crownEyeW*0.14,input.worldPosition.y));
  let achilWidthLat=smoothstep(crownEyeW*0.56,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.00,abs(input.worldPosition.x)));
  let achilWidthBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.24,0.48,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  let achilWidthSpec=pow(max(dot(normal,halfVec),0.0),10.0)*achilWidthY*achilWidthLat*achilWidthBack*achilWidthGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*achilWidthSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior skull lambdoid suture ridge: the lambdoid suture between the parietal and occipital bones creates a faint diagonal ridge on the posterior skull running from the vertex toward each mastoid — gives the posterior skull its characteristic diagonal surface break; adds one more anatomical skull landmark visible from behind
  let lambdoidGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.52,fv)*0.14;
  let lambdoidY=smoothstep(crownEyeY+crownEyeW*0.46,crownEyeY+crownEyeW*0.72,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.72,crownEyeY+crownEyeW*1.00,input.worldPosition.y));
  let lambdoidLat=smoothstep(crownEyeW*0.10,crownEyeW*0.50,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.50,crownEyeW*0.84,abs(input.worldPosition.x)));
  let lambdoidBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.40,0.62,normal.y)*smoothstep(0.10,0.26,abs(normal.x));
  let lambdoidSpec=pow(max(dot(normal,halfVec),0.0),40.0)*lambdoidY*lambdoidLat*lambdoidBack*lambdoidGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*lambdoidSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior elbow lateral tricep lateral head shadow: the lateral head of the triceps forms the outer posterior arm surface — creates a broad but defined shadow region on the posterior-lateral upper arm; gives the outer arm its characteristic posterior round mass that is distinct from the medial long-head; together these two tricep heads create the full horseshoe shape
  let tricepLatHdGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.18;
  let tricepLatHdY=smoothstep(elbowY+crownEyeW*0.16,elbowY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.60,elbowY+crownEyeW*1.40,input.worldPosition.y));
  let tricepLatHdLat=smoothstep(crownEyeW*0.96,crownEyeW*1.22,abs(input.worldPosition.x))*(1.0-metallic);
  let tricepLatHdBack=smoothstep(-0.14,-0.50,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.36,0.58,abs(normal.x));
  lit=lit*(1.0-tricepLatHdY*tricepLatHdLat*tricepLatHdBack*tricepLatHdGate*0.20);
  // Dorsal foot extensor hallucis longus tendon ridge: the extensor hallucis longus tendon is visible on the dorsal foot running from the lower shin to the big toe — creates a visible medial tendon ridge on the top of the foot; gives the foot its central tendon detail; distinct from the extensor digitorum that covers the lateral foot
  let extHallGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.48,fv)*0.16;
  let extHallY=smoothstep(crownEyeW*0.52,crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.10,input.worldPosition.y));
  let extHallLat=smoothstep(crownEyeW*0.62,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*0.86,abs(input.worldPosition.x)));
  let extHallFace=smoothstep(0.44,0.70,normal.y)*smoothstep(0.08,0.02,abs(normal.z))*smoothstep(0.12,0.04,abs(normal.x));
  let extHallSpec=pow(max(dot(normal,halfVec),0.0),44.0)*extHallY*extHallLat*extHallFace*extHallGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*extHallSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral hip tensor fasciae latae (TFL) rounded mass specular: the TFL creates a small rounded muscular mass at the lateral anterior hip just below the ASIS — a small forward-facing bump specular at the upper outer thigh; gives the hip silhouette its characteristic anterior-lateral protrusion that separates it from the gluteal mass behind
  let tflGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.20;
  let tflY=smoothstep(crownEyeY-crownEyeW*1.82,crownEyeY-crownEyeW*1.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY-crownEyeW*1.40,input.worldPosition.y));
  let tflLat=smoothstep(crownEyeW*0.86,crownEyeW*1.12,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.12,crownEyeW*1.32,abs(input.worldPosition.x)));
  let tflFace=smoothstep(0.30,0.56,normal.z)*smoothstep(0.20,0.40,normal.y)*smoothstep(0.16,0.32,abs(normal.x));
  let tflSpec=pow(max(dot(normal,halfVec),0.0),24.0)*tflY*tflLat*tflFace*tflGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*tflSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Supraorbital notch brow medial shadow: the supraorbital notch or foramen is a small indentation in the supraorbital rim above the medial orbit — creates a small shadow pocket at the brow-nose bridge junction; gives the brow its medial end shadow that makes the inner brow feel anchored to the bone; visible on strong-browed characters
  let supraNtchGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let supraNtch0Pos=vec2<f32>(scene.eye0.x-scene.eye0.w*0.50,scene.eye0.y+scene.eye0.w*1.30);
  let supraNtch1Pos=vec2<f32>(scene.eye1.x+scene.eye1.w*0.50,scene.eye1.y+scene.eye1.w*1.30);
  let supraNtch0=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(input.worldPosition.xy-supraNtch0Pos))*eye0pre;
  let supraNtch1=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(input.worldPosition.xy-supraNtch1Pos))*eye1pre;
  let supraNtchFace=smoothstep(0.26,0.52,normal.z)*smoothstep(0.30,0.52,normal.y)*smoothstep(0.06,0.01,abs(normal.x));
  lit=lit*(1.0-max(supraNtch0,supraNtch1)*supraNtchFace*supraNtchGate*0.22);
  // Midfoot transverse arch dorsal highlight: the transverse arch of the midfoot creates a dorsal highlight band running laterally across the midfoot — gives the foot its medial arch character; the top of the midfoot arch catches key light as the dorsal surface curves upward from toes toward the ankle
  let midFtArchGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*0.18;
  let midFtArchY=smoothstep(crownEyeW*0.26,crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.16,crownEyeW*0.08,input.worldPosition.y));
  let midFtArchLat=smoothstep(crownEyeW*0.60,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.14,abs(input.worldPosition.x)));
  let midFtArchFace=smoothstep(0.46,0.72,normal.y)*smoothstep(0.08,0.02,abs(normal.z))*smoothstep(0.10,0.04,abs(normal.x));
  let midFtArchSpec=pow(max(dot(normal,halfVec),0.0),16.0)*midFtArchY*midFtArchLat*midFtArchFace*midFtArchGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*midFtArchSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ischial tuberosity sitting bone shadow: the ischial tuberosity is the bony protrusion at the base of the pelvis that bears weight when sitting — creates a bilateral shadow at the lowest posterior pelvis; gives the pelvis base its anatomical structure visible from behind; adds the final pelvic landmark below the subgluteal crease
  let ischialGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.16;
  let ischialY=crownEyeY-crownEyeW*2.22;
  let ischialLat=crownEyeW*0.56;
  let ischial0=smoothstep(crownEyeW*0.08,crownEyeW*0.02,length(vec2<f32>(abs(input.worldPosition.x)-ischialLat,input.worldPosition.y-ischialY)));
  let ischialFace=smoothstep(-0.24,-0.60,normal.z)*smoothstep(0.08,-0.16,normal.y)*smoothstep(0.18,0.36,abs(normal.x));
  lit=lit*(1.0-ischial0*ischialFace*ischialGate*0.22);
  // Posterior soleus lower calf bulk shadow: the soleus is the deep flat muscle under the gastrocnemius that creates a broader, lower, more medial calf shadow below the gastrocnemius belly — gives the lower calf its characteristic two-layer depth; the soleus shadow sits lower and wider than the gastrocnemius highlight above
  let soleusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let soleusY=smoothstep(kneeY-crownEyeW*1.14,kneeY-crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.80,kneeY-crownEyeW*0.50,input.worldPosition.y));
  let soleusLat=smoothstep(crownEyeW*0.70,crownEyeW*1.00,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.00,crownEyeW*1.22,abs(input.worldPosition.x)));
  let soleusBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.10,0.04,abs(normal.y))*smoothstep(0.16,0.34,abs(normal.x));
  lit=lit*(1.0-soleusY*soleusLat*soleusBack*soleusGate*0.18);
  // Anterior neck sternohyoid muscle shadow: the sternohyoid muscles create a bilateral shadow on the anterior neck flanking the midline — gives the anterior neck its characteristic two-column structure with central groove and lateral muscle mass; complements the platysma band and thyroid cartilage already in place
  let sternohyGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.16;
  let sternohyY=smoothstep(crownEyeY-crownEyeW*1.10,crownEyeY-crownEyeW*0.76,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.76,crownEyeY-crownEyeW*0.38,input.worldPosition.y));
  let sternohyLat=smoothstep(crownEyeW*0.12,crownEyeW*0.28,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.44,abs(input.worldPosition.x)));
  let sternohyFwd=smoothstep(0.28,0.54,normal.z)*smoothstep(0.10,0.04,abs(normal.x))*smoothstep(0.10,-0.10,abs(normal.y));
  lit=lit*(1.0-sternohyY*sternohyLat*sternohyFwd*sternohyGate*0.18);
  // Lateral patellar retinaculum knee capsule highlight: the lateral patellar retinaculum is a fibrous band on the lateral aspect of the knee that creates a slight highlight on the lateral knee capsule — gives the lateral knee its fibrous capsule detail; adds a broad lateral knee soft glow that flanks the patella on the outer side
  let patRetinGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.58,toon)*specShadowMask*step(0.44,fv)*0.16;
  let patRetinY=smoothstep(kneeY+crownEyeW*0.10,kneeY+crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.30,kneeY+crownEyeW*0.52,input.worldPosition.y));
  let patRetinLat=smoothstep(crownEyeW*0.44,crownEyeW*0.68,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.68,crownEyeW*0.84,abs(input.worldPosition.x)));
  let patRetinFace=smoothstep(0.30,0.56,normal.z)*smoothstep(0.14,0.30,normal.y)*smoothstep(0.16,0.32,abs(normal.x));
  let patRetinSpec=pow(max(dot(normal,halfVec),0.0),12.0)*patRetinY*patRetinLat*patRetinFace*patRetinGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*patRetinSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior tibial artery medial ankle groove: the posterior tibial artery and tendon groove creates a faint channel shadow on the medial posterior ankle — adds the last ankle shadow groove on the inner side; gives the medial ankle its posterior groove that separates the medial malleolus from the heel; a subtle addition to ankle anatomy completeness
  let postTibArterGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.48,fv)*0.14;
  let postTibArterY=smoothstep(crownEyeW*0.40,crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.30,crownEyeW*0.20,input.worldPosition.y));
  let postTibArterLat=smoothstep(crownEyeW*0.52,crownEyeW*0.72,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.72,crownEyeW*0.88,abs(input.worldPosition.x)));
  let postTibArterFace=smoothstep(0.30,0.56,abs(normal.x))*smoothstep(-0.14,-0.44,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-postTibArterY*postTibArterLat*postTibArterFace*postTibArterGate*0.18);
  // Trochlear notch anterior elbow joint line shadow: the trochlear notch where the ulna articulates with the trochlea of the humerus creates a transverse shadow line at the front of the elbow crease — gives the antecubital fossa its characteristic horizontal crease shadow at the joint line; makes the elbow look like it genuinely has a joint that could flex
  let trochNotchGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let trochNotchBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-elbowY)/(crownEyeW*0.14+0.001));
  let trochNotchLat=smoothstep(crownEyeW*0.96,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-metallic);
  let trochNotchFwd=smoothstep(0.24,0.50,normal.z)*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-trochNotchBand*trochNotchLat*trochNotchFwd*trochNotchGate*0.24);
  // Upper arm medial intermuscular septum groove shadow: the medial intermuscular septum divides the anterior from the posterior compartment of the upper arm — creates a vertical shadow groove on the medial surface of the upper arm running from axilla to elbow; gives the medial upper arm its compartment-dividing shadow line
  let medIMSeptGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.46,fv)*0.16;
  let medIMSeptY=smoothstep(elbowY+crownEyeW*0.16,elbowY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.60,crownEyeY-crownEyeW*0.32,input.worldPosition.y));
  let medIMSeptLat=smoothstep(crownEyeW*0.86,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.06,crownEyeW*1.18,abs(input.worldPosition.x)));
  let medIMSeptFace=smoothstep(0.34,0.60,abs(normal.x))*smoothstep(0.10,-0.14,normal.z)*step(normal.x*input.worldPosition.x,0.0)*smoothstep(0.08,0.18,normal.y);
  lit=lit*(1.0-medIMSeptY*medIMSeptLat*medIMSeptFace*medIMSeptGate*0.20);
  // Cephalic vein lateral upper arm ridge shadow: the cephalic vein runs along the lateral bicipital groove on the outer upper arm — creates a faint narrow ridge shadow line on the lateral-anterior upper arm; gives the arm its subtle vascular surface detail; adds anatomical realism to the transition from shoulder to upper arm
  let cephalicVeinGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.52,fv)*0.12;
  let cephalicVeinY=smoothstep(elbowY+crownEyeW*0.30,elbowY+crownEyeW*0.80,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.80,crownEyeY-crownEyeW*0.30,input.worldPosition.y));
  let cephalicVeinLat=smoothstep(crownEyeW*0.92,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.18,abs(input.worldPosition.x)));
  let cephalicVeinFace=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(0.16,0.32,normal.z)*step(abs(normal.x),0.92)*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-cephalicVeinY*cephalicVeinLat*cephalicVeinFace*cephalicVeinGate*0.16);
  // Lower lip body posterior SSS warmth: the full body of the lower lip has very thin skin over the orbicularis oris muscle and shows warm SSS when back-lit — creates a warm glow over the lower lip; gives the mouth area its characteristic "glowing lips" look present in anime/game characters; Incineroar, Mewtwo show this lip warmth
  let lowerLipSSSGate=muzzleBlend*organicSkin*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.10,0.28,toon)*step(0.38,fv)*0.20;
  let lowerLipSSSY=smoothstep(crownEyeW*0.06,crownEyeW*0.02,abs(input.worldPosition.y-(scene.mouth.y-scene.mouth.w*0.24)));
  let lowerLipSSSX=smoothstep(scene.mouth.w*0.76,scene.mouth.w*0.24,abs(input.worldPosition.x));
  let lowerLipSSSFace=smoothstep(0.28,0.54,normal.z)*smoothstep(0.10,-0.10,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let lowerLipSSS=max(0.0,-dot(normal,lightDir))*lowerLipSSSY*lowerLipSSSX*lowerLipSSSFace*lowerLipSSSGate;
  lit=clamp(lit+vec3<f32>(0.76,0.24,0.16)*lowerLipSSS*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior superior transverse tibial ridge: the posterior surface of the upper tibia has a slight transverse ridge where the tibial condyles transition to the shaft — creates a horizontal shadow line at the posterior upper shin; gives the posterior knee-to-shin transition an additional anatomical landmark; the posterior tibial plateau edge
  let postTibRidgeGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.44,fv)*0.16;
  let postTibRidgeBand=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-(kneeY-crownEyeW*0.28))/(crownEyeW*0.12+0.001));
  let postTibRidgeLat=smoothstep(crownEyeW*0.48,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*0.96,abs(input.worldPosition.x)));
  let postTibRidgeBack=smoothstep(-0.16,-0.50,normal.z)*smoothstep(0.12,0.30,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-postTibRidgeBand*postTibRidgeLat*postTibRidgeBack*postTibRidgeGate*0.18);
  // Upper eyelid cilia shadow gradient on iris: the eyelashes above the pupil cast a soft shadow gradient over the upper portion of the iris — creates the characteristic "iris shadow from lashes" present on every high-quality anime eye; a soft shadow gradient that darkens the upper portion of the iris; makes the iris look like it is inside a spherical eye under a real eyelid
  let lashCastShadGate=(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.30;
  let lashCastShad0=smoothstep(scene.eye0.w*0.06,scene.eye0.w*0.22,input.worldPosition.y-scene.eye0.y)*smoothstep(scene.eye0.w*0.66,scene.eye0.w*0.22,abs(input.worldPosition.x-scene.eye0.x))*eye0pre*irisBlend;
  let lashCastShad1=smoothstep(scene.eye1.w*0.06,scene.eye1.w*0.22,input.worldPosition.y-scene.eye1.y)*smoothstep(scene.eye1.w*0.66,scene.eye1.w*0.22,abs(input.worldPosition.x-scene.eye1.x))*eye1pre*irisBlend;
  let lashCastShadFace=smoothstep(0.24,0.50,normal.z)*smoothstep(0.06,0.01,abs(normal.x))*smoothstep(0.06,0.01,abs(normal.y));
  lit=lit*(1.0-max(lashCastShad0,lashCastShad1)*lashCastShadFace*lashCastShadGate*0.28);
  // Anterolateral acromial shoulder tip specular: the anterolateral corner of the acromion process catches the key light from a slightly front-angled view — the acromion tip specular from the front-side that is visible in the character's standard 3/4 front pose; gives the shoulder its characteristic angular acromion tip catch-light visible in most Pokemon/anime game pose renders
  let acromAntLatGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*0.24;
  let acromAntLatY=smoothstep(crownEyeY-crownEyeW*0.34,crownEyeY-crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.16,crownEyeY+crownEyeW*0.02,input.worldPosition.y));
  let acromAntLatLat=smoothstep(crownEyeW*1.02,crownEyeW*1.26,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.26,crownEyeW*1.46,abs(input.worldPosition.x)));
  let acromAntLatFace=smoothstep(0.30,0.56,normal.z)*smoothstep(0.28,0.46,normal.y)*smoothstep(0.16,0.32,abs(normal.x));
  let acromAntLatSpec=pow(max(dot(normal,halfVec),0.0),52.0)*acromAntLatY*acromAntLatLat*acromAntLatFace*acromAntLatGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*acromAntLatSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior cervical spine multi-segment groove array: the cervical vertebrae create a series of aligned posterior shadow dots/grooves down the back of the neck — gives the posterior neck its vertebral column detail that shows the spine running down the midline; each spinous process creates a small posterior shadow; visible on Gardevoir, Mewtwo posterior
  let cervSpineGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.50,fv)*0.14;
  let cervSpineY=smoothstep(crownEyeY-crownEyeW*1.16,crownEyeY-crownEyeW*0.82,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.82,crownEyeY-crownEyeW*0.44,input.worldPosition.y));
  let cervSpineX=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.x));
  let cervSpineWave=sin(input.worldPosition.y*scale*5.60+fv*1.20)*0.5+0.5;
  let cervSpineDots=smoothstep(0.72,0.86,cervSpineWave)*(1.0-smoothstep(0.86,1.00,cervSpineWave));
  let cervSpineBack=smoothstep(-0.16,-0.52,normal.z)*smoothstep(0.22,0.46,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-cervSpineDots*cervSpineY*cervSpineX*cervSpineBack*cervSpineGate*0.18);
  // Inner iris radial spoke highlight: the iris has radial spoke-like fibers that create a subtle radial texture — within the iris zone, adds a soft radial highlight pattern emanating from the pupil; gives iris depth and texture that distinguishes it from a flat colored disc; visible in all high-quality anime/game eyes
  let irisRadGate=(1.0-metallic)*smoothstep(0.50,0.72,toon)*0.16;
  let irisRad0Dist=length(input.worldPosition.xy-scene.eye0.xy);
  let irisRad1Dist=length(input.worldPosition.xy-scene.eye1.xy);
  let irisRad0Zone=smoothstep(scene.eye0.w*0.26,scene.eye0.w*0.30,irisRad0Dist)*(1.0-smoothstep(scene.eye0.w*0.60,scene.eye0.w*0.64,irisRad0Dist))*eye0pre*irisBlend;
  let irisRad1Zone=smoothstep(scene.eye1.w*0.26,scene.eye1.w*0.30,irisRad1Dist)*(1.0-smoothstep(scene.eye1.w*0.60,scene.eye1.w*0.64,irisRad1Dist))*eye1pre*irisBlend;
  let irisRadAngle0=atan2(input.worldPosition.y-scene.eye0.y,input.worldPosition.x-scene.eye0.x);
  let irisRadAngle1=atan2(input.worldPosition.y-scene.eye1.y,input.worldPosition.x-scene.eye1.x);
  let irisRadSpoke0=pow(abs(sin(irisRadAngle0*8.0+fv*3.14159)),16.0)*irisRad0Zone;
  let irisRadSpoke1=pow(abs(sin(irisRadAngle1*8.0+fv*3.14159)),16.0)*irisRad1Zone;
  let irisRadFace=smoothstep(0.24,0.50,normal.z)*smoothstep(0.04,0.01,abs(normal.x))*smoothstep(0.04,0.01,abs(normal.y));
  lit=clamp(lit+vec3<f32>(0.94,0.94,0.96)*max(irisRadSpoke0,irisRadSpoke1)*irisRadFace*irisRadGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal thumb abductor pollicis longus tendon ridge: the abductor pollicis longus tendon is visible on the dorsal-radial wrist as it runs to the base of the thumb — gives the thumb-side wrist its characteristic tendon ridge visible on lean hands; part of the dorsal thumb snuffbox anatomy
  let abdPollGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.46,fv)*0.14;
  let abdPollY=smoothstep(wristY+crownEyeW*0.16,wristY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.10,wristY-crownEyeW*0.30,input.worldPosition.y));
  let abdPollLat=smoothstep(crownEyeW*0.86,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.06,crownEyeW*1.20,abs(input.worldPosition.x)));
  let abdPollFace=smoothstep(0.34,0.60,normal.y)*smoothstep(0.14,0.28,abs(normal.x))*smoothstep(0.12,0.04,abs(normal.z));
  let abdPollSpec=pow(max(dot(normal,halfVec),0.0),56.0)*abdPollY*abdPollLat*abdPollFace*abdPollGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*abdPollSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior popliteal neurovascular bundle ambient shadow: the popliteal fossa at the back of the knee contains vessels and nerves that create a soft diffuse shadow in the popliteal hollow — a broad soft shadow zone at the back of the knee that is deeper and softer than the sharp crease shadows already present; gives the knee-back its volumetric depth
  let poplVascGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let poplVascY=smoothstep(kneeY-crownEyeW*0.20,kneeY+crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.10,kneeY+crownEyeW*0.40,input.worldPosition.y));
  let poplVascX=smoothstep(crownEyeW*0.46,crownEyeW*0.18,abs(input.worldPosition.x));
  let poplVascBack=smoothstep(-0.22,-0.60,normal.z)*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-poplVascY*poplVascX*poplVascBack*poplVascGate*0.20);
  // Posterior upper arm cutaneous shadow boundary: the posterior arm's fat pad creates a soft shadow boundary separating the back of the triceps from the arm's lateral shadow — gives the posterior upper arm its characteristic soft shadow dividing line between the dorsal and lateral surfaces; a gentle demarcation of the posterior arm's surface
  let postArmCutGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.40,fv)*0.14;
  let postArmCutY=smoothstep(elbowY+crownEyeW*0.20,elbowY+crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(elbowY+crownEyeW*0.70,crownEyeY-crownEyeW*0.32,input.worldPosition.y));
  let postArmCutLat=smoothstep(crownEyeW*1.04,crownEyeW*1.18,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.18,crownEyeW*1.28,abs(input.worldPosition.x)));
  let postArmCutFace=smoothstep(0.04,-0.36,normal.z)*smoothstep(0.18,0.36,abs(normal.x))*smoothstep(0.10,0.04,abs(normal.y));
  lit=lit*(1.0-postArmCutY*postArmCutLat*postArmCutFace*postArmCutGate*0.18);
  // Lateral crus antihelix outer ear hollow: the lateral crus of the antihelix creates a shadow hollow on the outer ear lateral face — gives ears a second inner-ear shadow detail on the lateral/front side; visible on large upright ears; complements the antihelix posterior highlight
  let latCrusGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.38,fv)*0.16;
  let latCrusY=smoothstep(earTopY-crownEyeW*0.50,earTopY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(earTopY-crownEyeW*0.10,earTopY+crownEyeW*0.20,input.worldPosition.y));
  let latCrusLat=smoothstep(crownEyeW*0.90,crownEyeW*1.14,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.14,crownEyeW*1.36,abs(input.worldPosition.x)));
  let latCrusFwd=smoothstep(0.10,-0.30,normal.z)*smoothstep(0.18,0.38,abs(normal.x))*smoothstep(0.20,0.40,normal.y);
  lit=lit*(1.0-latCrusY*latCrusLat*latCrusFwd*latCrusGate*0.18);
  // Dorsal great toe nail bed highlight: the nail of the great toe catches a bright specular — even at creature scale, the nail/claw tip on the big toe creates an identifying highlight; gives the foot its toe-nail detail that distinguishes it from a featureless foot stump; present on characters with visible individual toe structures
  let greatToeNailGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,toon)*specShadowMask*step(0.44,fv)*0.16;
  let greatToeNailY=smoothstep(crownEyeW*0.12,crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(crownEyeW*0.06,crownEyeW*0.0,input.worldPosition.y));
  let greatToeNailLat=smoothstep(crownEyeW*0.68,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*0.96,abs(input.worldPosition.x)));
  let greatToeNailFace=smoothstep(0.42,0.68,normal.y)*smoothstep(0.14,0.30,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  let greatToeNailSpec=pow(max(dot(normal,halfVec),0.0),80.0)*greatToeNailY*greatToeNailLat*greatToeNailFace*greatToeNailGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*greatToeNailSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Proximal interphalangeal finger joint row dorsal highlights: the PIP joints create a row of rounded knuckle highlights on the back of the fingers just distal to the MP knuckles — gives the hand its second row of knuckle highlights; adds depth to the finger joint array; present on characters with detailed hand anatomy
  let pipKnuckleGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.44,fv)*0.14;
  let pipKnuckleY=smoothstep(wristY-crownEyeW*0.56,wristY-crownEyeW*0.68,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.68,wristY-crownEyeW*0.80,input.worldPosition.y));
  let pipKnuckleLat=smoothstep(crownEyeW*0.68,crownEyeW*1.06,abs(input.worldPosition.x))*(1.0-metallic);
  let pipKnucklePhase=fract(abs(input.worldPosition.x)/crownEyeW*4.40+0.30)*3.14159;
  let pipKnuckleBump=pow(max(sin(pipKnucklePhase),0.0),14.0);
  let pipKnuckleFace=smoothstep(0.38,0.64,normal.y)*smoothstep(0.10,0.04,abs(normal.z))*smoothstep(0.08,0.02,abs(normal.x))*specShadowMask;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*pipKnuckleBump*pipKnuckleY*pipKnuckleLat*pipKnuckleFace*pipKnuckleGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Rectus femoris central thigh highlight: the rectus femoris is the central-most quadriceps muscle that creates an elongated specular running up the middle of the anterior thigh — gives the front of the thigh its central highlight column that is the brightest point on the anterior thigh; distinguishes it from the flanking quad muscles
  let rectusFemGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.44,fv)*0.20;
  let rectusFemY=smoothstep(kneeY+crownEyeW*0.18,kneeY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.60,kneeY+crownEyeW*1.50,input.worldPosition.y));
  let rectusFemX=smoothstep(crownEyeW*0.38,crownEyeW*0.16,abs(input.worldPosition.x));
  let rectusFemFace=smoothstep(0.30,0.56,normal.z)*smoothstep(0.24,0.44,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let rectusFemSpec=pow(max(dot(normal,halfVec),0.0),12.0)*rectusFemY*rectusFemX*rectusFemFace*rectusFemGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*rectusFemSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Masseter lateral cheek jaw muscle specular: the masseter is the powerful jaw muscle on the lateral face creating a rounded bulge on the lateral lower face — gives the jaw its characteristic masseter fullness that makes the face wider at the angle of the jaw; visible on strong-jawed characters like Incineroar, Kommo-o, Tyranitar
  let masseterGate=organicSkin*(1.0-metallic)*smoothstep(0.44,0.68,toon)*specShadowMask*step(0.40,fv)*0.20;
  let masseterY=smoothstep(crownEyeY-crownEyeW*0.80,crownEyeY-crownEyeW*0.54,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.54,crownEyeY-crownEyeW*0.28,input.worldPosition.y));
  let masseterLat=smoothstep(crownEyeW*0.58,crownEyeW*0.86,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.86,crownEyeW*1.08,abs(input.worldPosition.x)));
  let masseterFace=smoothstep(0.36,0.62,abs(normal.x))*smoothstep(0.16,0.32,normal.z)*smoothstep(0.10,0.04,abs(normal.y));
  let masseterSpec=pow(max(dot(normal,halfVec),0.0),12.0)*masseterY*masseterLat*masseterFace*masseterGate;
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*masseterSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Basilic vein medial wrist shadow: the basilic vein runs along the medial-volar wrist creating a faint shadow ridge on the inner wrist — adds the medial/ulnar-side vein shadow complementing the existing cephalic vein on the lateral arm; gives the wrist its bilateral vascular surface complexity
  let basilicVeinGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.52,fv)*0.12;
  let basilicVeinY=smoothstep(wristY+crownEyeW*0.10,wristY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.06,wristY-crownEyeW*0.20,input.worldPosition.y));
  let basilicVeinLat=smoothstep(crownEyeW*0.90,crownEyeW*1.08,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.08,crownEyeW*1.18,abs(input.worldPosition.x)));
  let basilicVeinFace=smoothstep(0.24,0.50,normal.z)*smoothstep(0.06,-0.14,normal.y)*smoothstep(0.20,0.36,abs(normal.x))*step(normal.x*input.worldPosition.x,0.0);
  lit=lit*(1.0-basilicVeinY*basilicVeinLat*basilicVeinFace*basilicVeinGate*0.16);
  // Submental soft tissue shadow: the submental region (under the chin) has soft tissue that creates a broad dark shadow under the jaw when lit from above — one of the most reliable depth cues for the head; the bottom of the jaw casts shadow down onto the upper neck and gives faces their characteristic under-chin shadow; visible on every character
  let subMentalShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.28;
  let subMentalShadY=smoothstep(scene.mouth.y-scene.mouth.w*1.60,scene.mouth.y-scene.mouth.w*1.30,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*1.30,scene.mouth.y-scene.mouth.w*0.96,input.worldPosition.y));
  let subMentalShadX=smoothstep(crownEyeW*0.60,crownEyeW*0.16,abs(input.worldPosition.x));
  let subMentalShadFwd=smoothstep(-0.14,-0.50,normal.y)*smoothstep(0.14,0.38,normal.z)*smoothstep(0.08,0.02,abs(normal.x));
  lit=lit*(1.0-subMentalShadY*subMentalShadX*subMentalShadFwd*subMentalShadGate*0.28);
  // Posterior leg sciatic-path posterior thigh SSS: the posterior thigh, where the sciatic nerve and its vascular supply run, has warm SSS visible from behind in backlit conditions — creates a warm posterior thigh SSS glow complementing the flexor-forearm and gluteal SSS; gives the posterior thigh its warm backlit glow
  let sciaticSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.16;
  let sciaticSSSY=smoothstep(kneeY+crownEyeW*0.60,crownEyeY-crownEyeW*1.86,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.86,crownEyeY-crownEyeW*1.56,input.worldPosition.y));
  let sciaticSSSX=smoothstep(crownEyeW*0.46,crownEyeW*0.18,abs(input.worldPosition.x));
  let sciaticSSSFace=smoothstep(-0.16,-0.54,normal.z)*smoothstep(0.10,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  let sciaticSSS=max(0.0,-dot(normal,lightDir))*sciaticSSSY*sciaticSSSX*sciaticSSSFace*sciaticSSSGate;
  lit=clamp(lit+vec3<f32>(0.60,0.20,0.12)*sciaticSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Trichion hairline shadow: the trichion is the superior hairline border; shadow just below the hairline arc reinforces the brow-to-hairline distance and gives the forehead its characteristic domed shadowing near the scalp
  let trichionShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let trichionShadY=smoothstep(crownEyeY+crownEyeW*0.60,crownEyeY+crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.36,crownEyeY+crownEyeW*0.10,input.worldPosition.y));
  let trichionShadX=smoothstep(crownEyeW*1.10,crownEyeW*0.24,abs(input.worldPosition.x));
  let trichionShadFwd=smoothstep(0.18,0.52,normal.y)*smoothstep(0.16,0.42,normal.z)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-trichionShadY*trichionShadX*trichionShadFwd*trichionShadGate*0.18);
  // Inferior orbital fat pad highlight: the lower eyelid fat pad compartment produces a soft convex pouch highlight just below the lid margin — one of the key under-eye realism cues that distinguishes anime and stylized quality faces
  let infOrbFatGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.20;
  let infOrbFat0Y=scene.eye0.y-scene.eye0.w*0.72;
  let infOrbFat1Y=scene.eye1.y-scene.eye1.w*0.72;
  let infOrbFat0=smoothstep(scene.eye0.w*1.20,0.0,length(vec2<f32>(input.worldPosition.x-scene.eye0.x,input.worldPosition.y-infOrbFat0Y)));
  let infOrbFat1=smoothstep(scene.eye1.w*1.20,0.0,length(vec2<f32>(input.worldPosition.x-scene.eye1.x,input.worldPosition.y-infOrbFat1Y)));
  let infOrbFatBlend=max(infOrbFat0,infOrbFat1);
  let infOrbFatFace=smoothstep(0.26,0.58,normal.z)*smoothstep(0.06,-0.16,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=clamp(lit+vec3<f32>(1.0,0.96,0.88)*infOrbFatBlend*infOrbFatFace*infOrbFatGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Temporal vein lateral orbital shadow: the superficial temporal vein branches fan upward from the lateral orbital rim; at the outer brow corner the vein creates a narrow arc-shadow — one of the most distinctive high-detail marks on quality stylized faces
  let tempVeinGate=organicSkin*(1.0-metallic)*smoothstep(0.12,0.30,toon)*step(0.40,fv)*0.14;
  let tempVeinY=smoothstep(crownEyeY-crownEyeW*0.30,crownEyeY+crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.22,crownEyeY+crownEyeW*0.62,input.worldPosition.y));
  let tempVeinLat=smoothstep(crownEyeW*0.64,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*1.04,abs(input.worldPosition.x)));
  let tempVeinFace=smoothstep(0.18,0.48,normal.z)*smoothstep(0.12,-0.08,normal.y)*smoothstep(0.28,0.48,abs(normal.x));
  lit=lit*(1.0-tempVeinY*tempVeinLat*tempVeinFace*tempVeinGate*0.14);
  // Glabella brow-compression shadow: the glabella (between the brows) has corrugator and procerus muscles that bunch the skin when furrowed, casting a central forehead crease shadow; even relaxed the glabella has a slight shadow from brow projections converging at the midline — gives characters a brooding depth between the brows
  let glabellaCompGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.26,toon)*0.20;
  let glabellaCompY=smoothstep(crownEyeY-crownEyeW*0.06,crownEyeY+crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.14,crownEyeY+crownEyeW*0.38,input.worldPosition.y));
  let glabellaCompX=smoothstep(crownEyeW*0.26,crownEyeW*0.08,abs(input.worldPosition.x));
  let glabellaCompFwd=smoothstep(0.16,0.48,normal.z)*smoothstep(0.08,0.28,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  lit=lit*(1.0-glabellaCompY*glabellaCompX*glabellaCompFwd*glabellaCompGate*0.20);
  // Malar fat pad cheek highlight: the malar fat pad sits anterior to the zygomatic arch, creating a soft rounded cheek prominence that catches strong frontal highlights in three-quarter view — the "apple of the cheek" highlight that gives cartoon faces their healthy roundness; complements the zygomatic catchlight already present
  let malarFatGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.30,toon)*0.24;
  let malarFatY=smoothstep(scene.mouth.y+scene.mouth.w*0.20,scene.mouth.y+scene.mouth.w*0.70,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.70,crownEyeY-crownEyeW*0.20,input.worldPosition.y));
  let malarFatLat=smoothstep(crownEyeW*0.44,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*1.00,abs(input.worldPosition.x)));
  let malarFatFace=smoothstep(0.24,0.60,normal.z)*smoothstep(0.08,-0.12,normal.y)*smoothstep(0.22,0.44,abs(normal.x));
  let malarFatSpec=pow(max(0.0,dot(halfVec,normal)),14.0)*malarFatY*malarFatLat*malarFatFace*malarFatGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.90)*malarFatSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal hand extensor tendon ridges: the extensor digitorum tendons run in parallel ridges from wrist to knuckle across the dorsal hand; each tendon raises a narrow highlight flank with a shadow valley between — the fine parallel tendon pattern is a hallmark of detailed hand anatomy on anime and game characters
  let extTendonGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.38,fv)*0.18;
  let extTendonY=smoothstep(wristY+crownEyeW*0.12,wristY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.04,wristY-crownEyeW*0.28,input.worldPosition.y));
  let extTendonRipple=sin(input.worldPosition.x*(scale*28.0))*0.5+0.5;
  let extTendonFace=smoothstep(0.20,0.54,normal.y)*smoothstep(0.14,0.38,normal.z)*smoothstep(0.06,0.02,abs(normal.x));
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.92)*extTendonRipple*extTendonY*extTendonFace*extTendonGate*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nasal dorsum specular ridge: the nasal bridge has a narrow bony ridge that produces a crisp specular stripe running vertically from the nasion down to the tip — the thin central nose highlight is one of the most-recognized face-quality markers in anime and stylized rendering; complements the nasal tip and nasal bridge bump normals already present
  let nasalDorsumGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.30,toon)*0.26;
  let nasalDorsumY=smoothstep(scene.mouth.y+scene.mouth.w*1.20,crownEyeY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.10,crownEyeY+crownEyeW*0.10,input.worldPosition.y));
  let nasalDorsumX=smoothstep(crownEyeW*0.12,crownEyeW*0.04,abs(input.worldPosition.x));
  let nasalDorsumFwd=smoothstep(0.48,0.82,normal.z)*smoothstep(0.04,-0.06,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  let nasalDorsumSpec=pow(max(0.0,dot(halfVec,normal)),28.0)*nasalDorsumY*nasalDorsumX*nasalDorsumFwd*nasalDorsumGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.96)*nasalDorsumSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Corrugator brow pinch shadow: the corrugator supercilii muscle pulls the medial brow down and inward, creating a characteristic shadow at the inner brow that is the primary visual cue for furrowed, concentrated, or angry expression — even relaxed faces show corrugator skin folds; this is the narrow vertical crease shadow above the inner corner of each eye
  let corrugatorGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*step(0.30,fv)*0.18;
  let corrugatorY=smoothstep(crownEyeY-crownEyeW*0.12,crownEyeY+crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.18,crownEyeY+crownEyeW*0.40,input.worldPosition.y));
  let corrugatorLat=smoothstep(crownEyeW*0.14,crownEyeW*0.30,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.30,crownEyeW*0.52,abs(input.worldPosition.x)));
  let corrugatorFwd=smoothstep(0.14,0.46,normal.z)*smoothstep(0.08,0.24,normal.y)*smoothstep(0.10,0.04,abs(normal.x));
  lit=lit*(1.0-corrugatorY*corrugatorLat*corrugatorFwd*corrugatorGate*0.18);
  // Levator labii superior cheek crease: the levator labii superioris muscle runs vertically from the infra-orbital rim down to the upper lip border, creating a subtle shadow trough lateral to the nose that deepens the nasolabial transition; distinct from the nasolabial fold (which is the fold itself) — this is the medial cheek shadow column between nose and malar region
  let levLabiiGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.18;
  let levLabiiY=smoothstep(scene.mouth.y+scene.mouth.w*0.60,scene.mouth.y+scene.mouth.w*1.40,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.40,crownEyeY-crownEyeW*0.30,input.worldPosition.y));
  let levLabiiLat=smoothstep(crownEyeW*0.20,crownEyeW*0.38,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.38,crownEyeW*0.54,abs(input.worldPosition.x)));
  let levLabiiFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(0.06,-0.10,normal.y)*smoothstep(0.10,0.28,abs(normal.x));
  lit=lit*(1.0-levLabiiY*levLabiiLat*levLabiiFwd*levLabiiGate*0.16);
  // Philtrum column highlight: the two philtrum columns (ridges of the filtrum) run vertically from the nasal septum base to the Cupid's bow peaks; they catch a fine bright specular along each crest — the twin philtrum highlights are an iconic anime face-quality feature visible on virtually every high-quality game character
  let philtrumColGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.30,toon)*0.24;
  let philtrumColY=smoothstep(scene.mouth.y+scene.mouth.w*0.80,scene.mouth.y+scene.mouth.w*1.30,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.30,scene.mouth.y+scene.mouth.w*1.80,input.worldPosition.y));
  let philtrumColLat=smoothstep(crownEyeW*0.22,crownEyeW*0.10,abs(input.worldPosition.x-crownEyeW*0.10*sign(input.worldPosition.x)))+smoothstep(crownEyeW*0.22,crownEyeW*0.10,abs(input.worldPosition.x+crownEyeW*0.10*sign(input.worldPosition.x)));
  let philtrumColFwd=smoothstep(0.44,0.76,normal.z)*smoothstep(0.04,-0.08,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  let philtrumColSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*philtrumColY*philtrumColLat*philtrumColFwd*philtrumColGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*philtrumColSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Mentolabial furrow shadow: the mentolabial sulcus is the transverse groove between the lower lip and the chin prominence; it creates a horizontal shadow crease separating the lower lip roll from the mental protuberance — complements the existing mental protuberance highlight; together they define the three-form chin: lower lip, furrow shadow, chin dome
  let mentoLabialGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let mentoLabialY=smoothstep(scene.mouth.y-scene.mouth.w*0.40,scene.mouth.y-scene.mouth.w*0.14,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.14,scene.mouth.y+scene.mouth.w*0.10,input.worldPosition.y));
  let mentoLabialX=smoothstep(crownEyeW*0.46,crownEyeW*0.12,abs(input.worldPosition.x));
  let mentoLabialFwd=smoothstep(0.16,0.50,normal.z)*smoothstep(-0.06,-0.28,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-mentoLabialY*mentoLabialX*mentoLabialFwd*mentoLabialGate*0.22);
  // Buccinator cheek plane shadow: the buccinator muscle fills the cheek between the zygomatic and mandible; its posterior edge creates the posterior cheek plane shadow that separates the front face from the side plane — the most important plane-change shadow on the face; without it faces look flat and toylike; this is the lateral cheek-to-ear shadow seen in every three-quarter portrait
  let buccinatorGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.28;
  let buccinatorY=smoothstep(scene.mouth.y-scene.mouth.w*0.40,scene.mouth.y+scene.mouth.w*0.80,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.80,crownEyeY-crownEyeW*0.24,input.worldPosition.y));
  let buccinatorLat=smoothstep(crownEyeW*0.88,crownEyeW*1.04,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.04,crownEyeW*1.22,abs(input.worldPosition.x)));
  let buccinatorFwd=smoothstep(0.10,-0.14,normal.z)*smoothstep(0.08,-0.08,abs(normal.y))*smoothstep(0.42,0.70,abs(normal.x));
  lit=lit*(1.0-buccinatorY*buccinatorLat*buccinatorFwd*buccinatorGate*0.28);
  // Parotid gland cheek bulge highlight: the parotid salivary gland sits anterior to the ear and inferior to the zygomatic arch, creating a gentle soft convexity on the posterior cheek that catches a broad highlight in three-quarter view — adds fullness to the posterior cheek profile and prevents the cheek-to-ear region from looking hollowed
  let parotidGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.30,fv)*0.16;
  let parotidY=smoothstep(scene.mouth.y+scene.mouth.w*0.20,scene.mouth.y+scene.mouth.w*0.80,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.80,crownEyeY-crownEyeW*0.40,input.worldPosition.y));
  let parotidLat=smoothstep(crownEyeW*0.76,crownEyeW*0.98,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.98,crownEyeW*1.18,abs(input.worldPosition.x)));
  let parotidFwd=smoothstep(0.06,-0.20,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.38,0.64,abs(normal.x));
  let parotidSpec=pow(max(0.0,dot(halfVec,normal)),10.0)*parotidY*parotidLat*parotidFwd*parotidGate;
  lit=clamp(lit+vec3<f32>(1.0,0.96,0.90)*parotidSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Zygomatic arch top-face catchlight: the superior surface of the zygomatic arch (cheekbone top) catches an extremely bright specular from directly overhead lighting — a narrow bright stripe that runs along the top of the cheekbone is one of the most-used stylization techniques in anime key art; it reads immediately as "good cheekbone structure"
  let zygArchTopGate=organicSkin*(1.0-metallic)*smoothstep(0.12,0.32,toon)*0.26;
  let zygArchTopY=smoothstep(crownEyeY-crownEyeW*0.54,crownEyeY-crownEyeW*0.32,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.32,crownEyeY-crownEyeW*0.14,input.worldPosition.y));
  let zygArchTopLat=smoothstep(crownEyeW*0.58,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.00,abs(input.worldPosition.x)));
  let zygArchTopFwd=smoothstep(0.46,0.76,normal.y)*smoothstep(0.04,-0.16,normal.z)*smoothstep(0.10,0.34,abs(normal.x));
  let zygArchTopSpec=pow(max(0.0,dot(halfVec,normal)),32.0)*zygArchTopY*zygArchTopLat*zygArchTopFwd*zygArchTopGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.90)*zygArchTopSpec*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior auricular shadow: the ear projects laterally from the skull; its posterior surface and the post-auricular groove (between ear and mastoid/skull) cast a deep shadow — completing the ear rendering by adding the shadow at the back-face junction; gives ears their characteristic deep recess at the attachment point
  let postAurGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let postAurY=smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.10,crownEyeY+crownEyeW*0.30,input.worldPosition.y));
  let postAurLat=smoothstep(crownEyeW*1.00,crownEyeW*1.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.16,crownEyeW*1.34,abs(input.worldPosition.x)));
  let postAurFwd=smoothstep(-0.10,-0.46,normal.z)*smoothstep(0.08,-0.08,abs(normal.y))*smoothstep(0.32,0.60,abs(normal.x));
  lit=lit*(1.0-postAurY*postAurLat*postAurFwd*postAurGate*0.24);
  // Columella nasal base shadow: the columella (the fleshy vertical strip between the nostrils at the base of the nose) projects slightly forward and downward, casting a shadow at its base onto the philtrum; this small dark arc at the nostril floor line is the precise detail that separates "generic nose" from "anatomically accurate nose" in stylized characters
  let columellaBaseGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let columellaBaseY=smoothstep(scene.mouth.y+scene.mouth.w*1.50,scene.mouth.y+scene.mouth.w*1.78,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.78,scene.mouth.y+scene.mouth.w*2.10,input.worldPosition.y));
  let columellaBaseX=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.x));
  let columellaBaseFwd=smoothstep(0.42,0.76,normal.z)*smoothstep(-0.08,-0.32,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-columellaBaseY*columellaBaseX*columellaBaseFwd*columellaBaseGate*0.22);
  // Oral commissure corner shadow: the corners of the mouth (commissures) have stacked muscle insertions (orbicularis oris, risorius, zygomaticus major, depressor anguli) that create a small shadow pit at each corner — the commissure punctum shadow is the "dot at the corner of the mouth" that is visible on every high-quality anime face, making smiles and neutral expressions feel anatomically grounded
  let oralCornerGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.26;
  let oralCornerY=smoothstep(scene.mouth.y-scene.mouth.w*0.16,scene.mouth.y+scene.mouth.w*0.10,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.10,scene.mouth.y+scene.mouth.w*0.32,input.worldPosition.y));
  let oralCornerLat=smoothstep(scene.mouth.w*0.62,scene.mouth.w*0.86,abs(input.worldPosition.x-scene.mouth.x))*(1.0-smoothstep(scene.mouth.w*0.86,scene.mouth.w*1.12,abs(input.worldPosition.x-scene.mouth.x)));
  let oralCornerFwd=smoothstep(0.20,0.54,normal.z)*smoothstep(0.04,-0.14,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  lit=lit*(1.0-oralCornerY*oralCornerLat*oralCornerFwd*oralCornerGate*0.26);
  // Chin-neck angle shadow: the cervical-mental angle (the angle between the chin and the anterior neck) creates a defined shadow line separating the chin from the neck — without this shadow the head and neck merge into a single form; this is the primary silhouette-support shadow that defines head-to-neck boundary from the frontal view
  let chinNeckAngleGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.30;
  let chinNeckAngleY=smoothstep(scene.mouth.y-scene.mouth.w*1.20,scene.mouth.y-scene.mouth.w*0.88,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.88,scene.mouth.y-scene.mouth.w*0.56,input.worldPosition.y));
  let chinNeckAngleX=smoothstep(crownEyeW*0.70,crownEyeW*0.22,abs(input.worldPosition.x));
  let chinNeckAngleFwd=smoothstep(-0.08,-0.40,normal.y)*smoothstep(0.12,0.38,normal.z)*smoothstep(0.06,0.02,abs(normal.x));
  lit=lit*(1.0-chinNeckAngleY*chinNeckAngleX*chinNeckAngleFwd*chinNeckAngleGate*0.28);
  // Supratrochlear forehead vein shadow: the supratrochlear vein ascends vertically from the medial brow up the center of the forehead; it creates a narrow shadow groove at the midline forehead when the forehead musculature is tense — the "worry vein" shadow that gives older or more stoic characters a defined central forehead groove; paired with the glabella compression for full forehead anatomy
  let supratrocVeinGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.56,fv)*0.14;
  let supratrocVeinY=smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.50,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.50,crownEyeY+crownEyeW*0.82,input.worldPosition.y));
  let supratrocVeinX=smoothstep(crownEyeW*0.07,crownEyeW*0.02,abs(input.worldPosition.x));
  let supratrocVeinFwd=smoothstep(0.22,0.56,normal.z)*smoothstep(0.12,0.34,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-supratrocVeinY*supratrocVeinX*supratrocVeinFwd*supratrocVeinGate*0.14);
  // Scleral vessel SSS warmth: the white of the eye (sclera) has superficial blood vessels that produce a warm pinkish-red SSS tint at the periphery near the limbus and canthi — gives eyes their characteristic not-quite-white warmth; the sclera is never pure white; this warm peripheral SSS makes eyes look alive rather than painted
  let scleralVesselGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*clamp(palBright-0.18,0.0,1.0)*0.16;
  let scleralVessel0=smoothstep(scene.eye0.w*1.14,scene.eye0.w*0.68,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.68,scene.eye0.w*0.44,length(input.worldPosition.xy-scene.eye0.xy)));
  let scleralVessel1=smoothstep(scene.eye1.w*1.14,scene.eye1.w*0.68,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.68,scene.eye1.w*0.44,length(input.worldPosition.xy-scene.eye1.xy)));
  let scleralVesselBlend=max(scleralVessel0,scleralVessel1);
  let scleralVesselFace=smoothstep(0.32,0.66,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.52,0.14,0.10)*scleralVesselBlend*scleralVesselFace*scleralVesselGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper lip vermilion specular arc: the upper lip vermilion (red border) has a convex anterior surface that catches a bright transverse specular arc running along the bow of the lip — the thin bright strip along the top of the upper lip is the "lip highlight" that makes mouths look full and kissable in anime; it pairs with the Cupid's bow shadow underneath for the complete upper lip form
  let upperLipSpecGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.24;
  let upperLipSpecY=smoothstep(scene.mouth.y+scene.mouth.w*0.04,scene.mouth.y+scene.mouth.w*0.22,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.22,scene.mouth.y+scene.mouth.w*0.46,input.worldPosition.y));
  let upperLipSpecX=smoothstep(scene.mouth.w*0.84,scene.mouth.w*0.44,abs(input.worldPosition.x-scene.mouth.x));
  let upperLipSpecFwd=smoothstep(0.36,0.72,normal.z)*smoothstep(-0.04,-0.22,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let upperLipSpec=pow(max(0.0,dot(halfVec,normal)),26.0)*upperLipSpecY*upperLipSpecX*upperLipSpecFwd*upperLipSpecGate;
  lit=clamp(lit+vec3<f32>(1.0,0.96,0.94)*upperLipSpec*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lower lip wet highlight arc: the lower lip has a broader convex surface than the upper lip and catches a large oval wet highlight across its center — the lower lip specular is the primary "lip gloss" cue; in anime and game rendering it is one of the most universally applied mouth details, visible on every character from Pokemon trainers to Genshin Impact heroes
  let lowerLipWetGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.28;
  let lowerLipWetY=smoothstep(scene.mouth.y-scene.mouth.w*0.50,scene.mouth.y-scene.mouth.w*0.20,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.20,scene.mouth.y+scene.mouth.w*0.06,input.worldPosition.y));
  let lowerLipWetX=smoothstep(scene.mouth.w*0.72,scene.mouth.w*0.28,abs(input.worldPosition.x-scene.mouth.x));
  let lowerLipWetFwd=smoothstep(0.36,0.72,normal.z)*smoothstep(-0.10,-0.32,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let lowerLipWetSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*lowerLipWetY*lowerLipWetX*lowerLipWetFwd*lowerLipWetGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.94)*lowerLipWetSpec*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nostril alar groove SSS warmth: the alar groove (where the nostril wing meets the cheek) is thin skin stretched over cartilage with rich subdermal vasculature — backlit or lateral lighting reveals warm red-orange SSS at the alar crease; one of the most recognizable translucency cues for realism in noses; gives the nostril its characteristic warm glow in cross-lighting
  let alarGrooveSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.18;
  let alarGrooveSSSY=smoothstep(scene.mouth.y+scene.mouth.w*1.30,scene.mouth.y+scene.mouth.w*1.72,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.72,scene.mouth.y+scene.mouth.w*2.10,input.worldPosition.y));
  let alarGrooveSSSLat=smoothstep(crownEyeW*0.12,crownEyeW*0.26,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.26,crownEyeW*0.40,abs(input.worldPosition.x)));
  let alarGrooveSSSFace=smoothstep(0.22,0.56,normal.z)*smoothstep(0.06,-0.16,normal.y)*smoothstep(0.10,0.28,abs(normal.x));
  let alarGrooveSSS=max(0.0,-dot(normal,lightDir))*alarGrooveSSSY*alarGrooveSSSLat*alarGrooveSSSFace*alarGrooveSSSGate;
  lit=clamp(lit+vec3<f32>(0.70,0.22,0.12)*alarGrooveSSS*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Occiput posterior skull dome highlight: the rear of the skull is the largest convex surface on the head; from behind it catches a broad diffuse top-light highlight on the highest point of the occiput — adds roundness to the back of the head that prevents the skull silhouette from looking flat when viewed from behind or three-quarter rear
  let occipitalDomeGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.18;
  let occipitalDomeY=smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.46,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.46,crownEyeY+crownEyeW*0.82,input.worldPosition.y));
  let occipitalDomeX=smoothstep(crownEyeW*0.80,crownEyeW*0.24,abs(input.worldPosition.x));
  let occipitalDomeFwd=smoothstep(-0.16,-0.54,normal.z)*smoothstep(0.40,0.72,normal.y)*smoothstep(0.06,0.02,abs(normal.x));
  let occipitalDomeSpec=pow(max(0.0,dot(halfVec,normal)),12.0)*occipitalDomeY*occipitalDomeX*occipitalDomeFwd*occipitalDomeGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*occipitalDomeSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Parietal eminence lateral skull highlight: the parietal eminence is the widest lateral point of the skull vault — the rounded prominence on each side of the top of the head that gives the skull its characteristic wide dome shape; catches a strong highlight from overhead lateral light; this is what prevents the top of the head from looking flat when lit from above
  let parietalEminGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let parietalEminY=smoothstep(crownEyeY+crownEyeW*0.22,crownEyeY+crownEyeW*0.56,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.56,crownEyeY+crownEyeW*0.90,input.worldPosition.y));
  let parietalEminLat=smoothstep(crownEyeW*0.52,crownEyeW*0.78,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.78,crownEyeW*1.04,abs(input.worldPosition.x)));
  let parietalEminFwd=smoothstep(-0.08,-0.32,normal.z)*smoothstep(0.36,0.66,normal.y)*smoothstep(0.20,0.46,abs(normal.x));
  let parietalEminSpec=pow(max(0.0,dot(halfVec,normal)),14.0)*parietalEminY*parietalEminLat*parietalEminFwd*parietalEminGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*parietalEminSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Frontal eminence forehead boss catchlight: the frontal eminence is the slight forward-projecting boss of the frontal bone at the mid-forehead on each side — a subtle bilateral highlight just above each brow arch; gives the forehead its characteristic twin-dome structure rather than a single flat plane; anime characters often have this drawn as two small soft glints
  let frontalEminGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let frontalEminY=smoothstep(crownEyeY-crownEyeW*0.04,crownEyeY+crownEyeW*0.26,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.26,crownEyeY+crownEyeW*0.54,input.worldPosition.y));
  let frontalEminLat=smoothstep(crownEyeW*0.18,crownEyeW*0.38,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.38,crownEyeW*0.62,abs(input.worldPosition.x)));
  let frontalEminFwd=smoothstep(0.28,0.60,normal.z)*smoothstep(0.18,0.42,normal.y)*smoothstep(0.08,0.24,abs(normal.x));
  let frontalEminSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*frontalEminY*frontalEminLat*frontalEminFwd*frontalEminGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.93)*frontalEminSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Temporal hollow shadow: the temporal fossa (the concave region of the skull between the temporal line and the zygomatic arch) recedes inward, creating a broad shadow that separates the forehead dome from the zygomatic arch — the temporal shadow is one of the primary skull-structure signals and is systematically underlit in game rendering; this extends the existing temporal fossa shadow for a broader coverage
  let tempHollowGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let tempHollowY=smoothstep(crownEyeY-crownEyeW*0.14,crownEyeY+crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.68,input.worldPosition.y));
  let tempHollowLat=smoothstep(crownEyeW*0.68,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.10,abs(input.worldPosition.x)));
  let tempHollowFwd=smoothstep(0.06,-0.20,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.34,0.62,abs(normal.x));
  lit=lit*(1.0-tempHollowY*tempHollowLat*tempHollowFwd*tempHollowGate*0.20);
  // Suprasternal notch deep shadow: the jugular notch at the top of the sternum is a concave pit between the two clavicular heads; it is one of the deepest discrete shadows on the anterior torso and immediately reads as "chest anatomy" — complements the jugular notch highlight already present with its dark shadow counterpart
  let suprasternalShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.28;
  let suprasternalShadY=smoothstep(torsoY+crownEyeW*1.62,torsoY+crownEyeW*1.88,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.88,torsoY+crownEyeW*2.10,input.worldPosition.y));
  let suprasternalShadX=smoothstep(crownEyeW*0.12,crownEyeW*0.04,abs(input.worldPosition.x));
  let suprasternalShadFwd=smoothstep(0.22,0.56,normal.z)*smoothstep(-0.06,-0.28,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-suprasternalShadY*suprasternalShadX*suprasternalShadFwd*suprasternalShadGate*0.28);
  // Clavicular head top-stripe highlight: the superior surface of the medial clavicular head (the knob visible at the top inner end of each clavicle) catches a sharp narrow specular from overhead lighting — the clavicular knob highlights are among the most instantly recognized human anatomy surface cues; together with the sternal shadow they define the shoulder-to-neck girdle
  let clavHeadSpecGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let clavHeadSpecY=smoothstep(torsoY+crownEyeW*1.74,torsoY+crownEyeW*1.98,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.98,torsoY+crownEyeW*2.16,input.worldPosition.y));
  let clavHeadSpecLat=smoothstep(crownEyeW*0.14,crownEyeW*0.28,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.44,abs(input.worldPosition.x)));
  let clavHeadSpecFwd=smoothstep(0.38,0.70,normal.y)*smoothstep(0.10,-0.10,normal.z)*smoothstep(0.08,0.24,abs(normal.x));
  let clavHeadSpec=pow(max(0.0,dot(halfVec,normal)),24.0)*clavHeadSpecY*clavHeadSpecLat*clavHeadSpecFwd*clavHeadSpecGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*clavHeadSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior neck trapezius slope shadow: the upper trapezius slopes from the C7/T1 vertebral spine outward and upward to the lateral shoulder; from the rear it creates a broad dark shadow band in the valley between the left and right trapezius ridges at the midline — completing the rear neck/shoulder anatomy by darkening the posterior cervical midline between the muscle masses
  let trapSlopeShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.24;
  let trapSlopeShadY=smoothstep(torsoY+crownEyeW*1.40,torsoY+crownEyeW*1.80,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.80,torsoY+crownEyeW*2.16,input.worldPosition.y));
  let trapSlopeShadX=smoothstep(crownEyeW*0.20,crownEyeW*0.06,abs(input.worldPosition.x));
  let trapSlopeShadFwd=smoothstep(-0.14,-0.52,normal.z)*smoothstep(0.12,-0.08,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-trapSlopeShadY*trapSlopeShadX*trapSlopeShadFwd*trapSlopeShadGate*0.22);
  // Sternal body midline specular stripe: the sternal body (corpus sterni) is a flat bone running vertically down the center of the chest; it is the most anterior midline bone of the thorax and catches a narrow bright specular from any frontal light — the central chest bone shine is a universal anatomy detail in game rendering, giving the chest its distinctive centerline definition between the pectorals
  let sternalBodyGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let sternalBodyY=smoothstep(torsoY+crownEyeW*0.60,torsoY+crownEyeW*1.20,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.20,torsoY+crownEyeW*1.60,input.worldPosition.y));
  let sternalBodyX=smoothstep(crownEyeW*0.10,crownEyeW*0.04,abs(input.worldPosition.x));
  let sternalBodyFwd=smoothstep(0.44,0.78,normal.z)*smoothstep(0.06,-0.10,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let sternalBodySpec=pow(max(0.0,dot(halfVec,normal)),30.0)*sternalBodyY*sternalBodyX*sternalBodyFwd*sternalBodyGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*sternalBodySpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior rib-cage shadow band: the posterior thorax where the rib cage curves around to the back has a shadow zone between the medial erector spinae group and the lateral scapular border; this broad posterior rib-cage shadow separates the back muscle groups and prevents the posterior torso from reading as a single flat surface
  let postRibShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let postRibShadY=smoothstep(torsoY+crownEyeW*0.40,torsoY+crownEyeW*1.20,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.20,torsoY+crownEyeW*1.80,input.worldPosition.y));
  let postRibShadLat=smoothstep(crownEyeW*0.36,crownEyeW*0.58,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.58,crownEyeW*0.80,abs(input.worldPosition.x)));
  let postRibShadFwd=smoothstep(-0.12,-0.46,normal.z)*smoothstep(0.08,-0.10,abs(normal.y))*smoothstep(0.10,0.38,abs(normal.x));
  lit=lit*(1.0-postRibShadY*postRibShadLat*postRibShadFwd*postRibShadGate*0.18);
  // Iliocostalis lumbar ridge highlight: the iliocostalis is the lateral column of the erector spinae group; it creates a rounded ridge running vertically along the lateral lumbar back between the 12th rib and the iliac crest; this lateral back ridge catches a specular and is the visible surface anatomy of the back muscles on lean characters
  let iliocostalisGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.34,fv)*0.18;
  let iliocostalisY=smoothstep(torsoY-crownEyeW*0.20,torsoY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.60,torsoY+crownEyeW*1.20,input.worldPosition.y));
  let iliocostalisLat=smoothstep(crownEyeW*0.32,crownEyeW*0.50,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.50,crownEyeW*0.68,abs(input.worldPosition.x)));
  let iliocostalisFwd=smoothstep(-0.14,-0.50,normal.z)*smoothstep(0.08,-0.08,abs(normal.y))*smoothstep(0.22,0.44,abs(normal.x));
  let iliocostalisSpec=pow(max(0.0,dot(halfVec,normal)),16.0)*iliocostalisY*iliocostalisLat*iliocostalisFwd*iliocostalisGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*iliocostalisSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Xiphoid process undercut shadow: the xiphoid process at the inferior end of the sternum has a sharp inferior edge that casts a small shadow onto the epigastric region just below; it creates the subtle "V-notch" dark punctuation point between the two rectus abdominis muscle bellies at the top of the abdomen — a small but distinctive detail visible on defined characters
  let xiphoidShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.36,fv)*0.18;
  let xiphoidShadY=smoothstep(torsoY+crownEyeW*0.42,torsoY+crownEyeW*0.62,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.62,torsoY+crownEyeW*0.80,input.worldPosition.y));
  let xiphoidShadX=smoothstep(crownEyeW*0.10,crownEyeW*0.03,abs(input.worldPosition.x));
  let xiphoidShadFwd=smoothstep(0.34,0.68,normal.z)*smoothstep(-0.08,-0.30,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-xiphoidShadY*xiphoidShadX*xiphoidShadFwd*xiphoidShadGate*0.18);
  // Subscapular fossa posterior shadow: the anterior (subscapular) surface of the scapula faces the rear rib cage; the inferior scapular angle produces a shadow on the posterior thorax just medial and inferior to the scapular tip — this posterior scapular shadow is one of the primary back-anatomy depth cues in three-quarter rear view; complements the scapular inferior angle highlight
  let subscapFossaGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let subscapFossaY=smoothstep(torsoY+crownEyeW*0.56,torsoY+crownEyeW*1.00,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.00,torsoY+crownEyeW*1.40,input.worldPosition.y));
  let subscapFossaLat=smoothstep(crownEyeW*0.26,crownEyeW*0.48,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.48,crownEyeW*0.70,abs(input.worldPosition.x)));
  let subscapFossaFwd=smoothstep(-0.10,-0.44,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.16,0.40,abs(normal.x));
  lit=lit*(1.0-subscapFossaY*subscapFossaLat*subscapFossaFwd*subscapFossaGate*0.18);
  // Anterior axillary fold muscle crease: the anterior axillary fold is the anterior border of the axilla formed by the pectoralis major muscle curving around to its humeral insertion; in three-quarter front view it creates a curving crease shadow from the lower pectoral to the upper inner arm — the "arm pit crease" that defines the junction of chest and arm anatomy
  let antAxFoldGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let antAxFoldY=smoothstep(torsoY+crownEyeW*1.16,torsoY+crownEyeW*1.56,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.56,torsoY+crownEyeW*1.88,input.worldPosition.y));
  let antAxFoldLat=smoothstep(crownEyeW*0.64,crownEyeW*0.84,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.84,crownEyeW*1.04,abs(input.worldPosition.x)));
  let antAxFoldFwd=smoothstep(0.14,0.46,normal.z)*smoothstep(0.08,-0.08,abs(normal.y))*smoothstep(0.28,0.52,abs(normal.x));
  lit=lit*(1.0-antAxFoldY*antAxFoldLat*antAxFoldFwd*antAxFoldGate*0.20);
  // Posterior axillary fold shadow: the posterior axillary fold is the posterior border of the axilla formed by teres major and the latissimus dorsi curving to their humeral insertions; it creates a curving shadow from the lower lat border to the upper posterior arm — completing the arm-pit anatomy with both anterior and posterior fold shadows
  let postAxFoldGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let postAxFoldY=smoothstep(torsoY+crownEyeW*1.06,torsoY+crownEyeW*1.46,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.46,torsoY+crownEyeW*1.78,input.worldPosition.y));
  let postAxFoldLat=smoothstep(crownEyeW*0.56,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.76,crownEyeW*0.96,abs(input.worldPosition.x)));
  let postAxFoldFwd=smoothstep(-0.06,-0.38,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.30,0.56,abs(normal.x));
  lit=lit*(1.0-postAxFoldY*postAxFoldLat*postAxFoldFwd*postAxFoldGate*0.18);
  // Popliteal skin fold posterior knee crease: the popliteal fossa at the back of the knee has transverse skin creases at the joint line where the skin folds during flexion; even in a straight pose a subtle shadow crease at the mid-popliteal marks the knee joint — completing the existing popliteal fossa shadow with the skin-fold crease detail
  let poplCreaseGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let poplCreaseY=smoothstep(kneeY+crownEyeW*0.06,kneeY+crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.16,kneeY+crownEyeW*0.30,input.worldPosition.y));
  let poplCreaseX=smoothstep(crownEyeW*0.48,crownEyeW*0.14,abs(input.worldPosition.x));
  let poplCreaseFwd=smoothstep(-0.14,-0.52,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-poplCreaseY*poplCreaseX*poplCreaseFwd*poplCreaseGate*0.20);
  // Dorsal foot extensor retinaculum highlight: the superior extensor retinaculum is a transverse band that crosses the front of the ankle binding the extensor tendons; it creates a narrow raised highlight band across the anterior ankle above the talo-crural joint — adds the ankle banding detail that is characteristic of detailed foot anatomy in high-quality game characters
  let dorsalRetinGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.38,fv)*0.18;
  let dorsalRetinY=smoothstep(shinRidgeY+crownEyeW*0.06,shinRidgeY+crownEyeW*0.18,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.18,shinRidgeY+crownEyeW*0.30,input.worldPosition.y));
  let dorsalRetinX=smoothstep(crownEyeW*0.52,crownEyeW*0.18,abs(input.worldPosition.x));
  let dorsalRetinFwd=smoothstep(0.24,0.60,normal.z)*smoothstep(-0.04,-0.22,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let dorsalRetinSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*dorsalRetinY*dorsalRetinX*dorsalRetinFwd*dorsalRetinGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*dorsalRetinSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plantar metatarsal shadow underfoot: the plantar surface of the forefoot has shadow under the metatarsal heads (the ball of the foot) where skin presses against the ground — gives the foot its characteristic plantar contact shadow visible in underfoot or elevated views; complements the existing plantar arch shadow
  let plantarMetaShadGate=organicSkin*(1.0-metallic)*smoothstep(0.06,0.18,toon)*0.18;
  let plantarMetaShadY=smoothstep(shinRidgeY-crownEyeW*0.14,shinRidgeY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY-crownEyeW*0.04,shinRidgeY+crownEyeW*0.10,input.worldPosition.y));
  let plantarMetaShadX=smoothstep(crownEyeW*0.52,crownEyeW*0.14,abs(input.worldPosition.x));
  let plantarMetaShadFwd=smoothstep(-0.32,-0.72,normal.y)*smoothstep(0.06,-0.10,abs(normal.z))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-plantarMetaShadY*plantarMetaShadX*plantarMetaShadFwd*plantarMetaShadGate*0.18);
  // Medial longitudinal arch highlight: the medial arch of the foot rises from the heel to the first metatarsal head; its highest point (the navicular tuberosity and talar head region) catches a top-of-arch specular visible in lateral and medial views — the arch highlight is what gives the foot its characteristic curved profile; without it the foot reads as flat
  let medLongArchGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.34,fv)*0.18;
  let medLongArchY=smoothstep(shinRidgeY-crownEyeW*0.08,shinRidgeY+crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.10,shinRidgeY+crownEyeW*0.26,input.worldPosition.y));
  let medLongArchLat=smoothstep(crownEyeW*0.06,crownEyeW*0.22,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.22,crownEyeW*0.40,abs(input.worldPosition.x)));
  let medLongArchFwd=smoothstep(0.20,0.52,normal.y)*smoothstep(0.04,-0.16,normal.z)*smoothstep(0.20,0.44,abs(normal.x));
  let medLongArchSpec=pow(max(0.0,dot(halfVec,normal)),16.0)*medLongArchY*medLongArchLat*medLongArchFwd*medLongArchGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*medLongArchSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Calcaneal underside heel shadow: the underside of the calcaneus (heel bone) where it contacts the ground creates a deep shadow at the plantar-posterior heel; this contact shadow anchors the heel to the ground plane visually and prevents the foot from appearing to float — the single most important grounding shadow for a character's foot
  let calcUnderShadGate=organicSkin*(1.0-metallic)*smoothstep(0.06,0.18,toon)*0.24;
  let calcUnderShadY=smoothstep(shinRidgeY-crownEyeW*0.28,shinRidgeY-crownEyeW*0.12,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY-crownEyeW*0.12,shinRidgeY+crownEyeW*0.02,input.worldPosition.y));
  let calcUnderShadX=smoothstep(crownEyeW*0.34,crownEyeW*0.10,abs(input.worldPosition.x));
  let calcUnderShadFwd=smoothstep(-0.28,-0.66,normal.y)*smoothstep(0.08,-0.10,abs(normal.z))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-calcUnderShadY*calcUnderShadX*calcUnderShadFwd*calcUnderShadGate*0.22);
  // Toe web interdigital shadow: the web spaces between the toes create narrow dark shadow tunnels at the bases of the digits; a periodic dark band where the toe bases meet the dorsal foot reads immediately as "individual toes" even at low resolution — the most important single detail that distinguishes a sculpted foot from a blob
  let toeWebShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*step(0.34,fv)*0.22;
  let toeWebShadY=smoothstep(shinRidgeY-crownEyeW*0.02,shinRidgeY+crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.10,shinRidgeY+crownEyeW*0.22,input.worldPosition.y));
  let toeWebRipple=(1.0-abs(sin(input.worldPosition.x*(scale*22.0))))*smoothstep(0.30,0.60,abs(sin(input.worldPosition.x*(scale*22.0))));
  let toeWebShadFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(-0.06,-0.22,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-toeWebShadY*toeWebRipple*toeWebShadFwd*toeWebShadGate*0.24);
  // Lateral foot border shadow strip: the lateral border of the foot (fifth metatarsal side) is narrower and lower than the medial arch; it tends to fall into shadow in three-quarter lateral views as it faces the floor — the lateral foot shadow strip defines the foot's lateral profile and makes the difference between a flat polygon foot and a volumetric one
  let latFootShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.20,toon)*0.18;
  let latFootShadY=smoothstep(shinRidgeY-crownEyeW*0.24,shinRidgeY+crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.14,shinRidgeY+crownEyeW*0.32,input.worldPosition.y));
  let latFootShadLat=smoothstep(crownEyeW*0.22,crownEyeW*0.44,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.44,crownEyeW*0.60,abs(input.worldPosition.x)));
  let latFootShadFwd=smoothstep(0.06,-0.26,normal.y)*smoothstep(0.04,-0.14,normal.z)*smoothstep(0.44,0.72,abs(normal.x));
  lit=lit*(1.0-latFootShadY*latFootShadLat*latFootShadFwd*latFootShadGate*0.18);
  // Abductor digiti minimi lateral foot ridge: the abductor digiti minimi muscle creates a fleshy ridge along the lateral border of the foot from heel to little toe — a subtle but distinctive muscle ridge that gives stylized feet their characteristic lateral convexity; catches a specular from lateral lighting; visible on barefoot characters in virtually every JRPG
  let abdDigMinGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.40,fv)*0.16;
  let abdDigMinY=smoothstep(shinRidgeY-crownEyeW*0.18,shinRidgeY+crownEyeW*0.08,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.08,shinRidgeY+crownEyeW*0.28,input.worldPosition.y));
  let abdDigMinLat=smoothstep(crownEyeW*0.28,crownEyeW*0.46,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.46,crownEyeW*0.62,abs(input.worldPosition.x)));
  let abdDigMinFwd=smoothstep(-0.04,-0.30,normal.y)*smoothstep(0.04,-0.14,normal.z)*smoothstep(0.46,0.74,abs(normal.x));
  let abdDigMinSpec=pow(max(0.0,dot(halfVec,normal)),14.0)*abdDigMinY*abdDigMinLat*abdDigMinFwd*abdDigMinGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*abdDigMinSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Thumb thenar web shadow: the web between the thumb and index finger (first dorsal interosseous muscle / first web space) creates a deep shadow trough on the dorsal hand at the thenar-index junction — the thumb-web shadow is the most prominent hand shadow, separating the thumb from the rest of the hand and immediately communicating "individual thumb" versus a mitten
  let thenarWebShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.22;
  let thenarWebShadY=smoothstep(wristY-crownEyeW*0.04,wristY-crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.16,wristY-crownEyeW*0.32,input.worldPosition.y));
  let thenarWebShadLat=smoothstep(crownEyeW*0.68,crownEyeW*0.86,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.86,crownEyeW*1.04,abs(input.worldPosition.x)));
  let thenarWebShadFwd=smoothstep(0.18,0.54,normal.y)*smoothstep(0.04,-0.16,normal.z)*smoothstep(0.18,0.40,abs(normal.x));
  lit=lit*(1.0-thenarWebShadY*thenarWebShadLat*thenarWebShadFwd*thenarWebShadGate*0.22);
  // Hypothenar ridge ulnar palm shadow: the hypothenar eminence (the fleshy pad on the ulnar/pinky side of the palm) has a lateral shadow running along its ulnar border — the hypothenar lateral shadow separates the palm from the wrist on the pinky side and gives the palm its characteristic dual-mound form (thenar + hypothenar)
  let hypothenarShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.18;
  let hypothenarShadY=smoothstep(wristY+crownEyeW*0.04,wristY-crownEyeW*0.12,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.12,wristY-crownEyeW*0.28,input.worldPosition.y));
  let hypothenarShadLat=smoothstep(crownEyeW*0.78,crownEyeW*0.96,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.96,crownEyeW*1.14,abs(input.worldPosition.x)));
  let hypothenarShadFwd=smoothstep(0.14,0.48,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.38,0.62,abs(normal.x));
  lit=lit*(1.0-hypothenarShadY*hypothenarShadLat*hypothenarShadFwd*hypothenarShadGate*0.18);
  // Palmar transverse crease shadows: the palmar creases (heart line, head line, life line) are the primary dermal flexion folds of the palm; they create shallow shadow lines running transversely across the palm; even stylized at low-detail level they communicate "this is a hand with palm creases" — the primary anatomical landmark of the palm visible on every detailed hand
  let palmarCreaseGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.44,fv)*0.16;
  let palmarCreaseY=smoothstep(wristY-crownEyeW*0.06,wristY-crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.22,wristY-crownEyeW*0.40,input.worldPosition.y));
  let palmarCreaseX=smoothstep(crownEyeW*0.72,crownEyeW*0.24,abs(input.worldPosition.x));
  let palmarCreaseLines=smoothstep(0.60,0.80,abs(sin(input.worldPosition.y*(scale*18.0)+input.worldPosition.x*(scale*4.0))));
  let palmarCreaseFwd=smoothstep(0.18,0.54,normal.z)*smoothstep(0.36,0.64,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-palmarCreaseY*palmarCreaseX*palmarCreaseLines*palmarCreaseFwd*palmarCreaseGate*0.16);
  // MCP knuckle dorsal crease shadow: the metacarpophalangeal joints have fine transverse skin creases on the dorsal surface (the "knuckle creases") that shadow during partial flexion — even fully extended hands show a faint crease shadow at each MCP; these transverse knuckle-crease shadows at the finger base row confirm "these are articulated fingers" to the viewer
  let mcpCreaseShadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.42,fv)*0.16;
  let mcpCreaseShadY=smoothstep(wristY-crownEyeW*0.30,wristY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.40,wristY-crownEyeW*0.52,input.worldPosition.y));
  let mcpCreaseShadX=smoothstep(crownEyeW*0.82,crownEyeW*0.28,abs(input.worldPosition.x));
  let mcpCreaseShadFwd=smoothstep(0.20,0.56,normal.y)*smoothstep(0.10,-0.10,normal.z)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-mcpCreaseShadY*mcpCreaseShadX*mcpCreaseShadFwd*mcpCreaseShadGate*0.16);
  // Fingertip pad SSS warmth: the fingertip pads are thin skin with dense vasculature; in side or back lighting they glow warm red-orange from subsurface scattering — the fingertip SSS glow is one of the most reliable realism signals for organic hands; anime and game art universally applies it as a warm tint at the digit tips
  let fingertipSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*smoothstep(0.10,0.28,toon)*step(0.40,fv)*0.16;
  let fingertipSSSY=smoothstep(wristY-crownEyeW*0.46,wristY-crownEyeW*0.56,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.56,wristY-crownEyeW*0.70,input.worldPosition.y));
  let fingertipSSSX=smoothstep(crownEyeW*0.86,crownEyeW*0.30,abs(input.worldPosition.x));
  let fingertipSSSFwd=smoothstep(0.18,0.54,normal.z)*smoothstep(0.08,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  let fingertipSSS=max(0.0,-dot(normal,lightDir))*fingertipSSSY*fingertipSSSX*fingertipSSSFwd*fingertipSSSGate;
  lit=clamp(lit+vec3<f32>(0.72,0.22,0.14)*fingertipSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nail bed pink SSS: the nail plate is translucent; underneath the nail the vascular nail bed glows pink-red in backlit or side-lit conditions — the pink nail bed SSS glow at the fingertip is one of the signature details that anime artists add to close-up hand shots; it is visible on virtually every Genshin Impact and Pokemon Scarlet/Violet character hand
  let nailBedSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.20,0.0,1.0)*smoothstep(0.10,0.28,toon)*step(0.46,fv)*0.14;
  let nailBedSSSY=smoothstep(wristY-crownEyeW*0.36,wristY-crownEyeW*0.44,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.44,wristY-crownEyeW*0.54,input.worldPosition.y));
  let nailBedSSSX=smoothstep(crownEyeW*0.80,crownEyeW*0.24,abs(input.worldPosition.x));
  let nailBedSSSFwd=smoothstep(0.24,0.60,normal.y)*smoothstep(0.04,-0.16,normal.z)*smoothstep(0.04,0.01,abs(normal.x));
  let nailBedSSS=max(0.0,-dot(normal,lightDir))*nailBedSSSY*nailBedSSSX*nailBedSSSFwd*nailBedSSSGate;
  lit=clamp(lit+vec3<f32>(0.80,0.26,0.22)*nailBedSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Deltoid tuberosity specular: the deltoid tuberosity is the roughened bone surface on the lateral mid-humerus where the deltoid muscle inserts; it sits at the widest point of the upper arm and catches a rounded specular from lateral lighting — the deltoid insertion highlight gives the upper arm its characteristic mid-shaft lateral brightness distinct from the shoulder and elbow ends
  let deltTuberGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.36,fv)*0.18;
  let deltTuberY=smoothstep(elbowY+crownEyeW*0.64,torsoY+crownEyeW*1.68,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.68,torsoY+crownEyeW*2.00,input.worldPosition.y));
  let deltTuberLat=smoothstep(crownEyeW*0.66,crownEyeW*0.88,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.88,crownEyeW*1.10,abs(input.worldPosition.x)));
  let deltTuberFwd=smoothstep(0.06,-0.20,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.42,0.70,abs(normal.x));
  let deltTuberSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*deltTuberY*deltTuberLat*deltTuberFwd*deltTuberGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*deltTuberSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Proximal ulna dorsal crest highlight: the posterior border of the ulna runs as a palpable crest from the olecranon all the way to the ulnar styloid; it is subcutaneous the entire length and catches a linear highlight along the posterior forearm — the ulnar crest stripe is a highly visible feature on any outstretched forearm; combined with the existing ulnar styloid it completes the dorsal forearm bony edge
  let ulnaCrestGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.16;
  let ulnaCrestY=smoothstep(wristY+crownEyeW*0.12,elbowY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.10,elbowY+crownEyeW*0.10,input.worldPosition.y));
  let ulnaCrestLat=smoothstep(crownEyeW*0.72,crownEyeW*0.90,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.90,crownEyeW*1.08,abs(input.worldPosition.x)));
  let ulnaCrestFwd=smoothstep(-0.10,-0.44,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.34,0.62,abs(normal.x));
  let ulnaCrestSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*ulnaCrestY*ulnaCrestLat*ulnaCrestFwd*ulnaCrestGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*ulnaCrestSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Patella inferior pole highlight: the inferior pole of the kneecap has a convex rounded lower surface that catches a bright specular from frontal-low lighting; the lower patella dome highlight is distinct from the upper patella superior pole already present — together they form the complete kneecap anterior form: superior highlight, inferior highlight, central facet, and surrounding shadow
  let patInfPoleGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.20;
  let patInfPoleY=smoothstep(kneeY+crownEyeW*0.04,kneeY+crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.14,kneeY+crownEyeW*0.26,input.worldPosition.y));
  let patInfPoleLat=smoothstep(crownEyeW*0.28,crownEyeW*0.08,abs(input.worldPosition.x));
  let patInfPoleFwd=smoothstep(0.34,0.68,normal.z)*smoothstep(-0.06,-0.28,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let patInfPoleSpec=pow(max(0.0,dot(halfVec,normal)),26.0)*patInfPoleY*patInfPoleLat*patInfPoleFwd*patInfPoleGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*patInfPoleSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior tibial shin crest periosteal highlight: the subcutaneous anterior border of the tibia runs from the tibial tuberosity straight to the medial malleolus; it is a sharp bony ridge with almost no soft tissue over it, producing a thin bright stripe along the front of the shin — the shin crest bright line is one of the most universally drawn anatomy details in all anime and JRPG lower-leg art
  let tibCrestGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let tibCrestY=smoothstep(shinRidgeY+crownEyeW*0.18,kneeY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.10,kneeY+crownEyeW*0.06,input.worldPosition.y));
  let tibCrestX=smoothstep(crownEyeW*0.10,crownEyeW*0.04,abs(input.worldPosition.x));
  let tibCrestFwd=smoothstep(0.42,0.76,normal.z)*smoothstep(0.06,-0.14,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let tibCrestSpec=pow(max(0.0,dot(halfVec,normal)),32.0)*tibCrestY*tibCrestX*tibCrestFwd*tibCrestGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*tibCrestSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial femoral condyle highlight: the medial condyle of the femur is a rounded knob at the medial side of the knee joint; it projects slightly more medially than the lateral condyle and catches a bright specular from frontal-medial lighting — the medial knee condyle highlight is visible in all frontal views and completes the "twin condyle" knee anatomy alongside the patella
  let medFemCondGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.18;
  let medFemCondY=smoothstep(kneeY+crownEyeW*0.12,kneeY+crownEyeW*0.26,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.26,kneeY+crownEyeW*0.42,input.worldPosition.y));
  let medFemCondLat=smoothstep(crownEyeW*0.20,crownEyeW*0.36,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.36,crownEyeW*0.52,abs(input.worldPosition.x)));
  let medFemCondFwd=smoothstep(0.22,0.56,normal.z)*smoothstep(0.06,-0.14,normal.y)*smoothstep(0.16,0.38,abs(normal.x));
  let medFemCondSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*medFemCondY*medFemCondLat*medFemCondFwd*medFemCondGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*medFemCondSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior calcaneal tendon groove shadow: the Achilles tendon narrows as it inserts into the calcaneus; on either side of the tendon there are grooves (paratendons) that create two flanking shadow lines on the posterior ankle — completing the Achilles tendon anatomy with the groove shadows flanking the existing tendon width feature; gives the posterior ankle its clean triple-form appearance
  let achillesGrooveGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*step(0.38,fv)*0.18;
  let achillesGrooveY=smoothstep(shinRidgeY+crownEyeW*0.10,shinRidgeY+crownEyeW*0.30,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.30,shinRidgeY+crownEyeW*0.52,input.worldPosition.y));
  let achillesGrooveLat=smoothstep(crownEyeW*0.08,crownEyeW*0.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.16,crownEyeW*0.26,abs(input.worldPosition.x)));
  let achillesGrooveFwd=smoothstep(-0.12,-0.50,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.10,0.34,abs(normal.x));
  lit=lit*(1.0-achillesGrooveY*achillesGrooveLat*achillesGrooveFwd*achillesGrooveGate*0.18);
  // Gracilis medial thigh shadow groove: the gracilis is a strap-like medial thigh muscle that creates a shallow shadow groove between the vastus medialis and the inner thigh adductors; the medial thigh groove shadow separates the VMO mass from the gracilis and defines the inner thigh musculature — gives the medial thigh its multi-muscle complexity instead of a single blob
  let gracilisShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*step(0.36,fv)*0.16;
  let gracilisShadY=smoothstep(kneeY+crownEyeW*0.40,crownEyeY-crownEyeW*1.70,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.70,crownEyeY-crownEyeW*1.40,input.worldPosition.y));
  let gracilisShadLat=smoothstep(crownEyeW*0.18,crownEyeW*0.30,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.30,crownEyeW*0.44,abs(input.worldPosition.x)));
  let gracilisShadFwd=smoothstep(0.14,0.48,normal.z)*smoothstep(0.06,-0.12,normal.y)*smoothstep(0.10,0.28,abs(normal.x));
  lit=lit*(1.0-gracilisShadY*gracilisShadLat*gracilisShadFwd*gracilisShadGate*0.16);
  // Peroneal longus tendon lateral ankle line: the peroneal longus tendon curves around the posterior fibular malleolus and then angles forward across the lateral foot; the tendon creates a bright curved line visible on the lateral ankle-to-midfoot region — a fine linear tendon detail that distinguishes detailed lower-leg anatomy from generic geometry
  let peronLongGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.42,fv)*0.16;
  let peronLongY=smoothstep(shinRidgeY+crownEyeW*0.12,shinRidgeY+crownEyeW*0.34,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.34,shinRidgeY+crownEyeW*0.54,input.worldPosition.y));
  let peronLongLat=smoothstep(crownEyeW*0.26,crownEyeW*0.44,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.44,crownEyeW*0.60,abs(input.worldPosition.x)));
  let peronLongFwd=smoothstep(-0.06,-0.34,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.46,0.72,abs(normal.x));
  let peronLongSpec=pow(max(0.0,dot(halfVec,normal)),24.0)*peronLongY*peronLongLat*peronLongFwd*peronLongGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*peronLongSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // First metatarsal dorsal prominence highlight: the dorsal surface of the first metatarsal (the bone behind the big toe) is subcutaneous and creates a rounded highlight on the medial dorsal foot between the arch and the first toe base — completing the dorsal foot anatomy between the extensor retinaculum (proximal) and the great toe nail (distal)
  let firstMetGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.40,fv)*0.16;
  let firstMetY=smoothstep(shinRidgeY-crownEyeW*0.04,shinRidgeY+crownEyeW*0.12,input.worldPosition.y)*(1.0-smoothstep(shinRidgeY+crownEyeW*0.12,shinRidgeY+crownEyeW*0.28,input.worldPosition.y));
  let firstMetLat=smoothstep(crownEyeW*0.04,crownEyeW*0.18,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.18,crownEyeW*0.30,abs(input.worldPosition.x)));
  let firstMetFwd=smoothstep(0.28,0.62,normal.y)*smoothstep(0.04,-0.16,normal.z)*smoothstep(0.10,0.30,abs(normal.x));
  let firstMetSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*firstMetY*firstMetLat*firstMetFwd*firstMetGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*firstMetSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Radial nerve forearm SSS warmth: the superficial branch of the radial nerve runs along the lateral-dorsal forearm from the radial head to the anatomical snuffbox; the thin skin over it and the underlying brachioradialis show warm SSS in side-lit conditions — adds a warm lateral forearm SSS glow complementing the existing cephalic vein and extensor tendon features
  let radialNerveSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.20,0.0,1.0)*smoothstep(0.10,0.28,toon)*step(0.42,fv)*0.14;
  let radialNerveSSSY=smoothstep(wristY+crownEyeW*0.14,elbowY-crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(elbowY-crownEyeW*0.14,elbowY+crownEyeW*0.06,input.worldPosition.y));
  let radialNerveSSSLat=smoothstep(crownEyeW*0.60,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.00,abs(input.worldPosition.x)));
  let radialNerveSSSFace=smoothstep(0.06,-0.24,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.40,0.66,abs(normal.x));
  let radialNerveSSS=max(0.0,-dot(normal,lightDir))*radialNerveSSSY*radialNerveSSSLat*radialNerveSSSFace*radialNerveSSSGate;
  lit=clamp(lit+vec3<f32>(0.68,0.24,0.14)*radialNerveSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Intercostal rib shadow bands: the intercostal spaces between ribs on the lateral thorax create periodic shadow bands when lit from the side — subtle repeating shadow lines that read as rib cage anatomy; visible on lean characters and is one of the most impactful "this creature is ribbed like a real animal" details in JRPG monster design
  let intercostalGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*step(0.40,fv)*0.16;
  let intercostalY=smoothstep(torsoY+crownEyeW*0.20,torsoY+crownEyeW*1.60,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.60,torsoY+crownEyeW*2.00,input.worldPosition.y));
  let intercostalLat=smoothstep(crownEyeW*0.64,crownEyeW*0.86,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.86,crownEyeW*1.08,abs(input.worldPosition.x)));
  let intercostalRipple=smoothstep(0.50,0.80,abs(sin(input.worldPosition.y*(scale*14.0))));
  let intercostalFwd=smoothstep(0.04,-0.28,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.46,0.74,abs(normal.x));
  lit=lit*(1.0-intercostalY*intercostalLat*intercostalRipple*intercostalFwd*intercostalGate*0.16);
  // Gluteus medius lateral hip highlight: the gluteus medius is visible on the lateral hip as a rounded muscle mass above the greater trochanter; it catches a strong lateral highlight that is one of the primary hip-width visual cues — the lateral hip specular is what makes creature hips look three-dimensional rather than flat in side view
  let glutMedGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.20;
  let glutMedY=smoothstep(torsoY-crownEyeW*0.30,torsoY+crownEyeW*0.20,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.20,torsoY+crownEyeW*0.70,input.worldPosition.y));
  let glutMedLat=smoothstep(crownEyeW*0.68,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.16,abs(input.worldPosition.x)));
  let glutMedFwd=smoothstep(-0.04,-0.32,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.48,0.76,abs(normal.x));
  let glutMedSpec=pow(max(0.0,dot(halfVec,normal)),14.0)*glutMedY*glutMedLat*glutMedFwd*glutMedGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*glutMedSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Biceps femoris tendon lateral knee highlight: the biceps femoris tendon inserts at the fibular head and creates a prominent cordlike tendon running diagonally down the lateral knee from posterior; it catches a strong specular visible in three-quarter lateral views — one of the most visible posterior-lateral knee anatomy landmarks and a common detail in quality JRPG character art
  let bicepsFemTenGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.40,fv)*0.18;
  let bicepsFemTenY=smoothstep(kneeY+crownEyeW*0.18,kneeY+crownEyeW*0.44,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.44,kneeY+crownEyeW*0.68,input.worldPosition.y));
  let bicepsFemTenLat=smoothstep(crownEyeW*0.28,crownEyeW*0.48,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.48,crownEyeW*0.66,abs(input.worldPosition.x)));
  let bicepsFemTenFwd=smoothstep(-0.08,-0.42,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.36,0.62,abs(normal.x));
  let bicepsFemTenSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*bicepsFemTenY*bicepsFemTenLat*bicepsFemTenFwd*bicepsFemTenGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*bicepsFemTenSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial gastrocnemius head posterior calf specular: the medial head of gastrocnemius creates a larger, more prominent bulge on the posterior calf compared to the lateral head; the medial calf dome catches a broad specular from posterior lighting — giving the calf its characteristic asymmetric dual-lobe form visible from behind
  let gastrocMedHeadGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.20;
  let gastrocMedHeadY=smoothstep(kneeY-crownEyeW*0.30,kneeY-crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.70,kneeY-crownEyeW*1.10,input.worldPosition.y));
  let gastrocMedHeadLat=smoothstep(crownEyeW*0.06,crownEyeW*0.26,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.26,crownEyeW*0.46,abs(input.worldPosition.x)));
  let gastrocMedHeadFwd=smoothstep(-0.16,-0.54,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.10,0.36,abs(normal.x));
  let gastrocMedHeadSpec=pow(max(0.0,dot(halfVec,normal)),16.0)*gastrocMedHeadY*gastrocMedHeadLat*gastrocMedHeadFwd*gastrocMedHeadGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*gastrocMedHeadSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Soleal line posterior tibia shadow: the soleal line is a diagonal ridge on the posterior tibia from which the soleus muscle originates; it creates a subtle shadow band angling across the upper posterior calf separating the gastrocnemius-soleus junction — adds the posterior calf-to-shin transition depth that prevents the posterior lower leg from reading as a featureless cylinder
  let solealLineShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*step(0.38,fv)*0.16;
  let solealLineShadY=smoothstep(kneeY-crownEyeW*0.32,kneeY-crownEyeW*0.54,input.worldPosition.y)*(1.0-smoothstep(kneeY-crownEyeW*0.54,kneeY-crownEyeW*0.76,input.worldPosition.y));
  let solealLineShadLat=smoothstep(crownEyeW*0.10,crownEyeW*0.36,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.36,crownEyeW*0.54,abs(input.worldPosition.x)));
  let solealLineShadFwd=smoothstep(-0.10,-0.46,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.14,0.40,abs(normal.x));
  lit=lit*(1.0-solealLineShadY*solealLineShadLat*solealLineShadFwd*solealLineShadGate*0.16);
  // Pectoral lower border shadow fold: the inferior border of the pectoralis major muscle creates a sharp-edged shadow fold across the lower chest where the pectoral meets the anterior torso — the pec shadow fold is one of the most visible torso anatomy features on a muscular character; it defines the chest-to-abdomen transition with a strong horizontal shadow line
  let pecBorderShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.26;
  let pecBorderShadY=smoothstep(torsoY+crownEyeW*0.82,torsoY+crownEyeW*1.06,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.06,torsoY+crownEyeW*1.26,input.worldPosition.y));
  let pecBorderShadX=smoothstep(crownEyeW*0.62,crownEyeW*0.18,abs(input.worldPosition.x));
  let pecBorderShadFwd=smoothstep(0.22,0.56,normal.z)*smoothstep(-0.08,-0.30,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-pecBorderShadY*pecBorderShadX*pecBorderShadFwd*pecBorderShadGate*0.24);
  // Infraumbilical belly shadow: just below the navel the abdomen curves forward (the lower abdominal convexity) and then drops toward the inguinal crease; the transition casts a subtle shadow on the lower abdominal wall — the lower belly shadow helps define the navel as a concave reference point and gives the lower abdomen its slightly convex "belly" form
  let infraUmbShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let infraUmbShadY=smoothstep(torsoY+crownEyeW*0.06,torsoY+crownEyeW*0.28,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.28,torsoY+crownEyeW*0.52,input.worldPosition.y));
  let infraUmbShadX=smoothstep(crownEyeW*0.52,crownEyeW*0.14,abs(input.worldPosition.x));
  let infraUmbShadFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(-0.06,-0.26,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-infraUmbShadY*infraUmbShadX*infraUmbShadFwd*infraUmbShadGate*0.20);
  // Anterior superior iliac spine highlight: the ASIS is a prominent bony point at the front of the iliac crest at the lateral hip-abdomen junction; it creates a small bright highlight on the anterior hip just lateral to the inguinal region — the ASIS highlight is the primary bone-to-hip-crease transition marker and one of the most drawn anatomy points in figure art
  let asisHighlightGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.22;
  let asisHighlightY=smoothstep(torsoY-crownEyeW*0.12,torsoY+crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.10,torsoY+crownEyeW*0.34,input.worldPosition.y));
  let asisHighlightLat=smoothstep(crownEyeW*0.56,crownEyeW*0.78,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.78,crownEyeW*1.00,abs(input.worldPosition.x)));
  let asisHighlightFwd=smoothstep(0.22,0.56,normal.z)*smoothstep(0.08,-0.10,normal.y)*smoothstep(0.20,0.44,abs(normal.x));
  let asisHighlightSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*asisHighlightY*asisHighlightLat*asisHighlightFwd*asisHighlightGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*asisHighlightSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inguinal crease shadow: the inguinal ligament runs from the ASIS to the pubic tubercle and marks the hip-thigh junction; the crease of skin above the upper thigh casts a diagonal shadow line from the lateral hip inward to the groin — the inguinal crease shadow is one of the most important anatomy landmarks distinguishing the hip from the thigh and is drawn on virtually every JRPG character
  let inguinalShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.24;
  let inguinalShadY=smoothstep(torsoY-crownEyeW*0.24,torsoY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.04,torsoY+crownEyeW*0.18,input.worldPosition.y));
  let inguinalShadX=smoothstep(crownEyeW*0.62,crownEyeW*0.22,abs(input.worldPosition.x));
  let inguinalShadFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(-0.08,-0.28,normal.y)*smoothstep(0.06,0.28,abs(normal.x));
  lit=lit*(1.0-inguinalShadY*inguinalShadX*inguinalShadFwd*inguinalShadGate*0.24);
  // Greater trochanter lateral hip bony highlight: the greater trochanter of the femur is the widest bony point on the lateral hip; it creates a rounded subcutaneous prominence that catches a bright highlight from lateral lighting — the greater trochanter highlight is the primary hip-width bone cue; combined with the gluteus medius it defines the complete lateral hip anatomy
  let gtrGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.22;
  let gtrY=smoothstep(torsoY-crownEyeW*0.44,torsoY-crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.14,torsoY+crownEyeW*0.14,input.worldPosition.y));
  let gtrLat=smoothstep(crownEyeW*0.74,crownEyeW*1.00,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.00,crownEyeW*1.24,abs(input.worldPosition.x)));
  let gtrFwd=smoothstep(-0.04,-0.30,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.52,0.80,abs(normal.x));
  let gtrSpec=pow(max(0.0,dot(halfVec,normal)),16.0)*gtrY*gtrLat*gtrFwd*gtrGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*gtrSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior gluteal fold shadow: the infragluteal fold is the crease under the buttock where the gluteus maximus meets the posterior thigh; it casts a strong shadow along the bottom of the gluteal mass — the subgluteal crease shadow is one of the most architecturally important shadows on the posterior body; without it the gluteal mass reads as a continuous blob merging into the thigh
  let postGlutFoldGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.20,toon)*0.26;
  let postGlutFoldY=smoothstep(torsoY-crownEyeW*0.56,torsoY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.36,torsoY-crownEyeW*0.14,input.worldPosition.y));
  let postGlutFoldX=smoothstep(crownEyeW*0.60,crownEyeW*0.18,abs(input.worldPosition.x));
  let postGlutFoldFwd=smoothstep(-0.12,-0.50,normal.z)*smoothstep(-0.06,-0.26,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-postGlutFoldY*postGlutFoldX*postGlutFoldFwd*postGlutFoldGate*0.26);
  // Mid-forehead transverse worry-line shadow: the frontalis muscle produces horizontal wrinkle lines across the mid-forehead; even on young characters a single faint transverse shadow band at mid-forehead height communicates "this forehead has form and texture" rather than a smooth featureless dome — the forehead wrinkle shadow is a universal stylization detail at fv-gated detail levels
  let frontWrinkleGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.52,fv)*0.14;
  let frontWrinkleY=smoothstep(crownEyeY+crownEyeW*0.24,crownEyeY+crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.36,crownEyeY+crownEyeW*0.48,input.worldPosition.y));
  let frontWrinkleX=smoothstep(crownEyeW*0.90,crownEyeW*0.22,abs(input.worldPosition.x));
  let frontWrinkleFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(0.10,0.30,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-frontWrinkleY*frontWrinkleX*frontWrinkleFwd*frontWrinkleGate*0.14);
  // Nasolabial SSS warmth: the nasolabial fold and adjacent medial cheek have thin skin with dense vascular dermis; they produce a warm pink SSS tint at the base of the nose and upper mouth region visible in frontal lighting — the nasolabial warmth glow is a key realism signal for the "living face" look in anime; the cheek-to-nose area should always feel warmer than the cheekbone
  let nasoLabSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.16,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.18;
  let nasoLabSSSY=smoothstep(scene.mouth.y+scene.mouth.w*0.50,scene.mouth.y+scene.mouth.w*1.20,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*1.20,crownEyeY-crownEyeW*0.36,input.worldPosition.y));
  let nasoLabSSSX=smoothstep(crownEyeW*0.20,crownEyeW*0.46,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.46,crownEyeW*0.66,abs(input.worldPosition.x)));
  let nasoLabSSSFwd=smoothstep(0.26,0.60,normal.z)*smoothstep(0.08,-0.10,normal.y)*smoothstep(0.08,0.24,abs(normal.x));
  let nasoLabSSS=max(0.0,dot(normal,lightDir))*nasoLabSSSY*nasoLabSSSX*nasoLabSSSFwd*nasoLabSSSGate;
  lit=clamp(lit+vec3<f32>(0.58,0.18,0.12)*nasoLabSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Upper chest pectoral SSS: the upper pectoral region has thin skin over a relatively vascular muscle bed; in backlit or cross-lit conditions the chest glows with a warm SSS contribution — applies the subsurface scattering warmth to the upper torso that rounds out the chest SSS alongside the existing arm and face SSS contributions
  let pecSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.16;
  let pecSSSY=smoothstep(torsoY+crownEyeW*1.10,torsoY+crownEyeW*1.64,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.64,torsoY+crownEyeW*2.10,input.worldPosition.y));
  let pecSSSX=smoothstep(crownEyeW*0.60,crownEyeW*0.16,abs(input.worldPosition.x));
  let pecSSSFwd=smoothstep(0.24,0.60,normal.z)*smoothstep(0.08,-0.10,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let pecSSS=max(0.0,-dot(normal,lightDir))*pecSSSY*pecSSSX*pecSSSFwd*pecSSSGate;
  lit=clamp(lit+vec3<f32>(0.60,0.20,0.14)*pecSSS*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ear tragus highlight: the tragus is the small cartilage projection in front of the ear canal opening; it is convex and subcutaneous, catching a bright lateral specular that is one of the most identifiable ear anatomy details — a small circular highlight just anterior to the ear canal entry point is drawn on nearly every anime-style ear at any detail level
  let tragusGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.20;
  let tragusY=smoothstep(crownEyeY-crownEyeW*0.60,crownEyeY-crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.40,crownEyeY-crownEyeW*0.22,input.worldPosition.y));
  let tragusLat=smoothstep(crownEyeW*1.00,crownEyeW*1.18,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.18,crownEyeW*1.34,abs(input.worldPosition.x)));
  let tragusFwd=smoothstep(0.06,-0.22,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.48,0.76,abs(normal.x));
  let tragusSpec=pow(max(0.0,dot(halfVec,normal)),24.0)*tragusY*tragusLat*tragusFwd*tragusGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*tragusSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Antihelix posterior concavity shadow: the antihelix (the inner ridge of the ear) has a posterior concave face that falls into deep shadow from lateral lighting — the dark shadow behind the antihelix is the contrast that makes the antihelix ridge visible; it is the primary ear-depth cue that prevents the ear from looking flat
  let antihelixShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let antihelixShadY=smoothstep(crownEyeY-crownEyeW*0.44,crownEyeY+crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.14,crownEyeY+crownEyeW*0.44,input.worldPosition.y));
  let antihelixShadLat=smoothstep(crownEyeW*1.06,crownEyeW*1.22,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.22,crownEyeW*1.36,abs(input.worldPosition.x)));
  let antihelixShadFwd=smoothstep(0.02,-0.26,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.52,0.80,abs(normal.x));
  lit=lit*(1.0-antihelixShadY*antihelixShadLat*antihelixShadFwd*antihelixShadGate*0.24);
  // Pinna helix rim specular: the outer rim (helix) of the ear is a rolled cartilage edge that catches a thin bright specular line along its outer border from lateral lighting — the helix rim highlight wraps around the outer ear and is the primary stylization feature that makes animated ears read as ear-shaped; without it ears look like blobs of skin
  let helixRimGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.24;
  let helixRimY=smoothstep(crownEyeY-crownEyeW*0.56,crownEyeY+crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.36,crownEyeY+crownEyeW*0.58,input.worldPosition.y));
  let helixRimLat=smoothstep(crownEyeW*1.14,crownEyeW*1.30,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.30,crownEyeW*1.46,abs(input.worldPosition.x)));
  let helixRimFwd=smoothstep(-0.04,-0.30,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.56,0.84,abs(normal.x));
  let helixRimSpec=pow(max(0.0,dot(halfVec,normal)),28.0)*helixRimY*helixRimLat*helixRimFwd*helixRimGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*helixRimSpec*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Earlobe inferior SSS warmth: the earlobe is the fattiest, most vascular part of the external ear; it has the strongest SSS of any ear structure and glows warm red-orange in side or back lighting — the earlobe SSS glow is one of the classic anime skin-realism details; visible on essentially every high-quality game character ear from Pokemon to Genshin Impact
  let earlobeSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.16,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.20;
  let earlobeSSSY=smoothstep(crownEyeY-crownEyeW*0.86,crownEyeY-crownEyeW*0.62,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.62,crownEyeY-crownEyeW*0.40,input.worldPosition.y));
  let earlobeSSSLat=smoothstep(crownEyeW*1.08,crownEyeW*1.26,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.26,crownEyeW*1.44,abs(input.worldPosition.x)));
  let earlobeSSSFace=smoothstep(0.06,-0.28,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.52,0.80,abs(normal.x));
  let earlobe=max(0.0,-dot(normal,lightDir))*earlobeSSSY*earlobeSSSLat*earlobeSSSFace*earlobeSSSGate;
  lit=clamp(lit+vec3<f32>(0.78,0.22,0.14)*earlobe*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Conchal bowl shadow: the concha (the cup-shaped depression at the center of the ear leading to the ear canal) is the deepest shadow on the ear; it is always in deep shadow regardless of light direction — the conchal shadow is the single most important ear-depth cue and is what makes an ear look like an ear rather than a flat disc
  let conchaGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.20,toon)*0.30;
  let conchaY=smoothstep(crownEyeY-crownEyeW*0.46,crownEyeY-crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.14,crownEyeY+crownEyeW*0.14,input.worldPosition.y));
  let conchaLat=smoothstep(crownEyeW*1.04,crownEyeW*1.18,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.18,crownEyeW*1.32,abs(input.worldPosition.x)));
  let conchaFwd=smoothstep(0.04,-0.24,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.50,0.78,abs(normal.x));
  lit=lit*(1.0-conchaY*conchaLat*conchaFwd*conchaGate*0.30);
  // Ear pinna SSS backlit rim glow: the entire pinna (ear shell) is thin cartilage and skin; in backlit conditions the ear glows with a warm translucent SSS ring around its periphery — the ear backlit SSS glow is one of the most striking and universally recognizable organic skin effects; visible in practically every outdoor game scene with characters near a key light
  let pinnaSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.14,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.18;
  let pinnaSSSY=smoothstep(crownEyeY-crownEyeW*0.64,crownEyeY+crownEyeW*0.40,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.40,crownEyeY+crownEyeW*0.60,input.worldPosition.y));
  let pinnaSSSLat=smoothstep(crownEyeW*0.96,crownEyeW*1.36,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*1.36,crownEyeW*1.52,abs(input.worldPosition.x)));
  let pinnaSSSFwd=smoothstep(0.04,-0.28,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.46,0.74,abs(normal.x));
  let pinnaSSS=max(0.0,-dot(normal,lightDir))*pinnaSSSY*pinnaSSSLat*pinnaSSSFwd*pinnaSSSGate;
  lit=clamp(lit+vec3<f32>(0.70,0.24,0.16)*pinnaSSS*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral SCM neck muscle highlight: the sternocleidomastoid runs diagonally from behind the ear down to the sternoclavicular joint; its lateral surface catches a strong specular in three-quarter view — the SCM specular line is one of the most drawn neck anatomy details in figure art and game character design; it is what gives the neck its "this is not just a cylinder" reading
  let scmGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.22;
  let scmY=smoothstep(torsoY+crownEyeW*1.62,crownEyeY-crownEyeW*0.70,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.70,crownEyeY-crownEyeW*0.40,input.worldPosition.y));
  let scmLat=smoothstep(crownEyeW*0.22,crownEyeW*0.46,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.46,crownEyeW*0.70,abs(input.worldPosition.x)));
  let scmFwd=smoothstep(0.10,-0.18,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.34,0.60,abs(normal.x));
  let scmSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*scmY*scmLat*scmFwd*scmGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*scmSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior neck hairline shadow: where the hairline meets the nape of the neck there is a shadow line from the hair casting onto the upper posterior neck; even on a creature with a crest or mane this transition reads as a shadow band along the back-of-neck at the skull base — gives the nape its characteristic "hairline shadow" that deepens the head-neck division from the rear
  let napeHairShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let napeHairShadY=smoothstep(crownEyeY-crownEyeW*0.28,crownEyeY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.06,crownEyeY+crownEyeW*0.14,input.worldPosition.y));
  let napeHairShadX=smoothstep(crownEyeW*0.56,crownEyeW*0.18,abs(input.worldPosition.x));
  let napeHairShadFwd=smoothstep(-0.10,-0.48,normal.z)*smoothstep(0.08,-0.08,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-napeHairShadY*napeHairShadX*napeHairShadFwd*napeHairShadGate*0.20);
  // Jaw ramus angle specular: the angle of the mandible (the gonion) is a prominent bony point at the posterior inferior jaw; the bone is subcutaneous here and catches a rounded specular from lateral-anterior lighting — the jaw-angle highlight frames the lower face-to-neck transition and gives the jaw its characteristic angular bony mass
  let jawAngleGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.20;
  let jawAngleY=smoothstep(scene.mouth.y-scene.mouth.w*0.60,scene.mouth.y-scene.mouth.w*0.24,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.24,scene.mouth.y+scene.mouth.w*0.12,input.worldPosition.y));
  let jawAngleLat=smoothstep(crownEyeW*0.70,crownEyeW*0.92,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.92,crownEyeW*1.14,abs(input.worldPosition.x)));
  let jawAngleFwd=smoothstep(0.08,-0.20,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.38,0.64,abs(normal.x));
  let jawAngleSpec=pow(max(0.0,dot(halfVec,normal)),16.0)*jawAngleY*jawAngleLat*jawAngleFwd*jawAngleGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*jawAngleSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial canthus tear lake sparkle: the lacrimal lake at the medial eye corner has a concave fluid surface that catches a small bright specular sparkle — distinct from the main iris catchlight; the medial tear lake sparkle is the "wet inner corner" detail that anime artists draw as a tiny white dot at the inner corner of each eye; it completes the eye's wet appearance
  let tearLakeGate=organicSkin*(1.0-metallic)*smoothstep(0.12,0.32,toon)*0.26;
  let tearLake0Pos=vec2<f32>(scene.eye0.x-scene.eye0.w*0.76,scene.eye0.y-scene.eye0.w*0.12);
  let tearLake1Pos=vec2<f32>(scene.eye1.x-scene.eye1.w*0.76,scene.eye1.y-scene.eye1.w*0.12);
  let tearLake0=smoothstep(scene.eye0.w*0.18,0.0,length(input.worldPosition.xy-tearLake0Pos));
  let tearLake1=smoothstep(scene.eye1.w*0.18,0.0,length(input.worldPosition.xy-tearLake1Pos));
  let tearLakeBlend=max(tearLake0,tearLake1);
  let tearLakeFwd=smoothstep(0.36,0.70,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.96)*tearLakeBlend*tearLakeFwd*tearLakeGate*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inferior palpebral bag SSS: just below the lower eyelid the thin palpebral skin shows vascular SSS as a faint warm-pink tint — the under-eye pink warmth is what makes eyes look youthful and alive; it is the complement to the existing inferior orbital fat pad highlight, adding the color component (warmth) to the form component (highlight)
  let palpBagSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.16,0.0,1.0)*smoothstep(0.10,0.28,toon)*0.16;
  let palpBag0Y=scene.eye0.y-scene.eye0.w*0.90;
  let palpBag1Y=scene.eye1.y-scene.eye1.w*0.90;
  let palpBag0=smoothstep(scene.eye0.w*0.96,0.0,length(vec2<f32>(input.worldPosition.x-scene.eye0.x,input.worldPosition.y-palpBag0Y)));
  let palpBag1=smoothstep(scene.eye1.w*0.96,0.0,length(vec2<f32>(input.worldPosition.x-scene.eye1.x,input.worldPosition.y-palpBag1Y)));
  let palpBagBlend=max(palpBag0,palpBag1);
  let palpBagFwd=smoothstep(0.24,0.56,normal.z)*smoothstep(0.08,-0.14,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.54,0.18,0.14)*palpBagBlend*palpBagFwd*palpBagSSSGate*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Conjunctival scleral haze reflection: the conjunctiva (moist surface over the sclera) produces a broad diffuse reflection that adds a faint blue-sky environmental tint to the white of the eye — the scleral environmental reflection is the detail that makes eyes look wet and open rather than dry and painted; the sky reflection shifts the white toward cool blue, making it feel dimensional
  let sclReflGate=organicSkin*(1.0-metallic)*smoothstep(0.12,0.30,toon)*clamp(palBright-0.20,0.0,1.0)*0.14;
  let sclRefl0=smoothstep(scene.eye0.w*1.06,0.0,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(0.0,scene.eye0.w*0.46,length(input.worldPosition.xy-scene.eye0.xy)));
  let sclRefl1=smoothstep(scene.eye1.w*1.06,0.0,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(0.0,scene.eye1.w*0.46,length(input.worldPosition.xy-scene.eye1.xy)));
  let sclReflBlend=max(sclRefl0,sclRefl1);
  let sclReflFwd=smoothstep(0.34,0.68,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.78,0.86,1.0)*sclReflBlend*sclReflFwd*sclReflGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Iris depth prismatic color fringe: the iris anterior surface refracts ambient light differently at its peripheral edge due to the corneal geometry; a subtle chromatic color shift (prismatic fringe) at the iris outer rim — the iris edge color fringe is what makes anime eyes appear to have depth and a lens-like quality rather than being flat painted circles
  let irisPrismaGate=organicSkin*(1.0-metallic)*smoothstep(0.12,0.32,toon)*clamp(palBright-0.16,0.0,1.0)*0.18;
  let irisPrisma0=smoothstep(scene.eye0.w*0.56,scene.eye0.w*0.42,length(input.worldPosition.xy-scene.eye0.xy))*(1.0-smoothstep(scene.eye0.w*0.42,scene.eye0.w*0.26,length(input.worldPosition.xy-scene.eye0.xy)));
  let irisPrisma1=smoothstep(scene.eye1.w*0.56,scene.eye1.w*0.42,length(input.worldPosition.xy-scene.eye1.xy))*(1.0-smoothstep(scene.eye1.w*0.42,scene.eye1.w*0.26,length(input.worldPosition.xy-scene.eye1.xy)));
  let irisPrismaBlend=max(irisPrisma0,irisPrisma1);
  let irisPrismaFwd=smoothstep(0.36,0.72,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=clamp(lit+vec3<f32>(0.20,0.60,1.0)*irisPrismaBlend*irisPrismaFwd*irisPrismaGate*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pupil depth core shadow: the pupil is a hole into the eye; it is physically darkest at its center and slightly lighter at the rim where light scatters off the iris root; applying a radial dark-to-less-dark gradient in the pupil zone adds the appearance of actual depth — the pupil should not be a uniform flat black circle
  let pupilDepthGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.30;
  let pupilDepth0=smoothstep(scene.eye0.w*0.22,0.0,length(input.worldPosition.xy-scene.eye0.xy));
  let pupilDepth1=smoothstep(scene.eye1.w*0.22,0.0,length(input.worldPosition.xy-scene.eye1.xy));
  let pupilDepthBlend=max(pupilDepth0,pupilDepth1);
  let pupilDepthFwd=smoothstep(0.34,0.70,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-pupilDepthBlend*pupilDepthFwd*pupilDepthGate*0.28);
  // Upper eyelid crease specular arc: the superior palpebral crease (where the upper eyelid skin folds over the tarsal plate) creates a thin curved shadow line just above the lid; the upper surface of the crease fold catches a bright arc specular — the crease highlight-shadow pair is the primary upper eyelid anatomy cue in anime art, distinguishing a properly drawn eye from a rough sketch
  let lidCreaseArcGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.24;
  let lidCreaseArc0Y=scene.eye0.y+scene.eye0.w*0.72;
  let lidCreaseArc1Y=scene.eye1.y+scene.eye1.w*0.72;
  let lidCreaseArc0=smoothstep(scene.eye0.w*0.96,0.0,length(vec2<f32>(input.worldPosition.x-scene.eye0.x,input.worldPosition.y-lidCreaseArc0Y)));
  let lidCreaseArc1=smoothstep(scene.eye1.w*0.96,0.0,length(vec2<f32>(input.worldPosition.x-scene.eye1.x,input.worldPosition.y-lidCreaseArc1Y)));
  let lidCreaseArcBlend=max(lidCreaseArc0,lidCreaseArc1);
  let lidCreaseArcFwd=smoothstep(0.28,0.62,normal.z)*smoothstep(0.14,0.36,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let lidCreaseArcSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*lidCreaseArcBlend*lidCreaseArcFwd*lidCreaseArcGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.94)*lidCreaseArcSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Brow medial head highlight: the medial head of the eyebrow (the inner end, over the corrugator) is the thickest part of the brow; it catches a rounded highlight from frontal lighting — the medial brow highlight is one of the primary face-character cues; heavier inner brows read as dominant or intense, finer ones as delicate; the highlight shape defines the brow personality
  let browMedGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let browMedY=smoothstep(crownEyeY-crownEyeW*0.04,crownEyeY+crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.16,crownEyeY+crownEyeW*0.34,input.worldPosition.y));
  let browMedLat=smoothstep(crownEyeW*0.14,crownEyeW*0.32,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.32,crownEyeW*0.52,abs(input.worldPosition.x)));
  let browMedFwd=smoothstep(0.30,0.64,normal.z)*smoothstep(0.16,0.38,normal.y)*smoothstep(0.08,0.24,abs(normal.x));
  let browMedSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*browMedY*browMedLat*browMedFwd*browMedGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.93)*browMedSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral brow tail specular: the lateral tail of the brow (the outer end) is often raised slightly above the horizontal and its superior surface catches a fine narrow specular — the outer brow tail highlight is the "brow arch peak" detail; arched brow tails read as surprised or elegant; flat brow tails as stoic; the specular reveals the three-dimensional form of the arch
  let browTailGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.20;
  let browTailY=smoothstep(crownEyeY+crownEyeW*0.06,crownEyeY+crownEyeW*0.24,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.24,crownEyeY+crownEyeW*0.40,input.worldPosition.y));
  let browTailLat=smoothstep(crownEyeW*0.52,crownEyeW*0.74,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.74,crownEyeW*0.94,abs(input.worldPosition.x)));
  let browTailFwd=smoothstep(0.28,0.60,normal.z)*smoothstep(0.16,0.38,normal.y)*smoothstep(0.16,0.36,abs(normal.x));
  let browTailSpec=pow(max(0.0,dot(halfVec,normal)),24.0)*browTailY*browTailLat*browTailFwd*browTailGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.93)*browTailSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Superciliary arch brow ridge undercut shadow: the superciliary arch (the bony brow ridge above each eye) overhangs the orbital roof; it casts a crescent shadow below the brow onto the upper eyelid and orbital region — the brow-cast shadow below the brow is the single most important eye-depth cue on the face; it is what makes anime eyes look set back into the skull rather than floating on a flat surface
  let supercilUnderGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.30;
  let supercilUnder0Y=scene.eye0.y+scene.eye0.w*0.46;
  let supercilUnder1Y=scene.eye1.y+scene.eye1.w*0.46;
  let supercilUnder0=smoothstep(scene.eye0.w*1.06,scene.eye0.w*0.44,length(vec2<f32>(input.worldPosition.x-scene.eye0.x,input.worldPosition.y-supercilUnder0Y)));
  let supercilUnder1=smoothstep(scene.eye1.w*1.06,scene.eye1.w*0.44,length(vec2<f32>(input.worldPosition.x-scene.eye1.x,input.worldPosition.y-supercilUnder1Y)));
  let supercilUnderBlend=max(supercilUnder0,supercilUnder1);
  let supercilUnderFwd=smoothstep(0.24,0.58,normal.z)*smoothstep(-0.04,-0.22,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-supercilUnderBlend*supercilUnderFwd*supercilUnderGate*0.28);
  // Lateral orbital rim bony ledge highlight: the lateral orbital rim is a sharp bony ledge at the outer corner of the eye socket; its anterior face catches a bright specular that is distinct from the zygomatic arch highlight — the lateral orbital rim specular sits right at the outer corner of the eye, framing the eye laterally; it is one of the anatomy details that separates average anime art from high-quality stylized rendering
  let latOrbRimGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.22;
  let latOrbRim0Y=scene.eye0.y+scene.eye0.w*0.06;
  let latOrbRim1Y=scene.eye1.y+scene.eye1.w*0.06;
  let latOrbRim0=smoothstep(scene.eye0.w*0.88,scene.eye0.w*0.56,length(vec2<f32>(input.worldPosition.x-scene.eye0.x-scene.eye0.w*0.72,input.worldPosition.y-latOrbRim0Y)));
  let latOrbRim1=smoothstep(scene.eye1.w*0.88,scene.eye1.w*0.56,length(vec2<f32>(input.worldPosition.x-scene.eye1.x-scene.eye1.w*0.72,input.worldPosition.y-latOrbRim1Y)));
  let latOrbRimBlend=max(latOrbRim0,latOrbRim1);
  let latOrbRimFwd=smoothstep(0.24,0.58,normal.z)*smoothstep(0.08,-0.10,normal.y)*smoothstep(0.24,0.48,abs(normal.x));
  let latOrbRimSpec=pow(max(0.0,dot(halfVec,normal)),26.0)*latOrbRimBlend*latOrbRimFwd*latOrbRimGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*latOrbRimSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Nasion root of nose shadow: the nasion is the depression at the bridge of the nose where the nasal bones meet the frontal bone; it creates a small shadow pit at the upper nasal root between the brows — the nasion shadow is what separates the nose bridge from the forehead and is the subtle "starter shadow" for the nose from the top view
  let nasionGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.22;
  let nasionY=smoothstep(crownEyeY-crownEyeW*0.22,crownEyeY-crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.04,crownEyeY+crownEyeW*0.12,input.worldPosition.y));
  let nasionX=smoothstep(crownEyeW*0.10,crownEyeW*0.04,abs(input.worldPosition.x));
  let nasionFwd=smoothstep(0.20,0.54,normal.z)*smoothstep(0.10,0.28,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-nasionY*nasionX*nasionFwd*nasionGate*0.22);
  // Cheek dimple specular: dimples (when present) are small concave depressions in the cheek skin caused by underlying facial muscle attachments; they produce a highlight on their superior wall and a shadow in their base — the dimple is a fv-gated personality trait adding character-specific face charm to select creatures
  let dimpleGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*step(0.70,fv)*0.20;
  let dimpleY=smoothstep(scene.mouth.y+scene.mouth.w*0.30,scene.mouth.y+scene.mouth.w*0.56,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y+scene.mouth.w*0.56,scene.mouth.y+scene.mouth.w*0.82,input.worldPosition.y));
  let dimpleLat=smoothstep(crownEyeW*0.40,crownEyeW*0.56,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.56,crownEyeW*0.70,abs(input.worldPosition.x)));
  let dimpleFwd=smoothstep(0.24,0.58,normal.z)*smoothstep(0.06,-0.10,normal.y)*smoothstep(0.16,0.36,abs(normal.x));
  lit=lit*(1.0-dimpleY*dimpleLat*dimpleFwd*dimpleGate*0.20);
  // Forehead lateral shadow band: the lateral forehead (between the frontal eminence and the temporal line) falls into shadow as the forehead surface curves away from frontal lighting — this lateral forehead shadow is what gives the face its characteristic "dome lit, sides dark" forehead look; without it the forehead reads as a flat slab rather than a curved dome
  let frontLatShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let frontLatShadY=smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.54,input.worldPosition.y)*(1.0-smoothstep(crownEyeY+crownEyeW*0.54,crownEyeY+crownEyeW*0.82,input.worldPosition.y));
  let frontLatShadLat=smoothstep(crownEyeW*0.56,crownEyeW*0.80,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.02,abs(input.worldPosition.x)));
  let frontLatShadFwd=smoothstep(0.10,-0.16,normal.z)*smoothstep(0.06,-0.06,abs(normal.y))*smoothstep(0.36,0.62,abs(normal.x));
  lit=lit*(1.0-frontLatShadY*frontLatShadLat*frontLatShadFwd*frontLatShadGate*0.20);
  // Mandibular symphysis chin midline highlight: the mandibular symphysis is where the two halves of the mandible fuse at the chin midline; the bone here is slightly more prominent than its sides and catches a thin vertical specular stripe at the chin center — the chin midline specular gives a bilobed chin its characteristic central cleft highlight even when no actual cleft is modeled
  let mandSymGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.28,toon)*0.20;
  let mandSymY=smoothstep(scene.mouth.y-scene.mouth.w*0.90,scene.mouth.y-scene.mouth.w*0.54,input.worldPosition.y)*(1.0-smoothstep(scene.mouth.y-scene.mouth.w*0.54,scene.mouth.y-scene.mouth.w*0.18,input.worldPosition.y));
  let mandSymX=smoothstep(crownEyeW*0.08,crownEyeW*0.03,abs(input.worldPosition.x));
  let mandSymFwd=smoothstep(0.40,0.74,normal.z)*smoothstep(-0.04,-0.22,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let mandSymSpec=pow(max(0.0,dot(halfVec,normal)),28.0)*mandSymY*mandSymX*mandSymFwd*mandSymGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*mandSymSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lateral nasal wall highlight: the lateral surface of the nasal bone and upper lateral cartilage catches a specular stripe visible in three-quarter view — distinct from the dorsal ridge (which is central); the lateral nasal wall specular is the detail that makes the nose look like a three-dimensional wedge rather than a flat bump on the face
  let latNasalWallGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.20;
  let latNasalWallY=smoothstep(scene.mouth.y+scene.mouth.w*1.10,crownEyeY-crownEyeW*0.12,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.12,crownEyeY+crownEyeW*0.04,input.worldPosition.y));
  let latNasalWallLat=smoothstep(crownEyeW*0.10,crownEyeW*0.22,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.22,crownEyeW*0.34,abs(input.worldPosition.x)));
  let latNasalWallFwd=smoothstep(0.14,0.48,normal.z)*smoothstep(0.06,-0.10,normal.y)*smoothstep(0.18,0.40,abs(normal.x));
  let latNasalWallSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*latNasalWallY*latNasalWallLat*latNasalWallFwd*latNasalWallGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*latNasalWallSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scapular spine dorsal highlight ridge: the spine of the scapula is a prominent bony ridge across the posterior upper back; it catches a thin bright specular from overhead or posterior lighting and is one of the most distinctive back anatomy features — visible on every character shown from behind in any JRPG; it is the "shoulder wing ridge" that gives the upper back its characteristic angular structure
  let scapSpineRidgeGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.36,fv)*0.20;
  let scapSpineRidgeY=smoothstep(torsoY+crownEyeW*1.56,torsoY+crownEyeW*1.78,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.78,torsoY+crownEyeW*1.98,input.worldPosition.y));
  let scapSpineRidgeLat=smoothstep(crownEyeW*0.20,crownEyeW*0.68,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.68,crownEyeW*0.90,abs(input.worldPosition.x)));
  let scapSpineRidgeFwd=smoothstep(-0.12,-0.50,normal.z)*smoothstep(0.30,0.60,normal.y)*smoothstep(0.10,0.36,abs(normal.x));
  let scapSpineRidgeSpec=pow(max(0.0,dot(halfVec,normal)),26.0)*scapSpineRidgeY*scapSpineRidgeLat*scapSpineRidgeFwd*scapSpineRidgeGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*scapSpineRidgeSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior scapular body shadow: the body of the scapula (supraspinous and infraspinous fossae) lies below the trapezius and forms a flat posterior surface that falls into shadow between the erector spinae ridge medially and the scapular spine laterally — the scapular body shadow is what makes the shoulder blade "visible" as a distinct structure on the back
  let scapBodyShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let scapBodyShadY=smoothstep(torsoY+crownEyeW*1.00,torsoY+crownEyeW*1.54,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.54,torsoY+crownEyeW*1.96,input.worldPosition.y));
  let scapBodyShadLat=smoothstep(crownEyeW*0.24,crownEyeW*0.62,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.62,crownEyeW*0.86,abs(input.worldPosition.x)));
  let scapBodyShadFwd=smoothstep(-0.10,-0.44,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.14,0.38,abs(normal.x));
  lit=lit*(1.0-scapBodyShadY*scapBodyShadLat*scapBodyShadFwd*scapBodyShadGate*0.20);
  // Infraspinous fossa posterior SSS: the infraspinous fossa of the scapula has relatively thin overlying infraspinatus muscle and skin; in backlit or lateral conditions it shows warm SSS that makes the shoulder blade region glow — adds warmth to the posterior shoulder region complementing the existing thoracolumbar fascia and posterior rib features
  let infraFossaSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*smoothstep(0.10,0.26,toon)*step(0.40,fv)*0.14;
  let infraFossaSSSY=smoothstep(torsoY+crownEyeW*1.10,torsoY+crownEyeW*1.60,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.60,torsoY+crownEyeW*2.00,input.worldPosition.y));
  let infraFossaSSSLat=smoothstep(crownEyeW*0.26,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.60,crownEyeW*0.80,abs(input.worldPosition.x)));
  let infraFossaSSSFwd=smoothstep(-0.10,-0.48,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.14,0.40,abs(normal.x));
  let infraFossaSSS=max(0.0,-dot(normal,lightDir))*infraFossaSSSY*infraFossaSSSLat*infraFossaSSSFwd*infraFossaSSSGate;
  lit=clamp(lit+vec3<f32>(0.62,0.22,0.14)*infraFossaSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Supraspinous fossa highlight: the supraspinous fossa (the region above the scapular spine) contains supraspinatus muscle and catches a specular from posterior overhead lighting — the upper scapular highlight above the scapular spine ridge completes the shoulder blade form, adding the supraspinous dome highlight above the spine ridge shadow
  let supraFossaGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.18;
  let supraFossaY=smoothstep(torsoY+crownEyeW*1.86,torsoY+crownEyeW*2.10,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*2.10,torsoY+crownEyeW*2.30,input.worldPosition.y));
  let supraFossaLat=smoothstep(crownEyeW*0.26,crownEyeW*0.62,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.62,crownEyeW*0.86,abs(input.worldPosition.x)));
  let supraFossaFwd=smoothstep(-0.08,-0.42,normal.z)*smoothstep(0.20,0.52,normal.y)*smoothstep(0.14,0.38,abs(normal.x));
  let supraFossaSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*supraFossaY*supraFossaLat*supraFossaFwd*supraFossaGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*supraFossaSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Medial scapular border shadow groove: the medial (vertebral) border of the scapula has a shadow groove running between the scapular edge and the erector spinae; it is one of the most distinctively drawn anatomy details on the back — the shadow groove along the medial scapular border frames the shoulder blade as a separate raised form from the spine muscles
  let medScapBorderGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.20;
  let medScapBorderY=smoothstep(torsoY+crownEyeW*1.00,torsoY+crownEyeW*1.88,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.88,torsoY+crownEyeW*2.18,input.worldPosition.y));
  let medScapBorderLat=smoothstep(crownEyeW*0.18,crownEyeW*0.32,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.32,crownEyeW*0.46,abs(input.worldPosition.x)));
  let medScapBorderFwd=smoothstep(-0.08,-0.44,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.14,0.38,abs(normal.x));
  lit=lit*(1.0-medScapBorderY*medScapBorderLat*medScapBorderFwd*medScapBorderGate*0.20);
  // Lumbar transverse process dot row: the lumbar vertebral transverse processes push against the overlying erector spinae muscle and skin, creating a subtle bilateral row of shadow dots flanking the midline lumbar spine — the transverse process dot-row is a distinctive anatomy marker on lean muscular characters and is drawn in JRPG monster art to communicate a detailed posterior spine
  let lumbTransProcGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.48,fv)*0.16;
  let lumbTransProcY=smoothstep(torsoY-crownEyeW*0.14,torsoY+crownEyeW*0.54,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.54,torsoY+crownEyeW*0.96,input.worldPosition.y));
  let lumbTransProcLat=smoothstep(crownEyeW*0.18,crownEyeW*0.32,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.32,crownEyeW*0.46,abs(input.worldPosition.x)));
  let lumbTransProcDots=smoothstep(0.52,0.78,abs(sin(input.worldPosition.y*(scale*10.0))));
  let lumbTransProcFwd=smoothstep(-0.08,-0.44,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.12,0.34,abs(normal.x));
  lit=lit*(1.0-lumbTransProcY*lumbTransProcLat*lumbTransProcDots*lumbTransProcFwd*lumbTransProcGate*0.16);
  // Vertebral spinous process midline highlight dots: the spinous processes of the thoracic and lumbar vertebrae are bony bumps along the posterior midline; each creates a small bright highlight dot and the row together forms the "spine dots" running down the back — the vertebral dot row is drawn on every lean character's back in JRPG art from Pokémon trainers to FF characters
  let spinousProcGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.40,fv)*0.18;
  let spinousProcY=smoothstep(torsoY+crownEyeW*0.40,torsoY+crownEyeW*1.86,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.86,torsoY+crownEyeW*2.10,input.worldPosition.y));
  let spinousProcX=smoothstep(crownEyeW*0.08,crownEyeW*0.03,abs(input.worldPosition.x));
  let spinousProcDots=smoothstep(0.60,0.82,abs(sin(input.worldPosition.y*(scale*11.0))));
  let spinousProcFwd=smoothstep(-0.10,-0.46,normal.z)*smoothstep(0.18,0.50,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let spinousProcSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*spinousProcY*spinousProcX*spinousProcDots*spinousProcFwd*spinousProcGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*spinousProcSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Sacrospinalis lateral groove shadow: the groove between the erector spinae muscle column and the posterior ribs/ilium creates a longitudinal shadow line on either side of the spine column — the paraspinal groove shadow is what makes the erector spinae "pop" as a raised column; it is the single most important back-anatomy shadow on the posterior torso
  let sacrospinGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.22;
  let sacrospinY=smoothstep(torsoY-crownEyeW*0.16,torsoY+crownEyeW*1.60,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*1.60,torsoY+crownEyeW*2.00,input.worldPosition.y));
  let sacrospinLat=smoothstep(crownEyeW*0.14,crownEyeW*0.26,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.26,crownEyeW*0.38,abs(input.worldPosition.x)));
  let sacrospinFwd=smoothstep(-0.08,-0.44,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.10,0.30,abs(normal.x));
  lit=lit*(1.0-sacrospinY*sacrospinLat*sacrospinFwd*sacrospinGate*0.22);
  // Iliac crest posterior shadow: the posterior iliac crest curves around from the PSIS (posterior superior iliac spine) to the lateral hip; its superior edge casts a shadow below it onto the gluteal region — the posterior iliac crest shadow is the hip-to-gluteal transition shadow from the rear view and is one of the most drawn lower-back-to-hip anatomy details in figure art
  let iliacPostShadGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*0.24;
  let iliacPostShadY=smoothstep(torsoY-crownEyeW*0.06,torsoY+crownEyeW*0.16,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.16,torsoY+crownEyeW*0.38,input.worldPosition.y));
  let iliacPostShadLat=smoothstep(crownEyeW*0.40,crownEyeW*0.70,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.70,crownEyeW*0.96,abs(input.worldPosition.x)));
  let iliacPostShadFwd=smoothstep(-0.10,-0.46,normal.z)*smoothstep(-0.04,-0.22,normal.y)*smoothstep(0.16,0.42,abs(normal.x));
  lit=lit*(1.0-iliacPostShadY*iliacPostShadLat*iliacPostShadFwd*iliacPostShadGate*0.22);
  // Sacral dorsal surface highlight: the posterior sacrum is a triangular bone at the base of the spine; its dorsal surface catches a flat specular from posterior overhead lighting that appears as a triangular highlight at the lower posterior midline — the sacral highlight is the "tail end of the spine highlight row" and grounds the lower back anatomy
  let sacralDorsGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.18;
  let sacralDorsY=smoothstep(torsoY-crownEyeW*0.36,torsoY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.10,torsoY+crownEyeW*0.10,input.worldPosition.y));
  let sacralDorsX=smoothstep(crownEyeW*0.16,crownEyeW*0.06,abs(input.worldPosition.x));
  let sacralDorsFwd=smoothstep(-0.10,-0.48,normal.z)*smoothstep(0.16,0.48,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let sacralDorsSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*sacralDorsY*sacralDorsX*sacralDorsFwd*sacralDorsGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*sacralDorsSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Posterior superior iliac spine dimple shadows: the PSIS are the twin bony points at the top of the sacrum under the skin of the lower back; they create the famous "Venus dimples" — two symmetric shadow pits framing the sacral triangle; these dimples are one of the most drawn lower-back anatomy details in all JRPG character art and are expected on any high-quality biped character
  let psisDimpleGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.26;
  let psisDimpleY=smoothstep(torsoY+crownEyeW*0.06,torsoY+crownEyeW*0.26,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.26,torsoY+crownEyeW*0.46,input.worldPosition.y));
  let psisDimpleLat=smoothstep(crownEyeW*0.18,crownEyeW*0.34,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.34,crownEyeW*0.50,abs(input.worldPosition.x)));
  let psisDimpleFwd=smoothstep(-0.08,-0.44,normal.z)*smoothstep(0.04,-0.14,normal.y)*smoothstep(0.14,0.36,abs(normal.x));
  lit=lit*(1.0-psisDimpleY*psisDimpleLat*psisDimpleFwd*psisDimpleGate*0.26);
  // Coccyx tip posterior shadow: the coccyx (tail bone) projects slightly posteriorly at the very base of the sacrum; in non-tailed characters its shadow pit marks the terminal point of the spine — the coccyx shadow is the "end stop" of the posterior spinal anatomy and prevents the lower back midline from feeling like it simply fades away without resolution
  let coccyxTipGate=organicSkin*(1.0-metallic)*smoothstep(0.08,0.22,toon)*step(0.36,fv)*0.16;
  let coccyxTipY=smoothstep(torsoY-crownEyeW*0.54,torsoY-crownEyeW*0.36,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.36,torsoY-crownEyeW*0.16,input.worldPosition.y));
  let coccyxTipX=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.x));
  let coccyxTipFwd=smoothstep(-0.12,-0.50,normal.z)*smoothstep(-0.04,-0.22,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  lit=lit*(1.0-coccyxTipY*coccyxTipX*coccyxTipFwd*coccyxTipGate*0.18);
  // Tensor fascia latae lateral thigh band: the TFL muscle and the iliotibial band create a continuous lateral thigh ridge from the hip to the knee; the anterior face of this band catches a highlight from three-quarter lateral-front lighting — the TFL-ITB highlight is what gives the lateral thigh its characteristic defined outer edge line running the full leg length
  let tflBandGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.38,fv)*0.18;
  let tflBandY=smoothstep(kneeY+crownEyeW*0.30,torsoY-crownEyeW*0.10,input.worldPosition.y)*(1.0-smoothstep(torsoY-crownEyeW*0.10,torsoY+crownEyeW*0.10,input.worldPosition.y));
  let tflBandLat=smoothstep(crownEyeW*0.52,crownEyeW*0.72,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.72,crownEyeW*0.92,abs(input.worldPosition.x)));
  let tflBandFwd=smoothstep(0.10,0.44,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.28,0.54,abs(normal.x));
  let tflBandSpec=pow(max(0.0,dot(halfVec,normal)),16.0)*tflBandY*tflBandLat*tflBandFwd*tflBandGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*tflBandSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Vastus intermedius anterior thigh midline highlight: the vastus intermedius lies deep to the rectus femoris but its bulk contributes to the central anterior thigh cylindrical form; the center of the anterior thigh catches a broad diffuse highlight — complementing the rectus femoris elongated spec with a broader central thigh dome that gives the quadriceps group its characteristic frontal fullness
  let vastIntGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.16;
  let vastIntY=smoothstep(kneeY+crownEyeW*0.46,crownEyeY-crownEyeW*1.50,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.50,crownEyeY-crownEyeW*1.22,input.worldPosition.y));
  let vastIntX=smoothstep(crownEyeW*0.26,crownEyeW*0.08,abs(input.worldPosition.x));
  let vastIntFwd=smoothstep(0.28,0.64,normal.z)*smoothstep(0.06,-0.10,normal.y)*smoothstep(0.04,0.01,abs(normal.x));
  let vastIntSpec=pow(max(0.0,dot(halfVec,normal)),12.0)*vastIntY*vastIntX*vastIntFwd*vastIntGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*vastIntSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Semitendinosus medial hamstring specular: the semitendinosus tendon becomes a long visible cord running down the medial posterior knee; it creates a medial posterior thigh-to-knee tendon highlight visible from behind — the semitendinosus tendon cord is a commonly drawn posterior knee anatomy detail that gives the back of the knee its characteristic dual-tendon framing
  let semiTendGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*step(0.40,fv)*0.18;
  let semiTendY=smoothstep(kneeY+crownEyeW*0.16,kneeY+crownEyeW*0.56,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.56,kneeY+crownEyeW*0.90,input.worldPosition.y));
  let semiTendLat=smoothstep(crownEyeW*0.08,crownEyeW*0.24,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.24,crownEyeW*0.42,abs(input.worldPosition.x)));
  let semiTendFwd=smoothstep(-0.10,-0.46,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.16,0.40,abs(normal.x));
  let semiTendSpec=pow(max(0.0,dot(halfVec,normal)),24.0)*semiTendY*semiTendLat*semiTendFwd*semiTendGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.92)*semiTendSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Semimembranosus medial thigh belly: broad SSS shadow on posterior-medial thigh
  let semiMemGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let semiMemY=smoothstep(kneeY+scale*0.05,kneeY+scale*0.32,input.worldPosition.y)*smoothstep(haunchY-scale*0.04,haunchY-scale*0.22,input.worldPosition.y);
  let semiMemLat=smoothstep(crownEyeW*0.06,crownEyeW*0.22,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.36,crownEyeW*0.58,abs(input.worldPosition.x)));
  let semiMemFwd=smoothstep(-0.08,-0.52,normal.z)*smoothstep(0.10,-0.06,abs(normal.y));
  let semiMemShadow=semiMemY*semiMemLat*semiMemFwd*semiMemGate*0.18;
  lit=lit*(1.0-semiMemShadow)+vec3<f32>(0.38,0.18,0.24)*semiMemShadow;
  // Adductor magnus posterior inner thigh: deep shadow crease medial posterior
  let addMagGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*4.0,0.0,1.0);
  let addMagY=smoothstep(kneeY+scale*0.08,kneeY+scale*0.28,input.worldPosition.y)*smoothstep(haunchY-scale*0.06,haunchY-scale*0.28,input.worldPosition.y);
  let addMagLat=smoothstep(crownEyeW*0.04,crownEyeW*0.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.26,crownEyeW*0.44,abs(input.worldPosition.x)));
  let addMagFwd=smoothstep(-0.14,-0.58,normal.z)*smoothstep(0.12,-0.04,abs(normal.y));
  let addMagShadow=addMagY*addMagLat*addMagFwd*addMagGate*0.22;
  lit=lit*(1.0-addMagShadow)+vec3<f32>(0.28,0.12,0.18)*addMagShadow;
  // Pectineus groin crease: narrow diagonal shadow at proximal inner thigh/groin junction
  let pectineusGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*5.0,0.0,1.0);
  let pectineusY=smoothstep(haunchY-scale*0.02,haunchY+scale*0.06,input.worldPosition.y)*smoothstep(haunchY+scale*0.18,haunchY+scale*0.08,input.worldPosition.y);
  let pectineusLat=smoothstep(crownEyeW*0.03,crownEyeW*0.12,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.20,crownEyeW*0.34,abs(input.worldPosition.x)));
  let pectineusFwd=smoothstep(0.18,-0.08,normal.z)*smoothstep(0.08,-0.12,normal.y);
  let pectineusShadow=pectineusY*pectineusLat*pectineusFwd*pectineusGate*0.26;
  lit=lit*(1.0-pectineusShadow)+vec3<f32>(0.32,0.14,0.20)*pectineusShadow;
  // Iliotibial band lateral knee flare: bright specular ridge on lateral knee as IT band wraps around
  let itbKneeGate=organicSkin*(1.0-metallic)*toon*clamp(fv*4.0-1.0,0.0,1.0);
  let itbKneeY=smoothstep(kneeY-scale*0.04,kneeY+scale*0.04,input.worldPosition.y)*smoothstep(kneeY+scale*0.12,kneeY+scale*0.04,input.worldPosition.y);
  let itbKneeLat=smoothstep(crownEyeW*0.18,crownEyeW*0.32,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.44,crownEyeW*0.60,abs(input.worldPosition.x)));
  let itbKneeFwd=smoothstep(-0.10,0.26,normal.z)*smoothstep(0.06,-0.10,abs(normal.y))*smoothstep(0.20,0.44,abs(normal.x));
  let itbKneeSpec=pow(max(0.0,dot(halfVec,normal)),28.0)*itbKneeY*itbKneeLat*itbKneeFwd*itbKneeGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.90)*itbKneeSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Popliteus posterior knee hollow: soft shadow in popliteal fossa behind knee
  let popliteusGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.5,0.0,1.0);
  let popliteusY=smoothstep(kneeY-scale*0.02,kneeY+scale*0.08,input.worldPosition.y)*smoothstep(kneeY+scale*0.18,kneeY+scale*0.10,input.worldPosition.y);
  let popliteusLat=1.0-smoothstep(crownEyeW*0.22,crownEyeW*0.38,abs(input.worldPosition.x));
  let popliteusFwd=smoothstep(-0.20,-0.60,normal.z)*smoothstep(0.08,-0.10,abs(normal.y));
  let popliteusShadow=popliteusY*popliteusLat*popliteusFwd*popliteusGate*0.24;
  lit=lit*(1.0-popliteusShadow)+vec3<f32>(0.22,0.14,0.18)*popliteusShadow;
  // Extensor hallucis longus dorsal foot ridge: thin tendon highlight along dorsal midfoot
  let ehlGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.0-0.5,0.0,1.0);
  let ehlY=smoothstep(kneeY-scale*0.52,kneeY-scale*0.38,input.worldPosition.y)*smoothstep(kneeY-scale*0.14,kneeY-scale*0.28,input.worldPosition.y);
  let ehlLat=1.0-smoothstep(crownEyeW*0.04,crownEyeW*0.14,abs(input.worldPosition.x));
  let ehlFwd=smoothstep(0.30,0.62,normal.z)*smoothstep(0.06,-0.06,abs(normal.y));
  let ehlSpec=pow(max(0.0,dot(halfVec,normal)),36.0)*ehlY*ehlLat*ehlFwd*ehlGate;
  lit=clamp(lit+vec3<f32>(1.0,0.99,0.94)*ehlSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tibialis anterior shin highlight: bright specular ridge down front of shin alongside tibia
  let tibAntGate=organicSkin*(1.0-metallic)*toon*clamp(fv*2.5,0.0,1.0);
  let tibAntY=smoothstep(kneeY-scale*0.06,kneeY+scale*0.04,input.worldPosition.y)*smoothstep(kneeY-scale*0.44,kneeY-scale*0.30,input.worldPosition.y);
  let tibAntLat=smoothstep(crownEyeW*0.06,crownEyeW*0.18,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.42,abs(input.worldPosition.x)));
  let tibAntFwd=smoothstep(0.22,0.54,normal.z)*smoothstep(0.08,-0.06,abs(normal.y));
  let tibAntSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*tibAntY*tibAntLat*tibAntFwd*tibAntGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.92)*tibAntSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Flexor digitorum longus medial arch tendon: thin specular line medial arch underside
  let fdlGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.5-0.8,0.0,1.0);
  let fdlY=smoothstep(kneeY-scale*0.52,kneeY-scale*0.42,input.worldPosition.y)*smoothstep(kneeY-scale*0.22,kneeY-scale*0.32,input.worldPosition.y);
  let fdlLat=smoothstep(crownEyeW*0.04,crownEyeW*0.14,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.22,crownEyeW*0.34,abs(input.worldPosition.x)));
  let fdlFwd=smoothstep(0.08,-0.22,normal.z)*smoothstep(-0.30,-0.58,normal.y);
  let fdlSpec=pow(max(0.0,dot(halfVec,normal)),40.0)*fdlY*fdlLat*fdlFwd*fdlGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.95)*fdlSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Peroneus brevis lateral malleolus pop: bright specular knob at lateral ankle bone
  let perBrevGate=organicSkin*(1.0-metallic)*toon*clamp(fv*4.5-1.5,0.0,1.0);
  let perBrevY=smoothstep(kneeY-scale*0.44,kneeY-scale*0.36,input.worldPosition.y)*smoothstep(kneeY-scale*0.28,kneeY-scale*0.34,input.worldPosition.y);
  let perBrevLat=smoothstep(crownEyeW*0.22,crownEyeW*0.38,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.46,crownEyeW*0.60,abs(input.worldPosition.x)));
  let perBrevFwd=smoothstep(-0.04,0.30,normal.z)*smoothstep(0.06,-0.08,abs(normal.y))*smoothstep(0.18,0.42,abs(normal.x));
  let perBrevSpec=pow(max(0.0,dot(halfVec,normal)),32.0)*perBrevY*perBrevLat*perBrevFwd*perBrevGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.88)*perBrevSpec*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Anterior deltoid highlight: bright specular on anterior shoulder cap from front-lateral light
  let antDeltGate=organicSkin*(1.0-metallic)*toon*clamp(fv*2.0,0.0,1.0);
  let antDeltY=smoothstep(elbowY+scale*0.28,elbowY+scale*0.48,input.worldPosition.y)*smoothstep(torsoY-scale*0.04,torsoY-scale*0.14,input.worldPosition.y);
  let antDeltLat=smoothstep(crownEyeW*0.28,crownEyeW*0.48,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.68,crownEyeW*0.90,abs(input.worldPosition.x)));
  let antDeltFwd=smoothstep(0.18,0.52,normal.z)*smoothstep(0.10,-0.06,abs(normal.y))*smoothstep(0.14,0.36,abs(normal.x));
  let antDeltSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*antDeltY*antDeltLat*antDeltFwd*antDeltGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.90)*antDeltSpec*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Biceps long head groove: narrow shadow groove bisecting anterior upper arm
  let bicepsGrooveGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let bicepsGrooveY=smoothstep(elbowY+scale*0.04,elbowY+scale*0.18,input.worldPosition.y)*smoothstep(elbowY+scale*0.40,elbowY+scale*0.28,input.worldPosition.y);
  let bicepsGrooveLat=1.0-smoothstep(crownEyeW*0.08,crownEyeW*0.22,abs(input.worldPosition.x));
  let bicepsGrooveFwd=smoothstep(0.14,0.50,normal.z)*smoothstep(0.06,-0.08,abs(normal.y));
  let bicepsGrooveShadow=bicepsGrooveY*bicepsGrooveLat*bicepsGrooveFwd*bicepsGrooveGate*0.20;
  lit=lit*(1.0-bicepsGrooveShadow)+vec3<f32>(0.24,0.14,0.20)*bicepsGrooveShadow;
  // Coracobrachialis medial arm shadow: soft shadow under medial upper arm near axilla
  let coracoBrachGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*4.0,0.0,1.0);
  let coracoBrachY=smoothstep(elbowY+scale*0.16,elbowY+scale*0.30,input.worldPosition.y)*smoothstep(elbowY+scale*0.46,elbowY+scale*0.36,input.worldPosition.y);
  let coracoBrachLat=smoothstep(crownEyeW*0.08,crownEyeW*0.20,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.34,crownEyeW*0.50,abs(input.worldPosition.x)));
  let coracoBrachFwd=smoothstep(0.06,-0.28,normal.z)*smoothstep(0.10,-0.06,abs(normal.y))*smoothstep(-0.10,-0.38,normal.x*sign(input.worldPosition.x));
  let coracoBrachShadow=coracoBrachY*coracoBrachLat*coracoBrachFwd*coracoBrachGate*0.22;
  lit=lit*(1.0-coracoBrachShadow)+vec3<f32>(0.20,0.12,0.16)*coracoBrachShadow;
  // Brachioradialis lateral forearm crest: prominent lateral forearm muscle highlight
  let brachRadGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.0-0.5,0.0,1.0);
  let brachRadY=smoothstep(elbowY-scale*0.02,elbowY+scale*0.10,input.worldPosition.y)*smoothstep(wristY+scale*0.12,wristY+scale*0.22,input.worldPosition.y);
  let brachRadLat=smoothstep(crownEyeW*0.20,crownEyeW*0.36,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.48,crownEyeW*0.64,abs(input.worldPosition.x)));
  let brachRadFwd=smoothstep(-0.06,0.30,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.16,0.40,abs(normal.x));
  let brachRadSpec=pow(max(0.0,dot(halfVec,normal)),24.0)*brachRadY*brachRadLat*brachRadFwd*brachRadGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.92)*brachRadSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pronator teres oblique belly shadow: diagonal soft shadow across anterior proximal forearm
  let pronTereGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.5,0.0,1.0);
  let pronTereY=smoothstep(elbowY-scale*0.04,elbowY+scale*0.08,input.worldPosition.y)*smoothstep(wristY+scale*0.34,wristY+scale*0.22,input.worldPosition.y);
  let pronTereLat=smoothstep(crownEyeW*0.06,crownEyeW*0.18,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.32,crownEyeW*0.48,abs(input.worldPosition.x)));
  let pronTereFwd=smoothstep(0.20,0.56,normal.z)*smoothstep(0.08,-0.08,abs(normal.y));
  let pronTereShadow=pronTereY*pronTereLat*pronTereFwd*pronTereGate*0.18;
  lit=lit*(1.0-pronTereShadow)+vec3<f32>(0.22,0.14,0.18)*pronTereShadow;
  // Flexor carpi ulnaris medial forearm ridge: SSS-lit soft ridge medial forearm
  let fcuGate=organicSkin*(1.0-metallic)*toon*clamp(fv*4.0-1.0,0.0,1.0);
  let fcuY=smoothstep(elbowY-scale*0.06,elbowY+scale*0.06,input.worldPosition.y)*smoothstep(wristY+scale*0.08,wristY+scale*0.18,input.worldPosition.y);
  let fcuLat=smoothstep(crownEyeW*0.08,crownEyeW*0.20,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.32,crownEyeW*0.46,abs(input.worldPosition.x)));
  let fcuFwd=smoothstep(0.06,-0.24,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(-0.08,-0.36,normal.x*sign(input.worldPosition.x));
  let fcuSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*fcuY*fcuLat*fcuFwd*fcuGate;
  lit=clamp(lit+vec3<f32>(1.0,0.96,0.90)*fcuSpec*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Digastric submental highlight: soft specular on underside of chin/jaw floor
  let digastricGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.5,0.0,1.0);
  let digastricY=smoothstep(torsoY+scale*0.30,torsoY+scale*0.44,input.worldPosition.y)*smoothstep(crownEyeY-scale*0.06,crownEyeY-scale*0.16,input.worldPosition.y);
  let digastricLat=1.0-smoothstep(crownEyeW*0.18,crownEyeW*0.38,abs(input.worldPosition.x));
  let digastricFwd=smoothstep(-0.10,-0.42,normal.y)*smoothstep(0.14,-0.06,abs(normal.z));
  let digastricSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*digastricY*digastricLat*digastricFwd*digastricGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*digastricSpec*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Hyoid infrahyoid shadow: soft shadow depression above larynx/throat hollow
  let infrahyoidGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let infrahyoidBandY=smoothstep(torsoY+scale*0.14,torsoY+scale*0.24,input.worldPosition.y)*smoothstep(torsoY+scale*0.38,torsoY+scale*0.30,input.worldPosition.y);
  let hyoidLat=1.0-smoothstep(crownEyeW*0.10,crownEyeW*0.26,abs(input.worldPosition.x));
  let hyoidFwd=smoothstep(0.20,0.54,normal.z)*smoothstep(0.08,-0.06,abs(normal.y));
  let hyoidShadow=infrahyoidBandY*hyoidLat*hyoidFwd*infrahyoidGate*0.22;
  lit=lit*(1.0-hyoidShadow)+vec3<f32>(0.18,0.12,0.16)*hyoidShadow;
  // Sternohyoid midline neck ridge: thin vertical specular along anterior neck center
  let sternohyoidGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.0,0.0,1.0);
  let sternohyoidY=smoothstep(torsoY+scale*0.08,torsoY+scale*0.18,input.worldPosition.y)*smoothstep(torsoY+scale*0.44,torsoY+scale*0.34,input.worldPosition.y);
  let sternohyoidLat=1.0-smoothstep(crownEyeW*0.04,crownEyeW*0.12,abs(input.worldPosition.x));
  let sternohyoidFwd=smoothstep(0.26,0.58,normal.z)*smoothstep(0.06,-0.06,abs(normal.y));
  let sternohyoidSpec=pow(max(0.0,dot(halfVec,normal)),26.0)*sternohyoidY*sternohyoidLat*sternohyoidFwd*sternohyoidGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*sternohyoidSpec*0.12,vec3<f32>(0.0),vec3<f32>(1.0));
  // Linea semilunaris lateral rectus border: bright vertical specular at lateral edge of abs
  let semiLunaGate=organicSkin*(1.0-metallic)*toon*clamp(fv*2.5-0.3,0.0,1.0);
  let semiLunaY=smoothstep(torsoY-scale*0.38,torsoY-scale*0.24,input.worldPosition.y)*smoothstep(torsoY+scale*0.02,torsoY-scale*0.10,input.worldPosition.y);
  let semiLunaLat=smoothstep(crownEyeW*0.14,crownEyeW*0.22,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.38,abs(input.worldPosition.x)));
  let semiLunaFwd=smoothstep(0.24,0.56,normal.z)*smoothstep(0.08,-0.06,abs(normal.y));
  let semiLunaSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*semiLunaY*semiLunaLat*semiLunaFwd*semiLunaGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.92)*semiLunaSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // External oblique twisting shadow: diagonal soft shadow lateral torso wrapping around flank
  let extOblGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let extOblY=smoothstep(torsoY-scale*0.30,torsoY-scale*0.18,input.worldPosition.y)*smoothstep(torsoY+scale*0.06,torsoY-scale*0.06,input.worldPosition.y);
  let extOblLat=smoothstep(crownEyeW*0.22,crownEyeW*0.38,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.72,abs(input.worldPosition.x)));
  let extOblFwd=smoothstep(0.08,-0.30,normal.z)*smoothstep(0.10,-0.06,abs(normal.y));
  let extOblShadow=extOblY*extOblLat*extOblFwd*extOblGate*0.20;
  lit=lit*(1.0-extOblShadow)+vec3<f32>(0.20,0.14,0.18)*extOblShadow;
  // Serratus anterior finger shadow: stacked small shadow bands on lateral ribcage
  let serrAntGate=organicSkin*(1.0-metallic)*toon*clamp(fv*4.0-1.0,0.0,1.0);
  let serrAntY=smoothstep(torsoY-scale*0.10,torsoY-scale*0.02,input.worldPosition.y)*smoothstep(torsoY+scale*0.14,torsoY+scale*0.06,input.worldPosition.y);
  let serrAntLat=smoothstep(crownEyeW*0.26,crownEyeW*0.42,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.58,crownEyeW*0.76,abs(input.worldPosition.x)));
  let serrFwd=smoothstep(-0.04,0.28,normal.z)*smoothstep(0.10,-0.06,abs(normal.y))*smoothstep(0.12,0.34,abs(normal.x));
  let serratusRibWave=0.5+0.5*sin(input.worldPosition.y*(6.28/scale)*4.0);
  let serrShadow=serrAntY*serrAntLat*serrFwd*serrAntGate*serratusRibWave*0.18;
  lit=lit*(1.0-serrShadow)+vec3<f32>(0.18,0.12,0.16)*serrShadow;
  // Teres major posterior armpit: deep shadow fold at posterior axilla
  let teresMajGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.5,0.0,1.0);
  let teresMajY=smoothstep(elbowY+scale*0.30,elbowY+scale*0.44,input.worldPosition.y)*smoothstep(torsoY-scale*0.02,torsoY-scale*0.12,input.worldPosition.y);
  let teresMajLat=smoothstep(crownEyeW*0.30,crownEyeW*0.50,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.64,crownEyeW*0.84,abs(input.worldPosition.x)));
  let teresMajFwd=smoothstep(0.08,-0.36,normal.z)*smoothstep(0.10,-0.06,abs(normal.y));
  let teresMajShadow=teresMajY*teresMajLat*teresMajFwd*teresMajGate*0.24;
  lit=lit*(1.0-teresMajShadow)+vec3<f32>(0.18,0.10,0.14)*teresMajShadow;
  // Infraspinatus posterior shoulder round: bright specular cap on posterior shoulder
  let infraspiCapGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.5-0.5,0.0,1.0);
  let infraspiCapY=smoothstep(elbowY+scale*0.28,elbowY+scale*0.42,input.worldPosition.y)*smoothstep(torsoY-scale*0.06,torsoY-scale*0.16,input.worldPosition.y);
  let infraspiCapLat=smoothstep(crownEyeW*0.24,crownEyeW*0.40,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.58,crownEyeW*0.78,abs(input.worldPosition.x)));
  let infraspiFwd=smoothstep(-0.06,-0.42,normal.z)*smoothstep(0.08,-0.06,abs(normal.y));
  let infraspiCapSpec=pow(max(0.0,dot(halfVec,normal)),20.0)*infraspiCapY*infraspiCapLat*infraspiFwd*infraspiCapGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.92)*infraspiCapSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Rhomboid medial scapular border shadow: thin shadow groove along medial scapula edge
  let rhomboidGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*4.0,0.0,1.0);
  let rhomboidY=smoothstep(elbowY+scale*0.24,elbowY+scale*0.36,input.worldPosition.y)*smoothstep(torsoY-scale*0.04,torsoY-scale*0.14,input.worldPosition.y);
  let rhomboidLat=smoothstep(crownEyeW*0.10,crownEyeW*0.20,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.28,crownEyeW*0.40,abs(input.worldPosition.x)));
  let rhomboidFwd=smoothstep(-0.14,-0.50,normal.z)*smoothstep(0.08,-0.06,abs(normal.y));
  let rhomboidShadow=rhomboidY*rhomboidLat*rhomboidFwd*rhomboidGate*0.22;
  lit=lit*(1.0-rhomboidShadow)+vec3<f32>(0.16,0.10,0.14)*rhomboidShadow;
  // Fire ember scatter: hot orange-white micro-specular dots across fire creatures
  let fireEmberGate=fireGlow*toon*(1.0-metallic)*clamp(fv*3.0,0.0,1.0);
  let emberNoise=fract(sin(dot(input.worldPosition.xyz,vec3<f32>(127.1,311.7,74.4)))*43758.5453);
  let emberDot=step(0.88,emberNoise)*pow(max(0.0,dot(halfVec,normal)),48.0);
  lit=clamp(lit+vec3<f32>(1.0,0.72,0.28)*emberDot*fireEmberGate*0.38,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ice crystalline facet glints: sharp multi-angle specular shards on ice surface
  let iceXtalFacetGate=iceXtalGate*toon*(1.0-metallic)*clamp(fv*2.5,0.0,1.0);
  let facetNoise=fract(sin(dot(floor(input.worldPosition.xyz*8.0),vec3<f32>(23.1,47.7,13.4)))*23758.5);
  let xtalFacetNorm=normalize(normal+vec3<f32>(facetNoise*0.3-0.15,(1.0-facetNoise)*0.2-0.10,facetNoise*0.15));
  let iceFacetSpec=pow(max(0.0,dot(halfVec,xtalFacetNorm)),64.0)*iceXtalFacetGate;
  lit=clamp(lit+vec3<f32>(0.88,0.96,1.0)*iceFacetSpec*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Electric charge arc rim: bright cyan rim light from charge field around electric creatures
  let elecArcGate=elecChargeGate*toon*(1.0-metallic)*clamp(fv*4.0-1.0,0.0,1.0);
  let elecRim=pow(clamp(1.0-dot(view,normal),0.0,1.0),3.5)*elecArcGate;
  let arcFlicker=0.75+0.25*fract(sin(input.worldPosition.y*77.3+input.worldPosition.x*31.7)*4318.5);
  lit=clamp(lit+vec3<f32>(0.42,0.88,1.0)*elecRim*arcFlicker*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow element dark chromatic aberration rim: purple-shifted rim on shadow creatures
  let shadowAbGate=shadowDom*toon*(1.0-metallic)*clamp(fv*3.5-0.5,0.0,1.0);
  let shadowRim=pow(clamp(1.0-dot(view,normal),0.0,1.0),2.8)*shadowAbGate;
  lit=clamp(lit+vec3<f32>(0.44,0.08,0.68)*shadowRim*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Plant element chlorophyll SSS glow: green-tinted subsurface translucency on lit faces
  let plantSSSGate=plantDom*toon*(1.0-metallic)*clamp(1.0-fv*2.0,0.0,1.0);
  let plantSSSBack=clamp(dot(-normal,lightDir)+0.3,0.0,1.0)*plantSSSGate;
  let plantThick=clamp(1.0-abs(dot(view,normal))*1.4,0.0,1.0);
  lit=clamp(lit+vec3<f32>(0.28,0.78,0.22)*plantSSSBack*plantThick*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Water element caustic shimmer: moving specular highlights on water creatures
  let waterCausticGate=blueSheen*toon*(1.0-metallic)*clamp(fv*2.5,0.0,1.0);
  let causticPat=fract(sin(dot(input.worldPosition.xz,vec2<f32>(12.9,78.2)))*43758.5)*fract(sin(dot(input.worldPosition.xz+0.2,vec2<f32>(31.3,17.9)))*23158.5);
  let causticSpec=step(0.78,causticPat)*pow(max(0.0,dot(halfVec,normal)),24.0)*waterCausticGate;
  lit=clamp(lit+vec3<f32>(0.64,0.90,1.0)*causticSpec*0.30,vec3<f32>(0.0),vec3<f32>(1.0));
  // Earth element stone crack shadow network: dark craquelure pattern on earth creatures
  let earthCrackGate=earthDom*toon*(1.0-metallic)*clamp(1.0-fv*2.5,0.0,1.0);
  let crackA=fract(sin(dot(floor(input.worldPosition.xz*5.0),vec2<f32>(41.3,97.7)))*31758.5);
  let crackB=fract(sin(dot(floor(input.worldPosition.xz*5.0+0.5),vec2<f32>(73.1,23.9)))*17258.5);
  let crackMask=step(0.92,max(crackA,crackB))*earthCrackGate;
  lit=lit*(1.0-crackMask*0.38)+vec3<f32>(0.14,0.10,0.08)*crackMask*0.38;
  // Air element translucent ghost rim: white-tinted transparent-looking edge fade
  let airGhostGate=clamp(1.0-warmDom-shadowDom-plantDom-fireGlow,0.0,1.0)*toon*(1.0-metallic)*clamp(fv*2.0,0.0,1.0);
  let airGhostRim=pow(clamp(1.0-dot(view,normal),0.0,1.0),4.0)*airGhostGate;
  lit=clamp(lit+vec3<f32>(0.88,0.96,1.0)*airGhostRim*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Metallic anisotropic multi-band highlight: horizontal brushed-metal ring highlight
  let msMutiBandGate=msMetal*toon*clamp(fv*2.0,0.0,1.0);
  let anisoTangent=normalize(vec3<f32>(0.0,1.0,0.0)-normal*dot(normal,vec3<f32>(0.0,1.0,0.0)));
  let anisoDot=dot(halfVec,anisoTangent);
  let anisoBand=pow(sqrt(clamp(1.0-anisoDot*anisoDot,0.0,1.0)),12.0)*msMutiBandGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*anisoBand*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Multi-layer rim light: warm key-side rim plus cool fill-side counter-rim for Pokemon depth
  let rimKey=pow(clamp(1.0-dot(view,normal),0.0,1.0),3.2)*clamp(dot(normal,lightDir)+0.2,0.0,1.0)*toon;
  let rimFill=pow(clamp(1.0-dot(view,normal),0.0,1.0),4.0)*clamp(-dot(normal,lightDir)+0.4,0.0,1.0)*toon;
  let rimKeyColor=mix(vec3<f32>(1.0,0.92,0.78),vec3<f32>(0.78,0.92,1.0),blueSheen)*rimKey*0.14;
  let rimFillColor=vec3<f32>(0.56,0.72,1.0)*rimFill*0.10;
  lit=clamp(lit+rimKeyColor+rimFillColor,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular occlusion from concave normals: reduce spec on inward-facing concavities
  let specOcc=clamp(dot(normal,view)*1.6+0.3,0.0,1.0);
  lit=mix(lit,lit*specOcc,0.18*toon*(1.0-metallic));
  // Warm/cool dual hemisphere ambient: sky warm top, ground cool bottom split
  let hemisphereUp=clamp(dot(normal,vec3<f32>(0.0,1.0,0.0))*0.5+0.5,0.0,1.0);
  let warmAmb=vec3<f32>(1.0,0.94,0.82)*hemisphereUp*0.06;
  let coolAmb=vec3<f32>(0.70,0.82,1.0)*(1.0-hemisphereUp)*0.08;
  lit=clamp(lit+warmAmb+coolAmb,vec3<f32>(0.0),vec3<f32>(1.0));
  // Contact shadow at feet: soft occlusion darkening near ground plane
  let groundProx=clamp(1.0-(input.worldPosition.y-kneeY+scale*0.50)/(scale*0.10),0.0,1.0);
  let contactShadow=groundProx*groundProx*toon*(1.0-metallic)*0.22;
  lit=lit*(1.0-contactShadow)+vec3<f32>(0.08,0.06,0.10)*contactShadow;
  // SSS thin-limb depth glow: bright warm scatter on thin limb sections (fingers, ears, fins)
  let thinLimbGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.0,0.0,1.0);
  let thinLimbSSS=clamp(dot(-normal,lightDir)*0.5+0.5,0.0,1.0)*thinLimbGate;
  let limbThin=clamp(1.0-abs(dot(view,normal))*2.0,0.0,1.0);
  lit=clamp(lit+vec3<f32>(1.0,0.64,0.44)*thinLimbSSS*limbThin*0.16,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dual-lobe organic BRDF secondary: wide soft lobe on top of narrow primary for skin sheen
  let skinDualLobeGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.0,0.0,1.0);
  let skinWideLobe=pow(max(0.0,dot(halfVec,normal)),4.0)*skinDualLobeGate;
  lit=clamp(lit+vec3<f32>(1.0,0.96,0.92)*skinWideLobe*0.07,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pattern border edge darkening: darken the transitional edge of pattern regions for cel-shaded clarity
  let patBorderGate=toon*clamp(fv*2.0,0.0,1.0);
  let patBorder=belly*(1.0-belly)*4.0*patBorderGate;
  lit=lit*(1.0-patBorder*0.14);
  // Stripe pattern SSS tinting: stripes scatter warm light differently from base skin
  let stripeSSSTone=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let stripeSSSLit=clamp(dot(-normal,lightDir)*0.5+0.5,0.0,1.0)*stripeSSSTone*belly;
  lit=clamp(lit+vec3<f32>(1.0,0.72,0.56)*stripeSSSLit*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Belly inner light bleed: soft warm glow from belly upward onto chest panel
  let bellyBleedGate=organicSkin*(1.0-metallic)*toon*clamp(fv*1.5,0.0,1.0);
  let bellyBleedY=smoothstep(torsoY-scale*0.12,torsoY+scale*0.06,input.worldPosition.y)*smoothstep(torsoY+scale*0.22,torsoY+scale*0.10,input.worldPosition.y);
  let bellyBleedFwd=smoothstep(0.18,0.52,normal.z)*belly;
  lit=clamp(lit+vec3<f32>(1.0,0.94,0.82)*bellyBleedY*bellyBleedFwd*bellyBleedGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Corneal micro-glint secondary: tiny high-frequency specular speck beside main catchlight
  let cornMicroGate=toon*(1.0-metallic)*clamp(fv*4.0-1.5,0.0,1.0);
  let eyeProxL=length(input.worldPosition.xy-scene.eye0.xy);
  let eyeProxR=length(input.worldPosition.xy-scene.eye1.xy);
  let eyeProxBest=min(eyeProxL,eyeProxR);
  let cornMicroMask=smoothstep(crownEyeW*0.10,crownEyeW*0.04,eyeProxBest)*cornMicroGate;
  let microGlintOff=vec3<f32>(0.012,0.008,0.0);
  let microHalf=normalize(view+normalize(lightDir+microGlintOff));
  let cornMicroSpec=pow(max(0.0,dot(microHalf,normal)),96.0)*cornMicroMask;
  lit=clamp(lit+vec3<f32>(1.0,1.0,0.96)*cornMicroSpec*0.50,vec3<f32>(0.0),vec3<f32>(1.0));
  // Scleral SSS warm bleed at limbus: warm scatter at iris/sclera junction
  let scleralLimbusGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.5,0.0,1.0);
  let scleralLimbusMask=smoothstep(crownEyeW*0.14,crownEyeW*0.08,eyeProxBest)*smoothstep(crownEyeW*0.06,crownEyeW*0.10,eyeProxBest)*scleralLimbusGate;
  lit=clamp(lit+vec3<f32>(1.0,0.72,0.52)*scleralLimbusMask*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Pupil focal darkening: deepen absorption toward pupil center for depth
  let pupilFocalGate=toon*(1.0-metallic)*clamp(fv*3.0,0.0,1.0);
  let pupilDarkMask=smoothstep(crownEyeW*0.05,crownEyeW*0.02,eyeProxBest)*pupilFocalGate;
  lit=lit*(1.0-pupilDarkMask*0.30);
  // Tail root shadow crease: dark fold where tail meets body at base
  let tailRootCrGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let tailRootCrY=smoothstep(kneeY-scale*0.38,kneeY-scale*0.28,input.worldPosition.y)*smoothstep(kneeY-scale*0.18,kneeY-scale*0.24,input.worldPosition.y);
  let tailRootCrFwd=smoothstep(-0.10,-0.48,normal.z)*smoothstep(0.10,-0.06,abs(normal.y));
  let tailRootCrLat=1.0-smoothstep(crownEyeW*0.18,crownEyeW*0.34,abs(input.worldPosition.x));
  let tailRootCrShadow=tailRootCrY*tailRootCrFwd*tailRootCrLat*tailRootCrGate*0.28;
  lit=lit*(1.0-tailRootCrShadow)+vec3<f32>(0.18,0.10,0.14)*tailRootCrShadow;
  // Tail mid-body lateral specular ridge: bright highlight running lateral edge of tail body
  let tailMidSpecGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.0-0.5,0.0,1.0);
  let tailMidY=smoothstep(kneeY-scale*0.60,kneeY-scale*0.44,input.worldPosition.y)*smoothstep(kneeY-scale*0.22,kneeY-scale*0.34,input.worldPosition.y);
  let tailMidLat=smoothstep(crownEyeW*0.10,crownEyeW*0.22,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.30,crownEyeW*0.44,abs(input.worldPosition.x)));
  let tailMidFwd=smoothstep(-0.08,0.24,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.14,0.36,abs(normal.x));
  let tailMidSpec=pow(max(0.0,dot(halfVec,normal)),18.0)*tailMidY*tailMidLat*tailMidFwd*tailMidSpecGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.90)*tailMidSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tail tip SSS scatter: warm red-orange subsurface at very tip end of tail
  let tailTipSSSGate=organicSkin*(1.0-metallic)*toon*clamp(fv*2.5,0.0,1.0);
  let tailTipDist=clamp(1.0-tipDist/max(crownEyeW*0.08,0.001),0.0,1.0);
  let tailTipSSS=tailTipDist*tailTipDist*clamp(dot(-normal,lightDir)*0.5+0.5,0.0,1.0)*tailTipSSSGate;
  lit=clamp(lit+vec3<f32>(1.0,0.52,0.28)*tailTipSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ear canal inner shadow depth: dark interior depression for ear anatomy realism
  let earCanalGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.0,0.0,1.0);
  let earCanalY=smoothstep(earTopY-scale*0.12,earTopY-scale*0.04,input.worldPosition.y)*smoothstep(earTopY+scale*0.04,earTopY-scale*0.02,input.worldPosition.y);
  let earCanalLat=smoothstep(crownEyeW*0.54,crownEyeW*0.68,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*0.96,abs(input.worldPosition.x)));
  let earCanalFwd=smoothstep(0.14,-0.22,normal.z)*smoothstep(0.10,-0.06,abs(normal.y));
  let earCanalShadow=earCanalY*earCanalLat*earCanalFwd*earCanalGate*0.34;
  lit=lit*(1.0-earCanalShadow)+vec3<f32>(0.12,0.08,0.10)*earCanalShadow;
  // Ear pinna silhouette highlight: bright edge on outer ear silhouette rim
  let earPinnaGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.5-0.5,0.0,1.0);
  let earPinnaRim=pow(clamp(1.0-dot(view,normal),0.0,1.0),3.0)*earPinnaGate;
  let earPinnaMask=smoothstep(crownEyeW*0.48,crownEyeW*0.72,abs(input.worldPosition.x))*smoothstep(earTopY-scale*0.20,earTopY-scale*0.06,input.worldPosition.y);
  lit=clamp(lit+vec3<f32>(1.0,0.96,0.88)*earPinnaRim*earPinnaMask*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Horn root base shadow crease: dark band at base of horns where they meet skull
  let hornRootGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.5,0.0,1.0);
  let hornRootY=smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.20,input.worldPosition.y)*smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.18,input.worldPosition.y);
  let hornRootLat=smoothstep(crownEyeW*0.22,crownEyeW*0.38,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.68,abs(input.worldPosition.x)));
  let hornRootShadow=hornRootY*hornRootLat*hornRootGate*0.28;
  lit=lit*(1.0-hornRootShadow)+vec3<f32>(0.14,0.10,0.12)*hornRootShadow;
  // Wing membrane vein SSS: warm pink subsurface scatter through thin membrane on wing regions
  let wingMemGate=organicSkin*(1.0-metallic)*toon*clamp(fv*4.0-1.5,0.0,1.0);
  let wingMemMask=smoothstep(elbowY+scale*0.14,elbowY+scale*0.30,input.worldPosition.y)*smoothstep(crownEyeW*0.38,crownEyeW*0.60,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.80,crownEyeW*1.10,abs(input.worldPosition.x)));
  let wingMemSSS=clamp(dot(-normal,lightDir)*0.5+0.5,0.0,1.0)*wingMemGate*wingMemMask;
  let wingVeinWave=0.5+0.5*sin(abs(input.worldPosition.x)*8.0/scale+input.worldPosition.y*4.0/scale);
  lit=clamp(lit+vec3<f32>(1.0,0.60,0.52)*wingMemSSS*wingVeinWave*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fin spine base shadow: dark crease at root of fin spines where they emerge from body
  let finSpineBaseGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let finSpineBaseMask=smoothstep(crownEyeW*0.06,crownEyeW*0.16,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.24,crownEyeW*0.38,abs(input.worldPosition.x)));
  let finSpineBaseY=smoothstep(torsoY-scale*0.06,torsoY+scale*0.04,input.worldPosition.y)*smoothstep(torsoY+scale*0.16,torsoY+scale*0.08,input.worldPosition.y);
  let finSpineBaseShadow=finSpineBaseMask*finSpineBaseY*finSpineBaseGate*0.24;
  lit=lit*(1.0-finSpineBaseShadow)+vec3<f32>(0.14,0.10,0.14)*finSpineBaseShadow;
  // Wing leading edge specular ridge: bright highlight on anterior wing edge
  let wingLeadGate=toon*(1.0-metallic)*clamp(fv*5.0-2.0,0.0,1.0);
  let wingLeadMask=smoothstep(crownEyeW*0.60,crownEyeW*0.76,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.82,crownEyeW*0.92,abs(input.worldPosition.x)));
  let wingLeadFwd=smoothstep(-0.08,0.30,normal.z)*smoothstep(0.08,-0.06,abs(normal.y));
  let wingLeadEdgeSpec=pow(max(0.0,dot(halfVec,normal)),28.0)*wingLeadMask*wingLeadFwd*wingLeadGate;
  lit=clamp(lit+vec3<f32>(1.0,0.97,0.90)*wingLeadEdgeSpec*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Silhouette ink darkening: darken at grazing angles for stronger cel-shaded outline
  let inkGate=toon*(1.0-metallic*0.5);
  let inkRim=pow(clamp(1.0-dot(view,normal),0.0,1.0),6.0)*inkGate;
  lit=lit*(1.0-inkRim*0.52);
  // Small-creature brightness boost: smaller body gets brighter overall to compensate for silhouette crush
  let sizeBoost=clamp(1.0-scale*0.8,0.0,0.3)*toon;
  lit=clamp(lit*(1.0+sizeBoost*0.24),vec3<f32>(0.0),vec3<f32>(1.0));
  // Joint crease AO approximation: soft darkening near joint positions along limb axis
  let jointAOGate=organicSkin*(1.0-metallic)*toon;
  let kneeAOBand=smoothstep(scale*0.10,scale*0.04,abs(input.worldPosition.y-kneeY))*0.18;
  let elbowAOBand=smoothstep(scale*0.10,scale*0.04,abs(input.worldPosition.y-elbowY))*0.14;
  let wristAOBand=smoothstep(scale*0.06,scale*0.02,abs(input.worldPosition.y-wristY))*0.12;
  let jointAO=(kneeAOBand+elbowAOBand+wristAOBand)*jointAOGate;
  lit=lit*(1.0-jointAO)+vec3<f32>(0.12,0.08,0.10)*jointAO;
  // Palette saturation punch: boost chroma at mid-tone for Pokemon-vivid saturation
  let satLuma=dot(lit,vec3<f32>(0.2126,0.7152,0.0722));
  let chromaBoost=mix(vec3<f32>(satLuma),lit,1.0+toon*0.22);
  lit=clamp(mix(lit,chromaBoost,0.30),vec3<f32>(0.0),vec3<f32>(1.0));
  // Cel shadow boundary cross-hatch dither: fine hatch at cel transition for ink-print texture
  let celBoundary=abs(lit.r-0.36)+abs(lit.r-0.62);
  let hatchX=step(0.5,fract(input.worldPosition.x*40.0/scale));
  let hatchY=step(0.5,fract(input.worldPosition.y*40.0/scale));
  let crossHatch=(1.0-hatchX*hatchY)*0.5+0.5;
  let hatchDark=clamp(1.0-celBoundary*2.0,0.0,1.0);
  lit=lit*(1.0-hatchDark*crossHatch*toon*0.08);
  // Specular element hue chroma tint: bias bright specular toward element palette color
  let specLuma=clamp(dot(lit,vec3<f32>(0.2126,0.7152,0.0722))-0.70,0.0,0.30)/0.30;
  let elemHue=mix(vec3<f32>(1.0,1.0,1.0),scene.palette0.rgb,0.22);
  lit=clamp(mix(lit,lit*elemHue,specLuma*toon*0.18),vec3<f32>(0.0),vec3<f32>(1.0));
  // Micro-surface bump scatter: fine noise-perturbed normal variation for skin texture feel
  let microBumpGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.0,0.0,1.0);
  let microNoise=fract(sin(dot(input.worldPosition.xyz*32.0,vec3<f32>(17.3,41.9,23.7)))*27418.5)*2.0-1.0;
  let microNorm=normalize(normal+vec3<f32>(microNoise*0.04,microNoise*0.03,0.0));
  let microBumpLit=pow(max(0.0,dot(halfVec,microNorm)),12.0)*microBumpGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*microBumpLit*0.08,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fresnel highlight intensity boost: Fresnel amplifies specular at near-grazing lit zones
  let fresnelBoost=fresnel*fresnel*toon*clamp(dot(normal,lightDir),0.0,1.0);
  let fresnelHBoost=fresnelBoost*(1.0-metallic)*0.12;
  lit=clamp(lit*(1.0+fresnelHBoost),vec3<f32>(0.0),vec3<f32>(1.0));
  // Palette shadow color tinting: shadows take on complementary hue of primary palette
  let shadowZone=clamp(0.30-dot(lit,vec3<f32>(0.333)),0.0,0.30)/0.30;
  let palComplement=vec3<f32>(1.0)-scene.palette0.rgb*0.5+0.25;
  let shadowTint=mix(vec3<f32>(1.0),palComplement,shadowZone*toon*0.18);
  lit=clamp(lit*shadowTint,vec3<f32>(0.0),vec3<f32>(1.0));
  // Claw lateral shine ridge: hard specular line along claw edge
  let clawLateralGate=toon*(1.0-organicSkin*0.3)*clamp(fv*3.0-0.5,0.0,1.0);
  let clawLateralMask=clawTip*smoothstep(crownEyeW*0.04,crownEyeW*0.12,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.16,crownEyeW*0.24,abs(input.worldPosition.x)));
  let clawLateralFwd=smoothstep(0.14,0.50,normal.z)*smoothstep(0.08,-0.06,abs(normal.y))*smoothstep(0.12,0.34,abs(normal.x));
  let clawLateralSpec=pow(max(0.0,dot(halfVec,normal)),56.0)*clawLateralMask*clawLateralFwd*clawLateralGate;
  lit=clamp(lit+vec3<f32>(1.0,0.99,0.96)*clawLateralSpec*0.36,vec3<f32>(0.0),vec3<f32>(1.0));
  // Claw underside SSS translucency: warm amber SSS through thin claw tip
  let clawUndSSSGate=toon*(1.0-metallic)*clamp(fv*2.5,0.0,1.0);
  let clawUndSSS=clawTip*clamp(dot(-normal,lightDir)*0.5+0.5,0.0,1.0)*clawUndSSSGate;
  let clawThinFac=clamp(1.0-abs(dot(view,normal))*2.2,0.0,1.0);
  lit=clamp(lit+vec3<f32>(1.0,0.80,0.48)*clawUndSSS*clawThinFac*0.24,vec3<f32>(0.0),vec3<f32>(1.0));
  // Toe pad contact darkening: soft dark AO under toe pads at ground level
  let toePadGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*2.0,0.0,1.0);
  let toePadGroundProx=clamp(1.0-(input.worldPosition.y-kneeY+scale*0.56)/(scale*0.06),0.0,1.0);
  let toePadFwd=smoothstep(0.24,0.56,normal.z);
  let toePadAO=toePadGroundProx*toePadFwd*toePadGate*0.26;
  lit=lit*(1.0-toePadAO)+vec3<f32>(0.10,0.07,0.08)*toePadAO;
  // Sagittal crest midline fine ridge: bright specular line on crown apex center
  let sagCrestFineGate=organicSkin*(1.0-metallic)*toon*clamp(fv*3.0-0.8,0.0,1.0);
  let sagCrestFineY=smoothstep(crownEyeY+crownEyeW*0.14,crownEyeY+crownEyeW*0.24,input.worldPosition.y)*smoothstep(crownEyeY+crownEyeW*0.44,crownEyeY+crownEyeW*0.34,input.worldPosition.y);
  let sagCrestFineLat=1.0-smoothstep(crownEyeW*0.04,crownEyeW*0.12,abs(input.worldPosition.x));
  let sagCrestFineFwd=smoothstep(-0.04,-0.22,normal.z)*smoothstep(0.30,0.56,normal.y);
  let sagCrestFineSpec=pow(max(0.0,dot(halfVec,normal)),28.0)*sagCrestFineY*sagCrestFineLat*sagCrestFineFwd*sagCrestFineGate;
  lit=clamp(lit+vec3<f32>(1.0,0.99,0.96)*sagCrestFineSpec*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Temporal fossa depression shadow: deeper soft hollow on lateral skull
  let tempFossaDeepGate=organicSkin*(1.0-metallic)*toon*clamp(1.0-fv*3.0,0.0,1.0);
  let tempFossaDeepY=smoothstep(crownEyeY-crownEyeW*0.08,crownEyeY+crownEyeW*0.08,input.worldPosition.y)*smoothstep(crownEyeY+crownEyeW*0.28,crownEyeY+crownEyeW*0.18,input.worldPosition.y);
  let tempFossaDeepLat=smoothstep(crownEyeW*0.38,crownEyeW*0.56,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.70,crownEyeW*0.88,abs(input.worldPosition.x)));
  let tempFossaDeepShadow=tempFossaDeepY*tempFossaDeepLat*tempFossaDeepGate*0.22;
  lit=lit*(1.0-tempFossaDeepShadow)+vec3<f32>(0.16,0.10,0.14)*tempFossaDeepShadow;
  // Occipital protuberance posterior skull highlight: bump at posterior skull base
  let occipGate=organicSkin*(1.0-metallic)*toon*clamp(fv*4.0-1.0,0.0,1.0);
  let occipBandY=smoothstep(crownEyeY-crownEyeW*0.12,crownEyeY-crownEyeW*0.04,input.worldPosition.y)*smoothstep(crownEyeY+crownEyeW*0.10,crownEyeY+crownEyeW*0.02,input.worldPosition.y);
  let occipLat=1.0-smoothstep(crownEyeW*0.08,crownEyeW*0.20,abs(input.worldPosition.x));
  let occipFwd=smoothstep(-0.12,-0.46,normal.z)*smoothstep(0.10,-0.06,abs(normal.y));
  let occipSpec=pow(max(0.0,dot(halfVec,normal)),22.0)*occipBandY*occipLat*occipFwd*occipGate;
  lit=clamp(lit+vec3<f32>(1.0,0.98,0.94)*occipSpec*0.18,vec3<f32>(0.0),vec3<f32>(1.0));
  // Corneal polarization specular tint: at oblique view angles, the eye's corneal surface exhibits polarization-dependent reflection where the specular component picks up a slight element-palette hue tint rather than being pure white — high-end anime games use this to make eye reflections look optically material-correct rather than generic white blobs; Genshin Impact's eye speculars have a characteristic crystal-clear clarity with slight element hue; modeled as a palette2-tinted specular boost at high Fresnel eye zones
  let corneaPolarGate=organicSkin*(1.0-metallic)*smoothstep(0.50,0.72,fresnel)*(1.0-smoothstep(0.80,0.94,fresnel))*smoothstep(0.18,0.36,toon)*0.16;
  let corneaPolar0=eye0pre*smoothstep(scene.eye0.w*0.96,scene.eye0.w*0.52,length(input.worldPosition.xy-scene.eye0.xy));
  let corneaPolar1=eye1pre*smoothstep(scene.eye1.w*0.96,scene.eye1.w*0.52,length(input.worldPosition.xy-scene.eye1.xy));
  lit=clamp(lit+scene.palette2.rgb*max(corneaPolar0,corneaPolar1)*pow(max(dot(normal,halfVec),0.0),16.0)*corneaPolarGate*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Joint capsule subsurface scatter: at limb joints (knee, elbow, wrist, ankle), the thin fibrous joint capsule has moderate SSS that glows warm-red when backlit — gives joints the biological presence quality visible in all well-rendered game characters; without joint SSS, joints look like geometric flex points; with it they feel like actual anatomical structures; modeled as warm SSS in the lateral narrow band at each joint height when backlit
  let jointCapsuleGate=organicSkin*(1.0-metallic)*clamp(palBright-0.16,0.0,1.0)*smoothstep(0.04,0.18,toon)*(1.0-smoothstep(0.30,0.48,toon));
  let kneeCapsuleBand=smoothstep(crownEyeW*0.12,crownEyeW*0.04,abs(input.worldPosition.y-kneeY))*smoothstep(crownEyeW*0.58,crownEyeW*0.84,abs(input.worldPosition.x));
  let elbowCapsuleBand=smoothstep(crownEyeW*0.10,crownEyeW*0.03,abs(input.worldPosition.y-elbowY))*smoothstep(crownEyeW*0.62,crownEyeW*0.90,abs(input.worldPosition.x));
  let jointCapsuleBack=max(0.0,-dot(normal,lightDir))*smoothstep(0.06,0.24,abs(normal.x));
  let jointCapsuleSSS=(kneeCapsuleBand+elbowCapsuleBand)*jointCapsuleBack*jointCapsuleGate;
  lit=clamp(lit+vec3<f32>(0.74,0.22,0.12)*jointCapsuleSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur-body contact base AO darkening: at the exact base where thick fur meets the body surface, the dense fur compresses against the skin creating a narrow ambient-occlusion shadow at the fur-root line — Arcanine's neck ruff has a dark ring at its base against the neck, Eevee's collar has a dark root shadow; gives fur structures the "depth" quality showing they sit on top of the body rather than being part of it; modeled as a narrow band at the crown-eye Y level lateral surfaces on furry creatures
  let furBaseAOGate=furGate*(1.0-metallic)*smoothstep(0.08,0.24,toon)*0.20;
  let furBaseAOY=smoothstep(crownEyeW*0.08,crownEyeW*0.02,abs(input.worldPosition.y-(crownEyeY-crownEyeW*0.32)));
  let furBaseAOLat=smoothstep(crownEyeW*0.28,crownEyeW*0.52,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.80,abs(input.worldPosition.x)));
  lit=lit*(1.0-furBaseAOY*furBaseAOLat*furBaseAOGate*0.32);
  // Skin depth color temperature gradient (warm core, cool surface): in thick organic limbs, longer red wavelengths scatter deeper and emerge from the center of the limb while shorter blue wavelengths scatter at the surface; creates the characteristic warm interior → cool surface SSS color gradient at body edges; at the lit-shadow terminator the edge of a limb shows warm reddish SSS (deep tissue) while the very surface stays cooler; Mewtwo's arm at the terminator, Gardevoir's neck, Dragonite's limbs all show this warm-core/cool-surface SSS depth gradient
  let skinDepthGradGate=organicSkin*(1.0-metallic)*smoothstep(0.06,0.22,toon)*(1.0-smoothstep(0.36,0.54,toon));
  let skinDepthCoreDist=clamp(1.0-length(input.worldPosition.xz)*scale*0.70,0.0,1.0);
  let skinDepthEdgeDist=clamp(length(input.worldPosition.xz)*scale*0.70-0.30,0.0,1.0);
  lit=clamp(lit+vec3<f32>(0.18,0.04,-0.02)*skinDepthCoreDist*skinDepthGradGate+vec3<f32>(-0.04,-0.01,0.08)*skinDepthEdgeDist*skinDepthGradGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow-side element environment reflection: the shadow-facing surfaces of creatures receive subtle element-tinted environmental reflection from their surroundings — a Fire creature's shadow side catches warm amber from the hot volcanic environment; Water creatures catch blue-green from the aquatic environment; this "environmental color cast on shadow side" is the classic Genshin Impact and Pokemon S/V ambient setup where the environment itself is element-colored and reflects back onto the creature from the shadow direction
  let shadowEnvReflGate=smoothstep(0.28,0.12,toon)*(1.0-metallic)*0.10;
  let shadowEnvColor=mix(mix(vec3<f32>(0.36,0.14,0.02),vec3<f32>(0.04,0.14,0.36),blueSheen),mix(vec3<f32>(0.28,0.24,0.02),vec3<f32>(0.18,0.04,0.28),shadowDom),max(warmDom,elecChargeGate));
  lit=clamp(lit+shadowEnvColor*scene.palette1.rgb*0.40*shadowEnvReflGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular micro-roughness variation: even smooth organic surfaces have a very fine roughness variation from micro-scale texture differences — pores, scale micro-edges, keratin cell boundaries — that creates a subtle "pebbled" variation in specular intensity preventing perfectly uniform-smooth specular lobes; distinct from the existing micro-bump scatter (which uses normal perturbation), this modulates the specular power itself with a fine noise mask; gives organic creatures a "real skin" specular pattern vs an airbrushed synthetic look
  let specMicroVarGate=organicSkin*(1.0-metallic)*smoothstep(0.36,0.58,toon)*specShadowMask*0.18;
  let specMicroHash=fract(sin(dot(floor(input.worldPosition.xyz*scale*28.0),vec3<f32>(91.3,157.7,51.4)))*31758.5)*2.0-1.0;
  let specMicroD=pow(max(dot(normal,halfVec),0.0),mix(40.0,80.0,specMicroHash*0.5+0.5));
  let specMicroMask=smoothstep(0.60,0.84,fract(sin(dot(floor(input.worldPosition.xyz*scale*18.0+fv*2.0),vec3<f32>(73.1,23.9,47.7)))*23758.5));
  lit=clamp(lit+vec3<f32>(0.96,0.94,0.90)*specMicroD*specMicroMask*specMicroVarGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Micro-follicle SSS cluster: on forward-facing organic skin surfaces, individual hair follicles and pores create tiny pinprick warm SSS dots that form a subtle cluster texture at close view — gives skin the "pore depth" quality that separates high-res Pokemon close-up renders from flat cartoon surfaces; Mewtwo, Gardevoir, Espeon, Sylveon close-up faces show this fine warm texture from individual skin pores; modeled as a fine hash-based warm dot pattern on organic forward-facing skin at moderate lit levels
  let poreSSS_Gate=organicSkin*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.22,0.44,toon)*(1.0-smoothstep(0.56,0.76,toon))*0.16;
  let poreSSS_Hash=fract(sin(dot(floor(input.worldPosition.xyz*scale*38.0),vec3<f32>(41.3,137.7,71.4)))*53218.5);
  let poreSSS_Dot=step(0.92,poreSSS_Hash);
  let poreSSS_Fwd=smoothstep(0.26,0.56,normal.z)*smoothstep(0.08,-0.08,abs(normal.y));
  let poreSSS=poreSSS_Dot*poreSSS_Fwd*poreSSS_Gate;
  lit=clamp(lit+mix(vec3<f32>(0.72,0.28,0.18),scene.palette1.rgb*0.50+vec3<f32>(0.50),clamp(palBright-0.30,0.0,1.0))*poreSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-biased ambient temperature: the shadow ambient light temperature shifts toward each element's characteristic environmental context — Fire creatures exist in a warm amber environment (volcanic/forge ambiance), Water creatures in cool blue (aquatic ambiance), Electric in neutral-white electrostatic, Shadow/Dark in cool violet (moonlit/void), Earth in warm sienna (cave/soil); this shifts the base shadowAmbient tone by element rather than using fixed neutral; currently shadowAmbient is a fixed constant, this adds element modulation
  let elemAmbTemp=mix(mix(vec3<f32>(0.22,0.08,-0.04),vec3<f32>(-0.04,0.00,0.18),blueSheen),mix(vec3<f32>(0.16,0.14,-0.06),vec3<f32>(-0.04,-0.02,0.16),shadowDom),clamp(warmDom+elecChargeGate-blueSheen*0.50,0.0,1.0));
  let elemAmbGate=smoothstep(0.18,0.04,toon)*(1.0-metallic)*0.12;
  lit=clamp(lit+elemAmbTemp*elemAmbGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Caustic pool reflection on belly/underside: Water-type creatures near water receive animated caustic light patterns on their downward-facing belly surfaces — reflected from the water surface below; Vaporeon, Gyarados, Milotic, Suicune belly surfaces show moving light-web patterns from pool caustics; gives water creatures a distinct "near water" environmental quality; modeled as an animated light-pattern on downward-facing low-Y surfaces gated on water-dominant blue creatures
  let causticPoolGate=blueSheen*smoothstep(0.16,0.36,toon)*(1.0-metallic)*clamp(1.0-fv*2.0,0.0,1.0)*0.18;
  let causticPoolFace=smoothstep(-0.28,-0.62,normal.y)*smoothstep(0.08,0.34,abs(normal.z)+abs(normal.x)*0.60);
  let causticPoolY=clamp(1.0-(input.worldPosition.y+crownEyeW*0.40)/(crownEyeW*1.0+0.001),0.0,1.0);
  let causticPoolA=sin(input.worldPosition.x*scale*8.0+fv*4.2)*sin(input.worldPosition.z*scale*7.0+fv*3.7)*0.5+0.5;
  let causticPoolB=sin(input.worldPosition.x*scale*11.0+fv*3.1+1.4)*sin(input.worldPosition.z*scale*9.0+fv*2.9+0.8)*0.5+0.5;
  let causticPoolPat=step(0.76,causticPoolA)*step(0.76,causticPoolB)*causticPoolFace*causticPoolY*causticPoolGate;
  lit=clamp(lit+vec3<f32>(0.52,0.78,1.0)*causticPoolPat*0.32,vec3<f32>(0.0),vec3<f32>(1.0));
  // Wing/fin tip translucency gradient: wing and fin membranes thin toward the tip, becoming progressively more translucent — the near-base region is opaque while the extreme tip approaches near-transparency; this depth-sorted opacity gradient is what makes Charizard's, Dragonite's, and Vaporeon's wing/fin structures look three-dimensionally thin rather than uniform slabs; modeled as an SSS brightening that strengthens toward the lateral extremes (tip) on air/water creatures with lateral extensions
  let wingTipTranspGate=lateralExt*(1.0-metallic)*smoothstep(0.04,0.18,toon)*(1.0-smoothstep(0.32,0.50,toon));
  let wingTipTranspDist=clamp((abs(input.worldPosition.x)*scale-crownEyeW*0.72)/(crownEyeW*0.90),0.0,1.0);
  let wingTipTransp=wingTipTranspDist*wingTipTranspDist*max(0.0,-dot(normal,lightDir))*wingTipTranspGate;
  let wingTipTranspColor=mix(vec3<f32>(0.64,0.52,0.40),scene.palette2.rgb*0.80+vec3<f32>(0.20),clamp(blueSheen+plantDom-warmDom,0.0,1.0));
  lit=clamp(lit+wingTipTranspColor*wingTipTransp*0.26,vec3<f32>(0.0),vec3<f32>(1.0));
  // Fur mane strand cast shadow network: the thick fur from a creature's mane, crest, or collar casts fine strand-shadow patterns onto the adjacent face, neck, and back surfaces below — Arcanine's mane casts fine shadow strands onto its neck and shoulders; Vaporeon's dorsal fin ridge casts a subtle shadow on its back; this cross-structure shadow is what gives fur a volumetric presence rather than looking like a flat painted layer; modeled as a fine noise shadow at the mane-fall zone on the neck-back lateral surfaces below the crown
  let furCastShadowGate=furGate*(1.0-metallic)*smoothstep(0.12,0.30,toon)*0.20;
  let furCastY=smoothstep(crownEyeY-crownEyeW*0.40,crownEyeY-crownEyeW*0.90,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.90,crownEyeY-crownEyeW*1.60,input.worldPosition.y));
  let furCastLat=smoothstep(crownEyeW*0.22,crownEyeW*0.56,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.56,crownEyeW*0.90,abs(input.worldPosition.x)));
  let furCastNoise=fract(sin(dot(floor(input.worldPosition.xyz*scale*22.0+fv*5.0),vec3<f32>(127.1,311.7,74.7)))*43758.5);
  let furStrandCast=step(0.86,furCastNoise)*furCastY*furCastLat*furCastShadowGate;
  lit=lit*(1.0-furStrandCast*0.22);
  // Inter-limb element color bounce: in the gap between adjacent limbs (inner thigh, inner arm-torso), element-colored light from the lit limb surfaces bounces onto the facing surfaces across the gap — gives the inter-limb cavity a colored ambient rather than just a dark void; Charizard has warm orange bounce between arm and torso, Vaporeon has blue-cyan bounce between legs; this color bounce is the complement to the inter-limb AO darkening (which reduces all light) — this adds element-colored ambient back in
  let limbElemBounceGate=(1.0-metallic)*smoothstep(0.10,0.28,toon)*(1.0-smoothstep(0.28,0.50,toon))*0.14;
  let limbElemBounceLat=smoothstep(crownEyeW*0.30,crownEyeW*0.52,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.52,crownEyeW*0.80,abs(input.worldPosition.x)));
  let limbElemBounceY=smoothstep(crownEyeY-crownEyeW*2.30,crownEyeY-crownEyeW*1.50,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.50,crownEyeY-crownEyeW*0.80,input.worldPosition.y));
  let limbElemBounceFace=smoothstep(0.10,-0.20,abs(normal.x))*smoothstep(0.08,0.24,abs(normal.z));
  let limbElemBounce=limbElemBounceLat*limbElemBounceY*limbElemBounceFace*limbElemBounceGate;
  lit=clamp(lit+scene.palette1.rgb*0.36*limbElemBounce,vec3<f32>(0.0),vec3<f32>(1.0));
  // Digital data stream flowing cascade: on Shadow/Electric/Metal non-organic creatures, vertical columns of flowing symbol-like highlights simulate the active digital data streams visible on high-level Digimon (Alphamon, Omnimon, Gallantmon) and evolved Mega forms — different from the static circuit grid lines (which are stationary), these columns flow downward via fv-based animation offset, giving the creature a "live processing" quality that marks it as a powerful digital entity
  let dataStreamGate=(shadowDom*0.70+elecChargeGate*0.80+metallic*0.30)*(1.0-organicSkin)*toon*clamp(fv*3.0-0.5,0.0,1.0)*0.18;
  let dataStreamCol=floor(input.worldPosition.x*scale*7.40);
  let dataStreamColHash=fract(sin(dataStreamCol*91.37+fv*0.30)*43758.5);
  let dataStreamY=fract(input.worldPosition.y*scale*9.0-fv*2.80-dataStreamColHash*3.14);
  let dataStreamDot=step(0.94,dataStreamY)*step(0.72,dataStreamColHash);
  lit=clamp(lit+scene.palette2.rgb*1.20*dataStreamDot*dataStreamGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element power aura corona: evolved/empowered creatures radiate a soft element-colored glow field from their body center — the "Digimon active aura" or "Pokemon dynamax aura" effect visible when creatures are at peak power; modeled as a radial gradient of element color centered at the creature's world origin, strongest in the body center, fading toward edges, gated on high-element-intensity creatures (strong elemental palette reading)
  let auraFieldGate=clamp(palBright-0.36,0.0,1.0)*(1.0-metallic)*smoothstep(0.22,0.46,toon)*(1.0-smoothstep(0.46,0.68,toon))*clamp(fv*2.0,0.0,1.0)*0.12;
  let auraCoreDist=length(input.worldPosition.xy)*scale;
  let auraFieldCore=clamp(1.0-auraCoreDist*0.72,0.0,1.0)*auraFieldGate;
  lit=clamp(lit+scene.palette2.rgb*0.80*auraFieldCore,vec3<f32>(0.0),vec3<f32>(1.0));
  // Cinematic anime color grade matrix: apply a subtle color grade inspired by anime production pipelines — slight cyan lift in shadows, warm orange-gold tone in midrange, cool blue-white in highlights; this is the standard anime color grade that makes rendered characters look "hand-painted" and distinct from raw PBR output; Game Freak and Bandai Namco anime renders consistently have this warm-mid/cool-highlight color profile; applied as final post-LUT before gamma
  let cinematicLuma=dot(lit,vec3<f32>(0.2126,0.7152,0.0722));
  let cineHL=smoothstep(0.74,0.96,cinematicLuma)*0.020;
  let cineMid=smoothstep(0.30,0.62,cinematicLuma)*(1.0-smoothstep(0.62,0.82,cinematicLuma))*0.014;
  let cineSH=smoothstep(0.20,0.04,cinematicLuma)*0.016;
  lit=clamp(lit+vec3<f32>(cineMid*0.28+cineHL*0.06,-cineMid*0.04-cineHL*0.02,cineHL*0.26-cineMid*0.18)+vec3<f32>(-cineSH*0.08,-cineSH*0.04,cineSH*0.36),vec3<f32>(0.0),vec3<f32>(1.0));
  // Pupil dilation soft edge bloom: when the pupil is large (dilated), the pupil boundary creates a soft luminous edge halo from optical diffraction and pigment epithelium glow — the "dilated pupil glow" visible in all detailed anime eyes where a large dark pupil has a very faint bright ring at its exact boundary; gives eyes the "dilated in dim light" quality that reads as emotional engagement; distinct from the catchlight features which are reflections; this is a very faint emissive ring from within the pupil boundary
  let pupilBloomGate=organicSkin*(1.0-metallic)*smoothstep(0.10,0.26,toon)*0.24;
  let pupilBloom0=smoothstep(scene.eye0.w*0.52,scene.eye0.w*0.40,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*(1.0-smoothstep(scene.eye0.w*0.40,scene.eye0.w*0.28,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z))))*eye0pre;
  let pupilBloom1=smoothstep(scene.eye1.w*0.52,scene.eye1.w*0.40,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*(1.0-smoothstep(scene.eye1.w*0.40,scene.eye1.w*0.28,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z))))*eye1pre;
  let pupilBloomFace=smoothstep(0.36,0.68,normal.z)*smoothstep(0.06,-0.10,abs(normal.y));
  lit=clamp(lit+mix(vec3<f32>(0.62,0.46,0.74),scene.palette2.rgb*0.60+vec3<f32>(0.40),clamp(palBright-0.30,0.0,1.0))*max(pupilBloom0,pupilBloom1)*pupilBloomFace*pupilBloomGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Knobby/tubercle skin ridge micro-texture: on non-organic high-roughness surfaces (Earth/Water/neutral rough textures), fine bumpy ridge texture creates small shadow valleys and bright ridge tops like dinosaur skin or toad skin — distinct from the existing earth crack and mosaic features (those are larger scale); this is a sub-centimeter micro-ridge pattern that adds surface detail visible at close range; Golem, Rhydon, Swampert, Dragonite underbelly knobby quality
  let knobbyRidgeGate=(1.0-organicSkin)*(1.0-metallic)*msRgh*smoothstep(0.38,0.58,toon)*0.24;
  let knobbyFreq=input.worldPosition.xyz*scale*14.0;
  let knobbyA=sin(knobbyFreq.x*3.10+knobbyFreq.y*1.70)*0.5+0.5;
  let knobbyB=sin(knobbyFreq.y*2.80+knobbyFreq.z*2.30+1.60)*0.5+0.5;
  let knobbyRidge=smoothstep(0.64,0.82,knobbyA*knobbyB)*knobbyRidgeGate;
  let knobbySpec=pow(max(dot(normal,halfVec),0.0),28.0)*knobbyRidge*specShadowMask;
  lit=clamp(lit*(1.0-knobbyRidge*0.16)+mix(vec3<f32>(0.96,0.94,0.90),scene.palette0.rgb*0.60+vec3<f32>(0.40),0.22)*knobbySpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow element environmental re-illumination: in deep shadow zones, a faint element-characteristic ambient re-illuminates the darkest surface from within — the creature's own element type creates a subtle coloring of its shadow interior; Fire creatures have warm amber deep shadow, Water creatures have cool blue shadow, Electric has yellow-white, Shadow has violet-black; this is the final layer of element integration making the shadow feel "alive with element energy" rather than neutral dead black
  let shadowReillumGate=smoothstep(0.16,0.04,toon)*(1.0-metallic)*0.08;
  let shadowReillumColor=mix(mix(vec3<f32>(0.40,0.12,0.02),vec3<f32>(0.10,0.12,0.40),blueSheen),mix(vec3<f32>(0.36,0.34,0.08),vec3<f32>(0.24,0.08,0.32),shadowDom),max(elecChargeGate,warmDom));
  let shadowReillum=shadowReillumColor*scene.palette1.rgb*0.50*shadowReillumGate;
  lit=clamp(lit+shadowReillum,vec3<f32>(0.0),vec3<f32>(1.0));
  // Dorsal plate armor edge bevel specular: armored creatures (Metal/Earth/Dark non-organic types) have raised scale or armor plates with beveled edges that catch bright specular on the angled bevel face — this edge highlight is visible on Scizor's wing covers, Metagross's body seams, Kabutops's scythe blade edge, Aggron's body plate edges; each plate acts as a polygon face with a distinct bright beveled edge ring; modeled as a tight high-frequency position-based specular on lateral-facing microstructure surfaces of hard non-organic creatures
  let armorEdgeBevelGate=(1.0-organicSkin)*(1.0-metallic*0.40)*smoothstep(0.48,0.72,toon)*specShadowMask*0.22;
  let armorEdgeHash=fract(sin(dot(floor(input.worldPosition.xyz*9.0),vec3<f32>(41.3,83.7,29.4)))*23758.5);
  let armorEdgeIsEdge=smoothstep(0.88,0.94,armorEdgeHash);
  let armorEdgeFace=smoothstep(0.24,0.56,abs(normal.x))*smoothstep(0.14,0.36,abs(normal.z));
  let armorEdgeBevelSpec=pow(max(dot(normal,halfVec),0.0),72.0)*armorEdgeIsEdge*armorEdgeFace*armorEdgeBevelGate;
  lit=clamp(lit+mix(vec3<f32>(1.0,0.98,0.94),scene.palette0.rgb*0.50+vec3<f32>(0.50),0.22)*armorEdgeBevelSpec*0.48,vec3<f32>(0.0),vec3<f32>(1.0));
  // Iridophore structural color layer: specialized iridophore cells in scale-covered creatures produce broad angle-dependent structural coloration distinct from pigment — creates a smooth, wide hue-shift across the scale surface that's independent of the viewing angle specular; Charizard's dorsal scale area shifts amber-to-green, Dragonite has a golden midline structural color, Salamence's lateral scales show blue-shift; this is broader and more gradual than the discrete iridescence features, covering the entire scale surface rather than just facets
  let iridophoreGate=(1.0-organicSkin)*(1.0-metallic)*warmDom*smoothstep(0.22,0.48,toon)*0.12;
  let iridophoreAngle=dot(normal,view)*3.14+dot(normal,halfVec)*2.0+fv*3.14;
  let iridophoreColor=vec3<f32>(sin(iridophoreAngle)*0.5+0.5,sin(iridophoreAngle+2.094)*0.5+0.5,sin(iridophoreAngle+4.189)*0.5+0.5);
  lit=clamp(lit+iridophoreColor*iridophoreGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element emission subsurface interior glow: element-typed creatures with glowing traits (Fire/Electric/Water) emit element-colored light internally that bleeds back through thin body skin — creates an element-typed warm ambient in the body volume that's distinct from neutral SSS; Fire creatures have warm ember glowing through from within, Electric creatures have yellow-white interior luminosity, Water creatures have cool blue-green internal glow; modeled as a position-based element-tinted interior ambient that fires in the body center where the emission originates
  let elemEmitSSSGate=(fireGlow*warmDom+elecChargeGate*0.80+blueSheen*0.60)*(1.0-metallic)*smoothstep(0.06,0.24,toon)*(1.0-smoothstep(0.44,0.62,toon));
  let elemEmitSSSCore=clamp(1.0-length(input.worldPosition.xy)*scale*0.68,0.0,1.0);
  let elemEmitColor=mix(mix(vec3<f32>(0.90,0.42,0.08),vec3<f32>(0.88,0.90,0.40),elecChargeGate),vec3<f32>(0.22,0.58,0.76),blueSheen);
  lit=clamp(lit+elemEmitColor*elemEmitSSSCore*elemEmitSSSGate*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Tapetum lucidum retroreflection eye glow: many animal eyes have a tapetum lucidum reflective layer behind the retina that causes eye shine — when the key light is roughly aligned with the viewing direction (dot(light,view) high), the pupil zone retroreflects and becomes dramatically brighter; this is the "cat/dog eye shine" effect visible on Espeon, Umbreon, Vaporeon, Arcanine, Glaceon eyes at certain angles; gives creature eyes the characteristic "alive animal" glint distinct from the forward-facing catchlight; gated on organic creatures with eye presence (eye0pre or eye1pre)
  let tapetumGlowGate=organicSkin*(1.0-metallic)*clamp(dot(lightDir,view)-0.60,0.0,1.0)*4.0*smoothstep(0.10,0.28,toon);
  let tapetumEye0=smoothstep(scene.eye0.w*1.02,scene.eye0.w*0.60,length(input.worldPosition.xyz-vec3<f32>(scene.eye0.x,scene.eye0.y,scene.eye0.z)))*eye0pre;
  let tapetumEye1=smoothstep(scene.eye1.w*1.02,scene.eye1.w*0.60,length(input.worldPosition.xyz-vec3<f32>(scene.eye1.x,scene.eye1.y,scene.eye1.z)))*eye1pre;
  let tapetumGlow=max(tapetumEye0,tapetumEye1)*tapetumGlowGate;
  lit=clamp(lit+mix(vec3<f32>(0.92,0.86,0.62),scene.palette2.rgb*0.80+vec3<f32>(0.20),clamp(palBright-0.30,0.0,1.0))*tapetumGlow*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lip wet specular highlight ring: the lip tissue is coated in saliva which creates a thin liquid surface with high specular intensity at the lip margin — this produces a tight bright specular ring just at the vermilion border (the edge between lip and face skin); distinct from the existing lipRing which is a warm SSS bleed; this is a forward-facing tight specular highlight on the lip edge that gives mouths the "freshly wet" quality visible in all modern Pokemon renders (Gardevoir, Mewtwo, Lopunny, Braixen open-mouth expressions)
  let lipWetGlossGate=muzzleBlend*organicSkin*(1.0-metallic)*smoothstep(0.24,0.52,toon)*specShadowMask*0.28;
  let lipWetZone0=smoothstep(scene.mouth.w*0.92,scene.mouth.w*0.72,lipZoneDist)*(1.0-smoothstep(scene.mouth.w*0.72,scene.mouth.w*0.52,lipZoneDist))*(1.0-mouthBlend);
  let lipWetFace=smoothstep(0.32,0.62,normal.z)*smoothstep(0.14,-0.10,abs(normal.y))*smoothstep(0.12,0.04,abs(normal.x));
  let lipWetGloss=pow(max(dot(normal,halfVec),0.0),52.0)*lipWetZone0*lipWetFace*lipWetGlossGate;
  lit=clamp(lit+vec3<f32>(0.98,0.96,0.94)*lipWetGloss*0.38,vec3<f32>(0.0),vec3<f32>(1.0));
  // Ventral pelage lightening: organic furry creatures have lighter belly fur than dorsal fur — the ventral (belly/chest) fur is typically cream-white while dorsal is the element color; countershading in fur density/pigment distribution; Eevee's cream chest, Arcanine's pale belly, Ninetales's light ventral, Espeon's cream underbelly; distinct from belly thermal warmth (which is a lit contribution) this modifies the base albedo to lighten belly fur pigmentation; gated on furGate creatures at belly/chest positions
  let pelageVentGate=furGate*(1.0-metallic)*0.30;
  let pelageVentY=smoothstep(torsoY-crownEyeW*0.30,torsoY+crownEyeW*0.60,input.worldPosition.y)*(1.0-smoothstep(torsoY+crownEyeW*0.60,torsoY+crownEyeW*1.60,input.worldPosition.y));
  let pelageVentFwd=smoothstep(0.20,0.48,normal.z)*smoothstep(0.12,0.04,abs(normal.y));
  let pelageVentLat=1.0-smoothstep(crownEyeW*0.60,crownEyeW*1.0,abs(input.worldPosition.x));
  let pelageVentLight=pelageVentY*pelageVentFwd*pelageVentLat*pelageVentGate;
  base=clamp(mix(base,clamp(base*0.66+vec3<f32>(0.34),vec3<f32>(0.0),vec3<f32>(1.0)),pelageVentLight),vec3<f32>(0.0),vec3<f32>(1.0));
  // Foveal focus peripheral softening: the extreme grazing-angle surfaces at the creature's silhouette edge get a slight desaturation and luminance reduction — simulating the natural attention falloff from foveal focus; the center of the creature reads with full vivid color while the extreme edges get subtly softened; gives the render a natural "focal drop" that makes the creature's core feel like the attended region; this is used in Genshin Impact's per-character shader to direct viewer attention
  let fovealFocusGate=pow(clamp(1.0-dot(view,normal),0.0,1.0),4.0)*(1.0-metallic)*0.14;
  let fovealFocusLuma=dot(lit,vec3<f32>(0.2126,0.7152,0.0722));
  lit=clamp(mix(lit,vec3<f32>(fovealFocusLuma)*0.82,fovealFocusGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Interior concavity bounce specular: in naturally concave anatomical regions (posterior knee/popliteal, inner elbow/cubital fossa, axilla), the two facing walls of the concavity can reflect light into each other creating a secondary dim specular from inside the cavity — this inter-surface bounce highlights the concavity from within, adding a subtle brightness that reads as "this is a real hollow"; without this, concavities only show shadow from above and look like painted-on depressions rather than real geometry; modeled as a dim specular fired from the negative-Y light direction on surfaces with outward-facing normals in the lateral knee and elbow height range
  let concavBounceGate=organicSkin*(1.0-metallic)*smoothstep(0.16,0.36,toon)*(1.0-smoothstep(0.36,0.58,toon))*0.14;
  let concavKneeFwd=normalize(vec3<f32>(0.0,-0.62,0.42));
  let concavKneeSpec=pow(max(dot(normal,normalize(concavKneeFwd+view)),0.0),12.0);
  let concavKneeZone=smoothstep(crownEyeW*0.44,crownEyeW*0.72,abs(input.worldPosition.x))*smoothstep(kneeY+crownEyeW*0.22,kneeY+crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(kneeY+crownEyeW*0.06,kneeY-crownEyeW*0.18,input.worldPosition.y));
  lit=clamp(lit+mix(vec3<f32>(0.72,0.64,0.52),scene.palette1.rgb*0.60+vec3<f32>(0.40),0.35)*concavKneeSpec*concavKneeZone*concavBounceGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Acral melanin gradient darkening: organic creature skin naturally accumulates melanin toward extremities — darker feet, hands/paws, ear tips, tail tips — the "acral pigmentation gradient" seen in most mammals and many Pokemon; Eevee's darker paws, Arcanine's darker paws, Mewtwo's slightly darker extremities vs central torso; gives the creature a natural pigmentation distribution that reads as biologically coherent; modeled as a position-based darkening at distal limb ends (at the Y extents of the creature) gated on organic non-metallic non-shadow surfaces
  let acralGate=organicSkin*(1.0-metallic)*(1.0-shadowDom)*0.16;
  let acralFootDark=smoothstep(crownEyeW*0.28,crownEyeW*0.04,input.worldPosition.y)*acralGate;
  let acralWristDark=smoothstep(wristY+crownEyeW*0.08,wristY-crownEyeW*0.14,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.14,wristY-crownEyeW*0.30,input.worldPosition.y))*smoothstep(crownEyeW*0.80,crownEyeW*1.16,abs(input.worldPosition.x))*acralGate;
  let acralPigment=clamp(acralFootDark+acralWristDark,0.0,1.0);
  base=clamp(base*(1.0-acralPigment*0.20)+scene.palette0.rgb*acralPigment*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // Subsurface deep body occlusion gradient: at the center of the creature's widest body dimension (maximum body thickness), SSS is fully blocked and the deep body absorbs light without scatter — modeled as a subtle cool-dark shift at the narrowest lateral-limb range that's away from the surface; prevents the central torso from having the same warm SSS glow as the edges, creating the realistic depth gradient from warm translucent edges to darker opaque core visible on Mewtwo, Blastoise, and Snorlax in side view
  let bodyOcclusionDist=clamp(1.0-length(input.worldPosition.xz)*scale*0.50,0.0,1.0);
  let bodyOcclusionGate=bodyOcclusionDist*bodyOcclusionDist*organicSkin*(1.0-metallic)*smoothstep(0.22,0.44,toon)*(1.0-smoothstep(0.60,0.80,toon));
  lit=clamp(lit*(1.0-bodyOcclusionGate*0.12)+vec3<f32>(-0.02,0.0,0.02)*bodyOcclusionGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-type specular color temperature bias: the secondary fill specular and ambient specular highlights are biased toward the creature's element characteristic hue — Fire-type secondary fill has warm orange tint, Water-type has cool cyan, Plant has lime-green, Electric has yellow, Shadow has violet; currently the fill specular is a fixed cool blue-white regardless of element; giving element-typed creatures their characteristic element-hued secondary speculars is one of the most visible quality improvements in all-element artist quality; modeled as a palette2-based color mix on the mid-luminance output
  let elemSpecBiasLuma=dot(lit,vec3<f32>(0.2126,0.7152,0.0722));
  let elemSpecBiasMid=smoothstep(0.52,0.76,elemSpecBiasLuma)*(1.0-smoothstep(0.86,0.96,elemSpecBiasLuma));
  lit=clamp(mix(lit,lit*mix(vec3<f32>(1.0),scene.palette2.rgb*1.14,0.32),elemSpecBiasMid*clamp(palBright-0.20,0.0,1.0)*0.22),vec3<f32>(0.0),vec3<f32>(1.0));
  // Micro-subsurface palm and sole SSS: the palm of the paw/hand and the sole of the foot have the thinnest skin over blood vessels in the entire limb — both glow distinctly warm pink-red in the lit-to-shadow transition zone; Eevee's paw pads, Pikachu's paws, Lucario's hand palm, Blaziken's foot sole all show this warm vascular glow; this "warm paw pad" quality is one of the primary cues that an organic creature's extremities are "alive" and distinct from a hard-surface prop; modeled as SSS warmth on downward-facing surfaces at wrist and foot-ground heights
  let pawPadSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.18,0.0,1.0)*smoothstep(0.06,0.22,toon)*(1.0-smoothstep(0.36,0.54,toon));
  let pawPadWristZone=smoothstep(wristY+crownEyeW*0.20,wristY-crownEyeW*0.06,input.worldPosition.y)*(1.0-smoothstep(wristY-crownEyeW*0.06,wristY-crownEyeW*0.30,input.worldPosition.y));
  let pawPadFootZone=clamp(1.0-(input.worldPosition.y+crownEyeW*0.16)/(crownEyeW*0.28+0.001),0.0,1.0);
  let pawPadFace=smoothstep(-0.10,-0.48,normal.y)*smoothstep(0.08,0.40,abs(normal.z)+abs(normal.x)*0.50);
  let pawPadSSS=max(0.0,-dot(normal,lightDir))*(pawPadWristZone+pawPadFootZone*0.70)*pawPadFace*pawPadSSSGate;
  lit=clamp(lit+vec3<f32>(0.76,0.26,0.16)*pawPadSSS*0.22,vec3<f32>(0.0),vec3<f32>(1.0));
  // Inter-limb ambient cavity darkening: the medial surfaces of adjacent limbs (inner thighs, armpit inner surface, space between folded tail and body) naturally receive less ambient light because nearby geometry partially occludes the sky hemisphere — this "inter-limb AO" creates the characteristic shadow strips visible between Mewtwo's legs, between Lucario's arm and torso, between a quadruped's front and rear legs when close together; modeled as a soft darkening at the medial limb range that fades toward both the body center and the outer limb extremes
  let interLimbLat=smoothstep(crownEyeW*0.36,crownEyeW*0.56,abs(input.worldPosition.x))*(1.0-smoothstep(crownEyeW*0.56,crownEyeW*0.86,abs(input.worldPosition.x)));
  let interLimbY=smoothstep(crownEyeY-crownEyeW*2.20,crownEyeY-crownEyeW*1.60,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*1.60,crownEyeY-crownEyeW*0.90,input.worldPosition.y));
  let interLimbFace=smoothstep(0.16,-0.16,abs(normal.x))*smoothstep(0.12,0.24,abs(normal.z));
  lit=lit*(1.0-interLimbLat*interLimbY*interLimbFace*(1.0-metallic)*0.22);
  // Element self-bounce tint on overhanging undersides: the brightly lit torso and belly of a creature reflects its element-colored light upward onto overhanging surfaces (chin underside, arm underside, chest underplate overhangs) — Charizard's chin catches warm orange from its lit orange belly; Dragonite's arm underside catches amber from its torso; Gardevoir's shoulder underside catches pale green from her dress; gives the creature an "internally lit" quality showing color interaction between body parts; modeled as an element-tinted warm glow on downward-facing surfaces (normal.y < -0.28) in the mid-lit zone
  let selfBounceGate=(1.0-metallic)*smoothstep(0.24,0.46,toon)*(1.0-smoothstep(0.46,0.68,toon));
  let selfBounceFace=smoothstep(-0.10,-0.42,normal.y)*smoothstep(0.06,0.30,abs(normal.z)+abs(normal.x));
  let selfBounceY=smoothstep(crownEyeY-crownEyeW*0.16,crownEyeY+crownEyeW*0.60,input.worldPosition.y);
  let selfBounceColor=mix(scene.palette1.rgb*0.48+vec3<f32>(0.52),scene.palette0.rgb*0.38+vec3<f32>(0.62),0.30);
  lit=clamp(lit+selfBounceColor*selfBounceFace*selfBounceY*selfBounceGate*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Gem-crystal prismatic dispersion bands: crystal and gem-type surfaces separate light into distinct spectral color bands across each facet face — richer than the ice prism which is view-angle based; gem dispersion produces separated RGB streaks based on position-frequency on the surface like light through a cut diamond; Sableye's gem eyes, Carbink facets, Diancie crystal, Shadow/Crystal Digimon; modeled as position-based sine wave spectral sampling separate from the ice halfvec prism
  let gemPrismGate=(1.0-organicSkin)*(1.0-msRgh*0.72)*metallic*smoothstep(0.52,0.76,toon)*specShadowMask*clamp(fv*3.0-0.5,0.0,1.0)*0.24;
  let gemPrismFreq=input.worldPosition.xyz*scale*12.0+fv*vec3<f32>(1.4,2.1,0.9);
  let gemPrismA=sin(gemPrismFreq.x*3.10+gemPrismFreq.y*1.70)*0.5+0.5;
  let gemPrismB=sin(gemPrismFreq.y*2.80+gemPrismFreq.z*2.30+2.094)*0.5+0.5;
  let gemPrismC=sin(gemPrismFreq.z*3.40+gemPrismFreq.x*1.90+4.189)*0.5+0.5;
  let gemPrismSpec=pow(max(dot(normal,halfVec),0.0),44.0)*gemPrismGate;
  lit=clamp(lit+vec3<f32>(gemPrismA,gemPrismB,gemPrismC)*gemPrismSpec*0.44,vec3<f32>(0.0),vec3<f32>(1.0));
  // Lenticular scale facet micro-catch: individual scale facets on scaled/armored creatures have sharp geometric edges that catch single-pixel bright glints at specific surface angles — the micro-facet specular catch is distinct from general scale iridescence; Charizard, Dragonite, Salamence, Scizor, Metagross all show these tiny bright micro-glints scattered across their scale surfaces at different viewing angles; modeled as a hash-based high-frequency tight specular that fires only on scale-appropriate surfaces (low roughness + warm-dominant or metallic)
  let lenticularScaleGate=(1.0-msRgh*0.64)*(warmDom*0.70+metallic*0.30)*smoothstep(0.44,0.68,toon)*specShadowMask*0.18;
  let lenticularHash=fract(sin(dot(floor(input.worldPosition.xyz*18.0+fv*3.0),vec3<f32>(37.1,157.7,41.4)))*31758.5);
  let lenticularGlint=step(0.93,lenticularHash)*pow(max(dot(normal,halfVec),0.0),120.0)*lenticularScaleGate;
  lit=clamp(lit+mix(vec3<f32>(1.0,0.94,0.80),scene.palette0.rgb*0.60+vec3<f32>(0.40),0.30)*lenticularGlint*0.52,vec3<f32>(0.0),vec3<f32>(1.0));
  // Thin cylindrical vascular SSS: at anatomically thin areas such as the neck and wrist/ankle, the higher vasculature density and reduced tissue thickness creates a strong warm-red SSS color that bleeds through — Mewtwo's neck and wrists are notably warm-pink in all renders; Gardevoir's neck glows warm when backlit; modeled as SSS warmth in regions at narrow lateral extent (outside the wide torso box) at neck and wrist heights
  let vascularSSSGate=organicSkin*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*smoothstep(0.04,0.20,toon)*(1.0-smoothstep(0.34,0.52,toon));
  let vascularNeckZone=smoothstep(crownEyeY-crownEyeW*0.52,crownEyeY-crownEyeW*0.22,input.worldPosition.y)*(1.0-smoothstep(crownEyeY-crownEyeW*0.22,crownEyeY+crownEyeW*0.08,input.worldPosition.y));
  let vascularWristZone=smoothstep(wristY+crownEyeW*0.16,wristY+crownEyeW*0.04,input.worldPosition.y)*(1.0-smoothstep(wristY+crownEyeW*0.04,wristY-crownEyeW*0.12,input.worldPosition.y));
  let vascularThinZone=(vascularNeckZone+vascularWristZone)*smoothstep(crownEyeW*0.62,crownEyeW*0.32,abs(input.worldPosition.x));
  let vascularSSS=max(0.0,-dot(normal,lightDir))*vascularThinZone*vascularSSSGate;
  lit=clamp(lit+vec3<f32>(0.72,0.22,0.14)*vascularSSS*0.20,vec3<f32>(0.0),vec3<f32>(1.0));
  // Atmospheric depth desaturation: surfaces at grazing view angles and back-facing normals receive a very subtle blue-gray atmospheric haze that simulates atmospheric perspective within the creature's volume — prevents the rear surfaces from competing with front surfaces for visual attention; gives the impression of volumetric depth; present in all professional 3D creature renders where background color bleeds into edge geometry; modeled as a cool desaturating haze on surfaces with low NdotV
  let atmDepthHazeLuma=dot(lit,vec3<f32>(0.299,0.587,0.114));
  let atmDepthHazeGate=pow(clamp(1.0-dot(view,normal),0.0,1.0),2.0)*smoothstep(0.22,0.54,toon)*(1.0-metallic)*0.14;
  lit=clamp(mix(lit,vec3<f32>(atmDepthHazeLuma)*0.88+vec3<f32>(0.04,0.05,0.09),atmDepthHazeGate),vec3<f32>(0.0),vec3<f32>(1.0));
  // Shadow terminator warm-cool color temperature gradient: across the cel-shading terminator the lit penumbra carries a slight warm bias (+R) and the shadow penumbra carries a slight cool bias (+B) — this warm-then-cool gradient across the light/shadow boundary is the defining quality of hand-painted anime shadows (Pokemon art, Digimon color guide, Genshin Impact skin) that makes shadow feel "colored" rather than just darkened; the lit penumbra gathers warm reflected light from nearby lit surfaces, the shadow penumbra scatters cooler skylight from above; modeled as two toon-band color multipliers
  let termColorWarm=smoothstep(0.38,0.52,toon)*(1.0-smoothstep(0.52,0.68,toon))*(1.0-metallic)*0.060;
  let termColorCool=smoothstep(0.10,0.22,toon)*(1.0-smoothstep(0.22,0.36,toon))*(1.0-metallic)*0.040;
  lit=clamp(lit+vec3<f32>(termColorWarm*warmDom*0.40,-termColorWarm*0.04,-termColorCool*0.36)+vec3<f32>(-termColorCool*0.10,-termColorCool*0.04,termColorCool*0.50),vec3<f32>(0.0),vec3<f32>(1.0));
  // Forward-lower warm broad fill: a very soft wide-lobe specular from a forward-downward direction approximating upward bounce from the creature's own lit ground-facing and belly surfaces — catches the shadow-side anterior surfaces with a subtle warm uplift that prevents frontal faces from being cold in shadow; standard in all professional three-point rig renders (Game Freak creature shaders, DigiBro rigs); distinct from the left-rear fill specular which is the standard fill; this "kicker-from-below" completes the light wrapping
  let forwardLiftDir=normalize(vec3<f32>(0.0,-0.58,0.72));
  let forwardLiftH=normalize(forwardLiftDir+view);
  let forwardLiftSpec=pow(max(dot(normal,forwardLiftH),0.0),5.0)*smoothstep(0.0,0.24,toon)*(1.0-smoothstep(0.40,0.64,toon))*(1.0-metallic)*organicSkin;
  lit=clamp(lit+mix(vec3<f32>(0.62,0.38,0.22),scene.palette1.rgb*0.50+vec3<f32>(0.50),0.40)*forwardLiftSpec*0.10,vec3<f32>(0.0),vec3<f32>(1.0));
  // Aquatic wet micro-gloss stipple: water/ice-dominant creatures have a fine noise-perturbed specular from micro-droplets and surface tension facets — Vaporeon's wet skin, Suicune's wave-smoothed surface, Milotic's scales, Greninja's moist skin all show a fine "stippled gloss" effect where the specular is not one smooth lobe but a cluster of tiny intense glints; modeled as a high-frequency noise perturbation on the surface normal for the specular evaluation
  let wetStippleGate=(blueSheen+iceBlueGate)*toon*(1.0-metallic)*clamp(fv*2.0,0.0,1.0)*0.22;
  let wetNoiseHash=fract(sin(dot(floor(input.worldPosition.xyz*24.0),vec3<f32>(127.1,311.7,74.4)))*43758.5);
  let wetNoiseH=normalize(halfVec+vec3<f32>((wetNoiseHash-0.5)*0.12,(wetNoiseHash*0.73-0.36)*0.10,0.0));
  let wetStippleSpec=step(0.88,wetNoiseHash)*pow(max(dot(normal,wetNoiseH),0.0),18.0)*wetStippleGate;
  lit=clamp(lit+vec3<f32>(0.78,0.92,1.0)*wetStippleSpec*0.28,vec3<f32>(0.0),vec3<f32>(1.0));
  // Specular chromatic dispersion fringe: at the penumbra edge of bright specular highlights, chromatic aberration in the lens creates a narrow red fringe on one side and blue on the other — present in all physically-based renders (Genshin Impact, Pokemon S/V, Digimon Survive close-ups) and gives speculars their "real optical system" quality; modeled as two slightly offset halfvec specular evaluations producing a red-shifted and blue-shifted specular lobe flanking the main highlight
  let specChromaticGate=toon*(1.0-metallic)*clamp(palBright-0.22,0.0,1.0)*0.06;
  let dispAxisOffset=vec3<f32>(0.0,0.028,0.0);
  let halfVecDisp0=normalize(halfVec+dispAxisOffset);
  let halfVecDisp1=normalize(halfVec-dispAxisOffset);
  let specDispR=pow(max(dot(normal,halfVecDisp0),0.0),mix(80.0,8.0,roughness));
  let specDispB=pow(max(dot(normal,halfVecDisp1),0.0),mix(80.0,8.0,roughness));
  lit=clamp(lit+vec3<f32>(specDispR,0.0,specDispB)*specChromaticGate,vec3<f32>(0.0),vec3<f32>(1.0));
  // Grazing-angle coronal SSS layer: when the view angle is nearly parallel to the surface (grazing), subsurface scattering reveals the deep vascular tissue layer — warm amber-red glow visible at steep viewing angles through the outermost layers; this "coronal SSS" is the warm orange edge glow at silhouettes distinct from rim light; Mewtwo's arms and neck, Gardevoir's neck and wrists, Dragonite's belly seam all show this warm vascular corona at extreme view angles in official renders
  let grazingSSS=pow(clamp(1.0-dot(view,normal),0.0,1.0),3.5)*organicSkin*(1.0-metallic)*smoothstep(0.06,0.22,toon)*(1.0-smoothstep(0.34,0.54,toon));
  let grazingSSSColor=mix(vec3<f32>(0.68,0.18,0.08),scene.palette1.rgb*0.60+vec3<f32>(0.40),clamp(1.0-warmDom*1.8,0.0,1.0));
  lit=clamp(lit+grazingSSSColor*grazingSSS*0.14,vec3<f32>(0.0),vec3<f32>(1.0));
  // Element-hued ambient in deep shadow: the darkest shadow zones are never pure neutral gray/black — scattered ambient from the creature's own element-colored surface illuminates its own shadow interior; Fire creatures have warm amber ambient in shadow, Water creatures have cool blue, Shadow creatures have violet; gives shadow depth a colored quality instead of dead gray; modeled as a very small element-palette ambient lift in toon < 0.12 zone
  let shadowElemAmbGate=smoothstep(0.12,0.02,toon)*(1.0-metallic);
  let shadowElemAmb=scene.palette2.rgb*0.30+scene.palette1.rgb*0.12;
  lit=clamp(lit+shadowElemAmb*shadowElemAmbGate*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  // S-curve contrast: Hermite smoothstep punches highlights and deepens shadows for Pokemon-vivid pop
  // Element-specific contrast: Shadow/dark gets deeper drama (+0.12); Light/Air gets softer ethereal (−0.06)
  let gammaOut=pow(litSat,vec3<f32>(1.0/2.2));
  let contrast=gammaOut*gammaOut*(3.0-2.0*gammaOut);
  let contrastStr=clamp(0.25+shadowGlow*0.12-lightSheen*0.06+fireGlow*0.07-iceBlueGate*0.05,0.0,0.40);
  let finalOut=mix(gammaOut,contrast,contrastStr);
  // Highlight chroma preservation: blend toward element hue in bright regions rather than washing to pure white — Pokemon renders stay vivid even at peak brightness
  let finalLuma=dot(finalOut,vec3<f32>(0.299,0.587,0.114));
  let chromaHold=smoothstep(0.80,0.96,finalLuma)*clamp((palBright-0.32)/0.38,0.0,1.0)*0.20;
  let finalChroma=clamp(mix(finalOut,mix(vec3<f32>(finalLuma),finalOut,1.22),chromaHold),vec3<f32>(0.0),vec3<f32>(1.0));
  // Warm highlight / cool shadow color grade: professional photography and film color grade applied to every frame — highlights shift slightly warm (+R, -B), shadows shift slightly cool (+B, -R); this is the grade in Genshin Impact, Pokemon key art renders, and most commercial anime games; makes the image look professionally color-corrected rather than flat
  let gradeHL=smoothstep(0.72,0.94,finalLuma)*0.030;
  let gradeSH=smoothstep(0.28,0.06,finalLuma)*0.025;
  let finalGraded=clamp(finalChroma+vec3<f32>(gradeHL,0.0,-gradeHL)+vec3<f32>(-gradeSH,0.0,gradeSH),vec3<f32>(0.0),vec3<f32>(1.0));
  // Subtle film grain / dither: adds barely-perceptible spatial micro-noise at about 0.4% amplitude to break up uniform banding in smooth gradient regions and give the render an organic, hand-crafted quality — sprite-render games like Pokemon S/S use a subtle dither in their output pipeline that removes the "too clean CG" feeling; values derived from fragment screen-space hash
  // Local bloom simulation: bright regions (above threshold) bleed a very faint glow into their neighbors — implemented as a wide smoothstep "soft glow" above the bloom threshold applied to the same pixel (screen-accurate bloom requires multipass, this is a single-pass approximation that captures the essence); makes bright element highlights bloom like in Pokemon S/S and Genshin Impact; threshold 0.88, radius is the falloff of the smoothstep
  let bloomLuma=dot(finalGraded,vec3<f32>(0.299,0.587,0.114));
  let bloomGate=smoothstep(0.84,0.98,bloomLuma)*clamp((palBright-0.38)/0.32,0.0,1.0);
  let bloomColor=mix(finalGraded,clamp(finalGraded*1.06+scene.palette2.rgb*0.04,vec3<f32>(0.0),vec3<f32>(1.0)),bloomGate*0.32);
  // Element-hued specular bloom haze: the brightest specular region has a soft broad halo of element color extending beyond the core — Charizard specular has an orange glow halo, Pikachu yellow glow, Vaporeon cyan glow; widened specular lobe tinted with element palette; applied on top of final bloom
  let elemBloomSpec=pow(max(dot(normal,halfVec),0.0),8.0)*(1.0-metallic)*clamp((palBright-0.40)/0.36,0.0,1.0)*smoothstep(0.44,0.72,toon);
  let bloomWithElem=clamp(bloomColor+scene.palette2.rgb*elemBloomSpec*0.06,vec3<f32>(0.0),vec3<f32>(1.0));
  let finalBloom=bloomWithElem;
  let grainCell=vec3<f32>(input.worldPosition.x*scale*40.0,input.worldPosition.y*scale*40.0,input.worldPosition.z*scale*40.0)+vec3<f32>(fv*17.0);
  let grainH=fract(sin(dot(floor(grainCell),vec3<f32>(127.1,311.7,74.7)))*43758.545)*2.0-1.0;
  let grainStrength=0.004;
  return vec4<f32>(clamp(finalBloom+vec3<f32>(grainH*grainStrength),vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}`;
