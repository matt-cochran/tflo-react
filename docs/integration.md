# Integration, bundling & SSR

How to wire `@tflo/react` into a real app: the WASM-asset story per bundler, the
`"use client"` / SSR boundary, lazy-loading the heavy entries, and the peer
dependencies. For the runtime lifecycle (buffer-until-ready, init-failure,
StrictMode), see the **Lifecycle / SSR** section of the README.

## Peer dependencies

`@tflo/react` declares peers rather than bundling them, so your app's single copy
of React is the one used:

```jsonc
"peerDependencies": {
  "react": ">=18",
  "react-dom": ">=18",
  "@testing-library/react": ">=16"  // ONLY needed if you import "@tflo/react/testing"
}
```

- `react` / `react-dom` **>= 18** — the hooks use `useSyncExternalStore` and
  `useId`, both React 18+.
- `@testing-library/react` is a peer **only** for the `@tflo/react/testing`
  entry. It is never imported by the main package, so production bundles never
  pull it in. If you don't use the testing helpers, you can ignore it.

## How the WASM is loaded

The engine ships as **prebuilt** WebAssembly (built with `wasm-pack --target
web`). Two modules load lazily, only when `initTflo()` runs inside the provider
effect — never at import time:

| Entry | Module | Size (uncompressed) | When |
| --- | --- | --- | --- |
| `@tflo/react` (default) | `cep` | ~44 KB | always (pattern matching) |
| `@tflo/react` (default) | `ops` | ~2.5 MB | always (windows/joins/indicators) |
| `@tflo/react/cel` | `cep-cel` | ~2.1 MB | only if you import the CEL entry |

The `--target web` glue `fetch()`es the `.wasm` by URL relative to the JS module.
Bundlers that understand `new URL("….wasm", import.meta.url)` (Vite, webpack 5,
Next.js, Parcel 2) emit the `.wasm` as a hashed asset automatically — no loader
config needed. Under **Node** (e.g. Vitest), there is no `fetch` for `file://`,
so the package reads the `.wasm` bytes off disk and passes them to init directly.
Both paths are handled inside `initTflo()`; you don't call either yourself.

> Nothing touches `window` or the `.wasm` binary at import time, so importing the
> package on the server is safe — see **SSR** below.

## Vite

Vite is the reference setup (the demo uses it). Three knobs matter, and only when
you consume `@tflo/react` as a local **`file:` sibling** (a monorepo / linked
package); a normally-installed package from npm needs none of them.

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],

  // tflo-react ships prebuilt wasm + ESM; don't pre-bundle it.
  optimizeDeps: { exclude: ["@tflo/react"] },

  server: {
    fs: {
      // DEV ONLY. A `file:` sibling lives OUTSIDE this project root, and its
      // prebuilt `.wasm` is served via `/@fs/…`, which Vite forbids (403) for
      // out-of-root paths by default. Allow the sibling dir so init can load.
      // `vite build` bundles the wasm as an asset and is unaffected.
      allow: [".", "../tflo-react"],
    },
  },

  resolve: {
    // A `file:` sibling has its own node_modules; without deduping, React-coupled
    // modules resolve to the sibling's copies → "Invalid hook call / more than one
    // copy of React". Pin them to your app's copy.
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@testing-library/react"],
  },
});
```

Symptoms if you skip these (file: consumer only):
- **403 in dev when the engine loads** → add `server.fs.allow`.
- **"Invalid hook call" / "more than one copy of React"** → add `resolve.dedupe`.
- **A pre-bundled, stale wasm path** → add `optimizeDeps.exclude`.

## Next.js / SSR boundary

`@tflo/react` is **client-only at runtime** but **import-safe on the server**:
init is deferred to a `useEffect`, so importing the package during SSR does not
touch `window` or instantiate WASM. The only rule is the standard one — anything
that *renders* tflo state is a client component.

- The provider (`TfloProvider` / `createTflo().Provider`) already carries the
  `"use client"` directive, so it (and the hooks it powers) run on the client.
- Put your tflo-driven UI behind a **client island**: a `"use client"` component
  mounted inside an otherwise-server tree. The server renders the surrounding
  page; the island hydrates, the provider effect runs `initTflo()`, and the
  engine comes up on the client.
- The server render shows the **pre-ready** state (`ready === false`,
  `useSignal(...) === undefined`) — its stable SSR snapshot. Gate on `ready` (and
  `error`) so the server/first-client paint is a spinner or empty state, not a
  flash:

```tsx
"use client";
import { createTflo } from "@tflo/react";

const tflo = createTflo<Events, Signals>();

export function BehaviorIsland({ children }: { children: React.ReactNode }) {
  return (
    <tflo.Provider>
      <Gate>{children}</Gate>
    </tflo.Provider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { ready, error } = tflo.useTfloContext();
  if (error) return <EngineFailed error={error} />;
  if (!ready) return <Spinner />;     // also the SSR/first-paint snapshot
  return <>{children}</>;
}
```

Do **not** try to server-render derived behavior: temporal signals are a function
of a live event stream that only exists on the client. SSR of behavior is an
explicit non-goal.

## webpack 5 / Next.js (non-Vite)

webpack 5 handles `new URL("….wasm", import.meta.url)` natively via
`asset/resource`; no `wasm-loader`, no `experiments.asyncWebAssembly`. If a custom
config has stripped the default asset rules, restore one for `.wasm`:

```js
module.rules.push({ test: /\.wasm$/, type: "asset/resource" });
```

## Lazy-loading the heavy entries

The default `ops` module (~2.5 MB) and the optional `cel` module (~2.1 MB)
dominate the bundle. Two ways to keep them off the critical path:

1. **Code-split the provider.** Because init runs in the provider effect, lazily
   importing the component that mounts `TfloProvider` defers *all* engine code
   (and its wasm) until that island renders:

   ```tsx
   const BehaviorIsland = React.lazy(() => import("./BehaviorIsland"));
   ```

2. **Keep CEL opt-in.** `@tflo/react/cel` is a separate entry for exactly this
   reason — import it only in the island that needs serializable/server-pushable
   CEL patterns, so the ~2 MB CEL interpreter never lands in bundles that use the
   default JS-closure predicates. Likewise `@tflo/react/devtools` and
   `@tflo/react/testing` are separate entries that never enter your main chunk
   unless you import them.

The subpath `exports` map (`.`, `./cel`, `./devtools`, `./testing`) means a
modern bundler tree-shakes/splits each independently — you pay only for the
entries you import.
