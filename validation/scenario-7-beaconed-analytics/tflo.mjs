// SCENARIO 7 — Beaconed analytics: event-time tumbling windows over out-of-order
// beacon batches, in tflo (one WASM call). A browser SDK flushes pageview/interaction
// events in batches; arrival order ≠ event-time order. `tumbling_window` drives the
// engine's TumblingSumOp through the keyed-graph executor with OutOfOrderPolicy::Buffer,
// so the late beacon ts=1000 (arriving AFTER ts=3000) still lands in the correct
// event-time window [0, 2000) when allowedLatenessMs allows.
//
// Compare against react.mjs / signals.mjs (hand-built watermark engine) and
// rxjs.mjs / xstate.mjs (show the gap).
import init, { tumbling_window } from "../../src/wasm/ops/tflo_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/ops/tflo_wasm_bg.wasm", import.meta.url)),
  ),
});

// Beacon arrivals in flush/arrival order — NOT event-time order.
// Each event represents a pageview or interaction beacon payload.
const events = [
  { ts: 0,    value: 1  },  // pageview  — session start
  { ts: 3000, value: 10 },  // interaction — arrives first in batch 2
  { ts: 1000, value: 2  },  // pageview  — LATE beacon, belongs in [0,2000)
  { ts: 2000, value: 20 },  // interaction
  { ts: 5000, value: 100 }, // interaction
  { ts: 4000, value: 40 },  // pageview
];

const out = JSON.parse(
  tumbling_window(
    JSON.stringify(events),
    JSON.stringify({ windowMs: 2000, allowedLatenessMs: 2000 }),
  ),
);

console.log("tflo:", JSON.stringify(out));
const w0 = out.find((w) => w.windowStart === 0);
const w2 = out.find((w) => w.windowStart === 2000);
const w4 = out.find((w) => w.windowStart === 4000);
const ok =
  w0 && w0.count === 2 && w0.sum === 3   &&
  w2 && w2.count === 2 && w2.sum === 30  &&
  w4 && w4.count === 2 && w4.sum === 140;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
