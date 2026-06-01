// SCENARIO 3 — Event-time tumbling windows with out-of-order tolerance, in
// tflo (one WASM call). `tumbling_window` drives the engine's TumblingSumOp
// through the keyed-graph executor with OutOfOrderPolicy::Buffer. Compare
// against rxjs.mjs (hand-built watermark engine) / xstate.mjs (wrong tool).
//
// The claim: the late event ts=1000 (arriving AFTER ts=3000) still lands in
// the [0,2000) event-time window when lateness allows.
import init, { tumbling_window } from "../../src/wasm/ops/tflo_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/ops/tflo_wasm_bg.wasm", import.meta.url)),
  ),
});

// Arrival order is NOT timestamp order.
const events = [
  { ts: 0, value: 1 },
  { ts: 3000, value: 10 },
  { ts: 1000, value: 2 }, // late: belongs in [0,2000)
  { ts: 2000, value: 20 },
  { ts: 5000, value: 100 },
  { ts: 4000, value: 40 },
];

const out = JSON.parse(
  tumbling_window(JSON.stringify(events), JSON.stringify({ windowMs: 2000, allowedLatenessMs: 2000 })),
);

console.log("tflo:", JSON.stringify(out));
const w0 = out.find((w) => w.windowStart === 0);
const w2 = out.find((w) => w.windowStart === 2000);
const w4 = out.find((w) => w.windowStart === 4000);
const ok =
  w0 && w0.count === 2 && w0.sum === 3 &&
  w2 && w2.count === 2 && w2.sum === 30 &&
  w4 && w4.count === 2 && w4.sum === 140;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
