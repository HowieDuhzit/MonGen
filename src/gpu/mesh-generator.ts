import type { CreatureDNA, Vec3 } from "../dna";
import { canonicalizeMesh } from "../mesh/canonicalize";
import { createTriangleTable } from "./marching-cubes-table";
import { compileMorphology } from "./morphology";
import { MARCHING_CUBES_WGSL } from "./shaders/marching-cubes.wgsl";
import { SDF_VOLUME_WGSL } from "./shaders/sdf-volume.wgsl";
import { MESH_VERTEX_STRIDE, packPrimitives, packVolumeParams, type VolumeConfig } from "./layout";

export interface GeneratedMesh {
  /** Eight floats per vertex: position XYZW, then normal XYZW. */
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
}

export interface MeshGenerationOptions {
  readonly boundsPadding?: number;
  readonly vertexCapacity?: number;
}

function createUploadedBuffer(device: GPUDevice, label: string, data: ArrayBufferView | ArrayBuffer, usage: GPUBufferUsageFlags): GPUBuffer {
  const byteLength = data.byteLength;
  const buffer = device.createBuffer({ label, size: Math.max(4, (byteLength + 3) & ~3), usage, mappedAtCreation: true });
  const source = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  new Uint8Array(buffer.getMappedRange()).set(source);
  buffer.unmap();
  return buffer;
}

async function checkedModule(device: GPUDevice, label: string, code: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const messages = await module.getCompilationInfo();
  const errors = messages.messages.filter((message) => message.type === "error");
  if (errors.length) throw new Error(`${label} failed to compile:\n${errors.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
  return module;
}

function deriveBounds(primitives: ReturnType<typeof compileMorphology>, padding: number): readonly [Vec3, Vec3] {
  const min: number[] = [Infinity, Infinity, Infinity];
  const max: number[] = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives) {
    const points = primitive.kind === "sphere" || primitive.kind === "ellipsoid" || primitive.kind === "roundedBox" ? [primitive.center] : [primitive.start, primitive.end];
    const radius = primitive.kind === "sphere" ? primitive.radius : primitive.kind === "capsule" ? primitive.radius : primitive.kind === "taperedCapsule" ? Math.max(primitive.startRadius,primitive.endRadius) : primitive.kind === "ellipsoid" ? Math.max(...primitive.radii) : Math.hypot(...primitive.halfSize)+primitive.rounding;
    for (const point of points) for (let axis=0; axis<3; axis++) {
      min[axis] = Math.min(min[axis], point[axis] - radius - padding);
      max[axis] = Math.max(max[axis], point[axis] + radius + padding);
    }
  }
  return [min as unknown as Vec3, max as unknown as Vec3];
}

export async function generateCreatureMesh(device: GPUDevice, dna: CreatureDNA, options: MeshGenerationOptions = {}): Promise<GeneratedMesh> {
  const primitives = compileMorphology(dna);
  const resolution = dna.morphology.volumeResolution;
  const dimensions: [number,number,number] = [resolution,resolution,resolution];
  const cellCount = (resolution-1) ** 3;
  const vertexCapacity = options.vertexCapacity ?? Math.min(cellCount * 3, 3_000_000);
  const [minBounds,maxBounds] = deriveBounds(primitives, options.boundsPadding ?? dna.morphology.sdfSmoothness * 2 + 0.1);
  const config: VolumeConfig = { minBounds,maxBounds,dimensions,isoLevel:0,smoothness:dna.morphology.sdfSmoothness,vertexCapacity };
  const fieldBytes = resolution ** 3 * 4;
  const vertexBytes = vertexCapacity * MESH_VERTEX_STRIDE;
  const indexBytes = vertexCapacity * 4;
  for (const [label,size] of [["field",fieldBytes],["vertices",vertexBytes],["indices",indexBytes]] as const) {
    if (size > device.limits.maxStorageBufferBindingSize || size > device.limits.maxBufferSize)
      throw new RangeError(`${label} buffer (${size} bytes) exceeds this device's limits`);
  }

  const owned: GPUBuffer[] = [];
  const make = (descriptor: GPUBufferDescriptor) => { const b=device.createBuffer(descriptor); owned.push(b); return b; };
  const params = createUploadedBuffer(device,"volume params",packVolumeParams(config,primitives.length),GPUBufferUsage.UNIFORM); owned.push(params);
  const primitiveBuffer = createUploadedBuffer(device,"SDF primitives",packPrimitives(primitives),GPUBufferUsage.STORAGE); owned.push(primitiveBuffer);
  const table = createUploadedBuffer(device,"Marching Cubes triangle table",createTriangleTable(),GPUBufferUsage.STORAGE); owned.push(table);
  const field = make({label:"SDF field",size:fieldBytes,usage:GPUBufferUsage.STORAGE});
  const vertices = make({label:"mesh vertices",size:vertexBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const indices = make({label:"mesh indices",size:indexBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const counters = make({label:"mesh counters",size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  const counterReadback = make({label:"counter readback",size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});

  try {
    device.queue.writeBuffer(counters,0,new Uint32Array(4));
    const sdfModule = await checkedModule(device,"SDF volume shader",SDF_VOLUME_WGSL);
    const mcModule = await checkedModule(device,"Marching Cubes shader",MARCHING_CUBES_WGSL);
    const sdfPipeline = await device.createComputePipelineAsync({label:"SDF volume pipeline",layout:"auto",compute:{module:sdfModule,entryPoint:"buildSdf"}});
    const mcPipeline = await device.createComputePipelineAsync({label:"Marching Cubes pipeline",layout:"auto",compute:{module:mcModule,entryPoint:"polygonize"}});
    const sdfGroup = device.createBindGroup({label:"SDF volume bindings",layout:sdfPipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:params}},{binding:1,resource:{buffer:primitiveBuffer}},{binding:2,resource:{buffer:field}},
    ]});
    const mcGroup = device.createBindGroup({label:"Marching Cubes bindings",layout:mcPipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:params}},{binding:1,resource:{buffer:primitiveBuffer}},{binding:2,resource:{buffer:field}},
      {binding:3,resource:{buffer:table}},{binding:4,resource:{buffer:vertices}},{binding:5,resource:{buffer:indices}},{binding:6,resource:{buffer:counters}},
    ]});
    const encoder=device.createCommandEncoder({label:"creature mesh generation"});
    let pass=encoder.beginComputePass({label:"build SDF volume"}); pass.setPipeline(sdfPipeline); pass.setBindGroup(0,sdfGroup);
    pass.dispatchWorkgroups(Math.ceil(resolution/8),Math.ceil(resolution/8),Math.ceil(resolution/4)); pass.end();
    pass=encoder.beginComputePass({label:"polygonize SDF"}); pass.setPipeline(mcPipeline); pass.setBindGroup(0,mcGroup);
    pass.dispatchWorkgroups(Math.ceil((resolution-1)/8),Math.ceil((resolution-1)/8),Math.ceil((resolution-1)/4)); pass.end();
    encoder.copyBufferToBuffer(counters,0,counterReadback,0,16); device.queue.submit([encoder.finish()]);
    await counterReadback.mapAsync(GPUMapMode.READ); const counterValues=new Uint32Array(counterReadback.getMappedRange().slice(0)); counterReadback.unmap();
    const [requested,overflow]=counterValues;
    if (overflow || requested > vertexCapacity) throw new RangeError(`Marching Cubes requested ${requested} vertices; capacity is ${vertexCapacity}`);
    if (requested === 0) return {vertices:new Float32Array(),indices:new Uint32Array()};
    const vertexReadback=make({label:"vertex readback",size:requested*MESH_VERTEX_STRIDE,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const indexReadback=make({label:"index readback",size:requested*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const readEncoder=device.createCommandEncoder({label:"bounded mesh readback"});
    readEncoder.copyBufferToBuffer(vertices,0,vertexReadback,0,requested*MESH_VERTEX_STRIDE);
    readEncoder.copyBufferToBuffer(indices,0,indexReadback,0,requested*4); device.queue.submit([readEncoder.finish()]);
    await Promise.all([vertexReadback.mapAsync(GPUMapMode.READ),indexReadback.mapAsync(GPUMapMode.READ)]);
    const result={vertices:new Float32Array(vertexReadback.getMappedRange().slice(0)),indices:new Uint32Array(indexReadback.getMappedRange().slice(0))};
    vertexReadback.unmap(); indexReadback.unmap(); return canonicalizeMesh(result);
  } finally { for (const buffer of owned) buffer.destroy(); }
}
