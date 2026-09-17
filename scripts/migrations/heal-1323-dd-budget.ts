/**
 * Heal for #1323 — the live corrections the code fixes cannot make on their own.
 *
 * The engine changes stop the bleeding going forward; four things are already
 * wrong in the database and stay wrong until they are written:
 *
 *   1. DD's `otherRevenueGdpShareBaseline`. The self-heal in `fiscalBaseGrowth`
 *      snapshots the CURRENT ratio, which for DD is the DRIFTED 1.5% rather than
 *      the 9% its seed authored (DDM 4.5B against a DDM 50B GDP). Left alone the
 *      self-heal would make the drift permanent. This writes the authored share.
 *
 *   2. DD's tax bases, moved to the FIXED POINT of the corrected dynamics. The
 *      premium cap stops further divergence but unwinds what is already there at
 *      only 8%/yr, so DD would otherwise spend a decade collecting against bases
 *      it should never have reached.
 *
 *      NOT re-anchored to a flat 1.00x of baseline share. That is the authored
 *      ratio, but it is not where the fixed engine settles, and healing to it
 *      would undershoot the model's own steady state: DD's revenue would drop to
 *      ~134B against ~178B of spending, a ~44B/yr hole its ~84B treasury could
 *      not carry for the decade the bases would take to climb back. The fixed
 *      point leaves DD near 168B against 178B — a small planned deficit, which
 *      is what its own seed documents as intended.
 *
 *      The multiple is COMPUTED by running the real growth step forward until it
 *      converges, so this target cannot drift from what the engine does.
 *
 *   3. Berlin's non-finite `stateBudgets` figures. The turn loop now repairs
 *      these itself, so this is belt-and-braces: it makes the repair immediate
 *      and verifiable rather than waiting for the next turn.
 *
 *   4. Stale persisted `annualRevenueV2` on DD's national enacted laws. The
 *      revenue side reprices `costModelV2.gdpRevenueFraction` against live GDP
 *      every turn, but the stored per-law figure is frozen at whatever base it
 *      was last written against (pre-reunification East Germany for the
 *      rescoped rows). Any reader of the stored field sees the stale number,
 *      so this rewrites each v2 law's figure as fraction x live base GDP -
 *      the same arithmetic `billEnactment` writes on enactment. Legacy laws
 *      with no `costModelV2` keep their persisted value; there is nothing to
 *      recompute them from.
 *
 * GUARDS. This script refuses to run against the wrong world: it aborts unless
 * the DD `federalBudget` carries currency DDM (EUR rows are pre-merger DE
 * snapshots, not the unified Germany) and unless DD owns at least one state.
 * It is idempotent: when every figure already matches, `--apply` writes
 * nothing and says so.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write. Prints stored (before) and
 * projected (after) revenue, spending and deficit so the result can be checked
 * before anything is committed to.
 *
 *   npx tsx scripts/migrations/heal-1323-dd-budget.ts
 *   npx tsx scripts/migrations/heal-1323-dd-budget.ts --apply
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type {
  EconomicGrowthFactors,
  EnactedLaw,
  FederalBudget,
  FederalTaxBases,
  StateBudget,
  StateTaxBases,
} from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types/state";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  applyPerTurnGrowthToFederalBases,
  sanitizeStateTaxBases,
  type TaxBaseGravityContext,
} from "@/lib/budget/revenue";
import { keepLatestActiveLawPerType } from "@/lib/budget/keepLatestActiveLawPerType";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const COUNTRY = "DD";
/** DD's authored non-tax share: NATIONAL_BUDGET_SEED_CONFIGS 1953 DD, 4.5B / 50B. */
const DD_AUTHORED_OTHER_SHARE = 4_500_000_000 / 50_000_000_000;

const B = (n: number | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : (n / 1e9).toFixed(2) + "B";

async function main() {
  let uri = process.env.MONGODB_URI_LIVE ?? "";
  if (!uri) throw new Error("MONGODB_URI_LIVE is not set");
  if (!/directConnection/.test(uri))
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db();
  try {
    console.log(APPLY ? "=== APPLY ===" : "=== DRY RUN (pass --apply to write) ===");
    console.log(`    database              ${db.databaseName}`);

    const budget = await db.collection<FederalBudget>("federalBudget").findOne({
      countryId: COUNTRY,
    });
    if (!budget) throw new Error("no DD federalBudget");
    // Wrong-world guard: EUR rows are pre-merger DE snapshots rescoped onto the
    // DD country id, not the unified Germany. Only a DDM book is healable.
    if (budget.currencyCode !== "DDM") {
      throw new Error(
        `refusing: DD federalBudget carries currency ${budget.currencyCode ?? "(none)"}, expected DDM`
      );
    }
    const states = await db
      .collection<State>("states")
      .find({ countryId: COUNTRY })
      .project<{ _id: string; name: string; gdp: number; population: number }>({
        _id: 1,
        name: 1,
        gdp: 1,
        population: 1,
      })
      .toArray();
    if (states.length === 0) throw new Error("refusing: DD owns no states in this world");
    const liveGdp = states.reduce((sum, s) => sum + (s.gdp ?? 0), 0) * 1_000_000;
    console.log(`    DD states             ${states.length}`);

    // ── 0. stored book (before) ─────────────────────────────────────────────
    // The reconciliation baseline: what the ledger says right now, before any
    // write. Section [projection] below prints the same three lines after the
    // heal so the two can be compared directly.
    const beforeRevenue = budget.revenue?.total ?? 0;
    const beforeSpending = budget.spending?.total ?? 0;
    const beforeGdp = budget.gdp ?? liveGdp;
    console.log(`\n[0] stored book (before)`);
    console.log(`    revenue               ${B(beforeRevenue)}`);
    console.log(`    spending              ${B(beforeSpending)}`);
    console.log(
      `    deficit               ${B(beforeRevenue - beforeSpending)}  (${(
        ((beforeRevenue - beforeSpending) / beforeGdp) *
        100
      ).toFixed(1)}% of GDP)`
    );

    // ── 1. non-tax share ────────────────────────────────────────────────────
    const currentOther = budget.revenue?.other ?? 0;
    console.log(`\n[1] otherRevenueGdpShareBaseline`);
    console.log(
      `    live other            ${B(currentOther)}  (${((currentOther / liveGdp) * 100).toFixed(2)}% of GDP)`
    );
    console.log(`    authored share        ${(DD_AUTHORED_OTHER_SHARE * 100).toFixed(2)}%`);
    console.log(
      `    other after heal      ${B(DD_AUTHORED_OTHER_SHARE * (budget.gdp ?? liveGdp))}`
    );

    // ── 2. tax bases ────────────────────────────────────────────────────────
    const shareBaseline = budget.taxBaseGdpShareBaseline ?? {};

    // Find where the corrected engine actually SETTLES, by running it, rather
    // than asserting a multiple. Start at the authored baseline share and walk
    // the real per-turn growth forward at DD's live rates until it converges, so
    // this target cannot drift from whatever the engine does.
    const nat = await db
      .collection<StateMetrics>("macroMetrics")
      .findOne({ _id: getNationalDocId(COUNTRY) ?? "" });
    const metric = (k: "wageGrowth" | "tradeGrowth" | "gdpGrowth", d: number) => {
      const v = nat?.economic?.[k]?.value;
      return typeof v === "number" && Number.isFinite(v) ? v : d;
    };
    const factors: EconomicGrowthFactors = {
      gdpGrowth: metric("gdpGrowth", 2.5),
      wageGrowth: metric("wageGrowth", 3),
      tradeGrowth: metric("tradeGrowth", 2),
      inflationRate: Number.isFinite(budget.economicFactors?.inflationRate)
        ? (budget.economicFactors?.inflationRate as number)
        : 2.5,
      lastUpdated: new Date(),
    };
    const keys = Object.keys(shareBaseline) as (keyof FederalTaxBases)[];
    // No baseline, no target: the fixed point is computed FROM these shares, so
    // with none recorded there is nothing to re-anchor to. This happens when the
    // heal runs before `fiscalBaseGrowth` has ever self-healed the field (it
    // snapshots the current shares on the first turn it finds it absent). Heal
    // the other three items now, run one turn, then re-run this heal - do not
    // report the book healed while the drift is still in it.
    const basesBlocked = keys.length === 0;
    let probe: FederalTaxBases = { ...(budget.taxBases as FederalTaxBases) };
    for (const key of keys) {
      const share = shareBaseline[key];
      if (share != null && share > 0) probe[key] = liveGdp * share;
    }
    let probeGdp = liveGdp;
    for (let t = 0; t < 200 * TURNS_PER_YEAR; t++) {
      const gravity: TaxBaseGravityContext = { currentGdp: probeGdp, shareBaseline };
      probe = applyPerTurnGrowthToFederalBases(probe, factors, gravity);
      probeGdp *= (1 + factors.gdpGrowth / 100) ** (1 / TURNS_PER_YEAR);
    }

    const healedBases: FederalTaxBases = { ...(budget.taxBases as FederalTaxBases) };
    console.log(
      `\n[2] taxBases moved to the fixed point of the corrected dynamics` +
        ` (live GDP ${B(liveGdp)}, rates w/t/g ` +
        `${factors.wageGrowth.toFixed(1)}/${factors.tradeGrowth.toFixed(1)}/${factors.gdpGrowth.toFixed(1)})`
    );
    let basesStale = false;
    if (basesBlocked) {
      console.log("    no taxBaseGdpShareBaseline on this book - skipping; re-run after one turn");
    }
    for (const key of keys) {
      const share = shareBaseline[key];
      if (share == null || !(share > 0)) continue;
      const before = budget.taxBases?.[key] ?? 0;
      const settled = probe[key] / probeGdp / share;
      const after = liveGdp * share * settled;
      healedBases[key] = after;
      if (Math.abs(after - before) > Math.max(1_000_000, 0.001 * Math.abs(after))) {
        basesStale = true;
      }
      console.log(
        `    ${String(key).padEnd(26)} ${B(before).padStart(9)} -> ${B(after).padStart(9)}  (${(
          before /
          liveGdp /
          share
        ).toFixed(2)}x -> ${settled.toFixed(2)}x)`
      );
    }

    // ── 3. Berlin ───────────────────────────────────────────────────────────
    console.log(`\n[3] non-finite state budgets`);
    const stateBudgets = await db
      .collection<StateBudget>("stateBudgets")
      .find({ countryId: COUNTRY })
      .toArray();
    const gdpByState = new Map(states.map((s) => [s._id, (s.gdp ?? 0) * 1_000_000]));
    const stateFixes: { stateId: string; repaired: string[]; bases: StateTaxBases }[] = [];
    for (const sb of stateBudgets) {
      if (!sb.taxBases) continue;
      const { bases, repaired } = sanitizeStateTaxBases(
        sb.taxBases,
        gdpByState.get(String(sb.stateId ?? sb._id)) ?? 0
      );
      if (repaired.length > 0) {
        stateFixes.push({
          stateId: String(sb.stateId ?? sb._id),
          repaired: repaired.map(String),
          bases,
        });
        console.log(
          `    ${String(sb.stateId ?? sb._id).padEnd(6)} repaired: ${repaired.join(", ")}`
        );
      }
    }
    if (stateFixes.length === 0) console.log("    (none)");

    // ── 4. stale persisted annualRevenueV2 ───────────────────────────────────
    // Same read the revenue side does, so the stored per-law figures can be
    // compared against exactly what the next turn will compute from them.
    // Fresh value is fraction x live base GDP - the arithmetic `billEnactment`
    // writes on enactment (`computeLawCost(...).revenue` with a null band
    // index prices revenue as pure fraction x GDP).
    const lawDocs = await db
      .collection<EnactedLaw>("enactedLaws")
      .find(
        {
          scope: "national",
          countryId: COUNTRY,
          repealedAt: { $exists: false },
          $or: [{ annualRevenueV2: { $gt: 0 } }, { "costModelV2.gdpRevenueFraction": { $gt: 0 } }],
        },
        {
          projection: {
            annualRevenueV2: 1,
            costModelV2: 1,
            legislationTypeId: 1,
            stateId: 1,
            enactedAt: 1,
          },
        }
      )
      .toArray();
    const lawFixes: { _id: unknown; type: string; before: number; after: number }[] = [];
    for (const law of keepLatestActiveLawPerType(lawDocs)) {
      const fraction = law.costModelV2?.gdpRevenueFraction;
      if (fraction == null || !(fraction > 0)) continue; // legacy: nothing to recompute from
      const fresh = fraction * liveGdp;
      const stored = law.annualRevenueV2 ?? 0;
      if (Math.abs(fresh - stored) > Math.max(1_000_000, 0.001 * Math.abs(fresh))) {
        lawFixes.push({
          _id: law._id,
          type: law.legislationTypeId ?? "(untyped)",
          before: stored,
          after: fresh,
        });
      }
    }
    // Engine-equivalent aggregate: deduped v2 fractions repriced on the live
    // base, plus persisted values for legacy laws the engine cannot reprice.
    const lawRevenue = keepLatestActiveLawPerType(lawDocs).reduce((sum, law) => {
      const fraction = law.costModelV2?.gdpRevenueFraction;
      if (fraction != null) return sum + fraction * liveGdp;
      return sum + (law.annualRevenueV2 ?? 0);
    }, 0);
    console.log(`\n[4] stale persisted annualRevenueV2 (${lawDocs.length} national laws read)`);
    console.log(`    lawRevenue repriced    ${B(lawRevenue)}`);
    if (lawFixes.length === 0) {
      console.log("    (none stale)");
    } else {
      const staleBefore = lawFixes.reduce((sum, f) => sum + f.before, 0);
      const staleAfter = lawFixes.reduce((sum, f) => sum + f.after, 0);
      console.log(`    ${lawFixes.length} stale v2 laws  ${B(staleBefore)} -> ${B(staleAfter)}`);
      for (const fix of lawFixes) {
        console.log(
          `      ${fix.type.padEnd(40)} ${B(fix.before).padStart(9)} -> ${B(fix.after).padStart(9)}`
        );
      }
    }

    // ── projected budget ────────────────────────────────────────────────────
    // What the next turn's recompute will produce off the healed figures, so the
    // deficit can be judged BEFORE anything is written. Mirrors
    // calculateFederalRevenue's tax lines and applyEraRevenueCap.
    const rates = budget.taxRates;
    const rate = (k: keyof NonNullable<typeof rates>) => (Number(rates?.[k] ?? 0) || 0) / 100;
    const rawTake =
      healedBases.taxableIncome * rate("incomeTax") +
      healedBases.domesticCorporateProfits * rate("domesticCorporateTax") +
      healedBases.foreignCorporateProfits * rate("foreignCorporateTax") +
      healedBases.wagesAndSalaries * rate("payrollTax") +
      healedBases.importValue * rate("tariffs") +
      healedBases.taxableSales * rate("salesTax") +
      lawRevenue;
    const capGdp = budget.gdp ?? liveGdp;
    const KNEE = 0.55; // DD is on the command-economy knee
    const share = rawTake / capGdp;
    const capped = share <= KNEE ? rawTake : (KNEE + (share - KNEE) * 0.4) * capGdp;
    // `calculateFederalRevenue` multiplies the share by `budget.gdp`, not the
    // live regional roll-up, so the projection must use the same denominator or
    // it reports a figure the engine will not produce.
    const healedOther = DD_AUTHORED_OTHER_SHARE * capGdp;
    const revenue = capped + healedOther;
    // Spending as stored does NOT yet include the central transfer this branch
    // starts booking, so show both: the stored figure and what it becomes once
    // the lapse-capped grant lands.
    const spending = budget.spending?.total ?? 0;
    const grantPool =
      100 * states.reduce((sum, s) => sum + ((s as { population?: number }).population ?? 0), 0);
    console.log(`\n[projection] next turn's recompute off these figures (after)`);
    console.log(
      `    raw tax take          ${B(rawTake)}  (${(share * 100).toFixed(1)}% of GDP, knee ${(KNEE * 100).toFixed(0)}%)`
    );
    console.log(`    cap loss              ${B(rawTake - capped)}`);
    console.log(`    + non-tax             ${B(healedOther)}`);
    console.log(`    revenue               ${B(revenue)}`);
    console.log(`    spending (stored)     ${B(spending)}`);
    console.log(
      `    deficit               ${B(revenue - spending)}  (${(((revenue - spending) / capGdp) * 100).toFixed(1)}% of GDP)`
    );
    console.log(
      `    with grants booked    spending ${B(spending + grantPool)}, deficit ${B(
        revenue - spending - grantPool
      )}  (${(((revenue - spending - grantPool) / capGdp) * 100).toFixed(1)}% of GDP, before lapse)`
    );
    console.log(`    treasury              ${B(budget.treasuryBalance)}`);

    const shareStale =
      budget.otherRevenueGdpShareBaseline == null ||
      Math.abs(budget.otherRevenueGdpShareBaseline - DD_AUTHORED_OTHER_SHARE) > 1e-9;
    const federalStale = shareStale || basesStale;
    const writesPending = (federalStale ? 1 : 0) + stateFixes.length + lawFixes.length;

    if (!APPLY) {
      console.log(
        `\nNothing written. ${writesPending} document(s) would change. Re-run with --apply.` +
          (basesBlocked ? " (plus the blocked base re-anchor once a baseline exists)" : "")
      );
      return;
    }
    if (writesPending === 0 && !basesBlocked) {
      console.log("\nAlready healed: every figure matches. Wrote nothing.");
      return;
    }
    if (writesPending === 0) {
      console.log("\nNot healed: tax bases still drifted with no baseline to re-anchor to.");
      console.log("Run one turn, then re-run this heal.");
      return;
    }

    if (federalStale) {
      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: budget._id },
        {
          $set: {
            otherRevenueGdpShareBaseline: DD_AUTHORED_OTHER_SHARE,
            taxBases: healedBases,
            updatedAt: new Date(),
          },
        }
      );
    }
    for (const fix of stateFixes) {
      await db
        .collection<StateBudget>("stateBudgets")
        .updateOne({ stateId: fix.stateId, countryId: COUNTRY }, { $set: { taxBases: fix.bases } });
    }
    for (const fix of lawFixes) {
      await db
        .collection<EnactedLaw>("enactedLaws")
        .updateOne(
          { _id: fix._id as object },
          { $set: { annualRevenueV2: fix.after, updatedAt: new Date() } }
        );
    }
    console.log(
      `\nWrote: ${federalStale ? 1 : 0} federalBudget, ${stateFixes.length} stateBudgets, ` +
        `${lawFixes.length} enactedLaws. Revenue and spending recompute on the next turn.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
