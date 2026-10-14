/**
 * Funded title advertising splits one paid anchor budget across buyer and sellers.
 * `quoteFundedProductAdvertising` freezes each native amount, exchange rate, and account denomination.
 */
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

/** Persisted quote accepted by the shared media and manufacturing settlement shell. */
export type ProductAdvertisingObligation = Omit<
  ProductAdvertisingQuote,
  "buyerDenomination" | "sellerAllocations"
> & {
  projectId: string;
  turn: number;
  /** Absent only on older media obligations; new quotes always freeze both witnesses. */
  buyerDenomination?: ProductAdvertisingDenominationWitness;
  sellerAllocations: Array<
    Omit<ProductAdvertisingAllocation, "denomination"> & {
      denomination?: ProductAdvertisingDenominationWitness;
    }
  >;
};

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

/**
 * Largest number of sellers one advertising order pays directly. Every seller
 * allocation is a guarded cash write during settlement, and each order used to
 * pay every advertising seller in the world, so settlement cost grew with
 * buyers times sellers. The largest sellers are paid directly; the long tail
 * shares one extra allocation (see {@link boundAdvertisingSellers}).
 */
export const MAX_DIRECT_ADVERTISING_SELLERS = 24;

/** Deterministic value in [0, 1) from a string seed (cyrb53). */
function seededUnitInterval(seed: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) / 9007199254740992;
}

/**
 * Bound one order's seller list without changing any seller's expected
 * revenue. The {@link MAX_DIRECT_ADVERTISING_SELLERS} largest sellers keep
 * their exact proportional share. The remaining tail's combined share goes to
 * a single tail seller drawn with probability proportional to its delivered
 * value, so each tail seller still earns its proportional share on average
 * across orders. The draw is seeded by the order identity, so a quote is
 * reproducible. Input order is preserved for the sellers that remain.
 */
export function boundAdvertisingSellers(
  sellers: readonly ProductAdvertisingSellerQuote[],
  seed: string
): ProductAdvertisingSellerQuote[] {
  if (sellers.length <= MAX_DIRECT_ADVERTISING_SELLERS + 1) return [...sellers];
  const ranked = sellers
    .map((seller, index) => ({ seller, index }))
    .sort(
      (a, b) =>
        b.seller.deliveredValueAnchor - a.seller.deliveredValueAnchor ||
        (a.seller.corporationId < b.seller.corporationId
          ? -1
          : a.seller.corporationId > b.seller.corporationId
            ? 1
            : a.index - b.index)
    );
  const direct = new Set(ranked.slice(0, MAX_DIRECT_ADVERTISING_SELLERS).map((r) => r.index));
  const tail = sellers.filter((_, index) => !direct.has(index));
  const tailValue = tail.reduce((sum, seller) => sum + seller.deliveredValueAnchor, 0);
  let target = seededUnitInterval(seed) * tailValue;
  let drawn = tail[tail.length - 1];
  for (const seller of tail) {
    target -= seller.deliveredValueAnchor;
    if (target < 0) {
      drawn = seller;
      break;
    }
  }
  return sellers.flatMap((seller, index) => {
    if (direct.has(index)) return [seller];
    if (seller === drawn) return [{ ...seller, deliveredValueAnchor: tailValue }];
    return [];
  });
}

/** Pure proportional seller quote shared by media titles and manufacturing products. */
export function quoteFundedProductAdvertising(input: {
  amountAnchor: number;
  buyer: ProductAdvertisingAccountQuote;
  sellers: readonly ProductAdvertisingSellerQuote[];
  /** Order identity for the tail draw; defaults to the buyer id. */
  seed?: string;
}): ProductAdvertisingQuote | null {
  const sellers = boundAdvertisingSellers(
    input.sellers.filter(
      (seller) =>
        Number.isFinite(seller.deliveredValueAnchor) &&
        seller.deliveredValueAnchor > 0 &&
        Number.isFinite(seller.localPerAnchor) &&
        seller.localPerAnchor > 0
    ),
    input.seed ?? input.buyer.corporationId
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
