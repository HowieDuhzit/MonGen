import type { CreatureDNA, ElementType, SurfacePattern } from "../dna";
import { compileFaceLandmarks, compileTailTip } from "./morphology";

const BASE_PALETTES: Record<ElementType, readonly [number, number, number][]> = {
  Neutral:[[0.26,0.20,0.14],[0.72,0.64,0.44],[0.96,0.90,0.72]],
  Fire:[[0.72,0.025,0.008],[1.0,0.22,0.01],[1.0,0.78,0.025]],
  Water:[[0.01,0.08,0.52],[0.01,0.42,0.90],[0.22,0.90,1.0]],
  Plant:[[0.02,0.22,0.035],[0.08,0.58,0.07],[0.62,0.88,0.12]],
  Earth:[[0.20,0.065,0.018],[0.48,0.24,0.055],[0.78,0.58,0.20]],
  Air:[[0.35,0.62,0.82],[0.70,0.88,0.98],[0.96,0.99,1.0]],
  Electric:[[0.12,0.025,0.42],[0.54,0.08,0.90],[1.0,0.90,0.01]],
  Ice:[[0.08,0.34,0.60],[0.42,0.82,0.96],[0.90,0.99,1.0]],
  Metal:[[0.07,0.085,0.12],[0.34,0.40,0.49],[0.78,0.82,0.87]],
  Light:[[0.72,0.48,0.05],[1.0,0.86,0.30],[1.0,0.99,0.82]],
  Shadow:[[0.015,0.01,0.045],[0.09,0.02,0.20],[0.42,0.045,0.52]],
};

export const PATTERN_IDS: Record<SurfacePattern, number>={Solid:0,Spots:1,Stripes:2,Bands:3,Mottled:4};

function mix32(value: number): number {
  value=Math.imul(value^(value>>>16),0x7feb352d);
  value=Math.imul(value^(value>>>15),0x846ca68b);
  return (value^(value>>>16))>>>0;
}

function rotateHue(color:readonly [number,number,number],angle:number,saturation:number):readonly [number,number,number]{
  const cos=Math.cos(angle),sin=Math.sin(angle),[r,g,b]=color;
  const rotated:[number,number,number]=[
    (.213+.787*cos-.213*sin)*r+(.715-.715*cos-.715*sin)*g+(.072-.072*cos+.928*sin)*b,
    (.213-.213*cos+.143*sin)*r+(.715+.285*cos+.140*sin)*g+(.072-.072*cos-.283*sin)*b,
    (.213-.213*cos-.787*sin)*r+(.715-.715*cos+.715*sin)*g+(.072+.928*cos+.072*sin)*b,
  ];
  const luma=rotated[0]*.213+rotated[1]*.715+rotated[2]*.072;
  return rotated.map(value=>Math.min(1,Math.max(0,luma+(value-luma)*saturation))) as unknown as readonly [number,number,number];
}

/** Three linear RGB colors packed as WGSL vec4 slots. */
export function createElementPalette(dna: CreatureDNA): Float32Array {
  const colors=BASE_PALETTES[dna.element];
  const result=new Float32Array(12);
  const hue=((dna.surface.paletteVariant%29)/28-.5)*.72,saturation=1.10+((dna.surface.paletteVariant>>>5)&7)/7*.42;
  for (let colorIndex=0;colorIndex<3;colorIndex++) {
    const shifted=rotateHue(colors[colorIndex],hue,saturation);
    for (let channel=0;channel<3;channel++) {
      const hash=mix32((dna.surface.paletteVariant+1)*0x9e3779b1+colorIndex*101+channel*17);
      const variation=0.90+(hash&255)/255*0.24;
      result[colorIndex*4+channel]=Math.min(1,shifted[channel]*variation);
    }
    result[colorIndex*4+3]=1;
  }
  return result;
}

/** Seeded, tileable grayscale value-noise texture used by all three projections. */
export function createMaterialTexture(dna: CreatureDNA, size=64): Uint8Array {
  if (size<4 || (size&(size-1))!==0) throw new RangeError("material texture size must be a power of two >= 4");
  const pixels=new Uint8Array(size*size*4);
  const mask=size-1;
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const fine=mix32(dna.seed^Math.imul(x&mask,0x1f123bb5)^Math.imul(y&mask,0x5f356495));
    const coarse=mix32((dna.seed+0x6d2b79f5)^Math.imul((x>>2)&mask,0x1f123bb5)^Math.imul((y>>2)&mask,0x5f356495));
    const value=Math.round(((fine&255)*0.35+(coarse&255)*0.65));
    const offset=(y*size+x)*4;
    pixels[offset]=pixels[offset+1]=pixels[offset+2]=value; pixels[offset+3]=255;
  }
  return pixels;
}

/** 304-byte uniform block matching SceneUniforms in the material WGSL. */
export function packMaterialUniforms(viewProjection: Float32Array, model: Float32Array, dna: CreatureDNA, light: readonly [number,number,number], camera: readonly [number,number,number]): ArrayBuffer {
  if (viewProjection.length!==16 || model.length!==16) throw new RangeError("matrices must contain 16 floats");
  const face=compileFaceLandmarks(dna),tt=compileTailTip(dna),values=new Float32Array(76);
  values.set(viewProjection,0); values.set(model,16); values.set(createElementPalette(dna),32);
  values.set([dna.surface.patternScale,dna.surface.roughness,dna.surface.metallic,PATTERN_IDS[dna.surface.pattern]],44);
  const featureVariant=((dna.seed>>>16)&0xFF)/255;
  values.set([...light,featureVariant],48); values.set([...camera,0],52);
  values.set([...face.eyes[0].center,face.eyes[0].radius],56);
  values.set([...face.eyes[1].center,face.eyes[1].radius],60);
  values.set([...face.mouth.center,face.mouth.radius],64);
  values.set([face.pupilScale,face.expression,face.mouth.radius*2.25,face.style],68);
  values.set([...tt.tip,tt.radius],72);  // tailTip xyz + radius (-1 = inactive)
  return values.buffer;
}
