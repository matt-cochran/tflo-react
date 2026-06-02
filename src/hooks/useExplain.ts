import { useSyncExternalStore } from "react";
import { useTfloContext } from "../core/provider";
import type { TraceNode } from "../core/provenance";

/**
 * Reactive provenance for a signal: returns the causal {@link TraceNode} tree for
 * the LATEST emitted instance of `name`, re-rendering whenever new provenance is
 * recorded. Requires the provider to have opted into `trace`; returns `undefined`
 * when tracing is off or the signal has not fired yet.
 *
 *   const why = useExplain("DeveloperBlocked");
 *   // why?.children → the signals/events that caused it
 */
export function useExplain(name: string): TraceNode | undefined {
  const { trace } = useTfloContext();

  const version = useSyncExternalStore(
    (cb) => (trace ? trace.subscribe(cb) : () => {}),
    () => trace?.getVersion() ?? 0,
    () => 0,
  );

  if (!trace) return undefined;
  // `version` is read so the memo recomputes on each record; the latest ts is
  // resolved from the store at render time.
  void version;
  const ts = trace.latestTs(name);
  return ts === undefined ? undefined : trace.explain(name, ts);
}
