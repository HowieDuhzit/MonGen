import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const source = process.argv[2];
const destination = process.argv[3];
if (!source || !destination) {
  throw new Error("usage: node extract-marching-cubes-table.mjs <MarchingCubes.js> <output.ts>");
}

const { triTable } = await import(pathToFileURL(source).href);
if (!(triTable instanceof Int32Array) || triTable.length !== 4096) {
  throw new Error("source did not export the expected 256 x 16 triTable");
}

const encoded = Buffer.from(Uint8Array.from(triTable, (v) => (v < 0 ? 255 : v))).toString("base64");
const output = `// Generated from Three.js r185 MarchingCubes.js (MIT); see THIRD_PARTY_NOTICES.md.\n` +
  `const TRI_TABLE_BASE64 = ${JSON.stringify(encoded)};\n\n` +
  `export function createTriangleTable(): Int32Array {\n` +
  `  const binary = atob(TRI_TABLE_BASE64);\n` +
  `  if (binary.length !== 4096) throw new Error("corrupt Marching Cubes triangle table");\n` +
  `  return Int32Array.from(binary, (character) => {\n` +
  `    const value = character.charCodeAt(0);\n` +
  `    return value === 255 ? -1 : value;\n` +
  `  });\n` +
  `}\n`;

await writeFile(destination, output, "utf8");
