import type { CreatureDNA } from "../dna";
import type { GeneratedMesh } from "./mesh-generator";
import { createMaterialTexture, packMaterialUniforms } from "./material";
import { TRIPLANAR_MATERIAL_WGSL } from "./shaders/triplanar-material.wgsl";

export interface PreviewOptions { readonly width?: number; readonly height?: number; readonly azimuthDegrees?: number; readonly captureReadback?: boolean; }
type V3=[number,number,number];
const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v:V3):V3=>{const n=Math.hypot(...v)||1; return [v[0]/n,v[1]/n,v[2]/n];};
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function multiply(a:Float32Array,b:Float32Array):Float32Array { const o=new Float32Array(16); for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k]; return o; }
function lookAt(eye:V3,target:V3):Float32Array { const z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x); return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]); }
function perspective(aspect:number,near:number,far:number):Float32Array { const f=1/Math.tan(Math.PI/8),nf=1/(near-far); return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,far*nf,-1,0,0,far*near*nf,0]); }
function upload(device:GPUDevice,label:string,data:ArrayBufferView,usage:GPUBufferUsageFlags):GPUBuffer { const buffer=device.createBuffer({label,size:(data.byteLength+3)&~3,usage,mappedAtCreation:true}); new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)); buffer.unmap(); return buffer; }

export async function renderCreaturePreview(device:GPUDevice,canvas:HTMLCanvasElement,mesh:GeneratedMesh,dna:CreatureDNA,options:PreviewOptions={}):Promise<void> {
  let stage="initialization";
  try {
  const width=options.width??512,height=options.height??512; canvas.width=width; canvas.height=height;
  const capture=options.captureReadback??false;
  stage="canvas context";
  const context=capture?null:canvas.getContext("webgpu");
  if(!capture&&!context) throw new Error("WebGPU canvas context is unavailable");
  stage="canvas configuration";
  const format:GPUTextureFormat=capture?"rgba8unorm":navigator.gpu.getPreferredCanvasFormat();
  context?.configure({device,format,alphaMode:"opaque"});
  const mins:V3=[Infinity,Infinity,Infinity],maxs:V3=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<mesh.vertices.length;i+=8) for(let axis=0;axis<3;axis++){mins[axis]=Math.min(mins[axis],mesh.vertices[i+axis]);maxs[axis]=Math.max(maxs[axis],mesh.vertices[i+axis]);}
  const center:V3=[(mins[0]+maxs[0])/2,(mins[1]+maxs[1])/2,(mins[2]+maxs[2])/2];
  const radius=Math.max(Math.hypot(maxs[0]-mins[0],maxs[1]-mins[1],maxs[2]-mins[2])/2,0.1);
  const azimuth=(options.azimuthDegrees??35)*Math.PI/180;
  const eye:V3=[center[0]-Math.sin(azimuth)*radius*2.7,center[1]+radius*0.55,center[2]-Math.cos(azimuth)*radius*2.7];
  const viewProjection=multiply(perspective(width/height,radius*0.01,radius*10),lookAt(eye,center));
  const uniformData=packMaterialUniforms(viewProjection,identity(),dna,norm([0.45,0.8,0.35]),eye);
  stage="resource allocation";
  const vertexBuffer=upload(device,"preview vertices",mesh.vertices,GPUBufferUsage.VERTEX);
  const indexBuffer=upload(device,"preview indices",mesh.indices,GPUBufferUsage.INDEX);
  const uniformBuffer=upload(device,"preview material uniforms",new Uint8Array(uniformData),GPUBufferUsage.UNIFORM);
  const textureSize=64,texture=device.createTexture({label:"seeded material texture",size:[textureSize,textureSize],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture},createMaterialTexture(dna,textureSize),{bytesPerRow:textureSize*4},{width:textureSize,height:textureSize});
  const sampler=device.createSampler({addressModeU:"repeat",addressModeV:"repeat",magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest"});
  const depth=device.createTexture({label:"preview depth",size:[width,height],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const color=capture?device.createTexture({label:"preview capture color",size:[width,height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}):null;
  const bytesPerRow=Math.ceil(width*4/256)*256;
  const readback=capture?device.createBuffer({label:"preview capture readback",size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}):null;
  try {
    stage="shader compilation";
    const module=device.createShaderModule({label:"tri-planar material shader",code:TRIPLANAR_MATERIAL_WGSL});
    const compilation=await module.getCompilationInfo(); const errors=compilation.messages.filter(m=>m.type==="error");
    if(errors.length) throw new Error(`tri-planar shader failed to compile:\n${errors.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
    stage="render pipeline creation";
    const pipeline=await device.createRenderPipelineAsync({label:"creature preview pipeline",layout:"auto",vertex:{module,entryPoint:"vertexMain",buffers:[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:"float32x4"},{shaderLocation:1,offset:16,format:"float32x4"}]}]},fragment:{module,entryPoint:"fragmentMain",targets:[{format}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:true,depthCompare:"less"}});
    stage="bind group creation";
    const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniformBuffer}},{binding:1,resource:texture.createView()},{binding:2,resource:sampler}]});
    stage="render encoding";
    const encoder=device.createCommandEncoder({label:"creature preview render"});
    const colorView=color?.createView()??context!.getCurrentTexture().createView();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:colorView,clearValue:{r:0.008,g:0.009,b:0.015,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});
    pass.setPipeline(pipeline); pass.setBindGroup(0,bindings); pass.setVertexBuffer(0,vertexBuffer); pass.setIndexBuffer(indexBuffer,"uint32"); pass.drawIndexed(mesh.indices.length); pass.end();
    if(color&&readback) encoder.copyTextureToBuffer({texture:color},{buffer:readback,bytesPerRow,rowsPerImage:height},{width,height});
    stage="render submission";
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    if(readback) {
      stage="render readback"; await readback.mapAsync(GPUMapMode.READ);
      const mapped=new Uint8Array(readback.getMappedRange()),pixels=new Uint8ClampedArray(width*height*4);
      for(let y=0;y<height;y++) pixels.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
      const twoD=canvas.getContext("2d"); if(!twoD) throw new Error("2D capture canvas context is unavailable");
      twoD.putImageData(new ImageData(pixels,width,height),0,0); readback.unmap();
    }
  } finally { vertexBuffer.destroy(); indexBuffer.destroy(); uniformBuffer.destroy(); texture.destroy(); depth.destroy(); color?.destroy(); readback?.destroy(); }
  } catch (error) {
    throw new Error(`preview ${stage} failed: ${error instanceof Error?error.message:String(error)}`,{cause:error});
  }
}
