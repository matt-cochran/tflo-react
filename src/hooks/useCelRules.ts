import { useMemo } from "react";
import { useTfloContext } from "../core/provider";
import { type CelRule, evaluateRules } from "../core/indicators";

/**
 * Evaluate CEL rules (as DATA) against items, via tflo's CEL engine in WASM.
 *
 * This is the stepping stone toward the crown-jewel roadmap: because the rules
 * are a serializable object (not code), they can be authored once, shipped from
 * a server, and evaluated identically on client and Rust server — the
 * "patterns-as-data / server-pushable behavior" direction. (Full CEL *predicate*
 * CEP — replacing the JS-closure predicates in `usePattern` — is deeper engine
 * work; this surfaces the rule-evaluation half today.)
 */
export function useCelRules(
  rules: { rules: CelRule[] },
  items: Record<string, unknown>[],
): { item_id: string; matched_rules: string[] }[] {
  const { ready } = useTfloContext();
  return useMemo(() => (ready ? evaluateRules(rules, items) : []), [ready, rules, items]);
}
