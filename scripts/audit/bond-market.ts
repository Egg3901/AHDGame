#!/usr/bin/env tsx
/**
 * Bond market audit (read-only).
 *
 *   npx tsx scripts/audit/bond-market.ts [--json]
 *
 * Per currency: units outstanding, units held by the market pool (publicFloat)
 * and by each holder type, pool cash against target, coupon income the pool
 * earns per turn, and the invariants that must hold once the pool is live:
 *
 *   1. publicFloat + sum(holders.units) + centralBankHoldings == totalIssued / face
 *   2. pool.cashLocal == sum(In flows) - sum(Out flows) + seed
 *   3. sovereign bonds outstanding <= budget principal, per country
 *
 * Superseded bond docs (refinance / restructure / cash cure leave the old doc
 * `matured` with `defaultCure` set and holders in place) are reported
 * separately and are NOT unpaid holdings.
 */

import { connectDb, closeDb } from "../utils/db";
import type { Bond, BondMarketPool, FederalBudget } from "../../src/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "../../src/lib/db/types/bond";
import { BOND_MARKET_POOLS_COLLECTION } from "../../src/lib/db/types/bondMarketPool";
import { getNationalBudgetId } from "../../src/lib/bonds/sovereign";
import { COUNTRY_CURRENCY_MAP } from "../../src/lib/constants/currencies";
import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";

type HolderKind = "character" | "imperial" | "corporation" | "fund" | "npp";

interface CurrencyRow {
  currency: string;
  activeSeries: number;
  defaultedSeries: number;
  unitsOutstanding: number;
  poolUnits: number;
  poolShare: number;
  centralBankUnits: number;
  held: Record<HolderKind, number>;
  neverBought: number;
  unsoldUnits: number;
  poolCouponPerTurnLocal: number;
  poolCash: number | null;
  poolTarget: number | null;
  poolCashFromFlows: number | null;
  unitInvariantViolations: number;
}

function holderKind(h: Bond["holders"][number]): HolderKind | null {
  if (h.characterId) return "character";
  if (h.imperialCharacterId) return "imperial";
  if (h.corporationId) return "corporation";
  if (h.fundId) return "fund";
  if (h.nppId) return "npp";
  return null;
}

function currencyOf(bond: Bond): string {
  return (
    bond.currencyCode ??
    (bond.countryId ? COUNTRY_CURRENCY_MAP[bond.countryId] : undefined) ??
    "USD"
  );
}

function poolCashFromFlows(pool: BondMarketPool): number {
  const f = pool.lifetime ?? {};
  const inFlows =
    (f.purchasesIn ?? 0) +
    (f.couponsIn ?? 0) +
    (f.maturitiesIn ?? 0) +
    (f.qeIn ?? 0) +
    (f.retiredIn ?? 0) +
    (f.recoveriesIn ?? 0);
  const outFlows = (f.salesOut ?? 0) + (f.issuanceOut ?? 0) + (f.qtOut ?? 0) + (f.estateOut ?? 0);
  // Seed cash equals targetCashLocal at migration time; if the target has been
  // re-sized since, this reads as a drift and the note says so.
  return pool.targetCashLocal + inFlows - outFlows;
}

async function main() {
  const json = process.argv.includes("--json");
  const db = await connectDb();

  const [bonds, pools, budgets, turnDoc] = await Promise.all([
    db.collection<Bond>("bonds").find({}).toArray(),
    db.collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION).find({}).toArray(),
    db.collection<FederalBudget>("federalBudget").find({}).toArray(),
    db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
  ]);
  const poolById = new Map(pools.map((p) => [String(p._id), p]));

  const rows = new Map<string, CurrencyRow>();
  let superseded = 0;
  let maturedUnpaid = 0;
  const violations: string[] = [];

  for (const bond of bonds) {
    if (bond.matured) {
      if (bond.holders?.length > 0 && !bond.redeemedAtTurn) {
        if (bond.defaultCure) superseded++;
        else maturedUnpaid++;
      }
      continue;
    }
    const currency = currencyOf(bond);
    let row = rows.get(currency);
    if (!row) {
      const pool = poolById.get(currency);
      row = {
        currency,
        activeSeries: 0,
        defaultedSeries: 0,
        unitsOutstanding: 0,
        poolUnits: 0,
        poolShare: 0,
        centralBankUnits: 0,
        held: { character: 0, imperial: 0, corporation: 0, fund: 0, npp: 0 },
        neverBought: 0,
        unsoldUnits: 0,
        poolCouponPerTurnLocal: 0,
        poolCash: pool ? pool.cashLocal : null,
        poolTarget: pool ? pool.targetCashLocal : null,
        poolCashFromFlows: pool ? poolCashFromFlows(pool) : null,
        unitInvariantViolations: 0,
      };
      rows.set(currency, row);
    }
    if (bond.defaulted) row.defaultedSeries++;
    else row.activeSeries++;
    const totalUnits = (bond.totalIssued ?? 0) / BOND_UNIT_FACE_VALUE;
    const heldUnits = (bond.holders ?? []).reduce((s, h) => s + (h.units ?? 0), 0);
    const cbUnits = bond.centralBankHoldings ?? 0;
    row.unitsOutstanding += totalUnits;
    row.poolUnits += bond.publicFloat ?? 0;
    row.centralBankUnits += cbUnits;
    for (const h of bond.holders ?? []) {
      const kind = holderKind(h);
      if (kind) row.held[kind] += h.units ?? 0;
    }
    if (heldUnits === 0) row.neverBought++;
    row.unsoldUnits += bond.unsoldUnits ?? 0;
    if (!bond.defaulted) {
      row.poolCouponPerTurnLocal +=
        (((bond.couponRate ?? 0) / 100) * BOND_UNIT_FACE_VALUE * (bond.publicFloat ?? 0)) /
        TURNS_PER_YEAR;
    }
    const lhs = (bond.publicFloat ?? 0) + heldUnits + cbUnits;
    if (Math.abs(lhs - totalUnits) > 1) {
      row.unitInvariantViolations++;
      if (violations.length < 25) {
        violations.push(
          `${bond._id} ${bond.issuerType ?? "corporation"} ${currency}: float ${bond.publicFloat} + held ${heldUnits} + cb ${cbUnits} != ${totalUnits}`
        );
      }
    }
  }
  for (const row of rows.values()) {
    row.poolShare = row.unitsOutstanding > 0 ? row.poolUnits / row.unitsOutstanding : 0;
  }

  // Sovereign bonds outstanding vs budget principal.
  const sovereignByCountry = new Map<string, number>();
  for (const bond of bonds) {
    if (bond.matured || bond.defaulted || bond.issuerType !== "sovereign" || !bond.countryId)
      continue;
    sovereignByCountry.set(
      bond.countryId,
      (sovereignByCountry.get(bond.countryId) ?? 0) + (bond.totalIssued ?? 0)
    );
  }
  const budgetById = new Map(budgets.map((b) => [String(b._id), b]));
  const principalGaps: Array<{ countryId: string; bonds: number; principal: number }> = [];
  for (const [countryId, face] of sovereignByCountry) {
    const budget = budgetById.get(getNationalBudgetId(countryId as never));
    const principal = budget?.debt?.principal ?? 0;
    if (face > principal + BOND_UNIT_FACE_VALUE)
      principalGaps.push({ countryId, bonds: face, principal });
  }

  const report = {
    turn: turnDoc?.currentTurn ?? null,
    currencies: [...rows.values()].sort((a, b) => b.unitsOutstanding - a.unitsOutstanding),
    supersededDocsWithHolders: superseded,
    maturedUnpaidWithHolders: maturedUnpaid,
    unitInvariantViolations: violations,
    sovereignOverPrincipal: principalGaps.sort(
      (a, b) => b.bonds - b.principal - (a.bonds - a.principal)
    ),
    poolsWithoutBonds: pools.map((p) => String(p._id)).filter((id) => !rows.has(id)),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const fmt = (n: number | null) => (n == null ? "-" : Math.round(n).toLocaleString("en-US"));
    console.log(`Bond market audit, turn ${report.turn}`);
    console.log(
      "ccy      series(def)  units          pool%   pool units     char      corp       fund      npp    never   unsold  coupon/turn->pool  pool cash        target          drift"
    );
    for (const r of report.currencies) {
      const drift =
        r.poolCash != null && r.poolCashFromFlows != null ? r.poolCash - r.poolCashFromFlows : null;
      console.log(
        [
          r.currency.padEnd(8),
          `${r.activeSeries}(${r.defaultedSeries})`.padEnd(12),
          fmt(r.unitsOutstanding).padStart(14),
          `${(r.poolShare * 100).toFixed(1)}%`.padStart(7),
          fmt(r.poolUnits).padStart(14),
          fmt(r.held.character).padStart(9),
          fmt(r.held.corporation).padStart(10),
          fmt(r.held.fund).padStart(10),
          fmt(r.held.npp).padStart(8),
          String(r.neverBought).padStart(6),
          fmt(r.unsoldUnits).padStart(8),
          fmt(r.poolCouponPerTurnLocal).padStart(18),
          fmt(r.poolCash).padStart(16),
          fmt(r.poolTarget).padStart(15),
          fmt(drift).padStart(14),
        ].join(" ")
      );
    }
    console.log(`\nsuperseded bond docs still carrying holders (cured, not owed): ${superseded}`);
    console.log(`matured bond docs with holders and no redemption stamp (OWED): ${maturedUnpaid}`);
    console.log(`unit invariant violations: ${violations.length}`);
    for (const v of violations) console.log(`  ${v}`);
    console.log(`sovereign bonds outstanding above budget principal: ${principalGaps.length}`);
    for (const g of report.sovereignOverPrincipal)
      console.log(
        `  ${g.countryId}: bonds ${fmt(g.bonds)} vs principal ${fmt(g.principal)} (excess ${fmt(g.bonds - g.principal)})`
      );
    if (report.poolsWithoutBonds.length > 0)
      console.log(`pools with no active bonds: ${report.poolsWithoutBonds.join(", ")}`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
