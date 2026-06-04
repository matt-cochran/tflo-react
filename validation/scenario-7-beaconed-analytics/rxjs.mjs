// SCENARIO 7 — Beaconed analytics: event-time tumbling windows, with RxJS.
// Browser beacon batches arrive out of event-time order; the server must bucket
// each event by its OWN ts, not by arrival time.
//
// `bufferTime`/`windowTime` bucket by WALL-CLOCK (processing time). When all
// beacon events arrive synchronously they collapse into one bucket — wrong for
// session-window analytics. The correct approach is a hand-built watermark /
// sealing / lateness operator — ~20 LOC that RxJS gives you nothing for.
//
// Two runs:
//   lateness=0    -> late beacon ts=1000 DROPPED; [0,2000) shows count:1 sum:1  (WRONG)
//   lateness=2000 -> late beacon recovered;        [0,2000) shows count:2 sum:3  (matches EXPECTED)
//
// Ran: rxjs 7.8.2, Node.
import { Subject, from } from 'rxjs';
import { scan, mergeMap } from 'rxjs/operators';

const WIN = 2000;
const windowStartOf = (ts) => Math.floor(ts / WIN) * WIN;

// Hand-built event-time tumbling window operator for an unbounded beacon stream.
function eventTimeWindows(allowedLateness = 0) {
  return (source$) => source$.pipe(
    scan((st, e) => {
      st.emit = [];
      const start = windowStartOf(e.ts);
      if (start < st.sealedBelow) { st.dropped.push(e); return st; } // late & lost
      const b = st.buckets.get(start) || { windowStart: start, count: 0, sum: 0 };
      b.count++; b.sum += e.value;
      st.buckets.set(start, b);
      st.maxTs = Math.max(st.maxTs, e.ts);
      const watermark = st.maxTs - allowedLateness;
      for (const [s, bucket] of [...st.buckets].sort((a, c) => a[0] - c[0])) {
        if (s + WIN <= watermark) { st.emit.push(bucket); st.buckets.delete(s); st.sealedBelow = s + WIN; }
      }
      return st;
    }, { buckets: new Map(), maxTs: -Infinity, sealedBelow: -Infinity, emit: [], dropped: [] }),
    mergeMap((st) => from(st.emit)),
  );
}

// Beacon arrivals in flush/arrival order — NOT event-time order.
const beacons = [[0,1],[3000,10],[1000,2],[2000,20],[5000,100],[4000,40]];

function run(lateness, sentinelTs) {
  const subj = new Subject();
  const out = [];
  subj.pipe(eventTimeWindows(lateness)).subscribe((w) => out.push(w));
  beacons.forEach(([ts, value]) => subj.next({ ts, value }));
  subj.next({ ts: sentinelTs, value: 0 }); // watermark-advancing flush sentinel
  return out;
}

console.log('lateness=0    :', JSON.stringify(run(0,    7000)));
console.log('lateness=2000 :', JSON.stringify(run(2000, 9000)));
