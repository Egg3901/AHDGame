/**
 * Ticket #1198 balance harness — the exit-equity debt ceiling.
 *
 * Reports what `MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION` does to every
 * corporation carrying live bond debt in the production world, and what the
 * portfolio leg of `corpExitEquityAnchor` does to the insolvency gate.
 *
 * READ ONLY. Deterministic: it takes a single snapshot of the live world and
 * derives everything from it with the real production functions. It opens no
 * write path and does not advance a turn.
 *
 *   npx tsx scripts/sim/ticket1198ExitEquityCeiling.ts
 *
 * Requires MONGODB_URI_LIVE in .env.local.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import type { Bond, Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpExitEquityAnchor } from "@/lib/bonds/corpExitEquity";
import { sumBondPrincipalAnchor } from "@/lib/bonds/bondPrincipalSum";
import {
  MAX_BOND_ISSUANCE_FRACTION,
  MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION,
} from "@/lib/constants/bonds";
import {
  sumCorporateSectorNpv,
  sumCorporateSectorConstructionInProgress,
} from "@/lib/bonds/corporateCredit";
import {
  corpCapitalToAnchor,
  resolveCorpLiquidCurrencyCode,
  fxRateForCorpFromMap,
} from "@/lib/currency/corporationCapital";

dotenv.config({ path: ".env.local" });

const A = (n: number) => "A" + Math.round(n).toLocaleString();
const pct = (n: number) => (n * 100).toFixed(1) + "%";

interface Row {
  seq: number;
  name: string;
  isNatcorp: boolean;
  cashAnchor: number;
  debtAnchor: number;
  goingConcernEquity: number;
  exitEquity: number;
  portfolio: number;
  oldCeiling: number;
  newCeiling: number;
  /** True when the pre-fix gate (cash + sector book, no portfolio) would default it. */
  insolventBefore: boolean;
  /** True when the post-fix gate still would. */
  insolventAfter: boolean;
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE is not set");
  const client = new MongoClient(
    uri.includes("directConnection")
      ? uri
      : uri + (uri.includes("?") ? "&" : "?") + "directConnection=true",
    { serverSelectionTimeoutMS: 30_000 }
  );
  await client.connect();
  const db = client.db("a-house-divided");

  const [rates, cbs, gameState, allBonds, sectors] = await Promise.all([
    db.collection("exchangeRates").find({}).toArray(),
    db.collection("centralBanks").find({}).toArray(),
    db.collection("gameState").findOne({ _id: "current" as never }),
    db.collection<Bond>("bonds").find({ matured: false }).toArray(),
    db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
  ]);
  const fx = new Map<CurrencyCode, number>(
    rates.map((r) => [r.currencyCode as CurrencyCode, r.rate as number])
  );
  const prime = new Map<string, number>(
    cbs.map((b) => [b.countryId as string, b.primeRate as number])
  );
  const currentYear = (gameState as { currentYear?: number } | null)?.currentYear;

  const issuerIds = [
    ...new Set(allBonds.filter((b) => b.corporationId).map((b) => b.corporationId.toString())),
  ];
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: issuerIds.map((s) => new ObjectId(s)) } })
    .toArray();

  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const k = s.corporationId?.toString();
    if (!k) continue;
    const list = sectorsByCorp.get(k);
    if (list) list.push(s);
    else sectorsByCorp.set(k, [s]);
  }

  const rows: Row[] = [];
  for (const corp of corps) {
    const k = corp._id.toString();
    const own = sectorsByCorp.get(k) ?? [];
    const debtAnchor = sumBondPrincipalAnchor(
      allBonds.filter((b) => b.corporationId?.toString() === k),
      fx
    );
    if (debtAnchor <= 0) continue;

    const cashAnchor = corpCapitalToAnchor(
      corp.liquidCapital,
      resolveCorpLiquidCurrencyCode(corp),
      fxRateForCorpFromMap(corp, fx)
    );
    const ee = corpExitEquityAnchor({
      liquidCapitalAnchor: cashAnchor,
      sectors: own,
      corporationId: k,
      corp,
      fxByCurrency: fx,
      primeRateByCountry: prime,
      bonds: allBonds,
      plantsEnabled: true,
      currentYear,
      eraUnitScale: 1,
    });
    const goingConcernEquity =
      cashAnchor +
      sumCorporateSectorNpv(own, corp._id, prime as never, corp, fx, true) +
      sumCorporateSectorConstructionInProgress(own, corp._id);

    const oldCeiling = Math.max(0, goingConcernEquity * MAX_BOND_ISSUANCE_FRACTION);
    const newCeiling = Math.max(
      0,
      Math.min(oldCeiling, ee.exitEquityAnchor * MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION)
    );
    // Pre-fix gate: cash + sector book only, portfolio ignored.
    const equityBefore = ee.exitEquityAnchor - ee.heldBondFaceAnchor;

    rows.push({
      seq: (corp as { sequentialId?: number }).sequentialId ?? -1,
      name: corp.name,
      isNatcorp: ((corp as { sequentialId?: number }).sequentialId ?? 0) >= 900_000,
      cashAnchor,
      debtAnchor,
      goingConcernEquity,
      exitEquity: ee.exitEquityAnchor,
      portfolio: ee.heldBondFaceAnchor,
      oldCeiling,
      newCeiling,
      insolventBefore: equityBefore < debtAnchor,
      insolventAfter: ee.exitEquityAnchor < debtAnchor,
    });
  }

  rows.sort((a, b) => b.debtAnchor - a.debtAnchor);
  const player = rows.filter((r) => !r.isNatcorp);

  console.log(`# Ticket #1198 balance report\n`);
  console.log(
    `World turn ${(gameState as { currentTurn?: number } | null)?.currentTurn}, ` +
      `${rows.length} corporations carry live bond debt ` +
      `(${player.length} player corporations, ${rows.length - player.length} natcorps).`
  );
  console.log(
    `\nNatcorps are excluded from the insolvency gate by bondTurn.ts, so the ` +
      `default-risk columns below are meaningful only for player corporations.\n`
  );

  console.log(`## Ceiling change, player corporations\n`);
  console.log(
    `| # | Corporation | Debt | Going-concern ceiling | Exit ceiling | Ceiling retained | Room left |`
  );
  console.log(`| ---: | --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of player) {
    const retained = r.oldCeiling > 0 ? r.newCeiling / r.oldCeiling : 1;
    const room = r.newCeiling - r.debtAnchor;
    console.log(
      `| ${r.seq} | ${r.name} | ${A(r.debtAnchor)} | ${A(r.oldCeiling)} | ${A(r.newCeiling)} | ` +
        `${pct(retained)} | ${room >= 0 ? A(room) : "over by " + A(-room)} |`
    );
  }

  const overCeiling = player.filter((r) => r.debtAnchor > r.newCeiling);
  const rescued = player.filter((r) => r.insolventBefore && !r.insolventAfter);
  const stillAtRisk = player.filter((r) => r.insolventAfter);

  console.log(`\n## Summary\n`);
  console.log(
    `- Player corporations already above the new ceiling: **${overCeiling.length} of ${player.length}**.`
  );
  console.log(
    `  They keep every bond they hold and are not defaulted for it; they simply cannot issue more.`
  );
  console.log(
    `- Spared by the portfolio leg (would have defaulted pre-fix, solvent now): **${rescued.length}**.`
  );
  for (const r of rescued) {
    console.log(
      `  - #${r.seq} ${r.name}: portfolio ${A(r.portfolio)} against a ` +
        `${A(r.debtAnchor - (r.exitEquity - r.portfolio))} shortfall.`
    );
  }
  console.log(`- Still judged insolvent if they go cash-negative: **${stillAtRisk.length}**.`);
  for (const r of stillAtRisk) {
    console.log(
      `  - #${r.seq} ${r.name}: exit equity ${A(r.exitEquity)} against debt ${A(r.debtAnchor)}` +
        `${r.cashAnchor < 0 ? " (cash-negative NOW)" : ""}.`
    );
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
