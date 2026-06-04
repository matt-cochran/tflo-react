# Scenario 9 — Undo Grace Period

## Requirement

An action is **committed** unless an `undo` for it arrives within **10 000 ms of event-time**.

Per-action events (one runtime / bookkeeping context per action id):

| Action | Events | Expected verdict |
|--------|--------|-----------------|
| A1 | `action @ ts 0`, then `undo @ ts 3000` | **UNDONE** — undo arrived within 10 000 ms; no "committed" emitted |
| A2 | `action @ ts 0`, no undo | **COMMITTED** — no undo within window; emit `{signal:"committed",id:"A2"}` |

## Event shape

```json
{ "kind": "action" | "undo", "id": "A1" | "A2", "ts": <ms> }
```

## tflo pattern (per-action runtime)

```
when(e => e.kind === "action")
  .notThen(e => e.kind === "undo")
  .within(10000)
  .emit(() => ({ signal: "committed", id }))
```

## Expected output

```json
[{"signal":"committed","id":"A2"}]
```

Only A2 appears; A1 is silently consumed (undo arrived in time).
