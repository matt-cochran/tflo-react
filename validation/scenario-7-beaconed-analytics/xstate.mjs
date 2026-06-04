// SCENARIO 7 — Beaconed analytics: event-time tumbling windows, with XState (v5).
// VERDICT: the wrong tool. The machine adds zero value for this problem.
//
// Every beacon event self-transitions in state "collecting" — a tell that the FSM
// abstraction does nothing. The only meaningful logic is the single line:
//   `Math.floor(event.ts / WINDOW) * WINDOW`
// which is a plain computation, not a state machine concern. Real event-time
// windowing (watermarks, allowed-lateness, per-window firing on an unbounded
// stream) would require building a stream engine ON TOP of XState while fighting
// its wall-clock `after` delays.
//
// Because the test array is synchronously consumed in full before FLUSH, the
// machine happens to produce the correct buckets — but it cannot handle a live
// beacon stream or enforce lateness budgets without external bookkeeping that
// renders the machine inert.
//
// Ran: xstate 5.32.0, Node.
import { createMachine, createActor, assign } from 'xstate';

const WINDOW = 2000;

// Beacon arrivals in flush/arrival order — NOT event-time order.
const arrivals = [
  { ts: 0,    value: 1  },  // pageview  — session start
  { ts: 3000, value: 10 },  // interaction — arrives first in batch 2
  { ts: 1000, value: 2  },  // pageview  — LATE beacon, would be lost on live stream
  { ts: 2000, value: 20 },  // interaction
  { ts: 5000, value: 100 }, // interaction
  { ts: 4000, value: 40 },  // pageview
];

const machine = createMachine({
  context: { buckets: new Map(), results: [] },
  initial: 'collecting',
  states: {
    collecting: {
      on: {
        EVENT: {
          actions: assign(({ context, event }) => {
            const windowStart = Math.floor(event.ts / WINDOW) * WINDOW; // <-- the whole trick
            const b = context.buckets.get(windowStart) ?? { count: 0, sum: 0 };
            b.count += 1; b.sum += event.value;
            context.buckets.set(windowStart, b);
            return { buckets: context.buckets };
          }),
        },
        FLUSH: {
          target: 'done',
          actions: assign(({ context }) => ({
            results: [...context.buckets.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([windowStart, { count, sum }]) => ({ windowStart, count, sum })),
          })),
        },
      },
    },
    done: { type: 'final' },
  },
});

const actor = createActor(machine); actor.start();
for (const ev of arrivals) actor.send({ type: 'EVENT', ...ev });
actor.send({ type: 'FLUSH' });

console.log(JSON.stringify(actor.getSnapshot().context.results));
