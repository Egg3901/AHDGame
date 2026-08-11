import { describe, expect, it } from "vitest";
import { executeActionSchema } from "./actions";

/**
 * `targetState` is validated for SHAPE only, for the same reason as
 * `expandSectorSchema.stateId`: `executeAction` resolves it against the
 * `states` collection scoped to the character's own country, which is both
 * stronger and country-agnostic.
 *
 * Regression guard: this field used to be refined against `STATE_IDS` (the 50
 * US `HOUSE_SEATS` keys), so any non-US character supplying their own region
 * would have been rejected with "Invalid state ID".
 */
describe("executeActionSchema", () => {
  it("accepts an action with no target state", () => {
    const r = executeActionSchema.safeParse({ actionType: "fundraise" });
    expect(r.success).toBe(true);
  });

  it("accepts a US target state", () => {
    const r = executeActionSchema.safeParse({ actionType: "campaign", targetState: "NY" });
    expect(r.success).toBe(true);
  });

  it.each([
    ["UK", "SEE"],
    ["UK", "SCO"],
    ["RU", "CEN"],
  ])("accepts a %s region id (%s) as the target state", (_country, targetState) => {
    const r = executeActionSchema.safeParse({ actionType: "campaign", targetState });
    expect(r.success).toBe(true);
  });

  it("rejects an empty target state", () => {
    const r = executeActionSchema.safeParse({ actionType: "campaign", targetState: "" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown action type", () => {
    const r = executeActionSchema.safeParse({ actionType: "embezzle" });
    expect(r.success).toBe(false);
  });

  it("rejects a batch count outside 1/5/10", () => {
    const r = executeActionSchema.safeParse({ actionType: "fundraise", count: 3 });
    expect(r.success).toBe(false);
  });
});
