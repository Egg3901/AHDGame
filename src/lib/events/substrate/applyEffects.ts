import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { Character } from "@/lib/db/types/character";
import type { ElectionCandidate } from "@/lib/db/types/election";
import type { EventEffect } from "@/lib/db/types/events";
import type { SentimentPulse } from "@/lib/db/types/sentimentPulse";
import {
  anchorToLocal,
  campaignAnchorToLocal,
  loadCampaignFxRate,
} from "@/lib/campaigns/campaignCurrency";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { creditTreasury, spendFromTreasury } from "@/lib/budget/treasurySpend";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  writeSectorDemandModifier,
  writeSectorOutputDemandModifier,
  writeWarEmergencyMitigation,
} from "./countryModifiers";
import { applyCivilLibertiesDelta } from "@/lib/politicalMetrics/civilLiberties";
import type { EventResolveContext } from "./types";

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

async function loadCharacter(ctx: EventResolveContext): Promise<Character | null> {
  return ctx.db.collection<Character>("characters").findOne({ _id: ctx.instance.scopeId });
}

/**
 * Country-scope declarative effects (World Events v1 Phase 0). `instance.payload.countryId`
 * carries the real string CountryId — `scopeId` is a hashed lookup key, not usable
 * for federalBudget/governmentApprovals/countryModifiers writes (see countryScopeId.ts).
 */
async function applyCountryEffects(
  ctx: EventResolveContext,
  effects: EventEffect[]
): Promise<void> {
  const countryId = ctx.instance.payload.countryId as CountryId | undefined;
  if (!countryId) {
    throw new Error(
      `applyDeclarativeEffects: country-scope instance ${ctx.instance._id.toHexString()} is missing payload.countryId`
    );
  }

  for (const effect of effects) {
    switch (effect.type) {
      case "treasuryDelta": {
        if (effect.deltaAnchor === 0) break;
        // Anchor ₳ is treated 1:1 with local currency here (matches the rest of
        // the substrate's `personalWealth` handling when forex is off; country
        // treasuries are already local-currency-denominated documents).
        const amountLocal = effect.deltaAnchor;
        if (amountLocal > 0) {
          await creditTreasury(ctx.db, countryId, amountLocal);
        } else {
          await spendFromTreasury(ctx.db, countryId, -amountLocal);
        }
        // Ledger conservation is non-negotiable (plan §7): every treasuryDelta
        // writes financialTxLog with a dedicated tx type so the shadow ledger
        // (when ledgerShadow is on) derives a balanced entry against a system
        // mint/sink bucket — see deriveFromTx.ts.
        await emitTx(ctx.db, {
          type: "world_event_payout",
          turn: ctx.currentTurn,
          createdAt: new Date(),
          subjectType: "government",
          countryId,
          subjectName: countryId,
          amount: amountLocal,
          currencyCode: COUNTRY_CURRENCY_MAP[countryId],
          counterpartyType: "system",
          meta: { kind: ctx.instance.kind, instanceId: ctx.instance._id.toHexString() },
        });
        break;
      }
      case "approvalDelta": {
        if (effect.delta === 0) break;
        await ctx.db
          .collection("governmentApprovals")
          .updateOne(
            { _id: countryId as unknown as ObjectId },
            { $inc: { approvalRating: effect.delta } }
          );
        break;
      }
      case "sectorDemandModifier": {
        await writeSectorDemandModifier(ctx.db, {
          countryId,
          sectorType: effect.sectorType,
          pct: effect.pct,
          durationTurns: effect.durationTurns,
          appliedAtTurn: ctx.currentTurn,
          sourceInstanceId: ctx.instance._id,
        });
        break;
      }
      case "sectorOutputDemandModifier": {
        await writeSectorOutputDemandModifier(ctx.db, {
          countryId,
          sectorType: effect.sectorType,
          pct: effect.pct,
          durationTurns: effect.durationTurns,
          appliedAtTurn: ctx.currentTurn,
          sourceInstanceId: ctx.instance._id,
        });
        break;
      }
      case "warEmergencyMitigation": {
        await writeWarEmergencyMitigation(ctx.db, {
          countryId,
          pct: effect.pct,
          durationTurns: effect.durationTurns,
          appliedAtTurn: ctx.currentTurn,
          sourceInstanceId: ctx.instance._id,
        });
        break;
      }
      case "civilLibertiesDelta": {
        await applyCivilLibertiesDelta(ctx.db, countryId, effect.delta);
        break;
      }
      case "wireOnly":
        // Pure news — no mechanical effect.
        break;
      default:
        // Character-only effect types reaching a country-scope instance is a
        // definition bug, not a runtime condition to silently swallow.
        throw new Error(
          `applyDeclarativeEffects: effect type "${effect.type}" is not valid for country scope`
        );
    }
  }
}

/**
 * World Events v1 Phase 3: standalone treasury-delta application for the
 * Olympics/worlds-fair award pass, which is a system turn-phase computation
 * (no EventInstance being resolved) rather than a handler's `applyEffects`
 * hook. Mirrors `applyCountryEffects`'s `treasuryDelta` branch exactly (same
 * creditTreasury/spendFromTreasury + financialTxLog `world_event_payout` tx
 * kind) so ledger conservation holds identically for award-time refunds and
 * host settlement as it does for bid-time escrow.
 */
export async function applyCountryTreasuryDelta(
  db: Parameters<typeof creditTreasury>[0],
  countryId: CountryId,
  currentTurn: number,
  deltaAnchor: number,
  meta: Record<string, unknown>
): Promise<void> {
  if (deltaAnchor === 0) return;
  const amountLocal = deltaAnchor;
  if (amountLocal > 0) {
    await creditTreasury(db, countryId, amountLocal);
  } else {
    await spendFromTreasury(db, countryId, -amountLocal);
  }
  await emitTx(db, {
    type: "world_event_payout",
    turn: currentTurn,
    createdAt: new Date(),
    subjectType: "government",
    countryId,
    subjectName: countryId,
    amount: amountLocal,
    currencyCode: COUNTRY_CURRENCY_MAP[countryId],
    counterpartyType: "system",
    meta,
  });
}

/** World Events v1 Phase 3 award-pass equivalent of the `approvalDelta` effect branch. */
export async function applyCountryApprovalDelta(
  db: Parameters<typeof creditTreasury>[0],
  countryId: CountryId,
  delta: number
): Promise<void> {
  if (delta === 0) return;
  await db
    .collection("governmentApprovals")
    .updateOne({ _id: countryId as unknown as ObjectId }, { $inc: { approvalRating: delta } });
}

export async function applyDeclarativeEffects(
  ctx: EventResolveContext,
  effects: EventEffect[]
): Promise<void> {
  if (effects.length === 0) {
    return;
  }
  if (ctx.instance.scope === "country") {
    await applyCountryEffects(ctx, effects);
    return;
  }
  if (ctx.instance.scope !== "character") {
    throw new Error(`applyDeclarativeEffects: unsupported scope "${ctx.instance.scope}"`);
  }

  const characterId = ctx.instance.scopeId;
  const character = await loadCharacter(ctx);
  if (!character) {
    throw new Error(`applyDeclarativeEffects: character ${characterId.toHexString()} not found`);
  }

  const forexEnabled = await isForexEnabled();
  const homeCurrency = getHomeCurrency(character);
  const charUpdates: Record<string, number> = {};
  let favorability = character.favorability ?? 50;
  let infamy = character.infamy ?? 0;
  let politicalInfluence = character.politicalInfluence ?? 0;

  for (const effect of effects) {
    switch (effect.type) {
      case "favorability":
        favorability = clampStat(favorability + effect.delta);
        break;
      case "infamy":
        infamy = clampStat(infamy + effect.delta);
        break;
      case "politicalInfluence":
        politicalInfluence = Math.max(0, politicalInfluence + effect.delta);
        break;
      case "personalWealth": {
        const { rate } = await loadCampaignFxRate(ctx.db, character.countryId);
        const localAmount = forexEnabled
          ? anchorToLocal(effect.deltaAnchor, rate)
          : effect.deltaAnchor;
        for (const [key, val] of Object.entries(
          buildPersonalBalanceInc(localAmount, homeCurrency, forexEnabled)
        )) {
          charUpdates[key] = (charUpdates[key] ?? 0) + val;
        }
        break;
      }
      case "campaignFunds": {
        const electionIdRaw = ctx.instance.payload.electionId;
        if (!electionIdRaw) {
          break;
        }
        const electionId =
          electionIdRaw instanceof ObjectId ? electionIdRaw : new ObjectId(String(electionIdRaw));
        // Campaign funds are decoupled from live forex — convert at the frozen
        // base INITIAL_RATES scale, never the live exchangeRates.
        const localDelta = campaignAnchorToLocal(effect.deltaLocal, character.countryId);
        const campaignField = forexEnabled ? "currencyBalances.campaign" : "funds";
        await ctx.db
          .collection("campaigns")
          .updateOne({ characterId, electionId }, { $inc: { [campaignField]: localDelta } });
        break;
      }
      case "campaignSupport": {
        const candidateIdRaw = ctx.instance.payload.candidateId;
        if (!candidateIdRaw) {
          break;
        }
        const candidateId =
          candidateIdRaw instanceof ObjectId
            ? candidateIdRaw
            : new ObjectId(String(candidateIdRaw));
        const candidate = await ctx.db
          .collection<ElectionCandidate>("electionCandidates")
          .findOne({ _id: candidateId });
        if (!candidate) {
          break;
        }
        const next = clampStat((candidate.support ?? 50) + effect.delta);
        await ctx.db
          .collection<ElectionCandidate>("electionCandidates")
          .updateOne({ _id: candidateId }, { $set: { support: next } });
        break;
      }
      case "corpSentiment": {
        const corpIdRaw = ctx.instance.payload.corporationId;
        if (!corpIdRaw) {
          break;
        }
        const pulse: Omit<SentimentPulse, "_id"> = {
          scope: "corp",
          corpId: String(corpIdRaw),
          initialImpact: effect.delta / 100,
          decayRate: 0.85,
          createdAt: new Date(),
          eventType: `pree.${ctx.instance.kind}`,
        };
        await ctx.db.collection<SentimentPulse>("sentimentPulses").insertOne({
          _id: new ObjectId(),
          ...pulse,
        });
        break;
      }
      case "custom":
        break;
      default:
        break;
    }
  }

  const setFields: Record<string, unknown> = {
    favorability,
    infamy,
    politicalInfluence,
    updatedAt: new Date(),
  };
  const update: Record<string, unknown> = { $set: setFields };
  if (Object.keys(charUpdates).length > 0) {
    update.$inc = charUpdates;
  }
  await ctx.db.collection<Character>("characters").updateOne({ _id: characterId }, update);
}
