import type { Db } from "mongodb";
import {
  getCountryConfig,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import type { AuthUserWithCharacter } from "@/lib/auth";
import {
  checkDuplicateProvisions,
  checkCurrentPolicyLevel,
  STATE_TERMINAL_STATUSES,
} from "@/lib/congress/billProposalLimits";
import type {
  Character,
  ElectedOfficial,
  PoliticalParty,
  StateBill,
  StateBillProvision,
} from "@/lib/db/types";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import {
  BILL_PROPOSE_ACTION_COST,
  countProvisionsChargedNationalInfluence,
  getProvisionCostTotal,
  SUBSIDY_BILL_CATEGORIES,
} from "@shared/constants/legislation";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import type { LegislatureCommandResult } from "@/lib/legislature/commands/types";
import { getGameState } from "@/lib/gameState";
import { getEraContext } from "@/lib/era/context";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { stampTaxSliderProvisions } from "@/lib/politicalLegislation/taxSlider";
import { snapshotPolicyProvisionsInPlace } from "@/lib/legislature/provisionEnrichment";

const VOTING_DURATION_HOURS = 24;

export interface ProposeStateBillInput {
  title: string;
  summary: string;
  category?: string;
  legislationTypeId?: string;
  effectDirection?: number;
  provisions?: unknown[];
  adminOverride?: boolean;
}

export async function proposeStateBill(
  db: Db,
  countryId: CountryId,
  stateId: string,
  user: AuthUserWithCharacter,
  input: ProposeStateBillInput
): Promise<LegislatureCommandResult> {
  stateId = stateId.toUpperCase();
  const now = new Date();
  const postCountryConfig = getCountryConfig(countryId);
  const {
    title,
    summary,
    category,
    legislationTypeId,
    effectDirection,
    provisions,
    adminOverride,
  } = input;

  const character = user.character;
  if (!character) {
    return { status: 400, body: { error: "No character found" } };
  }

  // Custom (flavor/roleplay) bills carry no provisions and have no mechanical
  // effect. Drop any client-supplied provisions so they cannot smuggle effects.
  const effectiveProvisions = category === "custom" ? [] : provisions;

  // One-party-state guard: banned parties cannot propose bills.
  // Reads runtime governmentType so post-Stage-4 conversion immediately
  // lifts the banned-party restriction.
  const runtimeState = await getCountryState(db, countryId);
  if (runtimeState.governmentType === "onePartyState" && character.party) {
    const sponsorParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parseInt(character.party, 10), countryId });
    if (isBannedParty(postCountryConfig, sponsorParty)) {
      return {
        status: 403,
        body: { error: "Banned parties cannot propose legislation." },
      };
    }
  }

  if (!adminOverride || !user.isAdmin) {
    const existingActiveBill = await db.collection<StateBill>("stateBills").findOne({
      sponsorId: character._id,
      stateId,
      status: { $nin: STATE_TERMINAL_STATUSES },
    });
    if (existingActiveBill) {
      return {
        status: 403,
        body: {
          error:
            "You already have a bill in progress in this legislature. Wait for it to resolve before proposing another.",
        },
      };
    }
  }

  if (adminOverride) {
    if (!user.isAdmin) {
      return { status: 403, body: { error: "Admin access required" } };
    }
  } else {
    const subNationalOffice = getSubNationalLegislatureKey(countryId);
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: subNationalOffice,
      state: stateId,
      characterId: character._id,
      countryId,
    });
    if (!official) {
      return {
        status: 403,
        body: {
          error: `You must hold ${postCountryConfig.subNationalChamber?.name ?? "State Senate"} seats in this region to propose bills`,
        },
      };
    }
  }

  const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_HOURS * 3_600_000);
  const gameStateForTurn = await getGameState(db);
  const votingEndsOnTurn = (gameStateForTurn?.currentTurn ?? 0) + VOTING_DURATION_HOURS;
  const sanitizedProvisions: StateBillProvision[] | undefined = Array.isArray(effectiveProvisions)
    ? effectiveProvisions.map((provision) => {
        if (
          typeof provision === "object" &&
          provision != null &&
          "type" in provision &&
          provision.type === "subsidy"
        ) {
          const subsidy = provision as unknown as {
            scopeType: "economy_wide" | "sector";
            targetSectorType?: string;
            targetStrategyId?: string;
            domesticOnly: boolean;
          };
          return {
            type: "subsidy" as const,
            scopeType: subsidy.scopeType,
            ...(subsidy.targetSectorType
              ? { targetSectorType: subsidy.targetSectorType as CorporationType }
              : {}),
            ...(subsidy.targetStrategyId ? { targetStrategyId: subsidy.targetStrategyId } : {}),
            domesticOnly: subsidy.domesticOnly,
          };
        }
        if (
          typeof provision === "object" &&
          provision != null &&
          "type" in provision &&
          provision.type === "end_subsidy"
        ) {
          const endSubsidy = provision as unknown as {
            scopeType: "economy_wide" | "sector";
            targetSectorType?: string;
            targetStrategyId?: string;
          };
          return {
            type: "end_subsidy" as const,
            scopeType: endSubsidy.scopeType,
            ...(endSubsidy.targetSectorType
              ? { targetSectorType: endSubsidy.targetSectorType as CorporationType }
              : {}),
            ...(endSubsidy.targetStrategyId
              ? { targetStrategyId: endSubsidy.targetStrategyId }
              : {}),
          };
        }

        const policyProvision = provision as {
          legislationTypeId?: string;
          policyOptionId?: string;
          effectDirection?: number;
          economic?: number;
          social?: number;
          proposedRate?: number;
        };
        const policyOptionId =
          typeof policyProvision.policyOptionId === "string" &&
          policyProvision.policyOptionId.trim()
            ? policyProvision.policyOptionId.trim()
            : undefined;
        const proposedRate =
          typeof policyProvision.proposedRate === "number" &&
          Number.isFinite(policyProvision.proposedRate)
            ? policyProvision.proposedRate
            : undefined;
        return {
          legislationTypeId: String(policyProvision.legislationTypeId ?? "").trim(),
          ...(policyOptionId ? { policyOptionId } : {}),
          effectDirection: Math.max(
            -1,
            Math.min(1, Math.round(Number(policyProvision.effectDirection) || 0))
          ),
          ...(policyProvision.economic != null
            ? {
                economic: Math.max(-3, Math.min(3, Math.round(Number(policyProvision.economic)))),
              }
            : {}),
          ...(policyProvision.social != null
            ? {
                social: Math.max(-3, Math.min(3, Math.round(Number(policyProvision.social)))),
              }
            : {}),
          ...(proposedRate !== undefined ? { proposedRate } : {}),
        };
      })
    : undefined;

  if (sanitizedProvisions && sanitizedProvisions.length > 0) {
    const stamped = await stampTaxSliderProvisions(db, sanitizedProvisions, countryId, stateId);
    if (!stamped.ok) {
      return { status: 400, body: { error: stamped.error } };
    }
    sanitizedProvisions.length = 0;
    sanitizedProvisions.push(...stamped.provisions);
  }

  const policyProvisionsForCheck = (sanitizedProvisions ?? [])
    .filter(
      (
        provision
      ): provision is {
        legislationTypeId: string;
        policyOptionId?: string;
        effectDirection: number;
      } =>
        !("type" in provision) || (provision.type !== "subsidy" && provision.type !== "end_subsidy")
    )
    .filter((provision) => provision.legislationTypeId);

  // Era gate: a state bill cannot legislate a type before its historical window.
  // Null year (flag off / legacy) ⇒ every type active, byte-identical.
  const { year: eraYear } = await getEraContext(db);
  for (const provision of policyProvisionsForCheck) {
    if (!isLegislationTypeActive(provision.legislationTypeId, eraYear)) {
      return {
        status: 400,
        body: { error: "This legislation is not available in this era." },
      };
    }
  }

  const subsidyProvisionCount = (sanitizedProvisions ?? []).filter(
    (provision) =>
      "type" in provision && (provision.type === "subsidy" || provision.type === "end_subsidy")
  ).length;

  for (const provision of sanitizedProvisions ?? []) {
    if (
      "type" in provision &&
      (provision.type === "subsidy" || provision.type === "end_subsidy") &&
      provision.scopeType === "sector" &&
      !provision.targetSectorType
    ) {
      return {
        status: 400,
        body: { error: "Sector-scoped subsidy provisions must specify a target sector type." },
      };
    }
    if (
      "type" in provision &&
      provision.type === "subsidy" &&
      provision.targetSectorType &&
      !CORPORATION_TYPES.includes(provision.targetSectorType as CorporationType)
    ) {
      return {
        status: 400,
        body: { error: `Invalid sector: ${provision.targetSectorType}.` },
      };
    }
  }

  if (
    subsidyProvisionCount > 0 &&
    !SUBSIDY_BILL_CATEGORIES.has(category as Parameters<typeof SUBSIDY_BILL_CATEGORIES.has>[0])
  ) {
    return {
      status: 400,
      body: { error: "Subsidy provisions can only be included in industry bills." },
    };
  }

  if (category === "industry" && subsidyProvisionCount === 0) {
    return {
      status: 400,
      body: { error: "Industry bills must contain at least one subsidy provision." },
    };
  }

  const duplicateCheck = await checkDuplicateProvisions(
    db,
    "stateBills",
    { stateId, status: { $nin: STATE_TERMINAL_STATUSES } },
    policyProvisionsForCheck
  );
  if (duplicateCheck) {
    return { status: 409, body: { error: duplicateCheck.error } };
  }

  const currentLevelCheck = await checkCurrentPolicyLevel(db, stateId, policyProvisionsForCheck);
  if (currentLevelCheck) {
    return { status: 409, body: { error: currentLevelCheck.error } };
  }

  const influenceProvisionCount = countProvisionsChargedNationalInfluence({
    policyProvisionCount: policyProvisionsForCheck.length,
    subsidyProvisionCount,
  });
  const npiCost = getProvisionCostTotal(influenceProvisionCount);
  const actionCost = BILL_PROPOSE_ACTION_COST;
  const currentNational = character.nationalInfluence ?? 0;
  if (!(adminOverride && user.isAdmin)) {
    const currentActions = character.actions ?? 0;
    if (currentActions < actionCost) {
      return {
        status: 400,
        body: {
          error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
        },
      };
    }
    if (npiCost > 0 && currentNational < npiCost) {
      return {
        status: 400,
        body: {
          error: `This bill costs ${npiCost} national political influence (you have ${currentNational.toFixed(0)}).`,
        },
      };
    }
    const spendResult = await db.collection<Character>("characters").updateOne(
      {
        _id: character._id,
        actions: { $gte: actionCost },
        ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
      },
      {
        $set: {
          ...(npiCost > 0 ? { nationalInfluence: Math.max(0, currentNational - npiCost) } : {}),
          updatedAt: now,
        },
        $inc: { actions: -actionCost },
      }
    );
    if (spendResult.modifiedCount === 0) {
      return {
        status: 409,
        body: { error: "Your actions or national influence changed. Please try again." },
      };
    }
  }

  // Freeze the proposed and current option labels. Without this the bill detail
  // page re-reads the live law on every render, so once the bill enacts the
  // current-law box shows the bill's own outcome and the bill looks like it
  // re-passed the law already in force.
  //
  // Deliberately placed after every validation gate, so a proposal that is about
  // to be rejected does not pay for the catalog and policy lookups. It must
  // still run AFTER stampTaxSliderProvisions: a slider provision carries a
  // synthetic "rate:" option id that resolves to no seeded option, so the
  // snapshot pass leaves its already-stamped labels alone.
  if (sanitizedProvisions && sanitizedProvisions.length > 0) {
    await snapshotPolicyProvisionsInPlace(db, sanitizedProvisions, {
      scope: "region",
      countryId,
      regionId: stateId,
    });
  }

  const bill: Omit<StateBill, "_id"> = {
    stateId,
    countryId,
    title: title.trim(),
    summary: summary.trim(),
    ...(category ? { category } : {}),
    sponsorId: character._id,
    sponsorName: character.name,
    sponsorParty: character.party,
    ...(adminOverride && user.isAdmin ? { adminProposed: true } : {}),
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    legislationTypeId,
    effectDirection,
    provisions: sanitizedProvisions,
    ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
    ...(!(adminOverride && user.isAdmin) ? { proposalActionCost: actionCost } : {}),
    proposedAt: now,
    votingStartedAt: now,
    votingEndsAt,
    votingEndsOnTurn,
    createdAt: now,
    updatedAt: now,
  };

  let result;
  try {
    result = await db.collection<StateBill>("stateBills").insertOne(bill as StateBill);
  } catch (error) {
    if (!(adminOverride && user.isAdmin)) {
      await db.collection<Character>("characters").updateOne(
        { _id: character._id },
        {
          $inc: { actions: actionCost },
          $set: {
            ...(npiCost > 0 ? { nationalInfluence: currentNational } : {}),
            updatedAt: new Date(),
          },
        }
      );
    }
    throw error;
  }

  let budget: {
    totalBudget: number;
    enactedBillCosts: number;
    surplus: number;
    isOverBudget: boolean;
    turnsOverBudget: number;
  } | null = null;
  if (postCountryConfig.subNationalChamber?.regionalModel) {
    const budgetDoc = await db
      .collection<RegionalBudget>("regionalBudgets")
      .findOne({ _id: stateId });
    if (budgetDoc) {
      budget = {
        totalBudget: budgetDoc.totalBudget,
        enactedBillCosts: budgetDoc.enactedBillCosts,
        surplus: budgetDoc.surplus,
        isOverBudget: budgetDoc.isOverBudget,
        turnsOverBudget: budgetDoc.turnsOverBudget,
      };
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      billId: result.insertedId.toString(),
      budget,
    },
  };
}
