import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Crisis, CrisisDecisionOption, CrisisInteraction } from "@/lib/db/types/crisis";
import type {
  Bill,
  BillChamber,
  BargainingCampaign,
  Character,
  CollectiveAgreement,
  Corporation,
  CorporateSector,
  Union,
} from "@/lib/db/types";
import type { NationalizeProvision } from "@/lib/db/types/legislation";
import type { DocketCase } from "@/lib/db/types/scotus";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getGameState } from "@/lib/gameState";
import { nationalizeSector } from "@/lib/nationalization/ownershipTransition";
import { resolveCorpEligibilityBatch } from "@/lib/nationalization/targetEligibility";
import { persistBargainingMediationAction } from "@/lib/unions/commands/bargaining";
import { getBargainingMediationAvailability } from "@/lib/unions/bargaining";
import { clampWageLevel, WAGE_LEVEL_MAX } from "@/lib/labour/laborCost";
import { logWireEvent } from "@/lib/wireEvent";
import { ALL_CRISIS_TEMPLATES } from "@/lib/crises/templates";
import { createCrisisFromTemplate } from "@/lib/crises/createCrisisFromTemplate";
import { WARSAW_PACT_SATELLITE_COUNTRY_IDS } from "@/lib/crises/warsawPactSatellites";

/**
 * Context handed to every crisis option-action handler. The crisis is
 * country-scoped for action-bearing crises (the steel strike and its kin), so
 * `countryId` is the single affected nation and `characterId` is the head of
 * government who made the choice.
 */
export interface CrisisActionContext {
  db: Db;
  crisis: Crisis;
  interaction: CrisisInteraction;
  option: CrisisDecisionOption;
  characterId: ObjectId;
  countryId: string;
  /** The turn the decision was submitted on (for lifecycle/deadline math). */
  currentTurn: number;
}

/** Human-readable sector label (steel is produced by the "manufacturing" sector). */
function sectorLabelFor(sectorType: string): string {
  return CORPORATION_TYPE_LABELS[sectorType as CorporationType] ?? sectorType;
}

// ── 1. Executive taking ────────────────────────────────────────────────────

/**
 * Emergency EXECUTIVE taking of the struck sector, driven by the head of
 * government. Mirrors the executive-nationalize route
 * (`src/app/api/country/[code]/nationalize/route.ts`): reach is limited to
 * NPC/unowned and *distressed* player corps (`executivelyTakeable`) at the
 * `method: "executive"` path, solvent player corps are deliberately skipped
 * (they need the legislative bill / court fight). Each in-scope sector of the
 * type is absorbed via `nationalizeSector`, which owns compensation + transfer.
 *
 * After a successful taking the case is referred straight to the Supreme Court
 * so the seizure is automatically contestable, with no second player action.
 */
async function executiveNationalize(ctx: CrisisActionContext, sectorType: string): Promise<void> {
  const { db } = ctx;
  const country = ctx.countryId as CountryId;
  const label = sectorLabelFor(sectorType);

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ countryId: ctx.countryId as CountryId, sectorType: sectorType as CorporationType })
    .toArray();
  if (sectors.length === 0) {
    console.warn(`[crisis] executiveNationalize: no ${sectorType} sectors in ${ctx.countryId}`);
    return;
  }

  // One eligibility snapshot for every distinct owner (shared with the route).
  const corpIdByKey = new Map<string, ObjectId>();
  for (const s of sectors) corpIdByKey.set(String(s.corporationId), s.corporationId);
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: [...corpIdByKey.values()] } })
    .toArray();
  const eligibility = await resolveCorpEligibilityBatch(db, country, corps, ctx.currentTurn);

  // Bound the work: an emergency taking should not fan across an unbounded set.
  const EXEC_TAKING_CAP = 50;
  let taken = 0;
  // Surviving NatCorp sector rows this taking produced, the reversal handles a
  // SCOTUS strike-down uses to return them to their prior owners.
  const takenSectorIds: ObjectId[] = [];
  for (const sector of sectors) {
    if (taken >= EXEC_TAKING_CAP) break;
    const resolved = eligibility.get(String(sector.corporationId));
    // Executive reach: NPC/unowned or distressed player corps only. Solvent
    // player corps are rejected here exactly as the route rejects them.
    if (!resolved || !resolved.executivelyTakeable || !resolved.result.eligible) continue;
    try {
      const result = await nationalizeSector(db, {
        countryId: country,
        sectorId: sector._id,
        // Executive path is discounted/seizure only (fair-value is legislative).
        tier: "discounted",
        consequence: {
          method: "executive",
          triggers: resolved.result.triggers,
          turn: ctx.currentTurn,
          actorCharacterId: ctx.characterId,
          governingPartyId: null,
        },
      });
      takenSectorIds.push(result.resultingSectorId);
      taken++;
    } catch (err) {
      console.error(`[crisis] executive taking of sector ${sector._id.toString()} failed:`, err);
    }
  }

  if (taken === 0) {
    console.warn(
      `[crisis] executiveNationalize: no eligible ${sectorType} targets in ${ctx.countryId}`
    );
    return;
  }

  await logWireEvent(
    "corporation_nationalized",
    `EMERGENCY: ${ctx.countryId} seizes ${taken} distressed ${label} operation${taken === 1 ? "" : "s"} by executive order`
  );

  // An executive taking goes to the Court automatically, only if it moved
  // something (guarded by taken > 0 above).
  await spawnNationalizationChallenge(ctx, {
    axis: "economic",
    revertLabel: `Challenge to the ${label} Emergency Taking`,
    reversalSectorIds: takenSectorIds,
  });
}

// ── 2. SCOTUS challenge ────────────────────────────────────────────────────

/**
 * Spawn a Supreme Court Docket case reviewing the most recent executive taking.
 * Reusable standalone (the `scotusChallenge` option) and auto-fired at the end
 * of an executive taking.
 *
 * `historicalMajorityDirection` is set to -1: a divergence fires when the
 * sitting bench's majority side on `axis` differs from it (see
 * `decideCaseOutcome` in `src/lib/scotus/divergence.ts`), so a pro-market bench
 * (positive economic-lean majority) DIVERGES and strikes the taking down, while
 * a pro-worker/left bench affirms it. The case is inserted `status: "pending"`
 * into `docketCases` (the collection `scotusDocketTurn` reads) and decided when
 * its `decisionYear` turn is reached.
 */
async function spawnNationalizationChallenge(
  ctx: CrisisActionContext,
  opts: {
    axis: "economic" | "social";
    revertLabel: string;
    /**
     * Surviving NatCorp sector rows an executive taking produced. When present,
     * the case carries a `nationalizationReversal` payload and a divergence
     * RETURNS those sectors to private hands, the real reversal, instead of the
     * benign stand-in `effect`. Omitted by the standalone `scotusChallenge`
     * option, which has no specific taken sectors and keeps the generic effect.
     */
    reversalSectorIds?: ObjectId[];
  }
): Promise<void> {
  const { db } = ctx;
  // SCOTUS is US-only (spec #3581). A challenge in any other country has no
  // bench to hear it.
  if (ctx.countryId !== "US") {
    console.warn(
      `[crisis] scotusChallenge skipped: SCOTUS docket is US-only (country ${ctx.countryId}).`
    );
    return;
  }

  const gameState = await getGameState(db);
  const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  const startingYear = gameState?.startingYear ?? getStartingYearForPreset(preset);

  // `scotusDocketTurn` fires a pending case when `currentTurn >=
  // yearToTurn(decisionYear)`, and `yearToTurn(y) = (y - startingYear) *
  // TURNS_PER_YEAR + 1`. Invert that so the case lands on/just after a target a
  // few turns out (annual granularity means it can be up to a year out).
  const CHALLENGE_DELAY_TURNS = 4;
  const targetTurn = ctx.currentTurn + CHALLENGE_DELAY_TURNS;
  const decisionYear = startingYear + Math.max(0, Math.ceil((targetTurn - 1) / TURNS_PER_YEAR));

  const now = new Date();
  // A taking with specific seized sectors carries a real reversal payload: a
  // divergence RETURNS those sectors to private hands (scotusDocketTurn), not a
  // PolicyProvision stand-in. The standalone challenge (no taken sectors) keeps a
  // benign deregulatory `effect` so a divergence still has a safe, enactable
  // consequence.
  const reversalSectorIds = opts.reversalSectorIds ?? [];
  const hasReversal = reversalSectorIds.length > 0;
  const docketCase: DocketCase = {
    _id: new ObjectId(),
    countryId: "US",
    preset,
    caseKey: `crisis-nationalization-challenge-${ctx.crisis._id.toString()}-${ctx.currentTurn}`,
    title: opts.revertLabel || "Challenge to Emergency Nationalization",
    axis: opts.axis,
    historicalMajorityDirection: -1,
    decisionYear,
    ...(hasReversal
      ? {
          nationalizationReversal: {
            sectorIds: reversalSectorIds,
            countryId: "US",
            label: opts.revertLabel || "Emergency Taking",
          },
        }
      : {
          // No specific taken sectors: keep a benign deregulatory ruling so a
          // divergence still has a real, safe, enactable consequence.
          effect: {
            legislationTypeId: "us_minimum_wage",
            policyOptionId: "minimum_wage_opt_5",
            effectDirection: -1 as const,
          },
        }),
    historicalSummary: "The Court upholds the government's emergency taking of the sector.",
    alternateSummary: "The Court strikes down the emergency taking as an unlawful expropriation.",
    status: "pending",
    // Procedurally spawned rather than curated historical content.
    isSurprise: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<DocketCase>("docketCases").insertOne(docketCase);
}

// ── 3. Emergency nationalization bill ──────────────────────────────────────

/**
 * Introduce an emergency industry-wide nationalization bill straight into
 * active voting. Mirrors the crisis-aid fast path
 * (`src/lib/legislature/commands/proposeCrisisAidBill.ts`), direct-to-active
 * status, 24h voting window, no NPI/action cost, sponsor = the head of
 * government, but carries a `NationalizeProvision` (industry-wide: a
 * `targetSectorType` + `sectorScope` + `sectorCarveFraction`) rather than a
 * bare appropriation. On passage, normal bill enactment routes the provision
 * through `applyNationalizeProvision` → `nationalizeSectorWide`.
 */
async function emergencyNationalizeBill(
  ctx: CrisisActionContext,
  sectorType: string,
  sectorCarveFraction?: number
): Promise<void> {
  const { db } = ctx;
  const country = ctx.countryId as CountryId;
  const config = COUNTRY_CONFIGS[country];
  if (!config) {
    console.warn(`[crisis] emergencyNationalizeBill: unknown country ${ctx.countryId}`);
    return;
  }
  const label = sectorLabelFor(sectorType);
  const chamberKey = config.legislature.lowerChamber.key as BillChamber;
  const stateId = getNationalDocId(country) ?? `${country.toLowerCase()}_national`;
  const now = new Date();
  const VOTING_DURATION_HOURS = 24;

  const sponsor = await db
    .collection<Character>("characters")
    .findOne({ _id: ctx.characterId }, { projection: { name: 1 } });

  const provision: NationalizeProvision = {
    type: "nationalize",
    targetSectorType: sectorType as CorporationType,
    sectorScope: "all",
    sectorCarveFraction: sectorCarveFraction ?? 1,
  };

  const bill: Omit<Bill, "_id"> = {
    countryId: country,
    stateId,
    title: `Emergency Nationalization: ${label}`,
    summary: `Emergency industry-wide nationalization of the ${label} sector in response to the ongoing crisis.`,
    originChamber: chamberKey,
    currentChamber: chamberKey,
    sponsorId: ctx.characterId,
    sponsorName: sponsor?.name ?? "Head of Government",
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "economy",
    provisions: [provision],
    proposedAt: now,
    proposedTurn: ctx.currentTurn,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + VOTING_DURATION_HOURS * 60 * 60 * 1000),
    votingEndsOnTurn: ctx.currentTurn + VOTING_DURATION_HOURS,
    // Executive emergency measure, no proposal cost, matching the aid fast path.
    proposalNpiCost: 0,
    proposalActionCost: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
  await logWireEvent(
    "crisis_outcome",
    `EMERGENCY BILL: ${ctx.countryId} moves to nationalize the ${label} industry`
  );
}

// ── 3b. Concession / legislation bill ──────────────────────────────────────

/**
 * Introduce a plain concession or legislative-response bill straight into
 * active voting. Same fast path as {@link emergencyNationalizeBill} (24h
 * window, no NPI/action cost, head of government as sponsor) but carries no
 * provisions, it exists to give a "concede/legislate" crisis option a real,
 * contestable vote in Congress instead of a flat approval nudge with nothing
 * behind it. Used by the 1960s civil rights, urban unrest, and anti-war
 * protest crises for their legislative-response options.
 */
async function concessionBill(
  ctx: CrisisActionContext,
  title: string,
  summary: string,
  category: string
): Promise<void> {
  const { db } = ctx;
  const country = ctx.countryId as CountryId;
  const config = COUNTRY_CONFIGS[country];
  if (!config) {
    console.warn(`[crisis] concessionBill: unknown country ${ctx.countryId}`);
    return;
  }
  const chamberKey = config.legislature.lowerChamber.key as BillChamber;
  const stateId = getNationalDocId(country) ?? `${country.toLowerCase()}_national`;
  const now = new Date();
  const VOTING_DURATION_HOURS = 24;

  const sponsor = await db
    .collection<Character>("characters")
    .findOne({ _id: ctx.characterId }, { projection: { name: 1 } });

  const bill: Omit<Bill, "_id"> = {
    countryId: country,
    stateId,
    title,
    summary,
    originChamber: chamberKey,
    currentChamber: chamberKey,
    sponsorId: ctx.characterId,
    sponsorName: sponsor?.name ?? "Head of Government",
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category,
    provisions: [],
    proposedAt: now,
    proposedTurn: ctx.currentTurn,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + VOTING_DURATION_HOURS * 60 * 60 * 1000),
    votingEndsOnTurn: ctx.currentTurn + VOTING_DURATION_HOURS,
    // Executive emergency measure, no proposal cost, matching the aid fast path.
    proposalNpiCost: 0,
    proposalActionCost: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
  await logWireEvent("crisis_outcome", `BILL INTRODUCED: ${ctx.countryId} moves on "${title}"`);
}

// ── 4. Government-brokered bargaining ──────────────────────────────────────

/**
 * Open government-brokered conciliation for the struck sector. Finds the
 * union(s) for (countryId, sectorType) and, if one of their bargaining
 * campaigns is in an eligible `dispute`, requests mediation via
 * `persistBargainingMediationAction` (the same primitive the union/employer
 * surfaces use). Mediation carries hard preconditions (an active dispute, a
 * wage package from BOTH parties, sufficient collective-bargaining law support,
 * a timing gate, see `getBargainingMediationAvailability`); when none is met
 * there is nothing to broker, so this logs and returns rather than fabricating
 * a synthetic dispute.
 */
async function openBargaining(ctx: CrisisActionContext, sectorType: string): Promise<void> {
  const { db } = ctx;
  const label = sectorLabelFor(sectorType);

  const unions = await db
    .collection<Union>("unions")
    .find({ countryId: ctx.countryId as CountryId, sectorType: sectorType as CorporationType })
    .toArray();
  if (unions.length === 0) {
    console.warn(`[crisis] openBargaining: no union for ${sectorType} in ${ctx.countryId}`);
    return;
  }

  const campaign = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .findOne({ unionId: { $in: unions.map((u) => u._id) }, status: "dispute" });
  if (!campaign) {
    console.warn(
      `[crisis] openBargaining: no active dispute to mediate for ${sectorType} in ${ctx.countryId}`
    );
    return;
  }

  const availability = getBargainingMediationAvailability(campaign, ctx.currentTurn);
  if (!availability.available) {
    console.warn(
      `[crisis] openBargaining: mediation unavailable (${availability.reason}) for campaign ${campaign._id.toString()}`
    );
    return;
  }

  const result = await persistBargainingMediationAction(
    db,
    campaign,
    "union",
    "request_mediation",
    ctx.currentTurn
  );
  if (!result.ok) {
    console.warn(`[crisis] openBargaining: mediation request rejected: ${result.error}`);
    return;
  }

  await logWireEvent(
    "crisis_outcome",
    `MEDIATION: ${ctx.countryId} government opens conciliation in the ${label} dispute`
  );
}

// ── 5. Wage-floor settlement ───────────────────────────────────────────────

/**
 * End the strike by conceding a wage floor across the sector. Writes a
 * `CollectiveAgreement` (the enforceable settlement doc the corporation turn
 * reads via `loadCollectiveAgreementEffects`) over every corporate sector of
 * the type: a raised `wageLevel` closes the worker-expectation gap driving the
 * strike, and `noStrikeUntilTurn` protects the sector from union-called strikes
 * for the term. The loader keys on `sectorIds`/`wageLevel`/`noStrikeUntilTurn`,
 * so one agreement spanning all locals is sufficient.
 */
async function settleWageFloor(ctx: CrisisActionContext, sectorType: string): Promise<void> {
  const { db } = ctx;
  const country = ctx.countryId as CountryId;
  const label = sectorLabelFor(sectorType);

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { countryId: ctx.countryId as CountryId, sectorType: sectorType as CorporationType },
      { projection: { _id: 1, corporationId: 1 } }
    )
    .toArray();
  if (sectors.length === 0) {
    console.warn(`[crisis] settleWageFloor: no ${sectorType} sectors in ${ctx.countryId}`);
    return;
  }

  const union = await db
    .collection<Union>("unions")
    .findOne({ countryId: ctx.countryId as CountryId, sectorType: sectorType as CorporationType });
  const now = new Date();
  const SETTLEMENT_TERM_TURNS = 48;

  const agreement: CollectiveAgreement = {
    _id: new ObjectId(),
    // Sector-wide crisis settlement: no single campaign/employer, but the turn
    // loader reads only sectorIds/wageLevel/noStrikeUntilTurn.
    campaignId: new ObjectId(),
    unionId: union?._id ?? new ObjectId(),
    countryId: country,
    sectorType: sectorType as CorporationType,
    employerCorporationId: sectors[0].corporationId ?? new ObjectId(),
    sectorIds: sectors.map((s) => s._id),
    wageLevel: clampWageLevel(WAGE_LEVEL_MAX),
    startsAtTurn: ctx.currentTurn,
    expiresAtTurn: ctx.currentTurn + SETTLEMENT_TERM_TURNS,
    noStrikeUntilTurn: ctx.currentTurn + SETTLEMENT_TERM_TURNS,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<CollectiveAgreement>("collectiveAgreements").insertOne(agreement);
  await logWireEvent(
    "crisis_outcome",
    `SETTLEMENT: ${ctx.countryId} concedes a ${label} wage floor, ending the strike`
  );
}

// ── 6. Follow-up crisis cascade ────────────────────────────────────────────

/**
 * Roll `chance` and, on success, spawn another crisis from a template in a
 * country drawn from the requested pool. Used for cascades (tolerating a
 * reform movement lets unrest spread to a neighboring satellite) and delayed
 * backlash (genuine reform provokes a hardliner crisis at home). Starts on
 * the current turn, the new crisis's own duration/effects handle its pacing,
 * so there is no separate delay here.
 */
async function spawnFollowUpCrisis(
  ctx: CrisisActionContext,
  action: Extract<CrisisDecisionOption["action"], { kind: "spawnFollowUpCrisis" }>
): Promise<void> {
  const { db } = ctx;
  if (Math.random() >= action.chance) return;

  const template = ALL_CRISIS_TEMPLATES[action.templateKey];
  if (!template) {
    console.warn(`[crisis] spawnFollowUpCrisis: unknown template ${action.templateKey}`);
    return;
  }

  let targetCountryId: string;
  if (action.countryPool === "sameCountry") {
    targetCountryId = ctx.countryId;
  } else {
    const pool = WARSAW_PACT_SATELLITE_COUNTRY_IDS.filter(
      (id) => !action.excludeCurrentCountry || id !== ctx.countryId
    );
    if (pool.length === 0) return;
    targetCountryId = pool[Math.floor(Math.random() * pool.length)];
  }

  await createCrisisFromTemplate(db, {
    template,
    scope: "country",
    countryIds: [targetCountryId],
    regionIds: [],
    currentTurn: ctx.currentTurn,
    autoGenerated: true,
    autoSource: "condition",
  });

  await logWireEvent(
    "crisis_outcome",
    `SPREADING UNREST: reports of a follow-on crisis reach ${targetCountryId}`
  );
}

/**
 * Dispatch a crisis decision option's real-subsystem action, if it has one.
 * Called by `submitCrisisDecision` after the option's flat effects apply and
 * before the decision tree navigates. A no-op when the option carries no
 * `action`. Handlers are best-effort: a throw is logged and swallowed so a
 * subsystem hiccup never wedges the crisis interaction mid-resolution.
 */
export async function runCrisisOptionAction(ctx: CrisisActionContext): Promise<void> {
  const action = ctx.option.action;
  if (!action) return;
  try {
    switch (action.kind) {
      case "executiveNationalize":
        await executiveNationalize(ctx, action.sectorType);
        break;
      case "scotusChallenge":
        await spawnNationalizationChallenge(ctx, {
          axis: action.axis,
          revertLabel: action.revertLabel,
        });
        break;
      case "emergencyNationalizeBill":
        await emergencyNationalizeBill(ctx, action.sectorType, action.sectorCarveFraction);
        break;
      case "openBargaining":
        await openBargaining(ctx, action.sectorType);
        break;
      case "settleWageFloor":
        await settleWageFloor(ctx, action.sectorType);
        break;
      case "spawnFollowUpCrisis":
        await spawnFollowUpCrisis(ctx, action);
        break;
      case "concessionBill":
        await concessionBill(ctx, action.title, action.summary, action.category);
        break;
    }
  } catch (err) {
    console.error(
      `[crisis] option action ${action.kind} failed for crisis ${ctx.crisis._id.toString()}:`,
      err
    );
  }
}
