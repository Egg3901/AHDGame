import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { withNoStore } from "@/lib/api/withNoStore";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { isPrivateBankingEnabled, isBankPropTradingEnabled } from "@/lib/banking/featureFlag";
import {
  checkCharterEligibility,
  getCharterCapitalRequirement,
  isChairOfCurrencyBank,
} from "@/lib/banking/charter";
import { getLegalCharterTypes } from "@/lib/banking/separationLaw";
import { getRateCorridors } from "@/lib/banking/regulationQ";
import { getEffectiveBankRates } from "@/lib/banking/rates";
import { getReserveRequirement } from "@/lib/banking/reserves";
import {
  DEFAULT_BRANCH_CAPACITY_SHARE,
  getBankDepositCeiling,
  getBranchCapacityShare,
} from "@/lib/banking/capacityAllocation";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import type { Character, Corporation, CorporateSector, GameConfig } from "@/lib/db/types";
import type { BankCharterType, BankLoan, InterbankLoan } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/banking/corporation/[id] - Bank console payload for a corporation.
// Auth: requireAuth
// Errors: 401, 404
async function handleGET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          privateBankingEnabled: 1,
          bankPropTradingEnabled: 1,
          bankContagionEnabled: 1,
        },
      }
    );
    const privateEnabled = await isPrivateBankingEnabled(config);
    const propTradingEnabled = await isBankPropTradingEnabled(config);

    const ownsFinancial = !!(await db
      .collection<CorporateSector>("corporateSectors")
      .findOne(
        { corporationId: corporation._id, sectorType: "financial" },
        { projection: { _id: 1 } }
      ));

    const charter = corporation.bankCharter;
    const hasActiveCharter = charter?.status === "active";
    const visible = ownsFinancial || hasActiveCharter;

    if (!visible) {
      return NextResponse.json({
        privateBankingEnabled: privateEnabled,
        bankPropTradingEnabled: propTradingEnabled,
        visible: false,
        isCeo: false,
        isAdmin: auth.user.isAdmin === true,
        isChair: false,
        canMutate: false,
        canRevoke: false,
        corporation: {
          id: corporation._id.toString(),
          name: corporation.name,
          liquidCapital: corporation.liquidCapital ?? 0,
          liquidCurrencyCode: resolveCorpLiquidCurrencyCode(corporation) ?? "USD",
          countryId: corporation.countryId,
          ownsFinancial,
        },
        currency: resolveCorpLiquidCurrencyCode(corporation) ?? "USD",
        legalCharterTypes: [],
        eligibleTypes: [],
        eligibilityReasons: [],
        capitalRequirement: 0,
        corridors: null,
        reserveRatio: null,
        charter: null,
        rates: null,
        loans: [],
        interbankLoans: [],
        depositCeiling: null,
      });
    }

    const currency = (charter?.currency ??
      resolveCorpLiquidCurrencyCode(corporation) ??
      "USD") as CurrencyCode;
    const countryId = getCountryIdForCurrency(currency);
    const legalTypes = await getLegalCharterTypes(db, countryId);
    const capitalRequirement = await getCharterCapitalRequirement(db, currency);
    const corridors = await getRateCorridors(db, countryId);
    const reserveRatio = await getReserveRequirement(db, currency);

    const isCeo = requireCeo(corporation, auth.user.userId) === null;
    const isAdmin = auth.user.isAdmin === true;
    let isChair = false;
    if (auth.user.character && hasActiveCharter && charter) {
      isChair = await isChairOfCurrencyBank(db, auth.user.character._id, charter.currency);
    }

    let eligibilityReasons: string[] = [];
    const eligibleTypes: BankCharterType[] = [];
    if (!hasActiveCharter && privateEnabled) {
      for (const type of legalTypes) {
        const result = await checkCharterEligibility(db, corporation, type, currency);
        if (result.eligible) {
          eligibleTypes.push(type);
        } else if (eligibilityReasons.length === 0) {
          eligibilityReasons = result.reasons;
        }
      }
      if (eligibleTypes.length === 0 && legalTypes.length > 0) {
        const probe = await checkCharterEligibility(db, corporation, legalTypes[0], currency);
        eligibilityReasons = probe.reasons;
      }
    }

    let rates: { depositRatePercent: number; lendingRatePercent: number } | null = null;
    if (hasActiveCharter && charter) {
      rates = await getEffectiveBankRates(db, charter);
    }

    const loans = hasActiveCharter
      ? await db
          .collection<BankLoan>("bankLoans")
          .find({ bankCorporationId: corporation._id })
          .sort({ originatedTurn: -1 })
          .limit(200)
          .toArray()
      : [];

    const interbankLoans =
      hasActiveCharter && propTradingEnabled
        ? await db
            .collection<InterbankLoan>("interbankLoans")
            .find({
              $or: [
                { lenderCorporationId: corporation._id },
                { borrowerCorporationId: corporation._id },
              ],
              status: "current",
            })
            .sort({ originatedTurn: -1 })
            .limit(100)
            .toArray()
        : [];

    const depositCeiling =
      hasActiveCharter && charter
        ? (charter.depositCeiling ?? (await getBankDepositCeiling(db, corporation)))
        : null;

    // The console used to ship raw ObjectId hex for every borrower and every
    // blacklist entry, which the UI then printed (truncated, for the loan
    // book). Nobody can read that, and a player has no way to produce one.
    // Resolve names once here so both surfaces render people and companies.
    const blacklistVisible = isCeo || isAdmin || isChair;
    const rawBlacklist = charter?.blacklist;
    const characterIdsToName = new Set<string>();
    const corporationIdsToName = new Set<string>();
    for (const loan of loans) {
      if (!loan.borrowerId) continue;
      if (loan.borrowerType === "character") characterIdsToName.add(loan.borrowerId.toString());
      if (loan.borrowerType === "corporation") corporationIdsToName.add(loan.borrowerId.toString());
    }
    if (blacklistVisible && rawBlacklist) {
      for (const id of rawBlacklist.characterIds ?? []) characterIdsToName.add(id);
      for (const id of rawBlacklist.corporationIds ?? []) corporationIdsToName.add(id);
    }
    for (const loan of interbankLoans) {
      corporationIdsToName.add(loan.lenderCorporationId.toString());
      corporationIdsToName.add(loan.borrowerCorporationId.toString());
    }

    const [namedCharacters, namedCorporations] = await Promise.all([
      characterIdsToName.size > 0
        ? db
            .collection<Character>("characters")
            .find(
              { _id: { $in: [...characterIdsToName].map((id) => new ObjectId(id)) } },
              { projection: { name: 1, sequentialId: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      corporationIdsToName.size > 0
        ? db
            .collection<Corporation>("corporations")
            .find(
              { _id: { $in: [...corporationIdsToName].map((id) => new ObjectId(id)) } },
              { projection: { name: 1, sequentialId: 1, tickerSymbol: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);
    const characterNames = new Map(namedCharacters.map((c) => [c._id.toString(), c]));
    const corporationNames = new Map(namedCorporations.map((c) => [c._id.toString(), c]));

    function describeParty(
      type: string,
      id: string | null
    ): { id: string; name: string; sequentialId: number | null; ticker?: string | null } | null {
      if (!id) return null;
      if (type === "character") {
        const c = characterNames.get(id);
        return c ? { id, name: c.name, sequentialId: c.sequentialId ?? null } : null;
      }
      const c = corporationNames.get(id);
      return c
        ? {
            id,
            name: c.name,
            sequentialId: c.sequentialId ?? null,
            ticker: c.tickerSymbol ?? null,
          }
        : null;
    }

    // Who a bank refuses is its own business, not a public shaming list. Only
    // the CEO, an admin, or the chartering currency's chair sees the entries.
    const fundNames = new Map(getAllFundDefinitions().map((f) => [f.slug, f.name]));
    const blacklist =
      blacklistVisible && rawBlacklist
        ? {
            corporations: (rawBlacklist.corporationIds ?? []).map(
              (id) =>
                describeParty("corporation", id) ?? { id, name: "Unknown", sequentialId: null }
            ),
            characters: (rawBlacklist.characterIds ?? []).map(
              (id) => describeParty("character", id) ?? { id, name: "Unknown", sequentialId: null }
            ),
            indexFunds: (rawBlacklist.indexFundIds ?? []).map((slug) => ({
              slug,
              name: fundNames.get(slug) ?? slug,
            })),
          }
        : null;

    return NextResponse.json({
      privateBankingEnabled: privateEnabled,
      bankPropTradingEnabled: propTradingEnabled,
      visible: true,
      isCeo,
      isAdmin,
      isChair,
      canMutate: isCeo && privateEnabled,
      canRevoke: (isAdmin || isChair) && privateEnabled && hasActiveCharter,
      corporation: {
        id: corporation._id.toString(),
        name: corporation.name,
        liquidCapital: corporation.liquidCapital ?? 0,
        liquidCurrencyCode: resolveCorpLiquidCurrencyCode(corporation) ?? "USD",
        countryId: corporation.countryId,
        ownsFinancial,
      },
      currency,
      legalCharterTypes: legalTypes,
      eligibleTypes,
      eligibilityReasons,
      capitalRequirement,
      corridors,
      reserveRatio,
      depositCeiling,
      defaultBranchCapacityShare: DEFAULT_BRANCH_CAPACITY_SHARE,
      // Catalog for the blacklist fund picker, so the CEO chooses a fund by
      // name instead of typing its slug.
      blacklistableFunds: blacklistVisible
        ? getAllFundDefinitions()
            .map((f) => ({ slug: f.slug, name: f.name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : undefined,
      charter:
        hasActiveCharter && charter
          ? {
              type: charter.type,
              status: charter.status,
              currency: charter.currency,
              charteredTurn: charter.charteredTurn,
              postedCapital: charter.postedCapital,
              depositOffset: charter.depositOffset,
              lendingOffset: charter.lendingOffset,
              totalDeposits: charter.totalDeposits ?? 0,
              totalLoans: charter.totalLoans ?? 0,
              npcDeposits: charter.npcDeposits ?? 0,
              reserves: charter.reserves ?? 0,
              confidence: charter.confidence ?? null,
              warningBand: charter.warningBand ?? null,
              panicTurns: charter.panicTurns ?? 0,
              branchCapacityShare: getBranchCapacityShare(charter),
              depositCeiling: depositCeiling ?? 0,
              interbankDebt: charter.interbankDebt ?? 0,
              cbMarginDebt: charter.cbMarginDebt ?? 0,
              propBookMarkValue: charter.propBookMarkValue ?? 0,
              propBook: (charter.propBook ?? []).map((p) => ({
                asset: p.asset,
                ref: p.ref,
                units: p.units,
                costBasis: p.costBasis,
                markValue: p.markValue ?? null,
              })),
              blacklist,
            }
          : null,
      rates,
      loans: loans.map((loan) => ({
        id: loan._id.toString(),
        borrowerType: loan.borrowerType,
        borrower: describeParty(loan.borrowerType, loan.borrowerId?.toString() ?? null),
        principal: loan.principal,
        outstanding: loan.outstanding,
        ratePercent: loan.ratePercent,
        originatedTurn: loan.originatedTurn,
        termTurns: loan.termTurns,
        status: loan.status,
        arrearsTurns: loan.arrearsTurns ?? 0,
      })),
      interbankLoans: interbankLoans.map((loan) => ({
        id: loan._id.toString(),
        lenderCorporationId: loan.lenderCorporationId.toString(),
        borrowerCorporationId: loan.borrowerCorporationId.toString(),
        counterparty: describeParty(
          "corporation",
          loan.lenderCorporationId.equals(corporation._id)
            ? loan.borrowerCorporationId.toString()
            : loan.lenderCorporationId.toString()
        ),
        principal: loan.principal,
        outstanding: loan.outstanding,
        ratePercent: loan.ratePercent,
        originatedTurn: loan.originatedTurn,
        status: loan.status,
        role: loan.lenderCorporationId.equals(corporation._id)
          ? ("lender" as const)
          : ("borrower" as const),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(handleGET);
