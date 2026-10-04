import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { OrganizationWarPlanningContext } from "./warDeclarationPlanning";
import { planOrganizationWarDeclarationFromDb } from "./warDeclarationPlanning";

function context(
  access: Record<string, { enabledForPlayers?: boolean; nppGoverned?: boolean }>,
  latestDeclarationTurn = new Map<CountryId, number>()
): OrganizationWarPlanningContext {
  return {
    conflictsEnabled: true,
    access: access as OrganizationWarPlanningContext["access"],
    allianceRoll: { blocs: {}, preset: "1953-default" },
    activeTrucePairIds: new Set(),
    latestDeclarationTurn,
    liveConflicts: [],
  };
}

describe("organization war declaration planning shell", () => {
  it("applies national declaration cooldowns to players but not automatic NPP entry", async () => {
    const plan = await planOrganizationWarDeclarationFromDb({
      db: {} as Db,
      memberIds: ["US", "FR"],
      targetCountryId: "CN",
      currentTurn: 100,
      context: context(
        {
          US: { enabledForPlayers: true },
          FR: { enabledForPlayers: false, nppGoverned: true },
          CN: { enabledForPlayers: true },
        },
        new Map<CountryId, number>([
          ["US", 99],
          ["FR", 99],
        ])
      ),
    });

    expect(plan.playerLegislation).toEqual([]);
    expect(plan.automaticNpp).toEqual(["FR"]);
    expect(plan.excluded).toContainEqual({ countryId: "US", reason: "legally_ineligible" });
  });

  it("observes same-turn cooldown entries added to a shared snapshot", async () => {
    const shared = context({
      US: { enabledForPlayers: true },
      CN: { enabledForPlayers: true },
    });
    const input = {
      db: {} as Db,
      memberIds: ["US"],
      targetCountryId: "CN" as const,
      currentTurn: 100,
      context: shared,
    };

    await expect(planOrganizationWarDeclarationFromDb(input)).resolves.toMatchObject({
      playerLegislation: ["US"],
    });
    shared.latestDeclarationTurn.set("US", 100);
    await expect(planOrganizationWarDeclarationFromDb(input)).resolves.toMatchObject({
      playerLegislation: [],
    });
  });
});
