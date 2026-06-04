// SCENARIO 9 — Undo grace period, in tflo (the WASM CEP engine).
// Native event-time negation-within-window: `when(action) notThen(undo)
// within(10000)`. One runtime per action id (the engine's idiom for per-entity
// correlation). Compare against react.mjs / signals.mjs / rxjs.mjs / xstate.mjs.
//
// A1: action @ ts 0, undo @ ts 3000  → [] (undo arrived in time, no "committed")
// A2: action @ ts 0, no undo         → [{signal:"committed",id:"A2"}]
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

function runAction(actionId, events) {
  const compiled = new WasmPattern("undo-grace")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "action")
    .notThen((e) => e.kind === "undo")
    .within(10000)
    .emit(() => ({ signal: "committed", id: actionId }));
  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

// A1: action then undo within window → no "committed"
const A1 = runAction("A1", [
  { kind: "action", id: "A1", ts: 0 },
  { kind: "undo",   id: "A1", ts: 3000 },
]);

// A2: action, no undo → "committed"
const A2 = runAction("A2", [
  { kind: "action", id: "A2", ts: 0 },
]);

console.log("tflo A1:", JSON.stringify(A1), " A2:", JSON.stringify(A2));
const ok = A1.length === 0 && A2.length === 1 && A2[0].signal === "committed" && A2[0].id === "A2";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
