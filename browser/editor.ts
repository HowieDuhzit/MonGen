import templateJson from "../examples/emberling.dna.json";
import { assertCreatureDNA, ELEMENT_TYPES, mutateDNA, randomizeDNA, SKELETON_TYPES, SURFACE_PATTERNS, type CreatureDNA } from "../src/dna";
import { generateCreatureMesh } from "../src/gpu/mesh-generator";
import { CreatureOrbitRenderer } from "../src/gpu/orbit-renderer";
import { renderCreaturePreview } from "../src/gpu/preview-renderer";

interface EditorState { ready:boolean; generations:number; frames:number; vertices:number; triangles:number; lastError:string|null; azimuth:number; elevation:number }
declare global { interface Window { monGenEditor?:EditorState } }

assertCreatureDNA(templateJson);
let dna:CreatureDNA=structuredClone(templateJson),device:GPUDevice|null=null,renderer:CreatureOrbitRenderer|null=null,currentMesh:Awaited<ReturnType<typeof generateCreatureMesh>>|null=null,currentPreviewDNA:CreatureDNA|null=null;
let azimuth=35,elevation=12,generationToken=0,debounce:number|undefined;
let animClip="Idle",animSpeed=1,animPlaying=false,animStart=0,animRaf=0;
const CLIP_DURATIONS:Record<string,number>={Idle:2400,Walk:1000,Run:650,Attack:900,Special:1300,Hurt:600,Faint:1800};
const captureMode=new URLSearchParams(location.search).get("capture")==="1";
const recovered=sessionStorage.getItem("mongen-fallback-dna"); if(recovered){sessionStorage.removeItem("mongen-fallback-dna");try{const value:unknown=JSON.parse(recovered);assertCreatureDNA(value);dna=value;}catch{/* Ignore corrupt compatibility state. */}}
const state:EditorState={ready:false,generations:0,frames:0,vertices:0,triangles:0,lastError:null,azimuth,elevation}; window.monGenEditor=state;
const byId=<T extends HTMLElement>(id:string)=>document.querySelector<T>(`#${id}`)!;
const canvas=byId<HTMLCanvasElement>("preview"),status=byId<HTMLElement>("status"),metrics=byId<HTMLElement>("metrics"),json=byId<HTMLTextAreaElement>("json");
const number=(id:string)=>Number(byId<HTMLInputElement>(id).value);
const setStatus=(message:string,kind:"normal"|"busy"|"error"="normal")=>{status.textContent=message;status.className=kind==="normal"?"":kind;};

function fillSelect(id:string,values:readonly string[]):void { const select=byId<HTMLSelectElement>(id); for(const value of values) select.add(new Option(value,value)); }
fillSelect("skeleton",SKELETON_TYPES); fillSelect("element",ELEMENT_TYPES); fillSelect("pattern",SURFACE_PATTERNS);

function setValue(id:string,value:string|number):void { byId<HTMLInputElement|HTMLSelectElement>(id).value=String(value); }
function syncOutputs():void { document.querySelectorAll<HTMLInputElement>("input[type=range]").forEach(input=>{const output=input.parentElement?.querySelector("output");if(output)output.value=Number(input.value).toFixed(input.step==="1"?0:2);}); }
function syncControls():void {
  setValue("name",dna.name); setValue("seed",dna.seed); setValue("skeleton",dna.skeleton); setValue("element",dna.element);
  ["bodyX","bodyY","bodyZ"].forEach((id,index)=>setValue(id,dna.morphology.bodyScale[index]));
  ["headX","headY","headZ"].forEach((id,index)=>setValue(id,dna.morphology.headScale[index]));
  setValue("limbLength",dna.morphology.limbLength); setValue("limbThickness",dna.morphology.limbThickness); setValue("tailLength",dna.morphology.tailLength); setValue("smoothness",dna.morphology.sdfSmoothness);
  byId<HTMLInputElement>("symmetry").checked=dna.morphology.bilateralSymmetry; setValue("resolution",dna.morphology.volumeResolution);
  setValue("pattern",dna.surface.pattern); setValue("paletteVariant",dna.surface.paletteVariant); setValue("patternScale",dna.surface.patternScale); setValue("roughness",dna.surface.roughness); setValue("metallic",dna.surface.metallic);
  json.value=JSON.stringify(dna,null,2); syncOutputs();
}

function readControls():CreatureDNA {
  const next:CreatureDNA={...dna,name:byId<HTMLInputElement>("name").value.trim(),seed:number("seed")>>>0,skeleton:byId<HTMLSelectElement>("skeleton").value as CreatureDNA["skeleton"],element:byId<HTMLSelectElement>("element").value as CreatureDNA["element"],
    morphology:{...dna.morphology,bodyScale:[number("bodyX"),number("bodyY"),number("bodyZ")],headScale:[number("headX"),number("headY"),number("headZ")],limbLength:number("limbLength"),limbThickness:number("limbThickness"),tailLength:number("tailLength"),sdfSmoothness:number("smoothness"),bilateralSymmetry:byId<HTMLInputElement>("symmetry").checked,volumeResolution:number("resolution") as CreatureDNA["morphology"]["volumeResolution"]},
    surface:{paletteVariant:number("paletteVariant"),pattern:byId<HTMLSelectElement>("pattern").value as CreatureDNA["surface"]["pattern"],patternScale:number("patternScale"),roughness:number("roughness"),metallic:number("metallic")}};
  assertCreatureDNA(next); return next;
}

async function gpu():Promise<GPUDevice> {
  if(device)return device; if(!navigator.gpu)throw new Error("WebGPU is unavailable in this browser");
  const adapter=await navigator.gpu.requestAdapter(); if(!adapter)throw new Error("No WebGPU adapter is available");
  device=await adapter.requestDevice(); device.addEventListener("uncapturederror",event=>setStatus(event.error.message,"error"));
  void device.lost.then(info=>{if(info.reason!=="destroyed"){state.ready=false;state.lastError=info.message||info.reason;setStatus(`GPU lost: ${state.lastError}`,"error");device=null;renderer=null;}});
  return device;
}

async function generate():Promise<void> {
  const token=++generationToken; let next:CreatureDNA;
  try { next=readControls(); } catch(error){state.lastError=error instanceof Error?error.message:String(error);setStatus(state.lastError,"error");return;}
  dna=next; json.value=JSON.stringify(dna,null,2); setStatus("Building SDF volume…","busy"); const started=performance.now();
  try {
    const activeDevice=await gpu(),previewResolution=number("previewResolution") as CreatureDNA["morphology"]["volumeResolution"];
    const previewDNA={...dna,morphology:{...dna.morphology,volumeResolution:previewResolution}};
    const mesh=await generateCreatureMesh(activeDevice,previewDNA,{vertexCapacity:2_000_000}); if(token!==generationToken)return;
    cancelAnimationFrame(animRaf); animPlaying=false; byId<HTMLButtonElement>("animToggle").textContent="▶ Play";
    renderer?.destroy(); renderer=null; currentMesh=mesh; currentPreviewDNA=previewDNA;
    if(captureMode) await renderCreaturePreview(activeDevice,canvas,mesh,previewDNA,{width:640,height:640,azimuthDegrees:azimuth,captureReadback:true});
    else { renderer=await CreatureOrbitRenderer.create(activeDevice,canvas,mesh,previewDNA); renderer.initAnimation(previewDNA.skeleton); await renderer.render(azimuth,elevation); }
    state.frames++;
    state.ready=true;state.generations++;state.vertices=mesh.vertices.length/8;state.triangles=mesh.indices.length/3;state.lastError=null;
    metrics.textContent=`${state.vertices.toLocaleString()} vertices · ${state.triangles.toLocaleString()} triangles · ${previewResolution}³ · ${(performance.now()-started).toFixed(0)} ms`;
    setStatus(`${dna.name} · ${dna.element} ${dna.skeleton}`);
  } catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(!captureMode&&message.includes("external Instance")){sessionStorage.setItem("mongen-fallback-dna",JSON.stringify(dna));const url=new URL(location.href);url.searchParams.set("capture","1");location.replace(url);return;}
    state.ready=false;state.lastError=message;setStatus(state.lastError,"error");console.error(error);
  }
}

function queueGenerate():void { clearTimeout(debounce); debounce=window.setTimeout(()=>void generate(),350); syncOutputs(); }
byId("generate").addEventListener("click",()=>void generate());
byId("mutate").addEventListener("click",()=>{try{dna=mutateDNA(readControls());syncControls();void generate();}catch(error){setStatus(String(error),"error");}});
byId("randomize").addEventListener("click",()=>{const seed=crypto.getRandomValues(new Uint32Array(1))[0];dna=randomizeDNA(dna,seed);syncControls();void generate();});
byId("import").addEventListener("click",()=>{try{const value:unknown=JSON.parse(json.value);assertCreatureDNA(value);dna=value;syncControls();void generate();}catch(error){state.lastError=error instanceof Error?error.message:String(error);setStatus(state.lastError,"error");}});
byId("copy").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(JSON.stringify(readControls(),null,2));setStatus("DNA copied to clipboard");}catch(error){setStatus(`Copy failed: ${String(error)}`,"error");}});
byId("download").addEventListener("click",()=>{try{const value=readControls(),blob=new Blob([JSON.stringify(value,null,2)+"\n"],{type:"application/json"}),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`${value.name.toLowerCase().replace(/[^a-z0-9]+/g,"-")||"creature"}.dna.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);}catch(error){setStatus(String(error),"error");}});
document.querySelectorAll<HTMLInputElement|HTMLSelectElement>(".controls input,.controls select").forEach(control=>control.addEventListener(control.type==="range"?"input":"change",queueGenerate));

let dragging=false,lastX=0,lastY=0,frame=0;
const orbit=async()=>{frame=0;try{if(renderer)await renderer.render(azimuth,elevation);else if(captureMode&&device&&currentMesh&&currentPreviewDNA)await renderCreaturePreview(device,canvas,currentMesh,currentPreviewDNA,{width:640,height:640,azimuthDegrees:azimuth,captureReadback:true});state.frames++;}catch(error){state.lastError=error instanceof Error?error.message:String(error);setStatus(state.lastError,"error");}};
canvas.addEventListener("pointerdown",event=>{dragging=true;lastX=event.clientX;lastY=event.clientY;canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener("pointermove",event=>{if(!dragging)return;azimuth+=(event.clientX-lastX)*.45;elevation=Math.max(-65,Math.min(65,elevation-(event.clientY-lastY)*.35));state.azimuth=azimuth;state.elevation=elevation;lastX=event.clientX;lastY=event.clientY;if(!captureMode&&!frame)frame=requestAnimationFrame(orbit);});
canvas.addEventListener("pointerup",()=>{dragging=false;if(captureMode&&!frame)frame=requestAnimationFrame(orbit);}); canvas.addEventListener("pointercancel",()=>{dragging=false;});
const resize=new ResizeObserver(()=>{if(!frame)frame=requestAnimationFrame(orbit);}); resize.observe(canvas);
window.addEventListener("beforeunload",()=>{clearTimeout(debounce);cancelAnimationFrame(frame);cancelAnimationFrame(animRaf);resize.disconnect();renderer?.destroy();device?.destroy();});

function animLoop(now:number):void {
  if(!renderer||!animPlaying)return;
  const dur=CLIP_DURATIONS[animClip]??1000,phase=((now-animStart)*animSpeed/dur)%1;
  void renderer.animate(animClip,phase,azimuth,elevation).then(()=>{if(animPlaying)animRaf=requestAnimationFrame(animLoop);});
}
byId("animToggle").addEventListener("click",()=>{
  animPlaying=!animPlaying;
  byId<HTMLButtonElement>("animToggle").textContent=animPlaying?"⏸ Pause":"▶ Play";
  if(animPlaying){animStart=performance.now()-0;animRaf=requestAnimationFrame(animLoop);}
  else cancelAnimationFrame(animRaf);
});
byId("animClip").addEventListener("change",()=>{animClip=byId<HTMLSelectElement>("animClip").value;animStart=performance.now();});
byId("animSpeed").addEventListener("input",()=>{animSpeed=Number(byId<HTMLInputElement>("animSpeed").value);syncOutputs();});

syncControls(); void generate();
