import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bill } from "@/lib/db/types/legislation";
import type { State } from "@/lib/db/types/state";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { allocateSuccessionAmount } from "./rules/financialSettlement";
import { decideAutonomousFederationConsent } from "./rules/autonomousConsent";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "./politicalProposal";
import {
  FEDERATION_RATIFICATIONS_COLLECTION,
  type FederationRatificationRecord,
} from "./ratificationStore";

/** Record consent after the source legislature enacts the exact mandate. An
 * interrupted run resumes without revising any participant's first decision. */
export async function recordFederationRatifications(input: {
  db: Db;
  sourceCountryId: CountryId;
  settlementId: string;
  revision: number;
  currentTurn: number;
}): Promise<FederationRatificationRecord[]> {
  const { db, sourceCountryId, settlementId, revision, currentTurn } = input;
  if (
    !settlementId.trim() ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(currentTurn) ||
    currentTurn < 1
  )
    throw new Error("Federation ratification needs a valid settlement and turn");
  const proposal = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .findOne({
      _id: `1991-default:${settlementId}:${revision}`,
      sourceEntityId: sourceCountryId,
      status: "open",
    });
  if (!proposal || proposal.terms.sourceEntityId !== sourceCountryId)
    throw new Error("Federation ratification has no open matching proposal");
  const bill = await db.collection<Bill>("bills").findOne({
    _id: proposal.billId,
    countryId: sourceCountryId,
    status: { $in: ["signed", "veto_override"] },
    "federationSettlementMandate.termsHash": proposal.termsHash,
    "federationSettlementMandate.settlementId": settlementId,
    "federationSettlementMandate.revision": revision,
  });
  if (!bill || !(bill.enactedAt instanceof Date) || !Number.isFinite(bill.enactedAt.getTime()))
    throw new Error("Federation ratification awaits an enacted source mandate");

  const participants = proposal.terms.participants;
  if (participants.length < 2) throw new Error("Federation ratification has invalid participants");
  const regions = [...new Set(proposal.terms.territories.flatMap((entry) => entry.regionIds))];
  const states = await db
    .collection<State>("states")
    .find({ _id: { $in: regions } })
    .toArray();
  if (
    states.length !== regions.length ||
    states.some((state) => state.countryId !== sourceCountryId)
  )
    throw new Error("Federation ratification territory no longer matches the source");
  const populationByRegion = new Map(states.map((state) => [state._id, state.population]));
  const populations: Record<string, number> = {};
  for (const territory of proposal.terms.territories) {
    const population = territory.regionIds.reduce(
      (sum, regionId) => sum + (populationByRegion.get(regionId) ?? 0),
      0
    );
    if (
      !Number.isSafeInteger(population) ||
      population <= 0 ||
      Object.hasOwn(populations, territory.entityId)
    )
      throw new Error("Federation ratification needs positive distinct populations");
    populations[territory.entityId] = population;
  }
  if (Object.keys(populations).sort().join(",") !== [...participants].sort().join(","))
    throw new Error("Federation ratification participants disagree with territory");
  const assetShares =
    proposal.terms.assetBasis === "population"
      ? allocateSuccessionAmount(10_000, populations)
      : proposal.terms.assetWeights;
  const debtShares =
    proposal.terms.debtBasis === "population"
      ? allocateSuccessionAmount(10_000, populations)
      : proposal.terms.debtWeights;
  const macros = await db
    .collection<MacroCountryState>("macroCountries")
    .find({
      entityId: { $in: participants.filter((id) => id !== sourceCountryId) },
      presetId: "1991-default",
    })
    .toArray();
  const macroById = new Map(macros.map((macro) => [macro.entityId, macro]));
  const records = db.collection<FederationRatificationRecord>(FEDERATION_RATIFICATIONS_COLLECTION);
  const saved: FederationRatificationRecord[] = [];
  for (const entityId of participants) {
    const macro = entityId === sourceCountryId ? null : macroById.get(entityId);
    if (entityId !== sourceCountryId && (!macro || macro.retiredAt))
      throw new Error(`Federation participant ${entityId} has no active background economy`);
    const decision = macro
      ? decideAutonomousFederationConsent({
          stability: macro.stability,
          fiscalCapacity: macro.fiscalCapacity,
          assetShareBps: assetShares[entityId],
          debtShareBps: debtShares[entityId],
        })
      : {
          choice: "approve" as const,
          reason: "The source legislature enacted this exact settlement mandate.",
        };
    const _id = `1991-default:${settlementId}:${revision}:${entityId}`;
    const intended: FederationRatificationRecord = {
      _id,
      presetId: "1991-default",
      sourceEntityId: sourceCountryId,
      entityId,
      settlementId,
      revision,
      termsHash: proposal.termsHash,
      mode: macro ? "autonomous" : "legislative",
      choice: decision.choice,
      reason: decision.reason,
      decidedOnTurn: currentTurn,
      ...(macro ? {} : { billId: proposal.billId }),
    };
    await records.updateOne({ _id }, { $setOnInsert: intended }, { upsert: true });
    const record = await records.findOne({ _id });
    if (
      !record ||
      record.termsHash !== proposal.termsHash ||
      record.sourceEntityId !== sourceCountryId ||
      record.entityId !== entityId ||
      record.mode !== intended.mode
    )
      throw new Error("Federation ratification conflicts with an earlier decision");
    saved.push(record);
  }
  return saved;
}
