// SCENARIO 10 — Progressive disclosure, RxJS (best-effort).
// Interior negation: two fails with no success between, within 30 000 ms event-time.
//
// RxJS has no interior-negation operator. The closest native approach is
// `window`/`buffer` + `filter`, but these operate on WALL-CLOCK time and cannot
// express "no success between two events in EVENT-time". We implement the full
// interior-negation state machine by hand using `scan` (fold), then filter.
//
// RxJS contributes: groupBy partitioning, scan folding, filter. It contributes
// ZERO towards the interior-negation rule itself — that is entirely hand-written
// state inside the scan accumulator, identical to react.mjs.
//
// Output: {"signal":"show_help","step":"S1"}
import { from } from "rxjs";
import { groupBy, mergeMap, scan, filter, map } from "rxjs/operators";

const WINDOW = 30000;

const events = [
  { kind: "fail",    step: "S1", ts: 0 },
  { kind: "fail",    step: "S1", ts: 2000 },
  { kind: "fail",    step: "S2", ts: 0 },
  { kind: "success", step: "S2", ts: 1000 },
  { kind: "fail",    step: "S2", ts: 2000 },
];

from(events).pipe(
  groupBy((e) => e.step),
  mergeMap((group$) =>
    group$.pipe(
      // Fold per-step state: track the first-fail anchor and the success-seen flag.
      // Emit a "fired" marker when interior-negation condition is satisfied.
      scan(
        (st, e) => {
          if (e.kind === "fail") {
            if (st.firstFailTs === undefined) {
              return { ...st, firstFailTs: e.ts, successSeen: false, fired: null };
            } else {
              const withinWindow = e.ts - st.firstFailTs <= WINDOW;
              if (withinWindow && !st.successSeen) {
                // Condition met — emit a signal.
                return { ...st, firstFailTs: e.ts, successSeen: false, fired: { signal: "show_help", step: group$.key } };
              }
              return { ...st, firstFailTs: e.ts, successSeen: false, fired: null };
            }
          } else if (e.kind === "success" && st.firstFailTs !== undefined) {
            // Success kills the partial.
            return { ...st, firstFailTs: undefined, successSeen: true, fired: null };
          }
          return { ...st, fired: null };
        },
        { firstFailTs: undefined, successSeen: false, fired: null },
      ),
      filter((st) => st.fired !== null),
      map((st) => st.fired),
    ),
  ),
).subscribe((v) => console.log(JSON.stringify(v)));
