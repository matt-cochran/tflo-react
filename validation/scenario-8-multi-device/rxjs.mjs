// SCENARIO 8 — Multi-device onboarding journey (event-time join).
// RxJS — the join semantics are ENTIRELY hand-rolled.
// `join`/`groupJoin` are NOT exported in RxJS 7 (rx.join === undefined). The
// event-time window check (`c.ts >= s.ts && c.ts <= s.ts + WINDOW`) and the
// keyed buffer (`Map`) are written by hand; RxJS supplies only merge/mergeMap
// plumbing. This omits watermarks, out-of-order, late-data policy, and state
// eviction (the Map grows unbounded) — adding those turns it into an engine.
//
// Ran: rxjs 7.8.2, Node. Output: [{"userId":"U1","deltaMs":600000}] (CORRECT).
import { from, merge, map } from 'rxjs';
import { mergeMap, filter } from 'rxjs/operators';

const WINDOW = 1800000; // 30 minutes in ms
const starts    = [{ userId: 'U1', ts: 0 },    { userId: 'U2', ts: 1000 }];
const completes = [{ userId: 'U1', ts: 600000 }, { userId: 'U2', ts: 3600000 }];

const starts$    = from(starts).pipe(map(s => ({ kind: 'start',    ...s })));
const completes$ = from(completes).pipe(map(c => ({ kind: 'complete', ...c })));

const startsById = new Map(); // hand-rolled join state
const join$ = merge(starts$, completes$).pipe(
  mergeMap(ev => {
    if (ev.kind === 'start') { startsById.set(ev.userId, ev); return []; }
    const s = startsById.get(ev.userId);
    if (!s) return [];
    const within = ev.ts >= s.ts && ev.ts <= s.ts + WINDOW; // EVENT-TIME window, by hand
    if (!within) return [];
    return [{ userId: s.userId, deltaMs: ev.ts - s.ts }];
  }),
  filter(Boolean),
);

const out = [];
join$.subscribe({ next: v => out.push(v), complete: () => console.log('rxjs:', JSON.stringify(out)) });
