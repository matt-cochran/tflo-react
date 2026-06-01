// SCENARIO 2 — Temporal windowed join (event-time).
// RxJS — the join semantics are ENTIRELY hand-rolled.
// `join`/`groupJoin` are NOT exported in RxJS 7 (rx.join === undefined). The
// event-time window check (`ev.ts >= o.ts && ev.ts <= o.ts + WINDOW`) and the
// keyed buffer (`Map`) are written by hand; RxJS supplies only merge/mergeMap
// plumbing. This omits watermarks, out-of-order, late-data policy, and state
// eviction (the Map grows unbounded) — adding those turns it into an engine.
//
// Ran: rxjs 7.8.2, Node. Output: [{"orderId":"O1","amount":100,"latencyMs":2000}] (CORRECT).
import { from, merge, map } from 'rxjs';
import { mergeMap, filter } from 'rxjs/operators';

const WINDOW = 3000;
const orders   = [{ orderId: 'O1', ts: 0, amount: 100 }, { orderId: 'O2', ts: 1000, amount: 50 }];
const payments = [{ orderId: 'O1', ts: 2000 }, { orderId: 'O2', ts: 9000 }];

const orders$   = from(orders).pipe(map(o => ({ kind: 'order',   ...o })));
const payments$ = from(payments).pipe(map(p => ({ kind: 'payment', ...p })));

const ordersById = new Map();                       // hand-rolled join state
const join$ = merge(orders$, payments$).pipe(
  mergeMap(ev => {
    if (ev.kind === 'order') { ordersById.set(ev.orderId, ev); return []; }
    const o = ordersById.get(ev.orderId);
    if (!o) return [];
    const within = ev.ts >= o.ts && ev.ts <= o.ts + WINDOW;   // EVENT-TIME window, by hand
    if (!within) return [];
    return [{ orderId: o.orderId, amount: o.amount, latencyMs: ev.ts - o.ts }];
  }),
  filter(Boolean),
);

const out = [];
join$.subscribe({ next: v => out.push(v), complete: () => console.log(JSON.stringify(out)) });
