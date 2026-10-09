/**
 * Autonomous privatization bills for NPP-governed planned (or formerly planned)
 * economies. The rules core (`turn/npp/rules/privatizationSponsorship`) decides
 * pace and sector selection from the live marketization dial; this shell loads
 * the rows, drafts a state-ownership bill carrying `privatize` provisions built
 * from rows it has just verified, and files it. The bill
 * then follows the ordinary path: NPP voting, the two-thirds pass rule for
 * state-asset bills, and enactment through `applyPrivatizeProvision`, which
 * clamps every carve to the anti-monopoly cap once more at enactment.
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PrivatizeProvision } from "@/lib/db/types/legislation";
import type {
  Bill,
  BillChamber,
  BillStatus,
  Corporation,
  CorporateSector,
  ElectedOfficial,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { MARKETIZATION_SCHEDULE } from "@/lib/constants/commandEconomy";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  getChamberKeyForOfficeType,
  getLowerChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { getCountryState } from "@/lib/countryState";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getDesignatedSectorTypes } from "@/lib/nationalization/strategicSectors";
import {
  CARVE_FRACTION_MAX,
  CARVE_FRACTION_MIN,
  GOLDEN_SHARE_MAX,
  PRIVATIZE_MARKET_CONTROL_CAP,
  maxCarveFractionForMarketShare,
} from "@/lib/nationalization/constants";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";
import { hasProtectedConstructionProperty } from "@/lib/banking/rules/constructionProperty";
import {
  NPP_PRIVATIZATION_RESELECT_COOLDOWN_TURNS,
  nppPrivatizationGate,
  planNppPrivatization,
  privatizationPaceForLevel,
  type NppPrivatizationProvisionPlan,
  type PrivatizationCandidateSector,
} from "@/lib/turn/npp/rules/privatizationSponsorship";
import { NPP_BILL_VOTING_DURATION_HOURS } from "./constants";

const PRIVATIZATION_BILL_CATEGORY = "state ownership";

/** Same terminal set the NPP active-bill cap uses. */
const TERMINAL_STATUSES: BillStatus[] = ["failed", "withdrawn", "signed", "override_failed"];

type SectorRow = Pick<
  CorporateSector,
  | "_id"
  | "corporationId"
  | "countryId"
  | "stateId"
  | "sectorType"
  | "industryModel"
  | "mediaDiscriminator"
  | "revenue"
  | "capitalStock"
  | "strategyId"
  | "effectiveProfitMargin"
  | "absorbedAtTurn"
  | "constructionFinancing"
  | "constructionPropertyTransition"
> & { plantsPnl?: { profit?: number; revenue?: number } };

export type ProposeNppPrivatizationResult =
  { ok: true; billId: string; sectors: number } | { ok: false; reason: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First free name per base: "X", then "X 2", "X 3", ... (case-insensitive). */
function pickUniqueNames(bases: string[], taken: ReadonlySet<string>): string[] {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  return bases.map((base) => {
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * Try to file one NPP privatization bill for `countryId`. Cheap no-op (no reads)
 * when the dial or schedule rules it out.
 */
export async function proposeNppPrivatizationBill(
  db: Db,
  args: {
    countryId: CountryId;
    npp: Pick<NPP, "_id" | "name" | "party">;
    official: Pick<ElectedOfficial, "countryId" | "nppId" | "officeType">;
    /** Live marketization level (persisted dial, else era schedule). */
    marketizationLevel: number;
    currentTurn: number;
    now: Date;
  }
): Promise<ProposeNppPrivatizationResult> {
  const { countryId, npp, official, currentTurn, now } = args;
  const hasSchedule = !!MARKETIZATION_SCHEDULE[countryId];
  if (!privatizationPaceForLevel(args.marketizationLevel, hasSchedule)) {
    return { ok: false, reason: "not eligible at this marketization level" };
  }
  if (
    official.countryId !== countryId ||
    String(official.nppId) !== String(npp._id) ||
    official.officeType !== getLowerChamberOfficeType(countryId)
  ) {
    return { ok: false, reason: "sponsor is not a seated lower-chamber NPP" };
  }

  // One read answers the one-active cap, the cadence and the reselect window.
  const recentBills = await db
    .collection<Bill>("bills")
    .find(
      {
        countryId,
        "provisions.type": "privatize",
        $or: [
          { status: { $nin: TERMINAL_STATUSES } },
          { votingEndsOnTurn: { $gte: currentTurn - NPP_PRIVATIZATION_RESELECT_COOLDOWN_TURNS } },
        ],
      },
      { projection: { status: 1, nppSponsored: 1, votingEndsOnTurn: 1, provisions: 1 } }
    )
    .toArray();
  let activeNppPrivatizeBills = 0;
  let lastNppPrivatizeTurn: number | null = null;
  const recentlyProposedSectorIds = new Set<string>();
  for (const bill of recentBills) {
    if (bill.nppSponsored) {
      if (!TERMINAL_STATUSES.includes(bill.status)) activeNppPrivatizeBills++;
      if (typeof bill.votingEndsOnTurn === "number") {
        const proposed = bill.votingEndsOnTurn - NPP_BILL_VOTING_DURATION_HOURS;
        lastNppPrivatizeTurn =
          lastNppPrivatizeTurn == null ? proposed : Math.max(lastNppPrivatizeTurn, proposed);
      }
    }
    for (const p of bill.provisions ?? []) {
      if (p.type !== "privatize") continue;
      for (const sel of p.selections ?? []) recentlyProposedSectorIds.add(String(sel.sectorId));
    }
  }
  const gate = nppPrivatizationGate({
    level: args.marketizationLevel,
    hasMarketizationSchedule: hasSchedule,
    currentTurn,
    activeNppPrivatizeBills,
    lastNppPrivatizeTurn,
  });
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const natCorps = await db
    .collection<Corporation>("corporations")
    .find(
      { countryOwnerId: countryId },
      { projection: { _id: 1, name: 1, countryOwnerId: 1, ownershipState: 1, countryId: 1 } }
    )
    .toArray();
  if (natCorps.length === 0) return { ok: false, reason: "no National Corporation" };

  const [sectorRows, strategicTypes] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: { $in: natCorps.map((c) => c._id) }, countryId },
        {
          projection: {
            _id: 1,
            corporationId: 1,
            countryId: 1,
            stateId: 1,
            sectorType: 1,
            industryModel: 1,
            mediaDiscriminator: 1,
            revenue: 1,
            capitalStock: 1,
            strategyId: 1,
            effectiveProfitMargin: 1,
            absorbedAtTurn: 1,
            constructionFinancing: 1,
            constructionPropertyTransition: 1,
            "plantsPnl.profit": 1,
            "plantsPnl.revenue": 1,
          },
        }
      )
      .toArray() as Promise<SectorRow[]>,
    getDesignatedSectorTypes(db, countryId),
  ]);

  const candidates: PrivatizationCandidateSector[] = sectorRows.map((s) => ({
    id: s._id.toHexString(),
    corporationId: s.corporationId.toHexString(),
    sectorType: s.sectorType,
    revenue: s.revenue,
    plantsProfit: s.plantsPnl?.profit ?? null,
    plantsRevenue: s.plantsPnl?.revenue ?? null,
    effectiveProfitMargin: s.effectiveProfitMargin ?? null,
    absorbedAtTurn: s.absorbedAtTurn ?? null,
    constructionLocked: hasProtectedConstructionProperty(s),
  }));
  const plan = planNppPrivatization({
    level: args.marketizationLevel,
    hasMarketizationSchedule: hasSchedule,
    currentTurn,
    activeNppPrivatizeBills,
    lastNppPrivatizeTurn,
    recentlyProposedSectorIds,
    sectors: candidates,
    strategicSectorTypes: strategicTypes,
  });
  if (!plan.ok) return { ok: false, reason: plan.reason };

  // One-party-state banned-party guard, as for every other NPP bill.
  const runtime = await getCountryState(db, countryId);
  if (runtime.governmentType === "onePartyState" && npp.party) {
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId, sequentialId: Number(npp.party) });
    if (isBannedParty({ governmentType: runtime.governmentType }, party)) {
      return { ok: false, reason: "banned party" };
    }
  }

  // Pre-clamp large carves to the anti-monopoly cap so the bill shows what will
  // actually happen. A carve at or under the cap is always legal (the carved
  // share is fraction x holding share <= cap), so only larger ones need a
  // market-share read. Enactment clamps again against the then-current share.
  const sectorById = new Map(sectorRows.map((s) => [s._id.toHexString(), s]));
  const corpById = new Map(natCorps.map((c) => [c._id.toHexString(), c]));
  const provisions: NppPrivatizationProvisionPlan[] = await Promise.all(
    plan.provisions.map(async (p) => {
      const source = corpById.get(p.sourceCorporationId);
      const selections = await Promise.all(
        p.selections.map(async (sel) => {
          let carve = sel.carveFraction;
          const sector = sectorById.get(sel.sectorId);
          if (source && sector && carve > PRIVATIZE_MARKET_CONTROL_CAP) {
            const sharePct = await fetchSectorMarketSharePercent(db, sector, source);
            carve = Math.min(carve, maxCarveFractionForMarketShare(sharePct));
          }
          return {
            sectorId: sel.sectorId,
            carveFraction: Math.min(
              CARVE_FRACTION_MAX,
              Math.max(CARVE_FRACTION_MIN, Math.floor(carve * 1000) / 1000)
            ),
          };
        })
      );
      return { ...p, selections };
    })
  );

  // Names: "<National Corporation> <Sector> Company", numbered on collision.
  const bases = provisions.map(
    (p) =>
      `${corpById.get(p.sourceCorporationId)?.name ?? countryId} ${CORPORATION_TYPE_LABELS[p.sectorType] ?? p.sectorType} Company`
  );
  const takenDocs = await db
    .collection<Corporation>("corporations")
    .find(
      {
        name: {
          $regex: `^(${[...new Set(bases)].map(escapeRegex).join("|")})( \\d+)?$`,
          $options: "i",
        },
      },
      { projection: { name: 1 } }
    )
    .toArray();
  const names = pickUniqueNames(bases, new Set(takenDocs.map((d) => d.name)));

  // Built from rows this function just loaded: every source is a National
  // Corporation of this country (queried by countryOwnerId), every sector is
  // one of its rows, fractions sit inside [CARVE_FRACTION_MIN, CARVE_FRACTION_MAX],
  // and the dial already permits private enterprise. That is everything the
  // player-route validator checks, without its per-provision reads.
  const billProvisions: PrivatizeProvision[] = provisions.map((p, i) => ({
    type: "privatize",
    sourceNationalCorporationId: new ObjectId(p.sourceCorporationId),
    selections: p.selections.map((sel) => ({
      sectorId: new ObjectId(sel.sectorId),
      carveFraction: sel.carveFraction,
    })),
    newCorpName: names[i],
    goldenSharePercent: Math.max(0, Math.min(GOLDEN_SHARE_MAX, p.goldenSharePercent)),
    method: "ipo",
  }));

  const chamber = getChamberKeyForOfficeType(countryId, official.officeType) as BillChamber;
  if (!chamber) return { ok: false, reason: "no chamber for sponsor" };

  const labels = [
    ...new Set(provisions.map((p) => CORPORATION_TYPE_LABELS[p.sectorType] ?? p.sectorType)),
  ];
  const sectorCount = provisions.reduce((n, p) => n + p.selections.length, 0);
  const title = `Privatization of State Enterprises: ${labels.join(", ")}`;
  const summary =
    `Floats part of the state's holdings in ${labels.join(", ").toLowerCase()} ` +
    `(${sectorCount} ${sectorCount === 1 ? "operation" : "operations"}) as new listed companies. ` +
    `Proceeds go to the treasury.` +
    (provisions.some((p) => p.goldenSharePercent > 0)
      ? " The state keeps a golden share in strategic holdings."
      : "");

  const duration = NPP_BILL_VOTING_DURATION_HOURS;
  const bill: Omit<Bill, "_id"> = {
    countryId,
    stateId: getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`,
    title,
    summary,
    category: PRIVATIZATION_BILL_CATEGORY,
    provisions: billProvisions,
    originChamber: chamber,
    currentChamber: chamber,
    sponsorId: npp._id,
    sponsorName: npp.name,
    sponsorParty: npp.party ?? undefined,
    nppSponsored: true,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: now,
    proposedTurn: currentTurn,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + duration * 60 * 60 * 1000),
    votingEndsOnTurn: currentTurn + duration,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
  return { ok: true, billId: result.insertedId.toString(), sectors: sectorCount };
}
