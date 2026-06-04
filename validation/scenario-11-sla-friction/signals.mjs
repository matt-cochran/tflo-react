// SCENARIO 11 — SLA friction, with Signals (@preact/signals-core).
// The point: a signal gives you automatic reactivity over the CURRENT value, but
// it has NO concept of time. The event-time window decision is the exact same
// hand-written bookkeeping as react.mjs; the signal only holds the result. Signals
// contribute reactivity, ZERO temporal correctness.
//
// Output: [{"signal":"friction","id":"R2"}]  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WINDOW = 8000;
const events = [
  { kind: "system_response", id: "R1", ts: 0 },
  { kind: "user_step",       id: "R1", ts: 3000 },
  { kind: "system_response", id: "R2", ts: 0 },
];

// A signal holds the raw event log; a computed derives the verdict. The temporal
// logic inside the computed is hand-written — signals do not help with it.
const log = signal(events);
const friction = computed(() => {
  const responses = new Map();
  for (const e of log.value) {
    const r = responses.get(e.id) ?? { responseTs: undefined, stepTs: undefined };
    if (e.kind === "system_response") r.responseTs = e.ts;
    if (e.kind === "user_step")       r.stepTs     = e.ts;
    responses.set(e.id, r);
  }
  const res = [];
  for (const [id, r] of responses) {
    if (r.responseTs === undefined) continue;
    if (r.stepTs === undefined || r.stepTs - r.responseTs > WINDOW) // EVENT-TIME, by hand
      res.push({ signal: "friction", id });
  }
  return res;
});

const out = friction.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].id === "R2" && out[0].signal === "friction";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
