import { describe, expect, it } from "vitest";
import {
  producerPayableId,
  settlePriorProducerPayables,
  type ProducerPayable,
} from "./payablesRules";

const claim = (changes: Partial<Omit<ProducerPayable, "id">> = {}): ProducerPayable => {
  const fields = {
    debtorAccountId: "corp",
    creditorAccountId: "workers",
    producerId: "plant",
    kind: "labour" as const,
    amount: 20,
    ...changes,
  };
  return { ...fields, id: producerPayableId(fields) };
};
describe("producer bill claims", () => {
  it("pays old creditors pro rata and preserves the unpaid balances", () => {
    const result = settlePriorProducerPayables({
      accounts: [
        { id: "corp", cash: 15 },
        { id: "workers", cash: 0 },
        { id: "landlord", cash: 0 },
      ],
      payables: [claim(), claim({ creditorAccountId: "landlord", kind: "operating", amount: 10 })],
    });
    expect(result.accounts).toEqual([
      { id: "corp", cash: 0 },
      { id: "workers", cash: 10 },
      { id: "landlord", cash: 5 },
    ]);
    expect(result.payables.reduce((sum, row) => sum + row.amount, 0)).toBe(15);
    expect(result.payments.reduce((sum, row) => sum + row.amount, 0)).toBe(15);
  });
  it("does not finance old invoices from money their debtor has not received", () => {
    const result = settlePriorProducerPayables({
      accounts: [
        { id: "corp", cash: 10 },
        { id: "workers", cash: 0 },
        { id: "landlord", cash: 0 },
      ],
      payables: [
        claim({ amount: 10 }),
        claim({ debtorAccountId: "workers", creditorAccountId: "landlord", amount: 10 }),
      ],
    });
    expect(result.accounts).toEqual([
      { id: "corp", cash: 0 },
      { id: "workers", cash: 10 },
      { id: "landlord", cash: 0 },
    ]);
    expect(result.payables).toHaveLength(1);
    expect(result.payables[0].debtorAccountId).toBe("workers");
  });
  it("refuses missing creditors instead of forgiving their claims", () => {
    expect(() =>
      settlePriorProducerPayables({ accounts: [{ id: "corp", cash: 10 }], payables: [claim()] })
    ).toThrow("opening producer payable");
  });
});
