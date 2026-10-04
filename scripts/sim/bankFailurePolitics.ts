import {
  bankFailurePoliticalEffects,
  type BankFailurePoliticalEvent,
} from "../../src/lib/banking/rules/failurePolitics";
const rows = [
  { label: "small", deposits: 1e6, backstop: 1e5 },
  { label: "large", deposits: 1e10, backstop: 1e9 },
  { label: "systemic", deposits: 1e12, backstop: 1e12 },
];
const gdp = 6.2e12;
console.log("# Funded bank failure political consequences\n");
console.log(
  "Production rules; USD amounts and GDP share one currency. GDP is a representative 1991 US baseline. Payouts are assumed already settled; this report does not fund or predict failures.\n"
);
console.log(
  "| Case | Paid deposits | Paid taxpayer backstop | Approval pp at payout | Confidence target pp at payout | Approval pp at turn 24 |\n| --- | ---: | ---: | ---: | ---: | ---: |"
);
for (const row of rows) {
  const event: BankFailurePoliticalEvent = {
    _id: row.label,
    bankId: row.label,
    charteredTurn: 0,
    countryId: "US",
    currency: "USD",
    paidTurn: 0,
    depositExposure: row.deposits,
    insurancePaid: 0,
    taxpayerPaid: row.backstop,
    gdp,
  };
  const first = bankFailurePoliticalEffects([event], "US", 0);
  const middle = bankFailurePoliticalEffects([event], "US", 24);
  console.log(
    `| ${row.label} | ${row.deposits} | ${row.backstop} | ${first.approval.toFixed(6)} | ${first.consumerConfidence.toFixed(6)} | ${middle.approval.toFixed(6)} |`
  );
}
console.log(
  "\nApproval is capped at -3 pp and confidence target at -10 pp across all active bank failures per country. Costs fade linearly to zero over 48 turns. Small approval effects may round to zero in the existing national approval display. Confidence uses the existing metric engine inertia, rather than a new direct cash or metric increment. Repeated epoch events are deduplicated. Flag off causes zero event reads. One bounded event read serves every country per consuming phase; no per-country event query is added."
);
