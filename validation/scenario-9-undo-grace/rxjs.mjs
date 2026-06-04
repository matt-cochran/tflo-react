// SCENARIO 9 — Undo grace period (event-time negation within a window).
// THE EVENT-TIME-CORRECT RxJS version — but every RxJS time operator had to be
// abandoned. The 10000 ms window is `st.undoTs - st.actionTs`, written BY HAND.
// RxJS contributes only groupBy/reduce plumbing; zero RxJS time operators
// participate. And `reduce` only emits on completion — on an unbounded live
// stream this emits nothing until end-of-stream, so a real implementation must
// hand-roll a watermark (~30-50 LOC). See validation/README.md.
//
// Ran: rxjs 7.8.2, Node. Output: {"signal":"committed","id":"A2"} (CORRECT).
import { from } from 'rxjs';
import { groupBy, mergeMap, reduce, filter } from 'rxjs/operators';

const events = [
  { kind: 'action', id: 'A1', ts: 0 },
  { kind: 'undo',   id: 'A1', ts: 3000 },
  { kind: 'action', id: 'A2', ts: 0 },
];

const WINDOW = 10000;

from(events).pipe(
  groupBy(e => e.id),
  mergeMap(group$ => group$.pipe(
    reduce((st, e) => {                              // fold each action, reading payload ts
      if (e.kind === 'action') st.actionTs = e.ts;
      if (e.kind === 'undo')   st.undoTs   = e.ts;
      return st;
    }, { id: group$.key, actionTs: undefined, undoTs: undefined }),
    filter(st => st.actionTs !== undefined && (       // manual EVENT-TIME decision
      st.undoTs === undefined
        ? true
        : (st.undoTs - st.actionTs) > WINDOW
    )),
    mergeMap(st => from([{ signal: 'committed', id: st.id }]))
  ))
).subscribe(v => console.log(JSON.stringify(v)));
