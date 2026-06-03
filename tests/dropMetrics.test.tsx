import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { initTflo } from "../src/core/wasmInit";
import { Pattern, PatternRuntime } from "../src/core/pattern";
import { RuntimeRegistry } from "../src/core/runtimeRegistry";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useDropMetrics } from "../src/hooks/useDropMetrics";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

// B3: observable backpressure — dropped partial matches are made VISIBLE.
// RxJS drops silently under backpressure; tflo surfaces the loss as a reactive
// counter with a per-reason breakdown (`max_in_flight` vs `deadline`) + total.

describe("PatternRuntime drop surface (C2 → JS)", () => {
  beforeAll(async () => {
    await initTflo();
  });

  it("counts max_in_flight drops and routes the reason string", () => {
    // Two positive steps so opened partials stay in flight; the in-flight set
    // saturates at MAX_IN_FLIGHT (1024) and then evicts the oldest.
    const compiled = new Pattern<Ev>("p")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "a")
      .then((e) => e.kind === "b")
      .emit(() => ({ name: "p", payload: {} }));
    const rt = new PatternRuntime(compiled);

    const reasons: string[] = [];
    rt.onDrop((r) => reasons.push(r));

    const overflow = 5;
    for (let ts = 0; ts < 1024 + overflow; ts++) rt.push({ kind: "a", ts });

    expect(rt.droppedCount).toBe(overflow);
    expect(reasons).toHaveLength(overflow);
    expect(reasons.every((r) => r === "max_in_flight")).toBe(true);
    rt.destroy();
  });

  it("counts deadline drops and routes the reason string", () => {
    const compiled = new Pattern<Ev>("p")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "a")
      .then((e) => e.kind === "b")
      .within(100)
      .emit(() => ({ name: "p", payload: {} }));
    const rt = new PatternRuntime(compiled);

    const reasons: string[] = [];
    rt.onDrop((r) => reasons.push(r));

    rt.push({ kind: "a", ts: 0 }); // opens partial, deadline = 100
    rt.push({ kind: "x", ts: 500 }); // past deadline → sweep drops it

    expect(rt.droppedCount).toBe(1);
    expect(reasons).toEqual(["deadline"]);
    rt.destroy();
  });
});

describe("RuntimeRegistry drop aggregation", () => {
  beforeAll(async () => {
    await initTflo();
  });

  it("aggregates per-reason drop counts across registered runtimes and notifies", () => {
    const reg = new RuntimeRegistry();
    let notified = 0;
    const unsub = reg.subscribeDrops(() => notified++);

    const compiled = new Pattern<Ev>("dl")
      .timestamp((e) => e.ts)
      .when((e) => e.kind === "a")
      .then((e) => e.kind === "b")
      .within(100)
      .emit(() => ({ name: "dl", payload: {} }));
    reg.register("id1", compiled as never);

    expect(reg.dropMetrics()).toEqual({ total: 0, maxInFlight: 0, deadline: 0, late: 0 });

    reg.pushAll({ kind: "a", ts: 0 });
    reg.pushAll({ kind: "x", ts: 500 }); // deadline sweep

    expect(reg.dropMetrics()).toEqual({ total: 1, maxInFlight: 0, deadline: 1, late: 0 });
    expect(notified).toBeGreaterThan(0);
    unsub();
    reg.deregister("id1");
  });
});

describe("useDropMetrics hook (B3)", () => {
  it("surfaces deadline drops reactively from a live pattern", async () => {
    let dispatch!: (e: Ev) => void;
    let metrics = { total: 0, maxInFlight: 0, deadline: 0, late: 0 };

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      // "a then b within 100ms" — if b never arrives, the partial is dropped on
      // the deadline sweep.
      usePattern<Ev>(
        "ab",
        (p) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "a")
            .then((e) => e.kind === "b")
            .within(100)
            .emit(() => ({ name: "ab", payload: {} })),
        [],
      );
      metrics = useDropMetrics();
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "a", ts: 0 }); // opens a partial with deadline 100
      dispatch({ kind: "x", ts: 500 }); // past deadline → partial dropped
    });

    await waitFor(() => expect(metrics.total).toBe(1));
    expect(metrics.deadline).toBe(1);
    expect(metrics.maxInFlight).toBe(0);
  });
});
