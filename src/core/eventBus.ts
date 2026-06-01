/**
 * Source-agnostic event bus. `dispatch` pushes an event into every registered
 * pattern runtime; emitted signals are published to the signal registry, and
 * (for patterns that opted into `feedback`) re-dispatched as `kind:"signal"`
 * events so higher-order patterns can match derived signals. Re-entry is
 * depth-limited so a feedback cycle halts.
 *
 * **Buffer-until-ready:** the WASM engine initializes asynchronously, and
 * patterns can only be compiled/registered once it is `ready`. Any event
 * dispatched before then (e.g. fired from a component mount effect) would
 * otherwise be silently dropped against zero runtimes. To prevent that, the bus
 * starts in a *buffering* state: dispatched events are appended to an ordered
 * FIFO (each retaining its original `ts`) instead of being delivered. Once the
 * provider flips `ready` and registrations have flushed, it calls `open()`,
 * which drains the queue in original order, then switches to the normal
 * synchronous delivery path. Feedback/replay/recorder semantics are unchanged
 * after `open()`. The queue is capped (see `MAX_BUFFER`) to avoid unbounded
 * growth; events past the cap are dropped (oldest first) and counted.
 */
import type { RuntimeRegistry } from "./runtimeRegistry";
import type { SignalRegistry } from "./signalRegistry";

const MAX_FEEDBACK_DEPTH = 8;

/**
 * Maximum number of pre-ready events retained in the buffer. If a consumer
 * dispatches more than this before the engine is ready, the oldest events are
 * dropped to bound memory; the count of dropped events is tracked on
 * `droppedCount` for diagnostics.
 */
export const MAX_BUFFER = 10_000;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

type Event = { ts: number; kind?: string } & Record<string, unknown>;
type Tap = (event: Event) => void;

export class EventBus {
  private taps = new Set<Tap>();
  /** Pre-ready FIFO of dispatched events; null once the bus is open. */
  private buffer: Event[] | null = [];
  /** Number of pre-ready events dropped because the buffer cap was hit. */
  droppedCount = 0;

  constructor(
    private readonly runtimes: RuntimeRegistry,
    private readonly signals: SignalRegistry,
  ) {}

  /** True while events are being queued (engine not yet ready). */
  get buffering(): boolean {
    return this.buffer !== null;
  }

  /** Number of events currently queued (0 once open). */
  get pending(): number {
    return this.buffer?.length ?? 0;
  }

  /**
   * Switch from buffering to live delivery: drain the queued events in original
   * order (preserving each event's `ts`), then deliver synchronously from now
   * on. Idempotent — calling it again once open is a no-op.
   */
  open(): void {
    if (this.buffer === null) return;
    const queued = this.buffer;
    this.buffer = null; // deliver() now takes the synchronous path
    for (const ev of queued) this.deliver(ev, 0);
  }

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
    const ev: Event =
      typeof event.ts === "number" ? (event as Event) : { ...event, ts: now() };

    if (this.buffer !== null) {
      // Engine not ready yet — queue in order, preserving ts. Feedback re-entry
      // never reaches here (it only runs inside deliver(), after open()).
      this.buffer.push(ev);
      if (this.buffer.length > MAX_BUFFER) {
        const overflow = this.buffer.length - MAX_BUFFER;
        this.buffer.splice(0, overflow);
        this.droppedCount += overflow;
      }
      return;
    }

    this.deliver(ev, depth);
  }

  /** Synchronous delivery path: taps → runtimes → signals → feedback. */
  private deliver(ev: Event, depth: number): void {
    for (const tap of [...this.taps]) tap(ev);
    const emitted = this.runtimes.pushAll(ev);
    for (const signal of emitted) this.signals.publish(signal.name, signal);

    if (depth < MAX_FEEDBACK_DEPTH) {
      for (const signal of emitted) {
        if (this.runtimes.isFeedback(signal.name)) {
          this.deliver(
            { kind: "signal", name: signal.name, ts: signal.ts, payload: signal.payload },
            depth + 1,
          );
        }
      }
    }
  }
}
