#!/usr/bin/env bash
# Copy the wasm-pack build output from src/wasm/ into dist/wasm/, file-by-file.
#
# NOT a directory copy. `wasm-pack build` writes a `.gitignore` (content: `*`)
# into every output directory it creates. npm's pack/publish file-selection
# algorithm honors `.gitignore`/`.npmignore` files found anywhere in the tree
# — even nested ones, even when the root package.json has an explicit `files`
# allowlist naming the parent directory. A recursive `cp -r src/wasm dist/wasm`
# carries those nested `.gitignore` files straight into `dist/`, which then
# causes every `.wasm`/`.js`/`.d.ts` under `dist/wasm/**` to be silently
# dropped from the published tarball (verified via `npm pack --dry-run`).
#
# Mirrors the per-file `cp` approach `tflo-browser-events` already uses
# (its `copy:wasm` script), extended to this package's 4-artifact split.
set -euo pipefail
SRC="src/wasm"
OUT="dist/wasm"
rm -rf "$OUT"

for dir in cep ops cep-cel ops-cel; do
  mkdir -p "$OUT/$dir"
  for f in "$SRC/$dir"/*; do
    base="$(basename "$f")"
    # Never copy wasm-pack's own `.gitignore` — that's the root cause above.
    [[ "$base" == ".gitignore" ]] && continue
    cp "$f" "$OUT/$dir/$base"
  done
done

echo "copy-wasm: wrote $OUT/{cep,ops,cep-cel,ops-cel} (excluding wasm-pack .gitignore files)"
