/**
 * SCOTUS Docket Turn (#3598).
 *
 * Fires pending Docket cases once their authored decision year's turn is
 * reached. Evaluates `decideCaseOutcome` (pure, unit-tested in isolation)
 * against the currently seated justices' leans on the case's tagged axis. An
 * affirmed case is a no-op on the enactment pipeline (matches how the rest of
 * the timeline already plays out). A diverged case with an authored `effect`
 * synthesizes a minimal bill-shaped object and drives it through the
 * EXISTING `onBillEnacted` pipeline — same enactment -> metric-registry ->
 * regional-lean-drift flow real legislation uses — tagged
 * `source: "scotus_ruling"` for attribution.
 *
 * Every decided case — affirmed or diverged, with or without an `effect` —
 * gets a full news/wire post (`generateScotusRulingNews`, previously this
 * turn posted nothing at all: see that module's doc comment). A case
 * authored with `demographicSignal` instead of/alongside `effect` (the
 * reapportionment cases — Baker v. Carr, Reynolds v. Sims, Wesberry v.
 * Sanders) additionally records a `countryHistoryEvents` row so a future,
 * separately-owned demographic-realignment mechanism can react to it; this
 * turn does not itself move seats or district lines.
 *
 * `historicalOutcomeLocked` cases (race/equal-protection doctrine — Brown v.
 * Board and similar) skip composition-driven divergence entirely: `outcome`
 * is always "affirmed". This is a deliberate, permanent product decision, not
 * a gap — see `decideCaseOutcome`'s doc comment.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { onBillEnacted } from "@/lib/billEnactment";
import type { DocketCase, SupremeCourtSeat } from "@/lib/db/types/scotus";
import type { PolicyProvision } from "@/lib/db/types/legislation";
import { decideCaseOutcome, type SeatedJusticeLean } from "@/lib/scotus/divergence";
import { yearToTurn } from "@/lib/scotus/turnConversion";
import { generateScotusRulingNews } from "@/lib/scotus/scotusNews";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export interface ScotusDocketTurnResult {
  casesFired: number;
  casesAffirmed: number;
  casesDiverged: number;
}

export async function processScotusDocketTurn(
  currentTurn: number,
  db?: Db
): Promise<ScotusDocketTurnResult> {
  const database = db ?? (await getDb());
  const gameState = await getGameState();
  const startingYear =
    gameState?.startingYear ?? getStartingYearForPreset(gameState?.preset ?? DEFAULT_SEED_PRESET);

  const pendingCases = await database
    .collection<DocketCase>("docketCases")
    .find({ countryId: "US", status: "pending" })
    .toArray();

  const dueCases = pendingCases.filter(
    (c) => currentTurn >= yearToTurn(c.decisionYear, startingYear)
  );
  if (dueCases.length === 0) {
    return { casesFired: 0, casesAffirmed: 0, casesDiverged: 0 };
  }

  const seats = await database
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .find({ countryId: "US" })
    .toArray();
  const seatedJustices: SeatedJusticeLean[] = seats
    .filter((s) => s.justiceCharacterId || s.justiceNppId || s.justiceMode === "historical")
    .map((s) => ({ economicLean: s.economicLean ?? 0, socialLean: s.socialLean ?? 0 }));

  let casesAffirmed = 0;
  let casesDiverged = 0;
  const now = new Date();

  for (const docketCase of dueCases) {
    // historicalMajorityDirection is optional on DocketCase only to accommodate
    // procedurally-spawned surprise cases (#3607), which are always inserted
    // directly as status: "decided" and therefore never appear in the
    // `status: "pending"` query above — every case reaching this loop is real
    // curated content and always has this field authored.
    const decision = decideCaseOutcome(
      seatedJustices,
      docketCase.axis,
      docketCase.historicalMajorityDirection as 1 | -1,
      // Race/equal-protection cases (Brown v. Board and similar — see
      // `DocketCase.historicalOutcomeLocked`'s doc comment) always resolve to
      // their real historical outcome; every other case is genuinely
      // composition-driven.
      { historicalOutcomeLocked: docketCase.historicalOutcomeLocked === true }
    );

    let enactedLawId: ObjectId | undefined;
    if (decision.outcome === "diverged" && docketCase.effect) {
      const provision: PolicyProvision = {
        type: "policy",
        legislationTypeId: docketCase.effect.legislationTypeId,
        policyOptionId: docketCase.effect.policyOptionId,
        effectDirection: docketCase.effect.effectDirection,
        economic: docketCase.effect.economic,
        social: docketCase.effect.social,
      };
      const syntheticBillId = new ObjectId();
      await onBillEnacted(
        database,
        {
          _id: syntheticBillId,
          title: `${docketCase.title} (SCOTUS ruling)`,
          legislationTypeId: docketCase.effect.legislationTypeId,
          effectDirection: docketCase.effect.effectDirection,
          provisions: [provision],
          countryId: "US",
          stateId: docketCase.effect.stateId ?? "federal",
          source: "scotus_ruling",
        },
        currentTurn
      );

      const enactedLawRow = await database
        .collection("enactedLaws")
        .findOne({ billId: syntheticBillId }, { projection: { _id: 1 }, sort: { enactedAt: -1 } });
      enactedLawId = enactedLawRow?._id as ObjectId | undefined;
    }

    if (decision.outcome === "affirmed") casesAffirmed++;
    else casesDiverged++;

    await database.collection<DocketCase>("docketCases").updateOne(
      { _id: docketCase._id },
      {
        $set: {
          status: "decided",
          outcome: decision.outcome,
          decidedAtTurn: currentTurn,
          decidedAt: now,
          decisionSeatedFor: decision.positiveCount,
          decisionSeatedAgainst: decision.negativeCount,
          ...(enactedLawId && { enactedLawId }),
          updatedAt: now,
        },
      }
    );

    // Demographic-realignment hook (see file header + DocketCase.demographicSignal
    // doc comment) — record which branch's signal applies. Read-only: nothing
    // here consumes it to move seats/districts/base leans.
    if (docketCase.demographicSignal) {
      const signal =
        decision.outcome === "affirmed"
          ? docketCase.demographicSignal.affirmedSignal
          : docketCase.demographicSignal.divergedSignal;
      await recordCountryEvent(database, {
        countryId: "US",
        turn: currentTurn,
        eventType: "scotus_demographic_signal",
        title: `${docketCase.title}: ${signal}`,
        details: {
          caseKey: docketCase.caseKey,
          signal,
          axis: docketCase.axis,
          decisionYear: docketCase.decisionYear,
          outcome: decision.outcome,
        },
      }).catch((err) =>
        console.error(
          `[scotusDocketTurn] demographic signal record failed for ${docketCase.caseKey}:`,
          err
        )
      );
    }

    // Full news/wire post for every decided case (see scotusNews.ts doc comment).
    await generateScotusRulingNews(docketCase, decision).catch((err) =>
      console.error(`[scotusDocketTurn] news post failed for ${docketCase.caseKey}:`, err)
    );
  }

  return { casesFired: dueCases.length, casesAffirmed, casesDiverged };
}
