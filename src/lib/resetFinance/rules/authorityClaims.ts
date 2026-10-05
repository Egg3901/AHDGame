/** One claim roster for the live host and cash simulation. No extra spending ledger. */
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import type { CashAuthorityClaim } from "./cashTurn";
import type {
  ResetDepartmentAccountSnapshot,
  ResetDepartmentContinuitySnapshot,
} from "./liveDepartmentAccount";

export function buildResetAuthorityClaims(
  accounts: readonly ResetDepartmentAccountSnapshot[],
  reserve: ResetDepartmentContinuitySnapshot,
  turn: number
): CashAuthorityClaim[] {
  const ids = new Set<string>();
  const scheduled = (annual: number) => includedAuthorityPerTurn(annual, turn);
  const claims: CashAuthorityClaim[] = accounts.map((account) => {
    if (
      account.countryId !== reserve.countryId ||
      account.worldId !== reserve.worldId ||
      account.sourceTurn !== reserve.sourceTurn ||
      account._id !== `${account.countryId}:${account.departmentId}` ||
      ids.has(account._id)
    )
      throw new Error("Invalid cash account identity");
    ids.add(account._id);
    const annual = Object.values(account.familyAnnualDemand);
    if (annual.reduce((sum, value) => sum + value, 0) !== account.annualAuthority)
      throw new Error("Account authority does not reconcile to its programs");
    return {
      id: account._id,
      category: account.externallySettled ? "mandatory" : "existing",
      amount: annual.reduce((sum, value) => sum + scheduled(value), 0),
    };
  });
  claims.push({
    id: `${reserve.countryId}:continuity`,
    category: "existing",
    amount: scheduled(reserve.annualAuthority),
  });
  claims.push({
    id: `${reserve.countryId}:grants`,
    category: "grants",
    amount:
      scheduled(reserve.grantReservation) +
      accounts.reduce((sum, account) => sum + scheduled(account.grantReservation), 0),
  });
  return claims;
}
