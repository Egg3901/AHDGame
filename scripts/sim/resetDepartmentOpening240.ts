/** Headless stress of net-of-grants Cabinet accounts and the portable turn rule. */
import { DEPARTMENT_DEFINITIONS } from "../../src/lib/governmentFinance/departmentCatalog";
import { includedAuthorityPerTurn } from "../../src/lib/governmentFinance/rules/appropriation";
import { openingFiscalBooks1991 } from "../../src/lib/resetFinance/opening1991";
import { buildOpeningDepartmentBoards1991 } from "../../src/lib/resetFinance/openingDepartmentBoards1991";
import { openingNamedGrantClaims1991 } from "../../src/lib/resetFinance/openingOwnership1991";
import { buildOpeningDepartmentFundingPartition } from "../../src/lib/resetFinance/rules/liveDepartmentAccount";
import { settleLiveDepartmentTurn } from "../../src/lib/resetFinance/rules/liveDepartmentTurn";
import { allocatePaidAuthority } from "../../src/lib/resetFinance/rules/paidAuthority";

export type OpeningDepartmentScenario = "source_funded" | "authority_cut_20";

export interface OpeningDepartmentRun {
  country: "US" | "UK" | "JP";
  scenario: OpeningDepartmentScenario;
  turns: number;
  sourceAuthority: number;
  departmentAuthority: number;
  departmentOutlay: number;
  specializedAuthority: number;
  grantReservation: number;
  continuityAuthority: number;
  openingWorkingCapital: number;
  closingWorkingCapital: number;
  workingCapitalDrawn: number;
  unmetProgramDemand: number;
  newArrears: number;
  overdraft: number;
  largestAccountingResidual: number;
}

export function runOpeningDepartment240(
  country: OpeningDepartmentRun["country"],
  scenario: OpeningDepartmentScenario
): OpeningDepartmentRun {
  const board = buildOpeningDepartmentBoards1991("headless-test-world", 1).find(
    (entry) => entry.countryId === country
  );
  if (!board) throw new Error(`Missing ${country} opening department board`);
  const fiscal = openingFiscalBooks1991();
  const grants = { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants };
  const { accounts, continuity } = buildOpeningDepartmentFundingPartition(
    [board],
    DEPARTMENT_DEFINITIONS,
    grants,
    openingNamedGrantClaims1991()
  );
  const run: OpeningDepartmentRun = {
    country,
    scenario,
    turns: 240,
    sourceAuthority: 0,
    departmentAuthority: 0,
    departmentOutlay: 0,
    specializedAuthority: 0,
    grantReservation: 0,
    continuityAuthority: 0,
    openingWorkingCapital: accounts
      .filter((account) => !account.externallySettled)
      .reduce((sum, account) => sum + account.balance, 0),
    closingWorkingCapital: 0,
    workingCapitalDrawn: 0,
    unmetProgramDemand: 0,
    newArrears: 0,
    overdraft: 0,
    largestAccountingResidual: 0,
  };
  for (let turn = 2; turn <= 241; turn += 1) {
    run.sourceAuthority += includedAuthorityPerTurn(board.operating, turn);
    run.continuityAuthority += includedAuthorityPerTurn(continuity[0]!.annualAuthority, turn);
    run.grantReservation += includedAuthorityPerTurn(grants[country], turn);
    const ordinaryClaims = accounts
      .filter((account) => !account.externallySettled)
      .map((account) => ({
        id: account._id,
        due: Object.values(account.familyAnnualDemand).reduce(
          (sum, amount) => sum + includedAuthorityPerTurn(amount, turn),
          0
        ),
      }));
    const ordinaryDue = ordinaryClaims.reduce((sum, claim) => sum + claim.due, 0);
    const paidByAccount = allocatePaidAuthority(
      scenario === "source_funded" ? ordinaryDue : Math.floor(ordinaryDue * 0.8),
      ordinaryClaims
    );
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index]!;
      const due = Object.values(account.familyAnnualDemand).reduce(
        (sum, amount) => sum + includedAuthorityPerTurn(amount, turn),
        0
      );
      if (account.externallySettled) {
        run.specializedAuthority += due;
        continue;
      }
      const paid = paidByAccount[account._id]!;
      if (paid > due) throw new Error("Paid department share exceeds scheduled authority");
      const openingBalance = account.balance;
      const settled = settleLiveDepartmentTurn({ account, turn, authorityPaid: paid });
      accounts[index] = settled.next;
      const result = settled.settlement!;
      run.departmentAuthority += result.authorityAccrued;
      run.departmentOutlay += result.totalOutlays;
      run.unmetProgramDemand += result.programs.reduce(
        (sum, program) => sum + program.requested - program.allocated,
        0
      );
      run.newArrears += result.newArrears;
      run.overdraft += result.overdraft;
      run.largestAccountingResidual = Math.max(
        run.largestAccountingResidual,
        Math.abs(openingBalance + paid - result.totalOutlays - result.closingBalance)
      );
    }
  }
  run.closingWorkingCapital = accounts
    .filter((account) => !account.externallySettled)
    .reduce((sum, account) => sum + account.balance, 0);
  run.workingCapitalDrawn = run.openingWorkingCapital - run.closingWorkingCapital;
  return run;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetDepartmentOpening240.ts")) {
  console.log(
    JSON.stringify(
      (["US", "UK", "JP"] as const).flatMap((country) =>
        (["source_funded", "authority_cut_20"] as const).map((scenario) =>
          runOpeningDepartment240(country, scenario)
        )
      ),
      null,
      2
    )
  );
}
