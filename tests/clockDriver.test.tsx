import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { systemClock, ManualClock } from "../src/core/clock";
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

  it("injected systemClock drives the deadline on a real timer (no event)", async () => {
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

    // Inject systemClock: the SAME clock stamps omitted-ts events and drives the
    // wake-up, so the abandonment fires with no event.
    render(
      <TfloProvider clock={systemClock}>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    await act(async () => {
      dispatch({ kind: "add_to_cart" } as Ev); // omit ts → stamped by systemClock
    });

    await waitFor(() => expect(screen.getByTestId("sig").textContent).toBe("fired"), {
      timeout: 2000,
    });
  });

  it("injected ManualClock drives deadlines deterministically (advance, no timers)", async () => {
    const clock = new ManualClock(0);
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
      <TfloProvider clock={clock}>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    // The clock is at 0; omitted-ts events are stamped with clock.now() === 0.
    await act(async () => {
      dispatch({ kind: "add_to_cart" } as Ev);
    });
    expect(screen.getByTestId("sig").textContent).toBe("none");

    // Advancing virtual time before the deadline: still nothing.
    await act(async () => {
      clock.advanceTo(3000);
    });
    expect(screen.getByTestId("sig").textContent).toBe("none");

    // Advancing past the deadline fires the abandonment — no real timer, fully
    // deterministic. The scheduled wake-up runs inside advanceTo().
    await act(async () => {
      clock.advanceTo(6000);
    });
    await waitFor(() => expect(screen.getByTestId("sig").textContent).toBe("fired"));
  });
});
