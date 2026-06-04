// SCENARIO 4 — Rage click, the plain-React way (no library).
// This is the moral equivalent of a `useReducer` + `useRef` holding per-target
// click history — the logic a React component actually contains. It produces the
// RIGHT answer, but ALL temporal correctness is HAND-WRITTEN: sliding the event-time
// window, counting clicks within 2000ms of the first click. React contributes zero.
//
// Rule: ≥ 5 clicks on the same target where clicks 2–5 all arrive within 2000ms
// of the FIRST click (matching tflo's times(4,4).within(2000) anchor semantics).
//
// Output: [{signal:"rage",target:"T1"}]   (self-asserted PASS).
const WINDOW = 2000;
const MIN_BURST = 5; // 1 when + 4 then

const allEvents = [
  // T1 — burst
  { kind: "click", target: "T1", ts: 0 },
  { kind: "click", target: "T1", ts: 100 },
  { kind: "click", target: "T1", ts: 200 },
  { kind: "click", target: "T1", ts: 300 },
  { kind: "click", target: "T1", ts: 400 },
  // T2 — spaced
  { kind: "click", target: "T2", ts: 0 },
  { kind: "click", target: "T2", ts: 5000 },
];

// Hand-rolled per-target bookkeeping (the "refs" a React component would hold).
// For each target we keep the anchor timestamp and count of clicks within the window.
const state = new Map(); // target → { anchorTs, count, fired }

const out = [];
for (const e of allEvents) {
  if (e.kind !== "click") continue;
  const s = state.get(e.target) ?? { anchorTs: null, count: 0, fired: false };

  if (s.anchorTs === null) {
    // First click — set anchor
    s.anchorTs = e.ts;
    s.count = 1;
  } else if (e.ts - s.anchorTs <= WINDOW) {
    // Within window of anchor — accumulate
    s.count += 1;
    if (!s.fired && s.count >= MIN_BURST) {
      out.push({ signal: "rage", target: e.target });
      s.fired = true;
    }
  } else {
    // Outside window — reset anchor to this click and start fresh count
    s.anchorTs = e.ts;
    s.count = 1;
    s.fired = false;
  }

  state.set(e.target, s);
}

console.log("react:", JSON.stringify(out));

const ok = out.length === 1 && out[0].signal === "rage" && out[0].target === "T1";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
