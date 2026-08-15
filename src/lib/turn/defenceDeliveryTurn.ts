import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { rawLotsFromSector, militaryDivertedShare } from "@/lib/military/arsenal";
import { componentsForStrategy, gradeCeilingFor } from "@/lib/military/arsenalComponents";
import {
  listActiveContracts,
  advanceContract,
  stampDeliveryCarry,
} from "@/lib/db/collections/defenceContracts";
import { depositLots, drawLots } from "@/lib/db/collections/nationalArsenal";
import {
  debitAppropriation,
  creditAppropriation,
  getDefenseAppropriation,
} from "@/lib/db/collections/defenseAppropriation";
import { emitTx } from "@/lib/financialTxLog/emit";

export interface DeliveryResult {
  lots: number;
  paid: number;
  /** Contracts that could not deliver — retooled plant, foreign supplier, currency mismatch. */
  stalled: number;
}

/** Whether this corporation may be paid out of this country's appropriation at all. */
export function canSupply(
  corp: Pick<Corporation, "countryId" | "liquidCurrencyCode">,
  countryId: string
): boolean {
  // Domestic-only is a payment-safety constraint, not a simplification. Paying a mismatched
  // corp would move one currency into a balance denominated in another with no conversion
  // anywhere. Missing `liquidCurrencyCode` is inferred from the corp's country — the same
  // rule `resolveCorpLiquidCurrencyCode` uses everywhere else — not treated as USD. The USD
  // default hid every non-US domestic plant from the award picker (ticket #1087).
  if (corp.countryId !== countryId) return false;
  const corpCurrency = resolveCorpLiquidCurrencyCode(corp);
  return corpCurrency === COUNTRY_CURRENCY_MAP[countryId as CountryId];
}

/**
 * Per-turn: every active contract delivers what its plant produced into the arsenal, paid for
 * out of the defence appropriation.
 *
 * Three caps apply, in this order:
 *   1. what the plant produced       — you cannot deliver what you did not build
 *   2. what remains on the order     — a contract never over-delivers what it was billed for
 *   3. what the appropriation covers — procurement has NO overdraft
 *
 * Cap 3 stalls rather than borrowing: C1 established the overdraft is for upkeep, an
 * obligation already incurred, never for new purchases. A country that cannot pay this turn
 * takes fewer lots and the contract waits.
 *
 * **Payment precedes recording, deliberately.** Recording first would need a rollback on a
 * failed debit, and `advanceContract` clamps negatives to zero — so the "rollback" would be a
 * silent no-op that left the buyer credited with materiel they never paid for. Debiting first
 * means every failure mode is an over-payment, and an over-payment is refundable — which the
 * unwind ladder around the deposit does, reclaiming lots and refunding only what the country
 * did not end up keeping.
 *
 * @param currentYear the world's game YEAR (not turn), which gates the tech decades a
 *   corporation may count toward its grade ceiling.
 * @param maxGrade era ceiling on delivered grade, mirroring the seeder's `MAX_TECH_TIER_BY_ERA`
 *   so a 1953 world cannot be handed modern kit through a contract either.
 */
export async function applyDefenceDeliveries(
  db: Db,
  countryId: string,
  currentYear: number,
  maxGrade = 3,
  currentTurn = 0
): Promise<DeliveryResult> {
  const contracts = await listActiveContracts(db, countryId);
  if (contracts.length === 0) return { lots: 0, paid: 0, stalled: 0 };

  let lots = 0;
  let paid = 0;
  let stalled = 0;
  /** sectorId -> lots delivered this turn, summed across that plant's contracts. */
  const divertedBySector = new Map<string, { sector: CorporateSector; lots: number }>();

  for (const contract of contracts) {
    const [sector, corp] = await Promise.all([
      db.collection<CorporateSector>("corporateSectors").findOne({ _id: contract.sectorId }),
      db.collection<Corporation>("corporations").findOne({ _id: contract.corporationId }),
    ]);
    if (!sector || !corp || !canSupply(corp, countryId)) {
      stalled++;
      continue;
    }

    // The component is frozen at award. A CEO who re-tools mid-contract makes the order
    // undeliverable rather than silently shipping tanks against an order for submarines.
    const components = componentsForStrategy(sector.strategyId);
    if (!components.includes(contract.component)) {
      stalled++;
      continue;
    }

    // A plant serving two domains splits its output rather than delivering in full to each.
    // Accumulate the fractional remainder across turns: a plant producing under one lot per turn
    // used to have that output floored to zero and discarded every turn, so its contract never
    // advanced. The carry (always < 1) is what it has banked toward its next whole lot.
    const rawShare = rawLotsFromSector(sector) / Math.max(1, components.length);
    const carried = contract.deliveryCarry ?? 0;
    const available = carried + rawShare;
    const produced = Math.floor(available);

    const remaining = Math.max(0, contract.lotsOrdered - contract.lotsDelivered);
    const { balance } = await getDefenseAppropriation(db, countryId);
    const affordable =
      contract.pricePerLot > 0 ? Math.floor(Math.max(0, balance) / contract.pricePerLot) : produced;

    const deliverable = Math.min(produced, remaining, affordable);
    // The carry banks everything the plant built and did NOT ship, whole lots included, capped
    // at what the order still needs. Banking only the sub-lot remainder destroyed finished lots:
    // a plant under one lot per turn spent ~10 turns accruing a lot, the appropriation could not
    // afford it that turn, and the whole lot was thrown away while the contract sat at zero
    // delivered forever (ticket #1099). Output already built waits in the yard for money; the
    // cap stops a stalled order stockpiling past what it was billed for.
    const bankFor = (shipped: number) =>
      Math.max(0, Math.min(available - shipped, remaining - shipped));
    const newCarry = bankFor(deliverable);
    if (deliverable <= 0) {
      if (newCarry !== carried) await stampDeliveryCarry(db, contract._id as ObjectId, newCarry);
      continue;
    }
    await stampDeliveryCarry(db, contract._id as ObjectId, newCarry);

    const cost = deliverable * contract.pricePerLot;
    if (cost > 0 && !(await debitAppropriation(db, countryId, cost))) {
      // Lost the balance to a concurrent order between the read and the debit. Nothing has
      // been recorded yet, so there is nothing to unwind.
      continue;
    }

    const recorded = await advanceContract(db, contract._id as ObjectId, deliverable);
    if (recorded < deliverable) {
      // The contract clamped below what was paid for (a concurrent delivery took the
      // remainder). Refund the difference rather than keeping money for undelivered lots.
      await creditAppropriation(db, countryId, (deliverable - recorded) * contract.pricePerLot);
      // Those lots were built but never shipped, so they go back into the bank rather than
      // being destroyed by the carry stamped for the larger figure.
      await stampDeliveryCarry(db, contract._id as ObjectId, bankFor(recorded));
    }
    if (recorded <= 0) continue;

    const grade = Math.min(gradeCeilingFor(corp, currentYear), maxGrade);
    const actualCost = recorded * contract.pricePerLot;

    // The buyer's money has already left the pot, so from here every failure must unwind or
    // it is destroyed outright. Neither write is transactional with the debit, so the
    // handler reclaims what it can and refunds exactly the lots the country did not keep.
    let deposited = 0;
    try {
      await depositLots(db, countryId, contract.component, recorded, grade);
      deposited = recorded;
      await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: corp._id }, { $inc: { liquidCapital: actualCost } });
      const currencyCode = resolveCorpLiquidCurrencyCode(corp);
      if (currencyCode) {
        await emitTx(db, {
          type: "defence_contract_payment",
          turn: currentTurn,
          createdAt: new Date(),
          subjectType: "corporation",
          subjectId: corp._id,
          subjectName: corp.name,
          amount: actualCost,
          currencyCode,
          counterpartyType: "system",
          counterpartyName: `${countryId} defence appropriation`,
          meta: {
            contractId: contract._id.toString(),
            countryId,
            sectorId: sector._id.toString(),
            component: contract.component,
            lots: recorded,
            pricePerLot: contract.pricePerLot,
          },
        });
      }
    } catch {
      // Pull back anything that landed before the failure. `drawLots` reports what it
      // actually took, so lots a concurrent order already consumed stay bought and paid for
      // rather than being refunded twice.
      const reclaimed =
        deposited > 0 ? await drawLots(db, countryId, contract.component, deposited) : 0;
      const unfunded = recorded - deposited + reclaimed;
      if (unfunded > 0) {
        await creditAppropriation(db, countryId, unfunded * contract.pricePerLot);
      }
      // One broken contract must not take down the sweep for every other country.
      stalled++;
      continue;
    }

    lots += recorded;
    paid += actualCost;
    const key = sector._id.toString();
    const prior = divertedBySector.get(key);
    divertedBySector.set(key, {
      sector,
      lots: (prior?.lots ?? 0) + recorded,
    });
  }

  // Stamp what left the market. Output shipped to an arsenal must not also be sold to the
  // world, so this share is deducted from both the plant's revenue and its supply
  // contribution next turn. The turn stamp is what makes it expire on its own when a
  // contract completes or is cancelled — no sweep has to go and clear it.
  if (divertedBySector.size > 0) {
    await db.collection<CorporateSector>("corporateSectors").bulkWrite(
      [...divertedBySector.values()].map(({ sector, lots: delivered }) => ({
        updateOne: {
          filter: { _id: sector._id },
          update: {
            $set: {
              militaryDivertedFraction: militaryDivertedShare(sector, delivered),
              militaryDivertedTurn: currentTurn,
            },
          },
        },
      }))
    );
  }

  return { lots, paid, stalled };
}
