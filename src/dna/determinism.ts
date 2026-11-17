import type { CreatureDNA } from "./types";

/**
 * Canonical JSON for cache keys and reproducibility manifests. Object keys are
 * sorted recursively; array order remains meaningful.
 */
export function canonicalizeDNA(dna: CreatureDNA): string {
  return JSON.stringify(sortValue(dna));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Compare UTF-16 code units directly. localeCompare can vary with the
        // host locale, which is unacceptable for a canonical cache key.
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

/** Small, specified uint32 PRNG suitable for matching TypeScript and WGSL. */
export class Mulberry32 {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  public nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }
}
