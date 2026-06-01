// SCENARIO 2 — Keyed event-time temporal join, in tflo (one WASM call).
// `window_join_keyed` is the `keyed_window_join` combinator surfaced to JS.
// Compare against rxjs.mjs / xstate.mjs (which hand-roll the join).
//
// Output: O1 joins (deltaMs 2000); O2's payment at ts=9000 is out of window.
import init, { window_join_keyed } from "../../src/wasm/ops/tflo_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/ops/tflo_wasm_bg.wasm", import.meta.url)),
  ),
});

const orders = [
  { orderId: "O1", ts: 0, amount: 100 },
  { orderId: "O2", ts: 1000, amount: 50 },
];
const payments = [
  { orderId: "O1", ts: 2000 },
  { orderId: "O2", ts: 9000 },
];

const out = JSON.parse(
  window_join_keyed(
    JSON.stringify(orders),
    JSON.stringify(payments),
    JSON.stringify({ key: "orderId", ts: "ts", window: 3000 }),
  ),
);

console.log("tflo:", JSON.stringify(out));
const ok =
  out.length === 1 && out[0].left.orderId === "O1" && out[0].deltaMs === 2000;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
