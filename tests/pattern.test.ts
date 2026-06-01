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
