/** @vitest-environment happy-dom */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorialStancePanel } from "./EditorialStancePanel";
import { ShareBuybackEscrowPanel } from "./ceo/ShareBuybackEscrowPanel";
import ShareStructurePanel from "./shares/ShareStructurePanel";
import DefaultedBondCrisisModal from "./DefaultedBondCrisisModal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { economic: string; social: string }) =>
    key === "published"
      ? `Published stance: economic ${values?.economic}, social ${values?.social}.`
      : key,
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `$${value}`,
    formatPrice: (value: number) => `$${value}`,
    toInternalFrom: (value: number) => value,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type EscrowProps = ComponentProps<typeof ShareBuybackEscrowPanel>;
function escrow(
  corporation: Partial<EscrowProps["corporation"]>,
  mode: "instant" | "escrow" = "instant",
  funding = "0"
) {
  return render(
    <ShareBuybackEscrowPanel
      corpId="corp1"
      corporation={{ shareEscrowBalance: 0, ...corporation } as EscrowProps["corporation"]}
      currentTurn={100}
      editShareBuybackMode={mode}
      setEditShareBuybackMode={vi.fn()}
      editEscrowFundingPerTurn={funding}
      setEditEscrowFundingPerTurn={vi.fn()}
      saving={false}
      onSaveSettings={vi.fn()}
      onRefresh={vi.fn()}
    />
  );
}

describe("actionable management controls", () => {
  it("replaces editorial controls with the published stance for a non-CEO", () => {
    render(
      <EditorialStancePanel
        corporationId="corp1"
        stance={{ economic: 2, social: -1 }}
        isCeo={false}
      />
    );
    expect(screen.getByText("Published stance: economic +2, social -1.")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("ceoOnly")).toBeNull();
  });

  it("hides funding and withdrawal fields in instant mode with no balance", () => {
    escrow({});
    expect(screen.queryByText("Auto-fund per turn")).toBeNull();
    expect(screen.queryByLabelText("Escrow withdrawal amount")).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw to treasury" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save buyback settings" })).toBeTruthy();
  });

  it("hides a saved funding warning when funding is unavailable in instant mode", () => {
    escrow({ recentNetIncome: 1 }, "instant", "10000");
    expect(screen.queryByText(/more than recent net income/)).toBeNull();
    expect(screen.queryByText("Auto-fund per turn")).toBeNull();
  });

  it("hides withdrawal while its cooldown is active", () => {
    escrow({ shareEscrowBalance: 500, lastEscrowWithdrawalTurn: 100 }, "escrow");
    expect(screen.queryByLabelText("Escrow withdrawal amount")).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw to treasury" })).toBeNull();
    expect(screen.getByText("$500")).toBeTruthy();
  });

  it("keeps an available escrow withdrawal", () => {
    escrow({ shareEscrowBalance: 500, equityMarketPoolActive: true });
    expect(screen.getByLabelText("Escrow withdrawal amount")).toBeTruthy();
  });

  it("shows only the share count when structure changes are unavailable", () => {
    type Props = ComponentProps<typeof ShareStructurePanel>;
    const trading: Props["trading"] = {
      consolidateTarget: "",
      setConsolidateTarget: vi.fn(),
      consolidateTargetNum: 0,
      maxForwardTotal: 10000,
      isReverseTarget: false,
      isForwardTarget: false,
      shareStructureTargetValid: false,
      shareStructurePricePreview: false,
      newPriceAfterShareStructure: null,
      shareStructureOnCooldown: true,
      ceoEligibleForShareStructure: true,
      canEditShareStructureTarget: false,
      loading: false,
      handleConsolidateShares: vi.fn(),
    };
    render(
      <ShareStructurePanel
        corporation={{ totalShares: 1000 } as Props["corporation"]}
        trading={trading}
      />
    );
    expect(screen.getByText("The corporation has 1,000 shares.")).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Available again/)).toBeNull();
  });

  it("omits unavailable bond remedies and their input fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          active: true,
          defaultedPrincipal: 100,
          liquidCapital: 0,
          sectorNpv: 0,
          totalEquity: 0,
          creditPenalty: { untilTurn: null },
          cash: { canPay: false },
          refinance: { canRefinance: false, imfRestructuring: true, creditRating: null },
          restructure: { feasible: false },
          dissolve: {
            preview: { bondRecoveryPool: 0, bondRecoveryPct: 0, shareholderPool: 0 },
            shareholders: [],
            corporateShareholders: [],
            publicFloat: null,
          },
        }),
      }))
    );
    render(<DefaultedBondCrisisModal corpId="corp1" open onClose={vi.fn()} onResolved={vi.fn()} />);
    await screen.findByText("4. Dissolve & settle");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("1. Pay cash")).toBeNull();
    expect(screen.queryByText("2. Refinance")).toBeNull();
    expect(screen.queryByText("3. Restructure")).toBeNull();
    // One plain sentence tells the CEO why the other remedies are not offered.
    expect(
      screen.getByText(/Refinancing is closed while the IMF restructuring program runs/)
    ).toBeTruthy();
  });

  it("renders no crisis controls after the permission check rejects access", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <DefaultedBondCrisisModal corpId="corp1" open onClose={vi.fn()} onResolved={vi.fn()} />
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
