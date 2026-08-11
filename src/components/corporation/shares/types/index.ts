import type {
  MyShareOrder,
  MarketOrder,
  CorporationDetail,
} from "@/components/corporation/CorporationPageTypes";

export interface UseShareOrdersReturn {
  myOrders: MyShareOrder[];
  marketOrders: MarketOrder[];
  fillAmounts: Record<string, number>;
  setFillAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  refreshOrders: () => Promise<void>;
}

export interface UseShareTradingProps {
  corporation: CorporationDetail;
  myCharacterId: string | null;
  myCashOnHand: number;
  isCeo: boolean;
  corpId: string;
  onRefresh: () => void;
  /** When set, the orderbook can fill sell orders (asks) using this corporation's funds. */
  myCorporation?: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
}

export interface UseShareTradingReturn {
  // State
  sellSharesAmount: number;
  setSellSharesAmount: React.Dispatch<React.SetStateAction<number>>;
  buySharesAmount: number;
  setBuySharesAmount: React.Dispatch<React.SetStateAction<number>>;
  buyAsCorp: boolean;
  setBuyAsCorp: React.Dispatch<React.SetStateAction<boolean>>;
  /** When true, filling a sell order on the tab orderbook uses corp liquid capital. */
  fillAskAsCorp: boolean;
  setFillAskAsCorp: React.Dispatch<React.SetStateAction<boolean>>;
  orderType: "buy" | "sell";
  setOrderType: React.Dispatch<React.SetStateAction<"buy" | "sell">>;
  orderShares: number;
  setOrderShares: React.Dispatch<React.SetStateAction<number>>;
  orderPrice: number;
  setOrderPrice: React.Dispatch<React.SetStateAction<number>>;
  issuePercent: number;
  setIssuePercent: React.Dispatch<React.SetStateAction<number>>;
  selfIssueShares: number;
  setSelfIssueShares: React.Dispatch<React.SetStateAction<number>>;
  consolidateTarget: number | "";
  setConsolidateTarget: React.Dispatch<React.SetStateAction<number | "">>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // Derived values
  issuanceCooldownRemaining: number;
  issuanceOnCooldown: boolean;
  myShares: number;
  myShareValue: number;
  myOwnershipPct: number;
  newSharesToIssue: number;
  issuanceProceeds: number;
  dilutedPrice: number;
  selfIssuePricePerShare: number;
  selfIssueCost: number;
  hasOpenCorpOrders: boolean;
  shareStructureOnCooldown: boolean;
  ceoEligibleForShareStructure: boolean;
  canEditShareStructureTarget: boolean;
  canSubmitShareStructure: boolean;
  consolidateTargetNum: number;
  maxForwardTotal: number;
  isReverseTarget: boolean;
  isForwardTarget: boolean;
  shareStructureTargetValid: boolean;
  shareStructurePricePreview: boolean;
  newPriceAfterShareStructure: number | null;

  // Handlers
  handleSellAtMarket: () => Promise<void>;
  handleBuyFromFloat: () => Promise<void>;
  handlePlaceOrder: () => Promise<void>;
  handleCancelOrder: (orderId: string) => Promise<void>;
  handleFillOrder: (orderId: string, orderType: "buy" | "sell", shares?: number) => Promise<void>;
  handlePublicIssuance: () => Promise<void>;
  handleConsolidateShares: () => Promise<void>;
  handleSelfIssuance: () => Promise<void>;
}

export * from "@/components/corporation/CorporationPageTypes";
