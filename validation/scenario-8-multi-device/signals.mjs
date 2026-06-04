// SCENARIO 8 — Multi-device onboarding journey, with Signals (@preact/signals-core).
// Signals hold the starts/completes and a computed derives the join — but the
// event-time window check and keyed buffer are the same hand-written logic as
// react.mjs. Signals = reactivity, not temporal correctness.
//
// Output: [{"userId":"U1","deltaMs":600000}]  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WINDOW = 1800000; // 30 minutes in ms

const starts = signal([
  { userId: "U1", ts: 0 },
  { userId: "U2", ts: 1000 },
]);
const completes = signal([
  { userId: "U1", ts: 600000 },
  { userId: "U2", ts: 3600000 },
]);

const joined = computed(() => {
  const byId = new Map(starts.value.map((s) => [s.userId, s]));
  const res = [];
  for (const c of completes.value) {
    const s = byId.get(c.userId);
    if (s && c.ts >= s.ts && c.ts <= s.ts + WINDOW) // EVENT-TIME window, by hand
      res.push({ userId: s.userId, deltaMs: c.ts - s.ts });
  }
  return res;
});

const out = joined.value;
console.log("signals:", JSON.stringify(out));
const ok =
  out.length === 1 &&
  out[0].userId === "U1" &&
  out[0].deltaMs === 600000;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
