// SCENARIO 6 — Hesitation, the plain-React way (no library).
// Moral equivalent of a `useReducer` + `useRef` holding per-field state:
// count edits that arrive within 5000 ms of the field's focus event.
// The temporal window check (editTs - focusTs <= WINDOW) is HAND-WRITTEN.
// React contributes zero to this correctness — it's pure bookkeeping.
//
// F1 (focus@0, edit@500,1000,1500): 3 edits within 5 s → hesitation FIRES.
// F2 (focus@0, edit@500):           1 edit (< 2) → NO signal.
//
// Expected: [{ signal: "hesitation", field: "F1" }]

const WINDOW = 5000;
const MIN_EDITS = 2;

const eventsByField = {
  F1: [
    { kind: "focus", field: "F1", ts: 0 },
    { kind: "edit",  field: "F1", ts: 500 },
    { kind: "edit",  field: "F1", ts: 1000 },
    { kind: "edit",  field: "F1", ts: 1500 },
  ],
  F2: [
    { kind: "focus", field: "F2", ts: 0 },
    { kind: "edit",  field: "F2", ts: 500 },
  ],
};

// Hand-rolled per-field bookkeeping (what a React component's useRef holds).
function analyzeField(field, events) {
  let focusTs = null;
  let editCount = 0;

  for (const e of events) {
    if (e.kind === "focus") {
      focusTs = e.ts;
      editCount = 0; // reset on re-focus
    } else if (e.kind === "edit" && focusTs !== null) {
      if (e.ts - focusTs <= WINDOW) {   // EVENT-TIME, by hand
        editCount++;
      }
    }
  }

  return focusTs !== null && editCount >= MIN_EDITS
    ? { signal: "hesitation", field }
    : null;
}

const out = [];
for (const [field, events] of Object.entries(eventsByField)) {
  const result = analyzeField(field, events);
  if (result) out.push(result);
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].signal === "hesitation" && out[0].field === "F1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
