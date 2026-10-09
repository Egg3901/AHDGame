import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import {
  campaignAnchorToLocal,
  loadCampaignCurrencyRates,
  loadCampaignPriceLevel,
} from "@/lib/campaigns/campaignCurrency";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type { Campaign, CampaignFieldOffice, Election } from "@/lib/db/types";
import { FIELD_OFFICES_COLLECTION } from "./commands";
import { getFieldOfficeCostAnchor, getFieldOfficeRules } from "./rules";

export interface FieldOfficeUpkeepResult {
  campaignsCharged: number;
  officesClosedInsolvent: number;
  officesSwept: number;
}

/**
 * Per-turn field-office upkeep. Runs right after the campaign turn so this
 * turn's income is already in the treasury.
 *
 * - Offices whose campaign is gone, archived, or whose race is no longer
 *   active are swept. Campaign deletion happens in half a dozen resolution
 *   paths; sweeping here keeps every one of them correct without touching
 *   them.
 * - A campaign that cannot pay closes its newest offices first (the ones that
 *   have done the least work) until the rest are affordable.
 * - `fieldOfficeCount` is rewritten from the surviving rows, so any drift from
 *   a crashed open/close heals within a turn.
 */
export async function processFieldOfficeUpkeep(db: Db): Promise<FieldOfficeUpkeepResult> {
  const result: FieldOfficeUpkeepResult = {
    campaignsCharged: 0,
    officesClosedInsolvent: 0,
    officesSwept: 0,
  };
  const officesCol = db.collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION);
  const offices = await officesCol
    .find({}, { projection: { campaignId: 1, electionId: 1, openedTurn: 1, createdAt: 1 } })
    .toArray();
  if (offices.length === 0) return result;

  const campaignIds = [
    ...new Map(offices.map((o) => [o.campaignId.toString(), o.campaignId])).values(),
  ];
  const electionIds = [
    ...new Map(offices.map((o) => [o.electionId.toString(), o.electionId])).values(),
  ];
  const [campaigns, elections, rates, priceLevel, preset] = await Promise.all([
    db
      .collection<Campaign>("campaigns")
      .find({ _id: { $in: campaignIds } }, { projection: { funds: 1, status: 1 } })
      .toArray(),
    db
      .collection<Election>("elections")
      .find(
        { _id: { $in: electionIds } },
        { projection: { status: 1, countryId: 1, electionType: 1 } }
      )
      .toArray(),
    loadCampaignCurrencyRates(db),
    loadCampaignPriceLevel(db),
    getGameStatePresetOrDefault(db),
  ]);
  const campaignById = new Map(campaigns.map((c) => [c._id.toString(), c]));
  const electionById = new Map(elections.map((e) => [e._id.toString(), e]));

  const sweep: ObjectId[] = [];
  const byCampaign = new Map<string, CampaignFieldOffice[]>();
  for (const office of offices) {
    const campaign = campaignById.get(office.campaignId.toString());
    const election = electionById.get(office.electionId.toString());
    if (!campaign || campaign.status === "archived" || election?.status !== "active") {
      sweep.push(office._id);
      continue;
    }
    const list = byCampaign.get(office.campaignId.toString());
    if (list) list.push(office);
    else byCampaign.set(office.campaignId.toString(), [office]);
  }
  if (sweep.length > 0) {
    const res = await officesCol.deleteMany({ _id: { $in: sweep } });
    result.officesSwept = res.deletedCount;
  }

  const close: ObjectId[] = [];
  const campaignOps: AnyBulkWriteOperation<Campaign>[] = [];
  for (const [campaignKey, list] of byCampaign) {
    const campaign = campaignById.get(campaignKey)!;
    const election = electionById.get(list[0].electionId.toString())!;
    const rules = getFieldOfficeRules(election.countryId);
    if (!rules) {
      close.push(...list.map((o) => o._id));
      campaignOps.push({
        updateOne: { filter: { _id: campaign._id }, update: { $set: { fieldOfficeCount: 0 } } },
      });
      continue;
    }
    const perOffice = campaignAnchorToLocal(
      getFieldOfficeCostAnchor(rules, election.electionType).upkeep * priceLevel,
      election.countryId,
      rates,
      preset
    );
    // Oldest first, so trimming from the end drops the newest.
    list.sort((a, b) => a.openedTurn - b.openedTurn || +a.createdAt - +b.createdAt);
    let keep = list.length;
    const funds = Math.max(0, campaign.funds ?? 0);
    while (keep > 0 && keep * perOffice > funds) keep--;
    for (const office of list.slice(keep)) close.push(office._id);
    result.officesClosedInsolvent += list.length - keep;

    const charge = keep * perOffice;
    campaignOps.push({
      updateOne: {
        filter: { _id: campaign._id },
        update: {
          $inc: { funds: -charge, totalFundsSpent: charge, spendThisTurn: charge },
          $set: { fieldOfficeCount: keep },
        },
      },
    });
    if (charge > 0) result.campaignsCharged++;
  }

  if (close.length > 0) await officesCol.deleteMany({ _id: { $in: close } });
  if (campaignOps.length > 0) {
    await db.collection<Campaign>("campaigns").bulkWrite(campaignOps, { ordered: false });
  }
  return result;
}
