import type { BankLoan } from "@/lib/db/types/bank";

/** Match one charter's loans while still reading documents written before epoch tagging. */
export function loanCharterEpochFilter(charteredTurn: number, nextCharteredTurn?: number) {
  const originatedTurn: { $gte: number; $lt?: number } = { $gte: charteredTurn };
  if (nextCharteredTurn !== undefined) originatedTurn.$lt = nextCharteredTurn;
  return {
    $or: [
      { charteredTurn },
      {
        charteredTurn: { $exists: false },
        originatedTurn,
      },
    ],
  };
}

/** Legacy loan documents predate the explicit epoch field. */
export function loanCharterEpoch(loan: Pick<BankLoan, "charteredTurn" | "originatedTurn">): number {
  return loan.charteredTurn ?? loan.originatedTurn;
}
