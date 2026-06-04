// SCENARIO 11 — SLA friction (event-time negation within a window).
// XState (v5) — PASSES, but only after building a custom event-time clock.
// XState's `after`/delays use a wall-clock Clock by default. To get EVENT-time
// we implement `EventClock` and drive it manually from each event's `ts`
// (`clock.set(ev.ts)`), plus an end-of-stream flush. The per-response FSM is clean;
// the event-time/stream machinery is entirely hand-rolled — XState contributes
// none of it.
//
// Ran: xstate 5.x, Node. Output: [{"signal":"friction","id":"R2"}] (CORRECT).
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

const WINDOW = 8000;
const results = [];

const responseMachine = createMachine({
  id: 'response',
  initial: 'waiting',
  context: ({ input }) => ({ responseId: input.responseId }),
  states: {
    waiting: { after: { [WINDOW]: { target: 'friction' } }, on: { user_step: { target: 'resolved' } } },
    friction: { type: 'final', entry: ({ context }) => { results.push({ signal: 'friction', id: context.responseId }); } },
    resolved: { type: 'final' },
  },
});

const routerMachine = createMachine({
  id: 'router',
  context: { responses: {} },
  on: {
    system_response: {
      actions: assign({
        responses: ({ context, event, spawn }) => {
          const actor = spawn(responseMachine, { input: { responseId: event.id } });
          actor.start();
          return { ...context.responses, [event.id]: actor };
        },
      }),
    },
    user_step: { actions: ({ context, event }) => { const a = context.responses[event.id]; if (a) a.send({ type: 'user_step' }); } },
  },
});

const clock = new EventClock();
const router = createActor(routerMachine, { clock }).start();

const events = [
  { kind: 'system_response', id: 'R1', ts: 0 },
  { kind: 'user_step',       id: 'R1', ts: 3000 },
  { kind: 'system_response', id: 'R2', ts: 0 },
];

for (const ev of events) { clock.set(ev.ts); router.send({ type: ev.kind, id: ev.id }); }
clock.set(events[events.length - 1].ts + WINDOW + 1); // end-of-stream flush

console.log(JSON.stringify(results));
