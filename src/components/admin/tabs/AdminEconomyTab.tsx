"use client";

import dynamic from "next/dynamic";
import { SubNavLayout } from "./SubNavLayout";

const CentralBankAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/CentralBankAdminPanel").then((m) => ({
      default: m.CentralBankAdminPanel,
    })),
  { ssr: false }
);
const StockMarketAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/StockMarketAdminPanel").then((m) => ({
      default: m.StockMarketAdminPanel,
    })),
  { ssr: false }
);
const ForexAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/ForexAdminPanel").then((m) => ({
      default: m.ForexAdminPanel,
    })),
  { ssr: false }
);
const CorporationsAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/CorporationsAdminPanel").then((m) => ({
      default: m.CorporationsAdminPanel,
    })),
  { ssr: false }
);
const MarketAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/MarketAdminPanel").then((m) => ({
      default: m.MarketAdminPanel,
    })),
  { ssr: false }
);
const LabourAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/LabourAdminPanel").then((m) => ({
      default: m.LabourAdminPanel,
    })),
  { ssr: false }
);
const BondsAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/BondsAdminPanel").then((m) => ({
      default: m.BondsAdminPanel,
    })),
  { ssr: false }
);
const CommoditiesAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/CommoditiesAdminPanel").then((m) => ({
      default: m.CommoditiesAdminPanel,
    })),
  { ssr: false }
);
const ResourceCapacityAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/ResourceCapacityAdminPanel").then((m) => ({
      default: m.ResourceCapacityAdminPanel,
    })),
  { ssr: false }
);
const ExtractionAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/ExtractionAdminPanel").then((m) => ({
      default: m.ExtractionAdminPanel,
    })),
  { ssr: false }
);
const BudgetOverviewAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/BudgetOverviewAdminPanel").then((m) => ({
      default: m.BudgetOverviewAdminPanel,
    })),
  { ssr: false }
);
const NppEconomyAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/NppEconomyAdminPanel").then((m) => ({
      default: m.NppEconomyAdminPanel,
    })),
  { ssr: false }
);
const FinancialLedgerAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/FinancialLedgerAdminPanel").then((m) => ({
      default: m.FinancialLedgerAdminPanel,
    })),
  { ssr: false }
);
const IndexFundsAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/IndexFundsAdminPanel").then((m) => ({
      default: m.IndexFundsAdminPanel,
    })),
  { ssr: false }
);
const InflationAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/InflationAdminPanel").then((m) => ({
      default: m.InflationAdminPanel,
    })),
  { ssr: false }
);
const SectorSeedAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/SectorSeedAdminPanel").then((m) => ({
      default: m.SectorSeedAdminPanel,
    })),
  { ssr: false }
);

const CommandEconomyAdminPanel = dynamic(
  () =>
    import("@/components/admin/economy/CommandEconomyAdminPanel").then((m) => ({
      default: m.CommandEconomyAdminPanel,
    })),
  { ssr: false }
);

export type EconomySubTab =
  | "central-banks"
  | "inflation"
  | "stock-market"
  | "forex"
  | "corporations"
  | "labour"
  | "market"
  | "bonds"
  | "commodities"
  | "resource-capacity"
  | "extraction"
  | "budgets"
  | "npp-economy"
  | "index-funds"
  | "financial-ledger"
  | "sector-seed"
  | "command-economy";

interface AdminEconomyTabProps {
  activeSub: EconomySubTab;
  onSubChange: (sub: EconomySubTab) => void;
}

export function AdminEconomyTab({ activeSub, onSubChange }: AdminEconomyTabProps) {
  return (
    <SubNavLayout tab="economy" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        {activeSub === "central-banks" && <CentralBankAdminPanel />}
        {activeSub === "inflation" && <InflationAdminPanel />}
        {activeSub === "command-economy" && <CommandEconomyAdminPanel />}
        {activeSub === "stock-market" && <StockMarketAdminPanel />}
        {activeSub === "forex" && <ForexAdminPanel />}
        {activeSub === "corporations" && <CorporationsAdminPanel />}
        {activeSub === "labour" && <LabourAdminPanel />}
        {activeSub === "market" && <MarketAdminPanel />}
        {activeSub === "bonds" && <BondsAdminPanel />}
        {activeSub === "commodities" && <CommoditiesAdminPanel />}
        {activeSub === "resource-capacity" && <ResourceCapacityAdminPanel />}
        {activeSub === "extraction" && <ExtractionAdminPanel />}
        {activeSub === "budgets" && <BudgetOverviewAdminPanel />}
        {activeSub === "npp-economy" && <NppEconomyAdminPanel />}
        {activeSub === "index-funds" && <IndexFundsAdminPanel />}
        {activeSub === "financial-ledger" && <FinancialLedgerAdminPanel />}
        {activeSub === "sector-seed" && <SectorSeedAdminPanel />}
      </div>
    </SubNavLayout>
  );
}
