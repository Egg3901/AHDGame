/**
 * One-time backfill of the two US sovereign bond series that were missed at
 * turns 204 and 216. Those quarterly issuances were skipped because the US
 * budget was in surplus and the old deficit-only issuance logic produced zero
 * bonds; the rollover fix (src/lib/bonds/sovereign.ts) preserves the float
 * going forward but cannot reach back and recreate the missed series.
 *
 * What this script does (per missing turn):
 *   - Inserts a `bonds` doc with `issuerType: "sovereign"`, `countryId: "US"`,
 *     `issuedAtTurn` set to the historical turn (204 or 216), `maturityTurn`
 *     set 48 turns later (252 or 264), `couponRate` set to the current US
 *     prime rate (we have no rate history for those turns), and `publicFloat`
 *     equal to the full unit count so every unit is available for purchase.
 *   - Updates `federalBudget._id = "federal"` via `applySovereignDebtAdjustment`
 *     so principal, debtInterest, surplus, debtToGdpRatio, and creditRating
 *     reflect the restored debt.
 *
 * What this script does NOT do:
 *   - Backfill bondHistory for the turns between issuedAtTurn and now. The
 *     price chart for these series will start at the current turn.
 *   - Pay retroactive coupons. No holders existed, so the market maker
 *     absorbed the nonexistent coupons — no cash owed.
 *
 * Idempotency: checks for an existing sovereign US bond at each target
 * `issuedAtTurn` before inserting. Safe to re-run.
 *
 * Target DB: set MONGODB_URI_LIVE in .env.local.
 *
 * Usage:
 *   npx tsx scripts/migrations/backfillUsSovereignBonds.ts                        # dry-run
 *   npx tsx scripts/migrations/backfillUsSovereignBonds.ts --apply                # writes changes
 *   npx tsx scripts/migrations/backfillUsSovereignBonds.ts --apply \
 *     --issued-204=12000000000 --issued-216=12000000000                           # override amounts
 */

import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Bond, FederalBudget, Corporation, CentralBank } from "../../src/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "../../src/lib/db/types/bond";
import { COUNTRY_CONFIGS } from "../../src/lib/constants/countries";
import {
  applySovereignDebtAdjustment,
  getNationalBudgetId,
  getSovereignIssuerName,
} from "../../src/lib/bonds/sovereign";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");

function parseAmountArg(flag: string, fallback: number): number {
  const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (!match) return fallback;
  const raw = Number.parseInt(match.split("=")[1] ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Invalid ${flag} value: ${match}`);
  }
  return Math.floor(raw / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
}

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE missing — set it in .env.local");
  process.exit(1);
}

const MATURITY_TURNS = 48;
const COUNTRY_ID = COUNTRY_CONFIGS.US.id;

// Default issuance amounts: $10B each, matching the rough scale of the
// surviving US sovereign series. Override via --issued-204 / --issued-216.
const DEFAULT_ISSUED_204 = 10_000_000_000;
const DEFAULT_ISSUED_216 = 10_000_000_000;

interface PlannedIssuance {
  issuedAtTurn: number;
  maturityTurn: number;
  issueAmount: number;
}

async function planIssuances(db: Db): Promise<PlannedIssuance[]> {
  const issued204 = parseAmountArg("--issued-204", DEFAULT_ISSUED_204);
  const issued216 = parseAmountArg("--issued-216", DEFAULT_ISSUED_216);

  const targets: PlannedIssuance[] = [
    { issuedAtTurn: 204, maturityTurn: 204 + MATURITY_TURNS, issueAmount: issued204 },
    { issuedAtTurn: 216, maturityTurn: 216 + MATURITY_TURNS, issueAmount: issued216 },
  ];

  const planned: PlannedIssuance[] = [];
  for (const target of targets) {
    const existing = await db.collection<Bond>("bonds").findOne({
      issuerType: "sovereign",
      countryId: COUNTRY_ID,
      issuedAtTurn: target.issuedAtTurn,
    });
    if (existing) {
      console.log(
        `Skip issuedAtTurn=${target.issuedAtTurn}: existing sovereign US bond found (_id=${existing._id.toString()}).`
      );
      continue;
    }
    planned.push(target);
  }
  return planned;
}

async function executeIssuance(
  db: Db,
  now: Date,
  plan: PlannedIssuance,
  countryCorporationId: ObjectId | null,
  couponRate: number
): Promise<{ insertedBondId: ObjectId | null; principalDelta: number; interestDelta: number }> {
  const totalUnits = Math.floor(plan.issueAmount / BOND_UNIT_FACE_VALUE);
  const totalIssued = totalUnits * BOND_UNIT_FACE_VALUE;
  const annualCouponCost = (couponRate / 100) * totalIssued;

  const bondDoc: Omit<Bond, "_id"> = {
    issuerType: "sovereign",
    corporationId: countryCorporationId ?? new ObjectId(),
    countryId: COUNTRY_ID,
    issuerName: getSovereignIssuerName(COUNTRY_ID),
    faceValue: BOND_UNIT_FACE_VALUE,
    couponRate,
    maturityTurns: MATURITY_TURNS,
    issuedAtTurn: plan.issuedAtTurn,
    maturityTurn: plan.maturityTurn,
    marketPrice: 1.0,
    totalIssued,
    publicFloat: totalUnits,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: now,
    updatedAt: now,
  };

  if (!apply) {
    console.log(
      `  [dry-run] Would insert bond: issuedAtTurn=${plan.issuedAtTurn} maturityTurn=${plan.maturityTurn} ` +
        `couponRate=${couponRate}% totalIssued=$${totalIssued.toLocaleString()} publicFloat=${totalUnits.toLocaleString()} units`
    );
    return { insertedBondId: null, principalDelta: totalIssued, interestDelta: annualCouponCost };
  }

  const insert = await db.collection<Omit<Bond, "_id">>("bonds").insertOne(bondDoc);
  console.log(
    `  Inserted bond ${insert.insertedId.toString()}: issuedAtTurn=${plan.issuedAtTurn} ` +
      `maturityTurn=${plan.maturityTurn} couponRate=${couponRate}% totalIssued=$${totalIssued.toLocaleString()}`
  );
  return {
    insertedBondId: insert.insertedId,
    principalDelta: totalIssued,
    interestDelta: annualCouponCost,
  };
}

async function applyBudgetAdjustment(
  db: Db,
  now: Date,
  principalDelta: number,
  interestDelta: number
): Promise<void> {
  if (principalDelta === 0 && interestDelta === 0) return;

  const budgetId = getNationalBudgetId(COUNTRY_ID);
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budgetId } as unknown as { _id: string });
  if (!budget) {
    throw new Error(`Federal budget not found for US (_id="${budgetId}")`);
  }

  const update = applySovereignDebtAdjustment(budget, principalDelta, interestDelta);
  console.log("\nFederal budget adjustment:");
  console.log(
    `  principal:   $${budget.debt.principal.toLocaleString()} → $${update.debt.principal.toLocaleString()} (Δ $${principalDelta.toLocaleString()})`
  );
  console.log(
    `  debtInterest: $${budget.spending.debtInterest.toLocaleString()} → $${update.spending.debtInterest.toLocaleString()} (Δ $${interestDelta.toLocaleString()})`
  );
  console.log(
    `  surplus:     $${budget.surplus.toLocaleString()} → $${update.surplus.toLocaleString()}`
  );
  console.log(
    `  debtToGdpRatio: ${budget.debtToGdpRatio.toFixed(4)} → ${update.debtToGdpRatio.toFixed(4)}`
  );
  console.log(`  creditRating: ${budget.creditRating} → ${update.creditRating}`);

  if (!apply) {
    console.log("  [dry-run] Budget update NOT written.");
    return;
  }

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId } as unknown as { _id: string }, {
      $set: {
        debt: update.debt,
        spending: update.spending,
        surplus: update.surplus,
        debtToGdpRatio: update.debtToGdpRatio,
        creditRating: update.creditRating,
        updatedAt: now,
      },
    });
  console.log("  Budget updated.");
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log(`Mode: ${apply ? "APPLY (writing changes)" : "DRY-RUN (no changes)"}`);
  console.log();

  const [countryCorp, centralBank] = await Promise.all([
    db.collection<Corporation>("corporations").findOne({ countryOwnerId: COUNTRY_ID }),
    db.collection<CentralBank>("centralBanks").findOne({ _id: COUNTRY_ID }),
  ]);
  const couponRate =
    centralBank?.primeRate ?? COUNTRY_CONFIGS.US.centralBank.defaultPrimeRate ?? 5.5;
  console.log(`Using couponRate = ${couponRate}% (current US prime rate).`);
  if (countryCorp) {
    console.log(`Country corporation: ${countryCorp.name} (_id=${countryCorp._id.toString()})`);
  } else {
    console.log("Country corporation NOT FOUND — will use a synthetic ObjectId on inserted bonds.");
  }

  const plan = await planIssuances(db);
  if (plan.length === 0) {
    console.log("\nNothing to backfill.");
    await client.close();
    return;
  }

  console.log(`\nBackfilling ${plan.length} bond series:`);
  const now = new Date();
  let totalPrincipalDelta = 0;
  let totalInterestDelta = 0;
  for (const step of plan) {
    const result = await executeIssuance(db, now, step, countryCorp?._id ?? null, couponRate);
    totalPrincipalDelta += result.principalDelta;
    totalInterestDelta += result.interestDelta;
  }

  await applyBudgetAdjustment(db, now, totalPrincipalDelta, totalInterestDelta);

  console.log(apply ? "\nDone." : "\nDone (dry-run). Re-run with --apply to write.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
