// SCENARIO 1 — Abandoned flow (event-time negation within a window).
// XState (v5) — PASSES, but only after building a custom event-time clock.
// XState's `after`/delays use a wall-clock Clock by default. To get EVENT-time
// we implement `EventClock` and drive it manually from each event's `ts`
// (`clock.set(ev.ts)`), plus an end-of-stream flush. The per-flow FSM is clean;
// the event-time/stream machinery is entirely hand-rolled — XState contributes
// none of it. (Note: `sendParent` from a final-state entry crashes in 5.32, so
// results are reported via a module-level array.)
//
// Ran: xstate 5.32.0, Node. Output: [{"signal":"abandoned","flowId":"B"}] (CORRECT).
import { createMachine, createActor, assign } from 'xstate';

// Event-time clock: `now` is advanced manually from event timestamps, so
// `after(WINDOW)` means WINDOW ms of EVENT time, not real time.
class EventClock {
  constructor() { this.now = 0; this.timers = new Map(); this.nextId = 1; }
  setTimeout(fn, delay) { const id = this.nextId++; this.timers.set(id, { fireAt: this.now + delay, fn }); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  set(t) {
    this.now = t;
    const due = [...this.timers.entries()].filter(([, v]) => v.fireAt <= t).sort((a, b) => a[1].fireAt - b[1].fireAt);
    for (const [id, v] of due) { this.timers.delete(id); v.fn(); }
  }
}

const WINDOW = 5000;
const results = [];

const flowMachine = createMachine({
  id: 'flow',
  initial: 'waiting',
  context: ({ input }) => ({ flowId: input.flowId }),
  states: {
    waiting: { after: { [WINDOW]: { target: 'abandoned' } }, on: { completed: { target: 'completed' } } },
    abandoned: { type: 'final', entry: ({ context }) => { results.push({ signal: 'abandoned', flowId: context.flowId }); } },
    completed: { type: 'final' },
  },
});

const routerMachine = createMachine({
  id: 'router',
  context: { flows: {} },
  on: {
    flow_started: {
      actions: assign({
        flows: ({ context, event, spawn }) => {
          const actor = spawn(flowMachine, { input: { flowId: event.flowId } });
          actor.start();
          return { ...context.flows, [event.flowId]: actor };
        },
      }),
    },
    flow_completed: { actions: ({ context, event }) => { const a = context.flows[event.flowId]; if (a) a.send({ type: 'completed' }); } },
  },
});

const clock = new EventClock();
const router = createActor(routerMachine, { clock }).start();

const events = [
  { kind: 'flow_started',   flowId: 'A', ts: 0 },
  { kind: 'flow_started',   flowId: 'B', ts: 100 },
  { kind: 'flow_completed', flowId: 'A', ts: 2000 },
];

for (const ev of events) { clock.set(ev.ts); router.send({ type: ev.kind, flowId: ev.flowId }); }
clock.set(events[events.length - 1].ts + WINDOW + 1); // end-of-stream flush

console.log(JSON.stringify(results));
