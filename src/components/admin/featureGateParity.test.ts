import { describe, expect, it } from "vitest";
import { FEATURE_GATE_BOOLEAN_KEYS } from "@/app/api/admin/feature-gates/route";
import { BOOLEAN_GATES } from "./FeatureGatesPanel";

/**
 * The admin panel keeps its own list of boolean gates, because each one needs a
 * label and a description the route has no business carrying. That mirror is
 * hand-maintained and the panel's `key` is a bare string, so the two lists can
 * drift silently in either direction:
 *
 *   - in the route but not the panel → the flag exists and is settable by API,
 *     but no admin can find it;
 *   - in the panel but not the route → the toggle renders and every click is
 *     rejected by the route's `z.enum`.
 *
 * Both failures are invisible to typecheck. This test is the only thing holding
 * them together.
 */
describe("feature gate parity", () => {
  it("exposes exactly the route's keys in the admin panel", () => {
    const routeKeys = [...FEATURE_GATE_BOOLEAN_KEYS].sort();
    const panelKeys = BOOLEAN_GATES.map((g) => g.key).sort();
    expect(panelKeys).toEqual(routeKeys);
  });

  it("gives every panel gate a label and a description", () => {
    for (const gate of BOOLEAN_GATES) {
      expect(gate.label.trim(), `${gate.key} label`).not.toBe("");
      expect(gate.desc.trim(), `${gate.key} desc`).not.toBe("");
    }
  });

  it("lists no gate twice on either side", () => {
    expect(new Set(FEATURE_GATE_BOOLEAN_KEYS).size).toBe(FEATURE_GATE_BOOLEAN_KEYS.length);
    const panelKeys = BOOLEAN_GATES.map((g) => g.key);
    expect(new Set(panelKeys).size).toBe(panelKeys.length);
  });
});
