export type TreasuryPresetId =
  "custom" | "growth" | "election_push" | "member_support" | "reserve_first";

export interface TreasuryPresetOption {
  id: Exclude<TreasuryPresetId, "custom">;
  label: string;
  description: string;
}

export interface NationalTreasuryPresetValues {
  treasuryPreset: TreasuryPresetId;
  transferReserveAmount: number;
  memberSupportReserveAmount: number;
  nppRecruitmentReserveAmount: number;
  gotvBudgetPercent: number;
  suppressionBudgetPercent: number;
}

export type StateTreasuryPresetValues = NationalTreasuryPresetValues;

const PRESET_OPTIONS: TreasuryPresetOption[] = [
  {
    id: "growth",
    label: "Growth",
    description: "Favors expansion, bench building, and party infrastructure.",
  },
  {
    id: "election_push",
    label: "Election Push",
    description: "Leans into GOTV and suppression for immediate campaign pressure.",
  },
  {
    id: "member_support",
    label: "Member Support",
    description: "Keeps extra room for direct candidate aid and local support.",
  },
  {
    id: "reserve_first",
    label: "Reserve First",
    description: "Protects cash flow and keeps a larger treasury floor intact.",
  },
];

function reserveFromIncome(expectedHourlyIncome: number, hours: number, minimum: number): number {
  return Math.max(minimum, Math.round(expectedHourlyIncome * hours));
}

export function getTreasuryPresetOptions(): TreasuryPresetOption[] {
  return PRESET_OPTIONS;
}

export function getTreasuryPresetLabel(preset: TreasuryPresetId): string {
  if (preset === "custom") return "Custom";
  return PRESET_OPTIONS.find((option) => option.id === preset)?.label ?? "Custom";
}

export function getNationalTreasuryPresetValues(
  preset: Exclude<TreasuryPresetId, "custom">,
  args: { expectedHourlyIncome: number }
): NationalTreasuryPresetValues {
  const expectedHourlyIncome = Math.max(0, args.expectedHourlyIncome);

  switch (preset) {
    case "growth":
      return {
        treasuryPreset: preset,
        transferReserveAmount: reserveFromIncome(expectedHourlyIncome, 4, 15_000),
        memberSupportReserveAmount: reserveFromIncome(expectedHourlyIncome, 2, 10_000),
        nppRecruitmentReserveAmount: reserveFromIncome(expectedHourlyIncome, 6, 20_000),
        gotvBudgetPercent: 6,
        suppressionBudgetPercent: 2,
      };
    case "election_push":
      return {
        treasuryPreset: preset,
        transferReserveAmount: reserveFromIncome(expectedHourlyIncome, 2, 10_000),
        memberSupportReserveAmount: reserveFromIncome(expectedHourlyIncome, 6, 20_000),
        nppRecruitmentReserveAmount: reserveFromIncome(expectedHourlyIncome, 3, 12_000),
        gotvBudgetPercent: 12,
        suppressionBudgetPercent: 7,
      };
    case "member_support":
      return {
        treasuryPreset: preset,
        transferReserveAmount: reserveFromIncome(expectedHourlyIncome, 3, 12_000),
        memberSupportReserveAmount: reserveFromIncome(expectedHourlyIncome, 8, 25_000),
        nppRecruitmentReserveAmount: reserveFromIncome(expectedHourlyIncome, 3, 10_000),
        gotvBudgetPercent: 5,
        suppressionBudgetPercent: 3,
      };
    case "reserve_first":
      return {
        treasuryPreset: preset,
        transferReserveAmount: reserveFromIncome(expectedHourlyIncome, 8, 25_000),
        memberSupportReserveAmount: reserveFromIncome(expectedHourlyIncome, 4, 15_000),
        nppRecruitmentReserveAmount: reserveFromIncome(expectedHourlyIncome, 4, 15_000),
        gotvBudgetPercent: 3,
        suppressionBudgetPercent: 1,
      };
  }
}

export function getStateTreasuryPresetValues(
  preset: Exclude<TreasuryPresetId, "custom">,
  args: { expectedHourlyIncome: number }
): StateTreasuryPresetValues {
  // State preset values mirror national now that legacy `orgBuildingPercent`
  // is inert. Org growth lives on PS-spend, not treasury %.
  return getNationalTreasuryPresetValues(preset, args);
}
