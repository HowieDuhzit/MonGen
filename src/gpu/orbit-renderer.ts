import type { CreatureDNA } from "../dna";
import type { GeneratedMesh } from "./mesh-generator";
import { createMaterialTexture, packMaterialUniforms } from "./material";
import { TRIPLANAR_MATERIAL_WGSL } from "./shaders/triplanar-material.wgsl";
import { skeletonSpecs, computePose, skinningMatrices } from "./skeleton";
import type { BoneSpec } from "./skeleton";
import { computeWeights, skinVertices } from "./skinning";
import type { SkinWeights } from "./skinning";

type V3=[number,number,number];
const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v:V3):V3=>{const n=Math.hypot(...v)||1; return [v[0]/n,v[1]/n,v[2]/n];};
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function multiply(a:Float32Array,b:Float32Array):Float32Array { const o=new Float32Array(16); for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k]; return o; }
function lookAt(eye:V3,target:V3):Float32Array { const z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x); return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]); }
function perspective(aspect:number,near:number,far:number):Float32Array { const f=1/Math.tan(Math.PI/8),nf=1/(near-far); return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,far*nf,-1,0,0,far*near*nf,0]); }
function upload(device:GPUDevice,label:string,data:ArrayBufferView,usage:GPUBufferUsageFlags):GPUBuffer { const buffer=device.createBuffer({label,size:(data.byteLength+3)&~3,usage,mappedAtCreation:true}); new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)); buffer.unmap(); return buffer; }

/** Persistent direct-canvas renderer: camera orbit updates one uniform; animation re-skins vertices each frame. */
export class CreatureOrbitRenderer {
  private depth: GPUTexture|null = null;
  private width = 0; private height = 0; private destroyed = false;
  private _bones: BoneSpec[]|null = null;
  private _skinData: SkinWeights|null = null;
  private _skeleton = "";
  private _deformBuf: Float32Array|null = null;

  private constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
    private readonly context: GPUCanvasContext,
    private readonly dna: CreatureDNA,
    private readonly center: V3,
    private readonly radius: number,
    private readonly vertex: GPUBuffer,
    private readonly index: GPUBuffer,
    private readonly indexCount: number,
    private readonly uniforms: GPUBuffer,
    private readonly texture: GPUTexture,
    private readonly pipeline: GPURenderPipeline,
    private readonly bindings: GPUBindGroup,
    private readonly baseVertices: Float32Array,
  ) {}

  public static async create(device:GPUDevice,canvas:HTMLCanvasElement,mesh:GeneratedMesh,dna:CreatureDNA):Promise<CreatureOrbitRenderer> {
    const context=canvas.getContext("webgpu"); if(!context) throw new Error("WebGPU canvas context is unavailable");
    const format=navigator.gpu.getPreferredCanvasFormat(); context.configure({device,format,alphaMode:"opaque"});
    const mins:V3=[Infinity,Infinity,Infinity],maxs:V3=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<mesh.vertices.length;i+=8) for(let axis=0;axis<3;axis++){mins[axis]=Math.min(mins[axis],mesh.vertices[i+axis]);maxs[axis]=Math.max(maxs[axis],mesh.vertices[i+axis]);}
    const center:V3=[(mins[0]+maxs[0])/2,(mins[1]+maxs[1])/2,(mins[2]+maxs[2])/2],radius=Math.max(Math.hypot(maxs[0]-mins[0],maxs[1]-mins[1],maxs[2]-mins[2])/2,.1);
    const vertex=upload(device,"editor preview vertices",mesh.vertices,GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST),index=upload(device,"editor preview indices",mesh.indices,GPUBufferUsage.INDEX);
    const uniforms=device.createBuffer({label:"editor material uniforms",size:304,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const texture=device.createTexture({label:"editor seeded texture",size:[64,64],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    device.queue.writeTexture({texture},createMaterialTexture(dna),{bytesPerRow:256},{width:64,height:64});
    const module=device.createShaderModule({label:"editor tri-planar shader",code:TRIPLANAR_MATERIAL_WGSL}),info=await module.getCompilationInfo();
    const errors=info.messages.filter(message=>message.type==="error"); if(errors.length) throw new Error(errors.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join("\n"));
    const pipeline=await device.createRenderPipelineAsync({label:"editor preview pipeline",layout:"auto",vertex:{module,entryPoint:"vertexMain",buffers:[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:"float32x4"},{shaderLocation:1,offset:16,format:"float32x4"}]}]},fragment:{module,entryPoint:"fragmentMain",targets:[{format}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:true,depthCompare:"less"}});
    const sampler=device.createSampler({addressModeU:"repeat",addressModeV:"repeat",magFilter:"linear",minFilter:"linear"});
    const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniforms}},{binding:1,resource:texture.createView()},{binding:2,resource:sampler}]});
    return new CreatureOrbitRenderer(device,canvas,context,dna,center,radius,vertex,index,mesh.indices.length,uniforms,texture,pipeline,bindings,mesh.vertices.slice());
  }

  private resize():void {
    const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),max=this.device.limits.maxTextureDimension2D;
    const width=Math.max(1,Math.min(max,Math.round(rect.width*dpr))),height=Math.max(1,Math.min(max,Math.round(rect.height*dpr)));
    if(width===this.width&&height===this.height) return;
    this.canvas.width=width; this.canvas.height=height; this.width=width; this.height=height;
    this.depth?.destroy(); this.depth=this.device.createTexture({label:"editor preview depth",size:[width,height],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});
  }

  public async render(azimuthDegrees:number,elevationDegrees:number):Promise<void> {
    if(this.destroyed) return; this.resize();
    const azimuth=azimuthDegrees*Math.PI/180,elevation=Math.max(-70,Math.min(70,elevationDegrees))*Math.PI/180,distance=this.radius*2.8;
    const eye:V3=[this.center[0]-Math.sin(azimuth)*Math.cos(elevation)*distance,this.center[1]+Math.sin(elevation)*distance,this.center[2]-Math.cos(azimuth)*Math.cos(elevation)*distance];
    const vp=multiply(perspective(this.width/this.height,this.radius*.01,this.radius*10),lookAt(eye,this.center));
    this.device.queue.writeBuffer(this.uniforms,0,packMaterialUniforms(vp,identity,this.dna,norm([.45,.8,.35]),eye));
    const encoder=this.device.createCommandEncoder({label:"editor orbit frame"}),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:.008,g:.009,b:.015,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:this.depth!.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});
    pass.setPipeline(this.pipeline); pass.setBindGroup(0,this.bindings); pass.setVertexBuffer(0,this.vertex); pass.setIndexBuffer(this.index,"uint32"); pass.drawIndexed(this.indexCount); pass.end(); this.device.queue.submit([encoder.finish()]); await this.device.queue.onSubmittedWorkDone();
  }

  /** Compute bone weights for the loaded mesh — call once after create(). */
  public initAnimation(skeleton: string): void {
    const mins: V3 = [Infinity, Infinity, Infinity], maxs: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.baseVertices.length; i += 8) for (let a = 0; a < 3; a++) { mins[a] = Math.min(mins[a], this.baseVertices[i + a]); maxs[a] = Math.max(maxs[a], this.baseVertices[i + a]); }
    this._bones = skeletonSpecs(skeleton, mins, maxs);
    this._skinData = computeWeights(this.baseVertices, this._bones);
    this._skeleton = skeleton;
    this._deformBuf = new Float32Array(this.baseVertices.length);
  }

  /** Skin vertices to the given clip/phase, upload to GPU, then render. */
  public async animate(clip: string, phase: number, azimuth: number, elevation: number): Promise<void> {
    if (this._skinData && this._deformBuf && this._bones) {
      const mats = skinningMatrices(this._bones, computePose(this._skeleton, clip, phase));
      skinVertices(this.baseVertices, mats, this._skinData.weights, this._skinData.indices, this._deformBuf);
      this.device.queue.writeBuffer(this.vertex, 0, this._deformBuf);
    }
    return this.render(azimuth, elevation);
  }

  public destroy():void { if(this.destroyed)return; this.destroyed=true; this.depth?.destroy(); this.vertex.destroy(); this.index.destroy(); this.uniforms.destroy(); this.texture.destroy(); this.context.unconfigure(); }
}
