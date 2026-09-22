import type { CountryId } from "@/lib/constants/countries";
import type { CrisisOptionAction } from "@/lib/db/types/crisis";
import { applyCountryTreasuryDelta } from "@/lib/events/substrate/applyEffects";
import {
  writeSectorOutputDemandModifier,
  writeWarEmergencyMitigation,
} from "@/lib/events/substrate/countryModifiers";
import { applyCivilLibertiesDelta } from "@/lib/politicalMetrics/civilLiberties";
import { logWireEvent } from "@/lib/wireEvent";
import type { CrisisActionContext } from "./optionActions";
import { CIVIL_DEFENSE_SECTOR_SHIFTS, type WarEmergencySectorShift } from "./warEmergencyBalance";

export type WarEmergencyResponseId = Extract<
  CrisisOptionAction,
  { kind: "warEmergencyResponse" }
>["response"];

interface WarEmergencyResponseEffects {
  label: string;
  approval?: number;
  treasuryCost?: number;
  mitigation?: { pct: number; durationTurns: number };
  civilLiberties?: number;
  sectors?: readonly WarEmergencySectorShift[];
}

const RESPONSE_EFFECTS: Record<WarEmergencyResponseId, WarEmergencyResponseEffects> = {
  panic_ration: {
    label: "Emergency rationing imposed",
    approval: -3,
    mitigation: { pct: 12, durationTurns: 18 },
    civilLiberties: -2,
    sectors: [
      { sectorType: "retail", pct: -8, durationTurns: 8 },
      { sectorType: "entertainment", pct: -5, durationTurns: 8 },
      { sectorType: "manufacturing", pct: 6, durationTurns: 8 },
      { sectorType: "defense", pct: 8, durationTurns: 8 },
    ],
  },
  panic_calm: {
    label: "The public is urged to buy normally",
    approval: 1,
    sectors: [{ sectorType: "retail", pct: 4, durationTurns: 4 }],
  },
  panic_release: {
    label: "Strategic stockpiles released",
    approval: 2,
    treasuryCost: 10_000,
    mitigation: { pct: 8, durationTurns: 10 },
    sectors: [
      { sectorType: "retail", pct: 2, durationTurns: 4 },
      { sectorType: "manufacturing", pct: 3, durationTurns: 6 },
      { sectorType: "defense", pct: 2, durationTurns: 6 },
    ],
  },
  bank_guarantee: {
    label: "All bank deposits guaranteed",
    approval: 3,
    treasuryCost: 20_000,
    mitigation: { pct: 10, durationTurns: 12 },
    sectors: [{ sectorType: "financial", pct: 3, durationTurns: 6 }],
  },
  bank_holiday: {
    label: "Bank holiday declared",
    approval: -4,
    mitigation: { pct: 14, durationTurns: 18 },
    civilLiberties: -3,
    sectors: [
      { sectorType: "financial", pct: -8, durationTurns: 6 },
      { sectorType: "retail", pct: -6, durationTurns: 8 },
      { sectorType: "manufacturing", pct: 6, durationTurns: 8 },
      { sectorType: "defense", pct: 7, durationTurns: 8 },
    ],
  },
  bank_stand_by: {
    label: "Government stands by the banks",
    approval: -2,
    sectors: [{ sectorType: "financial", pct: -5, durationTurns: 6 }],
  },
  civil_defense_fund: {
    label: "National shelter program funded",
    approval: 2,
    treasuryCost: 15_000,
    mitigation: { pct: 10, durationTurns: 14 },
    sectors: CIVIL_DEFENSE_SECTOR_SHIFTS.fund,
  },
  civil_defense_drills: {
    label: "Civil defense drills ordered",
    approval: 1,
    mitigation: { pct: 8, durationTurns: 12 },
    civilLiberties: -1,
    sectors: CIVIL_DEFENSE_SECTOR_SHIFTS.drills,
  },
  civil_defense_dismiss: {
    label: "Civil defense panic dismissed",
    approval: -2,
  },
  protests_address: {
    label: "The nation is addressed",
    approval: 1,
    mitigation: { pct: 4, durationTurns: 8 },
  },
  protests_march: {
    label: "Peace marches allowed to continue",
    approval: -2,
  },
  protests_crackdown: {
    label: "Peace marches dispersed",
    approval: -6,
    mitigation: { pct: 18, durationTurns: 24 },
    civilLiberties: -7,
    sectors: [
      { sectorType: "retail", pct: -8, durationTurns: 10 },
      { sectorType: "entertainment", pct: -10, durationTurns: 10 },
      { sectorType: "manufacturing", pct: 8, durationTurns: 10 },
      { sectorType: "defense", pct: 10, durationTurns: 10 },
    ],
  },
};

/** Apply a crisis decision to the real country systems it is meant to change. */
export async function applyWarEmergencyResponse(
  ctx: CrisisActionContext,
  responseId: WarEmergencyResponseId
): Promise<void> {
  const effects = RESPONSE_EFFECTS[responseId];
  const countryId = ctx.countryId as CountryId;

  if (effects.approval) {
    await ctx.db
      .collection("governmentApprovals")
      .updateOne(
        { _id: countryId as unknown as import("mongodb").ObjectId },
        { $inc: { approvalRating: effects.approval } }
      );
  }
  if (effects.treasuryCost) {
    await applyCountryTreasuryDelta(ctx.db, countryId, ctx.currentTurn, -effects.treasuryCost, {
      source: "war_emergency_crisis",
      crisisId: ctx.crisis._id.toHexString(),
      responseId,
    });
  }
  if (effects.mitigation) {
    await writeWarEmergencyMitigation(ctx.db, {
      countryId,
      ...effects.mitigation,
      appliedAtTurn: ctx.currentTurn,
      sourceInstanceId: ctx.crisis._id,
    });
  }
  if (effects.civilLiberties) {
    await applyCivilLibertiesDelta(ctx.db, countryId, effects.civilLiberties);
  }
  for (const sector of effects.sectors ?? []) {
    await writeSectorOutputDemandModifier(ctx.db, {
      countryId,
      ...sector,
      appliedAtTurn: ctx.currentTurn,
      sourceInstanceId: ctx.crisis._id,
    });
  }

  await logWireEvent("crisis_outcome", `${countryId}: ${effects.label}`);
}
