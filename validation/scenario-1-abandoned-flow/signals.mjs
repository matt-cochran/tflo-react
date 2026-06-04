// SCENARIO 1 — Abandoned flow, with Signals (@preact/signals-core).
// The point: a signal gives you automatic reactivity over the CURRENT value, but
// it has NO concept of time. The event-time window decision is the exact same
// hand-written bookkeeping as react.mjs; the signal only holds the result. Signals
// contribute reactivity, ZERO temporal correctness.
//
// Output: [{"signal":"abandoned","flowId":"B"}]  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WINDOW = 5000;
const events = [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_started", flowId: "B", ts: 100 },
  { kind: "flow_completed", flowId: "A", ts: 2000 },
];

// A signal holds the raw event log; a computed derives the verdict. The temporal
// logic inside the computed is hand-written — signals do not help with it.
const log = signal(events);
const abandoned = computed(() => {
  const flows = new Map();
  for (const e of log.value) {
    const f = flows.get(e.flowId) ?? { startTs: undefined, completedTs: undefined };
    if (e.kind === "flow_started") f.startTs = e.ts;
    if (e.kind === "flow_completed") f.completedTs = e.ts;
    flows.set(e.flowId, f);
  }
  const res = [];
  for (const [flowId, f] of flows) {
    if (f.startTs === undefined) continue;
    if (f.completedTs === undefined || f.completedTs - f.startTs > WINDOW) // EVENT-TIME, by hand
      res.push({ signal: "abandoned", flowId });
  }
  return res;
});

const out = abandoned.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].flowId === "B";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
