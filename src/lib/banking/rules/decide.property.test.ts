/**
 * Property tests over the bank command rules.
 *
 * Random charters (cash, deposits, loans, standing, band, facilities) and
 * random commands, hundreds of seeds. Whatever the rules decide:
 *
 * - an allowed transition nets to zero and every debit or credit names a
 *   target, so nothing the rules emit can create or lose money;
 * - a refusal carries a message and no transition;
 * - the decision is pure (same input, same output);
 * - the lifecycle table is never bypassed: an impaired charter is never
 *   allowed to originate or distribute, a dead one never allowed anything;
 * - a debit from the vault never exceeds the cash the snapshot shows, so a
 *   guarded write can only fail because the world moved, never because the
 *   rules asked for more than there was.
 */

import { describe, expect, it } from "vitest";
import { forSeeds, type SeededRandom } from "@/lib/test-utils/seededRandom";
import { legsNet } from "@/lib/banking/rules/invariants";
import { decideBankCommand } from "@/lib/banking/rules/decide";
import { lifecycleStage } from "@/lib/banking/rules/lifecycle";
import { BANKING_POLICY_ALL_ON } from "@/lib/banking/rules/policy";
import type {
  BankCharterSnapshot,
  BankCommand,
  BankingSnapshot,
} from "@/lib/banking/rules/boundary";

const BANK = "a".repeat(24);
const OTHER = "b".repeat(24);

function randomCharter(random: SeededRandom): BankCharterSnapshot | null {
  if (random.chance(0.05)) return null;
  const status = random.pick(["active", "active", "active", "failed", "revoked"] as const);
  const type = random.pick(["retail", "universal", "investment"] as const);
  return {
    type,
    status,
    currency: "USD",
    postedCapital: random.money(0, 2_000_000),
    cashReserves: random.money(0, 3_000_000),
    npcDeposits: type === "investment" ? 0 : random.money(0, 10_000_000),
    playerDeposits: random.chance(0.5) ? random.money(0, 2_000_000) : undefined,
    totalDeposits: random.money(0, 12_000_000),
    totalLoans: random.money(0, 8_000_000),
    depositOffset: random.int(-2, 2),
    lendingOffset: random.int(-2, 4),
    discountWindowDebt: random.chance(0.3) ? random.money(0, 500_000) : 0,
    cbMarginDebt: random.chance(0.3) ? random.money(0, 500_000) : 0,
    interbankDebt: random.chance(0.3) ? random.money(0, 500_000) : 0,
    capitalStanding: random.pick(["adequate", "adequate", "stressed", "undercapitalized"] as const),
    warningBand: random.pick(["green", "green", "amber", "red"] as const),
    resolutionClaimedTurn: status === "failed" && random.chance(0.3) ? 150 : undefined,
    depositorsResolvedTurn: status === "failed" && random.chance(0.3) ? 160 : undefined,
  };
}

function randomCommand(random: SeededRandom): BankCommand {
  const amount = random.chance(0.1) ? random.money(-1_000, 0) : random.money(0.01, 3_000_000);
  switch (random.int(0, 8)) {
    case 0:
      return { type: "inject_capital", amount } as BankCommand;
    case 1:
      return { type: "upstream_cash", amount } as BankCommand;
    case 2:
      return { type: "draw_discount_window", amount } as BankCommand;
    case 3:
      return { type: "repay_discount_window", amount } as BankCommand;
    case 4:
      return { type: "draw_cb_margin", amount } as BankCommand;
    case 5:
      return { type: "repay_cb_margin", amount } as BankCommand;
    case 6:
      return {
        type: "lend_interbank",
        loanId: "c".repeat(24),
        borrowerBankId: OTHER,
        borrowerCharter: {
          type: "investment",
          status: "active",
          currency: "USD",
          postedCapital: 500_000,
          cashReserves: random.money(0, 1_000_000),
          npcDeposits: 0,
          totalDeposits: 0,
          totalLoans: random.money(0, 2_000_000),
          depositOffset: 0,
          lendingOffset: 0,
        },
        amount,
        ratePercent: random.money(0, 12),
        lenderOutstanding: random.money(0, 1_000_000),
      } as BankCommand;
    case 7:
      return {
        type: "originate_named_loan",
        loanId: "d".repeat(24),
        borrower: {
          type: "corporation",
          id: OTHER,
          income: random.money(0, 500_000),
          existingDebtService: random.money(0, 100_000),
          creditScore: random.int(300, 850),
        },
        principal: amount,
        termTurns: random.int(1, 120),
      } as unknown as BankCommand;
    default:
      return { type: "repay_interbank", loanId: "e".repeat(24), amount } as BankCommand;
  }
}

describe("bank command rules, property", () => {
  it("never emits an unbalanced or untargeted transition and never bypasses the lifecycle table", () => {
    let allowed = 0;
    let refused = 0;
    forSeeds(400, (random) => {
      const charter = randomCharter(random);
      const snapshot: BankingSnapshot = {
        turn: 200,
        policy: BANKING_POLICY_ALL_ON,
        bankId: BANK,
        currency: "USD",
        charter,
        corporationLiquidCapital: random.money(0, 5_000_000),
        reserveRatio: random.pick([0.05, 0.1, 0.2]),
        playerDepositsAreLiabilities: random.chance(0.5),
        primeRate: random.money(0, 10),
        centralBankId: "US",
        ...(random.chance(0.5) ? { capacityCeiling: random.money(0, 20_000_000) } : {}),
      };
      for (let i = 0; i < 6; i += 1) {
        const command = randomCommand(random);
        const opts = { commandId: `p${i}` };
        const decision = decideBankCommand(snapshot, command, opts);
        expect(decideBankCommand(snapshot, command, opts)).toEqual(decision);
        const stage = lifecycleStage(charter);

        if (!decision.allowed) {
          refused += 1;
          expect(decision.message.length).toBeGreaterThan(0);
          expect((decision as { transition?: unknown }).transition).toBeUndefined();
          continue;
        }
        allowed += 1;
        const { legs } = decision.transition;
        expect(Math.abs(legsNet(legs))).toBeLessThan(1e-6);
        let vaultDebit = 0;
        for (const leg of legs) {
          expect(leg.amount).toBeGreaterThan(0);
          if (leg.kind === "debit" || leg.kind === "credit") {
            expect(leg.collection).toBeTruthy();
            expect(leg.path).toBeTruthy();
            expect(leg.filter).toBeTruthy();
          }
          if (
            leg.kind === "debit" &&
            leg.collection === "corporations" &&
            leg.path === "bankCharter.cashReserves" &&
            JSON.stringify(leg.filter).includes(BANK)
          ) {
            vaultDebit += leg.amount;
          }
        }
        expect(vaultDebit).toBeLessThanOrEqual((charter?.cashReserves ?? 0) + 1e-6);

        // The lifecycle table: what a stage refuses, the rules never allow.
        if (stage === "impaired") {
          expect(["originate_named_loan", "lend_interbank", "upstream_cash"]).not.toContain(
            command.type
          );
        }
        if (stage === "watch") expect(command.type).not.toBe("upstream_cash");
        if (
          stage === "failed" ||
          stage === "resolving" ||
          stage === "resolved" ||
          stage === "revoked"
        ) {
          throw new Error(`a ${stage} charter was allowed ${command.type}`);
        }
        if (!charter) throw new Error(`no charter was allowed ${command.type}`);
      }
    });
    // The generator reaches both sides of the boundary.
    expect(allowed).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
  });
});
