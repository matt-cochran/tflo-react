#!/usr/bin/env bash
# Build the tflo WASM packages consumed by @tflo/react.
#   - tflo-cep-wasm  → src/wasm/cep  (CEP pattern matching)
#   - tflo-wasm      → src/wasm/ops  (windows, joins, indicators, detectors, CEL)
set -euo pipefail
TFLO_PATH="${TFLO_PATH:-../tflo}"
OUT="$(pwd)/src/wasm"

command -v wasm-pack >/dev/null || { echo "error: wasm-pack not installed"; exit 1; }
[[ -d "$TFLO_PATH/tflo-cep-wasm" ]] || { echo "error: tflo-cep-wasm not at $TFLO_PATH"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT/cep" "$OUT/cep-cel" "$OUT/ops"
# Default CEP: lean (~40 KB), JS-closure predicates.
( cd "$TFLO_PATH/tflo-cep-wasm" && wasm-pack build --target web --release --out-dir "$OUT/cep" --out-name tflo_cep_wasm )
# Opt-in CEP with CEL-string predicates (~2 MB — bundles a CEL interpreter).
# Only the `@tflo/react/cel` entry imports this; the main package stays lean.
( cd "$TFLO_PATH/tflo-cep-wasm" && wasm-pack build --target web --release --out-dir "$OUT/cep-cel" --out-name tflo_cep_wasm -- --features cel )
( cd "$TFLO_PATH/tflo-wasm"     && wasm-pack build --target web --release --out-dir "$OUT/ops" --out-name tflo_wasm )
echo "build-wasm: wrote $OUT/{cep,cep-cel,ops}"
