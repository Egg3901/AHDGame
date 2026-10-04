/** Portable conversion from an annual program claim and Cabinet percentage to a turn request. */
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

export function annualProgramFundingRequest(baseAnnual: number, percent: number): number {
  nonNegativeSafeInteger(baseAnnual, "family annual demand");
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 200) {
    throw new Error("Cabinet allocation must be an integer percent from 0 to 200");
  }
  return nonNegativeSafeInteger(
    Number((BigInt(baseAnnual) * BigInt(percent) + BigInt(50)) / BigInt(100)),
    "authored annual request"
  );
}

export function programFundingRequestPerTurn(
  baseAnnual: number,
  percent: number,
  turn: number
): number {
  return includedAuthorityPerTurn(annualProgramFundingRequest(baseAnnual, percent), turn);
}

export function departmentFundingPreview(input: {
  annualAuthority: number;
  balance: number;
  encumbered: number;
  arrears: number;
  requestedPerTurn: number;
  turn: number;
}): {
  authorityPerTurn: number;
  availableForPrograms: number;
  allocationRemaining: number;
} {
  const authorityPerTurn = includedAuthorityPerTurn(input.annualAuthority, input.turn);
  const balance = nonNegativeSafeInteger(input.balance, "department balance");
  const encumbered = nonNegativeSafeInteger(input.encumbered, "department encumbrance");
  const arrears = nonNegativeSafeInteger(input.arrears, "department arrears");
  const requestedPerTurn = nonNegativeSafeInteger(
    input.requestedPerTurn,
    "department requested funding"
  );
  const availableForPrograms = Math.max(0, balance + authorityPerTurn - encumbered - arrears);
  return {
    authorityPerTurn,
    availableForPrograms,
    allocationRemaining: availableForPrograms - requestedPerTurn,
  };
}
