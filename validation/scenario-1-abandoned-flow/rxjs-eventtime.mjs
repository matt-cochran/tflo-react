// SCENARIO 1 — Abandoned flow (event-time negation within a window).
// THE EVENT-TIME-CORRECT RxJS version — PASSES, but every RxJS time operator
// had to be abandoned. The 5000ms window is `st.completedTs - st.startTs`,
// written BY HAND. RxJS contributes only groupBy/reduce plumbing; zero RxJS
// time operators participate. And `reduce` only emits on completion — on an
// unbounded live stream this emits nothing until end-of-stream, so a real
// implementation must hand-roll a watermark (~30-50 LOC). See validation/README.md.
//
// Ran: rxjs 7.8.2, Node. Output: {"signal":"abandoned","flowId":"B"} (CORRECT).
import { from } from 'rxjs';
import { groupBy, mergeMap, reduce, filter } from 'rxjs/operators';

const events = [
  { kind: 'flow_started',   flowId: 'A', ts: 0 },
  { kind: 'flow_started',   flowId: 'B', ts: 100 },
  { kind: 'flow_completed', flowId: 'A', ts: 2000 },
];

const WINDOW = 5000;

from(events).pipe(
  groupBy(e => e.flowId),
  mergeMap(group$ => group$.pipe(
    reduce((st, e) => {                              // fold each flow, reading payload ts
      if (e.kind === 'flow_started')   st.startTs     = e.ts;
      if (e.kind === 'flow_completed') st.completedTs = e.ts;
      return st;
    }, { flowId: group$.key, startTs: undefined, completedTs: undefined }),
    filter(st => st.startTs !== undefined && (       // manual EVENT-TIME decision
      st.completedTs === undefined
        ? true
        : (st.completedTs - st.startTs) > WINDOW
    )),
    mergeMap(st => from([{ signal: 'abandoned', flowId: st.flowId }]))
  ))
).subscribe(v => console.log(JSON.stringify(v)));
