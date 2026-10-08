/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/parties.json";
import { PARTY_SWITCH_ELECTION_WARNING } from "@/components/party/PartySwitchElectionWarning";
import { PartyHubPage } from "./PartyHubPage";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/country/us/parties/2",
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const party = {
  id: "2",
  name: "American Party",
  abbreviation: "AMP",
  color: "#0087DC",
  economicPosition: 0,
  socialPosition: 0,
  chair: null,
  viceChair: null,
  treasurer: null,
  campaigners: [],
  committeeIds: [],
  treasury: 0,
  nationalTaxRate: 0,
  expectedHourlyIncome: 0,
  gotvBudgetPercent: 0,
  gotvEstimatedSpend: 0,
  gotvTargetCategory: null,
  gotvTargetGroup: null,
  suppressionBudgetPercent: 0,
  suppressionEstimatedSpend: 0,
  suppressionTargetCategory: null,
  suppressionTargetGroup: null,
  registrationBudgetPercent: 0,
  registrationEstimatedSpend: 0,
  transferReserveAmount: 0,
  memberSupportReserveAmount: 0,
  nppRecruitmentReserveAmount: 0,
  treasuryPreset: "balanced",
  totalReserveTarget: 0,
  discretionaryTreasury: 0,
  netHourlyTreasuryChange: 0,
  turnsUntilZero: null,
  turnsUntilReserveFloor: null,
  turnsToReachReserveFloor: null,
  politicalStrength: 0,
  effectivePsCap: 100,
  nppActionPoints: 0,
  nppActionPointCap: 0,
  nppActionPointRegen: 0,
  psInvestmentBudget: 0,
  totalBonusActions: 0,
  memberCount: 1,
  isDefault: true,
  countryId: "US",
  members: [],
};

function renderHub(currentParty: string) {
  const user = {
    username: "joiner",
    isAdmin: false,
    hasCharacter: true,
    character: { id: "char-1", party: currentParty, homeState: "CA", countryId: "US" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const requestUrl = String(url);
      if (requestUrl === "/api/auth/me") {
        return { ok: true, json: async () => ({ user }) };
      }
      if (requestUrl === "/api/country/us/parties/2" && (init.method ?? "GET") === "GET") {
        return { ok: true, json: async () => party };
      }
      if (requestUrl.endsWith("/election")) {
        return { ok: true, json: async () => ({ isCandidate: {} }) };
      }
      return { ok: true, json: async () => ({}) };
    })
  );

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PartyHubPage scope={{ kind: "national", countryCode: "us", partyId: "2" }} />
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PartyHubPage join warning", () => {
  it("warns a current party member below the Join party button", async () => {
    renderHub("1");

    const joinButton = await screen.findByRole("button", { name: "Join party" });
    const warning = screen.getByRole("note");

    expect(warning.textContent).toBe(PARTY_SWITCH_ELECTION_WARNING);
    expect(joinButton.parentElement?.lastElementChild).toBe(warning);
  });

  it("does not warn an Independent joiner", async () => {
    renderHub("independent");

    await screen.findByRole("button", { name: "Join party" });
    expect(screen.queryByRole("note")).toBeNull();
  });
});
