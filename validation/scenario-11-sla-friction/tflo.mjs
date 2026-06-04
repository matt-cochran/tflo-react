// SCENARIO 11 — SLA friction, in tflo (the WASM CEP engine).
// Native event-time negation-within-window: `when(system_response) notThen(user_step)
// within(8000)`. One runtime per response (the engine's idiom for per-entity
// correlation). Compare against react.mjs / signals.mjs / rxjs.mjs / xstate.mjs.
//
// Output: R1 → [] (user acted within 8000ms), R2 → [friction] (no user_step).
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

function runResponse(responseId, events) {
  const compiled = new WasmPattern("sla-friction")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "system_response")
    .notThen((e) => e.kind === "user_step")
    .within(8000)
    .emit(() => ({ signal: "friction", id: responseId }));
  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

// R1: system_response at ts 0, user_step at ts 3000 → within 8000ms → no friction
const R1 = runResponse("R1", [
  { kind: "system_response", id: "R1", ts: 0 },
  { kind: "user_step",       id: "R1", ts: 3000 },
]);

// R2: system_response at ts 0, no user_step → friction
const R2 = runResponse("R2", [
  { kind: "system_response", id: "R2", ts: 0 },
]);

console.log("tflo R1:", JSON.stringify(R1), " R2:", JSON.stringify(R2));
const ok = R1.length === 0 && R2.length === 1 && R2[0].signal === "friction" && R2[0].id === "R2";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
