// SCENARIO 10 — Progressive disclosure, XState v5 (best-effort).
// Interior negation: two fails with no success between, within 30 000 ms event-time.
//
// XState can express per-entity FSMs cleanly, but interior negation requires an
// explicit "poisoned" state: after the first fail the FSM must accept a success
// event that transitions it back to "idle" (partial killed), or a second fail that
// fires the signal. The event-time window is still hand-driven: XState's `after`
// uses a wall-clock by default; we inject an EventClock (same technique as
// scenario-1/xstate.mjs) to make the delay event-time-accurate.
//
// The FSM correctly suppresses S2 because the success transitions the machine from
// "awaiting_second_fail" → "idle", discarding the first-fail anchor.
//
// Output: {"signal":"show_help","step":"S1"}
import { createMachine, createActor, assign } from "xstate";

const WINDOW = 30000;

// Event-time clock: advance `now` manually from each event's ts.
class EventClock {
  constructor() { this.now = 0; this.timers = new Map(); this.nextId = 1; }
  setTimeout(fn, delay) {
    const id = this.nextId++;
    this.timers.set(id, { fireAt: this.now + delay, fn });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  set(t) {
    this.now = t;
    const due = [...this.timers.entries()]
      .filter(([, v]) => v.fireAt <= t)
      .sort((a, b) => a[1].fireAt - b[1].fireAt);
    for (const [id, v] of due) { this.timers.delete(id); v.fn(); }
  }
}

const results = [];

// Per-step FSM:
//   idle → (fail) → awaiting_second_fail
//   awaiting_second_fail → (success) → idle         [partial killed]
//   awaiting_second_fail → (fail within WINDOW) → done [FIRES]
//   awaiting_second_fail → (after WINDOW) → idle    [window expired]
const stepMachine = createMachine({
  id: "step",
  initial: "idle",
  context: ({ input }) => ({ step: input.step, firstFailTs: undefined }),
  states: {
    idle: {
      on: {
        fail: {
          target: "awaiting_second_fail",
          actions: assign({ firstFailTs: ({ event }) => event.ts }),
        },
      },
    },
    awaiting_second_fail: {
      // Window guard: if no second fail arrives within WINDOW, drop back to idle.
      after: {
        [WINDOW]: { target: "idle", actions: assign({ firstFailTs: undefined }) },
      },
      on: {
        // A success in between: kill the partial.
        success: {
          target: "idle",
          actions: assign({ firstFailTs: undefined }),
        },
        // A second fail arrives within the open window (timer still running).
        fail: {
          target: "done",
        },
      },
    },
    done: {
      type: "final",
      entry: ({ context }) => {
        results.push({ signal: "show_help", step: context.step });
      },
    },
  },
});

// Router: one actor per step.
const routerMachine = createMachine({
  id: "router",
  context: { actors: {} },
  on: {
    fail: {
      actions: assign({
        actors: ({ context, event, spawn }) => {
          let actor = context.actors[event.step];
          if (!actor) {
            actor = spawn(stepMachine, { input: { step: event.step } });
            actor.start();
          }
          actor.send({ type: "fail", ts: event.ts });
          return { ...context.actors, [event.step]: actor };
        },
      }),
    },
    success: {
      actions: ({ context, event }) => {
        const actor = context.actors[event.step];
        if (actor) actor.send({ type: "success", ts: event.ts });
      },
    },
  },
});

const clock = new EventClock();
const router = createActor(routerMachine, { clock }).start();

const events = [
  { kind: "fail",    step: "S1", ts: 0 },
  { kind: "fail",    step: "S1", ts: 2000 },
  { kind: "fail",    step: "S2", ts: 0 },
  { kind: "success", step: "S2", ts: 1000 },
  { kind: "fail",    step: "S2", ts: 2000 },
];

for (const ev of events) {
  clock.set(ev.ts);
  router.send({ type: ev.kind, step: ev.step, ts: ev.ts });
}

// Flush: advance clock past the window to expire any pending timers.
clock.set(events[events.length - 1].ts + WINDOW + 1);

console.log(JSON.stringify(results));
