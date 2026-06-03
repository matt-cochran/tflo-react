import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { TfloProvider, useTfloContext } from "../src/core/provider";
import { useCombineLatest } from "../src/hooks/useCombineLatest";
import type { DerivedSignal } from "../src/core/pattern";

// B2: `useCombineLatest` — combineLatest over tflo signals. Subscribes to N
// named signals and returns the latest value of each combined together,
// updating when any input signal updates. Emits only once EVERY input has
// produced at least one value, then on every subsequent update — the standard
// RxJS combineLatest contract, expressed over tflo's signal registry.

const sig = (name: string, ts: number, payload: Record<string, unknown> = {}): DerivedSignal => ({
  name,
  ts,
  payload,
});

describe("useCombineLatest: combineLatest over signals (B2)", () => {
  it("does not emit until every input signal has produced a value", async () => {
    let publish!: (s: DerivedSignal) => void;
    let combined: Record<string, DerivedSignal> | undefined = { sentinel: sig("x", 0) };
    function Probe() {
      const { ready, signals } = useTfloContext();
      publish = (s) => signals.publish(s.name, s);
      const c = useCombineLatest(["a", "b"]);
      combined = ready ? c : { sentinel: sig("x", 0) };
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    // Only `a` so far -> still undefined (not all inputs present).
    await act(async () => {
      publish(sig("a", 100, { v: 1 }));
    });
    await waitFor(() => expect(combined).toBe(undefined));

    // Now `b` arrives -> all inputs present -> emits the combined latest.
    await act(async () => {
      publish(sig("b", 200, { v: 2 }));
    });
    await waitFor(() => expect(combined).not.toBe(undefined));
    expect(combined!.a.payload).toEqual({ v: 1 });
    expect(combined!.b.payload).toEqual({ v: 2 });
  });

  it("emits the combined latest on each subsequent input update", async () => {
    let publish!: (s: DerivedSignal) => void;
    let combined: Record<string, DerivedSignal> | undefined;
    function Probe() {
      const { ready, signals } = useTfloContext();
      publish = (s) => signals.publish(s.name, s);
      combined = useCombineLatest(["a", "b"]);
      return <div data-testid="ready">{String(ready)}</div>;
    }
    render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      publish(sig("a", 1, { v: 1 }));
      publish(sig("b", 2, { v: 2 }));
    });
    await waitFor(() => expect(combined?.a.payload).toEqual({ v: 1 }));

    // Update only `a` -> b stays at its latest, a updates.
    await act(async () => {
      publish(sig("a", 3, { v: 10 }));
    });
    await waitFor(() => expect(combined?.a.payload).toEqual({ v: 10 }));
    expect(combined!.b.payload).toEqual({ v: 2 });

    // Update only `b`.
    await act(async () => {
      publish(sig("b", 4, { v: 20 }));
    });
    await waitFor(() => expect(combined?.b.payload).toEqual({ v: 20 }));
    expect(combined!.a.payload).toEqual({ v: 10 });
  });

  it("unsubscribes on unmount (cleanup)", async () => {
    let publish!: (s: DerivedSignal) => void;
    let renders = 0;
    function Probe() {
      const { ready, signals } = useTfloContext();
      publish = (s) => signals.publish(s.name, s);
      useCombineLatest(["a"]);
      renders += 1;
      return <div data-testid="ready">{String(ready)}</div>;
    }
    const { unmount } = render(
      <TfloProvider>
        <Probe />
      </TfloProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    await act(async () => {
      publish(sig("a", 1, { v: 1 }));
    });
    const before = renders;
    unmount();
    // Publishing after unmount must not trigger any further work/renders.
    await act(async () => {
      publish(sig("a", 2, { v: 2 }));
      publish(sig("a", 3, { v: 3 }));
    });
    expect(renders).toBe(before);
  });

  it("is deterministic over a given input ordering", async () => {
    const SEQ: DerivedSignal[] = [
      sig("a", 1, { v: 1 }),
      sig("b", 2, { v: 2 }),
      sig("a", 3, { v: 3 }),
      sig("b", 4, { v: 4 }),
      sig("a", 5, { v: 5 }),
    ];

    async function run(): Promise<Record<string, DerivedSignal> | undefined> {
      let publish!: (s: DerivedSignal) => void;
      let combined: Record<string, DerivedSignal> | undefined;
      function Probe() {
        const { ready, signals } = useTfloContext();
        publish = (s) => signals.publish(s.name, s);
        combined = useCombineLatest(["a", "b"]);
        return <div data-testid="ready">{String(ready)}</div>;
      }
      render(
        <TfloProvider>
          <Probe />
        </TfloProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
      await act(async () => {
        for (const s of SEQ) publish(s);
      });
      await waitFor(() => expect(combined).not.toBe(undefined));
      cleanup();
      return combined;
    }

    const a = await run();
    const b = await run();
    // Same input ordering -> identical combined latest (a=5, b=4).
    expect(a).toEqual(b);
    expect(a!.a.payload).toEqual({ v: 5 });
    expect(a!.b.payload).toEqual({ v: 4 });
  });
});
