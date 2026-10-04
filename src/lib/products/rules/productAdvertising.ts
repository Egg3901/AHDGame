import type { CurrencyCode } from "@/lib/constants/currencies";

export interface ProductAdvertisingDenominationWitness {
  liquidCurrencyCodePresent: boolean;
  liquidCurrencyCode: string | null;
  countryIdPresent: boolean;
  countryId: string | null;
}

export interface ProductAdvertisingAccountQuote extends ProductAdvertisingDenominationWitness {
  corporationId: string;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
}

export interface ProductAdvertisingSellerQuote extends ProductAdvertisingAccountQuote {
  deliveredValueAnchor: number;
}

export interface ProductAdvertisingAllocation {
  corporationId: string;
  amountLocal: number;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
  denomination: ProductAdvertisingDenominationWitness;
}

export interface ProductAdvertisingQuote {
  amountAnchor: number;
  buyerAmountLocal: number;
  buyerCurrencyCode: CurrencyCode;
  buyerLocalPerAnchor: number;
  buyerDenomination: ProductAdvertisingDenominationWitness;
  sellerAllocations: ProductAdvertisingAllocation[];
}

/** Freeze raw field presence and fallback country for replay-safe native cash guards. */
export function productAdvertisingDenominationWitness(input: {
  liquidCurrencyCode?: string | null;
  countryId?: string | null;
}): ProductAdvertisingDenominationWitness {
  return {
    liquidCurrencyCodePresent: input.liquidCurrencyCode !== undefined,
    liquidCurrencyCode: input.liquidCurrencyCode ?? null,
    countryIdPresent: input.countryId !== undefined,
    countryId: input.countryId ?? null,
  };
}

/** Pure proportional seller quote shared by media titles and manufacturing products. */
export function quoteFundedProductAdvertising(input: {
  amountAnchor: number;
  buyer: ProductAdvertisingAccountQuote;
  sellers: readonly ProductAdvertisingSellerQuote[];
}): ProductAdvertisingQuote | null {
  const sellers = input.sellers.filter(
    (seller) =>
      Number.isFinite(seller.deliveredValueAnchor) &&
      seller.deliveredValueAnchor > 0 &&
      Number.isFinite(seller.localPerAnchor) &&
      seller.localPerAnchor > 0
  );
  const totalSellerValue = sellers.reduce((sum, seller) => sum + seller.deliveredValueAnchor, 0);
  if (
    !Number.isFinite(input.amountAnchor) ||
    input.amountAnchor <= 0 ||
    !Number.isFinite(totalSellerValue) ||
    !Number.isFinite(input.buyer.localPerAnchor) ||
    input.buyer.localPerAnchor <= 0 ||
    !input.buyer.corporationId ||
    totalSellerValue <= 0 ||
    sellers.length === 0
  ) {
    return null;
  }

  const buyerAmountLocal = input.amountAnchor * input.buyer.localPerAnchor;
  const buyerAnchor = buyerAmountLocal / input.buyer.localPerAnchor;
  let allocatedAnchor = 0;
  const sellerAllocations = sellers.map((seller, index) => {
    const amountAnchor =
      index === sellers.length - 1
        ? buyerAnchor - allocatedAnchor
        : buyerAnchor * (seller.deliveredValueAnchor / totalSellerValue);
    const amountLocal = amountAnchor * seller.localPerAnchor;
    allocatedAnchor += amountLocal / seller.localPerAnchor;
    return {
      corporationId: seller.corporationId,
      amountLocal,
      currencyCode: seller.currencyCode,
      localPerAnchor: seller.localPerAnchor,
      denomination: {
        liquidCurrencyCodePresent: seller.liquidCurrencyCodePresent,
        liquidCurrencyCode: seller.liquidCurrencyCode,
        countryIdPresent: seller.countryIdPresent,
        countryId: seller.countryId,
      },
    };
  });
  if (
    !(Number.isFinite(buyerAmountLocal) && buyerAmountLocal > 0) ||
    sellerAllocations.some(
      (seller) => !(Number.isFinite(seller.amountLocal) && seller.amountLocal > 0)
    )
  ) {
    return null;
  }
  return {
    amountAnchor: buyerAnchor,
    buyerAmountLocal,
    buyerCurrencyCode: input.buyer.currencyCode,
    buyerLocalPerAnchor: input.buyer.localPerAnchor,
    buyerDenomination: {
      liquidCurrencyCodePresent: input.buyer.liquidCurrencyCodePresent,
      liquidCurrencyCode: input.buyer.liquidCurrencyCode,
      countryIdPresent: input.buyer.countryIdPresent,
      countryId: input.buyer.countryId,
    },
    sellerAllocations,
  };
}
