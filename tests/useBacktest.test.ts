import { beforeAll, describe, expect, it } from "vitest";
import { initTflo } from "../src/core/wasmInit";
import { type Pattern } from "../src/core/pattern";
import { type BacktestEvent, type BacktestSpec, runBacktest } from "../src/hooks/useBacktest";

interface Ev extends BacktestEvent {
  kind: string;
  flowId: string;
  ts: number;
}

beforeAll(async () => {
  await initTflo();
});

// "Abandoned flow" = started, then NO completion within the window. The two
// specs differ ONLY in the window length, so a flow that completes at ts=2000
// is abandoned under within=1000 (too slow) but NOT under within=5000 (in time).
// That difference is exactly what the backtest diff should surface.
const abandonedWithin =
  (name: string, within: number) =>
  (p: Pattern<Ev>) =>
    p
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "flow_started")
      .notThen((e) => e.kind === "flow_completed")
      .within(within)
      .emit((m) => ({ name: "abandoned", payload: { flowId: m.first().flowId } }));

const specs: BacktestSpec<Ev>[] = [
  { name: "within-5000", build: abandonedWithin("within-5000", 5000) }, // baseline
  { name: "within-1000", build: abandonedWithin("within-1000", 1000) },
];

// One flow that completes at ts=2000 (slow). Under 5000 → in time (no signal).
// Under 1000 → too slow → abandoned.
const log: Ev[] = [
  { kind: "flow_started", flowId: "A", ts: 0 },
  { kind: "flow_completed", flowId: "A", ts: 2000 },
];

describe("useBacktest core — replay one log against multiple rule specs", () => {
  it("runs each spec deterministically and produces a correct non-empty diff", () => {
    const { perSpec, diff } = runBacktest(log, specs);

    // Per-spec results: baseline sees no abandonment; the tighter window does.
    expect(perSpec["within-5000"]).toHaveLength(0);
    expect(perSpec["within-1000"]).toHaveLength(1);
    expect(perSpec["within-1000"][0].name).toBe("abandoned");
    expect(perSpec["within-1000"][0].payload.flowId).toBe("A");

    // Diff: baseline vs the tighter window. The tighter window ADDS one
    // "abandoned" signal that the baseline never emitted; nothing is removed.
    expect(Object.keys(diff)).toEqual(["within-1000"]);
    expect(diff["within-1000"].added).toHaveLength(1);
    expect(diff["within-1000"].added[0].name).toBe("abandoned");
    expect(diff["within-1000"].added[0].payload.flowId).toBe("A");
    expect(diff["within-1000"].removed).toHaveLength(0);
  });

  it("is deterministic — identical inputs yield identical signals", () => {
    const a = runBacktest(log, specs);
    const b = runBacktest(log, specs);
    const norm = (r: ReturnType<typeof runBacktest>) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(r.perSpec).map(([k, v]) => [
            k,
            v.map((s) => ({ name: s.name, payload: s.payload })),
          ]),
        ),
      );
    expect(norm(a)).toBe(norm(b));
  });

  it("reverses added/removed when the baseline is the tighter window", () => {
    const reversed: BacktestSpec<Ev>[] = [specs[1], specs[0]]; // baseline = within-1000
    const { diff } = runBacktest(log, reversed);
    // Baseline (tight) emits abandoned; the loose window does NOT → it's REMOVED.
    expect(diff["within-5000"].added).toHaveLength(0);
    expect(diff["within-5000"].removed).toHaveLength(1);
    expect(diff["within-5000"].removed[0].payload.flowId).toBe("A");
  });

  it("throws on duplicate spec names", () => {
    expect(() =>
      runBacktest(log, [
        { name: "dup", build: abandonedWithin("dup", 1000) },
        { name: "dup", build: abandonedWithin("dup", 5000) },
      ]),
    ).toThrow(/duplicate spec name/);
  });
});
