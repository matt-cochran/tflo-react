// SCENARIO 2 — Temporal windowed join, with Signals (@preact/signals-core).
// Signals hold the orders/payments and a computed derives the join — but the
// event-time window check and keyed buffer are the same hand-written logic as
// react.mjs. Signals = reactivity, not temporal correctness.
//
// Output: [{"orderId":"O1","amount":100,"latencyMs":2000}]  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WINDOW = 3000;
const orders = signal([
  { orderId: "O1", ts: 0, amount: 100 },
  { orderId: "O2", ts: 1000, amount: 50 },
]);
const payments = signal([
  { orderId: "O1", ts: 2000 },
  { orderId: "O2", ts: 9000 },
]);

const joined = computed(() => {
  const byId = new Map(orders.value.map((o) => [o.orderId, o]));
  const res = [];
  for (const p of payments.value) {
    const o = byId.get(p.orderId);
    if (o && p.ts >= o.ts && p.ts <= o.ts + WINDOW) // EVENT-TIME window, by hand
      res.push({ orderId: o.orderId, amount: o.amount, latencyMs: p.ts - o.ts });
  }
  return res;
});

const out = joined.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].orderId === "O1" && out[0].latencyMs === 2000;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
