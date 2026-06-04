// SCENARIO 11 — SLA friction (event-time negation within a window).
// THE EVENT-TIME-CORRECT RxJS version — PASSES, but every RxJS time operator
// had to be abandoned. The 8000ms window is `st.stepTs - st.responseTs`,
// written BY HAND. RxJS contributes only groupBy/reduce plumbing; zero RxJS
// time operators participate. And `reduce` only emits on completion — on an
// unbounded live stream this emits nothing until end-of-stream, so a real
// implementation must hand-roll a watermark (~30-50 LOC).
//
// Ran: rxjs 7.x, Node. Output: {"signal":"friction","id":"R2"} (CORRECT).
import { from } from 'rxjs';
import { groupBy, mergeMap, reduce, filter } from 'rxjs/operators';

const events = [
  { kind: 'system_response', id: 'R1', ts: 0 },
  { kind: 'user_step',       id: 'R1', ts: 3000 },
  { kind: 'system_response', id: 'R2', ts: 0 },
];

const WINDOW = 8000;

from(events).pipe(
  groupBy(e => e.id),
  mergeMap(group$ => group$.pipe(
    reduce((st, e) => {                               // fold each response, reading payload ts
      if (e.kind === 'system_response') st.responseTs = e.ts;
      if (e.kind === 'user_step')       st.stepTs     = e.ts;
      return st;
    }, { id: group$.key, responseTs: undefined, stepTs: undefined }),
    filter(st => st.responseTs !== undefined && (     // manual EVENT-TIME decision
      st.stepTs === undefined
        ? true
        : (st.stepTs - st.responseTs) > WINDOW
    )),
    mergeMap(st => from([{ signal: 'friction', id: st.id }]))
  ))
).subscribe(v => console.log(JSON.stringify(v)));
