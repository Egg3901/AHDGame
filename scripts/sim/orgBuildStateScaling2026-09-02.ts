/**
 * Per-state Build Org pricing: who pays more once the price follows state size?
 *
 * The balance report for `ORG_BUILD_SIZE_MULTIPLIER_MIN`/`_MAX`. Two arms over
 * the SAME real clicks off the live ledger:
 *
 *   BEFORE  one flat price per country per tier (as shipped 2026-09-02)
 *   AFTER   that price × `orgBuildSizeMultiplier(statePopulation, normalizer)`
 *
 * The design intent is that this REDISTRIBUTES rather than raises: the
 * multiplier is normalized so a country's average is 1. Two things need
 * checking against real behaviour rather than against that arithmetic:
 *
 *   1. Does the total actually stay flat once weighted by where parties really
 *      click? Players do not spread clicks evenly over states, so an average of
 *      1 per REGION is not an average of 1 per CLICK.
 *   2. Does anyone get squeezed? A party that organizes mostly in large states
 *      now pays up to double there, and the risk is that it starts hitting the
 *      funding floor and losing clicks it used to land.
 *
 * ## What it found (2026-09-02, 23,752 clicks)
 *
 * The neutrality does NOT hold. Averaging 1 per region is not averaging 1 per
 * click: 74% of US clicks land in above-average states, so the click-weighted
 * US multiplier is 1.349 and total spend rises **+13.5%** (US FLP +42%, DEM
 * +39%, MCPUS +44%; UK 1.048 and RU 1.038 barely move). Refusals go 1,356 →
 * 1,655, concentrated in US CUP (256 → 373) and MCPUS (112 → 178).
 *
 * That rise was reviewed and ACCEPTED rather than compensated: the clicks that
 * got dearer are the ones buying the most valuable Org. Recorded here so nobody
 * later reads the per-region arithmetic and assumes the level never moved.
 *
 * Every input is real: clicks and the PS actually paid come from
 * `partyPoliticalStrengthLedger`, Org granted from `orgRegLedger`, treasuries
 * are walked forward from the window's start crediting real inflow and debiting
 * real non-org spending.
 *
 *   npx tsx scripts/sim/orgBuildStateScaling2026-09-02.ts
 */
import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  orgBuildCashPrice,
  orgBuildSizeMultiplier,
  resolveOrgBuildFunding,
  clampFundedFraction,
  type OrgBuildFundingScope,
} from "@/lib/politicalStrength/buildOrgFunding";
import { STATE_PS_CAP_DEFAULT } from "@/lib/politicalStrength/strengthConstants";
import type { CountryId } from "@/lib/constants/countries";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const WINDOW = Number(process.env.SIM_WINDOW ?? 168);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface Click {
  turn: number;
  countryId: CountryId;
  partyId: string;
  stateId: string;
  psCost: number;
  scope: OrgBuildFundingScope;
  orgGain: number;
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db: Db = client.db();
  const gs = await db
    .collection<{ _id: string; currentTurn: number }>("gameState")
    .findOne({ _id: "current" });
  const turn = gs?.currentTurn ?? 0;

  // Per-country sqrt-population normalizer, exactly as the runtime resolver builds it.
  const states = await db
    .collection<{ _id: string; countryId: string; population?: number }>("states")
    .find({}, { projection: { countryId: 1, population: 1 } })
    .toArray();
  const popByState = new Map<string, number>();
  const rootsByCountry = new Map<string, number[]>();
  for (const s of states) {
    const pop = s.population ?? 0;
    popByState.set(`${s.countryId}:${s._id}`, pop);
    if (pop > 0) {
      const list = rootsByCountry.get(s.countryId) ?? [];
      list.push(Math.sqrt(pop));
      rootsByCountry.set(s.countryId, list);
    }
  }
  const normalizerByCountry = new Map<string, number | null>();
  for (const [c, roots] of rootsByCountry) {
    normalizerByCountry.set(
      c,
      roots.length > 1 ? roots.reduce((a, b) => a + b, 0) / roots.length : null
    );
  }

  const multiplierFor = (countryId: string, stateId: string): number => {
    const normalizer = normalizerByCountry.get(countryId);
    if (normalizer == null) return 1;
    return orgBuildSizeMultiplier(popByState.get(`${countryId}:${stateId}`) ?? 0, normalizer);
  };

  const psRows = await db
    .collection("partyPoliticalStrengthLedger")
    .find(
      { turn: { $gte: turn - WINDOW }, action: "build-org" },
      { projection: { turn: 1, countryId: 1, partyId: 1, stateId: 1, delta: 1, value: 1 } }
    )
    .sort({ turn: 1, _id: 1 })
    .toArray();

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

  const clicks: Click[] = psRows.map((r) => {
    const g = gainByKey.get(`${r.turn}:${r.countryId}:${r.partyId}:${r.stateId}`);
    return {
      turn: r.turn,
      countryId: r.countryId as CountryId,
      partyId: String(r.partyId),
      stateId: String(r.stateId ?? ""),
      psCost: Math.abs(r.delta ?? 0),
      scope: (r.value ?? 0) > STATE_PS_CAP_DEFAULT ? "national-targeted" : "state",
      orgGain: g && g.n > 0 ? g.sum / g.n : 0,
    };
  });

  const flows = async (direction: "credit" | "debit") => {
    const match: Record<string, unknown> = { turn: { $gte: turn - WINDOW }, direction };
    if (direction === "debit") match.category = { $ne: "org_building" };
    const rows = await db
      .collection("treasuryTransactions")
      .aggregate([
        { $match: match },
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
  };
  const inflow = await flows("credit");
  const outflow = await flows("debit");

  const parties = await db
    .collection("politicalParties")
    .find({}, { projection: { countryId: 1, sequentialId: 1, abbreviation: 1, treasury: 1 } })
    .toArray();
  const spo = await db
    .collection("statePartyOrg")
    .find({}, { projection: { countryId: 1, partyId: 1, treasury: 1 } })
    .toArray();

  const startTreasury = new Map<string, number>();
  const unwind = (key: string, current: number, c: string, p: string, tier: string) => {
    let net = 0;
    for (let t = turn - WINDOW; t <= turn; t++) {
      net += inflow.get(`${t}:${c}:${p}:${tier}`) ?? 0;
      net -= outflow.get(`${t}:${c}:${p}:${tier}`) ?? 0;
    }
    startTreasury.set(key, current - net);
  };
  for (const p of parties) {
    unwind(
      `${p.countryId}:${p.sequentialId}:national`,
      p.treasury ?? 0,
      p.countryId,
      String(p.sequentialId),
      "national"
    );
  }
  const stateAgg = new Map<string, number>();
  for (const r of spo) {
    const k = `${r.countryId}:${r.partyId}`;
    stateAgg.set(k, (stateAgg.get(k) ?? 0) + (r.treasury ?? 0));
  }
  for (const [k, bal] of stateAgg) {
    const [c, p] = k.split(":");
    unwind(`${c}:${p}:state`, bal, c, p, "state");
  }

  const partyKeys = [...new Set(clicks.map((c) => `${c.countryId}:${c.partyId}`))];

  interface Arm {
    clicks: number;
    refused: number;
    cash: number;
    orgKept: number;
    orgRecorded: number;
  }

  function run(scaled: boolean) {
    const perParty = new Map<string, Arm>();
    for (const pk of partyKeys) {
      const [countryId, partyId] = pk.split(":");
      const mine = clicks.filter((c) => `${c.countryId}:${c.partyId}` === pk);
      const bal = new Map<string, number>([
        ["state", startTreasury.get(`${countryId}:${partyId}:state`) ?? 0],
        ["national", startTreasury.get(`${countryId}:${partyId}:national`) ?? 0],
      ]);
      const arm: Arm = { clicks: 0, refused: 0, cash: 0, orgKept: 0, orgRecorded: 0 };
      let last = turn - WINDOW - 1;
      for (const click of mine) {
        for (let t = last + 1; t <= click.turn; t++) {
          for (const tier of ["state", "national"] as const) {
            bal.set(
              tier,
              (bal.get(tier) ?? 0) +
                (inflow.get(`${t}:${countryId}:${partyId}:${tier}`) ?? 0) -
                (outflow.get(`${t}:${countryId}:${partyId}:${tier}`) ?? 0)
            );
          }
        }
        last = click.turn;
        const tier = click.scope === "state" ? "state" : "national";
        const mult = scaled ? multiplierFor(click.countryId, click.stateId) : 1;
        const price = orgBuildCashPrice(click.countryId, click.scope, click.psCost, mult);
        const treasury = bal.get(tier) ?? 0;
        const funding = resolveOrgBuildFunding({ price, treasury });
        arm.clicks += 1;
        arm.orgRecorded += click.orgGain;
        if (!funding.ok) {
          arm.refused += 1;
          continue;
        }
        bal.set(tier, treasury - funding.paid);
        arm.cash += funding.paid;
        arm.orgKept += click.orgGain * clampFundedFraction(funding.fundedFraction);
      }
      perParty.set(pk, arm);
    }
    return perParty;
  }

  const before = run(false);
  const after = run(true);

  const sum = (m: Map<string, Arm>, f: (a: Arm) => number) =>
    [...m.values()].reduce((s, a) => s + f(a), 0);

  console.log(`# Per-state Build Org pricing — balance report`);
  console.log(`\nReplaying ${clicks.length} real clicks over the last ${WINDOW} turns.\n`);

  console.log(
    `TOTAL cash   before ${fmt(sum(before, (a) => a.cash))}  →  after ${fmt(sum(after, (a) => a.cash))} ` +
      `(${(
        ((sum(after, (a) => a.cash) - sum(before, (a) => a.cash)) /
          Math.max(
            1,
            sum(before, (a) => a.cash)
          )) *
        100
      ).toFixed(1)}% — intent is ~0%)`
  );
  console.log(
    `Refused      before ${sum(before, (a) => a.refused)} → after ${sum(after, (a) => a.refused)} of ${sum(before, (a) => a.clicks)} clicks`
  );
  console.log(
    `Org kept     before ${sum(before, (a) => a.orgKept).toFixed(0)} → after ${sum(after, (a) => a.orgKept).toFixed(0)} ` +
      `of ${sum(before, (a) => a.orgRecorded).toFixed(0)} pp recorded`
  );

  console.log(`\nPer party (only those whose bill or outcome moves):`);
  console.log(
    "party".padEnd(14) + "clicks".padStart(8) + "cash Δ".padStart(12) + "refused".padStart(16)
  );
  const rows = partyKeys
    .map((pk) => {
      const b = before.get(pk)!;
      const a = after.get(pk)!;
      const p = parties.find(
        (x) => x.countryId === pk.split(":")[0] && String(x.sequentialId) === pk.split(":")[1]
      );
      return { pk, b, a, label: `${pk.split(":")[0]} ${p?.abbreviation ?? pk.split(":")[1]}` };
    })
    .filter((r) => r.b.clicks >= 100)
    .sort((x, y) => y.b.clicks - x.b.clicks);
  for (const r of rows) {
    const delta = r.b.cash > 0 ? (r.a.cash / r.b.cash - 1) * 100 : 0;
    console.log(
      r.label.padEnd(14) +
        String(r.b.clicks).padStart(8) +
        `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`.padStart(12) +
        `${r.b.refused} → ${r.a.refused}`.padStart(16)
    );
  }

  console.log(`\nShare of clicks landing in a state priced above / below the flat rate:`);
  for (const c of ["US", "UK", "DD", "RU"]) {
    const mine = clicks.filter((k) => k.countryId === c);
    if (!mine.length) continue;
    const up = mine.filter((k) => multiplierFor(c, k.stateId) > 1.02).length;
    const down = mine.filter((k) => multiplierFor(c, k.stateId) < 0.98).length;
    const weighted = mine.reduce((s, k) => s + multiplierFor(c, k.stateId), 0) / mine.length;
    console.log(
      `  ${c}: ${pct(up / mine.length)} dearer, ${pct(down / mine.length)} cheaper, ` +
        `click-weighted mean multiplier ${weighted.toFixed(3)}`
    );
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
