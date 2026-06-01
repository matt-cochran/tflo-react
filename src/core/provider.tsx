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
import { RuntimeRegistry } from "./runtimeRegistry";
import { SignalRegistry } from "./signalRegistry";
import { initTflo } from "./wasmInit";

export interface TfloContextValue {
  bus: EventBus;
  signals: SignalRegistry;
  runtimes: RuntimeRegistry;
  ready: boolean;
}

const Ctx = createContext<TfloContextValue | null>(null);

function makeContext(ready: boolean): TfloContextValue {
  const signals = new SignalRegistry();
  const runtimes = new RuntimeRegistry();
  const bus = new EventBus(runtimes, signals);
  return { bus, signals, runtimes, ready };
}

/** Root provider: initializes the WASM engine once, owns the bus + registries. */
export function TfloProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const ref = useRef<TfloContextValue | null>(null);
  if (!ref.current) ref.current = makeContext(false);

  useEffect(() => {
    let alive = true;
    void initTflo().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<TfloContextValue>(
    () => ({ ...(ref.current as TfloContextValue), ready }),
    [ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Nested, isolated event space for a subtree (its own bus + registries). */
export function TfloScope({ children }: { children: React.ReactNode }) {
  const parent = useContext(Ctx);
  const ref = useRef<TfloContextValue | null>(null);
  if (!ref.current) ref.current = makeContext(parent?.ready ?? false);

  const value = useMemo<TfloContextValue>(
    () => ({ ...(ref.current as TfloContextValue), ready: parent?.ready ?? false }),
    [parent?.ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTfloContext(): TfloContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("tflo hooks must be used within <TfloProvider>");
  return ctx;
}
