/**
 * Property tests over the savings command rules.
 *
 * For hundreds of seeded random command sequences against a pure model of
 * the world (wallet, central bank pool, bank vaults), every decision the
 * rules make must keep these true:
 *
 * - an allowed transition's legs net to zero and every debit or credit
 *   names a target;
 * - the account balance is never negative, and the balance the rules
 *   project equals the balance the model reaches by applying the legs;
 * - the backing follows the holder: the sum of what the holder side holds
 *   equals the balance, whoever holds it;
 * - the same command on the same state decides the same way (pure);
 * - a refusal carries a message and no transition.
 */

import { describe, expect, it } from "vitest";
import { forSeeds, type SeededRandom } from "@/lib/test-utils/seededRandom";
import { legsNet } from "@/lib/banking/rules/invariants";
import {
  decideSavingsCommand,
  type HolderSnapshot,
  type SavingsCommand,
  type SavingsContext,
} from "@/lib/savings/rules/commands";
import type { SavingsAccountSnapshot } from "@/lib/savings/rules/accounts";
import { CENTRAL_BANK_HOLDER } from "@/lib/savings/rules/accounts";

const CB = "US";
const BANKS = ["6a9999c8a2aaf2117dcc0001", "6a9999c8a2aaf2117dcc0002"];

interface Model {
  wallet: number;
  /** Cash the central bank pool holds (the owner's backing when the CB is the holder). */
  pool: number;
  /** Backing held by each bank's vault. */
  vault: Record<string, number>;
  /** Player deposit liability each bank carries. */
  liability: Record<string, number>;
  cbLiability: number;
}

function holderSnapshot(model: Model, holder: string, random: SeededRandom): HolderSnapshot {
  if (holder === CENTRAL_BANK_HOLDER) {
    return { holder, cash: 0, acceptsDeposits: true, playerDeposits: 0, active: true };
  }
  return {
    holder,
    cash: model.vault[holder] ?? 0,
    acceptsDeposits: random.chance(0.9),
    playerDeposits: model.liability[holder] ?? 0,
    depositCeiling: random.chance(0.5) ? random.money(500, 50_000) : undefined,
    active: random.chance(0.95),
  };
}

/** Apply a transition's legs to the model by (collection, path). */
function applyLegs(model: Model, legs: Array<Record<string, unknown>>): void {
  for (const leg of legs) {
    const kind = leg.kind as string;
    const amount = leg.amount as number;
    if (kind === "mint" || kind === "burn") continue;
    const collection = leg.collection as string;
    const path = leg.path as string;
    const filter = leg.filter as Record<string, unknown>;
    const sign = kind === "debit" ? -1 : 1;
    if (collection === "characters") {
      expect(path).toMatch(/personal/);
      model.wallet += sign * amount;
    } else if (collection === "centralBanks") {
      expect(path).toBe("externalBroadMoney");
      model.pool += sign * amount;
    } else if (collection === "corporations") {
      expect(path).toBe("bankCharter.cashReserves");
      const id = (filter._id as { $oid: string }).$oid;
      model.vault[id] = (model.vault[id] ?? 0) + sign * amount;
    } else {
      throw new Error(`unexpected leg target ${collection}.${path}`);
    }
  }
}

/** Apply the liability projections the rules emit ($inc on the holder). */
function applyProjections(model: Model, projections: Array<Record<string, unknown>>): void {
  for (const projection of projections) {
    const update = projection.update as { $inc?: Record<string, number> } | undefined;
    const inc = update?.$inc ?? {};
    const collection = projection.collection as string;
    if (collection === "corporations" && typeof inc["bankCharter.playerDeposits"] === "number") {
      const id = ((projection.filter as Record<string, unknown>)._id as { $oid: string }).$oid;
      model.liability[id] = (model.liability[id] ?? 0) + inc["bankCharter.playerDeposits"];
    }
    if (collection === "centralBanks" && typeof inc.householdSavingsLiability === "number") {
      model.cbLiability += inc.householdSavingsLiability;
    }
  }
}

function checkTransition(transition: { legs: Array<Record<string, unknown>> }): void {
  expect(Math.abs(legsNet(transition.legs as never))).toBeLessThan(1e-6);
  for (const leg of transition.legs) {
    if (leg.kind === "debit" || leg.kind === "credit") {
      expect(leg.collection).toBeTruthy();
      expect(leg.path).toBeTruthy();
      expect(leg.filter).toBeTruthy();
    }
    expect(leg.amount as number).toBeGreaterThan(0);
  }
}

describe("savings command rules, property", () => {
  it("keeps balances, backing and liabilities in step over random sequences", () => {
    forSeeds(300, (random, seed) => {
      const model: Model = {
        wallet: random.money(0, 20_000),
        pool: 1_000_000,
        vault: Object.fromEntries(BANKS.map((b) => [b, random.money(0, 100_000)])),
        liability: Object.fromEntries(BANKS.map((b) => [b, 0])),
        cbLiability: 0,
      };
      let account: SavingsAccountSnapshot = {
        id: `acct-${seed}`,
        ownerType: "character",
        ownerId: "6a9999c8a2aaf2117dcc9999",
        currency: "USD",
        balance: 0,
        holder: CENTRAL_BANK_HOLDER,
        status: "open",
        version: 0,
        accruedInterest: 0,
        interestEarned: 0,
        openedTurn: 1,
      };
      const startingMoney =
        model.wallet + model.pool + Object.values(model.vault).reduce((a, b) => a + b, 0);
      let minted = 0;

      for (let step = 0; step < 40; step += 1) {
        const ctx: SavingsContext = { turn: 100 + step, centralBankId: CB, privateBanking: true };
        const holderNow = holderSnapshot(model, account.holder, random);
        const kind = random.pick([
          "deposit",
          "withdraw",
          "transfer_holder",
          "accrue_interest",
          "credit_interest",
        ] as const);
        let command: SavingsCommand;
        switch (kind) {
          case "deposit":
            command = {
              type: "deposit",
              amount: random.chance(0.1)
                ? random.money(-100, 0)
                : random.money(0.01, model.wallet * 1.2 + 10),
              walletBalance: model.wallet,
              holder: holderNow,
            };
            break;
          case "withdraw":
            command = {
              type: "withdraw",
              amount: random.chance(0.1) ? 0 : random.money(0.01, account.balance * 1.2 + 10),
              holder: holderNow,
            };
            break;
          case "transfer_holder": {
            const to = random.pick([CENTRAL_BANK_HOLDER, ...BANKS]);
            command = {
              type: "transfer_holder",
              from: holderNow,
              to: holderSnapshot(model, to, random),
            };
            break;
          }
          case "accrue_interest":
            command = { type: "accrue_interest", amount: random.money(0, 50) };
            break;
          case "credit_interest":
            command = { type: "credit_interest", holder: holderNow };
            break;
        }
        const commandId = `c${step}`;
        const decision = decideSavingsCommand(account, command, ctx, commandId);
        // Pure: the same input decides the same way.
        expect(decideSavingsCommand(account, command, ctx, commandId)).toEqual(decision);

        if (!decision.allowed) {
          expect(decision.message.length).toBeGreaterThan(0);
          expect((decision as { transition?: unknown }).transition).toBeUndefined();
          continue;
        }
        const transition = decision.transition as unknown as {
          key: string;
          legs: Array<Record<string, unknown>>;
          projections: Array<Record<string, unknown>>;
        };
        checkTransition(transition);
        expect(transition.key).toContain(commandId);
        applyLegs(model, transition.legs);
        applyProjections(model, transition.projections);
        for (const leg of transition.legs) {
          if (leg.kind === "mint") minted += leg.amount as number;
          if (leg.kind === "burn") minted -= leg.amount as number;
        }
        account = decision.next;

        // Never negative, anywhere.
        expect(account.balance).toBeGreaterThanOrEqual(-1e-9);
        expect(model.wallet).toBeGreaterThanOrEqual(-1e-9);
        for (const bank of BANKS) expect(model.vault[bank]).toBeGreaterThanOrEqual(-1e-9);
        // Money is conserved except for what the rules explicitly minted.
        const money =
          model.wallet + model.pool + Object.values(model.vault).reduce((a, b) => a + b, 0);
        expect(money).toBeCloseTo(startingMoney + minted, 6);
        // The liability follows the holder and equals the balance.
        if (account.holder === CENTRAL_BANK_HOLDER) {
          expect(model.cbLiability).toBeCloseTo(account.balance, 6);
          for (const bank of BANKS) expect(model.liability[bank]).toBeCloseTo(0, 6);
        } else {
          expect(model.liability[account.holder]).toBeCloseTo(account.balance, 6);
          expect(model.cbLiability).toBeCloseTo(0, 6);
        }
      }
    });
  });
});
