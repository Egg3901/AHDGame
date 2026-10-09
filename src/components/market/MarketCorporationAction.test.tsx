/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
let corpId: number | null = null;
let blocked = false;
vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({ navData: { myCorporationId: corpId } }),
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ currencySymbol: "$", countryId: "US", forexEnabled: false, baseRates: {} }),
}));
vi.mock("@/hooks/useGameEvents", () => ({ useGameTurnStatus: () => ({ currentYear: 1991 }) }));
vi.mock("@/lib/economy/queries/privateEnterpriseRegime", () => ({
  privateEnterpriseBlockedByYear: () => blocked,
}));
vi.mock("@/lib/characterStatsSync", () => ({ requestCharacterStatsRefetch: vi.fn() }));
vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn().mockResolvedValue({ foundingCooldownTurnsRemaining: 7 }),
}));
vi.mock("@/app/country/[code]/stockmarket/components/FoundCorporationModal", () => ({
  FoundCorporationModal: ({
    open,
    foundingCooldownTurnsRemaining,
  }: {
    open: boolean;
    foundingCooldownTurnsRemaining: number;
  }) => (open ? <div role="dialog">Cooldown {foundingCooldownTurnsRemaining}</div> : null),
}));
import { MarketCorporationAction } from "./MarketCorporationAction";
beforeEach(() => {
  cleanup();
  corpId = null;
  blocked = false;
});
describe("Market corporation action", () => {
  it("opens founding and refreshes the player cooldown", async () => {
    render(<MarketCorporationAction />);
    fireEvent.click(screen.getByRole("button", { name: "Found corporation" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toBe("Cooldown 7"));
  });
  it("links an existing owner to their corporation", () => {
    corpId = 42;
    render(<MarketCorporationAction />);
    expect(screen.getByRole("link", { name: "My corporation" }).getAttribute("href")).toBe(
      "/corporation/42"
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("respects the private enterprise gate", () => {
    blocked = true;
    render(<MarketCorporationAction />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
