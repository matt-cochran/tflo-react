// SCENARIO 3 — Out-of-order tumbling windows, the plain-React way (no library).
// To get the late event (ts=1000 after ts=3000) into [0,2000), you must hand-build
// a watermark + bucket map + allowed-lateness sealing. That ~20 lines IS a stream
// engine; React/refs contribute nothing. (bufferTime/setInterval are wall-clock and
// would bucket everything wrong — see rxjs.mjs.)
//
// Output: windows with the late event recovered  (self-asserted PASS).
const WIN = 2000;
const ALLOWED_LATENESS = 2000;
const arrivals = [
  { ts: 0, value: 1 }, { ts: 3000, value: 10 }, { ts: 1000, value: 2 },
  { ts: 2000, value: 20 }, { ts: 5000, value: 100 }, { ts: 4000, value: 40 },
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
  if (start < sealedBelow) continue; // late & lost
  const b = buckets.get(start) ?? { windowStart: start, count: 0, sum: 0 };
  b.count++; b.sum += e.value;
  buckets.set(start, b);
  maxTs = Math.max(maxTs, e.ts);
  drain();
}
// end-of-stream flush
maxTs = Infinity; drain();

const out = emitted.sort((a, b) => a.windowStart - b.windowStart);
console.log("react:", JSON.stringify(out));
const w0 = out.find((w) => w.windowStart === 0);
const w2 = out.find((w) => w.windowStart === 2000);
const w4 = out.find((w) => w.windowStart === 4000);
const ok =
  w0 && w0.count === 2 && w0.sum === 3 &&
  w2 && w2.count === 2 && w2.sum === 30 &&
  w4 && w4.count === 2 && w4.sum === 140;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
