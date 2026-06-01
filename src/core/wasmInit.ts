/**
 * Idempotent async initialization of both tflo WASM modules:
 * - `cep`  — pattern matching (WasmPattern / WasmPatternRuntime)
 * - `ops`  — windows / joins / indicators (JSON-in/JSON-out bridge)
 *
 * Concurrent callers share a single in-flight promise. SSR-safe: nothing
 * touches `window` or the wasm binary at import time — only when `initTflo()`
 * is called.
 *
 * The packages are built with `wasm-pack --target web`, whose default init
 * `fetch()`es the `.wasm` by URL. That works in browsers/bundlers but not in
 * Node (vitest), so under Node we read the `.wasm` bytes and pass them to init
 * directly (the web target accepts a `BufferSource`).
 */
import initCep from "../wasm/cep/tflo_cep_wasm.js";
import initOps from "../wasm/ops/tflo_wasm.js";

let inflight: Promise<void> | null = null;

const isNode =
  typeof process !== "undefined" && !!(process as { versions?: { node?: string } }).versions?.node;

async function nodeBytes(relPath: string): Promise<Uint8Array> {
  const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  const { fileURLToPath } = await import(/* @vite-ignore */ "node:url");
  const path = fileURLToPath(new URL(relPath, import.meta.url));
  return readFile(path);
}

async function initOne(
  init: (input?: unknown) => Promise<unknown>,
  relWasm: string,
): Promise<void> {
  if (isNode) {
    await init({ module_or_path: await nodeBytes(relWasm) });
  } else {
    await init();
  }
}

export function initTflo(): Promise<void> {
  if (!inflight) {
    inflight = Promise.all([
      initOne(initCep as never, "../wasm/cep/tflo_cep_wasm_bg.wasm"),
      initOne(initOps as never, "../wasm/ops/tflo_wasm_bg.wasm"),
    ]).then(() => undefined);
  }
  return inflight;
}

/** Test/HMR helper: forget the cached init promise. */
export function __resetTfloInitForTests(): void {
  inflight = null;
}
