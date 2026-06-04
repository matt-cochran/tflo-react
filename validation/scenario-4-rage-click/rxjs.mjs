// SCENARIO 4 — Rage click, with RxJS.
// Uses `bufferTime` in event-time (simulated via a custom scheduler) to collect
// clicks per target within a 2000ms event-time window, then tests if ≥ 5 clicks
// arrived. RxJS's `bufferTime` is wall-clock by default — to get event-time we
// use `bufferCount` + manual grouping instead, since there is no first-class
// event-time scheduler in RxJS without a custom implementation.
//
// Approach: group events by target using `groupBy`, then for each group detect a
// burst by checking if ≥ MIN_BURST clicks arrive where clicks 2–N all fall within
// WINDOW ms of the first click in the group's current "anchor window".
//
// Output: [{signal:"rage",target:"T1"}] (best-effort — prints result).
import { from, groupBy, mergeMap, scan, filter, map, toArray } from "rxjs";

const WINDOW = 2000;
const MIN_BURST = 5;

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

const results = [];

from(allEvents).pipe(
  filter((e) => e.kind === "click"),
  groupBy((e) => e.target),
  mergeMap((group$) =>
    group$.pipe(
      // Accumulate per-target anchor-based state
      scan(
        (acc, e) => {
          if (acc.anchorTs === null) {
            return { anchorTs: e.ts, count: 1, fired: false, target: e.target, emit: null };
          } else if (e.ts - acc.anchorTs <= WINDOW) {
            const count = acc.count + 1;
            const fire = !acc.fired && count >= MIN_BURST;
            return {
              anchorTs: acc.anchorTs,
              count,
              fired: acc.fired || fire,
              target: e.target,
              emit: fire ? { signal: "rage", target: e.target } : null,
            };
          } else {
            // Reset anchor
            return { anchorTs: e.ts, count: 1, fired: false, target: e.target, emit: null };
          }
        },
        { anchorTs: null, count: 0, fired: false, target: group$.key, emit: null },
      ),
      filter((s) => s.emit !== null),
      map((s) => s.emit),
    ),
  ),
  toArray(),
).subscribe((arr) => {
  for (const r of arr) results.push(r);
});

console.log("rxjs:", JSON.stringify(results));
