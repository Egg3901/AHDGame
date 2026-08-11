import type { FormulaGrant } from "@/lib/db/types/budget";

export const formulaGrants: FormulaGrant[] = [
  {
    programId: "medicaid",
    programName: "Medicaid",
    poolPercentage: 15,
    formulaType: "poverty",
  },
  {
    programId: "highway_fund",
    programName: "Highway Trust Fund",
    poolPercentage: 5,
    formulaType: "population",
  },
  {
    programId: "education_block",
    programName: "Education Block Grant",
    poolPercentage: 4,
    formulaType: "hybrid",
    hybridWeights: { population: 0.5, poverty: 0.5 },
  },
  {
    programId: "snap",
    programName: "SNAP (Food Assistance)",
    poolPercentage: 3,
    formulaType: "poverty",
  },
];
