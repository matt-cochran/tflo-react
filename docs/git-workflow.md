# Git workflow — feature → dev → main

This repo uses a gitflow-style branching model. **`dev` is the default branch**
(integration); **`main` is release-only** (matches what's published to npm).

```
feature/*  ──PR──▶  dev  ──release PR──▶  main
hotfix/*   ─────────────────────────────▶  main  (then back-merge to dev)
```

## Day-to-day (features)

1. Branch off `dev`:  `git switch dev && git pull && git switch -c feat/<name>`
2. Open a PR into **`dev`** (the default base).

## Releasing (dev → main)

1. Open a PR from **`dev`** into **`main`**.
2. The **`flow-guard`** check verifies the source is `dev`/`release/*`/`hotfix/*`.
3. Merge, then publish (`npm run build && npm publish` — this package's wasm build
   needs the sibling `../tflo` monorepo, so releases are currently manual).

## Hotfixes

Urgent fixes may branch from `main` as `hotfix/<name>` and PR directly into
`main` (allowed by the flow guard). **Back-merge `main` → `dev`** afterward.

## Enforcement (configured on GitHub)

- **`main`**: PR required · no direct pushes · no force-push · no deletion ·
  admin-enforced · required check: `flow-guard` · PRs may only come from
  `dev`/`release/*`/`hotfix/*`.
- **`dev`**: PR required · no direct pushes · no force-push · no deletion ·
  admin-enforced.

> **CI gap:** this repo has no CI workflow yet — there is no automated test gate
> on merges. Building it requires the sibling `../tflo` Rust/wasm monorepo on the
> runner (or committing `dist/`). Until then, enforcement is structural
> (PR-required + flow direction) without a green-tests requirement.
