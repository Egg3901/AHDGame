/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MilitaryRosterTab } from "./MilitaryRosterTab";
import type { MilitaryUnitView } from "../../useCabinetOffice";
import type { CommanderRef } from "@/lib/military/types";

afterEach(cleanup);

const COMMANDERS: CommanderRef[] = [
  { id: "gen1", name: "Gen. Alpha", spec: "Armor Officer", level: 3, fit: 74 },
];

function unit(p: Partial<MilitaryUnitView>): MilitaryUnitView {
  return {
    _id: "u1",
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "1st Vanguard Infantry Division",
    type: "Infantry Division",
    icon: "soldier",
    posture: "standard",
    techTier: 1,
    personnel: 12000,
    readiness: 70,
    basePower: 48,
    upkeepBase: 70,
    vet: 1,
    xp: 0,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    effectivePower: 44,
    effectiveUpkeep: 180,
    ...p,
  };
}

function renderTab(units: MilitaryUnitView[], onUpdate = vi.fn(), canAct = true) {
  return render(
    <MilitaryRosterTab
      countryCode="us"
      countryId="US"
      positionId="secretary_of_defense"
      units={units}
      commanders={COMMANDERS}
      canAct={canAct}
      currencySymbol="$"
      gdp={387_000_000_000}
      hasBudget={true}
      baselineGdp={387_000_000_000}
      appropriation={100_000_000_000}
      appropriationNetPerTurn={1_000_000_000}
      arrearsRatio={0}
      upkeepPerIndexUnit={1_000}
      manpowerPool={1_000_000}
      onUpdate={onUpdate}
    />
  );
}

describe("MilitaryRosterTab", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("renders branch sub-tabs and the active branch's units", () => {
    renderTab([
      unit({ _id: "u1", branchId: "army" }),
      unit({ _id: "u2", branchId: "navy", name: "Carrier Group" }),
    ]);
    expect(screen.getByText("U.S. Army")).toBeTruthy();
    expect(screen.getByText("U.S. Navy")).toBeTruthy();
    // default branch = first (army) → army unit visible, navy not
    expect(screen.getByText("1st Vanguard Infantry Division")).toBeTruthy();
    expect(screen.queryByText("Carrier Group")).toBeNull();
  });

  it("opens the recruit panel and posts a recruit", async () => {
    const onUpdate = vi.fn();
    renderTab([unit({})], onUpdate);
    fireEvent.click(screen.getByText("Recruit unit"));
    expect(screen.getByText(/Recruit a new U.S. Army unit/)).toBeTruthy();
    fireEvent.click(screen.getByText("Authorize recruitment · 1 action"));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
      "/api/country/us/executive/cabinet/secretary_of_defense/military/recruit",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("posts a posture change from a unit's Manage panel", async () => {
    renderTab([unit({ _id: "u9" })]);
    fireEvent.click(screen.getByText("Manage"));
    const forwardBtn = screen.getByText("Forward-Deployed");
    fireEvent.click(forwardBtn);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
      "/api/country/us/executive/cabinet/secretary_of_defense/military/u9/posture",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("assigns a unit to a general from its Manage panel", async () => {
    renderTab([unit({ _id: "u9" })]);
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.change(screen.getByRole("combobox", { name: /assign 1st vanguard/i }), {
      target: { value: "gen1" },
    });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
      "/api/country/us/executive/cabinet/secretary_of_defense/military/u9/assign",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("stays on the navy tab after switching to it", () => {
    renderTab([
      unit({ _id: "u1", branchId: "army" }),
      unit({ _id: "u2", branchId: "navy", name: "Carrier Group" }),
    ]);
    fireEvent.click(screen.getByText("U.S. Navy"));
    expect(screen.getByText("Carrier Group")).toBeTruthy();
    expect(screen.queryByText("1st Vanguard Infantry Division")).toBeNull();
  });

  it("assigns every unit of the visible branch in one order", async () => {
    renderTab([
      unit({ _id: "u1", branchId: "army" }),
      unit({ _id: "u2", branchId: "navy", name: "Carrier Group" }),
    ]);
    fireEvent.click(screen.getByText("U.S. Navy"));
    fireEvent.change(screen.getByRole("combobox", { name: /assign all u\.s\. navy units/i }), {
      target: { value: "gen1" },
    });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
      "/api/country/us/executive/cabinet/secretary_of_defense/military/assign-branch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ branchId: "navy", assignedGeneralId: "gen1" }),
      })
    );
  });

  it("shows the unit's assigned general in the order-of-battle row", () => {
    renderTab([unit({ _id: "u9", assignedGeneralId: "gen1" })]);
    expect(screen.getByText(/Assigned · Gen\. Alpha/)).toBeTruthy();
  });

  it("disables actions when canAct is false", () => {
    renderTab([unit({})], vi.fn(), false);
    expect((screen.getByText("Recruit unit") as HTMLButtonElement).disabled).toBe(true);
  });

  // Era-gated branch catalog (from development). The `regions` prop these arrived
  // with is gone on this branch — W1 retired cabinet stationing and unthreaded it —
  // so they render against the merged props instead.
  it("shows no branches for West Germany before the Bundeswehr exists", () => {
    render(
      <MilitaryRosterTab
        countryCode="de"
        countryId="DE"
        positionId="defense_minister"
        units={[]}
        commanders={COMMANDERS}
        canAct={true}
        currencySymbol="€"
        gdp={387_000_000_000}
        hasBudget={true}
        baselineGdp={387_000_000_000}
        appropriation={100_000_000_000}
        appropriationNetPerTurn={1_000_000_000}
        arrearsRatio={0}
        upkeepPerIndexUnit={1_000}
        onUpdate={vi.fn()}
        liveYear={1953}
      />
    );
    expect(screen.getByText("No branches configured.")).toBeTruthy();
    expect(screen.queryByText("Heer")).toBeNull();
  });

  it("shows Bundeswehr branches once the live year reaches 1955", () => {
    render(
      <MilitaryRosterTab
        countryCode="de"
        countryId="DE"
        positionId="defense_minister"
        units={[]}
        commanders={COMMANDERS}
        canAct={true}
        currencySymbol="€"
        gdp={387_000_000_000}
        hasBudget={true}
        baselineGdp={387_000_000_000}
        appropriation={100_000_000_000}
        appropriationNetPerTurn={1_000_000_000}
        arrearsRatio={0}
        upkeepPerIndexUnit={1_000}
        onUpdate={vi.fn()}
        liveYear={1955}
      />
    );
    expect(screen.getByText("Heer")).toBeTruthy();
    expect(screen.getByText("Marine")).toBeTruthy();
    expect(screen.getByText("Luftwaffe")).toBeTruthy();
  });

  // Ticket #1248: reunification carried East Germany's NVA units into DE
  // (mergeMilitary re-flags them), but the branch tabs built from DE's own
  // catalog had no tab for landstreitkraefte / volksmarine / luftstreitkraefte,
  // so the war veterans rendered nowhere and the roster read as "my units were
  // deleted and replaced by west German ones".
  it("shows a tab for an absorbed branch and renders its inherited units", () => {
    render(
      <MilitaryRosterTab
        countryCode="de"
        countryId="DE"
        positionId="defense_minister"
        units={[
          unit({
            _id: "u-nva-1",
            countryId: "DE",
            branchId: "landstreitkraefte",
            name: "1st tank division",
          }),
          unit({ _id: "u-de-1", countryId: "DE", branchId: "heer", name: "West Heer Unit" }),
        ]}
        commanders={COMMANDERS}
        canAct={true}
        currencySymbol="€"
        gdp={387_000_000_000}
        hasBudget={true}
        baselineGdp={387_000_000_000}
        appropriation={100_000_000_000}
        appropriationNetPerTurn={1_000_000_000}
        arrearsRatio={0}
        upkeepPerIndexUnit={1_000}
        onUpdate={vi.fn()}
        liveYear={1963}
      />
    );
    // The absorbed branch resolves its label from the absorbed country's table.
    expect(screen.getByText("Land Forces")).toBeTruthy();
    fireEvent.click(screen.getByText("Land Forces"));
    expect(screen.getByText("1st tank division")).toBeTruthy();
    // The country's own services still render beside it.
    expect(screen.getByText("Heer")).toBeTruthy();
  });

  it("hides the recruit button on an absorbed branch tab", () => {
    render(
      <MilitaryRosterTab
        countryCode="de"
        countryId="DE"
        positionId="defense_minister"
        units={[
          unit({
            _id: "u-nva",
            countryId: "DE",
            branchId: "landstreitkraefte",
            name: "1st tank division",
          }),
        ]}
        commanders={COMMANDERS}
        canAct={true}
        currencySymbol="€"
        gdp={387_000_000_000}
        hasBudget={true}
        baselineGdp={387_000_000_000}
        appropriation={100_000_000_000}
        appropriationNetPerTurn={1_000_000_000}
        arrearsRatio={0}
        upkeepPerIndexUnit={1_000}
        onUpdate={vi.fn()}
        liveYear={1963}
      />
    );
    fireEvent.click(screen.getByText("Land Forces"));
    expect(screen.queryByText("Recruit unit")).toBeNull();
    // The inherited units stay manageable: the bulk assign control remains.
    expect(screen.getByRole("combobox", { name: /assign all land forces units/i })).toBeTruthy();
  });

  it("titles an unknown absorbed branch from its raw id rather than hiding the units", () => {
    render(
      <MilitaryRosterTab
        countryCode="de"
        countryId="DE"
        positionId="defense_minister"
        units={[
          unit({ _id: "u-x", countryId: "DE", branchId: "mystery_corps", name: "Ghost Unit" }),
        ]}
        commanders={COMMANDERS}
        canAct={true}
        currencySymbol="€"
        gdp={387_000_000_000}
        hasBudget={true}
        baselineGdp={387_000_000_000}
        appropriation={100_000_000_000}
        appropriationNetPerTurn={1_000_000_000}
        arrearsRatio={0}
        upkeepPerIndexUnit={1_000}
        onUpdate={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Mystery Corps"));
    expect(screen.getByText("Ghost Unit")).toBeTruthy();
  });
});
