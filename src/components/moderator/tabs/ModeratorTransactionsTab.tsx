"use client";

import dynamic from "next/dynamic";

const FinancialLedgerAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/FinancialLedgerAdminPanel").then((m) => ({
      default: m.FinancialLedgerAdminPanel,
    })),
  { ssr: false }
);

export function ModeratorTransactionsTab() {
  return <FinancialLedgerAdminPanel apiBase="/api/moderator/financial-logs" />;
}
