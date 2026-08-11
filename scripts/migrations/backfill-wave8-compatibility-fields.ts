/**
 * Dry-run-first Wave 8 compatibility backfill.
 *
 * This script closes the remaining live-data compatibility windows that still
 * keep Wave 8 cleanup from safely deleting fallback logic:
 * - `partyBudget.countryId`
 * - `stateDemographicTurnout.countryId`
 * - `billWhips.audience`
 * - `bonds.countryId`
 *
 * It also audits the earlier "campaigns without currencyBalances" concern and
 * reports the real compatibility surface: `characters.currencyBalances.campaign`.
 *
 * Usage:
 *   npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts
 *   npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts --apply
 *   npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts --db=local
 *
 * Defaults to `MONGODB_URI_LIVE`. Pass `--db=local` to use `MONGODB_URI`.
 * Nothing is written unless `--apply` is present.
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "../../src/lib/constants/currencies";
import type { CountryId } from "../../src/lib/constants/countries";
import type {
  Bond,
  Character,
  PartyBudget,
  PoliticalParty,
  State,
  StateDemographicTurnout,
  StatePartyOrg,
  BillWhip,
  Corporation,
} from "../../src/lib/db/types";

type StoredPartyBudget = PartyBudget & { countryId?: CountryId };
type StoredTurnout = StateDemographicTurnout & { countryId?: CountryId };
type StoredBillWhip = BillWhip & { audience?: "npp" | "character" };
type StoredBond = Bond & { countryId?: CountryId };
type PartyBudgetProjection = {
  _id: ObjectId;
  partyId: string;
  scope: "national" | "state";
  stateId?: string;
  countryId?: CountryId;
  gotvTargetCategory?: string;
  suppressionTargetCategory?: string;
};

interface GameStateRow {
  _id: string;
  isActive?: boolean;
  isProcessing?: boolean;
}

interface MigrationSummary {
  label: string;
  scanned: number;
  alreadyCompatible: number;
  resolvable: number;
  modified: number;
  unresolved: number;
  byCountry?: Map<string, number>;
  notes: string[];
}

const COUNTRY_PREFIX_MAP: Record<string, CountryId> = {
  us_: "US",
  uk_: "UK",
  jp_: "JP",
  de_: "DE",
};

const UNIQUE_COUNTRY_BY_CURRENCY = new Map<CurrencyCode, CountryId | null>();

for (const [countryId, currencyCode] of Object.entries(COUNTRY_CURRENCY_MAP) as [
  CountryId,
  CurrencyCode,
][]) {
  const existing = UNIQUE_COUNTRY_BY_CURRENCY.get(currencyCode);
  if (existing === undefined) {
    UNIQUE_COUNTRY_BY_CURRENCY.set(currencyCode, countryId);
  } else if (existing !== countryId) {
    UNIQUE_COUNTRY_BY_CURRENCY.set(currencyCode, null);
  }
}

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
  }

  dotenv.config();
  return null;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function printSummary(summary: MigrationSummary, apply: boolean) {
  console.log(`\n[wave8-compat] ${summary.label}`);
  console.log(`  scanned             : ${summary.scanned}`);
  console.log(`  already compatible  : ${summary.alreadyCompatible}`);
  console.log(`  can backfill        : ${summary.resolvable}`);
  console.log(
    `  ${apply ? "modified".padEnd(19) : "would modify".padEnd(19)}: ${summary.modified}`
  );
  console.log(`  unresolved          : ${summary.unresolved}`);
  if (summary.byCountry && summary.byCountry.size > 0) {
    for (const [countryId, count] of [...summary.byCountry.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      console.log(`    ${countryId}: ${count}`);
    }
  }
  for (const note of summary.notes) {
    console.log(`  note                : ${note}`);
  }
}

async function warnIfTurnsActive(db: Db, label: string) {
  const gameState =
    (await db.collection<GameStateRow>("gameState").findOne({ _id: "current" })) ?? null;
  if (gameState?.isActive || gameState?.isProcessing) {
    console.warn(
      `[${label}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
        `isProcessing=${gameState.isProcessing ?? false}. Pause turns before applying this ` +
        `migration. Continuing in 10 seconds; abort with Ctrl-C if this is unexpected.`
    );
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

function incrementCountry(bucket: Map<string, number>, countryId: string | undefined) {
  if (!countryId) return;
  bucket.set(countryId, (bucket.get(countryId) ?? 0) + 1);
}

function inferCountryIdFromTargetCategory(
  categories: Array<string | undefined>
): CountryId | undefined {
  const inferred = new Set<CountryId>();

  for (const category of categories) {
    if (!category) continue;
    const lowered = category.toLowerCase();
    for (const [prefix, countryId] of Object.entries(COUNTRY_PREFIX_MAP) as [string, CountryId][]) {
      if (lowered.startsWith(prefix)) {
        inferred.add(countryId);
      }
    }
  }

  return inferred.size === 1 ? [...inferred][0] : undefined;
}

async function backfillPartyBudgetCountryId(db: Db, apply: boolean): Promise<MigrationSummary> {
  const budgets = await db
    .collection<StoredPartyBudget>("partyBudget")
    .find({})
    .project<PartyBudgetProjection>({
      _id: 1,
      partyId: 1,
      scope: 1,
      stateId: 1,
      countryId: 1,
      gotvTargetCategory: 1,
      suppressionTargetCategory: 1,
    })
    .toArray();

  const [states, parties, statePartyOrgs] = await Promise.all([
    db
      .collection<State>("states")
      .find({})
      .project<Pick<State, "_id" | "countryId">>({
        _id: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({})
      .project<Pick<PoliticalParty, "sequentialId" | "countryId">>({
        sequentialId: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({})
      .project<Pick<StatePartyOrg, "_id" | "countryId" | "stateId" | "partyId">>({
        _id: 1,
        countryId: 1,
        stateId: 1,
        partyId: 1,
      })
      .toArray(),
  ]);

  const stateCountryById = new Map<string, CountryId>(
    states.map((state) => [state._id, state.countryId])
  );
  const statePartyCountryByKey = new Map<string, CountryId>(
    statePartyOrgs.map((row) => [`${row.stateId}:${row.partyId}`, row.countryId])
  );
  const uniquePartyCountryById = new Map<string, CountryId | null>();
  for (const party of parties) {
    const key = String(party.sequentialId);
    const existing = uniquePartyCountryById.get(key);
    if (existing === undefined) {
      uniquePartyCountryById.set(key, party.countryId);
    } else if (existing !== party.countryId) {
      uniquePartyCountryById.set(key, null);
    }
  }

  const ops: AnyBulkWriteOperation<StoredPartyBudget>[] = [];
  const byCountry = new Map<string, number>();
  const notes: string[] = [];
  let alreadyCompatible = 0;
  let resolvable = 0;
  let unresolved = 0;

  for (const budget of budgets) {
    if (budget.countryId) {
      alreadyCompatible += 1;
      continue;
    }

    let resolvedCountryId: CountryId | undefined;
    let conflict = false;

    if (budget.scope === "state" && budget.stateId) {
      const stateCountry = stateCountryById.get(budget.stateId);
      const statePartyCountry = statePartyCountryByKey.get(`${budget.stateId}:${budget.partyId}`);
      const uniquePartyCountry = uniquePartyCountryById.get(budget.partyId);

      resolvedCountryId = stateCountry;
      if (stateCountry && statePartyCountry && stateCountry !== statePartyCountry) {
        conflict = true;
      }
      if (stateCountry && uniquePartyCountry && stateCountry !== uniquePartyCountry) {
        conflict = true;
      }
    } else {
      const uniquePartyCountry = uniquePartyCountryById.get(budget.partyId);
      if (uniquePartyCountry) {
        resolvedCountryId = uniquePartyCountry;
      } else {
        resolvedCountryId = inferCountryIdFromTargetCategory([
          budget.gotvTargetCategory,
          budget.suppressionTargetCategory,
        ]);
      }
    }

    if (!resolvedCountryId || conflict) {
      unresolved += 1;
      continue;
    }

    resolvable += 1;
    incrementCountry(byCountry, resolvedCountryId);
    ops.push({
      updateOne: {
        filter: { _id: budget._id, countryId: { $exists: false } },
        update: { $set: { countryId: resolvedCountryId, updatedAt: new Date() } },
      },
    });
  }

  let modified = 0;
  if (apply && ops.length > 0) {
    const result = await db.collection<StoredPartyBudget>("partyBudget").bulkWrite(ops);
    modified = result.modifiedCount;
  } else if (!apply) {
    modified = ops.length;
  }

  if (unresolved > 0) {
    notes.push("Some rows could not be inferred safely and were left untouched.");
  }

  return {
    label: "partyBudget.countryId",
    scanned: budgets.length,
    alreadyCompatible,
    resolvable,
    modified,
    unresolved,
    byCountry,
    notes,
  };
}

async function backfillStateTurnoutCountryId(db: Db, apply: boolean): Promise<MigrationSummary> {
  const [turnoutRows, states] = await Promise.all([
    db
      .collection<StoredTurnout>("stateDemographicTurnout")
      .find({})
      .project<Pick<StoredTurnout, "_id" | "countryId">>({
        _id: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<State>("states")
      .find({})
      .project<Pick<State, "_id" | "countryId">>({
        _id: 1,
        countryId: 1,
      })
      .toArray(),
  ]);

  const stateCountryById = new Map(states.map((state) => [state._id, state.countryId]));
  const ops: AnyBulkWriteOperation<StoredTurnout>[] = [];
  const byCountry = new Map<string, number>();
  let alreadyCompatible = 0;
  let resolvable = 0;
  let unresolved = 0;

  for (const row of turnoutRows) {
    if (row.countryId) {
      alreadyCompatible += 1;
      continue;
    }

    const countryId = stateCountryById.get(row._id);
    if (!countryId) {
      unresolved += 1;
      continue;
    }

    resolvable += 1;
    incrementCountry(byCountry, countryId);
    ops.push({
      updateOne: {
        filter: { _id: row._id, countryId: { $exists: false } },
        update: { $set: { countryId } },
      },
    });
  }

  let modified = 0;
  if (apply && ops.length > 0) {
    const result = await db.collection<StoredTurnout>("stateDemographicTurnout").bulkWrite(ops);
    modified = result.modifiedCount;
  } else if (!apply) {
    modified = ops.length;
  }

  return {
    label: "stateDemographicTurnout.countryId",
    scanned: turnoutRows.length,
    alreadyCompatible,
    resolvable,
    modified,
    unresolved,
    byCountry,
    notes: unresolved > 0 ? ["Rows without a matching state were skipped."] : [],
  };
}

async function backfillBillWhipAudience(db: Db, apply: boolean): Promise<MigrationSummary> {
  const whips = await db
    .collection<StoredBillWhip>("billWhips")
    .find({})
    .project<Pick<StoredBillWhip, "_id" | "audience" | "countryId">>({
      _id: 1,
      audience: 1,
      countryId: 1,
    })
    .toArray();

  const ops: AnyBulkWriteOperation<StoredBillWhip>[] = [];
  const byCountry = new Map<string, number>();
  let alreadyCompatible = 0;

  for (const whip of whips) {
    if (whip.audience) {
      alreadyCompatible += 1;
      continue;
    }

    incrementCountry(byCountry, whip.countryId);
    ops.push({
      updateOne: {
        filter: { _id: whip._id, audience: { $exists: false } },
        update: { $set: { audience: "npp" } },
      },
    });
  }

  let modified = 0;
  if (apply && ops.length > 0) {
    const result = await db.collection<StoredBillWhip>("billWhips").bulkWrite(ops);
    modified = result.modifiedCount;
  } else if (!apply) {
    modified = ops.length;
  }

  return {
    label: "billWhips.audience",
    scanned: whips.length,
    alreadyCompatible,
    resolvable: ops.length,
    modified,
    unresolved: 0,
    byCountry,
    notes: ['Legacy rows are normalized to audience="npp".'],
  };
}

async function backfillBondCountryId(db: Db, apply: boolean): Promise<MigrationSummary> {
  const [bonds, corporations] = await Promise.all([
    db
      .collection<StoredBond>("bonds")
      .find({})
      .project<
        Pick<
          StoredBond,
          "_id" | "countryId" | "corporationId" | "issuerType" | "currencyCode" | "matured"
        >
      >({
        _id: 1,
        countryId: 1,
        corporationId: 1,
        issuerType: 1,
        currencyCode: 1,
        matured: 1,
      })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({})
      .project<Pick<Corporation, "_id" | "countryId">>({
        _id: 1,
        countryId: 1,
      })
      .toArray(),
  ]);

  const corpCountryById = new Map(
    corporations.map((corp) => [corp._id.toString(), corp.countryId])
  );
  const ops: AnyBulkWriteOperation<StoredBond>[] = [];
  const byCountry = new Map<string, number>();
  const notes: string[] = [];
  let alreadyCompatible = 0;
  let resolvable = 0;
  let unresolved = 0;
  let stampedLegacyIssuerType = 0;

  for (const bond of bonds) {
    if (bond.countryId) {
      alreadyCompatible += 1;
      continue;
    }

    if (bond.issuerType === "sovereign") {
      unresolved += 1;
      continue;
    }

    let countryId = corpCountryById.get(bond.corporationId.toString());
    if (!countryId && bond.matured && bond.currencyCode) {
      const uniqueCurrencyCountry = UNIQUE_COUNTRY_BY_CURRENCY.get(bond.currencyCode);
      if (uniqueCurrencyCountry) {
        countryId = uniqueCurrencyCountry;
      }
    }
    if (!countryId) {
      unresolved += 1;
      continue;
    }

    resolvable += 1;
    incrementCountry(byCountry, countryId);
    if (!bond.issuerType) stampedLegacyIssuerType += 1;
    ops.push({
      updateOne: {
        filter: { _id: bond._id, countryId: { $exists: false } },
        update: {
          $set: {
            countryId,
            ...(bond.issuerType ? {} : { issuerType: "corporation" as const }),
            updatedAt: new Date(),
          },
        },
      },
    });
  }

  let modified = 0;
  if (apply && ops.length > 0) {
    const result = await db.collection<StoredBond>("bonds").bulkWrite(ops);
    modified = result.modifiedCount;
  } else if (!apply) {
    modified = ops.length;
  }

  if (stampedLegacyIssuerType > 0) {
    notes.push(
      `Also stamps issuerType="corporation" on ${stampedLegacyIssuerType} legacy corporate bond rows.`
    );
  }
  if (unresolved > 0) {
    notes.push("Unresolved rows were left untouched (for example orphaned or sovereign rows).");
  }

  return {
    label: "bonds.countryId",
    scanned: bonds.length,
    alreadyCompatible,
    resolvable,
    modified,
    unresolved,
    byCountry,
    notes,
  };
}

async function auditCampaignCurrencyCompatibility(db: Db): Promise<MigrationSummary> {
  const [campaignCount, missingCharacterCampaignBalances] = await Promise.all([
    db.collection("campaigns").countDocuments({}),
    db.collection<Character>("characters").countDocuments({
      "currencyBalances.campaign": { $exists: false },
    }),
  ]);

  return {
    label: "campaign currency compatibility audit",
    scanned: campaignCount,
    alreadyCompatible: campaignCount,
    resolvable: 0,
    modified: 0,
    unresolved: missingCharacterCampaignBalances,
    notes: [
      "Campaign documents do not store currencyBalances; the real compatibility surface is characters.currencyBalances.campaign.",
      `characters missing currencyBalances.campaign: ${missingCharacterCampaignBalances}`,
    ],
  };
}

async function main() {
  const envPath = loadEnvLocal();
  const dbMode = getArg("db") === "local" ? "local" : "live";
  const uriKey = dbMode === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[uriKey];
  const apply = process.argv.includes("--apply");

  if (!uri) {
    throw new Error(
      `Missing ${uriKey}. Loaded env from ${envPath ?? "default dotenv resolution"}.`
    );
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    console.log(
      `[wave8-compat] env=${envPath ?? "default"} db=${dbMode} mode=${apply ? "apply" : "dry-run"}`
    );

    if (apply) {
      await warnIfTurnsActive(db, "wave8-compat");
    }

    const summaries = await Promise.all([
      backfillPartyBudgetCountryId(db, apply),
      backfillStateTurnoutCountryId(db, apply),
      backfillBillWhipAudience(db, apply),
      backfillBondCountryId(db, apply),
      auditCampaignCurrencyCompatibility(db),
    ]);

    for (const summary of summaries) {
      printSummary(summary, apply);
    }

    const unresolved = summaries.reduce((sum, summary) => sum + summary.unresolved, 0);
    const modified = summaries.reduce((sum, summary) => sum + summary.modified, 0);
    console.log(`\n[wave8-compat] total ${apply ? "modified" : "would modify"}: ${modified}`);
    console.log(`[wave8-compat] total unresolved after run: ${unresolved}`);
    if (!apply) {
      console.log("[wave8-compat] DRY RUN ONLY - re-run with --apply to persist changes.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[wave8-compat] failed:", error);
  process.exitCode = 1;
});
