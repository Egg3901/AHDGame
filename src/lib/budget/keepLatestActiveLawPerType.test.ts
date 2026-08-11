import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { keepLatestActiveLawPerType } from "./spending";
import type { EnactedLaw } from "@/lib/db/types/budget";

function law(over: Partial<EnactedLaw>): EnactedLaw {
  return {
    _id: new ObjectId(),
    billId: new ObjectId(),
    legislationTypeId: "ie_healthcare_policy",
    title: "Healthcare",
    scope: "national",
    budgetCost: 10,
    budgetCategory: "healthcare",
    enactedAt: new Date("2026-01-01"),
    enactedYear: 2026,
    ...over,
  } as EnactedLaw;
}

describe("keepLatestActiveLawPerType (#3148)", () => {
  it("collapses duplicate active national laws of the same type to the latest-enacted", () => {
    const laws = [
      law({ enactedAt: new Date("2026-01-01"), budgetCost: 10 }),
      law({ enactedAt: new Date("2026-03-01"), budgetCost: 30 }), // newest
      law({ enactedAt: new Date("2026-02-01"), budgetCost: 20 }),
    ];
    const kept = keepLatestActiveLawPerType(laws);
    expect(kept).toHaveLength(1);
    expect(kept[0].budgetCost).toBe(30);
  });

  it("keeps distinct types and distinct states separate", () => {
    const laws = [
      law({ legislationTypeId: "a", scope: "national" }),
      law({ legislationTypeId: "b", scope: "national" }),
      law({ legislationTypeId: "a", scope: "state", stateId: "CA" }),
      law({ legislationTypeId: "a", scope: "state", stateId: "TX" }),
    ];
    // national a, national b, state-a-CA, state-a-TX = 4 distinct keys
    expect(keepLatestActiveLawPerType(laws)).toHaveLength(4);
  });

  it("is a no-op on an already-unique set", () => {
    const laws = [law({ legislationTypeId: "x" }), law({ legislationTypeId: "y" })];
    expect(keepLatestActiveLawPerType(laws)).toHaveLength(2);
  });
});
