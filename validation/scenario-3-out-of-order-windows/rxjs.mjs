// SCENARIO 3 — Out-of-order / late-event tolerance (event-time tumbling windows).
// RxJS — proves bufferTime/windowTime are PROCESSING-TIME (wrong), and that the
// correct version is a hand-built watermark engine.
//
// `bufferTime`/`windowTime` bucket by wall-clock; on synchronous arrival every
// event lands in ONE bucket → wrong. The clean `groupBy+reduce` version only
// works because the array source COMPLETES (on a live Subject it emits nothing).
// The realistic unbounded version below is ~20 LOC of watermark/sealing/lateness
// — all of which RxJS gives you nothing for. The late event ts=1000 (arriving
// after ts=3000) only survives into [0,2000) with allowedLateness >= 2000.
//
// Ran: rxjs 7.8.2, Node.
//   lateness=0    -> [{windowStart:0,count:1,sum:1},...]      (late ts=1000 DROPPED)
//   lateness=2000 -> [{windowStart:0,count:2,sum:3},...]      (matches EXPECTED)
import { Subject, from } from 'rxjs';
import { scan, mergeMap } from 'rxjs/operators';

const WIN = 2000;
const windowStartOf = (ts) => Math.floor(ts / WIN) * WIN;

// Event-time tumbling windows with a watermark, on an UNBOUNDED stream.
function eventTimeWindows(allowedLateness = 0) {
  return (source$) => source$.pipe(
    scan((st, e) => {
      st.emit = [];
      const start = windowStartOf(e.ts);
      if (start < st.sealedBelow) { st.dropped.push(e); return st; }      // late & lost
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

function run(lateness, sentinelTs) {
  const subj = new Subject();
  const out = [];
  subj.pipe(eventTimeWindows(lateness)).subscribe((w) => out.push(w));
  [[0,1],[3000,10],[1000,2],[2000,20],[5000,100],[4000,40]].forEach(([ts, value]) => subj.next({ ts, value }));
  subj.next({ ts: sentinelTs, value: 0 }); // watermark-advancing flush sentinel
  return out;
}

console.log('lateness=0    :', JSON.stringify(run(0, 7000)));
console.log('lateness=2000 :', JSON.stringify(run(2000, 9000)));
