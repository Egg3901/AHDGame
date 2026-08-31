/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@/contexts/ToastContext";
import WhiteHouseClient from "./WhiteHouseClient";

// WhiteHouseClient renders NationalApprovalStat → ApprovalTooltip, which calls
// useRouter(); without the App Router context that throws and crashes the tree.
const tabParam = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  // The shell seeds its initial tab from `?tab=`. No params here, so every test
  // below opens on the overview exactly as it did before.
  useSearchParams: () => new URLSearchParams(tabParam),
}));

const conflictsSpy = vi.fn().mockReturnValue(true);
vi.mock("@/contexts/AuthDataContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConflictsEnabled: () => conflictsSpy(),
}));
// The shell's gating is what is under test here, not the panels inside the tab.
vi.mock("@/app/country/[code]/executive/components/ForeignAffairsTab", () => ({
  ForeignAffairsTab: ({ canAct }: { canAct: boolean }) => (
    <div data-testid="foreign-affairs-tab">canAct:{String(canAct)}</div>
  ),
}));

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockWhiteHouseFetch(whitehouse: Record<string, unknown>): void {
  global.fetch = vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/api/whitehouse/bills")) return Promise.resolve(jsonResponse({ bills: [] }));
    if (u.includes("/api/whitehouse/cabinet"))
      return Promise.resolve(jsonResponse({ positions: [] }));
    if (u.includes("/approval")) return Promise.resolve(jsonResponse({ governmentApproval: 50 }));
    if (u.includes("/api/admin/officials/appoint"))
      return Promise.resolve(jsonResponse({ characters: [] }));
    if (u.includes("/api/whitehouse")) return Promise.resolve(jsonResponse(whitehouse));
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;
}

const president = {
  id: "p1",
  characterId: "c1",
  sequentialId: 1,
  characterName: "Jed Bartlet",
  party: "1",
  partyName: "Democratic",
  partyColor: "#0000ff",
  countryId: "US",
};

const adminData = {
  president,
  vicePresident: null,
  presidentOfficialId: "off-pres",
  vicePresidentOfficialId: "off-vp",
  isAdmin: true,
  isPresident: false,
  isVicePresident: false,
};

describe("WhiteHouseClient admin tab", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the Overview president card read-only and exposes appoint controls in the Admin tab", async () => {
    mockWhiteHouseFetch(adminData);
    render(
      <ToastProvider>
        <WhiteHouseClient />
      </ToastProvider>
    );
    await waitFor(() => expect(screen.getByText("Jed Bartlet")).toBeTruthy());

    // Overview (default tab): no admin appoint/change buttons
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();

    // Admin tab present and reveals the appoint controls
    const adminTabBtn = screen.getByRole("button", { name: "Admin" });
    adminTabBtn.click();
    await waitFor(() => expect(screen.getByTestId("whitehouse-admin-tab")).toBeTruthy());
    const adminTab = screen.getByTestId("whitehouse-admin-tab");
    expect(within(adminTab).getByRole("button", { name: "Change" })).toBeTruthy(); // filled president
    expect(within(adminTab).getByRole("button", { name: "Appoint" })).toBeTruthy(); // vacant VP
  });

  it("links an NPP-held president to the NPP profile, not /character/", async () => {
    const nppPresident = {
      id: "n1",
      characterId: "",
      sequentialId: 42,
      characterName: "Dapo Olatunji",
      party: "6",
      partyName: "Social Democratic Party",
      partyColor: "#00aa00",
      countryId: "NG",
      isNPP: true,
    };
    mockWhiteHouseFetch({
      president: nppPresident,
      vicePresident: null,
      presidentOfficialId: "off-pres",
      vicePresidentOfficialId: null,
      isAdmin: false,
      isPresident: false,
      isVicePresident: false,
    });
    render(
      <ToastProvider>
        <WhiteHouseClient countryId="NG" />
      </ToastProvider>
    );
    await waitFor(() => expect(screen.getByText("Dapo Olatunji")).toBeTruthy());
    const link = screen.getByRole("link", { name: /Dapo Olatunji/ });
    expect(link.getAttribute("href")).toBe("/politicians/npp/42");
  });

  it("hides the Admin tab from non-admins", async () => {
    mockWhiteHouseFetch({ ...adminData, isAdmin: false, isPresident: true });
    render(
      <ToastProvider>
        <WhiteHouseClient />
      </ToastProvider>
    );
    await waitFor(() => expect(screen.getByText("Jed Bartlet")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
});

describe("WhiteHouseClient foreign affairs tab", () => {
  beforeEach(() => conflictsSpy.mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  /** Mount the White House with the given viewer flags. */
  function renderWith(flags: { isPresident: boolean; isAdmin: boolean }) {
    mockWhiteHouseFetch({
      president,
      vicePresident: null,
      presidentOfficialId: "off-pres",
      vicePresidentOfficialId: "off-vp",
      isVicePresident: false,
      ...flags,
    });
    return render(
      <ToastProvider>
        <WhiteHouseClient />
      </ToastProvider>
    );
  }

  it("shows for the sitting president", async () => {
    renderWith({ isPresident: true, isAdmin: false });
    expect(await screen.findByRole("button", { name: "Foreign Affairs" })).toBeTruthy();
  });

  it("shows for an admin", async () => {
    renderWith({ isPresident: false, isAdmin: true });
    expect(await screen.findByRole("button", { name: "Foreign Affairs" })).toBeTruthy();
  });

  it("is hidden from a visitor", async () => {
    renderWith({ isPresident: false, isAdmin: false });
    await waitFor(() => expect(screen.getByText("Jed Bartlet")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Foreign Affairs" })).toBeNull();
  });

  it("is hidden when the conflicts subsystem is off", async () => {
    conflictsSpy.mockReturnValue(false);
    renderWith({ isPresident: true, isAdmin: false });
    await waitFor(() => expect(screen.getByText("Jed Bartlet")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Foreign Affairs" })).toBeNull();
  });

  it("mounts the tab body when the president opens it", async () => {
    renderWith({ isPresident: true, isAdmin: false });
    (await screen.findByRole("button", { name: "Foreign Affairs" })).click();
    await waitFor(() =>
      expect(screen.getByTestId("foreign-affairs-tab").textContent).toBe("canAct:true")
    );
  });
});
