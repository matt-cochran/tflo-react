/**
 * `Clock` — the injected time source that drives the self-driving deadlines.
 *
 * The engine is pure: it never reads a clock (that would break replay +
 * cross-tier parity). Instead the consumer **injects a clock** into the provider,
 * and that one clock does two jobs so they can never diverge:
 *   1. stamps events that omit a `ts` (`useEmit`), and
 *   2. drives the deadline wake-ups (`schedule`).
 *
 * It's the RxJS-`Scheduler` shape (`now` + `schedule`), the standard way to make
 * time both swappable and testable:
 *   - {@link systemClock} — wall-clock + `setTimeout`. Live apps.
 *   - {@link ManualClock} — virtual time the consumer advances. Tests, replay,
 *     and time-scrubbing demos (advancing the scrubber drives the deadlines).
 *
 * Inject none and the bus does not self-drive — the host calls `bus.tick(now)`
 * itself, and omitted-`ts` events fall back to `performance.now()`.
 */
export interface Clock {
  /** Current time in ms. Stamps omitted-`ts` events AND anchors deadline waits. */
  now(): number;
  /**
   * Run `work` when the clock reaches absolute time `at` (ms). Returns a cancel
   * function. Live clocks use a real timer; virtual clocks queue `work` and fire
   * it when the consumer advances past `at`.
   */
  schedule(at: number, work: () => void): () => void;
}

/** Wall-clock + `setTimeout`. The clock to inject for live apps. */
export const systemClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  schedule: (at, work) => {
    if (typeof setTimeout === "undefined") return () => {}; // SSR / no timers
    const delay = Math.max(0, at - systemClock.now());
    const id = setTimeout(work, delay);
    return () => clearTimeout(id);
  },
};

/**
 * Deterministic, manually-advanced clock. Time only moves when the consumer
 * calls {@link advance}/{@link advanceTo}, which fires any deadline work that has
 * come due, in time order. Inject this for tests, replay, and time-scrubbing
 * demos — a `ManualClock`-driven run is byte-identical across replays and tiers.
 */
export class ManualClock implements Clock {
  private t: number;
  private queue: Array<{ at: number; work: () => void }> = [];

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  schedule(at: number, work: () => void): () => void {
    const entry = { at, work };
    this.queue.push(entry);
    return () => {
      this.queue = this.queue.filter((e) => e !== entry);
    };
  }

  /** Advance virtual time to absolute `t`, firing all due work in time order. */
  advanceTo(t: number): void {
    this.t = t;
    // Fire due entries oldest-first; a fired job may schedule new work (e.g. a
    // re-armed deadline), which is re-evaluated against the same `t`.
    for (;;) {
      const idx = this.queue
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.at <= t)
        .sort((a, b) => a.e.at - b.e.at)[0];
      if (!idx) break;
      this.queue.splice(idx.i, 1);
      idx.e.work();
    }
  }

  /** Advance virtual time by `dt` ms. */
  advance(dt: number): void {
    this.advanceTo(this.t + dt);
  }
}
