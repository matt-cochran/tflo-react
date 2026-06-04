// SCENARIO 5 — Card-testing fraud, with RxJS (best-effort).
// groupBy card → per-card scan that tracks interior-negation state by hand.
// RxJS contributes groupBy/scan plumbing; the "no success between two fails"
// rule is entirely hand-written bookkeeping. No RxJS time operators are used —
// all window decisions are made against event timestamps.
//
// Expected output: { signal: "card_testing", card: "C1" }  (C2 suppressed)
import { from } from "rxjs";
import { groupBy, mergeMap, scan, filter, last } from "rxjs/operators";

const WINDOW_MS = 60000;

const events = [
  { kind: "fail",    card: "C1", ts: 0 },
  { kind: "fail",    card: "C1", ts: 1000 },
  { kind: "fail",    card: "C2", ts: 0 },
  { kind: "success", card: "C2", ts: 500 },
  { kind: "fail",    card: "C2", ts: 1000 },
];

from(events).pipe(
  groupBy((e) => e.card),
  mergeMap((group$) =>
    group$.pipe(
      // Per-card interior-negation FSM via scan
      scan(
        (st, e) => {
          if (e.kind === "fail") {
            if (st.firstFailTs === null) {
              return { ...st, firstFailTs: e.ts, suppressed: false, fired: false };
            } else if (!st.suppressed && e.ts - st.firstFailTs <= WINDOW_MS) {
              return { ...st, fired: true };
            } else {
              // Restart from this fail
              return { ...st, firstFailTs: e.ts, suppressed: false, fired: false };
            }
          } else if (e.kind === "success" && st.firstFailTs !== null) {
            // Interior-negation: kill the partial
            return { ...st, suppressed: true };
          }
          return st;
        },
        { card: group$.key, firstFailTs: null, suppressed: false, fired: false },
      ),
      last(), // take final state per card after all events
      filter((st) => st.fired),
    ),
  ),
).subscribe((st) => {
  console.log(JSON.stringify({ signal: "card_testing", card: st.card }));
});
