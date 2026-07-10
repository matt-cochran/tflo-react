/**
 * Idempotent, lazy initialization of the tflo WASM modules.
 *
 * Lean-by-default: the provider only initializes the small `cep` core
 * (~17 KB gzip) at boot. The heavier `ops` module (windows/joins/indicators,
 * ~120 KB gzip) loads ONLY when an ops feature is first used — via the
 * `tflo-react/ops` entry / `initTfloOps()`. The CEL modules load only via
 * `tflo-react/cel`. Each module has its own in-flight promise so concurrent
 * callers share one load and unused modules are never fetched.
 *
 * SSR-safe: nothing touches `window` or a `.wasm` binary at import time — only
 * when an `init*()` is called.
 *
 * The packages are built with `wasm-pack --target web`, whose default init
 * `fetch()`es the `.wasm` by URL (browsers/bundlers). Under Node (vitest) we
 * read the bytes and pass them to init (the web target accepts a BufferSource).
 */
import initCep from "../wasm/cep/tflo_cep_wasm.js";
import initOps from "../wasm/ops/tflo_wasm.js";

const isNode =
  typeof process !== "undefined" && !!(process as { versions?: { node?: string } }).versions?.node;

async function nodeBytes(relPath: string): Promise<Uint8Array> {
  const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  const { fileURLToPath } = await import(/* @vite-ignore */ "node:url");
  const path = fileURLToPath(new URL(relPath, import.meta.url));
  return readFile(path);
}

/**
 * Build a lazy, idempotent initializer for one wasm module. Returns a function
 * that triggers init on first call and returns the shared promise thereafter,
 * plus a reset for tests/HMR.
 */
export function makeLazyInit(
  init: (input?: unknown) => Promise<unknown>,
  relWasm: string,
): { load: () => Promise<void>; reset: () => void } {
  let inflight: Promise<void> | null = null;
  const load = (): Promise<void> => {
    if (!inflight) {
      inflight = (
        isNode ? nodeBytes(relWasm).then((b) => init({ module_or_path: b })) : init()
      ).then(() => undefined);
    }
    return inflight;
  };
  return { load, reset: () => (inflight = null) };
}

const cep = makeLazyInit(initCep as never, "../wasm/cep/tflo_cep_wasm_bg.wasm");
const ops = makeLazyInit(initOps as never, "../wasm/ops/tflo_wasm_bg.wasm");

/** Initialize the lean CEP core. Called by the provider at boot. */
export function initTflo(): Promise<void> {
  return cep.load();
}

/**
 * Initialize the `ops` module (windows / joins / indicators). Lazy: only the
 * `tflo-react/ops` entry and its hooks call this, so apps that never touch
 * ops never fetch its ~120 KB gzip binary.
 */
export function initTfloOps(): Promise<void> {
  return ops.load();
}

/** Test/HMR helper: forget cached init promises. */
export function __resetTfloInitForTests(): void {
  cep.reset();
  ops.reset();
}
