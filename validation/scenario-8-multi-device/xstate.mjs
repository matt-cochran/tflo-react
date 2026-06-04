// SCENARIO 8 — Multi-device onboarding journey (event-time join).
// XState (v5) — runs correctly, but a small stream engine was written ALONGSIDE
// XState: the virtual clock, the event-time timeline merge, the WINDOW_CLOSED
// ticks, and the open-start routing/bookkeeping are all hand-rolled. The clean
// part (per-user open→joined/expired FSM with a window guard) is ~1% of the
// problem; the temporal-join essence is yours to build.
//
// Ran: xstate 5.32.0, Node. Output: [{"userId":"U1","deltaMs":600000}] (CORRECT).
import { createMachine, createActor, assign, sendParent } from 'xstate';

const starts    = [{ userId: 'U1', ts: 0 },    { userId: 'U2', ts: 1000 }];
const completes = [{ userId: 'U1', ts: 600000 }, { userId: 'U2', ts: 3600000 }];
const WINDOW = 1800000; // 30 minutes in ms
const results = [];

// Per-user actor: awaits a completion, guards on EVENT-TIME window, self-finalizes.
const startMachine = createMachine({
  id: 'start',
  context: ({ input }) => ({ start: input }),
  initial: 'open',
  states: {
    open: {
      on: {
        COMPLETE: [
          {
            guard: ({ context, event }) =>
              event.complete.userId === context.start.userId &&
              event.complete.ts >= context.start.ts &&
              event.complete.ts <= context.start.ts + WINDOW,
            actions: sendParent(({ context, event }) => ({
              type: 'JOIN',
              result: { userId: context.start.userId, deltaMs: event.complete.ts - context.start.ts },
            })),
            target: 'joined',
          },
          { guard: ({ context, event }) => event.complete.userId === context.start.userId, target: 'expired' },
        ],
        WINDOW_CLOSED: { target: 'expired' },
      },
    },
    joined:  { type: 'final' },
    expired: { type: 'final' },
  },
});

// Coordinator: spawns one actor per start, routes completions, advances virtual clock.
const coordinator = createMachine({
  id: 'join',
  context: { children: {} },
  initial: 'running',
  states: {
    running: {
      on: {
        SPAWN_START: {
          actions: assign({
            children: ({ context, event, spawn }) => ({
              ...context.children,
              [event.start.userId]: spawn(startMachine, { id: `start-${event.start.userId}`, input: event.start }),
            }),
          }),
        },
        COMPLETE: {
          actions: ({ context, event }) => {
            const child = context.children[event.complete.userId];
            if (child && child.getSnapshot().status === 'active') child.send({ type: 'COMPLETE', complete: event.complete });
          },
        },
        TICK: {
          actions: ({ context, event }) => {
            for (const child of Object.values(context.children)) {
              if (child.getSnapshot().status !== 'active') continue;
              const start = child.getSnapshot().context.start;
              if (event.now > start.ts + WINDOW) child.send({ type: 'WINDOW_CLOSED' });
            }
          },
        },
        JOIN: { actions: ({ event }) => results.push(event.result) },
      },
    },
  },
});

const actor = createActor(coordinator).start();
for (const start of starts) actor.send({ type: 'SPAWN_START', start });

// Driver: merge streams by EVENT-TIME and hand-advance the clock.
const timeline = [];
for (const c of completes) timeline.push({ kind: 'complete', ts: c.ts, complete: c });
for (const s of starts) timeline.push({ kind: 'tick', ts: s.ts + WINDOW + 1 });
timeline.sort((a, b) => a.ts - b.ts);

for (const ev of timeline) {
  actor.send({ type: 'TICK', now: ev.ts });
  if (ev.kind === 'complete') actor.send({ type: 'COMPLETE', complete: ev.complete });
}

console.log('xstate:', JSON.stringify(results));
