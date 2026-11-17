import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const child=spawn(process.execPath,["scripts/generate-mesh.mjs","--dna","examples/emberling.dna.json","--output","artifacts/emberling-r32.obj","--report","artifacts/emberling-r32-gpu-report.json","--resolution","32"],{stdio:"inherit"});
const code=await new Promise((resolve,reject)=>{ child.once("error",reject); child.once("exit",resolve); });
if (code!==0) process.exit(code??1);
await readFile("artifacts/emberling-r32.obj");
