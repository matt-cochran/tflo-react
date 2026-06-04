// SCENARIO 10 — Progressive disclosure, the plain-React way (no library).
// This is the moral equivalent of a `useReducer` + `useRef` bookkeeping pattern —
// the logic a React component must contain to express interior negation. Every bit
// of the "no success between two fails" invariant is HAND-WRITTEN. React contributes
// zero temporal semantics; the app author writes the state machine from scratch.
//
// The interior-negation condition ("no success between the two fails") requires
// tracking whether ANY success occurred after the first fail. A terminal `notThen`
// approach cannot express this — it can only say "no success ever after fail@0",
// which would suppress S1 too if a success comes later.
//
// Expected: [{signal:"show_help",step:"S1"}]  (self-asserted PASS)

const WINDOW = 30000;

const allEvents = [
  { kind: "fail",    step: "S1", ts: 0 },
  { kind: "fail",    step: "S1", ts: 2000 },
  { kind: "fail",    step: "S2", ts: 0 },
  { kind: "success", step: "S2", ts: 1000 },
  { kind: "fail",    step: "S2", ts: 2000 },
];

// Per-step state: track the last open first-fail and whether a success
// has been seen since it. When a second fail arrives, check: (a) is it
// within WINDOW of the first, and (b) was there no success in between?
const steps = new Map(); // stepId → { firstFailTs, successSeenAfterFirstFail }

const out = [];

for (const e of allEvents) {
  const st = steps.get(e.step) ?? { firstFailTs: undefined, successSeen: false };

  if (e.kind === "fail") {
    if (st.firstFailTs === undefined) {
      // Start tracking: record the first fail.
      st.firstFailTs = e.ts;
      st.successSeen = false;
    } else {
      // Second (or later) fail: check interior-negation condition.
      const withinWindow = e.ts - st.firstFailTs <= WINDOW;
      if (withinWindow && !st.successSeen) {
        out.push({ signal: "show_help", step: e.step });
      }
      // Reset so subsequent pairs can be detected independently.
      st.firstFailTs = e.ts;
      st.successSeen = false;
    }
  } else if (e.kind === "success") {
    // A success kills the pending partial — mark it so the next fail is suppressed.
    if (st.firstFailTs !== undefined) {
      st.successSeen = true;
      // The first-fail anchor is no longer valid (partial killed).
      st.firstFailTs = undefined;
    }
  }

  steps.set(e.step, st);
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].signal === "show_help" && out[0].step === "S1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
