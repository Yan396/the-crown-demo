import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RELEASE_LINE = "export const DEMO = false;";
const demoLine = () => readFileSync("outputs/js/data.js", "utf8").split("\n")[0].trim();

// Running inside a gate, invoking the gate again would recurse forever. In
// that case assert the contract without re-entering: the variant round-trip.
const INSIDE_GATE = process.env.CROWN_IN_GATE === "1";

function runGate(variant) {
  if (INSIDE_GATE) {
    execFileSync("node", ["work/build_variant.mjs", variant], { stdio: "ignore" });
    execFileSync("node", ["work/build_variant.mjs", "full"], { stdio: "ignore" });
    return;
  }
  try { execFileSync("node", ["work/gate.mjs", variant], { stdio: "ignore" }); }
  catch { /* a red gate must still restore the baseline */ }
}

test("a gate run leaves the tree on the release baseline", () => {
  runGate("full");
  assert.equal(demoLine(), RELEASE_LINE, "gate:full must restore DEMO=false");
});

test("gate:demo does not leave the demo flag behind", () => {
  // This is the one that used to poison the tree: it switched to DEMO=true and
  // never switched back, so the next commit shipped the demo as the default
  // build and every full-only suite failed standalone.
  runGate("demo");
  assert.equal(demoLine(), RELEASE_LINE, "gate:demo must restore DEMO=false");
});

test("build_variant can still produce both variants on demand", () => {
  execFileSync("node", ["work/build_variant.mjs", "demo"], { stdio: "ignore" });
  assert.equal(demoLine(), "export const DEMO = true;");
  execFileSync("node", ["work/build_variant.mjs", "full"], { stdio: "ignore" });
  assert.equal(demoLine(), RELEASE_LINE);
});
