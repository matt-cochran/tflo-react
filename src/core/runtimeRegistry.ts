/**
 * Single owner of compiled patterns + their streaming runtimes. Hooks never
 * hold WASM handles directly — they register/deregister here, and this class
 * frees the handles. Registration is ref-counted so React 18 StrictMode's
 * double-mount does not double-register or double-free.
 */
import type { CompiledPattern, DerivedSignal, PatternRuntime } from "./pattern";
import { PatternRuntime as Runtime } from "./pattern";

export interface RegisterOpts {
  kinds?: string[];
  feedback?: boolean;
}

interface Entry {
  runtime: PatternRuntime<{ ts: number }>;
  refs: number;
  kinds?: Set<string>;
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
      runtime: new Runtime(compiled),
      refs: 1,
      kinds: opts.kinds ? new Set(opts.kinds) : undefined,
    });
    if (opts.feedback) this.feedbackNames.add(compiled.name);
  }

  deregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.refs--;
    if (e.refs <= 0) {
      e.runtime.destroy();
      this.entries.delete(id);
    }
  }

  pushAll(event: { kind?: string; ts: number } & Record<string, unknown>): DerivedSignal[] {
    const out: DerivedSignal[] = [];
    for (const e of this.entries.values()) {
      if (e.kinds && (event.kind === undefined || !e.kinds.has(event.kind))) continue;
      for (const s of e.runtime.push(event as { ts: number })) out.push(s);
    }
    return out;
  }

  /** Reset every runtime to fresh state (drops in-flight partial matches).
   *  Used by deterministic replay — event-time cannot run backwards on a live
   *  runtime, so replay resets first. */
  resetAll(): void {
    for (const e of this.entries.values()) e.runtime.reset();
  }

  isFeedback(signalName: string): boolean {
    return this.feedbackNames.has(signalName);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
  /** Number of live runtimes (for leak assertions in tests). */
  size(): number {
    return this.entries.size;
  }
}
