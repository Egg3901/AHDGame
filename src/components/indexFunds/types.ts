export interface FundNavPoint {
  turn: number;
  quotedNav: number;
}

export interface FundListItem {
  id: string;
  slug: string;
  name: string;
  tickerSymbol: string;
  scope: "global" | "country";
  kind: "broad" | "sector";
  countryId: string | null;
  sectorType: string | null;
  anchorCurrencyCode: string;
  quotedNav: number;
  unitSupply: number;
  aumAnchor: number;
  backingRatio: number | null;
  status: string;
  navChange1: number | null;
  navChange24: number | null;
  navChange48: number | null;
  navSparkline: FundNavPoint[];
  topHoldings: { corporationId: string; weight: number }[];
}

export interface FundHoldingRow {
  corporationId: string;
  corporationName: string;
  tickerSymbol: string | null;
  sequentialId: number | null;
  shares: number;
  avgCostPerShareAnchor: number | null;
  lastValueAnchor: number | null;
  dividendsReceivedAnchor?: number | null;
  targetWeight?: number;
  marketCapAnchor?: number;
}

export interface FundDetail {
  id: string;
  slug: string;
  name: string;
  tickerSymbol: string;
  scope: "global" | "country";
  kind: "broad" | "sector";
  countryId: string | null;
  sectorType: string | null;
  anchorCurrencyCode: string;
  status: string;
  pauseReason: string | null;
  quotedNav: number;
  unitSupply: number;
  aumAnchor: number;
  cashAnchor: number;
  backingRatio: number | null;
  lastRebalancedAt: string | null;
  navChange1: number | null;
  navChange24: number | null;
  navChange48: number | null;
  holdings: FundHoldingRow[];
  targetConstituents: FundHoldingRow[];
}
