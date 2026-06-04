// SCENARIO 9 — Undo grace period, the plain-React way (no library).
// This is the moral equivalent of a `useReducer` + `useRef` bookkeeping + a
// hand-computed event-time window — the logic a React component actually
// contains. It produces the RIGHT answer, but every bit of temporal correctness
// (the `undoTs - actionTs < WINDOW` decision) is HAND-WRITTEN. React
// contributes zero. The idiomatic `useEffect(() => setTimeout(...10000))` version
// is wall-clock and silently wrong for batched/replayed events.
//
// Output: [{"signal":"committed","id":"A2"}]  (self-asserted PASS).
const WINDOW = 10000;
const events = [
  { kind: "action", id: "A1", ts: 0 },
  { kind: "undo",   id: "A1", ts: 3000 },
  { kind: "action", id: "A2", ts: 0 },
];

// Hand-rolled per-action bookkeeping (the "refs" a React component would hold).
const actions = new Map();
for (const e of events) {
  const a = actions.get(e.id) ?? { actionTs: undefined, undoTs: undefined };
  if (e.kind === "action") a.actionTs = e.ts;
  if (e.kind === "undo")   a.undoTs   = e.ts;
  actions.set(e.id, a);
}

const out = [];
for (const [id, a] of actions) {
  if (a.actionTs === undefined) continue;
  const committed =
    a.undoTs === undefined || a.undoTs - a.actionTs > WINDOW; // EVENT-TIME, by hand
  if (committed) out.push({ signal: "committed", id });
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].id === "A2" && out[0].signal === "committed";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
