import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebounced } from "../src/temporal/useDebounced";
import { useThrottled } from "../src/temporal/useThrottled";
import { useIdle } from "../src/temporal/useIdle";
import { useAsyncGuard } from "../src/temporal/useAsyncGuard";

afterEach(() => vi.useRealTimers());

describe("useDebounced", () => {
  it("emits the value only after it stops changing for ms", () => {
    vi.useFakeTimers();
    function P({ v }: { v: string }) {
      return <div data-testid="d">{useDebounced(v, 300)}</div>;
    }
    const { rerender } = render(<P v="a" />);
    expect(screen.getByTestId("d").textContent).toBe("a");
    rerender(<P v="b" />);
    expect(screen.getByTestId("d").textContent).toBe("a"); // not yet
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("d").textContent).toBe("b");
  });
});

describe("useThrottled", () => {
  it("passes the leading value immediately, trails the rest", () => {
    vi.useFakeTimers();
    function P({ v }: { v: string }) {
      return <div data-testid="t">{useThrottled(v, 300)}</div>;
    }
    const { rerender } = render(<P v="a" />);
    expect(screen.getByTestId("t").textContent).toBe("a");
    rerender(<P v="b" />);
    expect(screen.getByTestId("t").textContent).toBe("a"); // within window → trailing
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("t").textContent).toBe("b");
  });
});

describe("useIdle", () => {
  it("becomes true after ms of no activity and resets on activity", () => {
    vi.useFakeTimers();
    function P({ k }: { k: number }) {
      return <div data-testid="i">{String(useIdle(k, 500))}</div>;
    }
    const { rerender } = render(<P k={0} />);
    expect(screen.getByTestId("i").textContent).toBe("false");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId("i").textContent).toBe("true");
    rerender(<P k={1} />); // activity
    expect(screen.getByTestId("i").textContent).toBe("false");
  });
});

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useAsyncGuard", () => {
  it("drops a stale (earlier) response so it can never overwrite a newer one", async () => {
    const d1 = defer<string>();
    const d2 = defer<string>();
    const calls = [d1, d2];
    let i = 0;

    function P({ input }: { input: number }) {
      const s = useAsyncGuard(input, () => calls[i++].promise);
      return <div data-testid="o">{s.data ?? ""}</div>;
    }
    const { rerender } = render(<P input={1} />);
    rerender(<P input={2} />); // second request in-flight, seq=2

    await act(async () => {
      d2.resolve("fresh");
    });
    expect(screen.getByTestId("o").textContent).toBe("fresh");

    await act(async () => {
      d1.resolve("stale");
    });
    expect(screen.getByTestId("o").textContent).toBe("fresh"); // stale dropped
  });

  it("reports a timeout", () => {
    vi.useFakeTimers();
    function P() {
      const s = useAsyncGuard(1, () => new Promise<string>(() => {}), { timeoutMs: 100 });
      return <div data-testid="to">{String(s.timedOut)}</div>;
    }
    render(<P />);
    expect(screen.getByTestId("to").textContent).toBe("false");
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByTestId("to").textContent).toBe("true");
  });
});
