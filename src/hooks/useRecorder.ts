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

  return { events, replay, clear };
}
