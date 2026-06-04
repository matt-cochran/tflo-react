// SCENARIO 1 — Abandoned flow, the plain-React way (no library).
// This is the moral equivalent of a `useReducer` + `useRef` bookkeeping + a
// hand-computed event-time window — the logic a React component actually
// contains. It produces the RIGHT answer, but every bit of temporal correctness
// (the `completedTs - startTs > WINDOW` decision) is HAND-WRITTEN. React
// contributes zero. The idiomatic `useEffect(() => setTimeout(...5000))` version
// is wall-clock and silently wrong for batched/replayed events (see rxjs-naive.mjs).
//
// Output: [{"signal":"abandoned","flowId":"B"}]  (self-asserted PASS).
const WINDOW = 5000;
const events = [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_started", flowId: "B", ts: 100 },
  { kind: "flow_completed", flowId: "A", ts: 2000 },
];

// Hand-rolled per-flow bookkeeping (the "refs" a React component would hold).
const flows = new Map();
for (const e of events) {
  const f = flows.get(e.flowId) ?? { startTs: undefined, completedTs: undefined };
  if (e.kind === "flow_started") f.startTs = e.ts;
  if (e.kind === "flow_completed") f.completedTs = e.ts;
  flows.set(e.flowId, f);
}

const out = [];
for (const [flowId, f] of flows) {
  if (f.startTs === undefined) continue;
  const abandoned =
    f.completedTs === undefined || f.completedTs - f.startTs > WINDOW; // EVENT-TIME, by hand
  if (abandoned) out.push({ signal: "abandoned", flowId });
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].flowId === "B";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
