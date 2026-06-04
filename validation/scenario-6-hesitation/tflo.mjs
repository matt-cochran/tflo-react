// SCENARIO 6 — Hesitation, in tflo (the WASM CEP engine).
// REPEAT quantifier: `when(focus).then(edit).times(2,10).within(5000)`.
// A user who focuses a field and edits it ≥2 times within 5s is "hesitating".
// One runtime per field (the engine's idiom for per-entity correlation).
//
// times(min, max) semantics:
//   - Each matching event increments repeat_count and stays in flight (Keep).
//   - When repeat_count >= max (greedy cap), the partial advances / completes.
//   - On a NON-matching event: if repeat_count >= min, the run is satisfied and
//     the partial advances. If < min, it keeps waiting (eventually contiguity).
//   - At flush(): a terminal repeated step with repeat_count >= min fires
//     (the stream simply ended with enough matches).
//   - within(5000) drops the partial if min is not met within 5000 ms.
//
// F1 (focus@0, edit@500, edit@1000, edit@1500): 3 edits ≥ min 2 → FIRES at flush.
// F2 (focus@0, edit@500):                        1 edit  < min 2 → NO signal.
//
// Expected: [{ signal: "hesitation", field: "F1" }]
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

function runField(field, events) {
  const compiled = new WasmPattern("hesitation")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "focus")
    .then((e) => e.kind === "edit")
    .times(2, 10)   // ≥2 edits (greedy up to 10)
    .within(5000)   // all edits must arrive within 5000 ms of focus
    .emit(() => ({ signal: "hesitation", field }));
  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

// F1: hesitates — focuses then edits three times within 5 s
const F1 = runField("F1", [
  { kind: "focus", field: "F1", ts: 0 },
  { kind: "edit",  field: "F1", ts: 500 },
  { kind: "edit",  field: "F1", ts: 1000 },
  { kind: "edit",  field: "F1", ts: 1500 },
]);

// F2: confident — focuses then edits only once (below min)
const F2 = runField("F2", [
  { kind: "focus", field: "F2", ts: 0 },
  { kind: "edit",  field: "F2", ts: 500 },
]);

console.log("tflo F1:", JSON.stringify(F1), " F2:", JSON.stringify(F2));

const ok =
  F1.length === 1 &&
  F1[0].signal === "hesitation" &&
  F1[0].field === "F1" &&
  F2.length === 0;

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
