import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { ApiError, badRequest, notFound } from "@/lib/api/errors";
import { assertSameCountry } from "@/lib/api/sameCountry";
import {
  campaignAnchorToLocal,
  loadCampaignCurrencyRates,
  loadCampaignPriceLevel,
} from "@/lib/campaigns/campaignCurrency";
import {
  assertCampaignManagerOrNominee,
  getCampaignOrThrow,
  getCurrentTurn,
} from "@/lib/campaigns/commands/campaignManagementCommands";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type {
  Campaign,
  CampaignFieldOffice,
  Character,
  Election,
  PoliticalParty,
  State,
} from "@/lib/db/types";
import { fieldOfficeYield } from "./effects";
import { loadLiveStateLean } from "./liveLean";
import {
  getFieldOfficeCap,
  getFieldOfficeCostAnchor,
  getFieldOfficeRules,
  type FieldOfficeScopeRules,
} from "./rules";
import { loadFieldOfficeRegionMap } from "./subdivisions";

export const FIELD_OFFICES_COLLECTION = "campaignFieldOffices";

type Actor = AuthUserWithCharacter & { hasCharacter: true; character: Character };

/**
 * Regions a campaign may organise in. A race tied to one region (a Senate
 * seat, a UK regional Commons slate, a JP bloc) organises there only; a
 * national race (president, or any race whose `state` is not a region of the
 * country) may organise anywhere in the country.
 */
export async function loadFieldOfficeRegions(
  db: Db,
  election: Pick<Election, "countryId" | "electionType" | "state">
): Promise<Pick<State, "_id" | "name">[]> {
  // Leaf regions only: UK regions carry a parent (ENG, GBN) that is not
  // itself an election region, so filter out parents rather than children.
  const all = await db
    .collection<State>("states")
    .find({ countryId: election.countryId }, { projection: { _id: 1, name: 1, parentRegionId: 1 } })
    .sort({ name: 1 })
    .toArray();
  const parents = new Set(all.map((r) => r.parentRegionId).filter(Boolean));
  const regions = all.filter((r) => !parents.has(r._id)).map((r) => ({ _id: r._id, name: r.name }));
  if (election.electionType === "president") return regions;
  const own = regions.filter((r) => r._id === election.state);
  return own.length > 0 ? own : regions;
}

/** Party orientation for yield: +1 right, -1 left, 0 centre or unknown. */
export async function loadCampaignOrientation(
  db: Db,
  campaign: Pick<Campaign, "party">,
  countryId: string
): Promise<number> {
  const seq = Number(campaign.party);
  if (!Number.isFinite(seq) || seq <= 0) return 0;
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { sequentialId: seq, countryId: countryId as PoliticalParty["countryId"] },
      { projection: { economicPosition: 1 } }
    );
  return Math.sign(party?.economicPosition ?? 0);
}

async function loadContext(db: Db, campaignId: ObjectId, user: Actor) {
  const campaign = await getCampaignOrThrow(db, campaignId);
  await assertCampaignManagerOrNominee(db, campaign, user);
  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  if (!election) throw notFound("Election not found");
  if (!user.isAdmin) {
    assertSameCountry(user.character, election, {
      message: "You cannot organise in another country's race",
    });
  }
  const rules = getFieldOfficeRules(election.countryId);
  if (!rules) throw badRequest("Field offices are not available in this country");
  return { campaign, election, rules };
}

export interface OpenFieldOfficeResult {
  office: CampaignFieldOffice;
  funds: number;
  actions: number;
}

export async function openFieldOffice(params: {
  db: Db;
  campaignId: ObjectId;
  user: Actor;
  regionId: string;
  subdivisionId?: string | null;
}): Promise<OpenFieldOfficeResult> {
  const { db, campaignId, user } = params;
  const { campaign, election, rules } = await loadContext(db, campaignId, user);
  if (election.status !== "active") {
    throw badRequest("Field offices can only open while the race is running");
  }

  const regionId = params.regionId.toUpperCase();
  const regions = await loadFieldOfficeRegions(db, election);
  const region = regions.find((r) => r._id === regionId);
  if (!region) throw badRequest("This race does not run in that region");

  const placement = await resolvePlacement(db, {
    rules,
    campaign,
    countryId: election.countryId,
    regionId,
    regionName: region.name,
    subdivisionId: params.subdivisionId ?? null,
  });

  const offices = db.collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION);
  const inRegion = await offices.countDocuments({ campaignId, regionId });
  if (inRegion >= rules.maxPerRegion) {
    throw badRequest(`At most ${rules.maxPerRegion} offices per region`);
  }

  const cap = getFieldOfficeCap(election.electionType);
  const cost = getFieldOfficeCostAnchor(rules, election.electionType);
  const [rates, priceLevel, preset, turn] = await Promise.all([
    loadCampaignCurrencyRates(db),
    loadCampaignPriceLevel(db),
    getGameStatePresetOrDefault(db),
    getCurrentTurn(db),
  ]);
  const openLocal = campaignAnchorToLocal(
    cost.open * priceLevel,
    election.countryId,
    rates,
    preset
  );
  if (campaign.funds < openLocal) throw badRequest("Insufficient funds");
  if (campaign.actions < cost.actions) throw badRequest("Insufficient actions");

  // Guarded charge: affordability and the office cap are checked in the same
  // write, so two concurrent opens cannot both slip under the cap.
  const charged = await db.collection<Campaign>("campaigns").findOneAndUpdate(
    {
      _id: campaignId,
      funds: { $gte: openLocal },
      actions: { $gte: cost.actions },
      $or: [{ fieldOfficeCount: { $lt: cap } }, { fieldOfficeCount: { $exists: false } }],
    },
    {
      $inc: {
        funds: -openLocal,
        actions: -cost.actions,
        totalFundsSpent: openLocal,
        totalActionsSpent: cost.actions,
        spendThisTurn: openLocal,
        fieldOfficeCount: 1,
      },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after", projection: { funds: 1, actions: 1, fieldOfficeCount: 1 } }
  );
  if (!charged) {
    const fresh = await db
      .collection<Campaign>("campaigns")
      .findOne({ _id: campaignId }, { projection: { fieldOfficeCount: 1 } });
    if ((fresh?.fieldOfficeCount ?? 0) >= cap) {
      throw badRequest(`This race allows at most ${cap} field offices`);
    }
    throw new ApiError(409, "Campaign resources changed. Please refresh and try again.");
  }

  const office: CampaignFieldOffice = {
    _id: new ObjectId(),
    campaignId,
    electionId: campaign.electionId,
    candidateId: campaign.candidateId,
    countryId: election.countryId,
    regionId,
    subdivisionId: placement.subdivisionId,
    label: placement.label,
    electorateShare: placement.electorateShare,
    yieldFactor: placement.yieldFactor,
    openedTurn: turn,
    openCostLocal: openLocal,
    openedByCharacterId: user.character._id,
    createdAt: new Date(),
  };
  try {
    await offices.insertOne(office);
  } catch (err) {
    // Unique (campaignId, regionId, subdivisionId) for county scope: a
    // concurrent open of the same county lost the race. Refund it.
    await db.collection<Campaign>("campaigns").updateOne(
      { _id: campaignId },
      {
        $inc: {
          funds: openLocal,
          actions: cost.actions,
          totalFundsSpent: -openLocal,
          totalActionsSpent: -cost.actions,
          spendThisTurn: -openLocal,
          fieldOfficeCount: -1,
        },
      }
    );
    if ((err as { code?: number }).code === 11000) {
      throw badRequest("You already have an office there");
    }
    throw err;
  }

  return { office, funds: charged.funds, actions: charged.actions };
}

async function resolvePlacement(
  db: Db,
  args: {
    rules: FieldOfficeScopeRules;
    campaign: Campaign;
    countryId: string;
    regionId: string;
    regionName: string;
    subdivisionId: string | null;
  }
): Promise<{
  subdivisionId: string | null;
  label: string;
  electorateShare: number;
  yieldFactor: number;
}> {
  if (args.rules.scope === "region") {
    return { subdivisionId: null, label: args.regionName, electorateShare: 0, yieldFactor: 1 };
  }
  if (!args.subdivisionId) throw badRequest("Pick a county for the office");
  const [live, preset] = await Promise.all([
    loadLiveStateLean(db, args.countryId),
    getGameStatePresetOrDefault(db),
  ]);
  const map = await loadFieldOfficeRegionMap(args.rules.scope, args.regionId, live, preset);
  const sub = map?.subdivisions.find((s) => s.id === args.subdivisionId);
  if (!map || !sub) throw badRequest("That county is not in this state");
  const orientation = await loadCampaignOrientation(db, args.campaign, args.countryId);
  return {
    subdivisionId: sub.id,
    label: sub.name,
    electorateShare: sub.electorateShare,
    yieldFactor: fieldOfficeYield(orientation, sub.livePvi - map.regionLivePvi),
  };
}

export async function closeFieldOffice(params: {
  db: Db;
  campaignId: ObjectId;
  officeId: ObjectId;
  user: Actor;
}): Promise<{ closed: boolean }> {
  const { db, campaignId, officeId, user } = params;
  await loadContext(db, campaignId, user);
  const res = await db
    .collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION)
    .deleteOne({ _id: officeId, campaignId });
  if (res.deletedCount === 0) throw notFound("Field office not found");
  await db
    .collection<Campaign>("campaigns")
    .updateOne(
      { _id: campaignId, fieldOfficeCount: { $gt: 0 } },
      { $inc: { fieldOfficeCount: -1 } }
    );
  return { closed: true };
}
