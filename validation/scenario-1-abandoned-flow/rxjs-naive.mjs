// SCENARIO 1 — Abandoned flow (event-time negation within a window).
// THE IDIOMATIC RxJS RECIPE — and it is WRONG for event-time.
//
// `timer(5000)` is WALL-CLOCK. It ignores the payload `ts` entirely, and
// because the source completes synchronously while the timers are still
// pending, `race` keeps the subscriptions alive and nothing is emitted at
// end-of-stream. Actual output: []   (expected: [{abandoned, B}]).
//
// Ran: rxjs 7.8.2, Node. Output: [] (WRONG).
import { from, race, timer } from 'rxjs';
import { groupBy, mergeMap, filter, map, take } from 'rxjs/operators';

const events = [
  { kind: 'flow_started',   flowId: 'A', ts: 0 },
  { kind: 'flow_started',   flowId: 'B', ts: 100 },
  { kind: 'flow_completed', flowId: 'A', ts: 2000 },
];

from(events).pipe(
  groupBy(e => e.flowId),
  mergeMap(group$ => {
    const started$   = group$.pipe(filter(e => e.kind === 'flow_started'),   take(1));
    const completed$ = group$.pipe(filter(e => e.kind === 'flow_completed'), take(1));
    return started$.pipe(
      mergeMap(start => race(
        completed$.pipe(map(() => null)),
        timer(5000).pipe(map(() => ({ signal: 'abandoned', flowId: start.flowId }))) // WALL CLOCK — wrong
      )),
      filter(x => x !== null)
    );
  })
).subscribe(v => console.log(JSON.stringify(v)));
