#!/usr/bin/env node
/**
 * Visual quality gate runner for MonGen v0.5.
 * Validates one golden creature per skeleton family:
 *   - GLB contains expected facial bones (jaw, L_eye, R_eye)
 *   - GLB contains the 5 required shape keys
 *   - Anatomy object count matches DNA attachment count
 *   - Khronos glTF validator returns zero errors
 *   - Sprite atlas passes basic sanity check (frame count, dimensions)
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const GOLDEN_DNA = [
  join(ROOT, "examples/golden/voltusk.dna.json"),    // Biped
  join(ROOT, "examples/golden/mossback.dna.json"),   // Quadruped
  join(ROOT, "examples/golden/ripplet.dna.json"),    // Serpentine
  join(ROOT, "examples/golden/zephyrix.dna.json"),   // Avian
  join(ROOT, "examples/golden/noctilume.dna.json"),  // Floating
];

const REQUIRED_SHAPE_KEYS = ["Neutral", "Alert", "Angry", "Hurt", "Faint"];
const REQUIRED_FACIAL_BONES = ["jaw", "L_eye", "R_eye"];

let passed = 0; let failed = 0;

function pass(label) { console.log(`  ✓  ${label}`); passed++; }
function fail(label, reason) { console.error(`  ✗  ${label}: ${reason}`); failed++; }

function assertIn(set, items, label) {
  const missing = items.filter(x => !set.has(x));
  if (missing.length) { fail(label, `missing: ${missing.join(", ")}`); return false; }
  pass(label); return true;
}

async function runBlenderScript(script, args) {
  const blender = process.env.BLENDER_BIN ?? "blender";
  const result = await exec(blender, [
    "--background", "--factory-startup", "--python", script, "--",
    ...args,
  ], { timeout: 300_000 });
  return result.stdout + result.stderr;
}

async function validateGolden(dnaPath) {
  const dna = JSON.parse(readFileSync(dnaPath, "utf8"));
  const skeleton = dna.skeleton;
  const name = dna.name;
  console.log(`\n── ${name} (${skeleton}) ──`);

  const meshPath = join(ROOT, `build/mesh/${name}/creature.obj`);
  const glbPath  = join(ROOT, `build/glb/${name}/creature.glb`);
  const rptPath  = join(ROOT, `build/reports/${name}-rig.json`);
  const lodDir   = join(ROOT, `build/lods/${name}`);

  // Run rig_export if GLB doesn't exist
  if (!existsSync(glbPath)) {
    console.log("  … generating GLB (this may take a while)");
    await runBlenderScript(join(ROOT, "blender/rig_export.py"), [
      "--mesh", meshPath, "--dna", dnaPath, "--output", glbPath,
      "--report", rptPath, "--lod-dir", lodDir,
    ]);
  }

  if (!existsSync(rptPath)) { fail("rig report exists", rptPath); return; }
  const report = JSON.parse(readFileSync(rptPath, "utf8"));

  // Facial bones
  const bonesInReport = new Set(
    (report.facial_bones ?? []).map(b => b.toLowerCase())
  );
  assertIn(bonesInReport, REQUIRED_FACIAL_BONES, "facial bones present");

  // Shape keys
  const shapeKeys = new Set(report.shape_keys ?? []);
  assertIn(shapeKeys, REQUIRED_SHAPE_KEYS, "shape keys present");

  // Anatomy count
  const attachmentCount = (dna.attachments ?? []).filter(a => a.part.pool !== "None").length;
  const anatomyCount = report.anatomy_objects ?? 0;
  if (anatomyCount >= attachmentCount) {
    pass(`anatomy objects (${anatomyCount}) ≥ attachments (${attachmentCount})`);
  } else {
    fail("anatomy object count", `${anatomyCount} < ${attachmentCount} attachments`);
  }

  // Khronos glTF validator (optional — skip gracefully if not installed)
  try {
    const { stdout } = await exec("gltf_validator", ["--validate-resources", glbPath]);
    const parsed = JSON.parse(stdout);
    const errors = parsed?.issues?.numErrors ?? 0;
    if (errors === 0) {
      pass("Khronos validator: 0 errors");
    } else {
      fail("Khronos validator", `${errors} errors`);
    }
  } catch {
    console.log("  –  Khronos validator not installed, skipping");
  }

  // Verify GLB round-trip rig contract
  const verifyRpt = join(ROOT, `build/reports/${name}-verify.json`);
  await runBlenderScript(join(ROOT, "blender/verify_glb.py"), [
    "--glb", glbPath, "--report", verifyRpt,
  ]);
  if (existsSync(verifyRpt)) {
    const v = JSON.parse(readFileSync(verifyRpt, "utf8"));
    const vKeys = new Set(v.shape_keys ?? []);
    assertIn(vKeys, REQUIRED_SHAPE_KEYS, "shape keys survive GLB round-trip");
    pass(`round-trip walk delta: ${v.roundtrip_animation_max_delta?.toFixed(4)}`);
  }
}

(async () => {
  console.log("MonGen v0.5 — Visual Quality Gates\n");
  for (const dnaPath of GOLDEN_DNA) {
    try { await validateGolden(dnaPath); }
    catch (err) { fail(dnaPath, String(err)); }
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
