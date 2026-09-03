// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ObjectId } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { natMods } from "@/lib/military/doctrineTree";
import { CombatCommandClient } from "./CombatCommandClient";

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function unit(over: Partial<MilitaryUnit> = {}): MilitaryUnit {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "1st Vanguard Armored Division",
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
    ...over,
  };
}

function renderClient(extra: Record<string, unknown> = {}) {
  return render(
    <CombatCommandClient
      {...extra}
      units={[
        unit({ theaterId: "afghan" }),
        unit({ type: "Fighter Wing", domain: "air", branchId: "airforce", icon: "jet" }),
      ]}
      country="US"
      countryCode="us"
      positionId="secretary_of_defense"
      canWrite={extra.canWrite !== false}
      currentTurn={1284}
      natMods={natMods({})}
      conflictAssignments={[]}
      generalsById={{}}
      positions={{}}
      pendingDeclarations={[]}
      reports={[]}
      conflicts={[
        {
          id: "afghan",
          name: "Central Asian Front",
          hostCountry: "CN",
          control: 100,
          sideALabel: "NATO",
          sideBLabel: "PLA",
          enemyCountries: ["CN"],
          occupier: "A",
          occupierCountry: "US",
          hostRegionCodes: [],
        },
      ]}
    />
  );
}

describe("CombatCommandClient (smoke render)", () => {
  it("renders the header, screen nav, and order of battle", () => {
    renderClient();
    expect(screen.getByRole("heading", { name: "Combat Command", level: 1 })).toBeTruthy();
    expect(screen.getByText("Order of Battle")).toBeTruthy();
    expect(screen.getByText("War Room")).toBeTruthy();
    expect(screen.getAllByText("CV").length).toBeGreaterThan(0);
  });

  it("declares an offensive from the War Room (fires the declare route)", () => {
    renderClient();
    fireEvent.click(screen.getByText("War Room"));
    expect(screen.getByText("ACTIVE FRONTS")).toBeTruthy();
    // a unit is deployed to afghan (first contested front) → the declare control shows
    fireEvent.click(screen.getByText("⚔ DECLARE OFFENSIVE"));
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(url).toContain("/battle/declare");
  });

  it("navigates to Doctrine & Command", () => {
    renderClient();
    fireEvent.click(screen.getByText("Doctrine & Command"));
    expect(screen.getByText("NATIONAL DOCTRINE · FORCE-WIDE")).toBeTruthy();
  });

  it("makes order controls read-only for a viewer who does not hold defence", () => {
    renderClient({ canWrite: false });
    expect(screen.getByText(/read-only view/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Unit Dossier"));
    expect(screen.getByLabelText("Posture")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Battle role")).toHaveProperty("disabled", true);
  });
});

describe("Commanding General hint", () => {
  const hint = { unpostedGenerals: 2, href: "/country/us/general/commands" };

  it("points a CG with unposted generals at their command page", () => {
    // This page cannot post generals, by design. Without the pointer a CG is one
    // click from the war and cannot find the door.
    renderClient({ cgHint: hint });
    const link = screen.getByRole("link", { name: /command page/i });
    expect(link.getAttribute("href")).toBe("/country/us/general/commands");
  });

  it("says how many are unposted", () => {
    renderClient({ cgHint: hint });
    expect(screen.getByRole("link", { name: /2 of your generals are not posted/i })).toBeTruthy();
  });

  it("uses the singular for one", () => {
    renderClient({ cgHint: { ...hint, unpostedGenerals: 1 } });
    expect(screen.getByRole("link", { name: /1 of your generals is not posted/i })).toBeTruthy();
  });

  it("shows nothing for a viewer who is not a CG", () => {
    // The server passes null rather than a zero count.
    renderClient();
    expect(screen.queryByRole("link", { name: /command page/i })).toBeNull();
  });
});
