import { describe, expect, it } from "vitest";
import { EventBus, MAX_BUFFER } from "../src/core/eventBus";
import { RuntimeRegistry } from "../src/core/runtimeRegistry";
import { SignalRegistry } from "../src/core/signalRegistry";

// ACCEPTANCE 4: a direct unit test of buffer-until-ready — events dispatched
// before `open()` are delivered, in original order, after `open()`.

function makeBus() {
  const runtimes = new RuntimeRegistry();
  const signals = new SignalRegistry();
  const bus = new EventBus(runtimes, signals);
  return { bus };
}

describe("EventBus buffer-until-ready (Gap 1)", () => {
  it("queues pre-open events and drains them in order on open(), preserving ts", () => {
    const { bus } = makeBus();
    const seen: Array<{ ts: number; kind?: string }> = [];
    bus.tap((e) => seen.push(e));

    // While buffering, taps must NOT fire.
    bus.dispatch({ kind: "a", ts: 10 });
    bus.dispatch({ kind: "b", ts: 20 });
    bus.dispatch({ kind: "c", ts: 30 });
    expect(seen).toEqual([]);
    expect(bus.buffering).toBe(true);
    expect(bus.pending).toBe(3);

    bus.open();

    // Drained in original order with original timestamps.
    expect(seen.map((e) => e.kind)).toEqual(["a", "b", "c"]);
    expect(seen.map((e) => e.ts)).toEqual([10, 20, 30]);
    expect(bus.buffering).toBe(false);
    expect(bus.pending).toBe(0);
  });

  it("delivers synchronously after open() (no further buffering)", () => {
    const { bus } = makeBus();
    const seen: string[] = [];
    bus.tap((e) => seen.push(String(e.kind)));

    bus.open();
    bus.dispatch({ kind: "live1", ts: 1 });
    bus.dispatch({ kind: "live2", ts: 2 });

    expect(seen).toEqual(["live1", "live2"]);
  });

  it("preserves order across the boundary: buffered then live", () => {
    const { bus } = makeBus();
    const seen: string[] = [];
    bus.tap((e) => seen.push(String(e.kind)));

    bus.dispatch({ kind: "pre1", ts: 1 });
    bus.dispatch({ kind: "pre2", ts: 2 });
    bus.open();
    bus.dispatch({ kind: "post1", ts: 3 });

    expect(seen).toEqual(["pre1", "pre2", "post1"]);
  });

  it("open() is idempotent", () => {
    const { bus } = makeBus();
    const seen: string[] = [];
    bus.tap((e) => seen.push(String(e.kind)));
    bus.dispatch({ kind: "x", ts: 1 });
    bus.open();
    bus.open(); // no-op, must not re-deliver
    expect(seen).toEqual(["x"]);
  });

  it("caps the buffer at MAX_BUFFER, dropping oldest and counting drops", () => {
    const { bus } = makeBus();
    const seen: number[] = [];
    bus.tap((e) => seen.push(e.ts));

    const overflow = 5;
    for (let i = 0; i < MAX_BUFFER + overflow; i++) {
      bus.dispatch({ kind: "k", ts: i });
    }
    expect(bus.pending).toBe(MAX_BUFFER);
    expect(bus.droppedCount).toBe(overflow);

    bus.open();
    // The oldest `overflow` were dropped; the newest MAX_BUFFER survive in order.
    expect(seen.length).toBe(MAX_BUFFER);
    expect(seen[0]).toBe(overflow);
    expect(seen[seen.length - 1]).toBe(MAX_BUFFER + overflow - 1);
  });
});
