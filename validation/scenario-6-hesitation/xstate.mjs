// SCENARIO 6 — Hesitation, with XState v5 (best-effort).
// Per-field FSM: idle → watching (on focus) → accumulates edits via assign →
//   fires hesitation if editCount >= MIN_EDITS within event-time window.
// XState contributes state machine plumbing; the event-time window check and
// edit count accumulation are implemented as guard/action logic — hand-written.
// No XState `after`/timer infrastructure is used: the window is checked in a
// guard (`e.ts - ctx.focusTs <= WINDOW`), so no custom clock is needed.
//
// F1 (focus@0, edit@500,1000,1500): 3 edits within 5 s → hesitation FIRES.
// F2 (focus@0, edit@500):           1 edit (< 2) → NO signal.
//
// Expected output: [{ signal: "hesitation", field: "F1" }]
import { createMachine, createActor, assign } from "xstate";

const WINDOW = 5000;
const MIN_EDITS = 2;
const results = [];

// Per-field hesitation FSM
const fieldMachine = createMachine({
  id: "field",
  initial: "idle",
  context: ({ input }) => ({ field: input.field, focusTs: null, editCount: 0 }),
  states: {
    idle: {
      on: {
        focus: {
          target: "watching",
          actions: assign({ focusTs: ({ event }) => event.ts, editCount: 0 }),
        },
      },
    },
    watching: {
      on: {
        // Re-focus resets the window
        focus: {
          target: "watching",
          actions: assign({ focusTs: ({ event }) => event.ts, editCount: 0 }),
        },
        edit: [
          {
            // Edit within window: accumulate
            guard: ({ context, event }) => event.ts - context.focusTs <= WINDOW,
            actions: assign({ editCount: ({ context }) => context.editCount + 1 }),
          },
          // Edit outside window: ignore (stay in watching)
        ],
      },
    },
  },
});

// Router: spawn a per-field actor on first event for that field
const routerMachine = createMachine({
  id: "router",
  context: { actors: {} },
  on: {
    field_event: {
      actions: assign({
        actors: ({ context, event, spawn }) => {
          const { field, kind, ts } = event;
          let actor = context.actors[field];
          if (!actor) {
            actor = spawn(fieldMachine, { input: { field } });
            actor.start();
          }
          actor.send({ type: kind, ts });
          return { ...context.actors, [field]: actor };
        },
      }),
    },
  },
});

const events = [
  { kind: "focus", field: "F1", ts: 0 },
  { kind: "edit",  field: "F1", ts: 500 },
  { kind: "edit",  field: "F1", ts: 1000 },
  { kind: "edit",  field: "F1", ts: 1500 },
  { kind: "focus", field: "F2", ts: 0 },
  { kind: "edit",  field: "F2", ts: 500 },
];

const router = createActor(routerMachine).start();
for (const e of events) {
  router.send({ type: "field_event", field: e.field, kind: e.kind, ts: e.ts });
}

// Allow synchronous state transitions to settle
await Promise.resolve();

// Collect results from actors' final context
const actors = router.getSnapshot().context.actors;
for (const [field, actor] of Object.entries(actors)) {
  const ctx = actor.getSnapshot().context;
  if (ctx.focusTs !== null && ctx.editCount >= MIN_EDITS) {
    results.push({ signal: "hesitation", field });
  }
}

console.log(JSON.stringify(results));
