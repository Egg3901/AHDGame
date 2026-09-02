/**
 * Heal for #1323 — the live corrections the code fixes cannot make on their own.
 *
 * The engine changes stop the bleeding going forward; three things are already
 * wrong in the database and stay wrong until they are written:
 *
 *   1. DD's `otherRevenueGdpShareBaseline`. The self-heal in `fiscalBaseGrowth`
 *      snapshots the CURRENT ratio, which for DD is the DRIFTED 1.5% rather than
 *      the 9% its seed authored (₸4.5B against a ₸50B GDP). Left alone the
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
 * DRY RUN BY DEFAULT. Pass `--apply` to write. Prints the resulting budget so
 * the deficit can be checked before anything is committed to.
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

    const budget = await db.collection<FederalBudget>("federalBudget").findOne({
      countryId: COUNTRY,
    });
    if (!budget) throw new Error("no DD federalBudget");
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
    const liveGdp = states.reduce((sum, s) => sum + (s.gdp ?? 0), 0) * 1_000_000;

    // ── 1. non-tax share ────────────────────────────────────────────────────
    const currentOther = budget.revenue?.other ?? 0;
    console.log(`\n[1] otherRevenueGdpShareBaseline`);
    console.log(
      `    live other            ${B(currentOther)}  (${((currentOther / liveGdp) * 100).toFixed(2)}% of GDP)`
    );
    console.log(`    authored share        ${(DD_AUTHORED_OTHER_SHARE * 100).toFixed(2)}%`);
    console.log(`    other after heal      ${B(DD_AUTHORED_OTHER_SHARE * liveGdp)}`);

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
    for (const key of keys) {
      const share = shareBaseline[key];
      if (share == null || !(share > 0)) continue;
      const before = budget.taxBases?.[key] ?? 0;
      const settled = probe[key] / probeGdp / share;
      const after = liveGdp * share * settled;
      healedBases[key] = after;
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

    // ── projected budget ────────────────────────────────────────────────────
    // What the next turn's recompute will produce off the healed figures, so the
    // deficit can be judged BEFORE anything is written. Mirrors
    // calculateFederalRevenue's tax lines and applyEraRevenueCap.
    const rates = budget.taxRates;
    const rate = (k: keyof NonNullable<typeof rates>) => (Number(rates?.[k] ?? 0) || 0) / 100;
    const lawRevenue = 0.0112 * liveGdp; // Sigma gdpRevenueFraction over DD's active v2 laws
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
    const healedOther = DD_AUTHORED_OTHER_SHARE * liveGdp;
    const revenue = capped + healedOther;
    // Spending as stored does NOT yet include the central transfer this branch
    // starts booking, so show both: the stored figure and what it becomes once
    // the lapse-capped grant lands.
    const spending = budget.spending?.total ?? 0;
    const grantPool =
      100 * states.reduce((sum, s) => sum + ((s as { population?: number }).population ?? 0), 0);
    console.log(`\n[projection] next turn's recompute off these figures`);
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

    if (!APPLY) {
      console.log("\nNothing written. Re-run with --apply.");
      return;
    }

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
    for (const fix of stateFixes) {
      await db
        .collection<StateBudget>("stateBudgets")
        .updateOne({ stateId: fix.stateId, countryId: COUNTRY }, { $set: { taxBases: fix.bases } });
    }
    console.log(
      `\nWrote: 1 federalBudget, ${stateFixes.length} stateBudgets. ` +
        `Revenue and spending recompute on the next turn.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
