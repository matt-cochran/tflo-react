import { useCount } from "../hooks/useWindow";

export interface RateLimitOpts {
  /** Max events allowed within the window. */
  limit: number;
  /** Rolling window width in event-time ms. */
  ms: number;
}

export interface RateLimitState {
  count: number;
  blocked: boolean;
}

/**
 * Rate-limit guard, composed over the `useWindow` building block: `blocked`
 * becomes true once `limit` events of `kind` occur within `ms`. Use to gate
 * double-submits / action storms. This is a 1-line composition of a primitive
 * — evidence the primitive is the right shape.
 */
export function useRateLimit(kind: string, opts: RateLimitOpts): RateLimitState {
  const count = useCount(kind, { ms: opts.ms });
  return { count, blocked: count >= opts.limit };
}
