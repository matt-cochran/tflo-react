# Primitive: Backtest / what-if (P1)

## Requirement

Replay ONE recorded event log against MULTIPLE temporal rule specs and diff the
results — "what-if I'd shipped rule B instead of rule A?".

Because the tflo CEP engine is **pure** (event-time only, reads no wall-clock),
replaying the same log against different specs is **deterministic**: the same
`(log, spec)` pair always yields the same emitted signals. A what-if is therefore
a mechanical, side-effect-free computation, not a re-run of production. This is a
latent superpower a pure engine packages for free.

## Capability under test

- `runBacktest(log, specs)` — the pure core (`src/core/backtest.ts`):
  - For each spec: instantiate a throwaway `WasmPatternRuntime`, `push` every
    event in `log`, `flush`, collect emitted signals, free the runtime.
  - `diff` compares the FIRST spec (baseline) against each other spec:
    `{ added, removed }` keyed by signal name + event-time + id-ish payload fields.
- `useBacktest(log, specs)` — the React hook wrapper (`src/hooks/useBacktest.ts`),
  exported from `src/index.ts`. Gates on engine `ready`, memoizes on inputs.

## Scenario in this proof

Two specs differ ONLY in the abandonment window:

- `within-5000` (baseline) — abandoned if no completion within 5000 ms.
- `within-1000` — abandoned if no completion within 1000 ms.

Log: a flow `A` started at ts=0 and completed at ts=2000 (slow).

- Under `within-5000`: completed in time → **no** signal.
- Under `within-1000`: 2000 ms > 1000 ms → **abandoned**.

## Expected (self-asserted)

- `perSpec["within-5000"]` is empty.
- `perSpec["within-1000"]` has one `abandoned` signal for flow `A`.
- `diff["within-1000"].added` contains exactly that one signal; `removed` is empty.

## Run

```
node validation/primitive-backtest/backtest.mjs   # prints PASS, exit 0
```

The standalone proof imports the WASM directly and inlines a minimal copy of the
`runBacktest` core so it runs in plain Node ESM with no build step. The same
logic is exercised through the package in `tests/useBacktest.test.ts`.
