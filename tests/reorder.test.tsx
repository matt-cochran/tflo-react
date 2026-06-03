import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { ManualClock } from "../src/core/clock";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignal } from "../src/hooks/useSignal";
import { useDropMetrics } from "../src/hooks/useDropMetrics";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

const ab = (name: string) => (p: import("../src/core/pattern").Pattern<Ev>) =>
  p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "a")
    .then((e) => e.kind === "b")
    .emit(() => ({ name, payload: {} }));

// Part B / #6: the matcher is arrival-order; on OUT-OF-ORDER input a pattern
// silently misses — unless you opt into the reorder buffer, which releases events
// in event-time order (the watermark driven by the injected clock).
describe("event-time reorder buffer (#6)", () => {
  it("matches out-of-order input with reorder; misses it without", async () => {
    const clock = new ManualClock(0);
    let dispatch!: (e: Ev) => void;

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>("RMatch", ab("RMatch"), [], { reorder: { maxLateness: 100 } });
      usePattern<Ev>("OMatch", ab("OMatch"), []); // control: no reorder
      const r = useSignal("RMatch");
      const o = useSignal("OMatch");
      return (
        <>
          <div data-testid="ready">{String(ready)}</div>
          <div data-testid="r">{r ? "match" : "none"}</div>
          <div data-testid="o">{o ? "match" : "none"}</div>
        </>
      );
    }

    render(
      <TfloProvider clock={clock}>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    // Arrival order b@10 then a@0 — OUT of event-time order.
    await act(async () => {
      dispatch({ kind: "b", ts: 10 });
      dispatch({ kind: "a", ts: 0 });
    });
    // Nothing yet: the reorder buffer is still holding (within lateness window).
    expect(screen.getByTestId("r").textContent).toBe("none");
    expect(screen.getByTestId("o").textContent).toBe("none");

    // Advance the clock past the lateness window → buffer releases a@0, b@10 in
    // event-time order → the reordered pattern matches; the control never does.
    await act(async () => {
      clock.advanceTo(200);
    });
    await waitFor(() => expect(screen.getByTestId("r").textContent).toBe("match"));
    expect(screen.getByTestId("o").textContent).toBe("none");
  });

  it("drops an event behind the frontier as `late` (observable)", async () => {
    let dispatch!: (e: Ev) => void;
    let drops: { late: number; total: number } = { late: 0, total: 0 };

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      // lateness 0 → greedy release, so an earlier-ts event after a later one is late
      usePattern<Ev>("R", ab("R"), [], { reorder: { maxLateness: 0 } });
      drops = useDropMetrics();
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      dispatch({ kind: "a", ts: 100 }); // releases, frontier = 100
      dispatch({ kind: "a", ts: 50 }); // behind frontier → dropped as late
    });
    await waitFor(() => expect(drops.late).toBe(1));
    expect(drops.total).toBe(1);
  });
});
