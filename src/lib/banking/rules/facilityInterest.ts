/** Central-bank facility interest preserves its original cash payment and arrears on retry. */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { oid, type BankingTransition } from "./boundary";

export type FacilityKind = "cbMargin" | "discountWindow";

export function facilityInterestTransition(input: {
  key: string;
  bankId: string;
  centralBankId: string;
  currency: string;
  turn: number;
  facility: FacilityKind;
  debt: number;
  ratePercent: number;
  availableCash: number;
}): BankingTransition {
  const due = (Math.max(0, input.debt) * (input.ratePercent / 100)) / TURNS_PER_YEAR;
  const paid = Math.min(due, Math.max(0, input.availableCash));
  const shortfall = Math.max(0, due - paid);
  const stamp = input.facility === "cbMargin" ? "lastCbMarginTurn" : "lastDiscountWindowTurn";
  return {
    key: input.key,
    kind: input.facility === "cbMargin" ? "cb_margin_interest" : "discount_window_interest",
    turn: input.turn,
    currency: input.currency,
    legs:
      paid > 0
        ? [
            {
              kind: "debit",
              amount: paid,
              collection: "corporations",
              filter: { _id: oid(input.bankId), "bankCharter.status": "active" },
              path: "bankCharter.cashReserves",
              note: "bank pays central-bank facility interest",
            },
            {
              kind: "credit",
              amount: paid,
              collection: "centralBanks",
              filter: { _id: input.centralBankId },
              path: "reserveBalance",
              note: "central bank receives facility interest",
            },
          ]
        : [],
    projections: [
      {
        collection: "corporations",
        filter: { _id: oid(input.bankId), "bankCharter.status": "active" },
        update: {
          $inc: {
            [`bankCharter.${input.facility}Arrears`]: shortfall,
            "bankCharter.lastBankingIncome": -due,
            "bankCharter.lastBankingFacilityInterest": due,
          },
          $set: {
            [`bankCharter.${stamp}`]: input.turn,
            "bankCharter.lastBankingIncomeTurn": input.turn,
          },
        },
        note: "original facility charge, unpaid liability and servicing turn",
      },
    ],
    event: {
      kind: shortfall > 0 ? "loan.delinquent" : "loan.paid",
      command: "bank.turn.facilityInterest",
      amount: paid,
    },
  };
}

export function facilityInterestAmounts(transition: BankingTransition): {
  paid: number;
  shortfall: number;
} {
  const paid = transition.legs.find((leg) => leg.kind === "debit")?.amount ?? 0;
  const increments = transition.projections[0]?.update?.$inc as Record<string, number> | undefined;
  const due = increments?.["bankCharter.lastBankingFacilityInterest"];
  if (typeof due !== "number" || !Number.isFinite(due))
    throw new Error("Facility receipt has no original charge");
  return { paid, shortfall: Math.max(0, due - paid) };
}
