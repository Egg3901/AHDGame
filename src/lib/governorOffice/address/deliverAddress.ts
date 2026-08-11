import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  GovernorAddress,
  Character,
  GovernorOfficeState,
  PartyGroupFavorability,
} from "@/lib/db/types";
import type { StateDemographicTurnout } from "@/lib/db/types/stateDemographicTurnout";
import type { CountryId } from "@/lib/constants/countries";
import {
  ADDRESS_COOLDOWN_TURNS,
  ADDRESS_ACTION_COST,
  ADDRESS_NPI_COST,
  ADDRESS_APPROVAL_BUMP,
  ADDRESS_APPROVAL_DURATION_TURNS,
  ADDRESS_AGENDA_DURATION_TURNS,
  ADDRESS_DEMOGRAPHIC_DELTA,
  ADDRESS_DEMOGRAPHIC_DURATION_TURNS,
  ADDRESS_PARTY_GROUP_FAVORABILITY_DELTA,
  ADDRESS_EMPHASIS_MIN,
  ADDRESS_EMPHASIS_MAX,
  ADDRESS_TITLE_MIN_LENGTH,
  ADDRESS_TITLE_MAX_LENGTH,
  ADDRESS_BODY_MAX_LENGTH,
} from "@/lib/constants/governorOffice";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { readTurnoutModifier, turnoutModifierPath } from "@/lib/demographics/turnoutTarget";
import { getNationalAddressName, getRegionalAddressName } from "@/lib/constants/countries";
import { generateAddressNews } from "@/lib/news";
import { sendCountryGameEvent } from "@/lib/discordWebhooks";
import { buildNationalAddressEmbed } from "@/lib/governorOffice/address/addressWebhook";

export interface DeliverAddressInput {
  countryId: CountryId;
  stateId: string;
  character: { _id: ObjectId; name: string; party?: string };
  title: string;
  body?: string;
  emphasizedCategories: string[];
  /** Optional — when set, the demographic group whose turnout will be boosted. */
  targetDemographicGroupId?: string;
  /** When true: cooldown waived, AP + NPI debits skipped, address row tagged
   *  `adminProposed: true`. The route is responsible for verifying the caller
   *  is actually an admin before passing this flag. */
  adminOverride?: boolean;
}

export interface DeliverAddressResult {
  status: number;
  body: { addressId?: string; error?: string };
}

/**
 * Deliver a State of the State address (v2).
 *
 * Effects, all written on the same address row and consumed by their respective
 * runtime pipelines via expiresAtTurn windows:
 *   - approvalEffect — additive bump to governor approval in this state.
 *   - agendaEffect — co-partisan NPP cross-pressure nudge on state bills in
 *     the emphasized categories. Read at vote time.
 *   - demographicEffect — additive turnout boost on the targeted voter group
 *     (write-side: applied at delivery, subtracted by the expiry turn phase).
 */
export async function deliverAddress(
  db: Db,
  input: DeliverAddressInput
): Promise<DeliverAddressResult> {
  const {
    countryId,
    stateId,
    character,
    title,
    body,
    emphasizedCategories,
    targetDemographicGroupId,
  } = input;
  const adminOverride = input.adminOverride === true;
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);

  const trimmedTitle = title.trim();
  if (
    trimmedTitle.length < ADDRESS_TITLE_MIN_LENGTH ||
    trimmedTitle.length > ADDRESS_TITLE_MAX_LENGTH
  ) {
    return {
      status: 400,
      body: {
        error: `Title must be ${ADDRESS_TITLE_MIN_LENGTH}-${ADDRESS_TITLE_MAX_LENGTH} characters.`,
      },
    };
  }
  const trimmedBody = body?.trim();
  if (trimmedBody && trimmedBody.length > ADDRESS_BODY_MAX_LENGTH) {
    return {
      status: 400,
      body: { error: `Body must be ${ADDRESS_BODY_MAX_LENGTH} characters or fewer.` },
    };
  }
  if (
    emphasizedCategories.length < ADDRESS_EMPHASIS_MIN ||
    emphasizedCategories.length > ADDRESS_EMPHASIS_MAX
  ) {
    return {
      status: 400,
      body: { error: `Pick ${ADDRESS_EMPHASIS_MIN}-${ADDRESS_EMPHASIS_MAX} emphasis categories.` },
    };
  }

  // Cooldown attaches to the office. Admin override bypasses cooldown to
  // allow correcting state.
  if (!adminOverride) {
    const recent = await db
      .collection<GovernorAddress>("governorAddresses")
      .find({ countryId, stateId })
      .sort({ deliveredAtTurn: -1 })
      .limit(1)
      .toArray();
    const last = recent[0];
    if (last && currentTurn - last.deliveredAtTurn < ADDRESS_COOLDOWN_TURNS) {
      return {
        status: 400,
        body: {
          error: `Address is on cooldown until T+${last.deliveredAtTurn + ADDRESS_COOLDOWN_TURNS}.`,
        },
      };
    }

    // Atomic spend: Office AP from governorOfficeState, then character NPI.
    // Two writes so we can target separate documents — if the NPI debit fails
    // after the office spend succeeds, refund the office AP so the office state
    // stays consistent.
    const officeSpend = await db.collection<GovernorOfficeState>("governorOfficeState").updateOne(
      {
        countryId,
        stateId,
        gubernatorialActions: { $gte: ADDRESS_ACTION_COST },
      },
      {
        $inc: { gubernatorialActions: -ADDRESS_ACTION_COST },
        $set: { updatedAt: now },
      }
    );
    if (officeSpend.modifiedCount === 0) {
      return { status: 400, body: { error: "Insufficient office action points." } };
    }
    const npiSpend = await db.collection<Character>("characters").updateOne(
      {
        _id: character._id,
        nationalInfluence: { $gte: ADDRESS_NPI_COST },
      },
      {
        $inc: { nationalInfluence: -ADDRESS_NPI_COST },
        $set: { updatedAt: now },
      }
    );
    if (npiSpend.modifiedCount === 0) {
      // Refund office AP so the office stays consistent.
      await db.collection<GovernorOfficeState>("governorOfficeState").updateOne(
        { countryId, stateId },
        {
          $inc: { gubernatorialActions: ADDRESS_ACTION_COST },
          $set: { updatedAt: new Date() },
        }
      );
      return { status: 400, body: { error: "Insufficient National Political Influence." } };
    }
  }

  // Apply demographic turnout boost write-side (so the existing election
  // pipeline picks it up without extra read-side wiring). Clamped to ±20 like
  // any other GOTV / canvassing modifier. Snapshot the actual delta applied so
  // the expiry turn phase can revert it precisely.
  //
  // State-scope addresses (stateId is a real state) apply to one state.
  // National-scope addresses (stateId equals the country's national pseudo-id)
  // fan out to every state in the country, with per-state headroom clamping
  // and a per-state delta map snapshotted on the address row.
  let appliedTurnoutDelta = 0;
  let turnoutDeltasByState: Record<string, number> | undefined;
  if (targetDemographicGroupId) {
    const isNational = stateId === getNationalStateId(countryId);
    if (isNational) {
      const states = await db
        .collection<{ _id: string; countryId: CountryId }>("states")
        .find({ countryId })
        .toArray();
      const stateIds = states.map((s) => s._id);
      const turnoutDocs = await db
        .collection<StateDemographicTurnout>("stateDemographicTurnout")
        .find({ _id: { $in: stateIds } })
        .toArray();
      const currentByState = new Map(
        turnoutDocs.map((d) => [d._id, readTurnoutModifier(d.modifiers, targetDemographicGroupId)])
      );
      const modifierPath = turnoutModifierPath(targetDemographicGroupId);
      const deltas: Record<string, number> = {};
      const ops: Array<{
        updateOne: {
          filter: { _id: string };
          update: {
            $inc: Record<string, number>;
            $set: { lastUpdated: Date };
          };
          upsert: boolean;
        };
      }> = [];
      for (const sId of stateIds) {
        const current = currentByState.get(sId) ?? 0;
        const headroom = 20 - current;
        const applied = Math.max(0, Math.min(ADDRESS_DEMOGRAPHIC_DELTA, headroom));
        if (applied > 0) {
          deltas[sId] = applied;
          ops.push({
            updateOne: {
              filter: { _id: sId },
              update: {
                $inc: { [modifierPath]: applied },
                $set: { lastUpdated: now },
              },
              upsert: true,
            },
          });
        }
      }
      if (ops.length > 0) {
        await db.collection<StateDemographicTurnout>("stateDemographicTurnout").bulkWrite(ops);
      }
      turnoutDeltasByState = deltas;
      // Scalar reflects the sum so UIs reading the legacy field show a
      // representative value; precise expiry uses the per-state map.
      appliedTurnoutDelta = Object.values(deltas).reduce((s, v) => s + v, 0);
    } else {
      const turnoutDoc = await db
        .collection<StateDemographicTurnout>("stateDemographicTurnout")
        .findOne({ _id: stateId });
      const currentModifier = readTurnoutModifier(turnoutDoc?.modifiers, targetDemographicGroupId);
      const headroom = 20 - currentModifier;
      appliedTurnoutDelta = Math.max(0, Math.min(ADDRESS_DEMOGRAPHIC_DELTA, headroom));
      if (appliedTurnoutDelta > 0) {
        await db.collection<StateDemographicTurnout>("stateDemographicTurnout").updateOne(
          { _id: stateId },
          {
            $inc: { [turnoutModifierPath(targetDemographicGroupId)]: appliedTurnoutDelta },
            $set: { lastUpdated: now },
          },
          { upsert: true }
        );
      }
    }
  }

  const addressId = new MongoObjectId();
  const partyId = character.party ?? "independent";
  const addr: GovernorAddress = {
    _id: addressId,
    countryId,
    stateId,
    deliveredByCharacterId: character._id,
    deliveredByName: character.name,
    deliveredAtTurn: currentTurn,
    title: trimmedTitle,
    ...(trimmedBody ? { body: trimmedBody } : {}),
    emphasizedCategories,
    ...(targetDemographicGroupId ? { targetDemographicGroupId } : {}),
    approvalEffect: {
      amount: ADDRESS_APPROVAL_BUMP,
      expiresAtTurn: currentTurn + ADDRESS_APPROVAL_DURATION_TURNS,
    },
    agendaEffect: {
      partyId,
      expiresAtTurn: currentTurn + ADDRESS_AGENDA_DURATION_TURNS,
    },
    demographicEffect: {
      turnoutDelta: appliedTurnoutDelta,
      ...(turnoutDeltasByState ? { turnoutDeltasByState } : {}),
      expiresAtTurn: currentTurn + ADDRESS_DEMOGRAPHIC_DURATION_TURNS,
    },
    ...(adminOverride ? { adminProposed: true } : {}),
    createdAt: now,
  };
  await db.collection<GovernorAddress>("governorAddresses").insertOne(addr);

  // Per-party demographic favorability — when the address targets a voter
  // group AND the leader belongs to a party, that party gets a per-group
  // appeal boost for the same window as the demographic turnout effect.
  // Election vote-distribution reads active rows and multiplies the group
  // weight by (1 + delta/100). Independent / unaffiliated leaders skip
  // this since there's no party row to assign the boost to.
  if (
    targetDemographicGroupId &&
    partyId &&
    partyId !== "independent" &&
    ADDRESS_PARTY_GROUP_FAVORABILITY_DELTA > 0
  ) {
    try {
      const pgf: PartyGroupFavorability = {
        countryId,
        partyId,
        groupId: targetDemographicGroupId,
        favorabilityDelta: ADDRESS_PARTY_GROUP_FAVORABILITY_DELTA,
        sourceAddressId: addressId,
        expiresAtTurn: currentTurn + ADDRESS_DEMOGRAPHIC_DURATION_TURNS,
        createdAt: now,
      };
      await db.collection<PartyGroupFavorability>("partyGroupFavorability").insertOne(pgf);
    } catch {
      // Non-critical: the address is still delivered; vote distribution
      // simply won't get the per-group bonus this cycle.
    }
  }

  const isNational = stateId === getNationalStateId(countryId);

  // Announce on the news wire. Best-effort — failures here don't abort the
  // delivery (the address row is already persisted with its effects).
  try {
    await generateAddressNews({
      scope: isNational ? "national" : "state",
      addressName: isNational
        ? getNationalAddressName(countryId)
        : getRegionalAddressName(countryId),
      title: trimmedTitle,
      deliveredByName: character.name,
      countryId,
      ...(isNational ? {} : { state: stateId }),
      emphasizedCategories,
      ...(trimmedBody ? { body: trimmedBody } : {}),
    });
  } catch {
    // Swallow — news is non-critical for the delivery flow.
  }

  // Mirror national (head-of-government) addresses to the country's Discord
  // Game Events channel — e.g. a UK PM's Address to the Nation lands in UK
  // Game Events (+ the global game webhook). Regional governor addresses stay
  // off the country channel. Best-effort: sendCountryGameEvent never throws,
  // but guard anyway so a Discord hiccup can't abort a persisted delivery.
  if (isNational) {
    try {
      await sendCountryGameEvent(
        countryId,
        buildNationalAddressEmbed({
          countryId,
          title: trimmedTitle,
          ...(trimmedBody ? { body: trimmedBody } : {}),
          deliveredByName: character.name,
        })
      );
    } catch {
      // Swallow — Discord is non-critical for the delivery flow.
    }
  }

  return { status: 200, body: { addressId: addressId.toString() } };
}
