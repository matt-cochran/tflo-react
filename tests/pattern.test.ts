import { beforeAll, describe, expect, it } from "vitest";
import { initTflo } from "../src/core/wasmInit";
import { Pattern, PatternRuntime, type DerivedSignal } from "../src/core/pattern";

interface Ev {
  kind: string;
  flowId: string;
  ts: number;
}

beforeAll(async () => {
  await initTflo();
});

// Drive one pattern instance per flow (the engine's CEP v0.1 has no cross-step
// field correlation, so per-entity runtimes are the idiom — like actors).
function runFlow(flowId: string, events: Ev[]): DerivedSignal[] {
  const compiled = new Pattern<Ev>("abandoned")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "flow_started")
    .notThen((e) => e.kind === "flow_completed")
    .within(5000)
    .emit(() => ({ name: "abandoned", payload: { flowId } }));
  const rt = new PatternRuntime(compiled);
  const out: DerivedSignal[] = [];
  for (const e of events) out.push(...rt.push(e));
  out.push(...rt.flush());
  rt.destroy();
  return out;
}

// Card-testing fraud shape (interior negation): an `auth_fail`, then ANOTHER
// `auth_fail` within the window, with NO `auth_success` in between. A terminal
// `notThen` cannot express this — the success must be forbidden *between* the
// two positives, not merely absent at the end. Mirrors the engine's
// `interior_negation_card_testing_*` use-case tests.
function cardTesting(events: Ev[]): DerivedSignal[] {
  const compiled = new Pattern<Ev>("card_testing")
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "auth_fail")
    .notBetween((e) => e.kind === "auth_success")
    .then((e) => e.kind === "auth_fail")
    .within(60_000)
    .emit((m) => ({ name: "card_testing", payload: { fails: m.length } }));
  const rt = new PatternRuntime(compiled);
  const out: DerivedSignal[] = [];
  for (const e of events) out.push(...rt.push(e));
  out.push(...rt.flush());
  rt.destroy();
  return out;
}

describe("interior negation — notBetween (A then B with no C between)", () => {
  it("fires on two fails with no success between", () => {
    const out = cardTesting([
      { kind: "auth_fail", flowId: "c", ts: 0 },
      { kind: "view_page", flowId: "c", ts: 10_000 },
      { kind: "auth_fail", flowId: "c", ts: 20_000 }, // second fail, no success → fires
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].payload.fails).toBe(2);
  });

  it("is suppressed by an interior success (the case notThen cannot express)", () => {
    const out = cardTesting([
      { kind: "auth_fail", flowId: "c", ts: 0 },
      { kind: "auth_success", flowId: "c", ts: 10_000 }, // success between → partial killed
      { kind: "auth_fail", flowId: "c", ts: 20_000 }, // fresh fail, nothing after it
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("scenario 1 — abandoned flow (event-time negation within window)", () => {
  it("emits for the flow that never completes, not the one that completes in time", () => {
    const a = runFlow("A", [
      { kind: "flow_started", flowId: "A", ts: 0 },
      { kind: "flow_completed", flowId: "A", ts: 2000 }, // within 5000 → no abandon
    ]);
    const b = runFlow("B", [{ kind: "flow_started", flowId: "B", ts: 100 }]); // never completes

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    expect(b[0].payload.flowId).toBe("B");
  });
});
