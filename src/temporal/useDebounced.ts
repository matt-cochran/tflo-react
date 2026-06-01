import { useEffect, useState } from "react";

/**
 * Returns `value` only after it has stopped changing for `ms`. Replaces the
 * hand-rolled `setTimeout` + ref + cleanup debounce (and its stale-closure
 * bugs) with one declarative call.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
