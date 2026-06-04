import { useCallback, useEffect, useRef } from "react";
import { useTfloContext } from "../core/provider";

export interface RecorderOpts {
  /** Cap on retained events (memory bound). */
  maxEvents?: number;
}

export interface Recorder {
  /** The recorded events, in dispatch order. */
  events: () => Array<{ ts: number; kind?: string } & Record<string, unknown>>;
  /** Re-dispatch every recorded event through the bus (deterministic replay). */
  replay: () => void;
  /**
   * State-as-of-T / roll-back: re-derive the signals as they stood at event-time
   * `t` by replaying only the recorded events whose `ts <= t` (in recorded
   * order). Because the engine is pure, the truncated replay is deterministic and
   * equals "what the system believed at time `t`" — a roll-back, not a guess.
   */
  replayUntil: (t: number) => void;
  /** Clear the recording. */
  clear: () => void;
}

/**
 * Records the event stream so it can be replayed deterministically — the basis
 * for temporal time-travel debugging. Because the engine is deterministic,
 * replaying the recorded events re-derives the exact same signals.
 */
export function useRecorder(opts: RecorderOpts = {}): Recorder {
  const { bus } = useTfloContext();
  const buf = useRef<Array<{ ts: number; kind?: string } & Record<string, unknown>>>([]);
  const replaying = useRef(false);

  useEffect(() => {
    return bus.tap((ev) => {
      // ignore feedback re-entry and re-dispatched events during replay
      if (ev.kind === "signal" || replaying.current) return;
      buf.current.push(ev);
      if (opts.maxEvents && buf.current.length > opts.maxEvents) {
        buf.current.splice(0, buf.current.length - opts.maxEvents);
      }
    });
  }, [bus, opts.maxEvents]);

  const events = useCallback(() => [...buf.current], []);
  const clear = useCallback(() => {
    buf.current = [];
  }, []);
  const replay = useCallback(() => {
    replaying.current = true;
    bus.reset(); // event-time can't run backwards on a live runtime
    for (const ev of [...buf.current]) bus.dispatch(ev);
    replaying.current = false;
  }, [bus]);
  const replayUntil = useCallback(
    (t: number) => {
      // Roll-back to event-time `t`: same as replay(), but truncated at `ts <= t`.
      replaying.current = true;
      bus.reset(); // start from fresh runtimes, then re-derive up to the cutoff
      for (const ev of [...buf.current]) if (ev.ts <= t) bus.dispatch(ev);
      replaying.current = false;
    },
    [bus],
  );

  return { events, replay, replayUntil, clear };
}
