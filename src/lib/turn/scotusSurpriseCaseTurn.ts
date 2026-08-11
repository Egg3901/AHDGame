/**
 * SCOTUS Surprise Case Turn (#3607, spec #3581/#3598).
 *
 * Each turn, `rollSurpriseCaseSpawn` (pure, unit-tested in isolation) checks
 * whether a procedurally-spawned, non-historical Docket case fires this turn
 * — flavor content on top of the curated real-historical Docket
 * (#3599-3602). Unlike a curated Docket case, a surprise case has no real
 * historical ruling to affirm or diverge from, so there is no "affirms
 * history" no-op state: every spawn produces a ruling, decided purely by the
 * sitting Court's current majority headcount on the picked template's tagged
 * axis (`decideCaseOutcome`, reused unmodified — see the doc comment on
 * `HEADCOUNT_ONLY_PLACEHOLDER_DIRECTION` below for why a placeholder
 * direction is passed in).
 *
 * A fired case is synthesized AND resolved in the same turn — inserted into
 * the shared `docketCases` collection directly as `status: "decided"`
 * (never `"pending"`), tagged `isSurprise: true` so it never enters
 * `scotusDocketTurn.ts`'s pending-case query and so the case-history read
 * layer (`queries.ts` `getScotusCaseHistory`) can tell it apart from real
 * historical content. The resulting ruling (when the majority isn't tied)
 * flows through the exact same `onBillEnacted` pipeline a diverged Docket
 * case uses, tagged `source: "scotus_surprise_ruling"` — a value distinct
 * from `"scotus_ruling"` so financial/audit trails and #3605's UI can
 * separate curated historical rulings from background-probability flavor
 * content.
 *
 * Runs AFTER `scotusDocketTurn.ts` in `scotusTurn.ts` — same ordering
 * rationale as the rest of that file (a same-turn Court composition change
 * should be reflected before a case, historical or surprise, is decided).
 */
import { getEraContext } from "@/lib/era/context";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { onBillEnacted } from "@/lib/billEnactment";
import type { DocketCase, DocketCaseEffect, SupremeCourtSeat } from "@/lib/db/types/scotus";
import type { PolicyProvision } from "@/lib/db/types/legislation";
import { decideCaseOutcome, type SeatedJusticeLean } from "@/lib/scotus/divergence";
import { rollSurpriseCaseSpawn } from "@/lib/scotus/surpriseCaseSpawn";
import { SURPRISE_CASE_TEMPLATES, templatesForYear } from "@/lib/scotus/surpriseCaseTemplates";
import { generateScotusSurpriseNews } from "@/lib/scotus/scotusNews";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export interface ScotusSurpriseCaseTurnResult {
  spawned: boolean;
  caseKey?: string;
  majoritySide?: -1 | 0 | 1;
}

/**
 * `decideCaseOutcome` requires a `historicalMajorityDirection` to compare
 * against, because its `.outcome` field (affirmed/diverged) was designed for
 * curated Docket cases that DO have one. A surprise case doesn't — per
 * #3607 there is no affirm state, every spawn is a ruling — so this constant
 * is a fixed placeholder passed in purely to reuse the function's majority
 * HEADCOUNT tally (`.majoritySide`/`.positiveCount`/`.negativeCount`); its
 * value is arbitrary and its `.outcome` field is deliberately never read
 * below. This is the "reuse the majority-headcount function directly, don't
 * duplicate that logic" approach #3607 asks for, without inventing a second
 * headcount-only helper in `divergence.ts` for one caller.
 */
const HEADCOUNT_ONLY_PLACEHOLDER_DIRECTION = 1 as const;

export async function processScotusSurpriseCaseTurn(
  currentTurn: number,
  db?: Db,
  spawnRandomDraw: number = Math.random(),
  templatePickRandomDraw: number = Math.random()
): Promise<ScotusSurpriseCaseTurnResult> {
  const database = db ?? (await getDb());

  if (!rollSurpriseCaseSpawn(spawnRandomDraw)) {
    return { spawned: false };
  }

  const gameState = await getGameState();
  const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  const startingYear = gameState?.startingYear ?? getStartingYearForPreset(preset);
  // Inverse of turnConversion.ts's yearToTurn — surprise cases have no
  // authored decisionYear (they aren't scripted in advance), so this is
  // simply "what calendar year is it right now."
  const decisionYear = startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);

  const usedTemplateKeys = new Set(
    (
      await database
        .collection<DocketCase>("docketCases")
        .find({ countryId: "US", isSurprise: true }, { projection: { caseKey: 1 } })
        .toArray()
    ).map((c) => c.caseKey)
  );
  // Era filter runs BEFORE the dedup pick so the draw is uniform over cases
  // that could actually be heard this year. The windows cut both ways: a 1953
  // Court cannot hear a solar-cartel antitrust suit, and a 2019 Court cannot sue
  // the Bureau of the Budget, which became OMB in 1970.
  // Gated on the era clock, not on decisionYear. `decisionYear` is always
  // computable (it is just startingYear + turns) and is still what the case is
  // stamped with, but the anachronism FILTER is an era feature and must be off
  // when `eraSystemEnabled` is — otherwise a flag-off world silently loses
  // templates, which is the same inconsistency prospecting had.
  const eraEligible = templatesForYear(
    SURPRISE_CASE_TEMPLATES,
    (await getEraContext(database)).year
  );
  const available = eraEligible.filter((t) => !usedTemplateKeys.has(t.templateKey));
  if (available.length === 0) {
    // Pool exhausted for this era — no unused flavor content left that this
    // year could plausibly produce. Not an error: the spawn hazard just yields
    // nothing until the pool grows or the clock moves into a new window.
    return { spawned: false };
  }
  const templateIndex = Math.min(
    available.length - 1,
    Math.floor(templatePickRandomDraw * available.length)
  );
  const template = available[templateIndex];

  const seats = await database
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .find({ countryId: "US" })
    .toArray();
  const seatedJustices: SeatedJusticeLean[] = seats
    .filter((s) => s.justiceCharacterId || s.justiceNppId || s.justiceMode === "historical")
    .map((s) => ({ economicLean: s.economicLean ?? 0, socialLean: s.socialLean ?? 0 }));

  const decision = decideCaseOutcome(
    seatedJustices,
    template.axis,
    HEADCOUNT_ONLY_PLACEHOLDER_DIRECTION
  );

  const chosenEffect: DocketCaseEffect | undefined =
    decision.majoritySide === 1
      ? template.positiveEffect
      : decision.majoritySide === -1
        ? template.negativeEffect
        : undefined; // tie (majoritySide 0) — no clear majority, no ruling effect applied

  const now = new Date();
  let enactedLawId: ObjectId | undefined;
  if (chosenEffect) {
    const provision: PolicyProvision = {
      type: "policy",
      legislationTypeId: chosenEffect.legislationTypeId,
      policyOptionId: chosenEffect.policyOptionId,
      effectDirection: chosenEffect.effectDirection,
      economic: chosenEffect.economic,
      social: chosenEffect.social,
    };
    const syntheticBillId = new ObjectId();
    await onBillEnacted(
      database,
      {
        _id: syntheticBillId,
        title: `${template.title} (Surprise SCOTUS Ruling)`,
        legislationTypeId: chosenEffect.legislationTypeId,
        effectDirection: chosenEffect.effectDirection,
        provisions: [provision],
        countryId: "US",
        stateId: chosenEffect.stateId ?? "federal",
        source: "scotus_surprise_ruling",
      },
      currentTurn
    );

    const enactedLawRow = await database
      .collection("enactedLaws")
      .findOne({ billId: syntheticBillId }, { projection: { _id: 1 }, sort: { enactedAt: -1 } });
    enactedLawId = enactedLawRow?._id as ObjectId | undefined;
  }

  await database.collection<DocketCase>("docketCases").insertOne({
    _id: new ObjectId(),
    countryId: "US",
    preset,
    caseKey: template.templateKey,
    title: template.title,
    axis: template.axis,
    decisionYear,
    effect: chosenEffect,
    status: "decided",
    outcome: "diverged", // #3607: surprise cases have no affirm state — every spawn is a ruling
    decidedAtTurn: currentTurn,
    decidedAt: now,
    decisionSeatedFor: decision.positiveCount,
    decisionSeatedAgainst: decision.negativeCount,
    ...(enactedLawId && { enactedLawId }),
    isSurprise: true,
    createdAt: now,
    updatedAt: now,
  });

  // Full news/wire post — see scotusNews.ts doc comment (this turn posted
  // nothing before that module existed).
  await generateScotusSurpriseNews(template, decision).catch((err) =>
    console.error(`[scotusSurpriseCaseTurn] news post failed for ${template.templateKey}:`, err)
  );

  return { spawned: true, caseKey: template.templateKey, majoritySide: decision.majoritySide };
}
