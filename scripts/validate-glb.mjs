import { readFile, writeFile } from "node:fs/promises";
import validator from "gltf-validator";

const path=process.argv[2];
const reportPath=process.argv[3]??"artifacts/emberling-gltf-validator.json";
if (!path) throw new Error("usage: node scripts/validate-glb.mjs <file.glb> [report.json]");
const bytes=new Uint8Array(await readFile(path));
const report=await validator.validateBytes(bytes,{uri:path,maxIssues:1000});
const errors=report.issues.messages.filter(message=>message.severity===0);
await writeFile(reportPath,JSON.stringify(report,null,2)+"\n","utf8");
console.log(`glTF Validator: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings, ${report.issues.numInfos} infos`);
if (errors.length || report.issues.numErrors) {
  for (const error of errors) console.error(`${error.code}: ${error.message}`);
  process.exitCode=1;
}
