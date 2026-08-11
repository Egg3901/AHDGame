/**
 * Materialize outstanding federalBudget.debt.principal into tradeable sovereign
 * bond series at world bootstrap.
 *
 * Budgets seed debt as a scalar (principal + interestRate) with zero Bond docs.
 * Surplus countries never trigger quarterly issuance, so that scalar stays
 * orphaned forever (1953-default audit #3370: US/UK WWII-era debt with an empty
 * bond market). Deficit countries eventually grow a float, but only for *new*
 * borrowing — the opening principal remains uninstrumented.
 *
 * This seeder closes the gap: for every national budget whose principal exceeds
 * the sum of active sovereign bond face, it issues staggered reconcile-flagged
 * tranches covering the difference. Budget principal and debtInterest are left
 * alone — they already reflect the national debt; the bonds are the market
 * instruments that will retire that principal as they mature (with quarterly
 * rollover keeping surplus-country float stable).
 */
import { ObjectId, type Db } from "mongodb";
import type {
  Bond,
  BondMaturityTurns,
  CentralBank,
  Corporation,
  FederalBudget,
} from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_ORDER, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import {
  getNationalBudgetId,
  getSovereignCouponRate,
  getSovereignIssuerName,
  SOVEREIGN_RECONCILE_DISTRIBUTION,
} from "@/lib/bonds/sovereign";

export interface SeedSovereignBondInstrumentsResult {
  countriesSeeded: number;
  bondsInserted: number;
  totalFaceIssued: number;
}

/**
 * Every country's primary national corporation in one read.
 *
 * Only the PRIMARY lookup is batched. The "any corporation" fallback stays a
 * per-country findOne (see `findAnyNationalCorporation`) because which corp it
 * returns is natural order, and a batched `$in` would be free to return a
 * different row per country — same document count, different issuerName on the
 * bonds, and nothing downstream would flag it.
 */
async function loadPrimaryNationalCorporations(
  db: Db
): Promise<Map<string, Pick<Corporation, "_id" | "name">>> {
  const rows = await db
    .collection<Corporation>("corporations")
    .find({ countryOwnerId: { $in: [...COUNTRY_ORDER] }, isPrimaryNationalCorporation: true })
    .project<Pick<Corporation, "_id" | "name"> & { countryOwnerId: string }>({
      _id: 1,
      name: 1,
      countryOwnerId: 1,
    })
    .toArray();
  const byCountry = new Map<string, Pick<Corporation, "_id" | "name">>();
  for (const row of rows) {
    // First wins, matching what findOne returned when several rows carried the
    // primary flag.
    if (!byCountry.has(row.countryOwnerId)) {
      byCountry.set(row.countryOwnerId, { _id: row._id, name: row.name });
    }
  }
  return byCountry;
}

async function findAnyNationalCorporation(
  db: Db,
  countryId: CountryId
): Promise<Pick<Corporation, "_id" | "name"> | null> {
  return db.collection<Corporation>("corporations").findOne({ countryOwnerId: countryId });
}

/**
 * Idempotent: re-running against a world whose bonds already cover principal
 * inserts nothing. Safe to call on soft re-seed and hard reset alike.
 */
export async function seedSovereignBondInstruments(
  db: Db,
  log: (msg: string) => void = console.log,
  turn: number = 0,
  now: Date = new Date()
): Promise<SeedSovereignBondInstrumentsResult> {
  let countriesSeeded = 0;
  let bondsInserted = 0;
  let totalFaceIssued = 0;
  // Every country's tranches go in as one insert at the end. Per-country logs
  // below are unchanged and still emit in COUNTRY_ORDER, which the seed
  // profiler's repeated-log-line detector parses.
  const staged: Omit<Bond, "_id">[] = [];

  // Four preloads replace four reads per country. The corporation lookup is
  // deliberately NOT fully preloaded — see loadPrimaryNationalCorporations.
  const budgetIds = COUNTRY_ORDER.map((c) => getNationalBudgetId(c));
  const [budgetRows, bankRows, bondRows, primaryCorporations] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .find({ _id: { $in: budgetIds } } as Record<string, unknown>)
      .toArray(),
    db
      .collection<CentralBank>("centralBanks")
      .find({ _id: { $in: COUNTRY_ORDER.map((c) => getBankId(c)) } } as Record<string, unknown>)
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find({
        issuerType: "sovereign",
        countryId: { $in: [...COUNTRY_ORDER] },
        matured: false,
        defaulted: false,
      })
      .toArray(),
    loadPrimaryNationalCorporations(db),
  ]);
  const budgetsById = new Map(budgetRows.map((b) => [String(b._id), b]));
  const banksById = new Map(bankRows.map((b) => [String(b._id), b]));
  // Only summed below, so grouping order cannot affect the result. `countryId`
  // is optional on Bond; the $in above already excludes unset ones, and the
  // per-country query it replaced never matched them either, so skipping keeps
  // the coverage sums identical rather than folding stray bonds into a country.
  const coveredByCountry = new Map<string, number>();
  for (const bond of bondRows) {
    if (!bond.countryId) continue;
    coveredByCountry.set(
      bond.countryId,
      (coveredByCountry.get(bond.countryId) ?? 0) + (bond.totalIssued ?? 0)
    );
  }

  for (const countryId of COUNTRY_ORDER) {
    const budget = budgetsById.get(getNationalBudgetId(countryId)) ?? null;
    if (!budget) continue;

    const principal = budget.debt?.principal ?? 0;
    if (principal < BOND_UNIT_FACE_VALUE) continue;

    const covered = coveredByCountry.get(countryId) ?? 0;
    const gap =
      Math.floor(Math.max(0, principal - covered) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
    if (gap < BOND_UNIT_FACE_VALUE) continue;

    // Resolved only for countries that actually issue. The old code paid for
    // this on every country, including the ones the two gates above skip.
    const centralBank = banksById.get(getBankId(countryId)) ?? null;
    const countryCorporation =
      primaryCorporations.get(countryId) ?? (await findAnyNationalCorporation(db, countryId));

    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
    const corporationId = countryCorporation?._id ?? new ObjectId();
    const issuerName = countryCorporation?.name ?? getSovereignIssuerName(countryId);
    const currencyCode = resolveCountryCurrencyCode({ countryId });

    const bondDocs: Omit<Bond, "_id">[] = [];
    for (const [maturityStr, fraction] of Object.entries(SOVEREIGN_RECONCILE_DISTRIBUTION)) {
      if (!fraction || fraction <= 0) continue;
      const maturityTurns = Number(maturityStr) as BondMaturityTurns;
      const trancheAmount =
        Math.floor((gap * fraction) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
      if (trancheAmount < BOND_UNIT_FACE_VALUE) continue;

      const totalUnits = Math.floor(trancheAmount / BOND_UNIT_FACE_VALUE);
      const couponRate = getSovereignCouponRate(primeRate, maturityTurns);

      bondDocs.push({
        issuerType: "sovereign",
        corporationId,
        countryId,
        issuerName,
        faceValue: BOND_UNIT_FACE_VALUE,
        couponRate,
        maturityTurns,
        issuedAtTurn: turn,
        maturityTurn: turn + maturityTurns,
        marketPrice: 1.0,
        totalIssued: trancheAmount,
        publicFloat: totalUnits,
        holders: [],
        defaulted: false,
        defaultedAtTurn: null,
        matured: false,
        restructureHaircutPercent: null,
        restructureExtendedMaturityTurn: null,
        originalMaturityTurn: null,
        originalTotalIssued: null,
        // Stamped reconcile so the quarterly scheduler's same-turn dedup never
        // mistakes these seed instruments for a regular deficit issuance.
        reconcile: true,
        currencyCode,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (bondDocs.length === 0) continue;

    staged.push(...bondDocs);
    const issued = bondDocs.reduce((sum, b) => sum + b.totalIssued, 0);
    countriesSeeded++;
    bondsInserted += bondDocs.length;
    totalFaceIssued += issued;
    log(
      `Sovereign bonds: ${countryId} — ${bondDocs.length} tranche(s) covering ${issued.toLocaleString()} of ${principal.toLocaleString()} principal`
    );
  }

  if (staged.length > 0) {
    await db.collection<Omit<Bond, "_id">>("bonds").insertMany(staged);
  }

  if (countriesSeeded === 0) {
    log("Sovereign bonds: no uncovered principal gaps — nothing inserted");
  } else {
    log(
      `Sovereign bonds: seeded ${bondsInserted} instrument(s) across ${countriesSeeded} countr(y/ies); face ${totalFaceIssued.toLocaleString()}`
    );
  }

  return { countriesSeeded, bondsInserted, totalFaceIssued };
}
