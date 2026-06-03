"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EventBus } from "./eventBus";
import { TraceStore } from "./provenance";
import { RuntimeRegistry } from "./runtimeRegistry";
import { SignalRegistry } from "./signalRegistry";
import { initTflo } from "./wasmInit";

export interface TfloContextValue {
  bus: EventBus;
  signals: SignalRegistry;
  runtimes: RuntimeRegistry;
  ready: boolean;
  /**
   * Provenance recorder — present only when `TfloProvider` opted in via `trace`.
   * Read causal trees with `trace.explain(name, ts)` or the `useExplain` hook.
   */
  trace?: TraceStore;
  /**
   * Non-null if WASM init rejected. When set, `ready` stays `false` (the engine
   * never came up). Consumers should render a fallback rather than hang — read
   * it via `useTfloContext().error`. `null` while init is pending or succeeded.
   */
  error: unknown | null;
}

const Ctx = createContext<TfloContextValue | null>(null);

function makeContext(ready: boolean, trace?: boolean, autoClock?: boolean): TfloContextValue {
  const signals = new SignalRegistry();
  const runtimes = new RuntimeRegistry();
  const traceStore = trace ? new TraceStore() : undefined;
  const bus = new EventBus(runtimes, signals, traceStore, autoClock);
  return { bus, signals, runtimes, ready, error: null, trace: traceStore };
}

/**
 * Initialization seam. Defaults to the real WASM init; tests may pass a custom
 * `init` (e.g. a rejecting one) via `TfloProvider`'s `init` prop to exercise the
 * failure path deterministically without touching the WASM modules.
 */
export type InitFn = () => Promise<void>;

/** Root provider: initializes the WASM engine once, owns the bus + registries. */
export function TfloProvider({
  children,
  init = initTflo,
  trace = false,
  autoClock = false,
}: {
  children: React.ReactNode;
  /** Override the engine init (test seam); defaults to the real WASM init. */
  init?: InitFn;
  /**
   * Opt into provenance recording. When `true`, every emitted signal's
   * `payload.causes` and every raw event are logged to a `TraceStore` exposed on
   * `useTfloContext().trace` (and the `useExplain` hook). Off by default — zero
   * overhead when unused.
   */
  trace?: boolean;
  /**
   * Opt into the self-driving clock so "A then no B within T" rules fire on
   * absence with no event. Assumes event-time is wall-clock-ms (stamp events with
   * real timestamps). Off by default — apps using logical timestamps drive
   * `useTfloContext().bus.tick(now)` themselves.
   */
  autoClock?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const ref = useRef<TfloContextValue | null>(null);
  if (!ref.current) ref.current = makeContext(false, trace, autoClock);

  useEffect(() => {
    let alive = true;
    void init().then(
      () => {
        if (alive) setReady(true);
      },
      (err: unknown) => {
        // Init rejected: surface the error and leave ready=false so the app can
        // render a fallback instead of hanging silently.
        if (alive) setError(err ?? new Error("tflo WASM init failed"));
      },
    );
    return () => {
      alive = false;
      // Clear any pending self-driving clock timer so it can't fire post-unmount.
      ref.current?.bus.dispose();
    };
    // `init` is intentionally read once on mount; changing it mid-life is unsupported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drain the pre-ready event buffer once the engine is ready. This effect runs
  // AFTER child mount effects in the same commit (React fires child effects
  // before parent effects), so any `usePattern` registration triggered by
  // `ready` flipping has already executed — covering the same-commit
  // registration race, not just the pre-ready window.
  useEffect(() => {
    if (ready) ref.current!.bus.open();
  }, [ready]);

  const value = useMemo<TfloContextValue>(
    () => ({ ...(ref.current as TfloContextValue), ready, error }),
    [ready, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Nested, isolated event space for a subtree (its own bus + registries). */
export function TfloScope({ children }: { children: React.ReactNode }) {
  const parent = useContext(Ctx);
  const ref = useRef<TfloContextValue | null>(null);
  if (!ref.current) ref.current = makeContext(parent?.ready ?? false);

  const ready = parent?.ready ?? false;

  useEffect(() => {
    if (ready) ref.current!.bus.open();
  }, [ready]);

  const value = useMemo<TfloContextValue>(
    () => ({ ...(ref.current as TfloContextValue), ready, error: parent?.error ?? null }),
    [ready, parent?.error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTfloContext(): TfloContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("tflo hooks must be used within <TfloProvider>");
  return ctx;
}
