import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import { ORG_PROPOSAL_VOTING_TURNS } from "@/lib/constants/internationalOrganizations";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import { getDirectiveDef } from "@/lib/constants/orgDirectives";
import { POSTURE_META, isAlertPosture, type AlertPosture } from "@/lib/constants/orgPosture";
import { getAgencyDef } from "@/lib/constants/orgAgencies";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import {
  getMembers,
  loadOrganizationDefWithPowers,
  recordOrgHistoryEvent,
} from "@/lib/internationalOrganizations/service";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getConflict } from "@/lib/db/collections/conflicts";
import { hostSideOf } from "@/lib/military/warEntryPolicy";
import { BLOC_DESIGNATED_ORG_IDS } from "@/lib/constants/orgCategory";

export type ProposeResolutionInput =
  | { type: "free_trade_agreement"; parties: CountryId[]; title?: string; description?: string }
  | {
      type: "sanctions";
      targetCountryId: CountryId;
      commodity: CommodityType | "all";
      title?: string;
      description?: string;
    }
  | {
      type: "aid_package";
      recipientCountryId: CountryId;
      amount: number;
      title?: string;
      description?: string;
    }
  | { type: "set_dues"; duesRateAnnual: number; title?: string; description?: string }
  | { type: "directive"; directiveKey: string; title?: string; description?: string }
  | {
      type: "joint_statement";
      subjectCountryId: CountryId;
      stance: "endorse" | "condemn";
      title?: string;
      description?: string;
    }
  | { type: "set_posture"; posture: AlertPosture; title?: string; description?: string }
  | { type: "fund_agency"; agencyKey: string; title?: string; description?: string }
  | {
      type: "join_conflict";
      /** ConflictDoc._id — the theater key, not the public conflictId. */
      theaterId: string;
      side: "A" | "B";
      title?: string;
      description?: string;
    };

export async function proposeOrganizationLegislation(params: {
  db: Db;
  countryId: CountryId;
  orgId: string;
  actor: {
    characterId: ObjectId;
    characterName: string;
  };
  input: ProposeResolutionInput;
}) {
  const { db, countryId, orgId, actor, input } = params;

  // WithPowers: this is the gate on what the org may table, so it needs the
  // world's effective category (a Cold War bloc outranks its security archetype).
  const def = await loadOrganizationDefWithPowers(db, orgId);
  if (!def) {
    return { ok: false as const, status: 400, error: "Unknown organization." };
  }
  // Category gate: the org's category must grant this power and its effect must
  // be implemented (Phase 2 enables types incrementally).
  if (!canTableResolutionType(def.category, input.type)) {
    return {
      ok: false as const,
      status: 400,
      error: `${def.shortName} cannot table a ${input.type.replace(/_/g, " ")} resolution.`,
    };
  }

  // Membership is entity-keyed; the proposer is a country either way.
  const members = new Set<string>(await getMembers(db, orgId));
  if (!members.has(countryId)) {
    return { ok: false as const, status: 400, error: `${countryId} is not a member of ${orgId}.` };
  }

  const currentTurn = await getCurrentTurn(db);
  const legislation = await getOrganizationLegislationCollection(db);
  const legislationId = new ObjectId();
  const now = new Date();

  if (input.type === "free_trade_agreement") {
    const partySet = new Set<CountryId>(input.parties);
    partySet.add(countryId);
    const parties = Array.from(partySet);
    if (parties.length < 2) {
      return {
        ok: false as const,
        status: 400,
        error: "A free-trade agreement requires at least two parties.",
      };
    }
    for (const partyId of parties) {
      if (!members.has(partyId)) {
        return {
          ok: false as const,
          status: 400,
          error: `Party ${partyId} is not a member of ${orgId}.`,
        };
      }
    }

    const partyNames = parties
      .map((partyId) => COUNTRY_CONFIGS[partyId].name)
      .sort()
      .join(", ");
    const title = input.title?.trim() || `${orgId} Free Trade Agreement: ${partyNames}`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "free_trade_agreement",
      title,
      description: input.description,
      parties,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} introduced a free-trade agreement at ${orgId} between ${partyNames}.`,
      { organizationId: orgId, legislationId: legislationId.toString(), parties }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "sanctions") {
    const target = input.targetCountryId;
    if (!COUNTRY_CONFIGS[target]) {
      return { ok: false as const, status: 400, error: `Unknown target country: ${target}.` };
    }
    const targetName = COUNTRY_CONFIGS[target].name;
    const commodityLabel = input.commodity === "all" ? "all commodities" : input.commodity;
    const title = input.title?.trim() || `${orgId} Sanctions: ${targetName} (${commodityLabel})`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "sanctions",
      title,
      description: input.description,
      parties: [],
      sanctionsTargetCountryId: target,
      sanctionsCommodity: input.commodity,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} tabled sanctions at ${orgId} against ${targetName} (${commodityLabel}).`,
      { organizationId: orgId, legislationId: legislationId.toString(), target }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "aid_package") {
    const recipient = input.recipientCountryId;
    if (!members.has(recipient)) {
      return {
        ok: false as const,
        status: 400,
        error: `Recipient ${recipient} is not a member of ${orgId}.`,
      };
    }
    if (!(input.amount > 0)) {
      return { ok: false as const, status: 400, error: "Aid amount must be positive." };
    }
    // Membership is entity-wide, but aid is paid into a `federalBudget` — a
    // macro-tier member has none. Refuse here rather than let the unguarded
    // config lookup below throw, or bank an agreement that could never pay out.
    const recipientConfig = COUNTRY_CONFIGS[recipient];
    if (!recipientConfig) {
      return {
        ok: false as const,
        status: 400,
        error: `${recipient} has no treasury to receive aid.`,
      };
    }

    const recipientName = recipientConfig.name;
    const title = input.title?.trim() || `${orgId} Aid Package: ${recipientName}`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "aid_package",
      title,
      description: input.description,
      parties: [],
      aidRecipientCountryId: recipient,
      aidAmount: input.amount,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} tabled an aid package at ${orgId} for ${recipientName}.`,
      { organizationId: orgId, legislationId: legislationId.toString(), recipient }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "directive") {
    const def = getDirectiveDef(input.directiveKey);
    if (!def) {
      return {
        ok: false as const,
        status: 400,
        error: `Unknown directive: ${input.directiveKey}.`,
      };
    }
    const title = input.title?.trim() || `${orgId} Directive: ${def.label}`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "directive",
      title,
      description: input.description ?? def.blurb,
      parties: [],
      directiveKey: def.key,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} tabled the ${def.label} directive at ${orgId}.`,
      { organizationId: orgId, legislationId: legislationId.toString() }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "joint_statement") {
    const subject = input.subjectCountryId;
    if (!COUNTRY_CONFIGS[subject]) {
      return { ok: false as const, status: 400, error: `Unknown subject country: ${subject}.` };
    }
    const subjectName = COUNTRY_CONFIGS[subject].name;
    const verb = input.stance === "condemn" ? "Condemnation" : "Endorsement";
    const title = input.title?.trim() || `${orgId} ${verb} of ${subjectName}`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "joint_statement",
      title,
      description: input.description,
      parties: [],
      jointStatementSubjectCountryId: subject,
      jointStatementStance: input.stance,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} tabled a ${input.stance === "condemn" ? "condemnation" : "endorsement"} of ${subjectName} at ${orgId}.`,
      { organizationId: orgId, legislationId: legislationId.toString() }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "fund_agency") {
    const def = getAgencyDef(input.agencyKey);
    if (!def) {
      return { ok: false as const, status: 400, error: `Unknown agency: ${input.agencyKey}.` };
    }
    const title = input.title?.trim() || `${orgId} Agency Funding: ${def.label}`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "fund_agency",
      title,
      description: input.description ?? def.blurb,
      parties: [],
      agencyKey: def.key,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} proposed funding the ${def.label} at ${orgId}.`,
      { organizationId: orgId, legislationId: legislationId.toString() }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "join_conflict") {
    // The subsystem's own switch, enforced here as the admin create route enforces
    // it. Conflict documents outlive the flag being turned off, so without this a
    // crafted request could table a war-entry vote in a world where the Conflicts
    // subsystem is off and the pages that would show it redirect away.
    const gs = await db
      .collection<{ _id: string; conflictsEnabled?: boolean }>("gameState")
      .findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return { ok: false as const, status: 404, error: "Conflicts subsystem disabled" };
    }
    if (input.side !== "A" && input.side !== "B") {
      return { ok: false as const, status: 400, error: "Pick side A or side B." };
    }
    // Checked again at enactment: a resolution sits for 24 turns and the war can end
    // inside that window, so passing here is not a promise that it is still live.
    const conflict = await getConflict(db, input.theaterId);
    if (!conflict || conflict.status === "resolved") {
      return { ok: false as const, status: 400, error: "That conflict is not live." };
    }

    const sideLabel = input.side === "A" ? conflict.sideA.label : conflict.sideB.label;
    const title = input.title?.trim() || `${orgId} Entry into ${conflict.name} (${sideLabel})`;
    const collectiveDefense =
      (BLOC_DESIGNATED_ORG_IDS as readonly string[]).includes(orgId) &&
      hostSideOf(conflict) === input.side;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "join_conflict",
      title,
      description: input.description,
      parties: [],
      joinConflictTheaterId: conflict._id,
      joinConflictSide: input.side,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: collectiveDefense ? "active" : "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: collectiveDefense ? currentTurn : currentTurn + ORG_PROPOSAL_VOTING_TURNS,
      ...(collectiveDefense ? { enactedAt: now, enactedOnTurn: currentTurn } : {}),
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      collectiveDefense
        ? `${orgId} collective defense activated immediately for ${conflict.name}.`
        : `${COUNTRY_CONFIGS[countryId].name} moved that ${orgId} enter ${conflict.name} alongside ${sideLabel}.`,
      { organizationId: orgId, legislationId: legislationId.toString() }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  if (input.type === "set_posture") {
    if (!isAlertPosture(input.posture)) {
      return { ok: false as const, status: 400, error: `Unknown alert posture: ${input.posture}.` };
    }
    const title =
      input.title?.trim() || `${orgId} Alert Posture: ${POSTURE_META[input.posture].label}`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "set_posture",
      title,
      description: input.description ?? POSTURE_META[input.posture].blurb,
      parties: [],
      postureValue: input.posture,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} proposed moving ${orgId} to ${POSTURE_META[input.posture].label} alert posture.`,
      { organizationId: orgId, legislationId: legislationId.toString() }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }

  // set_dues
  if (!(input.duesRateAnnual >= 0)) {
    return { ok: false as const, status: 400, error: "Dues rate must be zero or positive." };
  }
  const pct = (input.duesRateAnnual * 100).toFixed(3);
  const title = input.title?.trim() || `${orgId} Dues Assessment: ${pct}% of GDP / year`;

  await legislation.insertOne({
    _id: legislationId,
    organizationId: orgId,
    type: "set_dues",
    title,
    description: input.description,
    parties: [],
    duesRateAnnual: input.duesRateAnnual,
    proposingCountryId: countryId,
    proposedByCharacterId: actor.characterId,
    proposedByCharacterName: actor.characterName,
    status: "pending",
    votes: [],
    proposedAt: now,
    proposedOnTurn: currentTurn,
    closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
  });

  await recordOrgHistoryEvent(
    db,
    countryId,
    currentTurn,
    `${COUNTRY_CONFIGS[countryId].name} proposed setting ${orgId} dues to ${pct}% of GDP/year.`,
    { organizationId: orgId, legislationId: legislationId.toString() }
  );

  return { ok: true as const, legislationId: legislationId.toString() };
}
