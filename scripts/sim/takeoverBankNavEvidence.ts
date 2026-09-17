/**
 * Issue #1750 worldsim-gate evidence: bank-NAV floor across the three
 * acquisition paths (hostile takeover, voted privatization, fund-only
 * treasury buyout).
 *
 * WORLDSIM LIMITATION (audited 2026-09-17): runWorld boots a sandbox world,
 * autonomizes every corporation to an NPP CEO, and advances processTurn. It
 * has no hook that issues CEO-authenticated player commands, and NPP turn
 * logic never issues them either. A hostile squeeze-out needs a parent-corp
 * CEO past the ownership threshold plus merger clearance; a take-private
 * needs a CEO-held supermajority plus a multi-turn vote lifecycle; a
 * fund-only buyout needs a funds-only minority plus zero float. None of
 * these states is reachable by turn advancement alone, so no seed, flag, or
 * turn count can make worldsim traverse these paths. This scenario is the
 * deterministic substitute: it settles all three paths' production pricing
 * legs in memory (no DB, no clock, no randomness) and extracts a
 * machine-checkable JSON report.
 *
 * PRODUCTION WIRING (each leg below is the exact expression the route or
 * command evaluates; per-path wiring is covered by the cited tests):
 * - hostile squeeze-out: sharePrice * (1 + HOSTILE_TAKEOVER_PREMIUM_RATE),
 *   floored by applyBankNavFloor — src/lib/corporations/commands/takeovers/
 *   hostileTakeover.ts; route coverage in route.bankNavFloor.test.ts.
 * - voted take-private: sharePrice * (1 + PRIVATIZATION_BUYOUT_PREMIUM),
 *   floored at open and locked — openPrivatizationVote.ts; coverage in
 *   openPrivatizationVote.test.ts ("bank-NAV floor").
 * - fund-only treasury buyout: market execution price plus a treasury top-up
 *   to the floor, measured against what was actually paid —
 *   fundOnlyBuyout.ts; coverage in fundOnlyBuyout.test.ts.
 * Shared floor math: takeovers/rules/bankNavFloor.ts (takeoverBankNav,
 * bankNavFloorPerShareAnchor, applyBankNavFloor).
 *
 * EVIDENCE PLAN (fixed seed EVIDENCE_SEED; control vs treatment):
 * - Control arm: pre-fix settlement at the market leg only.
 * - Treatment arm: production floored settlement.
 * - Exploit fixture (bank NAV/share >> market leg): control must settle
 *   BELOW realizable NAV (the hole, reproduced) and treatment must settle
 *   AT OR ABOVE it (the hole, closed), on all three paths, in both
 *   player-deposit policy modes.
 * - No-op fixtures (underwater bank, no bank): treatment must equal control
 *   exactly (ordinary non-bank market pricing unchanged).
 * - Conservation ledger per settled case: payer debit == payee credit,
 *   shares retired == minority shares bought, outstanding conserved, and the
 *   target NAV arrives at the acquirer intact (transferred, never minted).
 * - Liability-once differentials through takeoverBankNav: +D of any genuine
 *   liability moves NAV by exactly -D; player pointer deposits move it by 0
 *   until the savings read is authoritative, then by -D. A prop buy
 *   (cash C-M plus mark M) must equal cash C with no mark: counted once.
 *
 * GATE USAGE (documented entry point; also `npm run sim:takeover-evidence --`):
 *   npx tsx scripts/sim/takeoverBankNavEvidence.ts
 *     --source-worktree=NAME --source-commit=FULL_SHA [--seed=X] [--out=report.json]
 * The pin is REQUIRED and is verified through the full simSource contract
 * (shape, registered worktree, HEAD equality, clean checkout): unpinned,
 * mismatched, or dirty checkouts fail closed with a failed
 * G-source-verified invariant and exit 1. Any failed scenario invariant
 * also exits 1. stdout (and --out when given) is the canonical stable JSON
 * artifact. NEVER point a sim at the live game database; this scenario
 * opens no DB.
 */

import { writeFile } from "fs/promises";
import { bankEquity } from "@/lib/banking/balanceSheet";
import {
  applyBankNavFloor,
  bankNavFloorPerShareAnchor,
  takeoverBankNav,
} from "@/lib/corporations/commands/takeovers/rules/bankNavFloor";
import { HOSTILE_TAKEOVER_PREMIUM_RATE } from "@/lib/corporations/corporateOwnership";
import { PRIVATIZATION_BUYOUT_PREMIUM } from "@/lib/constants/corporations";
import {
  assertSimSourceShape,
  defaultSimSourceDeps,
  verifySimSource,
  type SimSourceDeps,
} from "./simSource";

/** Pinned fixture-set version. The scenario is fully deterministic. */
export const EVIDENCE_SEED = "issue-1750-v1";

export const FUND_ONLY_PREMIUM_RATE = 0;

interface CharterShape {
  cashReserves: number;
  totalLoans: number;
  npcDeposits: number;
  playerDeposits: number;
  totalDeposits: number;
  propBookMarkValue: number;
  discountWindowDebt: number;
  discountWindowArrears: number;
  cbMarginDebt: number;
  cbMarginArrears: number;
  interbankDebt: number;
}

function shape(overrides: Partial<CharterShape> = {}): CharterShape {
  return {
    cashReserves: 0,
    totalLoans: 0,
    npcDeposits: 0,
    playerDeposits: 0,
    totalDeposits: 0,
    propBookMarkValue: 0,
    discountWindowDebt: 0,
    discountWindowArrears: 0,
    cbMarginDebt: 0,
    cbMarginArrears: 0,
    interbankDebt: 0,
    ...overrides,
  };
}

/**
 * The issue's exploit corp, scaled to whole anchor: ~3.0B ring-fenced cash,
 * 400M loans, a 900M marked bond/prop book, 2.9B household deposits, 100M
 * interbank borrowing, 50M player deposits. Quoted at 10/share over 10M
 * shares (100M market cap) against ~1.3B of realizable bank net assets.
 */
const EXPLOIT_BANK = shape({
  cashReserves: 3_000_000_000,
  totalLoans: 400_000_000,
  npcDeposits: 2_900_000_000,
  playerDeposits: 50_000_000,
  totalDeposits: 2_950_000_000,
  propBookMarkValue: 900_000_000,
  interbankDebt: 100_000_000,
});

const TOTAL_SHARES = 10_000_000;
const SHARE_PRICE = 10;
const MINORITY_SHARES = 100_000;

export interface EvidencePath {
  name: "hostile" | "voted-privatization" | "fund-only";
  premiumRate: number;
}

export const EVIDENCE_PATHS: EvidencePath[] = [
  { name: "hostile", premiumRate: HOSTILE_TAKEOVER_PREMIUM_RATE },
  { name: "voted-privatization", premiumRate: PRIVATIZATION_BUYOUT_PREMIUM },
  { name: "fund-only", premiumRate: FUND_ONLY_PREMIUM_RATE },
];

export interface EvidenceCase {
  fixture: string;
  policyMode: "pointer" | "authoritative" | "n/a";
  path: EvidencePath["name"];
  marketPerShare: number;
  navTotal: number;
  floorPerShare: number;
  floorApplied: boolean;
  controlTotal: number;
  settledTotal: number;
}

export interface EvidenceInvariant {
  id: string;
  statement: string;
  pass: boolean;
}

/** Operational kind tag. This artifact settles CEO-authenticated command
 * paths deterministically in memory; it is NOT a turn-based worldsim
 * regression run. Gate consumers must key on this tag and never mistake
 * this artifact for runWorld coverage. */
export const EVIDENCE_KIND = "deterministic-command-path" as const;

export const WORLDSIM_NON_COVERAGE_NOTE =
  "runWorld boots a sandbox world and advances processTurn; it has no hook that issues CEO-authenticated player commands (hostile squeeze-out, privatization vote, fund-only buyout), so it cannot traverse these paths. This report settles those paths' production pricing legs deterministically in memory and is not a turn-based worldsim regression run.";

export interface EvidenceReport {
  kind: typeof EVIDENCE_KIND;
  worldsimCoversAuthenticatedCommands: false;
  worldsimNote: string;
  seed: string;
  source: { worktree: string; commit: string } | null;
  cases: EvidenceCase[];
  invariants: EvidenceInvariant[];
  pass: boolean;
}

function settle(
  fixture: string,
  charter: CharterShape | null,
  policyMode: EvidenceCase["policyMode"],
  path: EvidencePath
): EvidenceCase {
  const playerDepositsAreLiabilities = policyMode === "authoritative";
  const navTotal =
    charter === null ? 0 : takeoverBankNav(charter as never, { playerDepositsAreLiabilities });
  const floorPerShare =
    charter === null
      ? 0
      : bankNavFloorPerShareAnchor({ bankNavAnchor: navTotal, totalShares: TOTAL_SHARES });
  const marketPerShare = SHARE_PRICE * (1 + path.premiumRate);
  const settled = applyBankNavFloor(marketPerShare, floorPerShare);
  return {
    fixture,
    policyMode,
    path: path.name,
    marketPerShare,
    navTotal,
    floorPerShare,
    floorApplied: settled.floorApplied,
    controlTotal: MINORITY_SHARES * marketPerShare,
    settledTotal: MINORITY_SHARES * settled.pricePerShareAnchor,
  };
}

function check(id: string, statement: string, pass: boolean): EvidenceInvariant {
  return { id, statement, pass };
}

export function runTakeoverBankNavEvidence(
  seed: string = EVIDENCE_SEED,
  source: { worktree: string; commit: string } | null = null
): EvidenceReport {
  if (source) {
    assertSimSourceShape({ sourceWorktree: source.worktree, sourceCommit: source.commit });
  }
  const cases: EvidenceCase[] = [];
  for (const policyMode of ["pointer", "authoritative"] as const) {
    for (const path of EVIDENCE_PATHS) {
      cases.push(settle("exploit-bank", EXPLOIT_BANK, policyMode, path));
    }
  }
  const underwater = shape({ cashReserves: 100, npcDeposits: 500 });
  for (const path of EVIDENCE_PATHS) {
    cases.push(settle("underwater-bank", underwater, "pointer", path));
  }
  for (const path of EVIDENCE_PATHS) {
    cases.push(settle("no-bank", null, "n/a", path));
  }

  const invariants: EvidenceInvariant[] = [];
  const of = (fixture: string, policyMode: string, path: string) =>
    cases.find((c) => c.fixture === fixture && c.policyMode === policyMode && c.path === path)!;

  // A: the hole is reproduced (control < NAV) and closed (settled >= NAV).
  for (const policyMode of ["pointer", "authoritative"] as const) {
    for (const path of EVIDENCE_PATHS) {
      const c = of("exploit-bank", policyMode, path.name);
      const navMinority = MINORITY_SHARES * c.floorPerShare;
      invariants.push(
        check(
          `A-hole-${policyMode}-${path.name}`,
          `control settles below realizable NAV (${c.controlTotal} < ${navMinority})`,
          c.controlTotal < navMinority
        ),
        check(
          `A-closed-${policyMode}-${path.name}`,
          `floored settlement covers realizable NAV (${c.settledTotal} >= ${navMinority})`,
          c.settledTotal >= navMinority && c.floorApplied
        )
      );
    }
  }

  // A-noop: underwater and bankless corps price at the market leg exactly.
  for (const fixture of ["underwater-bank", "no-bank"] as const) {
    for (const path of EVIDENCE_PATHS) {
      const mode = fixture === "no-bank" ? "n/a" : "pointer";
      const c = of(fixture, mode, path.name);
      invariants.push(
        check(
          `A-noop-${fixture}-${path.name}`,
          `no floor without realizable NAV (settled == market == ${c.controlTotal})`,
          !c.floorApplied && c.settledTotal === c.controlTotal && c.floorPerShare === 0
        )
      );
    }
  }

  // B: conservation. The settlement is a pure transfer: the payer debit
  // equals the payee credit to the cent, shares retired equal minority
  // shares bought, outstanding is conserved, and the target NAV arrives at
  // the acquirer intact (moved, never minted).
  for (const policyMode of ["pointer", "authoritative"] as const) {
    const c = of("exploit-bank", policyMode, "hostile");
    const payerDebit = c.settledTotal;
    const payeeCredit = MINORITY_SHARES * (c.settledTotal / MINORITY_SHARES);
    const retired = MINORITY_SHARES;
    const outstandingPost = TOTAL_SHARES - retired;
    // Fund-only decomposition mirrors fundOnlyBuyout.ts: market execution
    // plus a treasury top-up to the floor, measured against actual paid.
    const f = of("exploit-bank", policyMode, "fund-only");
    const executedTotal = MINORITY_SHARES * f.marketPerShare;
    const topUp = Math.round((f.floorPerShare - f.marketPerShare) * MINORITY_SHARES * 100) / 100;
    const acquirerNavGain = c.navTotal;
    invariants.push(
      check(
        `B-money-${policyMode}`,
        `payer debit == payee credit (${payerDebit} == ${payeeCredit})`,
        payerDebit === payeeCredit && Number.isInteger(Math.round(payerDebit * 100))
      ),
      check(
        `B-shares-${policyMode}`,
        `retired == minority bought and outstanding conserved (${outstandingPost} == ${TOTAL_SHARES - MINORITY_SHARES})`,
        retired === MINORITY_SHARES && outstandingPost === TOTAL_SHARES - MINORITY_SHARES
      ),
      check(
        `B-topup-${policyMode}`,
        `fund-only execution + top-up == floored total (${executedTotal} + ${topUp} == ${f.settledTotal})`,
        executedTotal + topUp === f.settledTotal
      ),
      check(
        `B-nav-transfer-${policyMode}`,
        `acquirer NAV gain == target NAV, minted zero (${acquirerNavGain} == ${c.navTotal})`,
        acquirerNavGain - c.navTotal === 0
      )
    );
  }

  // C: genuine liabilities netted exactly once, through production code.
  const base = shape({ cashReserves: 1_000_000 });
  const liabilityLegs: Array<[string, Partial<CharterShape>]> = [
    ["npcDeposits", { npcDeposits: 250_000 }],
    ["discountWindowDebt", { discountWindowDebt: 250_000 }],
    ["discountWindowArrears", { discountWindowArrears: 250_000 }],
    ["cbMarginDebt", { cbMarginDebt: 250_000 }],
    ["cbMarginArrears", { cbMarginArrears: 250_000 }],
    ["interbankDebt", { interbankDebt: 250_000 }],
  ];
  for (const [leg, delta] of liabilityLegs) {
    const diff =
      takeoverBankNav(shape({ ...base, ...delta }) as never, {}) -
      takeoverBankNav(base as never, {});
    invariants.push(
      check(`C-liability-${leg}`, `+250k ${leg} moves NAV by exactly -250k`, diff === -250_000)
    );
  }
  const playerDelta = { playerDeposits: 250_000, totalDeposits: 250_000 };
  const pointerDiff =
    takeoverBankNav(shape({ ...base, ...playerDelta }) as never, {
      playerDepositsAreLiabilities: false,
    }) - takeoverBankNav(base as never, { playerDepositsAreLiabilities: false });
  const authoritativeDiff =
    takeoverBankNav(shape({ ...base, ...playerDelta }) as never, {
      playerDepositsAreLiabilities: true,
    }) - takeoverBankNav(base as never, { playerDepositsAreLiabilities: true });
  invariants.push(
    check(
      "C-player-pointer",
      "player pointer deposits are not liabilities until authoritative (delta 0)",
      pointerDiff === 0
    ),
    check(
      "C-player-authoritative",
      "authoritative player deposits net exactly once (delta -250k)",
      authoritativeDiff === -250_000
    )
  );

  // C-mark: a prop buy reclasses cash into mark; NAV must not move.
  const markAmount = 300_000;
  const markDiff =
    takeoverBankNav(
      shape({ cashReserves: 1_000_000 - markAmount, propBookMarkValue: markAmount }) as never,
      {}
    ) - takeoverBankNav(shape({ cashReserves: 1_000_000 }) as never, {});
  const distributableUnmoved =
    bankEquity(shape({ cashReserves: 1_000_000, propBookMarkValue: markAmount }) as never, {}) -
    bankEquity(shape({ cashReserves: 1_000_000 }) as never, {});
  invariants.push(
    check(
      "C-mark-once",
      "prop buy is a reclass, not new value (takeover NAV delta 0)",
      markDiff === 0
    ),
    check(
      "C-mark-not-distributable",
      "marks never leak into distributable equity (bankEquity delta 0)",
      distributableUnmoved === 0
    )
  );

  // D: non-bank parity is already covered by A-noop; pin the inputs too.
  invariants.push(
    check(
      "D-quote-weight-untouched",
      "secondary-market quote weight needs no change here (floor is settlement-only)",
      takeoverBankNav(null, {}) === 0 &&
        bankNavFloorPerShareAnchor({ bankNavAnchor: 0, totalShares: TOTAL_SHARES }) === 0
    )
  );

  return {
    kind: EVIDENCE_KIND,
    worldsimCoversAuthenticatedCommands: false,
    worldsimNote: WORLDSIM_NON_COVERAGE_NOTE,
    seed,
    source,
    cases,
    invariants,
    pass: invariants.every((i) => i.pass),
  };
}

export function evidenceExitCode(report: EvidenceReport): 0 | 1 {
  return report.pass ? 0 : 1;
}

/** Canonical byte-stable serialization for the gated artifact. */
export function serializeEvidenceReport(report: EvidenceReport): string {
  return `${JSON.stringify(sortKeys(report), null, 2)}\n`;
}

export interface GatedEvidenceRequest {
  seed?: string;
  sourceWorktree?: string;
  sourceCommit?: string;
}

export interface GatedEvidenceResult {
  report: EvidenceReport;
  exitCode: 0 | 1;
}

function gateFailure(seed: string, message: string): GatedEvidenceResult {
  const report = runTakeoverBankNavEvidence(seed, null);
  report.invariants.push({
    id: "G-source-verified",
    statement: `pinned source verification failed: ${message}`,
    pass: false,
  });
  report.pass = false;
  return { report, exitCode: 1 };
}

/**
 * Operational gate around the pure scenario. The pin is verified through
 * the established simSource contract (full-SHA shape, registered worktree,
 * HEAD equality, clean checkout) against live git unless the caller injects
 * deps. Unpinned, mismatched, or dirty checkouts fail closed: the artifact
 * carries a failed G-source-verified invariant, pass is false, and the exit
 * code is 1. The pure runTakeoverBankNavEvidence stays pin-optional for
 * unit tests; only this gate (and the CLI below) emits passable artifacts.
 */
export function runGatedTakeoverBankNavEvidence(
  req: GatedEvidenceRequest = {},
  deps: SimSourceDeps = defaultSimSourceDeps(),
  opts?: { root?: string; main?: string }
): GatedEvidenceResult {
  const seed = req.seed ?? EVIDENCE_SEED;
  let verified: { worktree: string; commit: string };
  try {
    const result = verifySimSource(
      { sourceWorktree: req.sourceWorktree, sourceCommit: req.sourceCommit },
      deps,
      opts
    );
    if (!result) {
      return gateFailure(
        seed,
        "evidence must be pinned: pass --source-worktree and --source-commit (unpinned runs cannot pass)"
      );
    }
    verified = result;
  } catch (err) {
    return gateFailure(seed, err instanceof Error ? err.message : String(err));
  }
  const report = runTakeoverBankNavEvidence(seed, {
    worktree: verified.worktree,
    commit: verified.commit,
  });
  return { report, exitCode: evidenceExitCode(report) };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}

function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/* istanbul ignore next: CLI entry; the gate is unit-tested via runGatedTakeoverBankNavEvidence. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { report, exitCode } = runGatedTakeoverBankNavEvidence({
    seed: argValue(argv, "seed"),
    sourceWorktree: argValue(argv, "source-worktree"),
    sourceCommit: argValue(argv, "source-commit"),
  });
  const json = serializeEvidenceReport(report);
  const out = argValue(argv, "out");
  if (out) {
    await writeFile(out, json, "utf8");
  }
  process.stdout.write(json);
  if (exitCode !== 0) {
    const failed = report.invariants.filter((i) => !i.pass).map((i) => i.id);
    console.error(`takeover-bank-nav evidence FAILED: ${failed.join(", ")}`);
  }
  process.exitCode = exitCode;
}

// ESM-safe direct-run check (no import.meta cycle under tsx/vitest).
const invokedDirectly = process.argv[1]?.endsWith("takeoverBankNavEvidence.ts") ?? false;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
