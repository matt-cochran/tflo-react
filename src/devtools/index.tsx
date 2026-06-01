/**
 * @tflo/react/devtools — a dev-only panel for "why did (didn't) my pattern
 * fire?". Shows live derived signals, the count of registered pattern runtimes,
 * the recorded event count, and a deterministic-replay button. Because the
 * engine is deterministic, replaying re-derives the exact same signals.
 *
 * Import only in development; it is a separate entry point so it never lands in
 * a production bundle unless you ask for it.
 */
import React, { useEffect, useState } from "react";
import { useTfloContext } from "../core/provider";
import { useRecorder } from "../hooks/useRecorder";
import type { DerivedSignal } from "../core/pattern";

export interface DevtoolsState {
  signalLog: Array<{ name: string; signal: DerivedSignal }>;
  runtimeCount: number;
  recordedCount: number;
  replay: () => void;
  clear: () => void;
}

/** Headless devtools state — wire it into your own UI if you prefer. */
export function useTfloDevtools(): DevtoolsState {
  const { signals, runtimes } = useTfloContext();
  const recorder = useRecorder();
  const [signalLog, setSignalLog] = useState<Array<{ name: string; signal: DerivedSignal }>>([]);

  useEffect(
    () => signals.subscribeAll((name, signal) => setSignalLog((l) => [...l, { name, signal }])),
    [signals],
  );

  return {
    signalLog,
    runtimeCount: runtimes.size(),
    recordedCount: recorder.events().length,
    replay: recorder.replay,
    clear: () => {
      recorder.clear();
      setSignalLog([]);
    },
  };
}

/** Drop-in floating panel. */
export function TfloDevtools(): React.ReactElement {
  const d = useTfloDevtools();
  return (
    <div
      data-testid="tflo-devtools"
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        font: "12px ui-monospace, monospace",
        background: "#0b0b0c",
        color: "#7CFC9B",
        border: "1px solid #1f1f24",
        borderRadius: 6,
        padding: 10,
        minWidth: 180,
        zIndex: 99999,
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 4 }}>tflo devtools</div>
      <div>runtimes: {d.runtimeCount}</div>
      <div>recorded: {d.recordedCount}</div>
      <div data-testid="tflo-devtools-signals">signals: {d.signalLog.length}</div>
      <ul style={{ margin: "4px 0", padding: 0, listStyle: "none", maxHeight: 120, overflow: "auto" }}>
        {d.signalLog.slice(-10).map((s, i) => (
          <li key={i}>
            {Math.round(s.signal.ts)} · {s.name}
          </li>
        ))}
      </ul>
      <button type="button" onClick={d.replay} style={{ marginRight: 6 }}>
        replay
      </button>
      <button type="button" onClick={d.clear}>
        clear
      </button>
    </div>
  );
}
