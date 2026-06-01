import { useEffect, useRef, useState } from "react";

export interface AsyncGuardOpts {
  /** Emit `timedOut` if no response arrives within this many ms. */
  timeoutMs?: number;
}

export interface AsyncGuardState<O> {
  data?: O;
  loading: boolean;
  timedOut: boolean;
  error?: unknown;
}

/**
 * Runs `fn(input)` whenever `input` changes, and — this is the point — drops
 * stale responses (a slower earlier request can never overwrite a newer one)
 * and surfaces a timeout. This is the validated fix for the #1 `useEffect`
 * async footgun, made declarative.
 */
export function useAsyncGuard<I, O>(
  input: I,
  fn: (input: I) => Promise<O>,
  opts: AsyncGuardOpts = {},
): AsyncGuardState<O> {
  const [state, setState] = useState<AsyncGuardState<O>>({ loading: false, timedOut: false });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, timedOut: false, error: undefined }));

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs != null) {
      timer = setTimeout(() => {
        if (mine === seq.current) setState({ loading: false, timedOut: true });
      }, opts.timeoutMs);
    }

    fnRef.current(input).then(
      (data) => {
        if (mine === seq.current) {
          setState({ data, loading: false, timedOut: false });
          if (timer) clearTimeout(timer);
        }
      },
      (error) => {
        if (mine === seq.current) {
          setState({ loading: false, timedOut: false, error });
          if (timer) clearTimeout(timer);
        }
      },
    );

    return () => {
      if (timer) clearTimeout(timer);
    };
    // input change drives re-run; fn is held in a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, opts.timeoutMs]);

  return state;
}
