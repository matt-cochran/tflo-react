import React, { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { useEmit } from "../src/hooks/useEmit";
import { usePattern } from "../src/hooks/usePattern";
import { useSignal } from "../src/hooks/useSignal";
import { Pattern } from "../src/core/pattern";
import {
  renderWithTflo,
  dispatchAndSettle,
  TestClock,
} from "../src/testing/index";

interface Ev extends Record<string, unknown> {
  kind: string;
  ts: number;
}

function rage3(p: Pattern<Ev>) {
  return p
    .timestamp((e) => e.ts)
    .when((e) => e.kind === "click")
    .then((e) => e.kind === "click")
    .within(1000)
    .then((e) => e.kind === "click")
    .within(1000)
    .emit(() => ({ name: "rage", payload: {} }));
}

describe("@tflo/react/testing — deterministic consumer surface", () => {
  // ACCEPTANCE 1: a component dispatches in its MOUNT EFFECT (no manual
  // waitFor / registration gating); using ONLY `settle()` we deterministically
  // observe the resulting signal. The clock is deterministic too.
  it("observes a signal from events fired in a mount effect, via settle() only", async () => {
    let observed: unknown = undefined;

    function App() {
      const dispatch = useEmit<Ev>();
      usePattern<Ev>("rage", rage3, []);
      const sig = useSignal("rage");
      observed = sig;
      // Fire BEFORE ready: these would be dropped without buffer-until-ready.
      useEffect(() => {
        const clock = new TestClock();
        dispatch({ kind: "click", ts: clock.now() });
        dispatch({ kind: "click", ts: clock.advance(200) });
        dispatch({ kind: "click", ts: clock.advance(200) });
      }, [dispatch]);
      return null;
    }

    const { settle } = await renderWithTflo(<App />);
    await settle();

    expect(observed).toBeDefined();
    expect((observed as { name: string }).name).toBe("rage");
  });

  it("dispatchAndSettle drives a pattern post-ready and observes the signal", async () => {
    let observed: unknown = undefined;
    let dispatch!: (e: Ev) => void;

    function App() {
      dispatch = useEmit<Ev>();
      usePattern<Ev>("rage", rage3, []);
      observed = useSignal("rage");
      return null;
    }

    const { settle } = await renderWithTflo(<App />);
    expect(observed).toBeUndefined();

    const clock = new TestClock();
    await dispatchAndSettle<Ev>(dispatch, [
      { kind: "click", ts: clock.now() },
      { kind: "click", ts: clock.advance(200) },
      { kind: "click", ts: clock.advance(200) },
    ]);
    await settle();

    expect((observed as { name: string }).name).toBe("rage");
  });

  it("TestClock is monotonic and rejects backwards motion", () => {
    const clock = new TestClock(100);
    expect(clock.now()).toBe(100);
    expect(clock.advance(50)).toBe(150);
    expect(clock.set(300)).toBe(300);
    clock.reset();
    expect(clock.now()).toBe(100);
    expect(() => clock.advance(-1)).toThrow();
    expect(() => clock.set(50)).toThrow();
  });
});
