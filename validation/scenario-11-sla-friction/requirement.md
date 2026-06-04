# Scenario 11 — SLA Friction

## Requirement

After a `system_response` event, if the user does not take the next `user_step`
within **8000 ms of event-time**, emit a **friction** signal.

Rule (per-response runtime, mirroring scenario-1's per-entity idiom):

```
when(system_response).not_then(user_step).within(8000)
  → emit { signal: "friction", id }
```

## Events

| id | event          | ts   | outcome            |
|----|----------------|------|--------------------|
| R1 | system_response| 0    | user_step @ ts 3000 → within 8000ms |
| R1 | user_step      | 3000 | (acknowledges R1)  |
| R2 | system_response| 0    | no user_step       |

## Expected output

```json
[{"signal":"friction","id":"R2"}]
```

R1 has NO friction (user acted within 8000 ms of event-time).
R2 has FRICTION (no user_step arrived before the 8000 ms window expired).
