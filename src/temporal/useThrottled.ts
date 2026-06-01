import { useEffect, useRef, useState } from "react";

/**
 * Returns `value` at most once per `ms` (leading + trailing edge). Replaces a
 * hand-rolled throttle.
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const last = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - last.current;
    if (elapsed >= ms) {
      last.current = now;
      setThrottled(value);
      return;
    }
    const id = setTimeout(() => {
      last.current = Date.now();
      setThrottled(value);
    }, ms - elapsed);
    return () => clearTimeout(id);
  }, [value, ms]);

  return throttled;
}
