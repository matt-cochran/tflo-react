#!/usr/bin/env bash
# Build the tflo WASM packages consumed by @tflo/react.
#
# Four artifacts, split so the common path stays lean and CEL/regex/tz are opt-in:
#   - cep     ← tflo-cep-wasm              CEP pattern matching, JS-closure preds (~17 KB gz)
#   - ops     ← tflo-wasm                  windows/joins/indicators/detectors, MATH ONLY (no CEL)
#   - cep-cel ← tflo-cep-wasm --features cel   CEL-string pattern predicates (serializable/server-push)
#   - ops-cel ← tflo-wasm --features cel       CEL rule evaluation (evaluate_rules / useCelRules)
#
# All built with the size-first `release-wasm` cargo profile (opt-level=z, lto=fat,
# codegen-units=1, panic=abort, strip=symbols) + wasm-opt -Oz (see tflo Cargo.toml).
# Only the `.`/`./ops` entries load cep/ops; `./cel` lazy-loads cep-cel/ops-cel.
set -euo pipefail
TFLO_PATH="${TFLO_PATH:-../tflo}"
OUT="$(pwd)/src/wasm"
# `--release` (not the custom release-wasm profile): wasm-pack only honors the
# `profile.release` wasm-opt metadata (= false, disabling its broken default
# pass) for the standard build modes. We run wasm-opt -Oz ourselves below.
WASM_PACK_MODE="--release"

command -v wasm-pack >/dev/null || { echo "error: wasm-pack not installed"; exit 1; }
[[ -d "$TFLO_PATH/tflo-cep-wasm" ]] || { echo "error: tflo-cep-wasm not at $TFLO_PATH"; exit 1; }

# Resolve wasm-opt: prefer PATH, fall back to the binaryen wasm-pack already
# downloaded into its cache. wasm-pack's own pass is disabled in Cargo.toml
# (it ignores per-profile flags and chokes on bulk-memory); we run it here with
# the correct flags. If none is found, we ship the cargo-optimized wasm as-is.
WASM_OPT="$(command -v wasm-opt || true)"
if [[ -z "$WASM_OPT" ]]; then
  WASM_OPT="$(ls -t "$HOME"/.cache/.wasm-pack/wasm-opt-*/bin/wasm-opt 2>/dev/null | head -1 || true)"
fi
optimize() { # $1 = artifact dir
  local w; for w in "$OUT/$1"/*_bg.wasm; do
    [[ -f "$w" ]] || continue
    if [[ -n "$WASM_OPT" ]]; then
      "$WASM_OPT" -Oz --enable-bulk-memory "$w" -o "$w"
    fi
  done
}

rm -rf "$OUT"; mkdir -p "$OUT/cep" "$OUT/cep-cel" "$OUT/ops" "$OUT/ops-cel"

# Lean CEP core — the default `.` entry. JS-closure predicates only.
( cd "$TFLO_PATH/tflo-cep-wasm" && wasm-pack build --target web $WASM_PACK_MODE \
    --out-dir "$OUT/cep" --out-name tflo_cep_wasm )
optimize cep

# Math-only ops — the `./ops` entry. NO CEL: windows, joins, indicators, detectors.
( cd "$TFLO_PATH/tflo-wasm" && wasm-pack build --target web $WASM_PACK_MODE \
    --out-dir "$OUT/ops" --out-name tflo_wasm )
optimize ops

# CEL pattern predicates — opt-in, loaded only by `@tflo/react/cel`.
( cd "$TFLO_PATH/tflo-cep-wasm" && wasm-pack build --target web $WASM_PACK_MODE \
    --out-dir "$OUT/cep-cel" --out-name tflo_cep_wasm -- --features cel )
optimize cep-cel

# CEL rule evaluation (evaluate_rules) — opt-in, loaded only by `@tflo/react/cel`.
( cd "$TFLO_PATH/tflo-wasm" && wasm-pack build --target web $WASM_PACK_MODE \
    --out-dir "$OUT/ops-cel" --out-name tflo_wasm -- --features cel )
optimize ops-cel

echo ""
echo "build-wasm: wrote $OUT/{cep,ops,cep-cel,ops-cel}"
echo "── artifact sizes (raw / gzip) ─────────────────────────────"
for d in cep ops cep-cel ops-cel; do
  f="$OUT/$d"/*_bg.wasm
  for w in $f; do
    [[ -f "$w" ]] || continue
    raw=$(stat -c%s "$w")
    gz=$(gzip -c "$w" | wc -c)
    printf "  %-8s %8d B raw  %8d B gzip\n" "$d" "$raw" "$gz"
  done
done
