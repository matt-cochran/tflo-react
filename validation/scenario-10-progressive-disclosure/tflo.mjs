// SCENARIO 10 — Progressive disclosure, in tflo (the WASM CEP engine).
// Interior negation: `when(fail) notBetween(success) then(fail) within(30000)`.
// One runtime per step (the engine's idiom for per-entity correlation).
//
// S1: fail@0, fail@2000                   → [{signal:"show_help",step:"S1"}]  FIRES
// S2: fail@0, success@1000, fail@2000     → []  SUPPRESSED (success between the fails)
//
// The key distinction vs scenario-1: this is INTERIOR negation (`notBetween`),
// not terminal negation (`notThen`). `notThen` cannot express "two occurrences of X
// with no Y between them" — only `notBetween` can.
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

function runStep(step, events) {
  const compiled = new WasmPattern("progressive-disclosure")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "fail")
    .notBetween((e) => e.kind === "success")
    .then((e) => e.kind === "fail")
    .within(30000)
    .emit(() => ({ signal: "show_help", step }));
  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

// S1: two consecutive fails with nothing between → show_help FIRES
const S1 = runStep("S1", [
  { kind: "fail",    step: "S1", ts: 0 },
  { kind: "fail",    step: "S1", ts: 2000 },
]);

// S2: fail → success → fail, the success between kills the partial → SUPPRESSED
const S2 = runStep("S2", [
  { kind: "fail",    step: "S2", ts: 0 },
  { kind: "success", step: "S2", ts: 1000 },
  { kind: "fail",    step: "S2", ts: 2000 },
]);

console.log("tflo S1:", JSON.stringify(S1));
console.log("tflo S2:", JSON.stringify(S2));

const ok =
  S1.length === 1 &&
  S1[0].signal === "show_help" &&
  S1[0].step === "S1" &&
  S2.length === 0;

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
