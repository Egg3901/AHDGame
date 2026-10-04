import {
  quotePrimaryUnderwritingFee,
  DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE,
} from "@/lib/banking/rules/underwriting";

const cases = [
  { label: "small fully placed issue", gross: 10_000 },
  { label: "mid-size fully placed issue", gross: 100_000 },
  { label: "large fully placed issue", gross: 1_000_000 },
  { label: "partial placement", gross: 12_345.67 },
].map(({ label, gross }) => ({
  label,
  ...quotePrimaryUnderwritingFee({
    grossPlacedLocal: gross,
    feeRate: DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE,
  }),
}));

process.stdout.write(
  `${JSON.stringify({ feeRate: DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE, cases }, null, 2)}\n`
);
