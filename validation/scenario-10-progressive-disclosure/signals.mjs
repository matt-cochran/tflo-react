// SCENARIO 10 — Progressive disclosure, with Signals (@preact/signals-core).
// Interior negation: two fails with no success between, within 30 000 ms event-time.
//
// A signal holds the raw event log. A computed derivation folds per-step state and
// applies the "no success between two fails" rule in a single pass. The interior-
// negation logic is entirely hand-written — signals contribute reactivity only.
// Compare: tflo expresses the same rule in a 4-line declarative pattern.
//
// Expected: [{signal:"show_help",step:"S1"}]  (self-asserted PASS)
import { signal, computed } from "@preact/signals-core";

const WINDOW = 30000;

const events = signal([
  { kind: "fail",    step: "S1", ts: 0 },
  { kind: "fail",    step: "S1", ts: 2000 },
  { kind: "fail",    step: "S2", ts: 0 },
  { kind: "success", step: "S2", ts: 1000 },
  { kind: "fail",    step: "S2", ts: 2000 },
]);

const helpSignals = computed(() => {
  // Per-step reducer: track (firstFailTs, successSeenAfterFirstFail).
  // Interior negation: a success between the first and second fail kills the partial.
  const steps = new Map();
  const out = [];

  for (const e of events.value) {
    const st = steps.get(e.step) ?? { firstFailTs: undefined, successSeen: false };

    if (e.kind === "fail") {
      if (st.firstFailTs === undefined) {
        st.firstFailTs = e.ts;
        st.successSeen = false;
      } else {
        const withinWindow = e.ts - st.firstFailTs <= WINDOW;
        if (withinWindow && !st.successSeen) {
          out.push({ signal: "show_help", step: e.step });
        }
        // Reset anchor for subsequent pairs.
        st.firstFailTs = e.ts;
        st.successSeen = false;
      }
    } else if (e.kind === "success") {
      if (st.firstFailTs !== undefined) {
        // Success kills the partial — mark and clear anchor.
        st.successSeen = true;
        st.firstFailTs = undefined;
      }
    }

    steps.set(e.step, st);
  }

  return out;
});

const out = helpSignals.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].signal === "show_help" && out[0].step === "S1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
