import { ObjectId, type Db } from "mongodb";
import type { AuthUser } from "@/lib/auth";
import { getPartyMap } from "@/lib/db/partyMap";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type {
  Bill,
  BillStatus,
  Character,
  ElectedOfficial,
  LegislationType,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { formatEmbargoProvisionLabel } from "@/lib/legislature/embargoProvisionLabel";
import {
  axisRelevant,
  billToDetail,
  directionLabel,
  effectTargetLabelFromMetricId,
  resolveBillProvisions,
} from "@/lib/congress/billEnrichment";
import { buildBillWhipPanelData } from "@/lib/congress/billWhipPanelData";
import type { BillWhip } from "@/lib/db/types/billWhip";
import {
  buildScopedVoteInputs,
  buildVotesByParty,
  type ScopedVoteOfficial,
} from "@/lib/congress/billVoting";
import { snapshotWeightMap } from "@/lib/legislature/voteSnapshot";
import {
  buildChamberSeatMap,
  buildOverrideDisplay,
  type OverrideChamberDisplay,
} from "@/lib/congress/vetoOverrideTally";
import { resolveBillCountryId } from "@/lib/congress/resolveBillCountryId";
import type { BillDetail } from "@/lib/legislature/dto/billDetail";
import type { BillDisplay, BillsResponse } from "@/lib/legislature/dto/billDisplay";
import {
  getBillProposalAutoFailWarning,
  type BillProposalAutoFailWarning,
  type BillProposalOriginChamber,
} from "@/lib/legislature/billAutoFailWarning";
import {
  canonicalizeLegislationTypeId,
  getLegislationTypeById,
  humanizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";
import { getPartyHex, formatBillPositionLabel } from "@/lib/utils/politics";
import {
  billRequiresExecutiveAction,
  getInternationalActionLabel,
  getInternationalActionSummary,
} from "@/lib/internationalOrganizations/withdrawalBills";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import {
  buildActiveNationalBillFilter,
  buildNationalBillCountryScopeFilter,
} from "@/lib/legislature/nationalBillScope";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

const BILL_PAGE_LIMIT = 50;

interface NationalBillListArgs {
  countryId: CountryId;
  chamber: string;
  page?: number;
  authUser: AuthUser | null;
}

export interface NationalLegislatureBillsPage extends BillsResponse {
  page: number;
  limit: number;
}

function formatCountryName(countryId?: CountryId): string {
  if (!countryId) return "selected country";
  return COUNTRY_CONFIGS[countryId]?.name ?? countryId;
}

function formatSectorTypeLabel(sectorType?: string): string {
  if (!sectorType) return "selected sector";
  return sectorType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveVoteOfficeType(
  countryId: CountryId,
  chamberKey: string | undefined,
  lowerKey: string
): string | null {
  if (!chamberKey || chamberKey === "cabinet") return null;
  return getOfficeTypeForChamber(countryId, chamberKey === "joint" ? lowerKey : chamberKey);
}

function resolvePrimaryVoteChamberKey(bill: Bill, lowerKey: string): string | undefined {
  if (bill.status === "cabinet_review") return undefined;
  if (bill.status === "override_shugiin") return bill.currentChamber;
  if (bill.originChamber === "cabinet") return lowerKey;
  return bill.originChamber;
}

function describeTariffProvision(
  provision: Extract<Bill["provisions"], unknown[]>[number] & {
    type: "tariff";
  }
): string {
  const rateLabel = `${provision.rate}% tariff`;
  switch (provision.scopeType) {
    case "economy_wide":
      return `${rateLabel} on all imports`;
    case "sector":
      return `${rateLabel} on ${formatSectorTypeLabel(provision.targetSectorType)} imports`;
    case "origin_country":
      return `${rateLabel} on imports from ${formatCountryName(provision.targetOriginCountryId)}`;
    case "corporation":
      return `${rateLabel} on a targeted corporation`;
    default:
      return rateLabel;
  }
}

function describeSubsidyProvision(
  provision: Extract<Bill["provisions"], unknown[]>[number] & {
    type: "subsidy" | "end_subsidy";
  }
): string {
  const scopeLabel =
    provision.scopeType === "economy_wide"
      ? "the whole economy"
      : `the ${formatSectorTypeLabel(provision.targetSectorType)} sector`;
  const strategyLabel = provision.targetStrategyId ? ` (${provision.targetStrategyId})` : "";
  if (provision.type === "end_subsidy") {
    return `End subsidies for ${scopeLabel}${strategyLabel}`;
  }
  return `Grant subsidies to ${scopeLabel}${strategyLabel}${provision.domesticOnly ? " (domestic only)" : ""}`;
}

export async function listNationalLegislatureBills(
  db: Db,
  { countryId, chamber, page = 1, authUser }: NationalBillListArgs
): Promise<NationalLegislatureBillsPage> {
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * BILL_PAGE_LIMIT;
  const isAdmin = authUser?.isAdmin === true;
  const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

  const billFilter: Record<string, unknown> = {
    ...buildNationalBillCountryScopeFilter(countryId),
    currentChamber: chamber,
  };

  // The bill list is already scoped to this country by
  // buildNationalBillCountryScopeFilter above. If the viewed country is not
  // enabled for this (non-admin) viewer, show nothing — but do NOT replace the
  // scope with `{ $in: enabledCountries }`, which pulled every enabled country's
  // bills (incl. the US) into e.g. Nigeria's House/Senate tabs (#912).
  if (enabledCountries && !enabledCountries.includes(countryId)) {
    billFilter.countryId = "__disabled__";
  }

  const [bills, total, parties, legislationTypesList, preset] = await Promise.all([
    db
      .collection<Bill>("bills")
      .find(billFilter)
      .project<Bill>({ votes: 0, otherChamberVotes: 0, fullText: 0 })
      .sort({ proposedAt: -1 })
      .skip(skip)
      .limit(BILL_PAGE_LIMIT)
      .toArray(),
    db.collection<Bill>("bills").countDocuments(billFilter),
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    db.collection<LegislationType>("legislationTypes").find({}).toArray(),
    getGameStatePreset(db),
  ]);
  const config = getCountryConfig(countryId, preset);
  const lowerKey = config.legislature.lowerChamber.key;
  const upperKeyForGet = config.legislature.upperChamber?.key;

  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
  const legislationTypeMap = new Map(legislationTypesList.map((lt) => [lt._id, lt]));

  let myCharacterId: string | null = null;
  let canPropose = false;
  let isMember = false;
  let isMemberOfViewedChamber = false;
  let adminOverride = false;
  let hasActiveBill = false;

  if (authUser) {
    const char = await getCharacterByUserId(db, authUser.userId);
    myCharacterId = char?._id?.toString() ?? null;
    if (myCharacterId) {
      // In a bill-active bicameral legislature (US/JP/NG) the upper chamber can
      // also originate bills, so its members count as proposers. UK Lords / DE
      // Bundesrat are `bicameral: false` and correctly excluded (#912 — NG
      // senators were treated as non-members and could not propose).
      // Era-aware: TR 1953 is unicameral (no Senato).
      const memberOfficeTypes =
        config.legislature.bicameral && upperKeyForGet
          ? [lowerKey, upperKeyForGet].map((k) => getOfficeTypeForChamber(countryId, k, preset))
          : [getOfficeTypeForChamber(countryId, lowerKey, preset)];

      const [officials, activeBill] = await Promise.all([
        db
          .collection<ElectedOfficial>("electedOfficials")
          .find({
            characterId: new ObjectId(myCharacterId),
            officeType: { $in: memberOfficeTypes },
            countryId,
          })
          .toArray(),
        db.collection<Bill>("bills").findOne({
          sponsorId: new ObjectId(myCharacterId),
          ...buildActiveNationalBillFilter(countryId, NATIONAL_TERMINAL_STATUSES as BillStatus[]),
        }),
      ]);
      isMember = officials.length > 0;
      isMemberOfViewedChamber = officials.some(
        (o) => o.officeType === getOfficeTypeForChamber(countryId, chamber, preset)
      );
      hasActiveBill = !!activeBill;
      canPropose = isMember && !hasActiveBill;
    }
    if (authUser.isAdmin) {
      canPropose = true;
      adminOverride = !isMember;
    }
  }

  const proposalWarningOrigins: BillProposalOriginChamber[] =
    config.legislature.bicameral && upperKeyForGet
      ? ([lowerKey, upperKeyForGet] as BillProposalOriginChamber[])
      : ([lowerKey] as BillProposalOriginChamber[]);
  const proposalWarningsEntries = await Promise.all(
    proposalWarningOrigins.map(async (originChamber) => [
      originChamber,
      await getBillProposalAutoFailWarning(db, countryId, originChamber),
    ])
  );
  const proposalWarnings = Object.fromEntries(proposalWarningsEntries) as Record<
    string,
    BillProposalAutoFailWarning | null
  >;

  const activeBillsForProvisions = await db
    .collection<Bill>("bills")
    .find(buildActiveNationalBillFilter(countryId, NATIONAL_TERMINAL_STATUSES as BillStatus[]), {
      projection: { provisions: 1 },
    })
    .toArray();
  const blockedProvisions: { legislationTypeId: string; policyOptionId: string }[] = [];
  for (const bill of activeBillsForProvisions) {
    if (!bill.provisions) continue;
    for (const provision of bill.provisions) {
      if (
        "type" in provision &&
        (provision.type === "tariff" ||
          provision.type === "subsidy" ||
          provision.type === "end_subsidy" ||
          provision.type === "nationalize" ||
          provision.type === "privatize" ||
          provision.type === "designate_strategic_sector" ||
          provision.type === "embargo" ||
          provision.type === "end_embargo")
      ) {
        continue;
      }
      const policyProvision = provision as { legislationTypeId?: string; policyOptionId?: string };
      if (policyProvision.legislationTypeId && policyProvision.policyOptionId) {
        blockedProvisions.push({
          legislationTypeId:
            canonicalizeLegislationTypeId(policyProvision.legislationTypeId) ??
            policyProvision.legislationTypeId,
          policyOptionId: policyProvision.policyOptionId,
        });
      }
    }
  }

  const myVoteMap = new Map<string, { origin: string | null; other: string | null }>();
  if (myCharacterId && bills.length > 0) {
    const billIds = bills.map((bill) => bill._id);
    const voteRows = await db
      .collection("bills")
      .find(
        { _id: { $in: billIds } },
        {
          projection: {
            [`votes.${myCharacterId}`]: 1,
            [`otherChamberVotes.${myCharacterId}`]: 1,
          },
        }
      )
      .toArray();
    for (const row of voteRows) {
      const votes = (row as Record<string, unknown>).votes as Record<string, string> | undefined;
      const otherVotes = (row as Record<string, unknown>).otherChamberVotes as
        Record<string, string> | undefined;
      myVoteMap.set(row._id.toString(), {
        origin: votes?.[myCharacterId] ?? null,
        other: otherVotes?.[myCharacterId] ?? null,
      });
    }
  }

  const billDisplays: BillDisplay[] = bills.map((bill) => {
    const partySlug = bill.sponsorParty ?? "";
    const party = partyMap.get(partySlug);
    const firstPolicy = bill.provisions?.find(isPolicyProvision);
    const internationalActionLabel = bill.internationalAction
      ? getInternationalActionLabel(bill.internationalAction)
      : null;
    const internationalActionSummary = bill.internationalAction
      ? getInternationalActionSummary(bill.internationalAction)
      : null;
    const displayProvisions =
      bill.provisions?.map((provision) => {
        if (!isPolicyProvision(provision)) {
          if (provision.type === "embargo" || provision.type === "end_embargo") {
            const embargoLabel = formatEmbargoProvisionLabel(provision);
            return {
              legislationTypeId: provision.type,
              legislationTypeName: embargoLabel.summary,
              effectDirection: 0,
              directionLabel: "Center" as const,
              effectTargetLabel: embargoLabel.description,
            };
          }
          const legislationTypeName =
            provision.type === "tariff"
              ? describeTariffProvision(provision)
              : provision.type === "nationalize"
                ? "Nationalization"
                : provision.type === "privatize"
                  ? "Privatization"
                  : provision.type === "designate_strategic_sector"
                    ? "Strategic-Sector Designation"
                    : provision.type === "international_organization"
                      ? provision.subType === "join"
                        ? "Join Organization"
                        : provision.subType === "fund"
                          ? "Fund Organization"
                          : "Leave Organization"
                      : provision.type === "euro_adoption"
                        ? "Currency Adoption"
                        : provision.type === "union_law"
                          ? "Union Law"
                          : provision.type === "electoral_law"
                            ? "Electoral Law"
                            : provision.type === "central_bank_independence"
                              ? "Central Bank Independence"
                              : // Ahead of the subsidy fallback, which is a catch-all.
                                provision.type === "declare_war"
                                ? "Declaration of War"
                                : describeSubsidyProvision(provision);
          return {
            legislationTypeId: provision.type,
            legislationTypeName,
            effectDirection: 0,
            directionLabel: "Center" as const,
            effectTargetLabel: undefined,
          };
        }

        const legislationType = getLegislationTypeById(
          legislationTypeMap,
          provision.legislationTypeId
        );
        const positionLabel =
          provision.economic != null || provision.social != null
            ? formatBillPositionLabel(provision.economic, provision.social)
            : undefined;
        const policyOption =
          provision.policyOptionId && legislationType?.policyOptions
            ? legislationType.policyOptions.find((option) => option.id === provision.policyOptionId)
            : undefined;
        const optionLabel = policyOption?.explanation ?? policyOption?.name;
        return {
          legislationTypeId:
            canonicalizeLegislationTypeId(provision.legislationTypeId) ??
            provision.legislationTypeId,
          legislationTypeName:
            legislationType?.name ??
            humanizeLegislationTypeId(provision.legislationTypeId) ??
            provision.legislationTypeId,
          effectDirection: provision.effectDirection,
          directionLabel: directionLabel(provision.effectDirection),
          ...(positionLabel ? { positionLabel } : {}),
          effectTargetLabel:
            optionLabel ??
            (legislationType?.effectTarget?.metricId
              ? effectTargetLabelFromMetricId(legislationType.effectTarget.metricId)
              : undefined),
          ...(provision.economic != null &&
            axisRelevant(legislationType, "economic") && { economic: provision.economic }),
          ...(provision.social != null &&
            axisRelevant(legislationType, "social") && { social: provision.social }),
        };
      }) ??
      (bill.internationalAction
        ? [
            {
              legislationTypeId: bill.internationalAction.type,
              legislationTypeName: internationalActionLabel ?? bill.internationalAction.type,
              effectDirection: 0,
              directionLabel: "Center" as const,
              effectTargetLabel: internationalActionSummary ?? undefined,
            },
          ]
        : undefined);
    const firstDisplayProvision = displayProvisions?.[0];
    const headlineLegislationTypeId =
      canonicalizeLegislationTypeId(
        bill.legislationTypeId ?? firstPolicy?.legislationTypeId ?? bill.internationalAction?.type
      ) ??
      firstDisplayProvision?.legislationTypeId ??
      null;
    const headlineLegislationType = getLegislationTypeById(
      legislationTypeMap,
      bill.legislationTypeId ?? firstPolicy?.legislationTypeId
    );
    const headlineDirection = bill.effectDirection ?? firstPolicy?.effectDirection ?? null;
    const headlinePositionLabel =
      firstPolicy && (firstPolicy.economic != null || firstPolicy.social != null)
        ? formatBillPositionLabel(firstPolicy.economic, firstPolicy.social)
        : null;
    const headlineEffectTargetLabel = (() => {
      if (firstPolicy?.policyOptionId && headlineLegislationType?.policyOptions) {
        const option = headlineLegislationType.policyOptions.find(
          (candidate) => candidate.id === firstPolicy.policyOptionId
        );
        if (option) return option.explanation ?? option.name;
      }
      return headlineLegislationType?.effectTarget?.metricId
        ? effectTargetLabelFromMetricId(headlineLegislationType.effectTarget.metricId)
        : null;
    })();

    return {
      id: bill._id.toString(),
      title: bill.title,
      summary: bill.summary,
      ...(bill.adminProposed ? { adminProposed: true } : {}),
      countryId,
      originChamber: bill.originChamber,
      currentChamber: bill.currentChamber,
      sponsorId: bill.sponsorId?.toString() ?? null,
      sponsorName: bill.sponsorName,
      sponsorParty: partySlug,
      sponsorPartyName: party?.name ?? (partySlug || "Independent"),
      sponsorPartyColor: getPartyHex(partySlug, party?.color),
      status: bill.status,
      votesFor: bill.votesFor,
      votesAgainst: bill.votesAgainst,
      votesAbstain: bill.votesAbstain,
      totalVotes: bill.votesFor + bill.votesAgainst + bill.votesAbstain,
      otherChamberVotesFor: 0,
      otherChamberVotesAgainst: 0,
      otherChamberVotesAbstain: 0,
      category: bill.category ?? "general",
      legislationTypeId: headlineLegislationTypeId,
      legislationTypeName:
        headlineLegislationType?.name ??
        firstDisplayProvision?.legislationTypeName ??
        humanizeLegislationTypeId(
          bill.legislationTypeId ?? firstPolicy?.legislationTypeId ?? bill.internationalAction?.type
        ) ??
        null,
      effectDirection: headlineDirection,
      directionLabel: headlineDirection != null ? directionLabel(headlineDirection) : null,
      positionLabel: headlinePositionLabel,
      effectTargetLabel:
        headlineEffectTargetLabel ?? firstDisplayProvision?.effectTargetLabel ?? null,
      provisions: displayProvisions,
      proposedAt: bill.proposedAt.toISOString(),
      votingStartedAt: bill.votingStartedAt?.toISOString() ?? null,
      votingEndsAt: bill.votingEndsAt?.toISOString() ?? null,
      votingEndsOnTurn: bill.votingEndsOnTurn ?? null,
      otherChamberVotingEndsAt: null,
      otherChamberVotingEndsOnTurn: bill.otherChamberVotingEndsOnTurn ?? null,
      passedAt: bill.passedOriginAt?.toISOString() ?? null,
      enactedAt: bill.enactedAt?.toISOString() ?? null,
      myVote: (myVoteMap.get(bill._id.toString())?.origin ?? null) as
        "for" | "against" | "abstain" | null,
      myOtherChamberVote: (myVoteMap.get(bill._id.toString())?.other ?? null) as
        "for" | "against" | "abstain" | null,
      canVoteOrigin: bill.status === "active" && isMemberOfViewedChamber,
      canVoteOther: false,
      requiresExecutiveAction: billRequiresExecutiveAction(bill),
      failedAt: bill.failedAt?.toISOString() ?? null,
    };
  });

  return {
    bills: billDisplays,
    canPropose,
    adminOverride,
    hasActiveBill,
    blockedProvisions,
    proposalWarnings,
    total,
    page: safePage,
    limit: BILL_PAGE_LIMIT,
  };
}

export async function getNationalBillDetail(
  db: Db,
  billId: string,
  authUser: AuthUser | null
): Promise<BillDetail | null> {
  const bill = await db.collection<Bill>("bills").findOne({ _id: new ObjectId(billId) });
  if (!bill) return null;

  const { provisionsResolved, legislationTypeName, legacyDirectionLabel, legacyEffectTargetLabel } =
    await resolveBillProvisions(db, bill);

  const country = await resolveBillCountryId(db, bill);
  const preset = await getGameStatePreset(db);
  const config = getCountryConfig(country, preset);
  const lowerKey = config.legislature.lowerChamber.key;
  const upperKey = config.upperElectionSystem
    ? (config.legislature.upperChamber?.key ?? null)
    : null;

  let myCharacterId: string | null = null;
  let isHouseMember = false;
  let isSenateMember = false;
  let isPresident = false;
  let canCabinetVote = false;
  let viewerPartyId: string | null = null;
  let viewerCharacterObjectId: ObjectId | null = null;
  let viewerCountryId: CountryId | null = null;

  if (country === "US") {
    if (authUser) {
      const viewerCharacter = await db
        .collection<Character>("characters")
        .findOne(
          { userId: new ObjectId(authUser.userId) },
          { projection: { _id: 1, party: 1, countryId: 1 } }
        );
      if (viewerCharacter) {
        myCharacterId = viewerCharacter._id.toString();
        viewerCharacterObjectId = viewerCharacter._id;
        viewerPartyId = viewerCharacter.party ?? null;
        viewerCountryId = viewerCharacter.countryId ?? null;
        const [officials, presidentOfficial] = await Promise.all([
          db
            .collection<ElectedOfficial>("electedOfficials")
            .find({
              characterId: viewerCharacter._id,
              officeType: {
                $in: [
                  getOfficeTypeForChamber(country, lowerKey, preset),
                  ...(upperKey ? [getOfficeTypeForChamber(country, upperKey, preset)] : []),
                ],
              },
              countryId: country,
            })
            .toArray(),
          db.collection<ElectedOfficial>("electedOfficials").findOne({
            characterId: viewerCharacter._id,
            officeType: "president",
            countryId: country,
          }),
        ]);
        isHouseMember = officials.some(
          (official) => official.officeType === getOfficeTypeForChamber(country, lowerKey, preset)
        );
        isSenateMember = upperKey
          ? officials.some(
              (official) =>
                official.officeType === getOfficeTypeForChamber(country, upperKey, preset)
            )
          : false;
        isPresident = Boolean(presidentOfficial);
      }
    }
  } else if (authUser) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(authUser.userId) });
    if (character) {
      myCharacterId = character._id.toString();
      viewerCharacterObjectId = character._id;
      viewerPartyId = character.party ?? null;
      viewerCountryId = character.countryId ?? null;
      const officials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          characterId: character._id,
          officeType: {
            $in: [
              getOfficeTypeForChamber(country, lowerKey, preset),
              ...(upperKey ? [getOfficeTypeForChamber(country, upperKey, preset)] : []),
            ],
          },
          countryId: country,
        })
        .toArray();
      isHouseMember = officials.some(
        (official) => official.officeType === getOfficeTypeForChamber(country, lowerKey, preset)
      );
      isSenateMember = upperKey
        ? officials.some(
            (official) => official.officeType === getOfficeTypeForChamber(country, upperKey, preset)
          )
        : false;
      if (country === "JP" && bill.status === "cabinet_review") {
        const governmentFormation = await getGovernmentFormationsCollection(db).findOne({
          _id: country,
        });
        const isPrimeMinister = governmentFormation?.pmCharacterId?.equals(character._id) ?? false;
        const cabinetMember = isPrimeMinister
          ? null
          : await db
              .collection("cabinetMembers")
              .findOne({ characterId: character._id, countryId: country });
        canCabinetVote = isPrimeMinister || Boolean(cabinetMember);
      }
    }
  }

  const partyMap = await getPartyMap(db, country);
  const allVoteKeys = [
    ...Object.keys(bill.votes ?? {}),
    ...Object.keys(bill.otherChamberVotes ?? {}),
  ];
  const characterVoteIds: string[] = [];
  const nppIds: string[] = [];
  const voteKeyToObjectId = new Map<string, string>();
  for (const voteKey of allVoteKeys) {
    if (voteKey.startsWith("npp_")) {
      const rawId = voteKey.slice(4);
      if (rawId && ObjectId.isValid(rawId)) {
        nppIds.push(rawId);
        voteKeyToObjectId.set(voteKey, rawId);
      }
    } else if (voteKey && ObjectId.isValid(voteKey)) {
      characterVoteIds.push(voteKey);
      voteKeyToObjectId.set(voteKey, voteKey);
    }
  }
  const uniqueCharacterIds = [...new Set(characterVoteIds)];
  const uniqueNppIds = [...new Set(nppIds)];

  const allParties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: country })
    .project({ sequentialId: 1, slug: 1 })
    .toArray();
  const slugToSequentialId = new Map<string, string>();
  for (const party of allParties) {
    if (party.slug) slugToSequentialId.set(party.slug, String(party.sequentialId));
  }

  const voterPartyMap = new Map<string, string>();
  const [characters, npps] = await Promise.all([
    uniqueCharacterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: uniqueCharacterIds.map((id) => new ObjectId(id)) } })
          .project({ _id: 1, party: 1 })
          .toArray()
      : Promise.resolve([]),
    uniqueNppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: uniqueNppIds.map((id) => new ObjectId(id)) } })
          .project({ _id: 1, party: 1 })
          .toArray()
      : Promise.resolve([]),
  ]);

  const characterPartyMap = new Map(
    characters.map((character) => [character._id.toString(), character.party ?? "independent"])
  );
  const nppPartyMap = new Map(
    npps.map((npp) => {
      const slug = npp.party ?? "independent";
      const resolved = slugToSequentialId.get(slug);
      if (resolved) return [npp._id.toString(), resolved];
      // Slug lookup failed (parties without slug field). Check if the
      // raw party value is already a valid sequentialId for this country
      // — covers NPPs assigned by sequentialId directly.
      if (partyMap.has(slug)) return [npp._id.toString(), slug];
      // Unknown party — use the raw value (will display as-is).
      return [npp._id.toString(), slug];
    })
  );

  for (const [voteKey, objectId] of voteKeyToObjectId) {
    const party = voteKey.startsWith("npp_")
      ? (nppPartyMap.get(objectId) ?? "independent")
      : (characterPartyMap.get(objectId) ?? "independent");
    voterPartyMap.set(voteKey, party);
  }

  const orClauses: Record<string, unknown>[] = [];
  if (uniqueCharacterIds.length > 0) {
    orClauses.push({
      characterId: { $in: uniqueCharacterIds.map((id) => new ObjectId(id)) },
      nppId: null,
    });
  }
  if (uniqueNppIds.length > 0) {
    orClauses.push({ nppId: { $in: uniqueNppIds.map((id) => new ObjectId(id)) } });
  }
  const officials =
    orClauses.length > 0
      ? await db
          .collection<ElectedOfficial>("electedOfficials")
          .find({
            $or: orClauses,
            // Filter to the bill's own country to prevent cross-country
            // NPP contamination from leaking through the weight map.
            // The buildScopedVoteInputs step below handles null/undefined
            // countryId via the officialCountryId() fallback.
            countryId: { $in: [country] },
          })
          .project<ScopedVoteOfficial>({
            characterId: 1,
            countryId: 1,
            nppId: 1,
            officeType: 1,
            seatsHeld: 1,
          })
          .toArray()
      : [];

  const whipPanel = await buildBillWhipPanelData(db, bill, country, {
    characterId: viewerCharacterObjectId,
    partyId: viewerPartyId,
    viewerCountryId,
    isAdmin: authUser?.isAdmin ?? false,
  });
  const primaryVoteChamberKey = resolvePrimaryVoteChamberKey(bill, lowerKey);
  const originVoteOfficeType = primaryVoteChamberKey
    ? resolveVoteOfficeType(country, primaryVoteChamberKey, lowerKey)
    : null;
  const otherVoteOfficeType = resolveVoteOfficeType(country, bill.currentChamber, lowerKey);
  const originVoteInputs = buildScopedVoteInputs(
    bill.votes,
    officials,
    originVoteOfficeType ? { countryId: country, officeType: originVoteOfficeType } : null
  );
  const otherVoteInputs = buildScopedVoteInputs(
    bill.otherChamberVotes,
    officials,
    otherVoteOfficeType ? { countryId: country, officeType: otherVoteOfficeType } : null
  );

  // A concluded voting phase has a frozen snapshot — derive its per-party
  // breakdown (and, via billEnrichment's sumVoteByParty, the headline) from the
  // snapshot so a later general election cannot recompute (and collapse) the
  // historical tally (#0982). Only an in-progress phase (no snapshot) live-scopes.
  const voteByPartyOrigin = bill.voteSnapshot
    ? buildVotesByParty(
        bill.voteSnapshot.votes,
        voterPartyMap,
        partyMap,
        snapshotWeightMap(bill.voteSnapshot)
      )
    : buildVotesByParty(
        originVoteInputs.votes,
        voterPartyMap,
        partyMap,
        originVoteInputs.weightMap
      );
  const voteByPartyOther = bill.otherChamberVoteSnapshot
    ? buildVotesByParty(
        bill.otherChamberVoteSnapshot.votes,
        voterPartyMap,
        partyMap,
        snapshotWeightMap(bill.otherChamberVoteSnapshot)
      )
    : buildVotesByParty(otherVoteInputs.votes, voterPartyMap, partyMap, otherVoteInputs.weightMap);

  // Read-only per-party whip summary for the origin chamber: every seated party
  // shows its national whip direction, defaulting to "free vote" when none.
  const originWhips = await db
    .collection<BillWhip>("billWhips")
    .find({
      targetType: "bill",
      targetId: bill._id,
      issuedBy: "nationalParty",
      chamber: bill.originChamber,
    })
    .toArray();
  const whipDirectionByParty = new Map<string, "for" | "against">();
  for (const whip of [...originWhips].sort((a, b) => a.attemptNumber - b.attemptNumber)) {
    whipDirectionByParty.set(whip.partyId, whip.direction);
  }
  const whipCounts = voteByPartyOrigin.map((p) => ({
    partyId: p.party,
    partyName: p.partyName,
    partyColor: p.partyColor,
    direction: whipDirectionByParty.get(p.party) ?? null,
  }));

  const characterIdsForSequentialLookup: string[] = [];
  if (bill.sponsorId) characterIdsForSequentialLookup.push(bill.sponsorId.toString());
  for (const coSponsor of bill.coSponsors ?? []) {
    characterIdsForSequentialLookup.push(coSponsor.characterId.toString());
  }
  for (const filibuster of bill.filibusterInvocations ?? []) {
    characterIdsForSequentialLookup.push(filibuster.characterId);
  }
  const uniqueLookupIds = [...new Set(characterIdsForSequentialLookup)].filter(
    (id) => id && ObjectId.isValid(id)
  );
  const sequentialIdMap = new Map<string, number>();
  if (uniqueLookupIds.length > 0) {
    const characterDocs = await db
      .collection<Character>("characters")
      .find(
        { _id: { $in: uniqueLookupIds.map((id) => new ObjectId(id)) } },
        { projection: { _id: 1, sequentialId: 1 } }
      )
      .toArray();
    for (const character of characterDocs) {
      if (character.sequentialId != null) {
        sequentialIdMap.set(character._id.toString(), character.sequentialId);
      }
    }
  }

  // Per-chamber seat-weighted veto override tally (US presidential veto only).
  // Recomputed from current seat holders so the displayed numbers match the
  // enactment rule (2/3 of each chamber's SEATS), independent of the running
  // combined vetoOverrideVotesFor/Against aggregate.
  let overrideDisplay: OverrideChamberDisplay | null = null;
  const hasOverrideActivity =
    bill.vetoOverrideVotes != null ||
    bill.overrideVotingEndsAt != null ||
    bill.overrideEnactedAt != null ||
    bill.overrideFailedAt != null;
  if (bill.overrideDisplaySnapshot) {
    // A resolved override has a frozen per-chamber display — use it so a later
    // election cannot recompute (and collapse) the historical override (#0982).
    overrideDisplay = bill.overrideDisplaySnapshot;
  } else if (hasOverrideActivity && upperKey != null) {
    const overrideOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: { $in: ["house", "senate"] }, countryId: country })
      .project<ScopedVoteOfficial>({
        characterId: 1,
        countryId: 1,
        nppId: 1,
        officeType: 1,
        seatsHeld: 1,
      })
      .toArray();
    overrideDisplay = buildOverrideDisplay(
      bill.vetoOverrideVotes,
      buildChamberSeatMap(overrideOfficials)
    );
  }

  const detail = billToDetail(
    bill,
    country,
    partyMap,
    legislationTypeName,
    provisionsResolved,
    legacyDirectionLabel,
    legacyEffectTargetLabel,
    myCharacterId,
    isHouseMember,
    isSenateMember,
    isPresident,
    voteByPartyOrigin,
    voteByPartyOther,
    whipPanel,
    sequentialIdMap,
    canCabinetVote,
    lowerKey,
    upperKey,
    overrideDisplay
  ) as BillDetail;
  return { ...detail, whipCounts };
}
