// SCENARIO 9 — Undo grace period, with Signals (@preact/signals-core).
// The point: a signal gives you automatic reactivity over the CURRENT value, but
// it has NO concept of time. The event-time window decision is the exact same
// hand-written bookkeeping as react.mjs; the signal only holds the result. Signals
// contribute reactivity, ZERO temporal correctness.
//
// Output: [{"signal":"committed","id":"A2"}]  (self-asserted PASS).
import { signal, computed } from "@preact/signals-core";

const WINDOW = 10000;
const events = [
  { kind: "action", id: "A1", ts: 0 },
  { kind: "undo",   id: "A1", ts: 3000 },
  { kind: "action", id: "A2", ts: 0 },
];

// A signal holds the raw event log; a computed derives the verdict. The temporal
// logic inside the computed is hand-written — signals do not help with it.
const log = signal(events);
const committed = computed(() => {
  const actions = new Map();
  for (const e of log.value) {
    const a = actions.get(e.id) ?? { actionTs: undefined, undoTs: undefined };
    if (e.kind === "action") a.actionTs = e.ts;
    if (e.kind === "undo")   a.undoTs   = e.ts;
    actions.set(e.id, a);
  }
  const res = [];
  for (const [id, a] of actions) {
    if (a.actionTs === undefined) continue;
    if (a.undoTs === undefined || a.undoTs - a.actionTs > WINDOW) // EVENT-TIME, by hand
      res.push({ signal: "committed", id });
  }
  return res;
});

const out = committed.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].id === "A2" && out[0].signal === "committed";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
