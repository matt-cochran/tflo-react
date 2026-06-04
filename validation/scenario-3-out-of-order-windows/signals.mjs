// SCENARIO 3 — Out-of-order tumbling windows, with Signals (@preact/signals-core).
// A signal holds the arrivals; a computed runs the SAME hand-built watermark/bucket/
// lateness engine as react.mjs. Signals give reactivity over the result; the
// event-time correctness is entirely hand-written.
//
// Output: windows with the late event recovered  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WIN = 2000;
const ALLOWED_LATENESS = 2000;
const windowStartOf = (ts) => Math.floor(ts / WIN) * WIN;

const arrivals = signal([
  { ts: 0, value: 1 }, { ts: 3000, value: 10 }, { ts: 1000, value: 2 },
  { ts: 2000, value: 20 }, { ts: 5000, value: 100 }, { ts: 4000, value: 40 },
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
    if (start < sealedBelow) continue;
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
  w0 && w0.count === 2 && w0.sum === 3 &&
  w2 && w2.count === 2 && w2.sum === 30 &&
  w4 && w4.count === 2 && w4.sum === 140;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
