import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputs = path.join(root, "outputs");
const destination = path.join(root, ".pages-dist");
const variantScript = path.join(root, "work", "build_variant.mjs");

function selectVariant(name) {
  execFileSync(process.execPath, [variantScript, name], { stdio: "inherit" });
}

function copyOutputs(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(outputs, target, { recursive: true });
}

fs.rmSync(destination, { recursive: true, force: true });
try {
  selectVariant("full");
  copyOutputs(destination);
  const fullManifestPath = path.join(destination, "manifest.webmanifest");
  const fullManifest = JSON.parse(fs.readFileSync(fullManifestPath, "utf8"));
  fullManifest.name = "The Crown";
  fs.writeFileSync(fullManifestPath, `${JSON.stringify(fullManifest, null, 2)}\n`);

  selectVariant("demo");
  copyOutputs(path.join(destination, "demo"));
} finally {
  // The repository's source-of-truth checkout always returns to the paid/full
  // variant even when copying the demo fails.
  selectVariant("full");
}

console.info(`[CROWN pages] full=/ demo=/demo/ -> ${destination}`);

