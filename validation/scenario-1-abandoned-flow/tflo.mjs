// SCENARIO 1 — Abandoned flow, in tflo (the WASM CEP engine).
// Native event-time negation-within-window: `when(started) notThen(completed)
// within(5000)`. One runtime per flow (the engine's idiom for per-entity
// correlation). Compare against rxjs-*.mjs / xstate.mjs in this folder.
//
// Output: A → [] (completes in time), B → [abandoned] (never completes).
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

function runFlow(flowId, events) {
  const compiled = new WasmPattern("abandoned")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "flow_started")
    .notThen((e) => e.kind === "flow_completed")
    .within(5000)
    .emit(() => ({ signal: "abandoned", flowId }));
  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

const A = runFlow("A", [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_completed", flowId: "A", ts: 2000 },
]);
const B = runFlow("B", [{ kind: "flow_started", flowId: "B", ts: 100 }]);

console.log("tflo A:", JSON.stringify(A), " B:", JSON.stringify(B));
const ok = A.length === 0 && B.length === 1 && B[0].flowId === "B";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
