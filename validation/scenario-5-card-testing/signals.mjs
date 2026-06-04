// SCENARIO 5 — Card-testing fraud, with Signals (@preact/signals-core).
// A signal holds the raw event log; a computed derives the verdict by running
// the same hand-written FSM as react.mjs. Signals contribute reactivity over
// the CURRENT event log value — zero temporal or interior-negation semantics.
// Every rule ("no success between two fails") is explicit hand-written code.
//
// Expected output: [{ signal: "card_testing", card: "C1" }]  (self-asserted PASS)
import { signal, computed } from "@preact/signals-core";

const WINDOW_MS = 60000;

const events = [
  { kind: "fail",    card: "C1", ts: 0 },
  { kind: "fail",    card: "C1", ts: 1000 },
  { kind: "fail",    card: "C2", ts: 0 },
  { kind: "success", card: "C2", ts: 500 },
  { kind: "fail",    card: "C2", ts: 1000 },
];

// A signal holds the raw event log; the computed re-derives on any change.
// The interior-negation logic inside the computed is hand-written — signals
// provide no temporal or sequencing primitives.
const log = signal(events);

const cardTesting = computed(() => {
  const cards = new Map();

  for (const e of log.value) {
    const st = cards.get(e.card) ?? { firstFailTs: null, suppressed: false, fired: false };

    if (e.kind === "fail") {
      if (st.firstFailTs === null) {
        st.firstFailTs = e.ts;
        st.suppressed = false;
      } else if (!st.suppressed && e.ts - st.firstFailTs <= WINDOW_MS) {
        st.fired = true;
      } else {
        // Restart from this fail (suppressed or timed out)
        st.firstFailTs = e.ts;
        st.suppressed = false;
        st.fired = false;
      }
    } else if (e.kind === "success" && st.firstFailTs !== null) {
      // Interior-negation kill: success between fails resets the partial
      st.suppressed = true;
    }

    cards.set(e.card, st);
  }

  const res = [];
  for (const [card, st] of cards) {
    if (st.fired) res.push({ signal: "card_testing", card });
  }
  return res;
});

const out = cardTesting.value;
console.log("signals:", JSON.stringify(out));
const ok = out.length === 1 && out[0].signal === "card_testing" && out[0].card === "C1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
