import { useSyncExternalStore } from "react";
import { useTfloContext } from "../core/provider";
import type { DerivedSignal } from "../core/pattern";

/** Decoupled consumer: read the latest signal for `name` as reactive state. */
export function useSignal(name: string): DerivedSignal | undefined {
  const { signals } = useTfloContext();
  return useSyncExternalStore(
    (cb) => signals.subscribe(name, cb),
    () => signals.get(name),
    () => undefined,
  );
}
