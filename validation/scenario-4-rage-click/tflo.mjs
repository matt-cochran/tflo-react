// SCENARIO 4 — Rage click, in tflo (the WASM CEP engine).
// Native event-time REPEAT quantifier: `when(click).then(click).times(4,4).within(2000)`.
// One runtime per target — the engine's per-entity idiom. Compare against the
// hand-rolled implementations in react.mjs / signals.mjs.
//
// times(N,N) semantics (empirically confirmed):
//   - N repeats of the `then` step → N+1 total captured events (1 when + N then).
//   - within(ms) is measured from the ANCHOR (when) event, not rolling between steps.
//   - times(4,4).within(2000) → 5 total clicks where clicks 2–5 all fall ≤ 2000ms
//     after click 1.
//
// Output: T1 → [{signal:"rage",target:"T1"}], T2 → []
// Self-asserts PASS/FAIL + process.exit.
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

const WINDOW = 2000;

function runTarget(target, events) {
  // times(4,4) → the `then` predicate fires exactly 4 times.
  // Total captured: 1 when + 4 then = 5 click events.
  // within(2000) ensures clicks 2–5 each arrive within 2000ms of click 1.
  const compiled = new WasmPattern("rage")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "click")
    .then((e) => e.kind === "click")
    .times(4, 4)
    .within(WINDOW)
    .emit(() => ({ signal: "rage", target }));

  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

// T1 — burst: 5 rapid clicks, all within 2000ms of first → rage FIRES
const T1 = runTarget("T1", [
  { kind: "click", target: "T1", ts: 0 },
  { kind: "click", target: "T1", ts: 100 },
  { kind: "click", target: "T1", ts: 200 },
  { kind: "click", target: "T1", ts: 300 },
  { kind: "click", target: "T1", ts: 400 },
]);

// T2 — spaced: only 2 clicks, second is 5000ms from first → outside window, no rage
const T2 = runTarget("T2", [
  { kind: "click", target: "T2", ts: 0 },
  { kind: "click", target: "T2", ts: 5000 },
]);

const combined = [...T1, ...T2];
console.log("tflo T1:", JSON.stringify(T1), " T2:", JSON.stringify(T2));
console.log("combined:", JSON.stringify(combined));

const ok =
  T1.length === 1 &&
  T1[0].signal === "rage" &&
  T1[0].target === "T1" &&
  T2.length === 0;

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
