/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ForceSummaryView } from "./useCabinetOffice";

// vi.mock is hoisted above const declarations, so the fixture has to be too.
const fixtures = vi.hoisted(() => ({
  forceSummary: {
    unitCount: 1,
    totalPower: 84,
    totalPersonnel: 15000,
    totalUpkeep: 468,
    avgReadiness: 70,
    forwardShare: 0,
    envelope: 920e9,
    treasuryBalance: 12_345,
    gdp: 387_000_000_000,
    militaryPriceBaselineGdp: 387_000_000_000,
    appropriation: 11_610_000_000,
    appropriationAccrual: 241_875_000,
    appropriationUpkeep: 133_031_250,
    arrearsRatio: 0,
    hasBudget: true,
    tier: "standard",
  },
}));

// Typed OUTSIDE the untyped vi.mock factory, so tsc actually checks it. Inside
// the factory it is never contextually typed by ForceSummaryView and a missing
// field would ship silently.
const _typeCheck: ForceSummaryView = fixtures.forceSummary;
void _typeCheck;

// Defaults to false so every pre-existing test in this file keeps the tab set it
// was written against; the deep-link block below opts in.
const conflictsSpy = vi.hoisted(() => vi.fn().mockReturnValue(false));
vi.mock("@/contexts/AuthDataContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConflictsEnabled: () => conflictsSpy(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "us", positionId: "secretary_of_defense" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// eslint-disable-next-line @next/next/no-img-element -- test mock replaces next/image with a plain img
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <img alt="" {...p} /> }));
vi.mock("@/components/Avatar", () => ({ Avatar: () => <span /> }));
vi.mock("@/app/congress/components/CongressShared", () => ({ PartyChip: () => <span /> }));
// Stub Overview-tab panels (default tab) — keep the test focused on the force UI.
vi.mock("./components/TierSettingPanel", () => ({ TierSettingPanel: () => <div>TIER</div> }));
vi.mock("./components/RegionalTargetPanel", () => ({ RegionalTargetPanel: () => <div>RT</div> }));
vi.mock("./components/EmergencyMechanicPanel", () => ({
  EmergencyMechanicPanel: () => <div>EM</div>,
}));
vi.mock("./components/MinisterialOrderPanel", () => ({
  MinisterialOrderPanel: () => <div>ORDERS</div>,
}));
vi.mock("./components/RegionalBreakdownTable", () => ({
  RegionalBreakdownTable: () => <div>RB</div>,
}));
vi.mock("./components/CabinetBannerUploader", () => ({ CabinetBannerUploader: () => <div /> }));

vi.mock("./useCabinetOffice", () => ({
  useCabinetOffice: () => ({
    loading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      canAct: true,
      member: {
        characterId: "c1",
        characterName: "Gen. Hale",
        party: "p1",
        ministerialActions: 3,
        bannerImageUrl: null,
      },
      nationalMetrics: {},
      regionData: [{ regionId: "CA", regionName: "California", population: 100, metrics: {} }],
      regionalBudgets: [],
      currentSettings: null,
      orders: [],
      activeOrders: [],
      targetCountries: [],
      mechanics: {},
      units: [
        {
          _id: "u1",
          countryId: "US",
          branchId: "army",
          domain: "ground",
          name: "1st Vanguard Tank",
          type: "Armored Division",
          icon: "tank",
          posture: "standard",
          techTier: 1,
          personnel: 15000,
          readiness: 70,
          basePower: 92,
          upkeepBase: 180,
          vet: 1,
          xp: 0,
          equipment: { firepower: 1, protection: 1, support: 1 },
          drill: null,
          theaterId: "reserve",
          assignedGeneralId: null,
          createdTurn: 1,
          effectivePower: 84,
          effectiveUpkeep: 468,
        },
      ],
      forceSummary: fixtures.forceSummary,
    },
  }),
}));

import CabinetOfficePage from "./page";

afterEach(cleanup);

describe("CabinetOfficePage — defense seat", () => {
  it("shows the force strip and the Military flagship roster", () => {
    render(<CabinetOfficePage />);
    // Masthead force strip (defense) instead of the metric strip
    expect(screen.getByText("Combat power")).toBeTruthy();
    // The flagship tab is labelled Military
    const militaryTab = screen.getByRole("button", { name: "Military" });
    fireEvent.click(militaryTab);
    // Roster renders the unit + recruit affordance
    expect(screen.getByText("1st Vanguard Tank")).toBeTruthy();
    expect(screen.getByText("Recruit unit")).toBeTruthy();
  });
});

describe("CabinetOfficePage — tab deep-link via hash", () => {
  beforeEach(() => conflictsSpy.mockReturnValue(true));
  afterEach(() => {
    window.location.hash = "";
    conflictsSpy.mockReturnValue(false);
  });

  it("opens the Commands tab when the URL names it", () => {
    // How the Commanding General's page links back to their command's structure.
    window.location.hash = "#commands";
    render(<CabinetOfficePage />);
    const tab = screen.getByRole("button", { name: "Commands" });
    expect(tab.getAttribute("aria-selected") ?? tab.className).toBeTruthy();
    // The Commands tab body is what actually proves the selection took.
    expect(screen.getByText(/How your troops reach a front/i)).toBeTruthy();
  });

  it("still opens on Overview with no hash", () => {
    render(<CabinetOfficePage />);
    expect(screen.queryByText(/How your troops reach a front/i)).toBeNull();
  });

  it("ignores a hash naming a tab this seat does not have", () => {
    // #treasury on a defence office would otherwise select a tab whose body never
    // renders, leaving a blank panel.
    window.location.hash = "#treasury";
    render(<CabinetOfficePage />);
    expect(screen.queryByText(/How your troops reach a front/i)).toBeNull();
  });

  it("ignores a hash that is not a tab at all", () => {
    window.location.hash = "#nonsense";
    render(<CabinetOfficePage />);
    expect(screen.queryByText(/How your troops reach a front/i)).toBeNull();
  });
});
