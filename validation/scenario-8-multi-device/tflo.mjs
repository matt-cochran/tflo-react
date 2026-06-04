// SCENARIO 8 — Multi-device onboarding journey, keyed event-time join in tflo.
// A user starts onboarding on one device and finishes on another.
// `window_join_keyed` joins onboarding_start to onboarding_complete when they
// share the same userId and the completion falls within a 30-minute event-time window.
//
// U1 completes at 600000 (10 min, inside window) → JOINED (deltaMs 600000).
// U2 completes at 3600000 (60 min, outside window) → NOT joined.
import init, { window_join_keyed } from "../../src/wasm/ops/tflo_wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await init({
  module_or_path: await readFile(
    fileURLToPath(new URL("../../src/wasm/ops/tflo_wasm_bg.wasm", import.meta.url)),
  ),
});

const starts = [
  { userId: "U1", ts: 0 },
  { userId: "U2", ts: 1000 },
];
const completes = [
  { userId: "U1", ts: 600000 },
  { userId: "U2", ts: 3600000 },
];

const WINDOW = 1800000; // 30 minutes in ms

const out = JSON.parse(
  window_join_keyed(
    JSON.stringify(starts),
    JSON.stringify(completes),
    JSON.stringify({ key: "userId", ts: "ts", window: WINDOW }),
  ),
);

console.log("tflo:", JSON.stringify(out));
const ok =
  out.length === 1 &&
  out[0].left.userId === "U1" &&
  out[0].deltaMs === 600000;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
