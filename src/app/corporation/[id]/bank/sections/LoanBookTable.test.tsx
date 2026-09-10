/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoanBookTable } from "./LoanBookTable";
import type { ConsolePayload } from "../types";

// Ticket 1267 followup (issue 1749): switching the lending stance "doesn't
// seem to change much", because nothing said what each option opens or how
// fast the book moves. These lock the per-option numbers and deltas.

const book: NonNullable<ConsolePayload["householdBook"]> = {
  rows: [
    {
      band: "AAA",
      outstanding: 100,
      ratePercent: 5,
      expectedDefaultRatePercent: 0.2,
      demandShare: 0.1,
      open: true,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "AA",
      outstanding: 100,
      ratePercent: 5,
      expectedDefaultRatePercent: 0.5,
      demandShare: 0.15,
      open: true,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "A",
      outstanding: 100,
      ratePercent: 5,
      expectedDefaultRatePercent: 1,
      demandShare: 0.2,
      open: true,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "BBB",
      outstanding: 100,
      ratePercent: 5,
      expectedDefaultRatePercent: 2,
      demandShare: 0.22,
      open: true,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "BB",
      outstanding: 50,
      ratePercent: 5,
      expectedDefaultRatePercent: 4.5,
      demandShare: 0.18,
      open: false,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "B",
      outstanding: 0,
      ratePercent: null,
      expectedDefaultRatePercent: 8,
      demandShare: 0.1,
      open: false,
      isLegacy: false,
      tranches: 0,
    },
    {
      band: "CCC",
      outstanding: 0,
      ratePercent: null,
      expectedDefaultRatePercent: 15,
      demandShare: 0.05,
      open: false,
      isLegacy: false,
      tranches: 0,
    },
  ],
  total: 450,
  lendingProfile: "balanced",
  blendedRatePercent: 5,
  blendedExpectedDefaultPercent: 2,
};

describe("LendingProfilePicker", () => {
  it("shows each stance's band range and demand share", () => {
    render(
      <LoanBookTable
        loans={[]}
        currency="USD"
        householdBook={{ ...book, lendingProfile: "balanced" }}
        corporationId="corp1"
        canMutate={false}
        onChanged={() => {}}
        showToast={() => {}}
      />
    );
    expect(screen.getByText("AAA–A · 45% of demand")).toBeTruthy();
    expect(screen.getByText("AAA–BBB · 67% of demand")).toBeTruthy();
    expect(screen.getByText("AAA–CCC · 100% of demand")).toBeTruthy();
  });

  it("names what switching opens or closes relative to the current stance", () => {
    render(
      <LoanBookTable
        loans={[]}
        currency="USD"
        householdBook={{ ...book, lendingProfile: "balanced" }}
        corporationId="corp1"
        canMutate={false}
        onChanged={() => {}}
        showToast={() => {}}
      />
    );
    expect(screen.getByText("Opens BB, B, CCC")).toBeTruthy();
    expect(screen.getByText("Closes BBB")).toBeTruthy();
  });

  it("says closed bands run off gradually", () => {
    render(
      <LoanBookTable
        loans={[]}
        currency="USD"
        householdBook={{ ...book, lendingProfile: "balanced" }}
        corporationId="corp1"
        canMutate={false}
        onChanged={() => {}}
        showToast={() => {}}
      />
    );
    expect(screen.getByText(/run off at up to 2\.5% of their/)).toBeTruthy();
  });
});
