/**
 * Applies legislation effects to state metrics when a bill is signed into law.
 * Applies each provision's effect (or legacy single legislationTypeId/effectDirection).
 * Tariff provisions are routed to applyTariffProvision; subsidy provisions to
 * applySubsidyProvision/applyEndSubsidyProvision; policy provisions use the
 * existing metric-delta path.
 */

import * as Sentry from "@sentry/nextjs";
import type { Db, Filter, ObjectId } from "mongodb";
import type {
  Bill,
  LegislationType,
  StateMetrics,
  TariffProvision,
  SubsidyProvision,
  EndSubsidyProvision,
} from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type { CreateDepartmentProvision } from "@/lib/db/types/legislation";
import type { GameState } from "@/lib/db/types/gameState";
import { getLegislationEffectDelta } from "@shared/constants/formulas";
import { applyTariffProvision, fireTariffProvisionSentiment } from "@/lib/tariffs/tariffEffects";
import { applySubsidyProvision, applyEndSubsidyProvision } from "@/lib/subsidies/subsidyEffects";
import { applyNationalizeProvision } from "@/lib/nationalization/legislativeNationalize";
import { computeNationalizationProvisionDetail } from "@/lib/nationalization/billTargetPreview";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { declareWar } from "@/lib/military/declareWar";
import { allianceBarBetween } from "@/lib/military/allianceBar";
import { joinSide } from "@/lib/military/joinSide";
import { getConflict } from "@/lib/db/collections/conflicts";
import { applyPrivatizeProvision } from "@/lib/nationalization/legislativePrivatize";
import { applyDesignateStrategicSectorProvision } from "@/lib/nationalization/legislativeDesignateStrategic";
import { applyUnionLawProvision, isUnionsBanned } from "@/lib/labour/unionLaws";
import { triggerUnionBanStrike } from "@/lib/crises/unionBanStrike";
import {
  applyOrgFundProvision,
  applyOrgLeaveProvision,
  applyOrgJoinProvision,
} from "@/lib/internationalOrganizations/membershipBills";
import type { CountryId } from "@/lib/constants/countries";
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import { boardDeltaForLegacyEffect } from "@/lib/politicalLegislation/legacyEffectBridge";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";

/** National pseudo-state ids (federal, uk_national, …) vs real sub-national regions (XB, TX, …). */
export function getNonPolicyProvisionScope(stateId: string | undefined): "national" | "state" {
  if (!stateId || inferCountryIdFromStateId(stateId)) {
    return "national";
  }
  return "state";
}

async function applyOneProvision(
  db: Db,
  legislationTypeId: string,
  effectDirection: number,
  countryId: CountryId | null
): Promise<void> {
  if (effectDirection == null || effectDirection === 0) return;

  const lt = await db
    .collection<LegislationType>("legislationTypes")
    .findOne({ _id: legislationTypeId });
  if (!lt?.effectTarget) return;

  const delta = getLegislationEffectDelta(effectDirection);
  if (delta === 0) return;

  const { metricCategoryId, metricId } = lt.effectTarget;
  const path = `${metricCategoryId}.${metricId}.value`;
  // Macro paths still write macroMetrics globally; political paths go to the
  // enacting country's board (below).
  if (isMacroMetricPath(path)) {
    await db
      .collection<StateMetrics>("macroMetrics")
      .updateMany({}, { $inc: { [path]: delta }, $set: { lastUpdated: new Date() } });
    return;
  }
  // Political effects land on the BOARD, as a residual shift. An $inc on the
  // value would be drifted straight back out by the dynamics phase — a law has
  // to move the equilibrium to stick. Scoped to the enacting country; the
  // legacy write this replaced applied to every non-playable region in the
  // world regardless of who passed the bill.
  //
  // A bill with no countryId cannot be attributed to a board, so its political
  // effect is dropped rather than applied to everyone.
  if (countryId) {
    const residual = boardDeltaForLegacyEffect(metricCategoryId, metricId, delta);
    if (!residual) return;
    // Through applyBoardDelta, NOT a dotted update path: board docs key
    // `residuals` by literal dotted strings, so `{ $inc: { "residuals.x.y": d } }`
    // is read as a PATH and quietly creates `residuals: { x: { y: d } }`. The
    // read side looks up the dotted key, finds nothing, and the law's effect is
    // silently lost with no error anywhere.
    await applyBoardDelta(
      db,
      { countryId } as Filter<PoliticalMetricsDoc>,
      residual.familyId,
      residual.scoreDelta,
      "residual"
    );
    return;
  }
}

/**
 * Derive a CountryId from a bill. Post-migration all bills should have
 * countryId set directly — the old stateId-prefix parsing is no longer valid.
 */
function getBillCountryId(bill: Pick<Bill, "countryId">): CountryId | null {
  return (bill.countryId as CountryId) ?? null;
}

/**
 * Structural act: record `positionId` in gameState.manuallyEnabledSeats so the
 * roster resolver brings the seat into existence regardless of its era, and the
 * parent seat picks up its post-split name (e.g. HEW -> HHS). Idempotent.
 */
async function applyCreateDepartmentProvision(db: Db, p: CreateDepartmentProvision): Promise<void> {
  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" as unknown as GameState["_id"] },
      { $addToSet: { manuallyEnabledSeats: p.positionId }, $set: { updatedAt: new Date() } }
    );
}

export async function applyLegislationEffect(
  db: Db,
  bill: Pick<
    Bill,
    "_id" | "legislationTypeId" | "effectDirection" | "provisions" | "countryId" | "stateId"
  >
): Promise<void> {
  // Which country's board a political effect lands on. Hoisted because the
  // per-provision `countryId` below is scoped to the non-policy branch.
  const billCountryId = getBillCountryId(bill);
  if (bill.provisions?.length) {
    for (const [provisionIndex, p] of bill.provisions.entries()) {
      if (!isPolicyProvision(p)) {
        // Non-policy provisions (tariff/subsidy/end_subsidy) need a country context
        const countryId = getBillCountryId(bill);
        if (!countryId) {
          Sentry.captureMessage("Non-policy provision skipped: bill has no countryId", {
            level: "error",
            extra: { billId: bill._id?.toString(), type: p.type },
          });
          continue;
        }
        if (p.type === "nationalize") {
          // Freeze the affected-corp / treasury-cost breakdown as it stands NOW,
          // before the taking executes, so the bill view keeps showing the cost as
          // it was when the bill passed instead of recomputing to zero once the
          // assets are taken. Best-effort: a snapshot failure must not block the
          // actual taking below.
          try {
            const snapshotTurn = await getCurrentTurn(db);
            const snapshot = await computeNationalizationProvisionDetail(
              db,
              countryId,
              p,
              snapshotTurn
            );
            if (snapshot && bill._id) {
              await db
                .collection("bills")
                .updateOne(
                  { _id: bill._id },
                  { $set: { [`provisions.${provisionIndex}.nationalizationSnapshot`]: snapshot } }
                );
            }
          } catch (err) {
            console.error("[legislationEffects] nationalization snapshot failed:", err);
          }
          // Legislative nationalization (spec §9.2): passage IS the authorization.
          await applyNationalizeProvision(db, countryId, p);
        } else if (p.type === "privatize") {
          // Legislative privatization (spec §13.5): passage IS the authorization.
          await applyPrivatizeProvision(db, countryId, p);
        } else if (p.type === "designate_strategic_sector") {
          // Arm the strategic nationalization trigger (spec §6.3/§8).
          await applyDesignateStrategicSectorProvision(db, countryId, p);
        } else if (p.type === "subsidy") {
          const scope = getNonPolicyProvisionScope(bill.stateId);
          await applySubsidyProvision(
            db,
            countryId,
            scope,
            bill.stateId,
            p as SubsidyProvision,
            bill._id as ObjectId
          );
        } else if (p.type === "end_subsidy") {
          const scope = getNonPolicyProvisionScope(bill.stateId);
          await applyEndSubsidyProvision(
            db,
            countryId,
            scope,
            bill.stateId,
            p as EndSubsidyProvision
          );
        } else if (p.type === "international_organization") {
          // International-organization membership actions (Foreign Policy). Fund
          // moves treasury → org fund; leave/join effects land in later tasks.
          if (p.subType === "fund") {
            await applyOrgFundProvision(db, countryId, p);
          } else if (p.subType === "leave") {
            await applyOrgLeaveProvision(db, bill, countryId, p);
          } else if (p.subType === "join") {
            await applyOrgJoinProvision(db, bill, p);
          }
        } else if (p.type === "declare_war") {
          // The chambers ratified it, so the war starts now: open a conflict hosted
          // in the defender, or enrol this country in the one already being fought
          // there. Must sit above the tariff catch-all below, which would otherwise
          // cast a declaration to a TariffProvision.
          //
          // The alliance bar is re-read HERE and not only at proposal, for the reason
          // `declareWar` re-reads the pair war: a declaration sits before the chambers
          // for turns, and either country can accede to the other's bloc while it does.
          // Without this, a bill filed against a neutral would open an intra-alliance
          // war the proposal gate had already refused. A ratified declaration that has
          // become an attack on an ally is dropped rather than enacted.
          const alliedNow = await allianceBarBetween(db, countryId, p.targetCountry);
          if (!alliedNow) {
            await declareWar(db, {
              declarer: countryId,
              defender: p.targetCountry,
              warGoal: p.warGoal,
              billId: String(bill._id),
              currentTurn: await getCurrentTurn(db),
            });
          }
        } else if (p.type === "join_conflict") {
          // Up to 48 turns of world state separate the bloc's vote from this
          // effect — 24 at the organisation and 24 on the floor — so re-check
          // both the conflict and this country's place in it. Must sit above the
          // tariff catch-all below, which would otherwise cast it to a
          // TariffProvision.
          const conflict = await getConflict(db, p.theaterId);
          if (conflict && conflict.status !== "resolved") {
            const opposing = p.side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
            // Never switch a country's side: it can have been dragged onto the
            // other one by its own declaration while this bill was on the floor.
            if (!(opposing as string[]).includes(countryId)) {
              // Idempotent — joinSide returns early if the roster already has it.
              await joinSide(db, conflict, countryId, p.side);
            }
          }
        } else if (p.type === "embargo" || p.type === "end_embargo") {
          // Durable embargoes have no per-provision enactment write: the trade
          // turn's `reconcileSignedEmbargoBills` full-rebuilds legislation-origin
          // embargoes from every signed embargo bill, so the record materializes
          // (and repeals land) on the next turn. Skipping here avoids the tariff
          // catch-all below misapplying it as a tariff.
        } else if (p.type === "union_law") {
          // v3 Phase 7b. Must stay above the tariff catch-all below — otherwise
          // this provision (no `rate`/`scopeType`/tariff fields) would be cast
          // to TariffProvision and corrupt a real tariff record.
          //
          // A ban is read BEFORE the write so the wildcat general strike fires on
          // the transition, not on the state: re-banning a country that is
          // already banned is not a new provocation and must not spawn a second
          // strike. `triggerUnionBanStrike` re-checks the ban and refuses when
          // the country has no unions or is already striking.
          const wasBanned = p.banAction === "ban" ? await isUnionsBanned(db, countryId) : false;
          await applyUnionLawProvision(db, countryId, p);
          if (p.banAction === "ban" && !wasBanned) {
            await triggerUnionBanStrike(db, countryId, await getCurrentTurn(db));
          }
        } else if (p.type === "create_department") {
          // Structural act: bring a seat into existence regardless of its era.
          // Must stay above the tariff catch-all (no tariff fields to cast).
          await applyCreateDepartmentProvision(db, p);
        } else {
          // Real enactment path — apply the data write, then fire sentiment
          // pulses only if the tariff rate actually changed. The reconcile
          // replay path (`reconcileSignedTariffBills`) calls `applyTariffProvision`
          // directly without this side effect.
          const tariffProvision = p as TariffProvision;
          const { rateChanged } = await applyTariffProvision(
            db,
            countryId,
            tariffProvision,
            bill._id as ObjectId
          );
          if (rateChanged) {
            await fireTariffProvisionSentiment(db, countryId, tariffProvision);
          }
        }
      } else {
        await applyOneProvision(db, p.legislationTypeId, p.effectDirection, billCountryId);
      }
    }
    return;
  }
  if (bill.legislationTypeId && bill.effectDirection != null) {
    await applyOneProvision(db, bill.legislationTypeId, bill.effectDirection, billCountryId);
  }
}
