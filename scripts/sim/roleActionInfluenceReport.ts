/** Synthetic role-action and NI trajectories; no database or world simulation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  applyNationalInfluenceTurn,
  calculateNationalInfluenceGain,
} from "../../shared/constants/formulas";
import {
  resolvePositionNiBonus,
  type PositionNiBonusInput,
} from "../../src/lib/actions/positionNiBonus/rules";
import { isOfficePoolAccrualTurn } from "../../src/lib/actions/officePoolAccrual";
import { campaignActionBankCap, cappedCampaignActionGrant } from "../../src/lib/campaigns/actions";
import {
  officePoolTopUpBlock,
  OFFICE_POOL_TOP_UP_AP_COST,
} from "../../src/lib/actions/officePoolTopUpRules";
import {
  MINISTERIAL_ACTION_CAP,
  MINISTERIAL_ACTION_ACCRUAL_TURNS,
} from "../../src/lib/constants/cabinetMechanicsTypes";
import {
  VP_ACTION_CAP,
  VP_ACTION_ACCRUAL_TURNS,
} from "../../src/lib/constants/vicePresidentActions";
import {
  JUSTICE_ACTION_CAP,
  JUSTICE_ACTION_ACCRUAL_TURNS,
} from "../../src/lib/constants/justiceActions";

const turns = 1008;
const roles: PositionNiBonusInput[] = [
  { countryId: "US" },
  { countryId: "US", currentOfficeType: "house" },
  { countryId: "US", currentOfficeType: "president" },
  { countryId: "US", congressLeadershipRoles: ["speaker_of_the_house"] },
  { countryId: "US", cabinetCountryId: "US" },
  { countryId: "US", cabinetCountryId: "US", isActingCabinet: true },
  { countryId: "US", isSeatedJustice: true },
  { countryId: "US", isPartyChair: true },
  { countryId: "US", ceoTier: "major" },
  { countryId: "UK", currentOfficeType: "primeMinister", isOrgHead: true },
];
const influence = roles.flatMap((role) =>
  [0, 25, 50, 75, 100].flatMap((si) =>
    [0, 500].map((initial) => {
      const gain = calculateNationalInfluenceGain(si) + resolvePositionNiBonus(role);
      let current = initial;
      for (let turn = 1; turn <= turns; turn++) {
        current = applyNationalInfluenceTurn(current, gain);
        const expected = Math.max(0, initial * 0.99 ** turn + gain * 100 * (1 - 0.99 ** turn));
        assert.ok(Number.isFinite(current) && current >= 0);
        assert.ok(Math.abs(current - expected) < 1e-8);
      }
      let retired = current;
      for (let turn = 0; turn < 69; turn++) retired = applyNationalInfluenceTurn(retired, 0);
      if (current > 0) assert.ok(retired / current > 0.49 && retired / current < 0.51);
      return {
        role,
        si,
        initial,
        gain,
        final: current,
        equilibrium: Math.max(0, gain * 100),
        after69TurnsWithoutGain: retired,
      };
    })
  )
);
const pools = [
  { name: "ministerial", cap: MINISTERIAL_ACTION_CAP, interval: MINISTERIAL_ACTION_ACCRUAL_TURNS },
  { name: "vp", cap: VP_ACTION_CAP, interval: VP_ACTION_ACCRUAL_TURNS },
  { name: "justice", cap: JUSTICE_ACTION_CAP, interval: JUSTICE_ACTION_ACCRUAL_TURNS },
].flatMap((pool) =>
  [1, 24, Infinity].map((spendEvery) => {
    let balance = pool.cap,
      granted = pool.cap,
      spent = 0;
    for (let turn = 1; turn <= turns; turn++) {
      if (isOfficePoolAccrualTurn(turn, pool.interval) && balance < pool.cap) {
        balance++;
        granted++;
      }
      if (turn % spendEvery === 0 && balance > 0) {
        balance--;
        spent++;
      }
      assert.equal(granted - spent, balance);
      assert.ok(balance >= 0 && balance <= pool.cap);
    }
    assert.equal(24 / pool.interval, pool.cap);
    return {
      ...pool,
      spendEvery: Number.isFinite(spendEvery) ? spendEvery : "idle",
      granted,
      spent,
      balance,
    };
  })
);
const campaigns = [2, 4, 10, 16].flatMap((income) =>
  [1, 24, Infinity].map((spendEvery) => {
    let balance = 0,
      granted = 0,
      spent = 0;
    for (let turn = 1; turn <= turns; turn++) {
      const amount = cappedCampaignActionGrant(balance, income);
      balance += amount;
      granted += amount;
      if (turn % spendEvery === 0) {
        const spending = Math.min(balance, income * spendEvery);
        spent += spending;
        balance -= spending;
      }
      assert.equal(granted - spent, balance);
      assert.ok(balance <= campaignActionBankCap(income));
    }
    assert.equal(cappedCampaignActionGrant(campaignActionBankCap(income) + 100, income), 0);
    return {
      income,
      spendEvery: Number.isFinite(spendEvery) ? spendEvery : "idle",
      granted,
      spent,
      balance,
    };
  })
);
assert.equal(OFFICE_POOL_TOP_UP_AP_COST, 10);
assert.equal(
  officePoolTopUpBlock({
    remaining: 0,
    cap: 2,
    currentTurn: 10,
    lastTopUpTurn: 9,
    playerActions: 10,
  }),
  null
);
assert.equal(
  officePoolTopUpBlock({
    remaining: 0,
    cap: 2,
    currentTurn: 10,
    lastTopUpTurn: 10,
    playerActions: 10,
  })?.reason,
  "already_this_turn"
);
assert.equal(
  officePoolTopUpBlock({
    remaining: 2,
    cap: 2,
    currentTurn: 10,
    lastTopUpTurn: 9,
    playerActions: 10,
  })?.reason,
  "full"
);
const report = {
  verdict: "passed",
  scope:
    "Synthetic NI equilibrium and retirement, office accrual and campaign banking accounting; not election outcomes or macro equilibrium.",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceClean: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "",
  node: process.version,
  lockSha256: createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"),
  completedTurns: turns,
  influence,
  pools,
  campaigns,
};
const out = process.argv[process.argv.indexOf("--out") + 1];
if (!process.argv.includes("--out") || !out) throw new Error("Pass --out <report.json>");
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    verdict: report.verdict,
    sourceCommit: report.sourceCommit,
    sourceClean: report.sourceClean,
    completedTurns: turns,
    niCases: influence.length,
    poolCases: pools.length,
    campaignCases: campaigns.length,
  })
);
