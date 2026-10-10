import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { resetCabinetActions } from "./catalog";
import { activateAction, combineActiveActionEffects } from "./rules/actions";
import { openingCabinetActionStates } from "./rules/actionState";
import {
  applyCabinetPoliticalInputs,
  applyCabinetWhipPressure,
  cabinetApprovalResponse,
  cabinetEffectsForRegion,
  cabinetMacroTargetNudges,
  cabinetProductionPressure,
  CABINET_GAMEPLAY_FAMILIES,
} from "./rules/gameplay";
import { loadCabinetGameplayEffects } from "./loadGameplayEffects";
import { cabinetDisciplineForParty, loadCabinetDiscipline } from "./loadDiscipline";
import { loadPoliticalMacroInputs } from "@/lib/politicalLegislation/politicalMacroInputs";
import { loadResetApprovalModifiers } from "@/lib/resetMetrics/loadApprovalModifiers";
import { buildOpeningMetricSnapshots1991 } from "@/lib/resetMetrics/seedOpening1991";
import { computeWhipForce } from "@/lib/turn/npp/crossPressure";
import type { NPP } from "@/lib/db/types";
import { METRIC_REGISTRY_SORTED } from "@/lib/metricEngine/registry";

const game = {
  _id: "current",
  currentTurn: 1,
  preset: "1991-default",
  currentYear: 1991,
  resetWorldId: "effects",
  metricsSystemVersion: "v2",
  cabinetSystemVersion: "v2",
  resetVersionSeeds: Object.fromEntries(
    ["metrics", "cabinet"].map((system) => [
      system,
      {
        worldId: "effects",
        sourceTurn: 1,
        revision: RESET_V2_SEED_REVISION[system as "metrics" | "cabinet"],
        completedAt: "verified",
        verificationHash: "verified",
        countries: ["US", "UK", "JP", "IE"],
      },
    ])
  ),
} as GameState;
const action = (target: string) =>
  resetCabinetActions.find((entry) => entry.country === "UK" && entry.target === target)!;
let db: ReturnType<typeof createMockDb>;
beforeEach(() => {
  db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue(game);
  db.collection("resetCabinetActionStates")
    .find()
    .toArray.mockResolvedValue(
      openingCabinetActionStates("effects", 1).map((row) => ({
        ...row,
        active: row.countryId === "UK" ? [activateAction(action("M47"), 1)] : [],
      }))
    );
});

describe("Cabinet gameplay integration", () => {
  it("gives every catalog target an owned gameplay path", () => {
    for (const entry of resetCabinetActions)
      for (const target of entry.target.split("+")) {
        expect(
          Boolean(CABINET_GAMEPLAY_FAMILIES[target]) ||
            ["S:partyDiscipline", "S:governmentApproval"].includes(target),
          target
        ).toBe(true);
      }
  });
  it("keeps country, territorial and veteran-service scopes isolated", () => {
    const active = ["NI", "SCT", "WAL", "Vet"].map((scope) => ({
      ...activateAction(action("M47"), 1),
      scope: scope as "NI" | "SCT" | "WAL" | "Vet",
    }));
    const effects = combineActiveActionEffects(active, 1);
    expect(cabinetEffectsForRegion(effects, "US", "SCO")).toEqual([]);
    expect(cabinetEffectsForRegion(effects, "UK")).toEqual([]);
    expect(cabinetEffectsForRegion(effects, "UK", "ENG")[0].favorableNormalizedPoints).toBe(0.1);
    expect(cabinetEffectsForRegion(effects, "UK", "SCO")[0].favorableNormalizedPoints).toBe(0.2);
  });
  it("loads one projected batch and never writes observed owner values", async () => {
    const effects = await loadCabinetGameplayEffects(db as unknown as Db, game);
    expect(effects).toHaveLength(1);
    expect(db.collectionMocks.resetCabinetActionStates.find).toHaveBeenCalledTimes(2); // includes fixture setup
    const original = { "governance.openness": 50 } as const;
    const applicable = cabinetEffectsForRegion(effects, "UK", "SCO");
    expect(applyCabinetPoliticalInputs(original, applicable)["governance.openness"]).toBe(50.1);
    expect(applyCabinetPoliticalInputs(original, applicable)).toEqual(
      applyCabinetPoliticalInputs(original, applicable)
    );
    expect(original["governance.openness"]).toBe(50);
    expect(db.collectionMocks.resetCabinetActionStates.updateOne).not.toHaveBeenCalled();
  });
  it("rejects other worlds, future seeds and foreign action payloads", async () => {
    const row = openingCabinetActionStates("effects", 1).find((entry) => entry.countryId === "UK")!;
    for (const invalid of [
      { ...row, worldId: "old" },
      { ...row, sourceTurn: 2 },
      { ...row, countryId: "US" },
      { ...row, active: [activateAction({ ...action("M47"), country: "US" }, 1)] },
    ]) {
      db.collection("resetCabinetActionStates").find().toArray.mockResolvedValue([invalid]);
      expect(await loadCabinetGameplayEffects(db as unknown as Db, game)).toEqual([]);
    }
  });
  it("disables all gameplay effects in v1 and ends Staff effects exactly at expiry", async () => {
    expect(
      await loadCabinetGameplayEffects(db as unknown as Db, { ...game, cabinetSystemVersion: "v1" })
    ).toEqual([]);
    expect(await loadCabinetGameplayEffects(db as unknown as Db, game, 12)).toHaveLength(1);
    expect(await loadCabinetGameplayEffects(db as unknown as Db, game, 13)).toEqual([]);
    expect(
      await loadCabinetGameplayEffects(db as unknown as Db, {
        ...game,
        currentTurn: 12,
        isProcessing: true,
        processingKind: "turn",
        processingTargetTurn: 13,
      })
    ).toEqual([]);
  });
  it("reaches the macro input loader without mutating the political board", async () => {
    const values = { "governance.openness": 50 };
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([{ _id: "SCO", countryId: "UK", values }]);
    const result = await loadPoliticalMacroInputs(db as unknown as Db);
    expect(result.score("SCO", "governance.openness")).toBe(50.1);
    const expired = await loadPoliticalMacroInputs(db as unknown as Db, 13);
    expect(expired.score("SCO", "governance.openness")).toBe(50);
    expect(values["governance.openness"]).toBe(50);
  });
  it("reaches approval while keeping conditions and observed values intact", async () => {
    const boards = buildOpeningMetricSnapshots1991("effects", 1).filter(
      (board) => board.countryId === "UK"
    );
    const source = JSON.stringify(boards);
    const result = await loadResetApprovalModifiers(
      db as unknown as Db,
      "UK",
      ["SCO"],
      game,
      1,
      boards
    );
    expect(result!.modifiersByRegion.get("SCO")).toContainEqual(
      expect.objectContaining({
        id: "cabinet_service_response",
        effect: 0.1,
        marginEffect: 0,
        source: "cabinet",
      })
    );
    expect(JSON.stringify(boards)).toBe(source);
    const expired = await loadResetApprovalModifiers(
      db as unknown as Db,
      "UK",
      ["SCO"],
      game,
      1,
      boards,
      []
    );
    expect(expired!.modifiersByRegion.get("SCO")!.some((entry) => entry.source === "cabinet")).toBe(
      false
    );
  });
  it("boosts only formed-government party whips and never invents a directive", async () => {
    const row = openingCabinetActionStates("effects", 1).find((entry) => entry.countryId === "UK")!;
    db.collection("resetCabinetActionStates")
      .find()
      .toArray.mockResolvedValue([
        { ...row, active: [activateAction(action("S:partyDiscipline"), 1)] },
      ]);
    db.collection("governmentFormations")
      .find()
      .toArray.mockResolvedValue([
        { _id: "UK", status: "formed", governingPartyId: "1", coalitionPartyIds: ["2"] },
      ]);
    const discipline = await loadCabinetDiscipline(db as unknown as Db, game);
    expect(cabinetDisciplineForParty(discipline, "UK", "1")).toBeGreaterThan(0);
    expect(cabinetDisciplineForParty(discipline, "UK", "2")).toBeGreaterThan(0);
    expect(cabinetDisciplineForParty(discipline, "UK", "3")).toBe(0);
    expect(cabinetDisciplineForParty(discipline, "US", "1")).toBe(0);
    const npp = { personality: { loyalty: 50, stubbornness: 50 } } as NPP;
    const base = computeWhipForce(npp, { partyWhip: { direction: "for" }, caucusWhip: null });
    const boosted = computeWhipForce(npp, {
      partyWhip: { direction: "for", cabinetDiscipline: discipline[0].bonus },
      caucusWhip: null,
    });
    expect(boosted).toBeGreaterThan(base);
    expect(computeWhipForce(npp, { partyWhip: null, caucusWhip: null })).toBe(0);
    expect(applyCabinetWhipPressure(-30, 0.2)).toBe(-36);
  });
  it("uses signed macro nudges and caps production rather than minting money", () => {
    const effects = [
      "M01",
      "M03",
      "S:costOfLiving",
      "S:tradeGrowth",
      "S:roboticsAdoption",
      "S:smallBusinessFormation",
    ].map((target) => ({ target, favorableNormalizedPoints: 0.14, contributingActions: [] }));
    expect(cabinetMacroTargetNudges(effects)).toMatchObject({
      "economic.unemploymentRate": -0.14,
      "economic.povertyRate": -0.14,
      "economic.costOfLiving": -0.14,
      "economic.tradeGrowth": 0.14,
    });
    expect(cabinetProductionPressure(effects)).toBe(0.2);
    const registered = new Set(METRIC_REGISTRY_SORTED.map((node) => node.id));
    expect(Object.keys(cabinetMacroTargetNudges(effects)).every((id) => registered.has(id))).toBe(
      true
    );
    expect(cabinetApprovalResponse(effects)).toBeCloseTo(0.84);
    expect(cabinetMacroTargetNudges([])).toEqual({});
    expect(cabinetProductionPressure([])).toBe(0);
  });
});
