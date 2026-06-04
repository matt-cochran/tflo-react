// SCENARIO 5 — Card-testing fraud, with XState v5 (best-effort).
// Per-card FSM: idle → watching_for_second_fail (on first fail) →
//   suppressed (on success) or fired (on second fail within window).
// XState contributes state machine plumbing; the event-time window check and
// interior-negation suppression are implemented as guard/action logic.
//
// Note: XState's `after`/delays use a wall-clock by default. Here we do NOT
// use `after` — instead, the event-time window is checked in a guard when the
// second fail arrives (`e.ts - ctx.firstFailTs <= WINDOW_MS`). No custom clock
// is needed because we never rely on XState's timer infrastructure.
//
// Expected output: { signal: "card_testing", card: "C1" }  (C2 suppressed)
import { createMachine, createActor, assign } from "xstate";

const WINDOW_MS = 60000;
const results = [];

// Per-card FSM
const cardMachine = createMachine({
  id: "card",
  initial: "idle",
  context: ({ input }) => ({ card: input.card, firstFailTs: null }),
  states: {
    idle: {
      on: {
        fail: {
          target: "watching",
          actions: assign({ firstFailTs: ({ event }) => event.ts }),
        },
      },
    },
    watching: {
      on: {
        // Interior-negation: success between fails → suppressed
        success: { target: "suppressed" },
        // Second fail within window → fired
        fail: [
          {
            guard: ({ context, event }) => event.ts - context.firstFailTs <= WINDOW_MS,
            target: "fired",
          },
          {
            // Outside window: restart from this fail
            target: "watching",
            actions: assign({ firstFailTs: ({ event }) => event.ts }),
          },
        ],
      },
    },
    suppressed: { type: "final" },
    fired: {
      type: "final",
      entry: ({ context }) => {
        results.push({ signal: "card_testing", card: context.card });
      },
    },
  },
});

// Router: spawn a per-card actor on first event for that card
const routerMachine = createMachine({
  id: "router",
  context: { actors: {} },
  on: {
    card_event: {
      actions: assign({
        actors: ({ context, event, spawn }) => {
          const { card, kind, ts } = event;
          let actor = context.actors[card];
          if (!actor) {
            actor = spawn(cardMachine, { input: { card } });
            actor.start();
          }
          actor.send({ type: kind, ts });
          return { ...context.actors, [card]: actor };
        },
      }),
    },
  },
});

const events = [
  { kind: "fail",    card: "C1", ts: 0 },
  { kind: "fail",    card: "C1", ts: 1000 },
  { kind: "fail",    card: "C2", ts: 0 },
  { kind: "success", card: "C2", ts: 500 },
  { kind: "fail",    card: "C2", ts: 1000 },
];

const router = createActor(routerMachine).start();
for (const e of events) {
  router.send({ type: "card_event", card: e.card, kind: e.kind, ts: e.ts });
}

// Allow synchronous state transitions to settle
await Promise.resolve();

console.log(JSON.stringify(results));
