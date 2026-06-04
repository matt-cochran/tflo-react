// SCENARIO 7 — Beaconed analytics: event-time tumbling windows, the plain-React
// way (no library). Browser beacon batches arrive out of event-time order; the
// late pageview (ts=1000 arriving after ts=3000) must still land in [0,2000).
//
// To get that correctness, you must hand-build a watermark + bucket map +
// allowed-lateness sealing. Those ~20 lines ARE a stream engine; React refs/state
// contribute nothing — they just store the data structure you had to write yourself.
// (bufferTime / setInterval are wall-clock and would bucket every beacon wrong.)
//
// Output: windows with the late beacon recovered  (self-asserted PASS).
const WIN = 2000;
const ALLOWED_LATENESS = 2000;

// Beacon arrivals in flush/arrival order — NOT event-time order.
const arrivals = [
  { ts: 0,    value: 1  },  // pageview  — session start
  { ts: 3000, value: 10 },  // interaction — arrives first in batch 2
  { ts: 1000, value: 2  },  // pageview  — LATE beacon, belongs in [0,2000)
  { ts: 2000, value: 20 },  // interaction
  { ts: 5000, value: 100 }, // interaction
  { ts: 4000, value: 40 },  // pageview
];

const windowStartOf = (ts) => Math.floor(ts / WIN) * WIN;

const buckets = new Map();
let maxTs = -Infinity;
let sealedBelow = -Infinity;
const emitted = [];

function drain() {
  const watermark = maxTs - ALLOWED_LATENESS;
  for (const [start, b] of [...buckets].sort((a, c) => a[0] - c[0])) {
    if (start + WIN <= watermark) { emitted.push(b); buckets.delete(start); sealedBelow = start + WIN; }
  }
}

for (const e of arrivals) {
  const start = windowStartOf(e.ts);
  if (start < sealedBelow) continue; // late & lost — beacon missed the lateness budget
  const b = buckets.get(start) ?? { windowStart: start, count: 0, sum: 0 };
  b.count++; b.sum += e.value;
  buckets.set(start, b);
  maxTs = Math.max(maxTs, e.ts);
  drain();
}
// end-of-stream flush (all remaining open windows emitted)
maxTs = Infinity; drain();

const out = emitted.sort((a, b) => a.windowStart - b.windowStart);
console.log("react:", JSON.stringify(out));
const w0 = out.find((w) => w.windowStart === 0);
const w2 = out.find((w) => w.windowStart === 2000);
const w4 = out.find((w) => w.windowStart === 4000);
const ok =
  w0 && w0.count === 2 && w0.sum === 3   &&
  w2 && w2.count === 2 && w2.sum === 30  &&
  w4 && w4.count === 2 && w4.sum === 140;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
