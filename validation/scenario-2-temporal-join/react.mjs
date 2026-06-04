// SCENARIO 2 — Temporal windowed join, the plain-React way (no library).
// The keyed join buffer (Map) and the event-time window check are hand-rolled —
// exactly the state a React component would keep in refs. Correct output, zero
// temporal help from the framework. No watermark/eviction/late-data (Map grows).
//
// Output: [{"orderId":"O1","amount":100,"latencyMs":2000}]  (self-asserted PASS).
const WINDOW = 3000;
const orders = [
  { orderId: "O1", ts: 0, amount: 100 },
  { orderId: "O2", ts: 1000, amount: 50 },
];
const payments = [
  { orderId: "O1", ts: 2000 },
  { orderId: "O2", ts: 9000 },
];

const ordersById = new Map(); // hand-rolled join state
for (const o of orders) ordersById.set(o.orderId, o);

const out = [];
for (const p of payments) {
  const o = ordersById.get(p.orderId);
  if (!o) continue;
  if (p.ts >= o.ts && p.ts <= o.ts + WINDOW) // EVENT-TIME window, by hand
    out.push({ orderId: o.orderId, amount: o.amount, latencyMs: p.ts - o.ts });
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].orderId === "O1" && out[0].latencyMs === 2000;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
