/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoliticsSection } from "./PoliticsSection";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => {
    const messages: Record<string, string> = {
      "politics.actionsCount": `${values?.count ?? 0} actions`,
      "politics.voucherCount": `${values?.count ?? 0} Positions Update Vouchers`,
      "politics.intro": "Shift your positions.",
      "politics.shifted": "Policy shifted.",
      "politics.shiftedWithVoucher": "Policy shifted with a voucher.",
      "politics.shiftFailed": "Shift failed.",
      "politics.useVoucher": "Use a Positions Update Voucher",
      "politics.useVoucherHint": "No normal costs.",
      "politics.electionPreferences": "Election Preferences",
      "politics.autoReelection": "Automatically run for re-election",
      "politics.autoReelectionHint": "Automatically enter new elections.",
      "common.networkError": "Network error.",
    };
    return messages[key] ?? key;
  },
}));

describe("PoliticsSection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            usedVoucher: true,
            stats: {
              policies: { economic: 1, social: 0 },
              actions: 0,
              infamy: 4,
              politicalInfluence: 20,
              nationalInfluence: 10,
              positionUpdateVouchers: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the balance and sends a voucher-backed shift when selected", async () => {
    const onCharacterUpdate = vi.fn();
    render(
      <PoliticsSection
        character={{
          actions: 0,
          positionUpdateVouchers: 2,
          infamy: 4,
          politicalInfluence: 20,
          nationalInfluence: 10,
          policies: { economic: 0, social: 0 },
        }}
        onCharacterUpdate={onCharacterUpdate}
        onReelectionChange={vi.fn()}
      />
    );

    expect(screen.getByText("2 Positions Update Vouchers")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /use a positions update voucher/i }));
    fireEvent.click(screen.getByRole("button", { name: "Shift Conservative" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm shift" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/settings/policy",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ axis: "economic", direction: 1, useVoucher: true }),
        })
      )
    );
    expect(onCharacterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ positionUpdateVouchers: 1, actions: 0 })
    );
  });

  it("blocks a second policy shift while the first request is in flight", async () => {
    let resolveRequest!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      })
    );

    render(
      <PoliticsSection
        character={{
          actions: 100,
          positionUpdateVouchers: 2,
          infamy: 0,
          politicalInfluence: 20,
          nationalInfluence: 10,
          policies: { economic: 0, social: 0 },
        }}
        onCharacterUpdate={vi.fn()}
        onReelectionChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /use a positions update voucher/i }));
    fireEvent.click(screen.getByRole("button", { name: "Shift Conservative" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm shift" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const secondShift = screen.getByRole("button", { name: "Shift Traditional" });
    expect(secondShift).toHaveProperty("disabled", true);
    fireEvent.click(secondShift);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveRequest(
      new Response(
        JSON.stringify({
          success: true,
          usedVoucher: true,
          stats: {
            policies: { economic: 1, social: 0 },
            actions: 100,
            infamy: 0,
            politicalInfluence: 20,
            nationalInfluence: 10,
            positionUpdateVouchers: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  });
});
