/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SupplyAgreementsSection from "./SupplyAgreementsSection";

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agreements: [
          {
            _id: "agreement-1",
            supplierCorpId: "supplier",
            buyerCorpId: "buyer",
            commodity: "energy",
            volumeCap: 80,
            pricePremium: 0,
            status: "active",
            proposedByCorpId: "supplier",
            lastDeliveryTurn: 296,
            lastDeliveredUnits: 60,
          },
        ],
      }),
    })
  );
});

describe("SupplyAgreementsSection delivery outcome", () => {
  it("shows the buyer the agreement's latest physical delivery", async () => {
    render(<SupplyAgreementsSection corpId="buyer" />);

    await waitFor(() => expect(screen.getByText("As buyer")).toBeTruthy());
    expect(screen.getByText(/60 MWh on turn 296/)).toBeTruthy();
  });
});
