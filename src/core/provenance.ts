/**
 * First-class provenance — "why did this signal fire?"
 *
 * Every derived signal can record what caused it (a list of {@link CauseRef}s).
 * The {@link TraceStore} indexes emitted signals by `(name, ts)`; `explain(name,
 * ts)` walks the recorded `causes` recursively into a {@link TraceNode} tree
 * (signal → its cause signals → … → raw event leaves) that a UI can render.
 *
 * This is **opt-in**: pass `trace` to `TfloProvider` and the bus records every
 * emitted signal's `payload.causes` here (and every raw event as a leaf). Read
 * the tree via `useTfloContext().trace?.explain(name, ts)` or the reactive
 * {@link useExplain} hook.
 *
 * Authoring `causes` is one call: `payload: { causes: causesFrom(m.all()) }`.
 */

/** A single cause: a raw event leaf, or another signal (recursed by `explain`). */
export type CauseRef =
  | { kind: "event"; name: string; ts: number }
  | { kind: "signal"; name: string; ts: number };

/** A node in the provenance tree. `children` are the node's recorded causes. */
export interface TraceNode {
  name: string;
  ts: number;
  kind: "event" | "signal";
  children: TraceNode[];
}

/**
 * Map a match's captured items (`m.all()`) to `CauseRef`s. A re-entered signal
 * (`{ kind:"signal", name, ts }`) becomes a signal cause (so `explain` recurses
 * into it); any other event becomes an event-leaf cause named by its `kind`.
 */
export function causesFrom(
  // Read-only `{ ts, kind?, name? }` — deliberately NOT `Record<string, unknown>`:
  // a discriminated-union *interface* (the common event shape) has no implicit
  // string index signature, so requiring one would reject clean unions (the same
  // footgun as the signal-map constraint). Optional `kind`/`name` keep every
  // event/signal variant assignable while we only read those three fields.
  items: ReadonlyArray<{ ts: number; kind?: unknown; name?: unknown }>,
): CauseRef[] {
  return items.map((e) =>
    e.kind === "signal" && typeof e.name === "string"
      ? { kind: "signal", name: e.name, ts: e.ts }
      : { kind: "event", name: String(e.kind ?? "event"), ts: e.ts },
  );
}

/**
 * Indexes raw events and emitted signals so `explain` can reconstruct the causal
 * tree. Lives in the library (promoted from the demo) so consumers get provenance
 * for free instead of re-implementing it.
 */
export class TraceStore {
  private events: CauseRef[] = [];
  private signals = new Map<string, CauseRef[]>(); // key `${name}@${ts}`
  /** Monotonic version, bumped on every record — drives `useExplain` re-renders. */
  private version = 0;
  private listeners = new Set<() => void>();

  private key = (n: string, ts: number) => `${n}@${ts}`;

  /** Subscribe to record events (used by `useExplain` via useSyncExternalStore). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Opaque version token; changes whenever a record is added or the store resets. */
  getVersion(): number {
    return this.version;
  }

  private bump(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  recordEvent(e: { name: string; ts: number }): void {
    this.events.push({ kind: "event", name: e.name, ts: e.ts });
    this.bump();
  }

  recordSignal(name: string, ts: number, causes: CauseRef[]): void {
    this.signals.set(this.key(name, ts), causes);
    this.bump();
  }

  /** The latest recorded `ts` for a signal name, or undefined if never seen. */
  latestTs(name: string): number | undefined {
    let best: number | undefined;
    for (const k of this.signals.keys()) {
      const at = k.lastIndexOf("@");
      if (k.slice(0, at) !== name) continue;
      const ts = Number(k.slice(at + 1));
      if (best === undefined || ts > best) best = ts;
    }
    return best;
  }

  /** Reconstruct the causal tree for the signal `name` emitted at `ts`. */
  explain(name: string, ts: number): TraceNode {
    const causes = this.signals.get(this.key(name, ts)) ?? [];
    return {
      name,
      ts,
      kind: "signal",
      children: causes.map((c) =>
        c.kind === "signal"
          ? this.explain(c.name, c.ts)
          : { name: c.name, ts: c.ts, kind: "event", children: [] },
      ),
    };
  }

  reset(): void {
    this.events = [];
    this.signals.clear();
    this.bump();
  }
}
