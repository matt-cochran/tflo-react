/**
 * `tflo-react/testing` — a deterministic testing surface so consumers never
 * hand-roll registration gating (`waitFor(() => runtimes.size() > 0)`).
 *
 * The engine initializes asynchronously and patterns register in effects, so a
 * naive `dispatch(...)` in a test races the engine coming up. This module hides
 * that: `renderWithTflo` resolves only after the engine is `ready` (and the
 * pre-ready buffer has drained), and `settle()` flushes pending React effects +
 * microtasks so `dispatch(...); await settle();` deterministically observes the
 * resulting signals.
 *
 * `@testing-library/react` is a test-only peer/dev dependency of this entry —
 * it is never pulled into the main `tflo-react` bundle.
 */
import * as React from "react";
import { act, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import {
  TfloProvider,
  useTfloContext,
  type InitFn,
  type TfloContextValue,
} from "../core/provider";

export interface RenderWithTfloOptions {
  /** Extra wrapper rendered INSIDE the TfloProvider (e.g. a router/theme). */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
  /** Override the engine init (e.g. to test the failure path). */
  init?: InitFn;
  /** Passed through to @testing-library/react's `render`. */
  renderOptions?: Omit<RenderOptions, "wrapper">;
}

export interface RenderWithTfloResult extends RenderResult {
  /**
   * Flush pending React effects + microtasks (and drain the bus buffer) so a
   * subsequent assertion sees the settled signal state. Use as
   * `dispatch(...); await result.settle();`.
   */
  settle: () => Promise<void>;
  /**
   * The live `TfloContextValue` (bus / signals / runtimes / ready / error).
   * Captured from inside the provider; available after the returned promise
   * resolves.
   */
  ctx: TfloContextValue;
}

/**
 * Flush pending React effects plus the microtask queue. Wrapping in `act`
 * ensures state updates and effect callbacks have run; the awaited
 * `Promise.resolve()` lets any queued microtasks (including the bus buffer
 * drain, which is synchronous inside the provider's ready effect) settle.
 *
 * Standalone export so a test that rendered with plain `render` can still use
 * the same deterministic flush.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Render `ui` inside a `TfloProvider` and resolve ONLY once the engine is ready
 * (or init errored — in which case `ctx.error` is set and the caller can assert
 * the failure path without hanging). Returns the RTL result plus `settle()` and
 * the live `ctx`.
 */
export async function renderWithTflo(
  ui: React.ReactElement,
  options: RenderWithTfloOptions = {},
): Promise<RenderWithTfloResult> {
  const { wrapper: Inner, init, renderOptions } = options;
  const capturedRef: { current: TfloContextValue | null } = { current: null };

  function Capture({ children }: { children: React.ReactNode }) {
    capturedRef.current = useTfloContext();
    return React.createElement(React.Fragment, null, children);
  }

  function Wrapper({ children }: { children: React.ReactNode }) {
    const inner = Inner
      ? React.createElement(Inner, null, children)
      : children;
    return React.createElement(TfloProvider, {
      init,
      children: React.createElement(Capture, null, inner),
    });
  }

  let result!: RenderResult;
  await act(async () => {
    result = render(ui, { ...renderOptions, wrapper: Wrapper });
  });

  // Wait until the engine is ready (buffer drained) or init failed. Bounded so a
  // genuinely stuck init surfaces as a test timeout rather than an infinite loop.
  const deadline = Date.now() + 10_000;
  const isSettled = () => {
    const c = capturedRef.current;
    return !!c && (c.ready || c.error !== null);
  };
  while (!isSettled()) {
    if (Date.now() > deadline) {
      throw new Error("renderWithTflo: engine did not become ready within 10s");
    }
    await settle();
  }

  return Object.assign(result, {
    settle,
    ctx: capturedRef.current as TfloContextValue,
  });
}

/**
 * Dispatch a list of events through `dispatch` then `await settle()`. Convenience
 * for the common `events.forEach(dispatch); await settle()` shape.
 */
export async function dispatchAndSettle<E>(
  dispatch: (event: E) => void,
  events: E[],
): Promise<void> {
  await act(async () => {
    for (const e of events) dispatch(e);
    await Promise.resolve();
  });
}

/**
 * Deterministic event-time clock for stamping test events. Monotonic by
 * construction: `now()` returns the current value without advancing; `advance`
 * moves it forward (throws on negative deltas to preserve monotonicity); `set`
 * jumps to an absolute time (must not go backwards); `reset` returns to the
 * start value.
 *
 * Use it to build event `ts` values so tests don't depend on wall-clock time:
 *   const clock = new TestClock();
 *   dispatch({ kind: "click", ts: clock.now() });
 *   dispatch({ kind: "click", ts: clock.advance(200) });
 */
export class TestClock {
  private current: number;
  constructor(private readonly start = 0) {
    this.current = start;
  }
  /** Current event time (does not advance). */
  now(): number {
    return this.current;
  }
  /** Advance by `ms` (>= 0) and return the new time. */
  advance(ms: number): number {
    if (ms < 0) throw new Error(`TestClock.advance: negative delta ${ms} breaks monotonicity`);
    this.current += ms;
    return this.current;
  }
  /** Jump to an absolute time (must be >= current) and return it. */
  set(ms: number): number {
    if (ms < this.current) {
      throw new Error(`TestClock.set: ${ms} < current ${this.current} breaks monotonicity`);
    }
    this.current = ms;
    return this.current;
  }
  /** Reset to the start value. */
  reset(): void {
    this.current = this.start;
  }
}
