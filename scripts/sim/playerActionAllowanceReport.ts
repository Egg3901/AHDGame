/** Deterministic allowance and stockpiling qualification using synthetic spending over 1008 turns. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  partyActionAllowance,
  playerActionAllowance,
  playerBaseActionGain,
  refreshPersonalActionBank,
} from "@/lib/actions/rules/allowances";
import { resolveOfficeActionBonus } from "@/lib/actions/officeActionBonus";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { calculateCampaignActions, campaignActionsPerTurn } from "@/lib/campaigns/actions";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { VP_ACTION_CAP } from "@/lib/constants/vicePresidentActions";
import { JUSTICE_ACTION_CAP } from "@/lib/constants/justiceActions";
import {
  GUBERNATORIAL_ACTION_CAP,
  GUBERNATORIAL_ACTION_REGEN_INTERVAL,
} from "@/lib/constants/governorOffice";
import { DIPLOMATIC_ACTIONS_PER_TURN } from "@/lib/constants/internationalOrganizations";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";
import { getCalendarDayInTimezone, shouldApplyDailyReset } from "@/lib/time/dailyReset";
import { SETTLEMENT_SEATS, seatActionBankCap } from "@/lib/constants/settlementCrisis";

const TURNS = 1008;
type Spending = "active" | "every48" | "idle";
const spending: Spending[] = ["active", "every48", "idle"];
const spends = (policy: Spending, turn: number) =>
  policy === "active" || (policy === "every48" && turn % 48 === 0);

function personalTrajectory(
  candidate: boolean,
  authoredOffice: number,
  authoredChair: number,
  authoredParty: number,
  energy: number,
  policy: Spending
) {
  const office = candidate
    ? resolveOfficeActionBonus({
        currentOfficeType: "house",
        electedSeatOfficeType: "house",
        isCabinetMember: false,
        cabinetOfficeType: undefined,
        officeActionBonus: { house: authoredOffice },
        countryId: "US",
      })
    : authoredOffice;
  const gain = candidate
    ? playerBaseActionGain(4) + office + playerActionAllowance(authoredChair)
    : 4 + office + authoredChair;
  const party = candidate ? partyActionAllowance(1, 1, authoredParty, 1, 4) : authoredParty;
  const limits = candidate
    ? energyActionLimits(energy)
    : {
        cap: Math.round(200 + ((energy - 1) / 9) * 50),
        threshold: Math.round(100 + ((energy - 1) / 9) * 25),
      };
  let bank = 0;
  let spent = 0;
  let taxed = 0;
  let overflow = 0;
  for (let turn = 1; turn <= TURNS; turn++) {
    const penalty = bank > limits.threshold ? (candidate ? 5 : 4) : 0;
    const beforeCap = bank - penalty + gain;
    taxed += penalty;
    bank = candidate
      ? refreshPersonalActionBank(bank, gain, limits.cap, limits.threshold)
      : Math.min(limits.cap, Math.max(0, beforeCap));
    overflow += beforeCap - bank;
    const withParty = bank + party;
    bank = Math.min(limits.cap, withParty);
    overflow += withParty - bank;
    if (spends(policy, turn)) {
      const amount = Math.floor(bank);
      bank -= amount;
      spent += amount;
    }
    assert(Number.isFinite(bank) && bank >= 0 && bank <= limits.cap);
    assert(Math.abs((gain + party) * turn - taxed - overflow - spent - bank) < 1e-8);
  }
  return { gain, party, ...limits, bank, spent, taxed, overflow };
}

function dailyTrajectory(cap: number, start: string) {
  let lastDay: string | undefined;
  let resets = 0;
  let spent = 0;
  const startMs = new Date(start).getTime();
  for (let turn = 0; turn < TURNS; turn++) {
    const now = new Date(startMs + turn * 3_600_000);
    if (!shouldApplyDailyReset(lastDay, now)) continue;
    lastDay = getCalendarDayInTimezone(now);
    resets++;
    spent += cap;
    assert(!shouldApplyDailyReset(lastDay, now), "the same calendar day cannot refill twice");
  }
  return { cap, resets, spent };
}

function governorTrajectory(interval: number, cap: number, policy: Spending) {
  let bank = 0;
  let lastGrant = 0;
  let granted = 0;
  let spent = 0;
  for (let turn = 1; turn <= TURNS; turn++) {
    if (bank < cap && turn - lastGrant >= interval) {
      bank++;
      granted++;
      lastGrant = turn;
    }
    if (spends(policy, turn)) {
      spent += bank;
      bank = 0;
    }
    assert(bank >= 0 && bank <= cap);
    assert.equal(granted, spent + bank);
  }
  return { interval, cap, granted, spent, bank };
}

function seatTrajectory(gain: number, policy: Spending) {
  const cap = seatActionBankCap(gain);
  let bank = 0;
  let spent = 0;
  for (let turn = 1; turn <= TURNS; turn++) {
    bank = Math.min(cap, bank + gain);
    if (spends(policy, turn)) {
      const available = Math.floor(bank);
      spent += available;
      bank -= available;
    }
    assert(bank >= 0 && bank <= cap);
  }
  return { gain, cap, bank, spent };
}

export function buildPlayerActionAllowanceReport() {
  const personal = [];
  for (const [role, office, chair, party] of [
    ["ordinary", 0, 0, 0],
    ["legislator", 1, 0, 0],
    ["chair", 1, 3, 0],
    ["executive-party", 4, 0, 3],
  ] as const) {
    for (const energy of [1, 5.5, 10]) {
      for (const policy of spending) {
        const baseline = personalTrajectory(false, office, chair, party, energy, policy);
        const candidate = personalTrajectory(true, office, chair, party, energy, policy);
        assert.equal(candidate.gain + candidate.party, (baseline.gain + baseline.party) * 1.25);
        if (policy === "active") assert.equal(candidate.spent, baseline.spent * 1.25);
        if (role === "ordinary" && policy === "idle") {
          assert.equal(candidate.bank, baseline.bank * 1.25);
          assert(candidate.bank < candidate.cap);
        }
        personal.push({ role, energy, policy, baseline, candidate });
      }
    }
  }

  const campaigns = [];
  for (const endorsements of [0, 1, 4, 9, 25, 100]) {
    for (const candidateIsNPP of [false, true]) {
      const baseline = calculateCampaignActions(endorsements, candidateIsNPP ? 2 : 4);
      const candidate = campaignActionsPerTurn({
        nppEndorsements: endorsements,
        playerEndorsements: 0,
        governorEndorsements: 0,
        executiveEndorsements: 0,
        isPresidential: false,
        candidateIsNPP,
        baseActionsPerTurn: 4,
      });
      if (candidateIsNPP) assert.equal(candidate, baseline);
      else assert(Math.abs(candidate - baseline * 1.25) <= 0.5);
      campaigns.push({ endorsements, candidateIsNPP, baseline, candidate });
    }
  }

  const daily = [];
  for (const [role, oldCap, newCap] of [
    ["minister", 4, MINISTERIAL_ACTION_CAP],
    ["vice-president", 2, VP_ACTION_CAP],
    ["justice", 2, JUSTICE_ACTION_CAP],
    ["ticket-surrogate-v3", 2, presidentialRulesetFor({ rulesetVersion: 3 }).vpSurrogateActionCap],
  ] as const) {
    for (const start of ["2026-03-01T05:00:00Z", "2026-10-25T04:00:00Z"]) {
      const baseline = dailyTrajectory(oldCap, start);
      const candidate = dailyTrajectory(newCap, start);
      assert.equal(candidate.resets, baseline.resets);
      assert(newCap > oldCap && newCap - oldCap === 1);
      daily.push({ role, start, baseline, candidate });
    }
  }
  assert.equal(presidentialRulesetFor({ rulesetVersion: 1 }).vpSurrogateActionCap, 2);
  assert.equal(presidentialRulesetFor({ rulesetVersion: 2 }).vpSurrogateActionCap, 2);

  const governors = spending.map((policy) => ({
    policy,
    baseline: governorTrajectory(18, 3, policy),
    candidate: governorTrajectory(
      GUBERNATORIAL_ACTION_REGEN_INTERVAL,
      GUBERNATORIAL_ACTION_CAP,
      policy
    ),
  }));
  assert.equal(governors[0].baseline.spent, 56);
  assert.equal(governors[0].candidate.spent, 72);
  const seats = SETTLEMENT_SEATS.flatMap((seat) =>
    spending.map((policy) => {
      const baseline = seatTrajectory(seat.id === "DD" ? 3 : 1, policy);
      const candidate = seatTrajectory(seat.actionsPerTurn, policy);
      if (policy === "active") assert.equal(candidate.spent, baseline.spent * 1.25);
      assert.equal(candidate.cap, baseline.cap * 1.25);
      return { seat: seat.id, policy, baseline, candidate };
    })
  );
  assert.equal(DIPLOMATIC_ACTIONS_PER_TURN, 5);
  return {
    verdict: "passed",
    completedTurns: TURNS,
    question:
      "Does a moderate player allowance uplift preserve bounded banks, reset cadence and accounting?",
    scope:
      "Synthetic allowance trajectories using production rules. Does not establish election win rates or world economic equilibrium.",
    personal,
    campaigns,
    daily,
    governors,
    seats,
    diplomacy: { baselinePerTurn: 4, candidatePerTurn: DIPLOMATIC_ACTIONS_PER_TURN },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outIndex = process.argv.indexOf("--out");
  const baselineIndex = process.argv.indexOf("--baseline-commit");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const report = {
    sourceCommit,
    sourceClean: dirty === "",
    baselineCommit: baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    dependencyLockSha256: createHash("sha256")
      .update(readFileSync("package-lock.json"))
      .digest("hex"),
    ...buildPlayerActionAllowanceReport(),
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (outIndex >= 0) {
    const out = process.argv[outIndex + 1];
    assert(out, "--out requires a report path");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(
      JSON.stringify({
        verdict: report.verdict,
        sourceCommit,
        sourceClean: report.sourceClean,
        completedTurns: TURNS,
      })
    );
  } else console.log(text);
}
