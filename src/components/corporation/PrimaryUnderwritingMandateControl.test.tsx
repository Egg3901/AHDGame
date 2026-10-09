// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PrimaryUnderwritingMandateControl } from "./PrimaryUnderwritingMandateControl";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPayload(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
  );
}

describe("PrimaryUnderwritingMandateControl", () => {
  it("explains an empty bank list and points loans to the Banking page", async () => {
    stubPayload({ enabled: true, selectedBankId: null, banks: [] });
    render(<PrimaryUnderwritingMandateControl corpId="c1" />);

    expect(await screen.findByText(/Retail banks do not underwrite placements/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Banking page" }).getAttribute("href")).toBe(
      "/banking"
    );
    expect((screen.getByLabelText("Underwriting bank") as HTMLSelectElement).disabled).toBe(true);
  });

  it("keeps the picker usable when a bank is available", async () => {
    stubPayload({
      enabled: true,
      selectedBankId: null,
      banks: [
        {
          corporationId: "b".repeat(24),
          name: "Lakeside Capital",
          currencyCode: "USD",
          charteredTurn: 3,
          feeRate: 0.015,
        },
      ],
    });
    render(<PrimaryUnderwritingMandateControl corpId="c1" />);

    expect(await screen.findByText("Lakeside Capital (1.50%)")).toBeTruthy();
    expect((screen.getByLabelText("Underwriting bank") as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByText(/Retail banks do not underwrite/)).toBeNull();
  });
});
