// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { makeCharacter } from "@/lib/test-utils/factories";
import { CARDS } from "../actionsConstants";
import type { ActionCardProps } from "../actionsTypes";
import ActionCard from "./ActionCard";

vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({ user: { forexEnabled: false, character: { countryId: "US" } } }),
}));
vi.mock("@/hooks/useWorldFlags", () => ({
  useWorldFlags: () => ({ preset: "2019-default", eurozoneEnabled: false }),
}));
vi.mock("@/hooks/useGameEvents", () => ({ useGameEvents: () => {} }));
vi.mock("next/image", () => ({ default: () => null }));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: {}, baseRates: {} }) })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function props(type: string): ActionCardProps {
  const card = CARDS.find((c) => c.type === type);
  if (!card) throw new Error(`${type} card is missing`);
  return {
    card,
    character: makeCharacter({ countryId: "US", actions: 20, funds: 1_000_000 }),
    imageUrl: "/card.png",
    index: 0,
    viewMode: "cards",
    homeState: null,
    executing: null,
    flash: null,
    flipflopStep: null,
    flipflopAxis: null,
    flipflopDir: null,
    onExecute: vi.fn(),
    onFlipflop: vi.fn(),
    onFlipflopStepChange: vi.fn(),
    onFlipflopAxisChange: vi.fn(),
    onFlipflopDirChange: vi.fn(),
    campaignActionCost: 1,
    campaignFundCost: 0,
    campaignMaxed: false,
    advertiseActionCost: 1,
    advertiseFundCost: 0,
    fundraiseActionCost: 1,
    buildDonorBaseActionCost: 1,
    buildDonorBaseFundCost: 0,
    fundraiseYield: 2500,
    campaignCurrency: "USD",
    displayCampaignFunds: 1_000_000,
    displayPersonalWealth: 0,
    blockGdpScaledCosts: false,
    forexEnabled: false,
    convertCashOpen: false,
    convertCashAmount: "",
    onConvertCashOpenChange: vi.fn(),
    onConvertCashAmountChange: vi.fn(),
    onConvertCashExecute: vi.fn(),
  };
}

function renderCard(type: string, overrides: Partial<ActionCardProps> = {}) {
  return render(
    <CurrencyProvider>
      <ActionCard {...props(type)} {...overrides} />
    </CurrencyProvider>
  );
}

describe("ActionCard layout", () => {
  it("names the category in plain text beside the tagline instead of a pill", () => {
    renderCard("poll");
    const tagline = screen.getByText(/Quick read of your support/);
    expect(tagline.textContent).toBe("Intelligence · Quick read of your support");
    expect(tagline.className).not.toMatch(/rounded-full|uppercase|bg-black/);
  });

  it("shows cost and effect as two plain rows with a neutral effect", () => {
    const { container } = renderCard("poll");
    const terms = Array.from(container.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(terms).toEqual(["Cost", "Effect"]);
    const effect = screen.getByText("Topline + best/worst groups");
    expect(effect.className).toContain("text-foreground");
    expect(effect.className).not.toMatch(/text-(primary|success|error)/);
    // The rows sit on the card itself, not in a tinted inner box.
    const list = container.querySelector("dl");
    expect(list?.className).not.toMatch(/bg-|rounded/);
  });

  it("shows a fundraising yield, an actual gain, in green", () => {
    renderCard("fundraise");
    const gain = screen.getByText(/^\+/);
    expect(gain.className).toContain("text-success");
  });

  it("previews what one use does to the stat it moves", () => {
    const { container } = renderCard("campaign", {
      projection: { label: "Influence", from: "12.0%", to: "13.0%" },
    });
    const terms = Array.from(container.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(terms).toEqual(["Cost", "Effect", "After"]);
    expect(screen.getByText("13.0%").className).toContain("text-success");
  });

  it("keeps the last result on the card as a status line", () => {
    renderCard("poll", { flash: { type: "poll", msg: "Poll commissioned.", ok: true } });
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Poll commissioned.");
    expect(status.className).toContain("text-success");
  });

  it("does not show another card's result", () => {
    renderCard("poll", { flash: { type: "campaign", msg: "Campaigned.", ok: true } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a blocked card readable and says why", () => {
    const { container } = renderCard("campaign", {
      character: makeCharacter({ countryId: "US", actions: 0, funds: 1_000_000 }),
    });
    expect(container.firstElementChild?.className).not.toContain("opacity-");
    expect(screen.getByText("Insufficient actions.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Execute action" })).toHaveProperty("disabled", true);
  });
});
