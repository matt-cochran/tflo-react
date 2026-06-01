import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignal } from "../src/hooks/useSignal";
import { useCount } from "../src/hooks/useWindow";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

describe("React integration — primitives over the real WASM engine", () => {
  it("usePattern emits a signal that useSignal observes", async () => {
    let dispatch!: (e: Ev) => void;
    const seen: string[] = [];

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      const sig = usePattern<Ev>(
        "rage",
        (p) =>
          p
            .timestamp((e) => e.ts)
            .when((e) => e.kind === "click")
            .then((e) => e.kind === "click")
            .within(1000)
            .then((e) => e.kind === "click")
            .within(1000)
            .emit(() => ({ name: "rage", payload: {} })),
        [],
      );
      const observed = useSignal("rage");
      if (sig) seen.push("pattern");
      if (observed) seen.push("signal");
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );

    // Wait for WASM init → pattern registration before dispatching.
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "click", ts: 0 });
      dispatch({ kind: "click", ts: 200 });
      dispatch({ kind: "click", ts: 400 }); // 3 clicks within 1s → rage
    });

    await waitFor(() => expect(seen).toContain("signal"));
  });

  it("useCount tracks a rolling event-time window", async () => {
    let dispatch!: (e: Ev) => void;
    let lastCount = -1;

    function Probe() {
      const { ready } = useTfloContext();
      dispatch = useEmit<Ev>();
      lastCount = useCount("err", { ms: 1000 });
      return <div data-testid="ready">{String(ready)}</div>;
    }

    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      dispatch({ kind: "err", ts: 0 });
      dispatch({ kind: "err", ts: 100 });
      dispatch({ kind: "err", ts: 200 });
    });
    await waitFor(() => expect(lastCount).toBe(3));
    await act(async () => {
      dispatch({ kind: "err", ts: 5000 }); // far future → evicts older (rolling)
    });
    await waitFor(() => expect(lastCount).toBe(1));
  });
});
