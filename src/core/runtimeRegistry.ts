/**
 * Single owner of compiled patterns + their streaming runtimes. Hooks never
 * hold WASM handles directly — they register/deregister here, and this class
 * frees the handles. Registration is ref-counted so React 18 StrictMode's
 * double-mount does not double-register or double-free.
 *
 * A pattern may be **partitioned**: given a `partitionBy` key function, the
 * registry lazily maintains one runtime per key, so a single `usePattern`
 * correctly tracks many concurrent entities (the CEP engine's per-step
 * predicates can't correlate a field across steps on their own — partitioning
 * gives each entity its own isolated partial-match state).
 */
import type { CompiledPattern, DerivedSignal, DropReason, PatternRuntime } from "./pattern";
import { PatternRuntime as Runtime } from "./pattern";

type Event = { ts: number; kind?: string } & Record<string, unknown>;

export interface RegisterOpts {
  kinds?: string[];
  feedback?: boolean;
  /**
   * Enable the event-time reorder buffer for this pattern: events arriving up to
   * `maxLateness` ms out of order are released to the matcher in event-time order
   * (later ones drop as `"late"`). Off by default — most in-order live streams
   * don't need it, and a watermark trades latency for out-of-order correctness.
   */
  reorder?: { maxLateness: number };
}

/**
 * Aggregate drop accounting across every runtime the registry owns — the
 * observable-backpressure surface (B3). `total` always equals
 * `maxInFlight + deadline`. Monotonic for the registry's lifetime.
 */
export interface DropMetrics {
  total: number;
  maxInFlight: number;
  deadline: number;
  /** Events dropped behind the reorder buffer's event-time frontier (too late). */
  late: number;
}

type DropListener = () => void;

interface Entry {
  refs: number;
  kinds?: Set<string>;
  // single
  runtime?: PatternRuntime<{ ts: number }>;
  // partitioned
  factory?: () => CompiledPattern<{ ts: number }>;
  partitionBy?: (e: Event) => unknown;
  partitions?: Map<unknown, PatternRuntime<{ ts: number }>>;
  /** Reorder lateness applied to this pattern's runtime(s), if opted in. */
  maxLateness?: number;
}

export class RuntimeRegistry {
  private entries = new Map<string, Entry>();
  private feedbackNames = new Set<string>();

  // Observable-backpressure surface (B3): a single per-reason tally fed by every
  // runtime's drop handler, with `useSyncExternalStore`-shaped subscriptions so a
  // hook re-renders when drops occur.
  private drops: DropMetrics = { total: 0, maxInFlight: 0, deadline: 0, late: 0 };
  private dropListeners = new Set<DropListener>();

  /** Build a runtime with its drop handler funnelling into the shared tally. */
  private makeRuntime(
    compiled: CompiledPattern<{ ts: number }>,
    maxLateness?: number,
  ): PatternRuntime<{ ts: number }> {
    const rt = new Runtime(compiled, maxLateness);
    rt.onDrop((reason: DropReason) => this.recordDrop(reason));
    return rt;
  }

  private recordDrop(reason: DropReason): void {
    this.drops.total++;
    if (reason === "max_in_flight") this.drops.maxInFlight++;
    else if (reason === "deadline") this.drops.deadline++;
    else if (reason === "late") this.drops.late++;
    for (const fn of [...this.dropListeners]) fn();
  }

  /** Subscribe to drop-count changes (any reason). Returns an unsubscribe fn. */
  subscribeDrops(fn: DropListener): () => void {
    this.dropListeners.add(fn);
    return () => {
      this.dropListeners.delete(fn);
    };
  }

  /**
   * Current aggregate drop counts (per-reason + total). Returns a fresh object
   * each call; the `useDropMetrics` hook caches it so `useSyncExternalStore`
   * sees a stable reference until the counts actually change.
   */
  dropMetrics(): DropMetrics {
    return { ...this.drops };
  }

  register(id: string, compiled: CompiledPattern<{ ts: number }>, opts: RegisterOpts = {}): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.refs++;
      compiled.destroy(); // duplicate (StrictMode); keep the first runtime
      return;
    }
    this.entries.set(id, {
      refs: 1,
      kinds: opts.kinds ? new Set(opts.kinds) : undefined,
      runtime: this.makeRuntime(compiled, opts.reorder?.maxLateness),
    });
    if (opts.feedback) this.feedbackNames.add(compiled.name);
  }

  registerPartitioned(
    id: string,
    name: string,
    factory: () => CompiledPattern<{ ts: number }>,
    partitionBy: (e: Event) => unknown,
    opts: RegisterOpts = {},
  ): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.refs++;
      return;
    }
    this.entries.set(id, {
      refs: 1,
      kinds: opts.kinds ? new Set(opts.kinds) : undefined,
      factory,
      partitionBy,
      partitions: new Map(),
      maxLateness: opts.reorder?.maxLateness,
    });
    if (opts.feedback) this.feedbackNames.add(name);
  }

  deregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.refs--;
    if (e.refs > 0) return;
    e.runtime?.destroy();
    if (e.partitions) for (const rt of e.partitions.values()) rt.destroy();
    this.entries.delete(id);
  }

  pushAll(event: Event): DerivedSignal[] {
    const out: DerivedSignal[] = [];
    for (const e of this.entries.values()) {
      if (e.kinds && (event.kind === undefined || !e.kinds.has(event.kind))) continue;
      if (e.runtime) {
        for (const s of e.runtime.push(event)) out.push(s);
      } else if (e.partitions && e.partitionBy && e.factory) {
        const key = e.partitionBy(event);
        if (key === undefined || key === null) continue;
        let rt = e.partitions.get(key);
        if (!rt) {
          rt = this.makeRuntime(e.factory(), e.maxLateness);
          e.partitions.set(key, rt);
        }
        for (const s of rt.push(event)) out.push(s);
      }
    }
    return out;
  }

  /**
   * The earliest pending deadline (ms) across every owned runtime + partition,
   * or `undefined` if nothing is waiting on a timer. The bus's clock driver
   * schedules its next {@link tickAll} for this instant.
   */
  nextDeadline(): number | undefined {
    let min: number | undefined;
    for (const e of this.entries.values()) {
      const d = e.runtime?.nextDeadline;
      if (d !== undefined && (min === undefined || d < min)) min = d;
      if (e.partitions) {
        for (const rt of e.partitions.values()) {
          const pd = rt.nextDeadline;
          if (pd !== undefined && (min === undefined || pd < min)) min = pd;
        }
      }
    }
    return min;
  }

  /**
   * Advance every owned runtime + partition to `now` WITHOUT an event, firing
   * deadline-reached derived matches on absence. Returns the emitted signals (the
   * bus routes them through the same publish + feedback path as `pushAll`).
   */
  tickAll(now: number): DerivedSignal[] {
    const out: DerivedSignal[] = [];
    for (const e of this.entries.values()) {
      if (e.runtime) {
        for (const s of e.runtime.tick(now)) out.push(s);
      }
      if (e.partitions) {
        for (const rt of e.partitions.values()) {
          for (const s of rt.tick(now)) out.push(s);
        }
      }
    }
    return out;
  }

  /** Reset every runtime to fresh state (used by deterministic replay). */
  resetAll(): void {
    for (const e of this.entries.values()) {
      e.runtime?.reset();
      if (e.partitions) for (const rt of e.partitions.values()) rt.reset();
    }
  }

  isFeedback(signalName: string): boolean {
    return this.feedbackNames.has(signalName);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Number of registered patterns (for leak assertions). */
  size(): number {
    return this.entries.size;
  }

  /** Total live runtimes, counting per-key partitions (for devtools). */
  runtimeCount(): number {
    let n = 0;
    for (const e of this.entries.values()) {
      n += e.runtime ? 1 : 0;
      n += e.partitions ? e.partitions.size : 0;
    }
    return n;
  }
}
