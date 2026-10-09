/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillProvisionsSection } from "./BillProvisionsSection";
import { resolveResetLawProvision } from "@/lib/legislature/provisionEnrichment/resetLaw";
import type { ResetLawProvision } from "@/lib/db/types/legislation";

vi.mock("@/components/PositionBadges", () => ({ PositionBadges: () => null }));
vi.mock("@/components/legislation/PolicyEffectIndicators", () => ({
  PolicyEffectIndicators: () => null,
}));
vi.mock("@/app/congress/bills/[id]/components/NationalizationProvisionDetailCard", () => ({
  NationalizationProvisionDetailCard: () => null,
}));

const provision = {
  type: "reset_law",
  titleSnapshot: "Coverage guarantee",
  descriptionSnapshot: "Extend coverage",
  currentLawSnapshot: "Existing coverage",
  currentLawDescriptionSnapshot: "Retain source obligations",
  currentAnnualAllocationSnapshot: 1000000,
  annualAllocationDeltaSnapshot: 250000,
  reviewedOption: { country: "US", annualAllocation: 100000, accruedTransitionLiability: 50000 },
} as ResetLawProvision;

describe("reset-law bill provision display", () => {
  it("shows current and proposed annual costs, adverse treasury delta and separate transition", () => {
    render(
      <BillProvisionsSection provisions={[resolveResetLawProvision(provision)]} billCountry="US" />
    );
    expect(screen.getByText(/Cost.*1M.*1.3M.*yr/)).toBeTruthy();
    expect(screen.getByText(/Net change.*250K.*yr to the treasury/).className).toContain(
      "text-error"
    );
    expect(screen.getByText(/One-time transition cost.*50K/)).toBeTruthy();
  });
});
