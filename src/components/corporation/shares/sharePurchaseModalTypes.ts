import type { CorporationDetail, MarketOrder, MyShareOrder } from "../CorporationPageTypes";

export type PurchaseMode = "float" | "limit" | "orderbook" | "private" | "orders";
export type OrderSide = "buy" | "sell";

export const MAIN_MODES: { id: PurchaseMode; label: string }[] = [
  { id: "float", label: "At Market" },
  { id: "limit", label: "Limit Order" },
  { id: "orderbook", label: "Orderbook" },
  { id: "private", label: "Private Deal" },
];

export interface SharePurchaseModalProps {
  corporation: CorporationDetail;
  corpId: string;
  myCharacterId: string | null;
  myCashOnHand: number;
  myCurrencyBalances?: Partial<Record<string, number>>;
  myHomeCurrency?: string;
  autoConvertEnabled?: boolean;
  onAutoConvertChange?: (enabled: boolean) => void;
  myShares: number;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
  myOrders: MyShareOrder[];
  marketOrders: MarketOrder[];
  onClose: () => void;
  onSuccess: () => void;
}
