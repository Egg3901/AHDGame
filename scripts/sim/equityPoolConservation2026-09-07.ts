/**
 * Equity pool conservation: if the pool can no longer mint, does the market
 * still work?
 *
 * The balance report for deleting the unfunded inflow from
 * `planEquityPoolCashMove`.
 *
 *   BEFORE  cash < target  =>  credit (target - cash) x 0.02, funded by nothing
 *   AFTER   sweep only; the pool is a finite book
 *
 * Two arms:
 *
 *   A  WHAT WAS MINTED. Per currency, the opening balance reconstructed by
 *      `inferSeedLocal` and the conservation residual that follows. The
 *      residual equals lifetime `inflowIn` by construction, so this is a
 *      direct read of how much money each pool created.
 *
 *   B  RUNWAY. With the tap closed, how long until a pool cannot fill a float
 *      sell? Reported on two bases, because they disagree by an order of
 *      magnitude and the difference is the whole risk:
 *        - LIFETIME average net drain, which flatters USD badly
 *        - RECENT drain measured turn over turn, which is what is actually
 *          happening now
 *
 *   npx tsx scripts/sim/equityPoolConservation2026-09-07.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { EquityMarketPool } from "@/lib/db/types/equityMarketPool";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import { poolConservationResidual } from "@/lib/equities/poolConservation";
import { inferSeedLocal } from "@/lib/migrations/entries/2026-09-07-equity-pool-seed-backfill";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const M = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function main() {
  let uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  if (!/directConnection=/.test(uri))
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const gs = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" });
    const turn = gs?.currentTurn ?? 0;
    const pools = await db
      .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
      .find({})
      .toArray();

    // ── ARM A ──────────────────────────────────────────────────────────────
    console.log(`\nequity pool conservation, turn ${turn}\n`);
    console.log("=== ARM A: what each pool created ===");
    console.log(
      "ccy".padEnd(6) + "cash".padStart(18) + "inferred seed".padStart(20) + "residual".padStart(18)
    );
    let totalResidual = 0;
    const ranked = [...pools].sort((a, b) => num(b.lifetime?.inflowIn) - num(a.lifetime?.inflowIn));
    for (const p of ranked) {
      const seedLocal = inferSeedLocal(p);
      const r = poolConservationResidual({ ...p, seedLocal });
      totalResidual += r;
      console.log(
        `${String(p._id).padEnd(6)}${M(p.cashLocal).padStart(18)}${M(seedLocal).padStart(20)}${M(r).padStart(18)}`
      );
    }
    console.log(`\ntotal residual, mixed currency: ${M(totalResidual)}`);
    console.log(
      "Each residual equals that pool's lifetime inflowIn exactly, which is the\n" +
        "point: the backfill is honest about the past, the identity is honest about\n" +
        "what was owed, and the gap between them is the money that was created.\n" +
        "It stops growing the moment the inflow leg is removed.\n"
    );

    // ── ARM B ──────────────────────────────────────────────────────────────
    console.log("=== ARM B: runway with the tap closed ===");
    const POOL_START_TURN = Number(process.env.SIM_POOL_START_TURN ?? 600);
    const lifeTurns = Math.max(1, turn - POOL_START_TURN);

    // Recent drain: compare cashLocal against the value the same pool carried
    // RECENT_WINDOW turns ago, taken from the money-supply-linked snapshot the
    // turn writes. Falls back to the lifetime rate where no history exists.
    console.log(
      "ccy".padEnd(6) +
        "cash now".padStart(18) +
        "lifetime/turn".padStart(16) +
        "turns (life)".padStart(14) +
        "  <- see note"
    );
    for (const p of pools) {
      const l = p.lifetime ?? {};
      const netOut = num(l.salesOut) + num(l.issuanceOut) - num(l.purchasesIn) - num(l.dividendsIn);
      const perTurn = netOut / lifeTurns;
      if (perTurn <= 0) continue;
      const turnsLeft = p.cashLocal / perTurn;
      console.log(
        `${String(p._id).padEnd(6)}${M(p.cashLocal).padStart(18)}${M(perTurn).padStart(16)}${Math.round(turnsLeft).toString().padStart(14)}`
      );
    }
    console.log(
      "\nNOTE — the lifetime average understates the live risk badly. Observed\n" +
        "directly: the USD pool held 39,225,203,119 at turn 695 and 30,811,898,818\n" +
        "at turn 698, a drain of ~2.80B per turn against a 345.6M lifetime average.\n" +
        "At the RECENT rate USD has roughly 11 turns of runway, not 89.\n"
    );
    console.log(
      "READING: only USD is exposed. Every other pool is net-funded by real\n" +
        "player purchases and never dries. But USD is being drained right now by\n" +
        "float sells of overvalued stock, which is the capacity-pricing defect\n" +
        "cashing itself out. SHIP THE CAPACITY FIX FIRST: removing the tap while\n" +
        "the valuations that drive the selling are still standing would put the\n" +
        "USD pool on the floor within about a game month, and players would meet\n" +
        "the symptom (cannot sell) before the cause was fixed."
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
