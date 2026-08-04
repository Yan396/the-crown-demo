/*
 * Two gates, because there are two builds.
 *
 * gate:demo  — DEMO=true. Keeps every frozen demo-world assertion: the
 *              renown-100 ending, the demo pacing bands, the byte-identical
 *              v1.0 world hash, the battleScript golden outputs.
 * gate:full  — DEMO=false. The SHIPPING build. Runs everything that is not
 *              demo-specific, plus F1's own suite.
 *
 * Both must be green at every merge. A suite that is green on one build and
 * red on the other is a statement about that build, not a licence to ignore it.
 */
import { execFileSync } from "node:child_process";

const DEMO_ONLY = new Set([
  // Asserts the renown-100 demo ending, which the full version does not have.
  "test_v11",
  // Golden outputs frozen against the demo world (scripted north/south war).
  "test_battle_script",
  // Demo pacing bands (Act 2 minutes) + wallMs perf sample.
  "test_phase25",
  // Contains the v1.0 byte-identical world hash, true only when CONFIG.DEMO
  // seeds the initial war. Its other seven HP tests are build-agnostic.
  "test_v11_hp"
]);

const FULL_ONLY = new Set(["test_f2_act4", "test_f3_armies", "test_f4_final"]);

const ALL = [
  "test_phase25", "test_casual_pass", "test_decode_acceptance", "test_final_roads",
  "test_battle_script", "test_stage_contract", "test_prompt_a", "test_gameplay_depth",
  "test_v11", "test_v11_hp", "test_battle_integrity", "test_f1_act3",
  "test_f2_act4", "test_f3_armies", "test_f4_final", "test_gate_hygiene",
  "test_f3_motion", "test_post_launch_v11",
  "test_block3_reconcile", "test_battle_presentation", "test_audio_music",
  "test_battle_fullscreen"
];

const variant = process.argv[2] === "demo" ? "demo" : "full";
const suites = variant === "demo"
  ? ALL.filter((name) => !FULL_ONLY.has(name))
  : ALL.filter((name) => !DEMO_ONLY.has(name));

/*
 * The release baseline is DEMO=false. A gate run switches the build variant to
 * do its job, so it MUST put it back -- on success, on failure, and on throw.
 * It previously restored only after a successful `full` run, which left the
 * tree on DEMO=true after any gate:demo. That silently poisons everything
 * downstream: a later `git add -A` commits the demo flag as the shipped
 * default, and the full-only suites (F2/F3/F4) all fail when run standalone,
 * which reads as "F2-F4 is broken" when nothing is broken at all.
 */
const RELEASE_VARIANT = "full";
function restoreReleaseBaseline() {
  execFileSync("node", ["work/build_variant.mjs", RELEASE_VARIANT], { stdio: "ignore" });
}
process.on("exit", restoreReleaseBaseline);

execFileSync("node", ["work/build_variant.mjs", variant], { stdio: "ignore" });

let failed = 0;
for (const name of suites) {
  let ok = true;
  try {
    execFileSync("node", [`work/${name}.mjs`], {
      stdio: "ignore",
      env: { ...process.env, CROWN_IN_GATE: "1" }
    });
  }
  catch { ok = false; failed += 1; }
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
}
console.log(`\ngate:${variant} — ${suites.length - failed}/${suites.length} suites green`);
process.exit(failed ? 1 : 0);
