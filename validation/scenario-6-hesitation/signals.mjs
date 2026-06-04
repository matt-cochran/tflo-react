// SCENARIO 6 — Hesitation, with Signals (@preact/signals-core).
// A signal holds the raw event log per field; a computed derives the verdict.
// Signals give automatic reactivity over the CURRENT value, but have ZERO
// concept of time. The event-time window check is the same hand-written
// bookkeeping as react.mjs — signals contribute reactivity, zero temporal logic.
//
// F1 (focus@0, edit@500,1000,1500): 3 edits within 5 s → hesitation FIRES.
// F2 (focus@0, edit@500):           1 edit (< 2) → NO signal.
//
// Expected: [{ signal: "hesitation", field: "F1" }]
import { signal, computed } from "@preact/signals-core";

const WINDOW = 5000;
const MIN_EDITS = 2;

const allEvents = signal([
  // F1 — hesitates
  { kind: "focus", field: "F1", ts: 0 },
  { kind: "edit",  field: "F1", ts: 500 },
  { kind: "edit",  field: "F1", ts: 1000 },
  { kind: "edit",  field: "F1", ts: 1500 },
  // F2 — confident
  { kind: "focus", field: "F2", ts: 0 },
  { kind: "edit",  field: "F2", ts: 500 },
]);

// A computed derives hesitation signals from the log. All temporal logic is
// hand-written inside the computed — signals don't help with event-time windows.
const hesitations = computed(() => {
  // Group events by field, preserving insertion order.
  const byField = new Map();
  for (const e of allEvents.value) {
    if (!byField.has(e.field)) byField.set(e.field, []);
    byField.get(e.field).push(e);
  }

  const results = [];
  for (const [field, events] of byField) {
    let focusTs = null;
    let editCount = 0;
    for (const e of events) {
      if (e.kind === "focus") {
        focusTs = e.ts;
        editCount = 0;
      } else if (e.kind === "edit" && focusTs !== null) {
        if (e.ts - focusTs <= WINDOW) { // EVENT-TIME, by hand
          editCount++;
        }
      }
    }
    if (focusTs !== null && editCount >= MIN_EDITS) {
      results.push({ signal: "hesitation", field });
    }
  }
  return results;
});

const out = hesitations.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].signal === "hesitation" && out[0].field === "F1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
