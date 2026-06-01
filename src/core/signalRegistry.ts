/**
 * Per-signal-name external store, designed for `useSyncExternalStore`.
 * Retains the latest signal per name (replayed to late subscribers) and
 * notifies only the subscribers for that name — no global re-render.
 */
import type { DerivedSignal } from "./pattern";

type Listener = () => void;

export class SignalRegistry {
  private latest = new Map<string, DerivedSignal>();
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<(name: string, signal: DerivedSignal) => void>();

  subscribe(name: string, fn: Listener): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  /** Subscribe to every signal (any name) — used by the devtools. */
  subscribeAll(fn: (name: string, signal: DerivedSignal) => void): () => void {
    this.globalListeners.add(fn);
    return () => {
      this.globalListeners.delete(fn);
    };
  }

  get(name: string): DerivedSignal | undefined {
    return this.latest.get(name);
  }

  names(): string[] {
    return [...this.latest.keys()];
  }

  /** Stable SSR snapshot — identical on server and first client paint. */
  getServerSnapshot(): undefined {
    return undefined;
  }

  publish(name: string, signal: DerivedSignal): void {
    this.latest.set(name, signal);
    const set = this.listeners.get(name);
    if (set) for (const fn of [...set]) fn();
    for (const fn of [...this.globalListeners]) fn(name, signal);
  }
}
