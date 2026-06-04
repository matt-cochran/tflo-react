// SCENARIO 5 — Card-testing fraud, in tflo (the WASM CEP engine).
// Interior negation: `when(fail).notBetween(success).then(fail).within(60000)`.
// The `notBetween` guard kills a partial match the moment a success is seen
// between the two fails — a sequence not expressible as terminal `notThen`.
//
// One runtime per card (the engine's idiom for per-entity correlation).
// C1: fail@0, fail@1000              → card_testing FIRES (no success between).
// C2: fail@0, success@500, fail@1000 → SUPPRESSED (success kills the partial).
//
// Expected output: [{ signal: "card_testing", card: "C1" }]
import init, { WasmPattern, WasmPatternRuntime } from "../../src/wasm/cep/tflo_cep_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/cep/tflo_cep_wasm_bg.wasm", import.meta.url)),
  ),
});

function runCard(card, events) {
  const compiled = new WasmPattern("card_testing")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "fail")
    .notBetween((e) => e.kind === "success")
    .then((e) => e.kind === "fail")
    .within(60000)
    .emit(() => ({ signal: "card_testing", card }));
  const rt = new WasmPatternRuntime(compiled);
  const out = [];
  for (const e of events) for (const s of rt.push(e)) out.push(s);
  for (const s of rt.flush()) out.push(s);
  return out;
}

// C1: two fails, no success between — should fire
const C1 = runCard("C1", [
  { kind: "fail", card: "C1", ts: 0 },
  { kind: "fail", card: "C1", ts: 1000 },
]);

// C2: fail → success → fail — success in the middle suppresses the signal
const C2 = runCard("C2", [
  { kind: "fail",    card: "C2", ts: 0 },
  { kind: "success", card: "C2", ts: 500 },
  { kind: "fail",    card: "C2", ts: 1000 },
]);

console.log("tflo C1:", JSON.stringify(C1), " C2:", JSON.stringify(C2));

const ok =
  C1.length === 1 &&
  C1[0].signal === "card_testing" &&
  C1[0].card === "C1" &&
  C2.length === 0;

console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
