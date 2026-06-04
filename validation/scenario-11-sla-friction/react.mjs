// SCENARIO 11 — SLA friction, the plain-React way (no library).
// This is the moral equivalent of a `useReducer` + `useRef` bookkeeping + a
// hand-computed event-time window — the logic a React component actually
// contains. It produces the RIGHT answer, but every bit of temporal correctness
// (the `stepTs - responseTs > WINDOW` decision) is HAND-WRITTEN. React
// contributes zero. The idiomatic `useEffect(() => setTimeout(...8000))` version
// is wall-clock and silently wrong for batched/replayed events.
//
// Output: [{"signal":"friction","id":"R2"}]  (self-asserted PASS).
const WINDOW = 8000;
const events = [
  { kind: "system_response", id: "R1", ts: 0 },
  { kind: "user_step",       id: "R1", ts: 3000 },
  { kind: "system_response", id: "R2", ts: 0 },
];

// Hand-rolled per-response bookkeeping (the "refs" a React component would hold).
const responses = new Map();
for (const e of events) {
  const r = responses.get(e.id) ?? { responseTs: undefined, stepTs: undefined };
  if (e.kind === "system_response") r.responseTs = e.ts;
  if (e.kind === "user_step")       r.stepTs     = e.ts;
  responses.set(e.id, r);
}

const out = [];
for (const [id, r] of responses) {
  if (r.responseTs === undefined) continue;
  const friction =
    r.stepTs === undefined || r.stepTs - r.responseTs > WINDOW; // EVENT-TIME, by hand
  if (friction) out.push({ signal: "friction", id });
}

console.log("react:", JSON.stringify(out));
const ok = out.length === 1 && out[0].id === "R2" && out[0].signal === "friction";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
