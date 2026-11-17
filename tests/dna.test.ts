import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  Mulberry32,
  canonicalizeDNA,
  validateCreatureDNA,
  type CreatureDNA,
  mutateDNA,
  randomizeDNA,
} from "../src/dna";

const example = JSON.parse(
  readFileSync(join(process.cwd(), "examples/emberling.dna.json"), "utf8"),
) as unknown;

test("the example DNA passes structural and semantic validation", () => {
  assert.deepEqual(validateCreatureDNA(example), { valid: true, errors: [] });
});

test("unknown properties are rejected", () => {
  const invalid = { ...(example as object), surpriseMutation: true };
  assert.equal(validateCreatureDNA(invalid).valid, false);
});

test("non-unit attachment rotations are rejected", () => {
  const invalid = structuredClone(example) as {
    attachments: Array<{ transform: { rotation: number[] } }>;
  };
  invalid.attachments[0].transform.rotation[3] = 0.5;
  assert.equal(validateCreatureDNA(invalid).valid, false);
});

test("canonical DNA ignores object key insertion order", () => {
  const dna = example as CreatureDNA;
  const reordered = Object.fromEntries(Object.entries(dna).reverse()) as unknown as CreatureDNA;
  assert.equal(canonicalizeDNA(dna), canonicalizeDNA(reordered));
});

test("the specified PRNG repeats exactly", () => {
  const first = new Mulberry32(0xdeadbeef);
  const second = new Mulberry32(0xdeadbeef);
  assert.deepEqual(
    Array.from({ length: 16 }, () => first.nextUint32()),
    Array.from({ length: 16 }, () => second.nextUint32()),
  );
});

test("artDirection optional field is accepted and bounds are enforced", () => {
  const good = { ...(example as object), artDirection: { timingMultiplier: 1.3, paletteTemperatureBias: -0.4 } };
  assert.deepEqual(validateCreatureDNA(good), { valid: true, errors: [] });
  const timingOnly = { ...(example as object), artDirection: { timingMultiplier: 0.7 } };
  assert.deepEqual(validateCreatureDNA(timingOnly), { valid: true, errors: [] });
  const outOfRange = { ...(example as object), artDirection: { timingMultiplier: 999 } };
  assert.equal(validateCreatureDNA(outOfRange).valid, false);
  const biasOutOfRange = { ...(example as object), artDirection: { paletteTemperatureBias: 2.5 } };
  assert.equal(validateCreatureDNA(biasOutOfRange).valid, false);
});

test("randomization and mutation remain valid and deterministic", () => {
  const dna=example as CreatureDNA;
  const randomA=randomizeDNA(dna,123456),randomB=randomizeDNA(dna,123456);
  assert.deepEqual(randomA,randomB); assert.deepEqual(validateCreatureDNA(randomA),{valid:true,errors:[]});
  const mutationA=mutateDNA(dna),mutationB=mutateDNA(dna);
  assert.deepEqual(mutationA,mutationB); assert.deepEqual(validateCreatureDNA(mutationA),{valid:true,errors:[]});
});
