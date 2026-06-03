import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignal } from "../src/hooks/useSignal";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

// Phase 2: the self-driving clock. A "no X within T" rule must fire on the
// ABSENCE of an event — driven by the host clock (here we drive `bus.tick`
// directly, deterministically), with NO closing event arriving. This is what
// lets a temporal model replace the cron job that flips a flag.
describe("self-driving clock: deadline fires on absence (Phase 2)", () => {
  it("abandonment fires via the clock with no closing event", async () => {
    let dispatch!: (e: Ev) => void;
    let tick!: (now: number) => void;

    function Probe() {
      const { ready, bus } = useTfloContext();
      dispatch = useEmit<Ev>();
      tick = (now: number) => bus.tick(now);
      usePattern<Ev>(
        "abandoned",
        (p) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "add_to_cart")
            .notThen((e) => e.kind === "purchase")
            .within(5000)
            .emit((m) => ({ name: "abandoned", ts: m.first().ts, payload: {} })),
        [],
      );
      const sig = useSignal("abandoned");
      return (
        <>
          <div data-testid="ready">{String(ready)}</div>
          <div data-testid="sig">{sig ? "fired" : "none"}</div>
        </>
      );
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      dispatch({ kind: "add_to_cart", ts: 0 });
    });
    // No purchase, no further events: the signal must NOT have fired yet.
    expect(screen.getByTestId("sig").textContent).toBe("none");

    // The host clock advances past the 5s deadline — with NO event at all.
    await act(async () => {
      tick(6000);
    });
    await waitFor(() => expect(screen.getByTestId("sig").textContent).toBe("fired"));
  });

  it("autoClock drives the deadline on a real timer (opt-in, no event)", async () => {
    let dispatch!: (e: Ev) => void;

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      usePattern<Ev>(
        "abandoned",
        (p) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "add_to_cart")
            .notThen((e) => e.kind === "purchase")
            .within(30) // short window so the real timer fires quickly
            .emit((m) => ({ name: "abandoned", ts: m.first().ts, payload: {} })),
        [],
      );
      const sig = useSignal("abandoned");
      return (
        <>
          <div data-testid="ready">{String(ready)}</div>
          <div data-testid="sig">{sig ? "fired" : "none"}</div>
        </>
      );
    }

    // autoClock on + bus-stamped (wall-clock) timestamps: event-time tracks the
    // page clock, so the self-driving timer fires the abandonment with no event.
    render(
      <TfloProvider autoClock>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      dispatch({ kind: "add_to_cart" } as Ev); // omit ts → bus stamps now()
    });

    // No purchase, no further events — the coalesced setTimeout fires it.
    await waitFor(() => expect(screen.getByTestId("sig").textContent).toBe("fired"), {
      timeout: 2000,
    });
  });
});
