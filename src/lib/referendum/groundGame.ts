/**
 * Preset-driven ground-game spend on a referendum. A spender picks a named
 * action card (the preset catalog) and a target — the whole electorate (the
 * preset's magnitude spread across all cohorts) or one tapped cohort (the
 * magnitude concentrated). Cost is the preset's fixed amount: officials spend
 * Political Strength, players spend Actions + Campaign Funds. The debit and the
 * cohort effect apply together — a failed debit writes nothing. yesShare is
 * recomputed via the SSOT.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { spendPoliticalStrength } from "@/lib/parties/commands/spendPoliticalStrength";
import { WIRE_GROUND_MIN_DELTA } from "@/lib/constants/referendum";
import { findGroundGamePreset } from "@/lib/constants/groundGamePresets";
import { applyPresetToModifiers } from "@/lib/referendum/applyPresetToModifiers";
import { referendumYesShare } from "@/lib/referendum/resolveYesShare";
import { recordWireEvent } from "@/lib/referendum/wire";

export interface GroundGameInput {
  referendumId: string;
  side: "yes" | "no";
  presetId: string;
  target: "whole" | { groupId: string };
  mode: "official" | "volunteer";
  /** The acting character (volunteer debit target). */
  characterId: ObjectId;
  /** sequentialId-string of the actor's party — official mode only. */
  partyId?: string;
  countryId: CountryId;
  /** Display name for the wire (party abbreviation, or player name) — from the route. */
  actorName?: string;
}

export interface GroundGameResult {
  status: number;
  body: { error?: string; yesShare?: number; cost?: Record<string, number> };
}

export async function spendGroundGame(db: Db, input: GroundGameInput): Promise<GroundGameResult> {
  const preset = findGroundGamePreset(input.presetId);
  if (!preset) return { status: 400, body: { error: "Unknown campaign action." } };

  const refs = getReferendumCollection(db);
  const ref = await refs.findOne({ _id: new ObjectId(input.referendumId) });
  if (!ref) return { status: 404, body: { error: "Referendum not found." } };
  if (ref.status !== "campaigning") {
    return { status: 400, body: { error: "No active campaign for this referendum." } };
  }
  const baseline = ref.cohortBaseline ?? [];
  const target = input.target;
  if (target !== "whole" && !baseline.some((c) => c.groupId === target.groupId)) {
    return { status: 400, body: { error: "Unknown target cohort." } };
  }

  // Debit FIRST (the preset's fixed cost) — a failed debit must write no effect.
  let cost: Record<string, number>;
  if (input.mode === "official") {
    if (!input.partyId) {
      return { status: 400, body: { error: "Official ground game needs a party." } };
    }
    const turn = await getCurrentTurn(db);
    const spend = await spendPoliticalStrength(
      {
        countryId: "UK",
        partyId: input.partyId,
        scope: "state",
        stateId: ref.regionId,
        baseCost: preset.ps,
        action: "referendum-ground-game",
        now: new Date(),
        turn,
      },
      db
    );
    if (!spend.ok) {
      return { status: 400, body: { error: "Insufficient Political Strength." } };
    }
    cost = { ps: spend.effectiveCost ?? preset.ps };
  } else {
    const res = await db.collection("characters").updateOne(
      {
        _id: input.characterId,
        actions: { $gte: preset.actions },
        "currencyBalances.campaign": { $gte: preset.funds },
      },
      { $inc: { actions: -preset.actions, "currencyBalances.campaign": -preset.funds } }
    );
    if (!res || res.modifiedCount === 0) {
      return { status: 400, body: { error: "Not enough Actions or Campaign Funds." } };
    }
    cost = { actions: preset.actions, funds: preset.funds };
  }

  // Apply the preset to the cohort modifiers (whole spreads, cohort concentrates).
  const mods = applyPresetToModifiers(
    baseline,
    ref.cohortModifiers ?? [],
    preset,
    input.side,
    target
  );

  // Ledger (audit + UI) — attribute whole-electorate pushes to a synthetic row.
  const ledgerGroupId = target === "whole" ? "_whole" : target.groupId;
  const ledger = [...(ref.groundGameUnits ?? [])];
  const li = ledger.findIndex((g) => g.groupId === ledgerGroupId);
  const curL =
    li >= 0
      ? ledger[li]
      : { groupId: ledgerGroupId, mobilizeUnits: 0, persuadeYes: 0, persuadeNo: 0 };
  const nextL =
    preset.effect === "mobilize"
      ? { ...curL, mobilizeUnits: curL.mobilizeUnits + (preset.turnoutPush ?? 0) }
      : input.side === "yes"
        ? { ...curL, persuadeYes: curL.persuadeYes + (preset.leanSwing ?? 0) }
        : { ...curL, persuadeNo: curL.persuadeNo + (preset.leanSwing ?? 0) };
  if (li >= 0) ledger[li] = nextL;
  else ledger.push(nextL);

  const priorYesShare = referendumYesShare(ref);
  const yesShare = referendumYesShare({ ...ref, cohortModifiers: mods });
  await refs.updateOne(
    { _id: ref._id },
    { $set: { cohortModifiers: mods, groundGameUnits: ledger, yesShare, updatedAt: new Date() } }
  );

  // Pushes that actually moved the needle hit the wire.
  if (Math.abs(yesShare - priorYesShare) >= WIRE_GROUND_MIN_DELTA) {
    const targetLabel =
      target === "whole"
        ? "the whole electorate"
        : target.groupId === "_all"
          ? "all voters"
          : target.groupId.replace(/_/g, " ");
    await recordWireEvent(db, {
      referendumId: ref._id!,
      countryId: ref.countryId,
      regionId: ref.regionId,
      turn: await getCurrentTurn(db),
      kind: "ground",
      side: input.side,
      delta: Number((yesShare - priorYesShare).toFixed(2)),
      summary: `${input.actorName ?? "A campaigner"} ran ${preset.label} across ${targetLabel} (${
        input.side === "yes" ? "Yes" : "No"
      }).`,
    }).catch(() => {});
  }

  return { status: 200, body: { yesShare, cost } };
}
