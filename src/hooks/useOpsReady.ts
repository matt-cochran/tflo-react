import { useEffect, useState } from "react";
import { initTfloOps } from "../core/wasmInit";

// Module-level latch so once ops has loaded, later mounts start ready (no flash).
let opsLoaded = false;

/**
 * Triggers lazy load of the `ops` wasm module and reports readiness. Components
 * that call the synchronous ops facades (`windowJoinKeyed`, `tumblingWindow`,
 * `indicators.*`) should gate those calls on this, since ops is no longer
 * loaded at boot (lean-by-default). Returns `true` once ops is initialized.
 */
export function useOpsReady(): boolean {
  const [ready, setReady] = useState(opsLoaded);
  useEffect(() => {
    if (opsLoaded) return;
    let active = true;
    void initTfloOps().then(() => {
      opsLoaded = true;
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return ready;
}
