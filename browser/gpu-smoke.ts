import { assertCreatureDNA, type CreatureDNA } from "../src/dna";
import { generateCreatureMesh } from "../src/gpu/mesh-generator";
import { renderCreaturePreview } from "../src/gpu/preview-renderer";
import { compilePhenotype, type FaceLandmarks } from "../src/gpu/morphology";
import { encodeObj } from "../src/mesh/obj";

type MonGenInput = { dna: unknown; resolutionOverride?: number; vertexCapacity?: number; preview?: boolean; previewWidth?: number; previewHeight?: number; azimuthDegrees?: number };
type PreviewStats={foregroundPixels:number;meanRgb:number};
type PhenotypeStats={primitiveCount:number;attachmentPrimitiveCount:number;silhouetteClass:string;face:FaceLandmarks;diversity:ReturnType<typeof compilePhenotype>["diversity"]};
type MonGenResult = { ok: boolean; message: string; obj?: string; vertices?: number; triangles?: number; adapter?: Record<string, unknown>; preview?: boolean; previewStats?: PreviewStats; phenotype?:PhenotypeStats };
declare global { interface Window { monGenInput?: MonGenInput; monGenResult?: MonGenResult } }

async function run(): Promise<void> {
  if (!navigator.gpu) throw new Error("WebGPU is unavailable");
  const input=window.monGenInput;
  if (!input) throw new Error("window.monGenInput was not injected");
  assertCreatureDNA(input.dna);
  const validated=input.dna as CreatureDNA;
  const supportedResolutions=[32,64,96,128,192,256] as const;
  if(input.resolutionOverride!==undefined&&!supportedResolutions.includes(input.resolutionOverride as typeof supportedResolutions[number])) throw new Error(`unsupported volume resolution: ${input.resolutionOverride}`);
  const dna: CreatureDNA=input.resolutionOverride===undefined?validated:{...validated,morphology:{...validated.morphology,volumeResolution:input.resolutionOverride as CreatureDNA["morphology"]["volumeResolution"]}};
  const adapter=await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no WebGPU adapter");
  const device=await adapter.requestDevice();
  device.addEventListener("uncapturederror",event=>console.error("WebGPU uncaptured error",event.error));
  try {
    const mesh=await generateCreatureMesh(device,dna,{vertexCapacity:input.vertexCapacity??2_000_000});
    if (!mesh.indices.length) throw new Error("GPU generated an empty mesh");
    let previewStats:PreviewStats|undefined;
    if (input.preview) {
      const canvas=document.querySelector<HTMLCanvasElement>("#preview");
      if (!canvas) throw new Error("preview canvas is missing");
      await renderCreaturePreview(device,canvas,mesh,dna,{width:input.previewWidth,height:input.previewHeight,azimuthDegrees:input.azimuthDegrees,captureReadback:true});
      const pixels=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
      const background=[pixels[0],pixels[1],pixels[2]],count=canvas.width*canvas.height;
      let foregroundPixels=0,sum=0;
      for(let i=0;i<pixels.length;i+=4){sum+=pixels[i]+pixels[i+1]+pixels[i+2]; if(Math.abs(pixels[i]-background[0])+Math.abs(pixels[i+1]-background[1])+Math.abs(pixels[i+2]-background[2])>24) foregroundPixels++;}
      previewStats={foregroundPixels,meanRgb:sum/(count*3*255)};
      if(foregroundPixels<count*0.005) throw new Error(`preview is effectively empty (${foregroundPixels} foreground pixels)`);
    }
    const info=(adapter as GPUAdapter & {info?: Record<string, unknown>}).info??{};
    const phenotype=compilePhenotype(dna);
    window.monGenResult={ok:true,message:"generated",obj:encodeObj(mesh,dna.name),vertices:mesh.vertices.length/8,triangles:mesh.indices.length/3,adapter:info,preview:input.preview,previewStats,phenotype:{primitiveCount:phenotype.primitives.length,attachmentPrimitiveCount:phenotype.attachmentPrimitiveCount,silhouetteClass:phenotype.silhouetteClass,face:phenotype.face,diversity:phenotype.diversity}};
  } finally {
    // Chromium's SwiftShader backend rejects destroying a device while a live
    // canvas context still references it. Preview pages own the device until
    // Playwright closes the page; non-presenting mesh jobs destroy it here.
    if (!input.preview) device.destroy();
  }
}

run().catch(error=>{ window.monGenResult={ok:false,message:error instanceof Error?error.stack??error.message:String(error)}; })
  .finally(()=>{
    const status=document.querySelector<HTMLElement>("#status")!;
    status.textContent=window.monGenResult!.message;
    if (window.monGenResult?.ok&&window.monGenResult.preview) status.hidden=true;
  });
