# Primitive: Shadow / canary rule rollout (P3)

## Requirement

Run a CANDIDATE temporal rule spec alongside the ACTIVE one over the **same live
event stream**, **without acting** on the candidate's output, and surface a live
**divergence** stream — the signals emitted by exactly one side. This is how you
canary a rule change safely: the active side is what a consumer acts on; the
candidate is observed only, so a regression shows up as a divergence **before**
it ships.

It reuses the **same parity/diff mechanism as backtest** (`primitive-backtest`),
but **live**: both runtimes are pushed every event as it arrives, rather than one
recorded log being replayed offline. Because the tflo CEP engine is **pure**
(event-time only, reads no wall-clock), feeding the same events to both runtimes
is the only thing that determines the divergence — the comparison is
deterministic.

## Capability under test

- `useShadowSpec(active, candidate)` — the React hook (`src/hooks/useShadowSpec.ts`),
  exported from `src/index.ts`:
  - Maintains TWO `PatternRuntime`s, one per spec (`{ name, build, maxLateness? }`).
  - Taps the live bus; for each pushed event, feeds BOTH runtimes and collects
    each side's emitted signals.
  - Exposes `{ activeSignals, candidateSignals, divergences }`, where
    `divergences` = signals emitted by exactly one side, keyed by
    name + event-time + id-ish payload fields, each tagged
    `{ side: "active" | "candidate", signal }`.
  - The active side is the one a consumer would act on; the candidate is observed
    only.
- `diffSignals(active, candidate)` — the shared pure diff
  (`src/core/backtest.ts`), reused verbatim: `removed` = active-only,
  `added` = candidate-only.

## Scenario in this proof

Active and candidate differ ONLY in the abandonment window:

- `within-5000` (active, acted on) — abandoned if no completion within 5000 ms.
- `within-1000` (candidate, observed only) — abandoned if no completion within 1000 ms.

Live stream: a flow `A` started at ts=0 and completed at ts=2000 (slow).

- Under the active `within-5000`: completed in time → **no** signal (nothing acted on).
- Under the candidate `within-1000`: 2000 ms > 1000 ms → **abandoned**.

So the candidate emits a signal the active never does → one candidate-side
divergence, caught live before the candidate would have shipped.

## Expected (self-asserted)

- `activeSignals` is empty.
- `candidateSignals` has one `abandoned` signal for flow `A`.
- `divergences` has exactly one entry: `side: "candidate"`, an `abandoned`
  signal for flow `A`.

## Run

```
node validation/primitive-shadow/shadow.mjs   # prints PASS, exit 0
```

The standalone proof imports the WASM directly and inlines a minimal copy of the
shadow diff core so it runs in plain Node ESM with no build step. The same logic
is exercised through the package in `tests/useShadowSpec.test.tsx`.
