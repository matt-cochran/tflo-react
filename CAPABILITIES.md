# Capabilities — and the one idea behind them

> You don't have a "time" problem to go solve. You already have time *all over*
> your code — you just hid it. This is a map of what `tflo` does, organized around
> the one idea that makes it worth your attention.

## The idea (two moves)

**1. Time is already in your logic, whether you modeled it or not.**

Go look. That `status` enum, those `hasX` booleans, the `setTimeout` that flips a
flag, the cron that expires a row, the counter you reset, the "if it's been more
than N minutes" check — *each one is temporal logic you wrote by hand and then
hid inside mutable state.* And hidden temporal logic drifts: the flag and the
history disagree, the timer is wall-clock so it's wrong on replay, the result
depends on the order events happened to arrive. You didn't choose to model time.
You chose to model it *badly, implicitly.*

`tflo` makes the time dimension **explicit, declarative, and correct**:
`status = fold(history)` instead of a flag you keep in sync; `A then no B within
T` instead of a timer-and-flag; an event-time match instead of an arrival-order
one.

**2. It's in your logic in *two* domains — and composing them is the point.**

- **The experience domain** (front end): time *about the user* — hesitation,
  rage, abandonment, onboarding momentum, attention. It shapes what they see and
  feel.
- **The business domain** (back end): time *about your entities* — fraud, quota
  burn, order/billing lifecycle, SLA, account standing. It decides and enforces.

These are **different models, not one program run twice.** Each is better with
first-class time on its own. The superpower is **composition**: the experience
model *consumes* the business model's derived state and **magnifies** it into the
UX — backend quota-burn crosses a line, and the front end's response escalates
*over time*. Cross-tier parity isn't "we ran the same code twice"; it's the
**trust** that lets the front end *preview* the backend's verdict locally and
react *before* the round-trip, knowing it will be confirmed, not corrected.

If both of those landed, you already see why one ergonomic API for all of it
matters. The rest of this file is just where to look.

## Where to see each capability

| Capability | What it replaces | See it |
|---|---|---|
| **Self-driving deadlines** (`tick` + injected `Clock`) | a cron / `setTimeout` that flips a flag | abandonment fires on *absence* with no event — onboarding demo (idle), parity `runWithClock` |
| **Derived read-model** (`useProjection`) | a `status` enum / `hasX` flags kept in sync | onboarding `useOnboardingStage` — `status = fold(history)` |
| **Versioning** (`rule_version` on derived events) | a migration + "which rule fired?" mystery | emitted signals carry their rule version; history is immutable |
| **Corrections** (a superseding derived event) | a manual override that fights the cache | last-writer-wins by event-time; same mechanism as re-judgment |
| **Deterministic replay** (`useRecorder`) | "add logging and re-run, hope it repeats" | scrub the onboarding timeline; idle resolves *instantly* |
| **Provenance** (cause-tree, `useExplain`) | reconstructing "why did this fire?" by hand | onboarding `ExplainPanel` — click a signal, see its causes |
| **Relational guards** (`guard()`) | cross-component global state for "read another entity" | onboarding `useBlockedByPeer` — "I2 blocked while I1 is" |
| **Event-time reorder** (`{ reorder }`) | silently-wrong results on out-of-order input | parity `orderIndependence` — shuffled input ≡ in-order |
| **Cross-tier composition** (one serializable rule) | client and server logic that silently disagree | parity demo — front-end UX magnified by backend state, previewed locally |
| **Observable backpressure** (`useDropMetrics`) | RxJS dropping matches in the dark | `{ total, maxInFlight, deadline, late }` as reactive state |

## Honest non-goals

- **Cross-tier *relational* guards over population state.** A guard reads other
  entities' state; the browser only has *its* session/self state, so a
  population-scoped guard (e.g. fraud across *all* users) can't agree with the
  server — run it server-side. Cross-tier parity holds for session/self-scoped
  rules. (Session-scoped relational guards already work browser-side.)
- **A general stream processor.** Reorder is opt-in and trades latency for
  out-of-order correctness; for distributed, cross-shard, global-watermark
  workloads, compose `tflo` *inside* Flink/Kafka/Beam, don't replace them.
- **Durable timers / SQL-Redis projection backends.** In-memory by default; the
  ports compose the existing `AsyncStateStore` for durability when you need it.
