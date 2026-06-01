import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, type TfloContextValue, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignalCallback } from "../src/hooks/useSignalCallback";
import { Pattern } from "../src/core/pattern";

interface Ev extends Record<string, unknown> {
  kind: string;
  flowId: string;
  ts: number;
}

// A single pattern that, thanks to partitionBy, tracks each flow independently:
// "flow_started not followed by flow_completed within 5000 (event-time)".
function abandoned(p: Pattern<Ev>) {
  return p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "flow_started")
    .notThen((e) => e.kind === "flow_completed")
    .within(5000)
    .emit((m) => ({ name: "abandoned", payload: { flowId: m.first().flowId } }));
}

describe("partitionBy — one usePattern tracks many concurrent entities", () => {
  it("emits abandoned for the flow that never completes, not the one that completes in time", async () => {
    let dispatch!: (e: Ev) => void;
    let ctx: TfloContextValue | null = null;
    const abandonedFlows: string[] = [];

    function Probe() {
      ctx = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>("abandoned", abandoned, [], { partitionBy: (e) => e.flowId });
      useSignalCallback("abandoned", (s) => {
        abandonedFlows.push(s.payload.flowId as string);
      });
      return <div data-testid="ready">{String(ctx.ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    // Wait until the pattern runtime is actually registered (ready text can flip
    // before the registration effect flushes — gating on the runtime is exact).
    await waitFor(() => expect(ctx?.runtimes.size()).toBeGreaterThan(0));

    await act(async () => {
      dispatch({ kind: "flow_started", flowId: "A", ts: 0 });
      dispatch({ kind: "flow_started", flowId: "B", ts: 100 });
      dispatch({ kind: "flow_completed", flowId: "A", ts: 2000 }); // A completes in time
      // advance B's runtime past its 5100 deadline with no completion → abandoned
      dispatch({ kind: "tick", flowId: "B", ts: 6000 });
    });

    await waitFor(() => expect(abandonedFlows).toContain("B"));
    // A completed within the window — it must NOT be reported abandoned.
    expect(abandonedFlows).not.toContain("A");
    expect(abandonedFlows).toEqual(["B"]);
  });
});
