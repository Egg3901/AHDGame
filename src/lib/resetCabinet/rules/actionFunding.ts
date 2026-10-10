/**
 * Ministerial action funding. An occupied office supplies administrative capacity;
 * only cash actions need flexible funds. Specialized accounts keep their own ledger.
 */
export function cabinetActionFunding(input: {
  accounts: readonly { balance: number; encumbered: number; externallySettled: boolean }[];
  defenseSeat: boolean;
  defenseAppropriation?: { balance: number; encumbered?: number };
}): { source: "department" | "defense" | "none"; flexibleFunds: number } {
  const ordinary = input.accounts.filter((account) => !account.externallySettled);
  if (ordinary.length > 0) {
    return {
      source: "department",
      flexibleFunds: ordinary.reduce(
        (sum, account) => sum + Math.max(0, account.balance - account.encumbered),
        0
      ),
    };
  }
  if (input.defenseSeat && input.defenseAppropriation) {
    return {
      source: "defense",
      flexibleFunds: Math.max(
        0,
        input.defenseAppropriation.balance - (input.defenseAppropriation.encumbered ?? 0)
      ),
    };
  }
  return { source: "none", flexibleFunds: 0 };
}
