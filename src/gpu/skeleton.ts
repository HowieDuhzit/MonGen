/** Procedural skeleton specs and animation pose computation — mirrors rig_export.py apply_motion_pose. */

export type V3 = [number, number, number];
export interface BoneSpec { name: string; head: V3; tail: V3; parent: string | null; }
export interface BonePose { rx: number; ry: number; rz: number; lx: number; ly: number; lz: number; }

type M4 = Float32Array;

function m4(): M4 { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function m4mul(a: M4, b: M4): M4 { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function m4t(x: number, y: number, z: number): M4 { const m = m4(); m[12] = x; m[13] = y; m[14] = z; return m; }
function m4rx(a: number): M4 { const m = m4(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
function m4ry(a: number): M4 { const m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
function m4rz(a: number): M4 { const m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
function m4euler(rx: number, ry: number, rz: number): M4 { return m4mul(m4mul(m4rx(rx), m4ry(ry)), m4rz(rz)); }
export function m4pt(m: M4, px: number, py: number, pz: number): V3 { return [m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]]; }
export function m4dir(m: M4, dx: number, dy: number, dz: number): V3 { return [m[0] * dx + m[4] * dy + m[8] * dz, m[1] * dx + m[5] * dy + m[9] * dz, m[2] * dx + m[6] * dy + m[10] * dz]; }

export function skeletonSpecs(kind: string, low: V3, high: V3): BoneSpec[] {
  const cx = (low[0] + high[0]) / 2, cy = (low[1] + high[1]) / 2, cz = (low[2] + high[2]) / 2;
  const sx = high[0] - low[0], sy = high[1] - low[1], sz = high[2] - low[2];
  const eps = Math.max(Math.min(sx, sy, sz) * 0.03, 0.02);
  const specs: BoneSpec[] = [];
  const add = (name: string, h: V3, t: V3, parent: string | null = null) => specs.push({ name, head: h, tail: t, parent });

  if (kind === "Biped") {
    add("root", [cx, cy, low[2]], [cx, cy, low[2] + eps]);
    add("spine_01", [cx, cy, low[2] + sz * .20], [cx, cy, low[2] + sz * .48], "root");
    add("spine_02", [cx, cy, low[2] + sz * .48], [cx, cy, low[2] + sz * .70], "spine_01");
    add("neck", [cx, cy, low[2] + sz * .70], [cx, cy, low[2] + sz * .82], "spine_02");
    add("head", [cx, cy, low[2] + sz * .82], [cx, cy, high[2]], "neck");
    for (const [side, sign] of [["L", 1], ["R", -1]] as [string, number][]) {
      const x = cx + sign * sx * .16;
      add(`${side}_leg_upper`, [x, cy, low[2] + sz * .24], [x, cy, low[2] + sz * .12], "root");
      add(`${side}_leg_lower`, [x, cy, low[2] + sz * .12], [x, cy, low[2]], `${side}_leg_upper`);
      add(`${side}_arm_upper`, [cx + sign * sx * .12, cy, low[2] + sz * .65], [cx + sign * sx * .32, cy, low[2] + sz * .48], "spine_02");
      add(`${side}_arm_lower`, [cx + sign * sx * .32, cy, low[2] + sz * .48], [cx + sign * sx * .48, cy, low[2] + sz * .35], `${side}_arm_upper`);
    }
  } else if (kind === "Quadruped" || kind === "Avian") {
    add("root", [cx, cy, low[2]], [cx, cy, low[2] + eps]);
    add("spine_rear", [cx, high[1] - sy * .15, cz], [cx, cy, cz], "root");
    add("spine_front", [cx, cy, cz], [cx, low[1] + sy * .25, cz], "spine_rear");
    add("neck", [cx, low[1] + sy * .25, cz], [cx, low[1] + sy * .12, low[2] + sz * .72], "spine_front");
    add("head", [cx, low[1] + sy * .12, low[2] + sz * .72], [cx, low[1], low[2] + sz * .78], "neck");
    for (const [side, sign] of [["L", 1], ["R", -1]] as [string, number][]) {
      for (const [region, y, par] of [["front", low[1] + sy * .25, "spine_front"], ["rear", high[1] - sy * .18, "spine_rear"]] as [string, number, string][]) {
        const x = cx + sign * sx * .20;
        add(`${side}_${region}_leg_upper`, [x, y, cz], [x, y, low[2] + sz * .22], par);
        add(`${side}_${region}_leg_lower`, [x, y, low[2] + sz * .22], [x, y, low[2]], `${side}_${region}_leg_upper`);
      }
      if (kind === "Avian") add(`${side}_wing`, [cx + sign * sx * .10, cy, low[2] + sz * .58], [cx + sign * sx * .48, cy, low[2] + sz * .55], "spine_front");
    }
    add("tail", [cx, high[1] - sy * .12, cz], [cx, high[1], cz], "spine_rear");
  } else if (kind === "Serpentine") {
    add("root", [cx, cy, low[2]], [cx, cy, low[2] + eps]);
    let par = "root";
    for (let i = 0; i < 8; i++) {
      const name = `body_${String(i + 1).padStart(2, "0")}`;
      add(name, [cx, high[1] - sy * (i / 8), cz], [cx, high[1] - sy * ((i + 1) / 8), cz], par); par = name;
    }
    add("head", [cx, low[1] + sy * .08, cz], [cx, low[1], cz + eps], par);
  } else {
    add("root", [cx, cy, low[2]], [cx, cy, cz]);
    add("core", [cx, cy, cz], [cx, cy, low[2] + sz * .72], "root");
    add("head", [cx, cy, low[2] + sz * .72], [cx, cy, high[2]], "core");
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      add(`orb_${i + 1}`, [cx, cy, low[2] + sz * .32], [cx + Math.cos(a) * sx * .42, cy + Math.sin(a) * sy * .42, low[2] + sz * .25], "core");
    }
  }
  return specs;
}

export function computePose(skeleton: string, clip: string, phase: number): Map<string, BonePose> {
  const pose = new Map<string, BonePose>();
  const g = (name: string) => { if (!pose.has(name)) pose.set(name, { rx: 0, ry: 0, rz: 0, lx: 0, ly: 0, lz: 0 }); return pose.get(name)!; };
  const rot = (name: string, rx = 0, ry = 0, rz = 0) => { const p = g(name); p.rx += rx; p.ry += ry; p.rz += rz; };
  const loc = (name: string, lx = 0, ly = 0, lz = 0) => { const p = g(name); p.lx += lx; p.ly += ly; p.lz += lz; };

  const wave = Math.sin(phase * Math.PI * 2), ctr = Math.cos(phase * Math.PI * 2);
  const kind = skeleton;

  if (clip === "Idle") {
    loc("root", 0, 0, .018 * wave);
    if (kind === "Biped") {
      rot("spine_01", 0, 0, .025 * wave); rot("spine_02", .018 * ctr, 0, -.018 * wave);
      rot("head", -.025 * ctr, 0, -.035 * wave); rot("L_arm_upper", 0, 0, .018 * wave); rot("R_arm_upper", 0, 0, -.018 * wave);
    } else if (kind === "Quadruped") {
      rot("spine_front", .022 * ctr); rot("neck", -.035 * ctr); rot("head", 0, 0, .025 * wave);
      rot("tail", 0, .10 * Math.sin((phase - .12) * Math.PI * 2), .045 * Math.cos((phase - .12) * Math.PI * 2));
    } else if (kind === "Serpentine") {
      for (let i = 0; i < 8; i++) rot(`body_${String(i + 1).padStart(2, "0")}`, .012 * ctr, 0, .045 * Math.sin(phase * Math.PI * 2 - i * .52));
      rot("head", 0, 0, -.055 * wave);
    } else if (kind === "Avian") {
      rot("spine_front", .025 * ctr); rot("head", -.04 * ctr, 0, .025 * wave);
      rot("L_wing", 0, .035 * wave); rot("R_wing", 0, -.035 * wave);
      rot("tail", 0, 0, .035 * Math.sin((phase - .10) * Math.PI * 2));
    } else {
      loc("core", 0, 0, .045 * wave); rot("head", 0, 0, -.04 * wave);
      for (let i = 0; i < 3; i++) rot(`orb_${i + 1}`, 0, .045 * ctr, .10 * Math.sin(phase * Math.PI * 2 + i * Math.PI * 2 / 3));
    }
  } else if (clip === "Walk" || clip === "Run") {
    const pace = clip === "Run" ? 1.48 : 1.0;
    loc("root", 0, -.025 * ctr * (pace - 1), .035 * Math.abs(wave) * pace);
    if (kind === "Biped") {
      for (const [side, sign] of [["L", 1], ["R", -1]] as [string, number][]) {
        const swing = wave * sign;
        rot(`${side}_leg_upper`, .58 * swing * pace); rot(`${side}_leg_lower`, .38 * Math.max(0, -swing) * pace);
        rot(`${side}_arm_upper`, -.42 * swing * pace, 0, -.04 * sign); rot(`${side}_arm_lower`, -.18 * swing * pace);
      }
      rot("spine_01", .10 * (pace - 1), 0, .07 * wave * pace); rot("spine_02", 0, 0, -.045 * wave * pace); rot("head", 0, 0, -.035 * wave * pace);
    } else if (kind === "Quadruped" || kind === "Avian") {
      for (const [side, sign] of [["L", 1], ["R", -1]] as [string, number][]) {
        for (const [region, offset] of [["front", sign], ["rear", -sign]] as [string, number][]) {
          const swing = wave * offset;
          rot(`${side}_${region}_leg_upper`, .46 * swing * pace); rot(`${side}_${region}_leg_lower`, .34 * Math.max(0, -swing) * pace);
        }
      }
      rot("spine_rear", .08 * (pace - 1), 0, .035 * wave * pace); rot("spine_front", .035 * ctr * pace, 0, -.03 * wave * pace);
      rot("head", -.05 * ctr * pace, 0, .025 * wave * pace);
      rot("tail", 0, 0, .08 * Math.sin((phase - .15) * Math.PI * 2) * pace);
      if (kind === "Avian") { rot("L_wing", 0, .08 * ctr * pace); rot("R_wing", 0, -.08 * ctr * pace); }
    } else if (kind === "Serpentine") {
      for (let i = 0; i < 8; i++) {
        rot(`body_${String(i + 1).padStart(2, "0")}`, .025 * pace * Math.cos(phase * Math.PI * 2 - i * .45), 0, .25 * pace * Math.sin(phase * Math.PI * 2 - i * .62));
      }
      rot("head", 0, 0, -.12 * pace * Math.sin(phase * Math.PI * 2 - 4.5));
    } else {
      loc("core", .055 * wave * pace, 0, .055 * Math.abs(ctr) * pace); rot("head", 0, 0, -.08 * wave * pace);
      for (let i = 0; i < 3; i++) rot(`orb_${i + 1}`, 0, .12 * ctr * pace, .34 * pace * Math.sin(phase * Math.PI * 2 + i * Math.PI * 2 / 3));
    }
  } else if (clip === "Special") {
    const charge = Math.sin(phase * Math.PI), pulse = Math.sin(phase * Math.PI * 4) * charge;
    loc("root", 0, 0, .12 * charge); rot("head", -.18 * charge, 0, .08 * pulse);
    if (kind === "Biped") {
      rot("spine_01", -.18 * charge); rot("spine_02", .28 * charge);
      for (const [side, sign] of [["L", 1], ["R", -1]] as [string, number][]) { rot(`${side}_arm_upper`, -.55 * charge, sign * .58 * charge); rot(`${side}_arm_lower`, .42 * charge); }
    } else if (kind === "Quadruped" || kind === "Avian") {
      rot("spine_front", -.20 * charge); rot("neck", .28 * charge); rot("tail", 0, 0, .28 * pulse);
      if (kind === "Avian") { rot("L_wing", 0, -1.18 * charge, -.20 * pulse); rot("R_wing", 0, 1.18 * charge, .20 * pulse); }
    } else if (kind === "Serpentine") {
      for (let i = 0; i < 8; i++) rot(`body_${String(i + 1).padStart(2, "0")}`, .08 * charge, 0, .38 * charge * Math.sin(i * .72 + phase * Math.PI * 2));
    } else {
      loc("core", 0, 0, .24 * charge);
      for (let i = 0; i < 3; i++) rot(`orb_${i + 1}`, 0, .44 * pulse, (.82 + i * .12) * charge * (i % 2 ? -1 : 1));
    }
  } else if (clip === "Hurt") {
    const recoil = Math.sin(phase * Math.PI), shake = Math.sin(phase * Math.PI * 6) * recoil;
    loc("root", 0, .18 * recoil, .045 * recoil); rot("root", -.16 * recoil, 0, .06 * shake); rot("head", .24 * recoil, 0, -.12 * shake);
    for (const name of ["spine_01", "spine_front", "core"]) rot(name, -.14 * recoil, 0, .05 * shake);
  } else if (clip === "Faint") {
    const fall = phase * phase * (3 - 2 * phase);
    loc("root", 0, .16 * fall, -.18 * fall); rot("root", 1.08 * fall, 0, .12 * fall); rot("head", -.32 * fall);
    for (const name of ["spine_01", "spine_rear", "core"]) rot(name, .28 * fall);
    for (const side of ["L", "R"]) {
      for (const region of ["front", "rear"]) rot(`${side}_${region}_leg_upper`, .48 * fall);
      rot(`${side}_leg_upper`, .55 * fall); rot(`${side}_arm_upper`, -.30 * fall);
    }
  } else { // Attack
    const envelope = Math.sin(Math.min(Math.max(phase, 0), 1) * Math.PI);
    const anticipation = Math.max(0, 1 - phase * 3), strike = Math.max(0, 1 - Math.abs(phase - .52) * 4);
    if (kind === "Biped") {
      loc("root", 0, -.10 * strike, .035 * envelope); rot("spine_01", -.15 * anticipation + .28 * strike); rot("spine_02", .22 * strike);
      rot("L_arm_upper", -.35 * anticipation + 1.0 * strike, 0, -.18 * strike); rot("R_arm_upper", -.25 * anticipation + .82 * strike, 0, .18 * strike);
      rot("L_arm_lower", .52 * strike); rot("R_arm_lower", .45 * strike); rot("head", -.16 * strike);
    } else if (kind === "Quadruped") {
      loc("root", 0, -.18 * strike, .04 * envelope); rot("spine_rear", -.08 * anticipation + .14 * strike); rot("spine_front", -.24 * strike);
      rot("neck", .32 * strike); rot("head", -.38 * strike); rot("tail", 0, .28 * envelope, .18 * ctr * envelope);
      for (const side of ["L", "R"]) rot(`${side}_front_leg_upper`, -.22 * strike);
    } else if (kind === "Serpentine") {
      for (let i = 0; i < 8; i++) rot(`body_${String(i + 1).padStart(2, "0")}`, .05 * strike, 0, .34 * envelope * Math.sin(i * .68 + phase * Math.PI));
      loc("root", 0, -.16 * strike); rot("head", -.48 * strike, 0, .16 * wave);
    } else if (kind === "Avian") {
      loc("root", 0, -.12 * strike, .12 * envelope); rot("spine_front", -.18 * strike); rot("head", .28 * strike);
      rot("L_wing", 0, -1.05 * strike, -.18 * anticipation); rot("R_wing", 0, 1.05 * strike, .18 * anticipation); rot("tail", .20 * strike);
    } else {
      loc("core", 0, -.10 * strike, .16 * envelope); rot("head", -.22 * strike, 0, .12 * wave);
      for (let i = 0; i < 3; i++) rot(`orb_${i + 1}`, 0, .35 * envelope, (.75 + i * .08) * strike * (i % 2 ? -1 : 1));
    }
  }
  return pose;
}

/** World-space posed matrices for each bone, plus skinning matrices (posed × inv(rest)). */
export function skinningMatrices(specs: BoneSpec[], pose: Map<string, BonePose>): M4[] {
  const specMap = new Map<string, BoneSpec>(specs.map(s => [s.name, s]));
  const worldMats: M4[] = new Array(specs.length);

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const p = pose.get(spec.name) ?? { rx: 0, ry: 0, rz: 0, lx: 0, ly: 0, lz: 0 };
    const localR = m4euler(p.rx, p.ry, p.rz);
    const localT = m4t(p.lx, p.ly, p.lz);
    const localPose = m4mul(localR, localT);

    if (spec.parent == null) {
      worldMats[i] = m4mul(m4t(spec.head[0], spec.head[1], spec.head[2]), localPose);
    } else {
      const pIdx = specs.findIndex(s => s.name === spec.parent);
      const parentSpec = specMap.get(spec.parent)!;
      const offset = m4t(spec.head[0] - parentSpec.head[0], spec.head[1] - parentSpec.head[1], spec.head[2] - parentSpec.head[2]);
      worldMats[i] = m4mul(m4mul(worldMats[pIdx], offset), localPose);
    }
  }

  return specs.map((spec, i) => m4mul(worldMats[i], m4t(-spec.head[0], -spec.head[1], -spec.head[2])));
}
