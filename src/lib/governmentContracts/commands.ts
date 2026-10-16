/**
 * Governments publish tenders and choose corporate bids after bidding closes.
 * Publishing holds budget or capacity; award and cancellation preserve the existing contracts' accounting.
 */
import { automatedDefenceBids } from "./automatedBids";
import { requireCeo } from "@/lib/api/corporations/resolveQuery";
import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { z } from "zod";
import type { Corporation, ExtractionContract } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { tenderAwardInterest, discloseExtractionAward } from "./selfDealing";
import { defenceContractLotCaps } from "@/lib/military/defenceContractLimits";
import { defenceContractWindow } from "@/lib/military/defenceContractLimits";
import { isProcurementBlocked } from "@/lib/military/procurementGate";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { lotPrice } from "@/lib/military/arsenal";
import { DEFENCE_STRATEGY_COMPONENT } from "@/lib/military/arsenalComponents";
import { lotProductionCost, lotPriceBand } from "@/lib/military/defenceLotEconomics";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { loadContractIssuanceSettings } from "@/lib/extraction/featureFlag";
import { computeContractedShare } from "@/lib/extraction/computeContractedShare";
import { GOVT_CONTRACT_MAX_TOTAL_SHARE } from "@/lib/constants/prospecting";
import { settleTenderSigningFee } from "./signingFee";
import { createNotifications } from "@/lib/notifications";
import { managementAuthority } from "./authority";
import { tenders } from "./persistence";
import { reserveDefenceTender, expireGovernmentTenders } from "./reservations";
import {
  canBid,
  tenderTab,
  canAward,
  validDeadlines,
  tenderReservationValue,
  validContractCopy,
} from "./rules";
import { validateBid, ContractError } from "./eligibility";
import { activateDefenceBid } from "./defence";
import type { publishTenderSchema, bidSchema } from "./schemas";
import type { GovernmentTender, ContractBid } from "./types";

export async function publishTender(
  db: Db,
  countryId: CountryId,
  input: z.infer<typeof publishTenderSchema>,
  user: AuthUserWithCharacter,
  turn: number,
  now: Date
): Promise<string> {
  const level = await managementAuthority(db, countryId, input.terms, user);
  if (!level)
    throw new ContractError("You do not hold the authority to publish this contract.", 403);
  if (!validContractCopy(input.title + input.description))
    throw new ContractError("Use plain hyphens in contract text.", 400);
  let defenseLine = 0;
  const window =
    input.terms.type === "defence" ? defenceContractWindow(countryId, turn) : undefined;
  if (!validDeadlines(turn, input.closesTurn, input.awardDeadlineTurn, window?.endTurn))
    throw new ContractError(
      "Bidding must close after this turn, with a later award deadline within 24 turns of publishing. Defence awards must also fit the current contracting window.",
      400
    );
  if (input.terms.type === "defence") {
    const gate = await isProcurementBlocked(db, countryId, turn);
    if (gate.blocked) throw new ContractError(gate.reason ?? "Procurement is paused.");
    const state = await getGameState(db);
    if (input.terms.grade > maxTechTierForPreset(state?.preset ?? DEFAULT_SEED_PRESET))
      throw new ContractError("This equipment grade is not available in the current world.", 400);
    const budget = await ensureFederalBudget(db, countryId, state?.preset ?? DEFAULT_SEED_PRESET);
    if (!budget) throw new ContractError("No national budget is available.");
    const anchor = lotPrice(
      countryId,
      militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp)
    );
    if (anchor == null || !Number.isFinite(anchor) || !(anchor > 0))
      throw new ContractError("Defence lot prices are unavailable for this national budget.");
    const ratios = await loadDefencePriceRatios(db);
    let minimumPrice = Infinity;
    for (const [strategy, components] of Object.entries(DEFENCE_STRATEGY_COMPONENT)) {
      if (!components.includes(input.terms.component)) continue;
      const cost = lotProductionCost(strategy, anchor, ratios);
      const band =
        cost == null
          ? null
          : lotPriceBand({ anchorPrice: anchor, productionCost: cost, grade: input.terms.grade });
      if (band && Number.isFinite(band.floor) && band.floor > 0)
        minimumPrice = Math.min(minimumPrice, band.floor);
    }
    if (!Number.isFinite(minimumPrice))
      throw new ContractError(
        "No usable defence lot prices are available for this component and grade."
      );
    if (input.terms.maximumPricePerLot < minimumPrice)
      throw new ContractError(
        `The maximum price per lot must be at least ${minimumPrice} in national budget units for this component and grade.`,
        400
      );
    defenseLine = resolveDefenseLineFrom(budget);
  } else {
    const config = await loadContractIssuanceSettings(db);
    if (!config.contractIssuanceEnabled)
      throw new ContractError("Extraction contract issuance is disabled.");
    const capacity = await db
      .collection("stateResourceCapacity")
      .findOne({ stateId: input.terms.stateId, countryId });
    if (!(capacity?.resources?.[input.terms.resource] > 0))
      throw new ContractError("This resource is not available in this country's selected state.");
  }
  const amount = tenderReservationValue(input.terms);
  if (amount == null) throw new ContractError("The contract value is too large.", 400);
  const t: GovernmentTender = {
    _id: new ObjectId().toHexString(),
    countryId,
    ...input,
    issuerLevel: level,
    ...(input.terms.type === "defence"
      ? { issuerPositionId: DEFENSE_POSITION_BY_COUNTRY[countryId] ?? undefined }
      : {}),
    publishedBy: user.character?._id.toHexString() ?? "admin",
    publishedTurn: turn,
    status: "publishing",
    bids: {},
    revision: 0,
    contractId: new ObjectId().toHexString(),
    allocationWindowId: window?.id,
    reservedAmount: amount,
    updatedAt: now,
  };
  await tenders(db).insertOne(t);
  try {
    if (t.terms.type === "defence") {
      if (!(await reserveDefenceTender(db, t, defenseLine)))
        throw new ContractError(
          "The uncommitted defence appropriation or quarterly allocation cannot cover this tender."
        );
    } else {
      const total = await computeContractedShare(db, t.terms.stateId, t.terms.resource, countryId);
      if (total > GOVT_CONTRACT_MAX_TOTAL_SHARE + 1e-9)
        throw new ContractError("This tender exceeds the 75% contracted capacity cap.");
    }
    const automated = await automatedDefenceBids(db, t);
    const opened = await tenders(db).updateOne(
      { _id: t._id, status: "publishing" },
      { $set: { status: "open", bids: automated, bidHistory: Object.values(automated) } }
    );
    if (!opened.modifiedCount)
      throw new ContractError("The tender was canceled or expired before publishing finished.");
    return t._id;
  } catch (error) {
    await tenders(db).updateOne(
      { _id: t._id, status: "publishing" },
      {
        $set: {
          status: "canceled",
          cancellationReason: "The tender could not reserve its requirements.",
        },
      }
    );
    await tenders(db).updateOne(
      { _id: t._id, status: "canceled" },
      { $unset: { reservationReleased: "" } }
    );
    await expireGovernmentTenders(db, turn);
    throw error;
  }
}
export async function submitBid(
  db: Db,
  t: GovernmentTender,
  input: z.infer<typeof bidSchema>,
  user: AuthUserWithCharacter,
  turn: number,
  now: Date
): Promise<void> {
  if (!canBid(t, turn)) throw new ContractError("Bidding is closed.");
  if (
    !input.withdraw &&
    t.terms.type === "extraction" &&
    !(await loadContractIssuanceSettings(db)).contractIssuanceEnabled
  )
    throw new ContractError("Extraction contract issuance is disabled.");
  const previous = t.bids[input.corporationId];
  const ownRevision = previous?.revision ?? 0;
  if (input.expectedRevision !== ownRevision)
    throw new ContractError("Your bid changed. Refresh before submitting again.");
  const proposed = {
    corporationId: input.corporationId,
    sectorId: input.withdraw ? previous?.sectorId : input.sectorId,
    amount: input.withdraw ? (previous?.amount ?? 0) : Math.round(input.amount),
    userId: user.userId,
  };
  const withdrawingCorp = input.withdraw
    ? await db
        .collection<Corporation>("corporations")
        .findOne({ _id: new ObjectId(input.corporationId) })
    : null;
  if (input.withdraw && (!withdrawingCorp || requireCeo(withdrawingCorp, user.userId)))
    throw new ContractError("Only the CEO may withdraw this bid.", 403);
  const validated =
    input.withdraw && withdrawingCorp
      ? { corp: withdrawingCorp }
      : await validateBid(db, t, proposed, turn, user);
  if (input.withdraw && !previous) throw new ContractError("There is no bid to withdraw.");
  const bid: ContractBid = {
    ...proposed,
    corporationName: validated.corp.name,
    submittedTurn: turn,
    revision: ownRevision + 1,
    withdrawn: input.withdraw === true,
  };
  const path = `bids.${input.corporationId}`;
  const result = await tenders(db).updateOne(
    {
      _id: t._id,
      status: "open",
      closesTurn: { $gt: turn },
      ...(previous ? { [`${path}.revision`]: ownRevision } : { [path]: { $exists: false } }),
    },
    { $set: { [path]: bid, updatedAt: now }, $inc: { revision: 1 }, $push: { bidHistory: bid } }
  );
  if (!result.modifiedCount)
    throw new ContractError("Bidding closed or your bid changed. Refresh and try again.");
}
export async function cancelTender(
  db: Db,
  t: GovernmentTender,
  reason: string,
  user: AuthUserWithCharacter,
  turn: number
) {
  if (!(await managementAuthority(db, t.countryId, t.terms, user, t.issuerLevel)))
    throw new ContractError("You cannot cancel this tender.", 403);
  if (!validContractCopy(reason))
    throw new ContractError("Use plain hyphens in contract text.", 400);
  if (tenderTab(t, turn) === "canceled") {
    await expireGovernmentTenders(db, turn);
    return;
  }
  const result = await tenders(db).updateOne(
    { _id: t._id, status: { $in: ["open", "publishing"] } },
    { $set: { status: "canceled", cancellationReason: reason } }
  );
  if (!result.matchedCount)
    throw new ContractError(
      "An award is already in progress or complete. Use the awarded contract's termination controls."
    );
  await expireGovernmentTenders(db, turn);
}
export async function awardTender(
  db: Db,
  t: GovernmentTender,
  corporationId: string,
  reason: string,
  user: AuthUserWithCharacter,
  turn: number,
  now: Date,
  acknowledgeConflict = false
) {
  const leaseKey = new ObjectId().toHexString();
  const lock = await tenders(db).findOneAndUpdate(
    {
      _id: t._id,
      $or: [{ awardLeaseUntil: { $exists: false } }, { awardLeaseUntil: { $lte: now } }],
    },
    {
      $set: { awardLeaseKey: leaseKey, awardLeaseUntil: new Date(now.getTime() + 120000) },
      $inc: { awardLeaseRevision: 1 },
    },
    { returnDocument: "after" }
  );
  if (!lock)
    throw new ContractError("An award is already being processed. Refresh before retrying.");
  try {
    return await awardLocked(db, lock, corporationId, reason, user, turn, now, acknowledgeConflict);
  } finally {
    await tenders(db).updateOne(
      { _id: t._id, awardLeaseKey: leaseKey },
      { $unset: { awardLeaseKey: "", awardLeaseUntil: "" } }
    );
  }
}
async function awardLocked(
  db: Db,
  t: GovernmentTender,
  corporationId: string,
  reason: string,
  user: AuthUserWithCharacter,
  turn: number,
  now: Date,
  acknowledgeConflict: boolean
) {
  if (!(await managementAuthority(db, t.countryId, t.terms, user, t.issuerLevel)))
    throw new ContractError("You cannot award this tender.", 403);
  if (t.status === "awarded") {
    if (t.winningCorporationId !== corporationId)
      throw new ContractError("This tender has already been awarded to another bidder.");
    return t.contractId;
  }
  if (!validContractCopy(reason))
    throw new ContractError("Use plain hyphens in contract text.", 400);
  if (!canAward(t, turn) && t.status !== "awarding")
    throw new ContractError("The tender is not in its award window.");
  if (t.status === "awarding" && t.winningCorporationId !== corporationId)
    throw new ContractError("Another bid has already been selected. Resume that award.");
  const bid = t.bids[corporationId];
  if (!bid || bid.withdrawn) throw new ContractError("Select a current bid.");
  if (t.status !== "awarding") {
    if (
      t.terms.type === "extraction" &&
      !(await loadContractIssuanceSettings(db)).contractIssuanceEnabled
    )
      throw new ContractError("Extraction contract issuance is disabled.");
    const validation = await validateBid(db, t, bid, turn);
    const awardSelfDealing = tenderAwardInterest(
      t,
      validation.corp,
      user,
      bid.amount,
      defenceContractLotCaps(resolveDefenseLineFrom(validation.budget), 1).procurementNotional
    );
    if (awardSelfDealing && !acknowledgeConflict)
      throw new ContractError(
        `You own or hold a significant stake in this corporation. This award will be publicly disclosed and cost ${awardSelfDealing.favorabilityPenalty} favorability. Acknowledge the conflict before awarding.`,
        409
      );
    const awardAttemptId = new ObjectId().toHexString();
    const claim = await tenders(db).updateOne(
      {
        _id: t._id,
        status: "open",
        revision: t.revision,
        closesTurn: { $lte: turn },
        awardDeadlineTurn: { $gt: turn },
      },
      {
        $set: {
          status: "awarding",
          winningCorporationId: corporationId,
          awardSelfDealing,
          awardAttemptId,
          awardReason: reason,
          awardedBy: user.character?._id.toHexString() ?? "admin",
          awardedTurn: turn,
          updatedAt: now,
        },
      }
    );
    if (!claim.modifiedCount)
      throw new ContractError("The tender changed. Refresh before awarding.");
    t = {
      ...t,
      awardAttemptId,
      status: "awarding",
      winningCorporationId: corporationId,
      awardSelfDealing,
      awardReason: reason,
      awardedBy: user.character?._id.toHexString() ?? "admin",
      awardedTurn: turn,
    };
  }
  if (t.terms.type === "defence") {
    await activateDefenceBid(db, t, bid, user, turn, now);
  } else {
    const settings = await loadContractIssuanceSettings(db);
    const col = db.collection<ExtractionContract>("extractionContracts");
    let contract = await col.findOne({ _id: new ObjectId(t.contractId) });
    if (!settings.contractIssuanceEnabled && !contract)
      throw new ContractError("Extraction contract issuance is disabled.");
    if (!contract) {
      await validateBid(db, t, bid, turn);
      const created: ExtractionContract = {
        _id: new ObjectId(t.contractId),
        tenderId: t._id,
        countryId: t.countryId,
        corporationId: new ObjectId(bid.corporationId),
        stateId: t.terms.stateId,
        resource: t.terms.resource,
        share: t.terms.share,
        grantedBy: t.issuerLevel === "national" ? t.countryId : t.terms.stateId,
        grantedByLevel: t.issuerLevel,
        grantedTurn: t.awardedTurn ?? turn,
        status: "offered",
        signingFeeAnchor: bid.amount,
        royaltyRatePerTurn: t.terms.royaltyRatePerTurn,
        termTurns: t.terms.termTurns,
        signingFeeAttemptKey: t.awardAttemptId,
        updatedAt: now,
      };
      try {
        await col.insertOne(created);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
      }
      contract = await col.findOne({ _id: created._id });
    }
    if (!contract) throw new ContractError("The award could not be prepared.", 500);
    if (contract.signingFeeAttemptKey !== t.awardAttemptId)
      throw new ContractError(
        "A different award attempt owns this payment. Refresh before retrying."
      );
    if (!contract.signingFeeSettled || contract.status !== "active") {
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: contract.corporationId });
      if (!corp) throw new ContractError("The selected corporation no longer exists.");
      const result = await settleTenderSigningFee(
        db,
        contract,
        corp,
        turn,
        now,
        settings.treasuryCashLedgerEnabled === true,
        settings.contractIssuanceEnabled === true
      );
      if (!result.ok) {
        const removed = await col.deleteOne({
          _id: contract._id,
          status: "offered",
          signingFeeAttemptKey: t.awardAttemptId,
          signingFeeSettled: { $ne: true },
        });
        const remaining = removed.deletedCount
          ? null
          : await col.findOne({ _id: contract._id }, { projection: { _id: 1 } });
        if (!remaining)
          await tenders(db).updateOne(
            { _id: t._id, status: "awarding", awardLeaseKey: t.awardLeaseKey },
            {
              $set: { status: "open" },
              $unset: {
                winningCorporationId: "",
                awardReason: "",
                awardedBy: "",
                awardedTurn: "",
                awardAttemptId: "",
                awardSelfDealing: "",
              },
            }
          );
        throw new ContractError(result.error ?? "The signing fee was refused.", 402);
      }
    }
  }
  await discloseExtractionAward(db, t);
  await tenders(db).updateOne(
    { _id: t._id, status: "awarding", winningCorporationId: corporationId },
    { $set: { status: "awarded", updatedAt: now } }
  );
  // At-most-once notification claim; financial work is complete independently.
  const notification = await tenders(db).updateOne(
    { _id: t._id, notificationSent: { $ne: true } },
    { $set: { notificationSent: true } }
  );
  if (notification.modifiedCount && !bid.system)
    await createNotifications([
      {
        userId: new ObjectId(bid.userId),
        type: "government_contract_awarded",
        title: "Government Contract Awarded",
        message: `${COUNTRY_CONFIGS[t.countryId].name} awarded your corporation ${t.title}. Your accepted bid is now a contract.`,
        metadata: {
          tenderId: t._id,
          contractId: t.contractId,
          countryId: t.countryId,
          corporationId: bid.corporationId,
          corporationName: bid.corporationName,
        },
      },
    ]);
  return t.contractId;
}
