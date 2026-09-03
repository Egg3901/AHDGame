import { getNationalDocId } from "@/lib/constants/nationalScope";
import type { Db } from "mongodb";
import type { AuthUser } from "@/lib/auth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import {
  checkDuplicateProvisions,
  checkDuplicateTariffProvisions,
  checkCurrentPolicyLevel,
  NATIONAL_TERMINAL_STATUSES,
} from "@/lib/congress/billProposalLimits";
import { snapshotBillPolicyProvisions, validateBillProvisions } from "@/lib/congress/billProposal";
import {
  getBillProposalAutoFailWarning,
  getBillProposalAutoFailWarningError,
  type BillProposalOriginChamber,
} from "@/lib/legislature/billAutoFailWarning";
import { buildActiveNationalBillFilter } from "@/lib/legislature/nationalBillScope";
import type {
  Bill,
  BillChamber,
  BillStatus,
  Character,
  ElectedOfficial,
  PoliticalParty,
} from "@/lib/db/types";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import {
  BILL_PROPOSE_ACTION_COST,
  countProvisionsChargedNationalInfluence,
  getProvisionCostTotal,
  NATIONALIZATION_BILL_CATEGORIES,
  type BillCategory,
} from "@shared/constants/legislation";
import { validateNationalizationProvisions } from "@/lib/nationalization/billProvisionValidation";
import type { LegislatureCommandResult } from "@/lib/legislature/commands/types";
import { getGameState } from "@/lib/gameState";
import {
  getChamberKeyForOfficeType,
  getOfficeTypeForChamber,
} from "@/lib/legislature/chamberOfficeType";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";

const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

export interface ProposeNationalBillInput {
  title: string;
  summary: string;
  chamber: string;
  category: string;
  fullText?: string;
  provisions: unknown[];
  confirmElectionRisk?: boolean;
}

export async function proposeNationalBill(
  db: Db,
  countryId: CountryId,
  authUser: AuthUser,
  input: ProposeNationalBillInput
): Promise<LegislatureCommandResult> {
  // A bill minted for a country no turn phase walks never advances, enacts,
  // vetoes or fails — it just sits on the floor forever with nothing to close
  // it and nothing that reports it (#806). Refuse it up front rather than
  // creating the zombie. The same helper already gates auto-spawned bills.
  if (!hasBillLifecycle(countryId)) {
    return {
      status: 400,
      body: {
        error:
          "This legislature does not process national bills yet, so a bill filed here would never come to a vote.",
      },
    };
  }

  const gameState = await getGameState(db);
  const preset = gameState?.preset;
  const config = getCountryConfig(countryId, preset);
  const lowerKey = config.legislature.lowerChamber.key;
  const upperKey = config.legislature.upperChamber?.key;
  // Bill-active bicameral legislatures (JP/NG) let the upper chamber originate
  // bills; UK Lords / DE Bundesrat are `bicameral: false` and stay lower-only
  // (#912 — NG senators got a 403 "must be a seated member of the House").
  // Era-aware: TR 1953 is unicameral (no Senato).
  const allowedOriginKeys: string[] =
    config.legislature.bicameral && upperKey ? [lowerKey, upperKey] : [lowerKey];

  // Resolve chamber keys to office types for DB queries (e.g. CN "npc" → "npcDelegate")
  const allowedOriginOfficeTypes = allowedOriginKeys.map((k) =>
    getOfficeTypeForChamber(countryId, k, preset)
  );

  const character = await getCharacterByUserId(db, authUser.userId);
  if (!character) {
    return { status: 400, body: { error: "No character found" } };
  }

  const {
    title,
    summary,
    chamber,
    category,
    fullText,
    provisions: clientProvisions,
    confirmElectionRisk,
  } = input;

  // Custom (flavor/roleplay) bills carry no provisions and have no mechanical
  // effect. Force the provision list empty so a client cannot smuggle real
  // effects in under category:"custom".
  const rawProvisions = category === "custom" ? [] : clientProvisions;

  const isAdmin = authUser.isAdmin === true;
  const officialFilter: Record<string, unknown> = {
    characterId: character._id,
    officeType: { $in: allowedOriginOfficeTypes },
    countryId,
  };
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne(officialFilter);
  const usingAdminOverride = isAdmin && !official;

  // Origin/current chamber is stored as the *chamber key* (e.g. "npc"), which is
  // what every read path — bills list, active-bill guard, turn lifecycle — filters
  // on. A seated official's `officeType` is NOT always the chamber key (CN's
  // "npcDelegate" maps to chamber "npc"), so it must be round-tripped through
  // getChamberKeyForOfficeType. Storing the raw officeType hid CN bills from the
  // NPC page and wedged sponsors (Bug #0734).
  let sponsorChamberKey: string = lowerKey;
  if (usingAdminOverride && allowedOriginKeys.includes(chamber)) sponsorChamberKey = chamber;
  if (!isAdmin) {
    if (!official) {
      const chamberLabels =
        allowedOriginKeys.length > 1 && upperKey
          ? `${config.legislature.lowerChamber.name} or ${config.legislature.upperChamber?.name ?? upperKey}`
          : config.legislature.lowerChamber.name;
      return {
        status: 403,
        body: {
          error: `You must be a seated member of the ${chamberLabels} to propose legislation.`,
        },
      };
    }
    sponsorChamberKey = getChamberKeyForOfficeType(countryId, official.officeType);
  }

  // One-party-state guard: banned parties cannot propose bills. Admin
  // override does not bypass this (banning is itself an admin action;
  // letting admins also propose-as-banned would defeat the purpose).
  // Reads runtime governmentType so post-Stage-4 conversion immediately
  // lifts the banned-party restriction.
  const runtimeState = await getCountryState(db, countryId);
  if (runtimeState.governmentType === "onePartyState" && character.party) {
    const sponsorParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parseInt(character.party, 10), countryId });
    // RUNTIME shape, not `config` — see the note in `nationalBillActions`: the
    // static config never learns about a conversion, so it would silently
    // disable this guard for a runtime-converted one-party state.
    if (isBannedParty({ governmentType: runtimeState.governmentType }, sponsorParty)) {
      return {
        status: 403,
        body: { error: "Banned parties cannot propose legislation." },
      };
    }
  }

  if (!isAdmin) {
    // Player suggestion #77 — bicameral relief: once a sponsor's bill has
    // cleared its FIRST chamber (passed_origin, or active_other = now being
    // voted on in the second chamber), the first chamber is free, so let them
    // propose another. Unicameral legislatures — and bicameral bills still in
    // their first chamber — keep the strict one-at-a-time rule.
    const proposalBlockingStatuses = config.legislature.bicameral
      ? ([...NATIONAL_TERMINAL_STATUSES, "passed_origin", "active_other"] as BillStatus[])
      : (NATIONAL_TERMINAL_STATUSES as BillStatus[]);
    const existingActiveBill = await db.collection<Bill>("bills").findOne({
      sponsorId: character._id,
      ...buildActiveNationalBillFilter(countryId, proposalBlockingStatuses),
    });
    if (existingActiveBill) {
      return {
        status: 403,
        body: {
          error: config.legislature.bicameral
            ? "You already have a bill in progress in its first chamber. Wait for it to advance to the second chamber, pass, fail, or be signed before proposing another."
            : "You already have a bill in progress. Wait for it to pass, fail, or be signed before proposing another.",
        },
      };
    }
  }

  // ── State-ownership (nationalization) bills: shared-validated provision family. ──
  if (NATIONALIZATION_BILL_CATEGORIES.has(category as BillCategory)) {
    const natValidation = await validateNationalizationProvisions(db, rawProvisions, countryId);
    if (!natValidation.ok) {
      return { status: natValidation.status, body: { error: natValidation.error } };
    }

    const now = new Date();
    const proposalWarning = await getBillProposalAutoFailWarning(
      db,
      countryId,
      sponsorChamberKey as BillProposalOriginChamber,
      now
    );
    if (proposalWarning && !confirmElectionRisk) {
      return {
        status: 409,
        body: {
          error: getBillProposalAutoFailWarningError(proposalWarning),
          autoFailWarning: proposalWarning,
          requiresElectionRiskConfirmation: true,
        },
      };
    }

    const npiCost = getProvisionCostTotal(
      countProvisionsChargedNationalInfluence({
        policyProvisionCount: natValidation.provisions.length,
        subsidyProvisionCount: 0,
      })
    );
    const actionCost = BILL_PROPOSE_ACTION_COST;
    const currentNational = character.nationalInfluence ?? 0;
    if (!isAdmin) {
      const currentActions = character.actions ?? 0;
      if (npiCost > 0 && currentNational < npiCost) {
        return {
          status: 400,
          body: {
            error: `This bill costs ${npiCost} national political influence (you have ${currentNational.toFixed(0)}).`,
          },
        };
      }
      if (currentActions < actionCost) {
        return {
          status: 400,
          body: {
            error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
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
            updatedAt: now,
          },
          $inc: {
            actions: -actionCost,
            ...(npiCost > 0 ? { nationalInfluence: -npiCost } : {}),
          },
        }
      );
      if (spendResult.modifiedCount === 0) {
        return {
          status: 409,
          body: { error: "Your actions or national influence changed. Please try again." },
        };
      }
    }

    const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_MS);
    const gameStateForTurn = await getGameState(db);
    const currentTurnForBill = gameStateForTurn?.currentTurn ?? 0;
    const votingEndsOnTurn = currentTurnForBill + VOTING_DURATION_HOURS;
    const chamberKey = sponsorChamberKey as BillChamber;
    const natStateId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;
    const natBill: Omit<Bill, "_id"> = {
      countryId,
      stateId: natStateId,
      title: title.trim(),
      summary: summary.trim(),
      ...(fullText?.trim() ? { fullText: fullText.trim() } : {}),
      originChamber: chamberKey,
      currentChamber: chamberKey,
      sponsorId: character._id,
      sponsorName: character.name,
      sponsorParty: character.party ?? undefined,
      ...(usingAdminOverride ? { adminProposed: true } : {}),
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      category,
      provisions: natValidation.provisions,
      ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
      ...(!isAdmin ? { proposalActionCost: actionCost } : {}),
      proposedAt: now,
      votingStartedAt: now,
      votingEndsAt,
      votingEndsOnTurn,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(natBill);
      return { status: 201, body: { success: true, billId: result.insertedId.toString() } };
    } catch (error) {
      if (!isAdmin) {
        await db.collection<Character>("characters").updateOne(
          { _id: character._id },
          {
            $inc: {
              actions: actionCost,
              ...(npiCost > 0 ? { nationalInfluence: npiCost } : {}),
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      throw error;
    }
  }

  const enabledCountryIds = new Set(await getEnabledCountryIds());
  const validation = await validateBillProvisions(db, rawProvisions, category, countryId);
  if (!validation.ok) {
    return { status: validation.status, body: { error: validation.error } };
  }

  const {
    policyProvisions: validatedPolicyProvisions,
    tariffProvisions: validatedTariffProvisions,
    subsidyProvisions: validatedSubsidyProvisions,
    embargoProvisions: validatedEmbargoProvisions,
    unionLawProvisions: validatedUnionLawProvisions,
    electoralLawProvisions: validatedElectoralLawProvisions,
    centralBankProvisions: validatedCentralBankProvisions,
  } = validation;

  for (const provision of validatedTariffProvisions) {
    if (provision.scopeType === "corporation") {
      return {
        status: 400,
        body: { error: "Corporation-scoped tariffs are not available via bill proposal." },
      };
    }

    if (
      provision.scopeType === "sector" &&
      provision.targetSectorType &&
      !CORPORATION_TYPES.includes(provision.targetSectorType as CorporationType)
    ) {
      return {
        status: 400,
        body: { error: `Invalid sector: ${provision.targetSectorType}.` },
      };
    }

    if (provision.scopeType === "origin_country" && provision.targetOriginCountryId) {
      if (provision.targetOriginCountryId === countryId) {
        return {
          status: 400,
          body: { error: "Cannot tariff imports from your own country." },
        };
      }
      if (!enabledCountryIds.has(provision.targetOriginCountryId)) {
        return {
          status: 400,
          body: { error: "Origin country must be an enabled country." },
        };
      }
    }
  }

  // Validate embargo targets: never self, must be an enabled country.
  for (const provision of validatedEmbargoProvisions) {
    if (provision.targetCountry === countryId) {
      return { status: 400, body: { error: "A country cannot embargo itself." } };
    }
    if (!enabledCountryIds.has(provision.targetCountry)) {
      return {
        status: 400,
        body: { error: "Embargo target must be an enabled country." },
      };
    }
  }

  if (category === "trade") {
    if (validatedTariffProvisions.length === 0 && validatedEmbargoProvisions.length === 0) {
      return {
        status: 400,
        body: { error: "Trade bills must contain at least one tariff or embargo provision." },
      };
    }
    if (validatedTariffProvisions.length > 0 && validatedEmbargoProvisions.length > 0) {
      return {
        status: 400,
        body: {
          error: "A trade bill is either tariffs or embargoes — propose them as separate bills.",
        },
      };
    }
    if (validatedPolicyProvisions.length > 0) {
      return {
        status: 400,
        body: { error: "Trade bills cannot mix policy provisions with trade restrictions." },
      };
    }
  }

  if (
    category === "industry" &&
    validatedSubsidyProvisions.length === 0 &&
    validatedUnionLawProvisions.length === 0
  ) {
    return {
      status: 400,
      body: { error: "Industry bills must contain at least one subsidy or union-law provision." },
    };
  }

  const activeBillFilter = buildActiveNationalBillFilter(
    countryId,
    NATIONAL_TERMINAL_STATUSES as BillStatus[]
  );

  const duplicateCheck = await checkDuplicateProvisions(
    db,
    "bills",
    activeBillFilter,
    validatedPolicyProvisions
  );
  if (duplicateCheck) {
    return { status: 409, body: { error: duplicateCheck.error } };
  }

  const tariffDuplicateCheck = await checkDuplicateTariffProvisions(
    db,
    "bills",
    activeBillFilter,
    validatedTariffProvisions
  );
  if (tariffDuplicateCheck) {
    return { status: 409, body: { error: tariffDuplicateCheck.error } };
  }

  const policyStoreId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;
  const currentLevelCheck = await checkCurrentPolicyLevel(
    db,
    policyStoreId,
    validatedPolicyProvisions
  );
  if (currentLevelCheck) {
    return { status: 409, body: { error: currentLevelCheck.error } };
  }

  const snapshottedPolicyProvisions = await snapshotBillPolicyProvisions(
    db,
    { scope: "national", countryId },
    validatedPolicyProvisions
  );

  const now = new Date();
  const proposalWarning = await getBillProposalAutoFailWarning(
    db,
    countryId,
    sponsorChamberKey as BillProposalOriginChamber,
    now
  );
  if (proposalWarning && !confirmElectionRisk) {
    return {
      status: 409,
      body: {
        error: getBillProposalAutoFailWarningError(proposalWarning),
        autoFailWarning: proposalWarning,
        requiresElectionRiskConfirmation: true,
      },
    };
  }

  const npiCost = getProvisionCostTotal(
    countProvisionsChargedNationalInfluence({
      policyProvisionCount: validatedPolicyProvisions.length,
      subsidyProvisionCount: validatedSubsidyProvisions.length,
      unionLawProvisionCount: validatedUnionLawProvisions.length,
      standaloneProvisionCount:
        validatedCentralBankProvisions.length + validatedElectoralLawProvisions.length,
    })
  );
  const actionCost = BILL_PROPOSE_ACTION_COST;
  const currentNational = character.nationalInfluence ?? 0;
  if (!isAdmin) {
    const currentActions = character.actions ?? 0;
    if (npiCost > 0 && currentNational < npiCost) {
      return {
        status: 400,
        body: {
          error: `This bill costs ${npiCost} national political influence (you have ${currentNational.toFixed(0)}).`,
        },
      };
    }
    if (currentActions < actionCost) {
      return {
        status: 400,
        body: {
          error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
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
          updatedAt: now,
        },
        $inc: {
          actions: -actionCost,
          ...(npiCost > 0 ? { nationalInfluence: -npiCost } : {}),
        },
      }
    );
    if (spendResult.modifiedCount === 0) {
      return {
        status: 409,
        body: { error: "Your actions or national influence changed. Please try again." },
      };
    }
  }

  const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_MS);
  const gameStateForTurn = await getGameState(db);
  const currentTurnForBill = gameStateForTurn?.currentTurn ?? 0;
  const votingEndsOnTurn = currentTurnForBill + VOTING_DURATION_HOURS;
  const chamberKey = sponsorChamberKey as BillChamber;
  const firstPolicy = snapshottedPolicyProvisions[0];
  const combinedProvisions = [
    ...snapshottedPolicyProvisions,
    ...validatedTariffProvisions,
    ...validatedSubsidyProvisions,
    ...validatedEmbargoProvisions,
    ...validatedUnionLawProvisions,
    ...validatedElectoralLawProvisions,
    ...validatedCentralBankProvisions,
  ];
  const stateId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;

  const bill: Omit<Bill, "_id"> = {
    countryId,
    stateId,
    title: title.trim(),
    summary: summary.trim(),
    ...(fullText?.trim() ? { fullText: fullText.trim() } : {}),
    originChamber: chamberKey,
    currentChamber: chamberKey,
    sponsorId: character._id,
    sponsorName: character.name,
    sponsorParty: character.party ?? undefined,
    ...(usingAdminOverride ? { adminProposed: true } : {}),
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category,
    provisions: combinedProvisions,
    ...(firstPolicy && {
      legislationTypeId: firstPolicy.legislationTypeId,
      effectDirection: firstPolicy.effectDirection,
    }),
    ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
    ...(!isAdmin ? { proposalActionCost: actionCost } : {}),
    proposedAt: now,
    votingStartedAt: now,
    votingEndsAt,
    votingEndsOnTurn,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
    return {
      status: 201,
      body: { success: true, billId: result.insertedId.toString() },
    };
  } catch (error) {
    if (!isAdmin) {
      await db.collection<Character>("characters").updateOne(
        { _id: character._id },
        {
          $inc: {
            actions: actionCost,
            ...(npiCost > 0 ? { nationalInfluence: npiCost } : {}),
          },
          $set: { updatedAt: new Date() },
        }
      );
    }
    throw error;
  }
}
