/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrivateLoanModal } from "./PrivateLoanModal";

vi.mock("@/components/banking/WarningBandBadge", () => ({
  WarningBandBadge: () => <span>Bank standing</span>,
}));

const bank = {
  corporationId: "bank-1",
  name: "Continental Trust",
  currency: "USD" as const,
  lendingRatePercent: 7.5,
  warningBand: "green" as const,
  confidence: 0.91,
  cashReserves: 1_200_000,
  lendableHeadroom: 900_000,
  requireApproval: false,
};

const corporation = {
  id: "corp-1",
  name: "Acme Industrial",
  liquidCapital: 2_000_000,
  incomePerTurn: 80_000,
  currency: "USD" as const,
};

describe("PrivateLoanModal", () => {
  it("updates the destination and quote when switching borrower type", () => {
    render(
      <PrivateLoanModal
        banks={[bank]}
        ceoCorporations={[corporation]}
        personalCash={{ USD: 40_000 }}
        personalIncomeByCurrency={{ USD: 50_000 }}
        currentTurn={115}
        loans={[]}
        hasCharacter
        onClose={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Arrange private-bank credit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Personal loan" })).toBeTruthy();
    expect(screen.getAllByText(/personal cash/i).length).toBeGreaterThan(0);
    expect(screen.getByText("9.00%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Corporation loan" }));

    expect(screen.getByLabelText("Borrowing corporation")).toBeTruthy();
    expect(screen.getByText(/currently \$2\.00M/i)).toBeTruthy();
    expect(screen.getAllByText("7.50%").length).toBeGreaterThan(0);
  });
});
