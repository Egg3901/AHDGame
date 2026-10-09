/**
 * Opening fiscal balance sizes existing programs to collected revenue after
 * historic debt service. It preserves spending composition and never increases
 * taxes, adds receipts, or writes off debt: see fitOpeningFiscalEnvelope.
 */

export const PLAYER_RESET_DEFICIT_GDP_SHARE_1991 = 0.005;

export function fitOpeningFiscalEnvelope(input: {
  gdp: number;
  annualRevenue: number;
  annualDebtService: number;
  byCategory: Readonly<Record<string, number>>;
  stateGrants: number;
  maximumDeficitGdpShare: number;
  /**
   * Scale up as well as down, landing exactly on the deficit limit. For an
   * authored composition whose absolute figures no longer match the opening
   * revenue, so the mix is kept and the size is set by receipts.
   */
  fillEnvelope?: boolean;
}): { byCategory: Record<string, number>; stateGrants: number } {
  const entries = Object.entries(input.byCategory);
  const operatingTotal =
    entries.reduce((sum, [, amount]) => sum + Math.max(0, amount), 0) +
    Math.max(0, input.stateGrants);
  const affordableOperating = Math.max(
    0,
    input.annualRevenue + input.gdp * input.maximumDeficitGdpShare - input.annualDebtService
  );
  const fit = operatingTotal > 0 ? affordableOperating / operatingTotal : 1;
  const scale = input.fillEnvelope ? fit : Math.min(1, fit);
  return {
    byCategory: Object.fromEntries(
      entries.map(([category, amount]) => [category, Math.floor(Math.max(0, amount) * scale)])
    ),
    stateGrants: Math.floor(Math.max(0, input.stateGrants) * scale),
  };
}
