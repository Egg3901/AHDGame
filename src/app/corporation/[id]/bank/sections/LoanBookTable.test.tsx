/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoanBookTable } from "./LoanBookTable";
import type { ConsolePayload } from "../types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

type HouseholdBook = NonNullable<ConsolePayload["householdBook"]>;

const book: HouseholdBook = {
  total: 4_500_000,
  lendingProfile: "balanced",
  blendedRatePercent: 7.5,
  blendedExpectedDefaultPercent: 1.2,
  rows: [
    {
      band: "AAA",
      outstanding: 800_000,
      ratePercent: 6.5,
      expectedDefaultRatePercent: 0.2,
      demandShare: 0.1,
      open: true,
      target: 800_000,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "AA",
      outstanding: 1_100_000,
      ratePercent: 7.25,
      expectedDefaultRatePercent: 0.5,
      demandShare: 0.15,
      open: true,
      target: 1_110_000,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "A",
      outstanding: 1_360_000,
      ratePercent: 8,
      expectedDefaultRatePercent: 1,
      demandShare: 0.2,
      open: true,
      target: 1_360_000,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "BBB",
      outstanding: 1_240_000,
      ratePercent: 9,
      expectedDefaultRatePercent: 2,
      demandShare: 0.22,
      open: true,
      target: 1_320_000,
      isLegacy: false,
      tranches: 1,
    },
    {
      band: "BB",
      outstanding: 0,
      ratePercent: null,
      expectedDefaultRatePercent: 4.5,
      demandShare: 0.18,
      open: false,
      target: 0,
      isLegacy: false,
      tranches: 0,
    },
    {
      band: "B",
      outstanding: 0,
      ratePercent: null,
      expectedDefaultRatePercent: 8,
      demandShare: 0.1,
      open: false,
      target: 0,
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
      target: 0,
      isLegacy: false,
      tranches: 0,
    },
  ],
};

function renderTable() {
  return render(
    <LoanBookTable
      loans={[]}
      currency="USD"
      householdBook={book}
      corporationId="corp1"
      canMutate
      onChanged={() => {}}
      showToast={() => {}}
    />
  );
}

describe("LoanBookTable lending stance feedback", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows each band target and marks closed bands as running off", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "Target" })).toBeTruthy();
    // Closed junk bands steer to zero instead of being topped up.
    expect(screen.getAllByText("run off").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("closed").length).toBe(3);
  });

  it("states the per-turn pace so a slow move reads as working, not broken", () => {
    renderTable();
    expect(screen.getByText(/of target per turn/)).toBeTruthy();
    expect(screen.getByText(/48 turns \(about 48 hours\)/)).toBeTruthy();
  });

  it("toasts what changes and when after a stance flip", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            success: true,
            lendingProfile: "aggressive",
            message:
              "Stance saved. BB, B and CCC starts building. New lending builds at up to 2.5% of target per turn.",
          }),
        }) as Response
    ) as typeof fetch;

    render(
      <LoanBookTable
        loans={[]}
        currency="USD"
        householdBook={book}
        corporationId="corp1"
        canMutate
        onChanged={() => {}}
        showToast={(message) => {
          seen.push(message);
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Aggressive/ }));
    await waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0]).toMatch(/BB/);
    expect(seen[0]).toMatch(/per turn/);
  });
});
