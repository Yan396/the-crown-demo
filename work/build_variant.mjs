import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const variant = process.argv[2];
if (!new Set(["full", "demo"]).has(variant)) {
  console.error("Usage: node work/build_variant.mjs <full|demo>");
  process.exitCode = 1;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataPath = path.join(root, "outputs/js/data.js");
  const source = fs.readFileSync(dataPath, "utf8");
  const matches = source.match(/^export const DEMO = (?:true|false);$/gm) || [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one DEMO declaration, found ${matches.length}`);
  }
  const demo = variant === "demo";
  fs.writeFileSync(
    dataPath,
    source.replace(/^export const DEMO = (?:true|false);$/m, `export const DEMO = ${demo};`)
  );
  console.info(`[CROWN build] ${variant}: DEMO=${demo}`);
}
