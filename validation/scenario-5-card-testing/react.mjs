// SCENARIO 5 — Card-testing fraud, the plain-React way (no library).
// Moral equivalent of a `useReducer` per card. The interior-negation rule
// ("no success between two fails") is HAND-WRITTEN: track a per-card state
// machine (idle → first_fail → suppressed|second_fail). React contributes zero
// temporal or negation semantics; every bit is explicit bookkeeping.
//
// The tflo engine encodes this in a single declarative clause:
//   .when(fail).notBetween(success).then(fail).within(60000)
// Here we must write the equivalent FSM by hand.
//
// Expected output: [{ signal: "card_testing", card: "C1" }]  (self-asserted PASS)

const WINDOW_MS = 60000;

const events = [
  { kind: "fail",    card: "C1", ts: 0 },
  { kind: "fail",    card: "C1", ts: 1000 },
  { kind: "fail",    card: "C2", ts: 0 },
  { kind: "success", card: "C2", ts: 500 },
  { kind: "fail",    card: "C2", ts: 1000 },
];

// Per-card hand-rolled state: track whether we have a pending first fail and
// whether a success has been seen since then (interior-negation bookkeeping).
// States: { firstFailTs: number|null, suppressed: boolean }
const cards = new Map();

for (const e of events) {
  const st = cards.get(e.card) ?? { firstFailTs: null, suppressed: false };

  if (e.kind === "fail") {
    if (st.firstFailTs === null) {
      // First fail: start watching
      st.firstFailTs = e.ts;
      st.suppressed = false;
    } else if (!st.suppressed && e.ts - st.firstFailTs <= WINDOW_MS) {
      // Second fail within window with no success between → signal
      st.fired = true;
    } else {
      // Either suppressed or outside window: restart from this fail
      st.firstFailTs = e.ts;
      st.suppressed = false;
      st.fired = false;
    }
  } else if (e.kind === "success" && st.firstFailTs !== null) {
    // Success between fails: kill the partial (interior negation)
    st.suppressed = true;
  }

  cards.set(e.card, st);
}

const out = [];
for (const [card, st] of cards) {
  if (st.fired) out.push({ signal: "card_testing", card });
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].signal === "card_testing" && out[0].card === "C1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
