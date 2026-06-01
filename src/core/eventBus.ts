/**
 * Source-agnostic event bus. `dispatch` pushes an event into every registered
 * pattern runtime; emitted signals are published to the signal registry, and
 * (for patterns that opted into `feedback`) re-dispatched as `kind:"signal"`
 * events so higher-order patterns can match derived signals. Re-entry is
 * depth-limited so a feedback cycle halts.
 */
import type { RuntimeRegistry } from "./runtimeRegistry";
import type { SignalRegistry } from "./signalRegistry";

const MAX_FEEDBACK_DEPTH = 8;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

type Tap = (event: { ts: number; kind?: string } & Record<string, unknown>) => void;

export class EventBus {
  private taps = new Set<Tap>();

  constructor(
    private readonly runtimes: RuntimeRegistry,
    private readonly signals: SignalRegistry,
  ) {}

  /** Observe every dispatched event (used by building blocks like useWindow). */
  tap(fn: Tap): () => void {
    this.taps.add(fn);
    return () => {
      this.taps.delete(fn);
    };
  }

  /** Reset all pattern runtimes to fresh state (used by replay). */
  reset(): void {
    this.runtimes.resetAll();
  }

  dispatch(event: Record<string, unknown> & { kind?: string; ts?: number }, depth = 0): void {
    const ev =
      typeof event.ts === "number" ? (event as { ts: number; kind?: string }) : { ...event, ts: now() };
    for (const tap of [...this.taps]) tap(ev as { ts: number; kind?: string });
    const emitted = this.runtimes.pushAll(ev as { ts: number; kind?: string });
    for (const signal of emitted) this.signals.publish(signal.name, signal);

    if (depth < MAX_FEEDBACK_DEPTH) {
      for (const signal of emitted) {
        if (this.runtimes.isFeedback(signal.name)) {
          this.dispatch(
            { kind: "signal", name: signal.name, ts: signal.ts, payload: signal.payload },
            depth + 1,
          );
        }
      }
    }
  }
}
