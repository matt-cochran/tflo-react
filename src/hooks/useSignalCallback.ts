import { useEffect, useRef } from "react";
import { useTfloContext } from "../core/provider";
import type { DerivedSignal } from "../core/pattern";

/** Run a side-effect when a signal fires — without causing a re-render. */
export function useSignalCallback(name: string, fn: (s: DerivedSignal) => void): void {
  const { signals } = useTfloContext();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    return signals.subscribe(name, () => {
      const s = signals.get(name);
      if (s) ref.current(s);
    });
  }, [signals, name]);
}
