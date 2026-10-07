/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/parties.json";
import { PartyHubPage } from "./PartyHubPage";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/country/us/parties/2",
}));
// Lazy tab panels are not part of the leave flow; render none of them.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const LEAVE_URL = "/api/country/us/parties/2/leave";

const user = {
  username: "member-one",
  isAdmin: false,
  hasCharacter: true,
  character: { id: "char-1", party: "2", homeState: "CA", countryId: "US" },
};

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
  members: [{ id: "char-1", name: "Member One", homeState: "CA", currentOffice: null }],
};

let releaseLeave: () => void = () => {};

function stubHub() {
  const handler = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u === "/api/auth/me") return { ok: true, json: async () => ({ user }) };
    if (u === "/api/country/us/parties/2" && (init.method ?? "GET") === "GET") {
      return { ok: true, json: async () => party };
    }
    if (u.endsWith("/election")) {
      return { ok: true, json: async () => ({ isCandidate: {} }) };
    }
    if (u === LEAVE_URL) {
      await new Promise<void>((resolve) => {
        releaseLeave = resolve;
      });
      return { ok: true, json: async () => ({ message: "Left party" }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", handler);
  return handler;
}

function leaveCalls(handler: ReturnType<typeof stubHub>) {
  return handler.mock.calls.filter(([url]) => String(url) === LEAVE_URL);
}

// The desktop online window and the mobile client hold no dialog permission,
// so the native bridge answers confirm() with an async rejection (#3375).
// Built lazily so the trap itself never leaves an unhandled rejection.
const nativeConfirm = vi.fn(() =>
  Promise.reject("Command plugin:dialog|confirm not allowed by ACL")
);

beforeEach(() => {
  nativeConfirm.mockClear();
  vi.stubGlobal("confirm", nativeConfirm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHub() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PartyHubPage scope={{ kind: "national", countryCode: "us", partyId: "2" }} />
    </NextIntlClientProvider>
  );
}

async function openLeaveDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Leave party" }));
  return within(await screen.findByRole("dialog"));
}

describe("PartyHubPage leave confirmation (#3375)", () => {
  it("cancel closes the in-page dialog without a leave request or native dialog", async () => {
    const handler = stubHub();
    renderHub();

    const dialog = await openLeaveDialog();
    expect(dialog.getByText("You will become an Independent.")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(leaveCalls(handler)).toHaveLength(0);
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Leave party" }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("confirm sends exactly one leave POST, even on a double click, and refreshes the player", async () => {
    const handler = stubHub();
    renderHub();

    const dialog = await openLeaveDialog();
    const confirmButton = dialog.getByRole("button", { name: "Leave party" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    const pending = await screen.findByRole("button", { name: "Leaving…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);

    await waitFor(() => expect(leaveCalls(handler)).toHaveLength(1));
    expect(leaveCalls(handler)[0][1]).toMatchObject({ method: "POST" });

    const meCallsBefore = handler.mock.calls.filter(([u]) => u === "/api/auth/me").length;
    releaseLeave();
    await screen.findByText(/Left party/);
    await waitFor(() =>
      expect(handler.mock.calls.filter(([u]) => u === "/api/auth/me").length).toBe(
        meCallsBefore + 1
      )
    );
    expect(leaveCalls(handler)).toHaveLength(1);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
