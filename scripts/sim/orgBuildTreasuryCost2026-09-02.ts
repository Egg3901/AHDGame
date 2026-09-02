/**
 * Org build treasury cost: what would the last week of organizing have cost?
 *
 * The balance report for `ORG_BUILD_TREASURY_FRACTION` — the cash price added to
 * Build Org alongside its Political Strength cost. One arm per candidate rate,
 * all replaying the SAME real clicks off the live ledger:
 *
 *   BEFORE  Build Org costs PS only (the world as recorded)
 *   AFTER   each click also bills the paying tier's treasury at
 *           `orgBuildCashPrice(country, scope, effectivePsCost)`, soft-failing
 *           through `resolveOrgBuildFunding`
 *
 * Every input is real. Each click comes from `partyPoliticalStrengthLedger`
 * (`action: "build-org"`), so the PS actually paid — and therefore the pressure
 * ladder that drove it — is the observed one, not a model. Each party's treasury
 * is walked forward from its balance at the start of the window, crediting the
 * inflow it actually received that turn from `treasuryTransactions` and debiting
 * the org price as the clicks land in recorded order. The Org each click actually
 * granted comes from `orgRegLedger`, so the "Org lost to underfunding" column is
 * measured against what the click really produced rather than a projection.
 *
 * The question this answers is NOT "is the price big" — it is "does the price
 * constrain or does it shut parties out". A rate that leaves every active party
 * pinned at the soft-fail floor has replaced the mechanic with the floor.
 *
 * Scope caveat: the PS ledger does not record which tier paid. It is inferred
 * from the post-spend reserve (`value > STATE_PS_CAP_DEFAULT` can only be the
 * national pool), and the inferred split is reported so the reader can judge it.
 *
 *   npx tsx scripts/sim/orgBuildTreasuryCost2026-09-02.ts
 *   SIM_WINDOW=336 npx tsx scripts/sim/orgBuildTreasuryCost2026-09-02.ts
 */
import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  orgBuildCashPrice,
  resolveOrgBuildFunding,
  clampFundedFraction,
  type OrgBuildFundingScope,
} from "@/lib/politicalStrength/buildOrgFunding";
import { STATE_PS_CAP_DEFAULT } from "@/lib/politicalStrength/strengthConstants";
import { TREASURY_PS_RATE_BY_COUNTRY } from "@/lib/politicalStrength/strengthConstants";
import type { CountryId } from "@/lib/constants/countries";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

/** Turns of history replayed. 168 = 7 IRL days at the hourly cadence. */
const WINDOW = Number(process.env.SIM_WINDOW ?? 168);
/** Candidate rates. The middle one is the proposed value. */
const ARMS = [0.05, 0.075, 0.1];

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface Click {
  turn: number;
  countryId: CountryId;
  partyId: string;
  stateId: string;
  psCost: number;
  scope: OrgBuildFundingScope;
  /** Org this click actually granted, from `orgRegLedger`. */
  orgGain: number;
}

/** One party's replay outcome under one rate. */
interface ArmResult {
  clicks: number;
  refused: number;
  fullyFunded: number;
  partlyFunded: number;
  cashSpent: number;
  orgGained: number;
  orgRecorded: number;
  endedBroke: boolean;
}

async function loadClicks(db: Db, turn: number): Promise<Click[]> {
  const psRows = await db
    .collection("partyPoliticalStrengthLedger")
    .find(
      { turn: { $gte: turn - WINDOW }, action: "build-org" },
      { projection: { turn: 1, countryId: 1, partyId: 1, stateId: 1, delta: 1, value: 1 } }
    )
    .sort({ turn: 1, _id: 1 })
    .toArray();

  // Org actually granted, keyed by (turn, country, party, state). Several clicks
  // can share a key within a turn; average across them so a click's gain is the
  // observed per-click gain in that state that turn.
  const orgRows = await db
    .collection("orgRegLedger")
    .find(
      {
        turn: { $gte: turn - WINDOW },
        metric: "org",
        source: "action",
        note: "action:build-org",
      },
      { projection: { turn: 1, countryId: 1, partyId: 1, stateId: 1, delta: 1 } }
    )
    .toArray();
  const gainByKey = new Map<string, { sum: number; n: number }>();
  for (const r of orgRows) {
    const k = `${r.turn}:${r.countryId}:${r.partyId}:${r.stateId}`;
    const cur = gainByKey.get(k) ?? { sum: 0, n: 0 };
    cur.sum += r.delta ?? 0;
    cur.n += 1;
    gainByKey.set(k, cur);
  }

  return psRows.map((r) => {
    const k = `${r.turn}:${r.countryId}:${r.partyId}:${r.stateId}`;
    const g = gainByKey.get(k);
    return {
      turn: r.turn,
      countryId: r.countryId as CountryId,
      partyId: String(r.partyId),
      stateId: String(r.stateId ?? ""),
      psCost: Math.abs(r.delta ?? 0),
      // The state pool caps at STATE_PS_CAP_DEFAULT, so a larger post-spend
      // reserve can only be the national pool.
      scope: (r.value ?? 0) > STATE_PS_CAP_DEFAULT ? "national-targeted" : "state",
      orgGain: g && g.n > 0 ? g.sum / g.n : 0,
    } satisfies Click;
  });
}

/** Per-turn treasury inflow, keyed `country:party:tier`. */
async function loadInflow(db: Db, turn: number) {
  const rows = await db
    .collection("treasuryTransactions")
    .aggregate([
      { $match: { turn: { $gte: turn - WINDOW }, direction: "credit" } },
      {
        $group: {
          _id: { t: "$turn", c: "$countryId", p: "$partyId", h: "$holderType" },
          total: { $sum: "$amount" },
        },
      },
    ])
    .toArray();
  const map = new Map<string, number>();
  for (const r of rows) {
    const tier = r._id.h === "party" ? "national" : "state";
    map.set(`${r._id.t}:${r._id.c}:${r._id.p}:${tier}`, r.total);
  }
  return map;
}

/** Outflow other than org building, so the replay does not double-spend. */
async function loadOtherOutflow(db: Db, turn: number) {
  const rows = await db
    .collection("treasuryTransactions")
    .aggregate([
      {
        $match: {
          turn: { $gte: turn - WINDOW },
          direction: "debit",
          category: { $ne: "org_building" },
        },
      },
      {
        $group: {
          _id: { t: "$turn", c: "$countryId", p: "$partyId", h: "$holderType" },
          total: { $sum: "$amount" },
        },
      },
    ])
    .toArray();
  const map = new Map<string, number>();
  for (const r of rows) {
    const tier = r._id.h === "party" ? "national" : "state";
    map.set(`${r._id.t}:${r._id.c}:${r._id.p}:${tier}`, r.total);
  }
  return map;
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db();
  const gs = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" });
  const turn = gs?.currentTurn ?? 0;

  const clicks = await loadClicks(db, turn);
  const inflow = await loadInflow(db, turn);
  const outflow = await loadOtherOutflow(db, turn);

  const parties = await db
    .collection("politicalParties")
    .find({}, { projection: { countryId: 1, sequentialId: 1, abbreviation: 1, treasury: 1 } })
    .toArray();
  const spo = await db
    .collection("statePartyOrg")
    .find({}, { projection: { countryId: 1, partyId: 1, treasury: 1 } })
    .toArray();

  // Treasury at the START of the window = current balance, unwound by the net
  // flow recorded across it.
  const startTreasury = new Map<string, number>();
  for (const p of parties) {
    const key = `${p.countryId}:${p.sequentialId}:national`;
    let net = 0;
    for (let t = turn - WINDOW; t <= turn; t++) {
      net += inflow.get(`${t}:${p.countryId}:${p.sequentialId}:national`) ?? 0;
      net -= outflow.get(`${t}:${p.countryId}:${p.sequentialId}:national`) ?? 0;
    }
    startTreasury.set(key, (p.treasury ?? 0) - net);
  }
  const stateAgg = new Map<string, number>();
  for (const r of spo) {
    const k = `${r.countryId}:${r.partyId}`;
    stateAgg.set(k, (stateAgg.get(k) ?? 0) + (r.treasury ?? 0));
  }
  for (const [k, bal] of stateAgg) {
    const [c, p] = k.split(":");
    let net = 0;
    for (let t = turn - WINDOW; t <= turn; t++) {
      net += inflow.get(`${t}:${c}:${p}:state`) ?? 0;
      net -= outflow.get(`${t}:${c}:${p}:state`) ?? 0;
    }
    startTreasury.set(`${c}:${p}:state`, bal - net);
  }

  console.log(`# Build Org treasury cost — balance report`);
  console.log(
    `\nReplaying ${clicks.length} real Build Org clicks over turns ${turn - WINDOW}..${turn}.`
  );
  const nationalClicks = clicks.filter((c) => c.scope === "national-targeted").length;
  console.log(
    `Inferred scope split: ${nationalClicks} national-targeted, ${clicks.length - nationalClicks} state.\n`
  );

  const partyKeys = [...new Set(clicks.map((c) => `${c.countryId}:${c.partyId}`))];

  for (const fraction of ARMS) {
    // The helpers read the shipped constant, so scale their output to the arm's
    // rate rather than mutating a frozen module binding.
    const scale = fraction / 0.075;
    console.log(`\n===== ORG_BUILD_TREASURY_FRACTION = ${fraction} =====`);
    console.log(
      "party".padEnd(14) +
        "clicks".padStart(8) +
        "refused".padStart(9) +
        "partial".padStart(9) +
        "cash".padStart(16) +
        "org kept".padStart(11) +
        "of recorded".padStart(13)
    );

    const totals: ArmResult = {
      clicks: 0,
      refused: 0,
      fullyFunded: 0,
      partlyFunded: 0,
      cashSpent: 0,
      orgGained: 0,
      orgRecorded: 0,
      endedBroke: false,
    };

    for (const pk of partyKeys) {
      const [countryId, partyId] = pk.split(":");
      const mine = clicks.filter((c) => `${c.countryId}:${c.partyId}` === pk);
      if (!mine.length) continue;

      const bal = new Map<string, number>([
        ["state", startTreasury.get(`${countryId}:${partyId}:state`) ?? 0],
        ["national", startTreasury.get(`${countryId}:${partyId}:national`) ?? 0],
      ]);

      const res: ArmResult = {
        clicks: 0,
        refused: 0,
        fullyFunded: 0,
        partlyFunded: 0,
        cashSpent: 0,
        orgGained: 0,
        orgRecorded: 0,
        endedBroke: false,
      };

      let lastTurn = turn - WINDOW - 1;
      for (const click of mine) {
        // Credit every turn's real inflow (and debit its other spending) up to
        // this click's turn before pricing it.
        for (let t = lastTurn + 1; t <= click.turn; t++) {
          for (const tier of ["state", "national"] as const) {
            const credit = inflow.get(`${t}:${countryId}:${partyId}:${tier}`) ?? 0;
            const debit = outflow.get(`${t}:${countryId}:${partyId}:${tier}`) ?? 0;
            bal.set(tier, (bal.get(tier) ?? 0) + credit - debit);
          }
        }
        lastTurn = click.turn;

        const tier = click.scope === "state" ? "state" : "national";
        const price = orgBuildCashPrice(click.countryId, click.scope, click.psCost) * scale;
        const treasury = bal.get(tier) ?? 0;
        const funding = resolveOrgBuildFunding({ price, treasury });

        res.clicks += 1;
        res.orgRecorded += click.orgGain;
        if (!funding.ok) {
          res.refused += 1;
          continue;
        }
        bal.set(tier, treasury - funding.paid);
        res.cashSpent += funding.paid;
        const share = clampFundedFraction(funding.fundedFraction);
        res.orgGained += click.orgGain * share;
        if (share >= 1) res.fullyFunded += 1;
        else res.partlyFunded += 1;
      }
      res.endedBroke = (bal.get("state") ?? 0) <= 0 || (bal.get("national") ?? 0) <= 0;

      const p = parties.find(
        (x) => x.countryId === countryId && String(x.sequentialId) === partyId
      );
      const label = `${countryId} ${p?.abbreviation ?? partyId}`;
      console.log(
        label.padEnd(14) +
          String(res.clicks).padStart(8) +
          String(res.refused).padStart(9) +
          String(res.partlyFunded).padStart(9) +
          fmt(res.cashSpent).padStart(16) +
          res.orgGained.toFixed(1).padStart(11) +
          (res.orgRecorded > 0 ? pct(res.orgGained / res.orgRecorded) : "n/a").padStart(13)
      );

      totals.clicks += res.clicks;
      totals.refused += res.refused;
      totals.fullyFunded += res.fullyFunded;
      totals.partlyFunded += res.partlyFunded;
      totals.cashSpent += res.cashSpent;
      totals.orgGained += res.orgGained;
      totals.orgRecorded += res.orgRecorded;
    }

    console.log(
      `\n  ALL: ${totals.clicks} clicks | ${totals.refused} refused (${pct(totals.refused / Math.max(1, totals.clicks))}) | ` +
        `${totals.partlyFunded} partly funded (${pct(totals.partlyFunded / Math.max(1, totals.clicks))}) | ` +
        `${totals.fullyFunded} fully funded (${pct(totals.fullyFunded / Math.max(1, totals.clicks))})`
    );
    console.log(
      `  Org kept: ${totals.orgGained.toFixed(0)} of ${totals.orgRecorded.toFixed(0)} pp ` +
        `(${pct(totals.orgGained / Math.max(1, totals.orgRecorded))}) for ${fmt(totals.cashSpent)} in mixed currencies.`
    );
  }

  console.log(`\n## Per-click sticker price at the proposed 0.075 (local currency)`);
  for (const c of ["US", "UK", "DE", "DD", "RU", "JP"] as CountryId[]) {
    const r = TREASURY_PS_RATE_BY_COUNTRY[c];
    if (!r) continue;
    console.log(
      `  ${c}: state ${fmt(orgBuildCashPrice(c, "state", 1))} → ${fmt(orgBuildCashPrice(c, "state", 8))} at ladder cap; ` +
        `national ${fmt(orgBuildCashPrice(c, "national-targeted", 1))} → ${fmt(orgBuildCashPrice(c, "national-targeted", 8))}`
    );
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
