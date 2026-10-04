/**
 * Public-float sovereign rollover. A bond pool may exchange accepted matured
 * face for equal par sovereign principal in the same currency without cash.
 */
import { BASE_DEMAND } from "@/lib/sovereignDefault/constants";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";

export type PublicFloatNovationRefusal =
  | "no_source_units"
  | "invalid_quote"
  | "source_restructured"
  | "currency_mismatch"
  | "non_par_quote"
  | "invalid_maturity"
  | "no_appetite";

export interface PublicFloatNovationInput {
  sourceUnits: number;
  sourceCurrency: string;
  replacementCurrency: string;
  sourceFacePerUnitLocal: number;
  replacementPricePerUnitLocal: number;
  appetite: number | undefined;
  maturityTurns: number;
  sourceHaircutPercent?: number | null;
}

export interface PublicFloatNovationPlan {
  acceptedUnits: number;
  faceLocal: number;
  treasuryCashDelta: 0;
  poolCashDelta: 0;
  debtPrincipalDelta: 0;
  refusal?: PublicFloatNovationRefusal;
}

const VALID_MATURITIES: readonly BondMaturityTurns[] = [48, 96, 240];

/** Freeze a conservative pool acceptance at par, without cash or net new debt. */
export function planPublicFloatNovation(input: PublicFloatNovationInput): PublicFloatNovationPlan {
  const sourceUnits =
    Number.isSafeInteger(input.sourceUnits) && input.sourceUnits > 0 ? input.sourceUnits : 0;
  if (sourceUnits === 0) return refused("no_source_units");
  if (
    !Number.isFinite(input.sourceFacePerUnitLocal) ||
    input.sourceFacePerUnitLocal !== BOND_UNIT_FACE_VALUE ||
    !Number.isFinite(input.replacementPricePerUnitLocal) ||
    !input.sourceCurrency.trim() ||
    !input.replacementCurrency.trim()
  )
    return refused("invalid_quote");
  if (input.sourceCurrency !== input.replacementCurrency) return refused("currency_mismatch");
  if (input.sourceHaircutPercent != null && input.sourceHaircutPercent !== 0)
    return refused("source_restructured");
  if (input.replacementPricePerUnitLocal !== input.sourceFacePerUnitLocal)
    return refused("non_par_quote");
  if (!VALID_MATURITIES.includes(input.maturityTurns as BondMaturityTurns))
    return refused("invalid_maturity");
  const appetite = input.appetite;
  if (typeof appetite !== "number" || !Number.isFinite(appetite) || appetite <= 0)
    return refused("no_appetite");

  const appetiteShare = Math.min(1, appetite / BASE_DEMAND);
  const acceptedUnits = Math.min(sourceUnits, Math.floor(sourceUnits * appetiteShare));
  if (acceptedUnits <= 0) return refused("no_appetite");
  return {
    acceptedUnits,
    faceLocal: acceptedUnits * BOND_UNIT_FACE_VALUE,
    treasuryCashDelta: 0,
    poolCashDelta: 0,
    debtPrincipalDelta: 0,
  };
}

function refused(refusal: PublicFloatNovationRefusal): PublicFloatNovationPlan {
  return {
    acceptedUnits: 0,
    faceLocal: 0,
    treasuryCashDelta: 0,
    poolCashDelta: 0,
    debtPrincipalDelta: 0,
    refusal,
  };
}
