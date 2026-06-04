// SCENARIO 6 — Hesitation, with RxJS (best-effort).
// groupBy field → per-field scan that counts edits within 5000 ms of focus.
// RxJS contributes groupBy/scan plumbing; the event-time window check and the
// "≥2 edits after focus" rule are entirely hand-written bookkeeping.
// No RxJS time operators — all decisions are against event timestamps.
//
// F1 (focus@0, edit@500,1000,1500): 3 edits within 5 s → hesitation FIRES.
// F2 (focus@0, edit@500):           1 edit (< 2) → NO signal.
//
// Expected output: { signal: "hesitation", field: "F1" }
import { from } from "rxjs";
import { groupBy, mergeMap, scan, filter, last } from "rxjs/operators";

const WINDOW = 5000;
const MIN_EDITS = 2;

const events = [
  { kind: "focus", field: "F1", ts: 0 },
  { kind: "edit",  field: "F1", ts: 500 },
  { kind: "edit",  field: "F1", ts: 1000 },
  { kind: "edit",  field: "F1", ts: 1500 },
  { kind: "focus", field: "F2", ts: 0 },
  { kind: "edit",  field: "F2", ts: 500 },
];

from(events).pipe(
  groupBy((e) => e.field),
  mergeMap((group$) =>
    group$.pipe(
      // Per-field hesitation FSM via scan
      scan(
        (st, e) => {
          if (e.kind === "focus") {
            // Reset on each focus (re-focus resets the window)
            return { ...st, focusTs: e.ts, editCount: 0 };
          } else if (e.kind === "edit" && st.focusTs !== null) {
            if (e.ts - st.focusTs <= WINDOW) { // EVENT-TIME, by hand
              return { ...st, editCount: st.editCount + 1 };
            }
          }
          return st;
        },
        { field: group$.key, focusTs: null, editCount: 0 },
      ),
      last(), // take final state per field after all events
      filter((st) => st.focusTs !== null && st.editCount >= MIN_EDITS),
    ),
  ),
).subscribe((st) => {
  console.log(JSON.stringify({ signal: "hesitation", field: st.field }));
});
