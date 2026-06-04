# Requirement — Abandoned flow (event-time negation within a window)

A `flow_started` that is **not** followed by a `flow_completed` within **5000 ms of
event-time** is **abandoned**.

Events (arrival = array order; each carries its own `ts`):

| kind | flowId | ts |
|---|---|---|
| flow_started | A | 0 |
| flow_started | B | 100 |
| flow_completed | A | 2000 |

Expected output: `[{ signal: "abandoned", flowId: "B" }]` — A completes in time; B never completes.

The temporal essence is **negation within an event-time window**. React, Signals, RxJS, and
XState can all produce this output, but only by **hand-writing** the window decision; the
tool/framework contributes no temporal correctness. tflo declares it:
`when(started).notThen(completed).within(5000)`.
