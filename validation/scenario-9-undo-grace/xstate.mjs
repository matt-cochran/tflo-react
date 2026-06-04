// SCENARIO 9 — Undo grace period (event-time negation within a window).
// XState (v5) — but only after building a custom event-time clock.
// XState's `after`/delays use a wall-clock Clock by default. To get EVENT-time
// we implement `EventClock` and drive it manually from each event's `ts`
// (`clock.set(ev.ts)`), plus an end-of-stream flush. The per-action FSM is clean;
// the event-time/stream machinery is entirely hand-rolled — XState contributes
// none of it. (Note: `sendParent` from a final-state entry crashes in 5.32, so
// results are reported via a module-level array.)
//
// Ran: xstate 5.32.0, Node. Output: [{"signal":"committed","id":"A2"}] (CORRECT).
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

const WINDOW = 10000;
const results = [];

const actionMachine = createMachine({
  id: 'action',
  initial: 'waiting',
  context: ({ input }) => ({ id: input.id }),
  states: {
    waiting: { after: { [WINDOW]: { target: 'committed' } }, on: { undo: { target: 'undone' } } },
    committed: { type: 'final', entry: ({ context }) => { results.push({ signal: 'committed', id: context.id }); } },
    undone: { type: 'final' },
  },
});

const routerMachine = createMachine({
  id: 'router',
  context: { actions: {} },
  on: {
    action: {
      actions: assign({
        actions: ({ context, event, spawn }) => {
          const actor = spawn(actionMachine, { input: { id: event.id } });
          actor.start();
          return { ...context.actions, [event.id]: actor };
        },
      }),
    },
    undo: { actions: ({ context, event }) => { const a = context.actions[event.id]; if (a) a.send({ type: 'undo' }); } },
  },
});

const clock = new EventClock();
const router = createActor(routerMachine, { clock }).start();

const events = [
  { kind: 'action', id: 'A1', ts: 0 },
  { kind: 'undo',   id: 'A1', ts: 3000 },
  { kind: 'action', id: 'A2', ts: 0 },
];

for (const ev of events) { clock.set(ev.ts); router.send({ type: ev.kind, id: ev.id }); }
clock.set(events[events.length - 1].ts + WINDOW + 1); // end-of-stream flush

console.log(JSON.stringify(results));
