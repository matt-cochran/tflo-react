// SCENARIO 4 — Rage click, with XState v5.
// One FSM per target tracks click count and anchor timestamp. "Rage" fires when
// ≥ MIN_BURST clicks have arrived and clicks 2–N all fall within WINDOW ms of
// the anchor (first) click. XState contributes the state-machine structure; ALL
// event-time window arithmetic is hand-written via `assign` guards — XState has
// no first-class event-time window concept.
//
// Output: [{signal:"rage",target:"T1"}] (best-effort — prints result).
import { createMachine, createActor, assign } from "xstate";

const WINDOW = 2000;
const MIN_BURST = 5; // 1 anchor + 4 more

const results = [];

const clickMachine = createMachine({
  id: "rage-click",
  initial: "idle",
  context: ({ input }) => ({
    target: input.target,
    anchorTs: null,
    count: 0,
    fired: false,
  }),
  states: {
    idle: {},
  },
  on: {
    CLICK: {
      actions: assign(({ context, event }) => {
        const { anchorTs, count, fired, target } = context;
        const ts = event.ts;

        if (anchorTs === null) {
          // First click — set anchor
          return { anchorTs: ts, count: 1, fired: false };
        } else if (ts - anchorTs <= WINDOW) {
          // Within window — accumulate
          const newCount = count + 1;
          const fire = !fired && newCount >= MIN_BURST;
          if (fire) {
            results.push({ signal: "rage", target });
          }
          return { anchorTs, count: newCount, fired: fired || fire };
        } else {
          // Outside window — reset
          return { anchorTs: ts, count: 1, fired: false };
        }
      }),
    },
  },
});

const allEvents = [
  // T1 — burst
  { kind: "click", target: "T1", ts: 0 },
  { kind: "click", target: "T1", ts: 100 },
  { kind: "click", target: "T1", ts: 200 },
  { kind: "click", target: "T1", ts: 300 },
  { kind: "click", target: "T1", ts: 400 },
  // T2 — spaced
  { kind: "click", target: "T2", ts: 0 },
  { kind: "click", target: "T2", ts: 5000 },
];

// One actor per target
const actors = new Map();
for (const e of allEvents) {
  if (e.kind !== "click") continue;
  if (!actors.has(e.target)) {
    const actor = createActor(clickMachine, { input: { target: e.target } });
    actor.start();
    actors.set(e.target, actor);
  }
  actors.get(e.target).send({ type: "CLICK", ts: e.ts });
}

console.log("xstate:", JSON.stringify(results));
