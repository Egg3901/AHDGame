import { describe, it, expectTypeOf } from "vitest";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import type { LegislativePhase } from "@/lib/sovereignDefault/legislative/types";

describe("SovereignCrisisDecision", () => {
  it("has _id, countryCode, and state fields", () => {
    expectTypeOf<SovereignCrisisDecision["countryCode"]>().toEqualTypeOf<string>();
    expectTypeOf<SovereignCrisisDecision["state"]>().toEqualTypeOf<
      "open" | "executiveProposed" | "ratified" | "rejected" | "autoActioned" | "expired"
    >();
  });

  it("has createdAt and resolvedAt timestamps", () => {
    expectTypeOf<SovereignCrisisDecision["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<NonNullable<SovereignCrisisDecision["resolvedAt"]>>().toEqualTypeOf<Date>();
  });
});

describe("SovereignCrisisDecision legislative fields (phase 9b)", () => {
  it("exposes legislativePhases and currentChamberIndex", () => {
    expectTypeOf<NonNullable<SovereignCrisisDecision["legislativePhases"]>>().toEqualTypeOf<
      LegislativePhase[]
    >();
    expectTypeOf<
      NonNullable<SovereignCrisisDecision["currentChamberIndex"]>
    >().toEqualTypeOf<number>();
  });
});
