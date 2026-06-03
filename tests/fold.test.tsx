import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { useFold } from "../src/hooks/useFold";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
  amount: number;
}

// B1: `useFold` — event-time scan/fold. Folds an accumulator over a stream of
// events of a given `kind`, in event-time order (deterministic, replayable).

describe("useFold: event-time scan/fold (B1)", () => {
  it("folds events of `kind` into the accumulator in event-time order", async () => {
    let dispatch!: (e: Ev) => void;
    let acc = -1;
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      const [sum] = useFold<Ev, number>("sale", (a, e) => a + e.amount, 0);
      acc = ready ? sum : -1;
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "sale", ts: 0, amount: 10 });
      dispatch({ kind: "sale", ts: 100, amount: 20 });
      dispatch({ kind: "other", ts: 150, amount: 999 }); // wrong kind: ignored
      dispatch({ kind: "sale", ts: 200, amount: 30 });
    });
    await waitFor(() => expect(acc).toBe(60));
  });

  it("is deterministic under out-of-order arrival: folds in event-time, not arrival order", async () => {
    // A non-commutative reducer (append) makes ordering observable.
    let dispatch!: (e: Ev) => void;
    let order = "";
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      const [seq] = useFold<Ev, string>("k", (a, e) => a + e.amount, "");
      order = ready ? seq : "";
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    // Arrive out of event-time order: ts 300, 100, 200.
    await act(async () => {
      dispatch({ kind: "k", ts: 300, amount: 3 });
      dispatch({ kind: "k", ts: 100, amount: 1 });
      dispatch({ kind: "k", ts: 200, amount: 2 });
    });
    // Folded in event-time order -> "123", regardless of arrival order.
    await waitFor(() => expect(order).toBe("123"));
  });

  it("exposes the event-time `ts` of each event to the reducer via ctx", async () => {
    let dispatch!: (e: Ev) => void;
    let lastTs = -1;
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      const [v] = useFold<Ev, number>("k", (_a, _e, ctx) => ctx.ts, -1);
      lastTs = ready ? v : -1;
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "k", ts: 50, amount: 0 });
      dispatch({ kind: "k", ts: 999, amount: 0 });
    });
    // ctx.ts is the event-time of the latest (in event-time order) event.
    await waitFor(() => expect(lastTs).toBe(999));
  });

  it("supports a custom event-time extractor via opts.timestamp", async () => {
    let dispatch!: (e: { kind: string; ts: number; at: number; amount: number }) => void;
    let order = "";
    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit();
      // Fold key off `at`, not `ts`.
      const [seq] = useFold<{ kind: string; ts: number; at: number; amount: number }, string>(
        "k",
        (a, e) => a + e.amount,
        "",
        { timestamp: (e) => e.at },
      );
      order = ready ? seq : "";
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    // `ts` ascending but `at` descending -> event-time order follows `at`.
    await act(async () => {
      dispatch({ kind: "k", ts: 0, at: 300, amount: 3 });
      dispatch({ kind: "k", ts: 1, at: 100, amount: 1 });
      dispatch({ kind: "k", ts: 2, at: 200, amount: 2 });
    });
    await waitFor(() => expect(order).toBe("123"));
  });

  it("replay/idempotence: same event sequence -> same accumulator", async () => {
    // Drive a fresh provider tree with the same (out-of-order) events twice;
    // the folded accumulator must be identical and order-independent.
    const SEQ: Ev[] = [
      { kind: "k", ts: 200, amount: 2 },
      { kind: "k", ts: 100, amount: 1 },
      { kind: "k", ts: 300, amount: 3 },
    ];

    async function run(): Promise<string> {
      let dispatch!: (e: Ev) => void;
      let last = "";
      function Probe() {
        const { ready } = useTfloContext();
        dispatch = useEmit<Ev>();
        const [seq] = useFold<Ev, string>("k", (a, e) => a + e.amount, "");
        last = ready ? seq : "";
        return <div data-testid="ready">{String(ready)}</div>;
      }
      render(
        <TfloProvider>
          <Probe />
        </TfloProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
      await act(async () => {
        for (const e of SEQ) dispatch(e);
      });
      await waitFor(() => expect(last).not.toBe(""));
      cleanup();
      return last;
    }

    const a = await run();
    const b = await run();
    expect(a).toBe(b);
    expect(a).toBe("123");
  });
});
