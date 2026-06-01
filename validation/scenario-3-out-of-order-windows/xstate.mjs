// SCENARIO 3 — Out-of-order / late-event tolerance (event-time tumbling windows).
// XState (v5) — VERDICT: the wrong tool. The machine adds zero value; this is a
// plain grouped reduce wearing a machine costume. Correctness comes entirely
// from one hand-written line: `Math.floor(event.ts / WINDOW) * WINDOW`. There is
// one meaningful state ("collecting") and every event self-transitions — the
// tell that the FSM abstraction is doing nothing. Real event-time windowing
// (watermarks, allowed-lateness, per-window firing) would require building a
// stream engine ON TOP of XState while fighting its wall-clock `after`.
//
// Ran: xstate 5.32.0, Node. Output matches EXPECTED (but the machine is inert).
import { createMachine, createActor, assign } from 'xstate';

const WINDOW = 2000;
const arrivals = [
  { ts: 0, value: 1 }, { ts: 3000, value: 10 }, { ts: 1000, value: 2 },
  { ts: 2000, value: 20 }, { ts: 5000, value: 100 }, { ts: 4000, value: 40 },
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
