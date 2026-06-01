// SCENARIO 2 — Temporal windowed join (event-time).
// XState (v5) — runs correctly, but a small stream engine was written ALONGSIDE
// XState: the virtual clock, the event-time timeline merge, the WINDOW_CLOSED
// ticks, and the open-order routing/bookkeeping are all hand-rolled. The clean
// part (per-order open→joined/expired FSM with a window guard) is ~1% of the
// problem; the temporal-join essence is yours to build.
//
// Ran: xstate 5.32.0, Node. Output: [{"orderId":"O1","amount":100,"latencyMs":2000}] (CORRECT).
import { createMachine, createActor, assign, sendParent } from 'xstate';

const orders   = [{ orderId: 'O1', ts: 0, amount: 100 }, { orderId: 'O2', ts: 1000, amount: 50 }];
const payments = [{ orderId: 'O1', ts: 2000 }, { orderId: 'O2', ts: 9000 }];
const WINDOW = 3000;
const results = [];

// Per-order actor: awaits a payment, guards on EVENT-TIME window, self-finalizes.
const orderMachine = createMachine({
  id: 'order',
  context: ({ input }) => ({ order: input }),
  initial: 'open',
  states: {
    open: {
      on: {
        PAYMENT: [
          {
            guard: ({ context, event }) =>
              event.payment.orderId === context.order.orderId &&
              event.payment.ts >= context.order.ts &&
              event.payment.ts <= context.order.ts + WINDOW,
            actions: sendParent(({ context, event }) => ({
              type: 'JOIN',
              result: { orderId: context.order.orderId, amount: context.order.amount, latencyMs: event.payment.ts - context.order.ts },
            })),
            target: 'joined',
          },
          { guard: ({ context, event }) => event.payment.orderId === context.order.orderId, target: 'expired' },
        ],
        WINDOW_CLOSED: { target: 'expired' },
      },
    },
    joined:  { type: 'final' },
    expired: { type: 'final' },
  },
});

// Coordinator: spawns one actor per order, routes payments, advances virtual clock.
const coordinator = createMachine({
  id: 'join',
  context: { children: {} },
  initial: 'running',
  states: {
    running: {
      on: {
        SPAWN_ORDER: {
          actions: assign({
            children: ({ context, event, spawn }) => ({
              ...context.children,
              [event.order.orderId]: spawn(orderMachine, { id: `order-${event.order.orderId}`, input: event.order }),
            }),
          }),
        },
        PAYMENT: {
          actions: ({ context, event }) => {
            const child = context.children[event.payment.orderId];
            if (child && child.getSnapshot().status === 'active') child.send({ type: 'PAYMENT', payment: event.payment });
          },
        },
        TICK: {
          actions: ({ context, event }) => {
            for (const child of Object.values(context.children)) {
              if (child.getSnapshot().status !== 'active') continue;
              const order = child.getSnapshot().context.order;
              if (event.now > order.ts + WINDOW) child.send({ type: 'WINDOW_CLOSED' });
            }
          },
        },
        JOIN: { actions: ({ event }) => results.push(event.result) },
      },
    },
  },
});

const actor = createActor(coordinator).start();
for (const order of orders) actor.send({ type: 'SPAWN_ORDER', order });

// Driver: merge streams by EVENT-TIME and hand-advance the clock.
const timeline = [];
for (const p of payments) timeline.push({ kind: 'payment', ts: p.ts, payment: p });
for (const o of orders) timeline.push({ kind: 'tick', ts: o.ts + WINDOW + 1 });
timeline.sort((a, b) => a.ts - b.ts);

for (const ev of timeline) {
  actor.send({ type: 'TICK', now: ev.ts });
  if (ev.kind === 'payment') actor.send({ type: 'PAYMENT', payment: ev.payment });
}

console.log(JSON.stringify(results));
