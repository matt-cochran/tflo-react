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
import type { CompiledPattern, DerivedSignal, PatternRuntime } from "./pattern";
import { PatternRuntime as Runtime } from "./pattern";

type Event = { ts: number; kind?: string } & Record<string, unknown>;

export interface RegisterOpts {
  kinds?: string[];
  feedback?: boolean;
}

interface Entry {
  refs: number;
  kinds?: Set<string>;
  // single
  runtime?: PatternRuntime<{ ts: number }>;
  // partitioned
  factory?: () => CompiledPattern<{ ts: number }>;
  partitionBy?: (e: Event) => unknown;
  partitions?: Map<unknown, PatternRuntime<{ ts: number }>>;
}

export class RuntimeRegistry {
  private entries = new Map<string, Entry>();
  private feedbackNames = new Set<string>();

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
      runtime: new Runtime(compiled),
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
          rt = new Runtime(e.factory());
          e.partitions.set(key, rt);
        }
        for (const s of rt.push(event)) out.push(s);
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
