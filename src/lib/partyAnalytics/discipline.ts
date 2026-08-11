import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Caucus, CaucusMembership, NPP, NPPRelationship, Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP } from "@/lib/constants/partyOrg";
import { COUNTRY_CONFIGS, getOfficeTypeConfig } from "@/lib/constants/countries";
import { buildWhipDefianceSnapshot } from "@/lib/partyWhips/whipDefiance";
import type {
  PartyAnalyticsCaucusRiskItem,
  PartyAnalyticsDisciplineSection,
  PartyAnalyticsRiskItem,
} from "./types";

const LOW_LOYALTY_THRESHOLD = 40;
const WHIP_BREAKER_STUBBORNNESS = 70;
const CAUTION_LOYALTY_THRESHOLD = 50;
const CAUTION_STUBBORNNESS = 60;
const CAUCUS_WARNING_BUFFER = 10;

function getRiskLabel(riskScore: number): "Critical" | "Elevated" | "Watch" {
  if (riskScore >= 60) return "Critical";
  if (riskScore >= 45) return "Elevated";
  return "Watch";
}

function getCaucusExitRiskLabel(relationshipWithChair: number): "Critical" | "Elevated" | "Watch" {
  if (relationshipWithChair < CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP) return "Critical";
  if (relationshipWithChair < CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP + 5) return "Elevated";
  return "Watch";
}

function buildNppHref(countryId: CountryId, nppId: ObjectId): string {
  void countryId;
  return `/politicians/npp/${nppId.toString()}`;
}

function formatCurrentOfficeLabel(
  npp: Pick<NPP, "currentOffice">,
  countryId: CountryId
): string | null {
  const officeType = npp.currentOffice?.type;
  if (!officeType) return null;
  return getOfficeTypeConfig(countryId, officeType)?.label ?? officeType;
}

function toRiskItem(countryId: CountryId, npp: NPP): PartyAnalyticsRiskItem {
  const loyalty = npp.personality?.loyalty ?? 0;
  const stubbornness = npp.personality?.stubbornness ?? 0;
  const ambition = npp.personality?.ambition ?? 0;
  const riskScore = Math.round(((100 - loyalty) * 0.65 + stubbornness * 0.35) * 10) / 10;
  return {
    id: npp._id.toString(),
    name: npp.name,
    homeState: npp.homeState,
    currentOffice: formatCurrentOfficeLabel(npp, countryId),
    loyalty,
    stubbornness,
    ambition,
    riskScore,
    riskLabel: getRiskLabel(riskScore),
    href: buildNppHref(countryId, npp._id),
  };
}

export async function buildPartyDisciplineAnalytics(
  db: Db,
  countryId: CountryId,
  partyId: string,
  stateId?: string
): Promise<PartyAnalyticsDisciplineSection> {
  if (!COUNTRY_CONFIGS[countryId]) {
    return {
      lowLoyaltyCount: 0,
      likelyWhipBreakers: 0,
      cautionCount: 0,
      caucusRiskCount: 0,
      criticalRiskCount: 0,
      elevatedRiskCount: 0,
      activeDefianceCount: 0,
      playerDefianceCount: 0,
      nppDefianceCount: 0,
      disciplineWatch: [],
      highStubbornness: [],
      caucusRisk: [],
    };
  }

  const npps = await db
    .collection<NPP>("npps")
    .find({
      countryId,
      party: partyId,
      retiredAt: null,
      ...(stateId ? { homeState: stateId } : {}),
    })
    .toArray();

  const riskItems = npps.map((npp) => toRiskItem(countryId, npp));

  const caucuses = await db
    .collection<Caucus>("caucuses")
    .find({ countryId, partyId, disbandedAt: null })
    .toArray();
  const activeChairIds = caucuses
    .map((caucus) => caucus.chairId)
    .filter((chairId): chairId is ObjectId => chairId instanceof ObjectId);
  const caucusIds = caucuses.map((caucus) => caucus._id);

  const memberships =
    caucusIds.length === 0
      ? ([] as CaucusMembership[])
      : await db
          .collection<CaucusMembership>("caucusMemberships")
          .find({
            caucusId: { $in: caucusIds },
            memberType: "npp",
            status: "active",
          })
          .toArray();

  const [relationships, chairs, defianceSnapshot] = await Promise.all([
    activeChairIds.length === 0 || memberships.length === 0
      ? Promise.resolve([] as NPPRelationship[])
      : db
          .collection<NPPRelationship>("nppRelationships")
          .find({
            characterId: { $in: activeChairIds },
            nppId: { $in: memberships.map((membership) => membership.memberId) },
          })
          .toArray(),
    caucusIds.length === 0
      ? Promise.resolve([] as Character[])
      : db
          .collection<Character>("characters")
          .find({ _id: { $in: activeChairIds } })
          .project<Pick<Character, "_id" | "name">>({ _id: 1, name: 1 })
          .toArray(),
    buildWhipDefianceSnapshot(
      db,
      stateId
        ? {
            countryId,
            partyId,
            issuedBy: "stateParty",
            stateId,
          }
        : {
            countryId,
            partyId,
            issuedBy: "nationalParty",
          }
    ),
  ]);

  const caucusById = new Map(caucuses.map((caucus) => [caucus._id.toString(), caucus]));
  const nppById = new Map(npps.map((npp) => [npp._id.toString(), npp]));
  const relationshipByPair = new Map(
    relationships.map((relationship) => [
      `${relationship.characterId.toString()}:${relationship.nppId.toString()}`,
      relationship.relationshipScore,
    ])
  );
  const chairNameById = new Map(chairs.map((chair) => [chair._id.toString(), chair.name]));

  const caucusRisk: PartyAnalyticsCaucusRiskItem[] = memberships
    .map((membership) => {
      const caucus = caucusById.get(membership.caucusId.toString());
      const npp = nppById.get(membership.memberId.toString());
      const chairId = caucus?.chairId?.toString() ?? null;
      if (!caucus || !npp || !chairId) return null;
      const relationshipWithChair =
        relationshipByPair.get(`${chairId}:${membership.memberId.toString()}`) ?? 0;
      return {
        caucusId: caucus._id.toString(),
        caucusName: caucus.name,
        nppId: npp._id.toString(),
        nppName: npp.name,
        relationshipWithChair,
        gapFromExit:
          Math.round((relationshipWithChair - CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP) * 10) / 10,
        exitRiskLabel: getCaucusExitRiskLabel(relationshipWithChair),
        chairName: chairNameById.get(chairId) ?? null,
        href: buildNppHref(countryId, npp._id),
      } satisfies PartyAnalyticsCaucusRiskItem;
    })
    .filter((item): item is PartyAnalyticsCaucusRiskItem => item !== null)
    .sort(
      (a, b) => a.gapFromExit - b.gapFromExit || a.relationshipWithChair - b.relationshipWithChair
    );

  return {
    lowLoyaltyCount: riskItems.filter((item) => item.loyalty < LOW_LOYALTY_THRESHOLD).length,
    likelyWhipBreakers: riskItems.filter(
      (item) =>
        item.loyalty < LOW_LOYALTY_THRESHOLD || item.stubbornness > WHIP_BREAKER_STUBBORNNESS
    ).length,
    cautionCount: riskItems.filter(
      (item) => item.loyalty < CAUTION_LOYALTY_THRESHOLD || item.stubbornness > CAUTION_STUBBORNNESS
    ).length,
    caucusRiskCount: caucusRisk.filter(
      (item) =>
        item.relationshipWithChair < CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP + CAUCUS_WARNING_BUFFER
    ).length,
    criticalRiskCount: riskItems.filter((item) => item.riskLabel === "Critical").length,
    elevatedRiskCount: riskItems.filter((item) => item.riskLabel === "Elevated").length,
    activeDefianceCount: defianceSnapshot.activeCount,
    playerDefianceCount: defianceSnapshot.playerCount,
    nppDefianceCount: defianceSnapshot.nppCount,
    disciplineWatch: [...riskItems]
      .sort((a, b) => a.loyalty - b.loyalty || b.stubbornness - a.stubbornness)
      .slice(0, 6),
    highStubbornness: [...riskItems].sort((a, b) => b.stubbornness - a.stubbornness).slice(0, 6),
    caucusRisk: caucusRisk.slice(0, 6),
  };
}
