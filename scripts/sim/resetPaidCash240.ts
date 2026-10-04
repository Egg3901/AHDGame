/** 240-turn cash and Cabinet stress using the production portable rules. */
import { DEPARTMENT_DEFINITIONS } from "../../src/lib/governmentFinance/departmentCatalog";
import { includedAuthorityPerTurn } from "../../src/lib/governmentFinance/rules/appropriation";
import { openingFiscalBooks1991 } from "../../src/lib/resetFinance/opening1991";
import { openingNamedGrantClaims1991 } from "../../src/lib/resetFinance/openingOwnership1991";
import { buildOpeningDepartmentBoards1991 } from "../../src/lib/resetFinance/openingDepartmentBoards1991";
import { buildOpeningDepartmentFundingPartition } from "../../src/lib/resetFinance/rules/liveDepartmentAccount";
import { settleLiveDepartmentTurn } from "../../src/lib/resetFinance/rules/liveDepartmentTurn";
import { settleResetCashTurn } from "../../src/lib/resetFinance/rules/cashTurn";
import { buildResetAuthorityClaims } from "../../src/lib/resetFinance/rules/authorityClaims";
import { openingNationalTreasurySnapshots } from "../../src/lib/resetFinance/rules/treasurySnapshot";

export function runPaidCash240(
  country: "US" | "UK" | "JP",
  scenario: "unchanged" | "shock" | "no_issuance"
) {
  const books = openingFiscalBooks1991();
  const seed = books[country];
  const partition = buildOpeningDepartmentFundingPartition(
    buildOpeningDepartmentBoards1991("sim", 1),
    DEPARTMENT_DEFINITIONS,
    { US: books.US.grants, UK: books.UK.grants, JP: books.JP.grants },
    openingNamedGrantClaims1991()
  );
  let accounts = partition.accounts.filter((account) => account.countryId === country);
  const reserve = partition.continuity.find((row) => row.countryId === country)!;
  let treasury = openingNationalTreasurySnapshots("sim", 1, books).find(
    (row) => row.countryId === country
  )!;
  let maximumResidual = 0;
  let paidAuthority = 0;
  let departmentalOutlay = 0;
  const openingDepartmentCash = accounts
    .filter((account) => !account.externallySettled)
    .reduce((sum, account) => sum + account.balance, 0);
  let lowestPaidRatio = 1;
  let firstCrisisTurn: number | null = null;
  for (let turn = 2; turn <= 241; turn++) {
    const claims = buildResetAuthorityClaims(accounts, reserve, turn);
    const revenue = includedAuthorityPerTurn(
      Math.round(seed.revenue * (scenario === "shock" && turn > 48 && turn <= 96 ? 0.75 : 1)),
      turn
    );
    const coupon = Math.round((treasury.debt * seed.interestRate) / 48);
    const due =
      claims.reduce((sum, claim) => sum + claim.amount, 0) +
      Object.values(treasury.arrears).reduce((sum, amount) => sum + amount, 0) +
      coupon;
    const issuance =
      scenario !== "no_issuance" && turn % 12 === 0
        ? Math.max(0, due - treasury.cash - revenue)
        : 0;
    const previous = treasury;
    treasury = settleResetCashTurn({
      treasury,
      turn,
      claims,
      flows: {
        revenue,
        annualInterestRate: 0,
        periodsPerYear: 48,
        bondProceeds: issuance,
        bondFaceIssued: issuance,
        bondCouponCashPaid: coupon,
        bondMaturityCashPaid: 0,
        bondFaceRetired: 0,
      },
    });
    const spent =
      Object.values(treasury.lastPaidByClaim!).reduce((sum, value) => sum + value, 0) + coupon;
    maximumResidual = Math.max(
      maximumResidual,
      Math.abs(
        previous.cash +
          revenue +
          issuance +
          treasury.lastEmergencyAdvanceDrawn! -
          spent +
          treasury.lastAppropriationFinancing! -
          treasury.cash
      )
    );
    accounts = accounts.map((account) => {
      if (account.externallySettled) return account;
      const result = settleLiveDepartmentTurn({
        account,
        turn,
        authorityPaid: treasury.lastPaidByClaim![account._id]!,
      });
      paidAuthority += result.settlement!.authorityAccrued;
      departmentalOutlay += result.settlement!.totalOutlays;
      if (result.scheduledAuthority > 0)
        lowestPaidRatio = Math.min(
          lowestPaidRatio,
          result.next.lastAuthorityPaid / result.scheduledAuthority
        );
      if (
        settleLiveDepartmentTurn({
          account: result.next,
          turn,
          authorityPaid: result.next.lastAuthorityPaid,
        }).next !== result.next
      ) {
        throw new Error("Cabinet replay was not exact");
      }
      return result.next;
    });
    if (treasury.fiscalCrisis && firstCrisisTurn === null) firstCrisisTurn = turn;
    const accounted = accounts
      .filter((account) => !account.externallySettled)
      .reduce((sum, account) => sum + account.balance, 0);
    if (openingDepartmentCash + paidAuthority - departmentalOutlay !== accounted)
      throw new Error("Department cash did not reconcile");
  }
  return {
    country,
    scenario,
    turns: 240,
    openingDepartmentCash,
    paidAuthority,
    departmentalOutlay,
    unpaidAuthority: accounts
      .filter((account) => !account.externallySettled)
      .reduce((sum, account) => sum + (account.unpaidAuthority ?? 0), 0),
    finalDebt: treasury.debt,
    emergencyAdvance: treasury.emergencyAdvance,
    firstCrisisTurn,
    lowestPaidRatio,
    maximumResidual,
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetPaidCash240.ts")) {
  console.log(
    JSON.stringify(
      (["US", "UK", "JP"] as const).flatMap((country) =>
        (["unchanged", "shock", "no_issuance"] as const).map((scenario) =>
          runPaidCash240(country, scenario)
        )
      ),
      null,
      2
    )
  );
}
