export const SKELETON_TYPES = [
  "Biped",
  "Quadruped",
  "Serpentine",
  "Avian",
  "Floating",
] as const;

export const ELEMENT_TYPES = [
  "Neutral",
  "Fire",
  "Water",
  "Plant",
  "Earth",
  "Air",
  "Electric",
  "Ice",
  "Metal",
  "Light",
  "Shadow",
] as const;

export const SOCKET_TYPES = ["Head", "Shoulders", "Tail", "Back"] as const;
export const PART_POOLS = [
  "None",
  "Horn",
  "Ear",
  "Fin",
  "Wing",
  "Spine",
  "Leaf",
  "Crystal",
  "Flame",
  "Armor",
] as const;
export const SURFACE_PATTERNS = ["Solid", "Spots", "Stripes", "Bands", "Mottled"] as const;

export type SkeletonType = (typeof SKELETON_TYPES)[number];
export type ElementType = (typeof ELEMENT_TYPES)[number];
export type SocketType = (typeof SOCKET_TYPES)[number];
export type PartPool = (typeof PART_POOLS)[number];
export type SurfacePattern = (typeof SURFACE_PATTERNS)[number];

/** Fixed-length tuples prevent accidental 2D/4D vectors at compile time. */
export type Vec3 = readonly [x: number, y: number, z: number];
export type Quaternion = readonly [x: number, y: number, z: number, w: number];

export interface Transform {
  /** Skeleton-local coordinates, in meters. */
  readonly position: Vec3;
  /** Normalized XYZW quaternion. */
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export interface MorphologyDNA {
  readonly bodyScale: Vec3;
  readonly headScale: Vec3;
  readonly limbLength: number;
  readonly limbThickness: number;
  readonly tailLength: number;
  readonly bilateralSymmetry: boolean;
  /** Smooth-min blend radius in meters. */
  readonly sdfSmoothness: number;
  readonly volumeResolution: 32 | 64 | 96 | 128 | 192 | 256;
}

export interface SurfaceDNA {
  /** Selects a deterministic three-color palette within the elemental family. */
  readonly paletteVariant: number;
  readonly pattern: SurfacePattern;
  readonly patternScale: number;
  readonly roughness: number;
  readonly metallic: number;
}

export interface AttachmentPartDNA {
  readonly pool: PartPool;
  /** Stable index into the generator-versioned part catalog. */
  readonly variant: number;
}

export interface AttachmentNodeDNA {
  readonly id: string;
  readonly socket: SocketType;
  readonly transform: Transform;
  readonly mirror: "None" | "X";
  readonly part: AttachmentPartDNA;
}

export interface CreatureDNA {
  readonly schemaVersion: "1.0.0";
  /** Pins algorithms, lookup tables, palettes, and modular asset catalogs. */
  readonly generatorVersion: string;
  /** Unsigned 32-bit PRNG seed. */
  readonly seed: number;
  readonly name: string;
  readonly skeleton: SkeletonType;
  readonly element: ElementType;
  readonly morphology: MorphologyDNA;
  readonly surface: SurfaceDNA;
  readonly attachments: readonly AttachmentNodeDNA[];
}
