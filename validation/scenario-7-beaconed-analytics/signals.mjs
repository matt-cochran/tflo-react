// SCENARIO 7 — Beaconed analytics: event-time tumbling windows, with Signals
// (@preact/signals-core). A signal holds the beacon arrivals; a computed runs
// the SAME hand-built watermark/bucket/lateness engine as react.mjs. Signals
// give reactivity over the result — if new beacons are appended the windows
// recompute automatically — but the event-time correctness is entirely hand-written.
//
// The late pageview beacon (ts=1000 arriving after ts=3000) still lands in [0,2000)
// only because the watermark engine inside the computed allows it.
//
// Output: windows with the late beacon recovered  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WIN = 2000;
const ALLOWED_LATENESS = 2000;
const windowStartOf = (ts) => Math.floor(ts / WIN) * WIN;

// Beacon arrivals in flush/arrival order — NOT event-time order.
const arrivals = signal([
  { ts: 0,    value: 1  },  // pageview  — session start
  { ts: 3000, value: 10 },  // interaction — arrives first in batch 2
  { ts: 1000, value: 2  },  // pageview  — LATE beacon, belongs in [0,2000)
  { ts: 2000, value: 20 },  // interaction
  { ts: 5000, value: 100 }, // interaction
  { ts: 4000, value: 40 },  // pageview
]);

const windows = computed(() => {
  const buckets = new Map();
  let maxTs = -Infinity, sealedBelow = -Infinity;
  const emitted = [];
  const drain = (wm) => {
    for (const [start, b] of [...buckets].sort((a, c) => a[0] - c[0])) {
      if (start + WIN <= wm) { emitted.push(b); buckets.delete(start); sealedBelow = start + WIN; }
    }
  };
  for (const e of arrivals.value) {
    const start = windowStartOf(e.ts);
    if (start < sealedBelow) continue; // late & lost — beacon missed the lateness budget
    const b = buckets.get(start) ?? { windowStart: start, count: 0, sum: 0 };
    b.count++; b.sum += e.value;
    buckets.set(start, b);
    maxTs = Math.max(maxTs, e.ts);
    drain(maxTs - ALLOWED_LATENESS);
  }
  drain(Infinity);
  return emitted.sort((a, b) => a.windowStart - b.windowStart);
});

const out = windows.value;
console.log("signals:", JSON.stringify(out));
const w0 = out.find((w) => w.windowStart === 0);
const w2 = out.find((w) => w.windowStart === 2000);
const w4 = out.find((w) => w.windowStart === 4000);
const ok =
  w0 && w0.count === 2 && w0.sum === 3   &&
  w2 && w2.count === 2 && w2.sum === 30  &&
  w4 && w4.count === 2 && w4.sum === 140;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
