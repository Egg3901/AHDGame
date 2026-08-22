/**
 * Ticket #1168 balance report harness.
 *
 * Replays East Germany's production fiscal snapshot with the real sovereign
 * interest-rate ladder, and compares the old fixed M10B cap with the proposed
 * 40%-of-GDP floor. It also exercises the real NPP selector across repeated
 * sponsorship opportunities to measure the type-repeat cooldown.
 *
 * Read-only and deterministic.
 * Run: npx tsx scripts/sim/ticket1168CompositeBalance.ts
 */

import type { LegislationPolicyOption, LegislationType, NPP } from "@/lib/db/types";
import { calculateInterestRate } from "@/lib/budget/debt";
import { effectiveBorrowingLimit } from "@/lib/budget/borrowingLimit";
import {
  NPP_SPONSOR_COOLDOWN_TURNS,
  NPP_SPONSOR_TYPE_REPEAT_COOLDOWN_TURNS,
} from "@/lib/nppAutonomy/constants";
import { selectNppBill } from "@/lib/nppAutonomy/selectNppBill";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const LIVE_DD = {
  fiscalYear: 1959,
  principal: 7_352_485_989,
  gdpSmoothed: 54_108_589_395,
  annualPrimaryDeficit: 2_011_912_254,
  annualGdpGrowthPct: -1.015,
  storedCeiling: 10_000_000_000,
  riskAnchor: { debtToGdpRatio: 0.06, creditRating: "A" as const, interestRate: 0.04 },
};

type FiscalSample = {
  year: number;
  principal: number;
  gdp: number;
  rate: number;
  oldLimit: number;
  newLimit: number;
};

function runFiscalProjection(years: number): FiscalSample[] {
  let treasuryBalance = -LIVE_DD.principal;
  let gdp = LIVE_DD.gdpSmoothed;
  const samples: FiscalSample[] = [];

  for (let turn = 0; turn <= years * TURNS_PER_YEAR; turn++) {
    const principal = Math.max(0, -treasuryBalance);
    const ratio = principal / gdp;
    const rate = calculateInterestRate(ratio, false, LIVE_DD.riskAnchor);
    if (turn % TURNS_PER_YEAR === 0) {
      samples.push({
        year: LIVE_DD.fiscalYear + turn / TURNS_PER_YEAR,
        principal,
        gdp,
        rate,
        oldLimit: LIVE_DD.storedCeiling,
        newLimit: effectiveBorrowingLimit({
          countryId: "DD",
          gdp,
          storedCeiling: LIVE_DD.storedCeiling,
        }),
      });
    }
    if (turn === years * TURNS_PER_YEAR) break;

    treasuryBalance -= LIVE_DD.annualPrimaryDeficit / TURNS_PER_YEAR;
    treasuryBalance -= (principal * rate) / TURNS_PER_YEAR;
    if ((turn + 1) % TURNS_PER_YEAR === 0) {
      gdp *= 1 + LIVE_DD.annualGdpGrowthPct / 100;
    }
  }
  return samples;
}

function option(id: string): LegislationPolicyOption {
  return {
    id,
    name: id,
    stance: "center",
    effectDirection: 1,
    economic: 0,
    social: 0,
  } as LegislationPolicyOption;
}

function legislationType(id: string): LegislationType {
  return {
    _id: id,
    name: id,
    description: "",
    policyDomain: "governance",
    subCategory: "",
    positions: [],
    policyOptions: [option(`${id}_status_quo`)],
  } as unknown as LegislationType;
}

function runSponsorshipProjection(): Array<{
  turn: number;
  oldChoice: string | null;
  newChoice: string | null;
}> {
  const types = ["a", "b", "c", "d", "e", "f"].map(legislationType);
  const npp = { policies: { economic: 0, social: 0 } } as NPP;
  const proposalTurnsByType = new Map<string, number[]>();
  const rows = [];

  for (let turn = 0; turn <= 108; turn += NPP_SPONSOR_COOLDOWN_TURNS) {
    const recent = new Set(
      [...proposalTurnsByType.entries()]
        .filter(([, proposalTurns]) =>
          proposalTurns.some(
            (proposalTurn) => turn - proposalTurn <= NPP_SPONSOR_TYPE_REPEAT_COOLDOWN_TURNS
          )
        )
        .map(([id]) => id)
    );
    const oldChoice = selectNppBill(types, npp, { weakDomains: {} })?.legType._id ?? null;
    const newChoice =
      selectNppBill(types, npp, { weakDomains: {} }, undefined, undefined, undefined, recent)
        ?.legType._id ?? null;
    rows.push({ turn, oldChoice, newChoice });
    if (newChoice) {
      proposalTurnsByType.set(newChoice, [...(proposalTurnsByType.get(newChoice) ?? []), turn]);
    }
  }
  return rows;
}

const fiscal = runFiscalProjection(8);
console.log("Ticket #1168: East Germany borrowing-limit projection");
console.log("year  debt_B  rate_pct  old_limit_B  new_limit_B  old_use_pct  new_use_pct");
for (const row of fiscal) {
  console.log(
    [
      row.year,
      (row.principal / 1e9).toFixed(2),
      (row.rate * 100).toFixed(2),
      (row.oldLimit / 1e9).toFixed(2),
      (row.newLimit / 1e9).toFixed(2),
      ((row.principal / row.oldLimit) * 100).toFixed(1),
      ((row.principal / row.newLimit) * 100).toFixed(1),
    ].join("  ")
  );
}

console.log("\nTicket #1168: deterministic NPP bill choices");
console.log("turn  without_type_guard  with_96_turn_type_guard");
for (const row of runSponsorshipProjection()) {
  console.log(`${row.turn}  ${row.oldChoice ?? "none"}  ${row.newChoice ?? "none"}`);
}
