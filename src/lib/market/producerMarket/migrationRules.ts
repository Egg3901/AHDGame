/** Pure opening-state conversion. This plan never applies a migration or invents funding. */
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import type { ProducerQuotePolicy } from "./rules";

export interface ExistingWorldProducerOpening {
  worldEpoch: string;
  completedTurn: number;
  processing: boolean;
  corporations: readonly {
    id: string;
    currency: string;
    localPerAnchor: number;
    /** Signed native balance. Negative cash remains debt, never forgiven by conversion. */
    cash: number;
  }[];
  sectors: readonly {
    id: string;
    accountId: string;
    inventoryDailyUnits: Readonly<Record<string, number>>;
    /** Existing telemetry, retained as a memo, never converted into cash or acquisition cost. */
    inventoryValueAnchor: number;
    outputs: readonly {
      commodity: string;
      book: string;
      referenceUnitPrice: number;
      storable: boolean;
    }[];
    pricingMode?: "market" | "costPlus";
    pricingPosture?: number | null;
  }[];
  /** Exact protected before-images are retained by the host; rules preserve their identities. */
  protectedImages: readonly { key: string; digest: string }[];
}

export interface ProducerOpeningPlan {
  version: 1;
  worldEpoch: string;
  completedTurn: number;
  firstSettlementTurn: number;
  accounts: Array<{
    id: string;
    currency: string;
    localPerAnchor: number;
    openingCashLocal: number;
    openingCashAnchor: number;
    spendableCashAnchor: number;
    openingOverdraftAnchor: number;
  }>;
  sectors: Array<{
    id: string;
    accountId: string;
    inputStock: [];
    outputStock: Array<{ commodity: string; book: string; units: number }>;
    quotes: Array<{ commodity: string; book: string; policy: ProducerQuotePolicy }>;
    openingInventoryMemoValueAnchor: number;
  }>;
  protectedImages: Array<{ key: string; digest: string }>;
  reconciliation: {
    cashByCurrency: Array<{ currency: string; before: number; after: number }>;
    signedCashAnchor: number;
    spendableCashAnchor: number;
    overdraftAnchor: number;
    inventoryByCommodity: Array<{
      commodity: string;
      beforeDailyUnits: number;
      afterTurnUnits: number;
    }>;
    cashCreated: 0;
    inputStockCreated: 0;
  };
}

function valid(value: number, label: string, signed = false): number {
  if (!Number.isFinite(value) || (!signed && value < 0)) throw new Error(`Invalid ${label}`);
  return value;
}

function uniqueIds(rows: readonly { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) throw new Error(`Duplicate or empty ${label}`);
    seen.add(row.id);
  }
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function planProducerOpening(source: ExistingWorldProducerOpening): ProducerOpeningPlan {
  if (!source.worldEpoch || source.processing) throw new Error("Migration requires an idle world");
  if (
    !Number.isSafeInteger(source.completedTurn) ||
    source.completedTurn < 0 ||
    source.completedTurn >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("Invalid completed turn");
  uniqueIds(source.corporations, "corporation");
  uniqueIds(source.sectors, "sector");
  uniqueIds(
    source.protectedImages.map((image) => ({ id: image.key })),
    "protected image"
  );
  const currencyRates = new Map<string, number>();
  const cashByCurrency = new Map<string, number>();
  const accounts = [...source.corporations]
    .sort((a, b) => compare(a.id, b.id))
    .map((corp) => {
      valid(corp.cash, "cash", true);
      if (!corp.currency || !(valid(corp.localPerAnchor, "frozen currency rate") > 0))
        throw new Error("Missing currency valuation");
      const priorRate = currencyRates.get(corp.currency);
      if (priorRate != null && priorRate !== corp.localPerAnchor)
        throw new Error("Inconsistent frozen currency rate");
      currencyRates.set(corp.currency, corp.localPerAnchor);
      const anchor = valid(corp.cash / corp.localPerAnchor, "anchor cash", true);
      cashByCurrency.set(
        corp.currency,
        valid((cashByCurrency.get(corp.currency) ?? 0) + corp.cash, "currency total", true)
      );
      return {
        id: corp.id,
        currency: corp.currency,
        localPerAnchor: corp.localPerAnchor,
        openingCashLocal: corp.cash,
        openingCashAnchor: anchor,
        spendableCashAnchor: Math.max(0, anchor),
        openingOverdraftAnchor: Math.max(0, -anchor),
      };
    });
  const accountIds = new Set(accounts.map((account) => account.id));
  const quantities = new Map<string, { beforeDailyUnits: number; afterTurnUnits: number }>();
  const sectors: ProducerOpeningPlan["sectors"] = [...source.sectors]
    .sort((a, b) => compare(a.id, b.id))
    .map((sector) => {
      if (!accountIds.has(sector.accountId)) throw new Error("Unbound sector");
      uniqueIds(
        sector.outputs.map((output) => ({ id: output.commodity })),
        "output commodity"
      );
      const outputs = new Map(sector.outputs.map((output) => [output.commodity, output]));
      const outputStock = Object.entries(sector.inventoryDailyUnits)
        .sort(([a], [b]) => compare(a, b))
        .flatMap(([commodity, daily]) => {
          valid(daily, "opening inventory");
          if (daily === 0) return [];
          const output = outputs.get(commodity);
          if (!output || !output.storable)
            throw new Error("Unsupported opening inventory requires reconciliation");
          const units = daily / TURNS_PER_DAY;
          const total = quantities.get(commodity) ?? { beforeDailyUnits: 0, afterTurnUnits: 0 };
          total.beforeDailyUnits += daily;
          total.afterTurnUnits += units;
          quantities.set(commodity, total);
          return [{ commodity, book: output.book, units }];
        });
      const posture = sector.pricingPosture;
      if (posture != null && (!Number.isFinite(posture) || posture < -1))
        throw new Error("Invalid opening pricing posture");
      return {
        id: sector.id,
        accountId: sector.accountId,
        inputStock: [],
        outputStock,
        quotes: [...sector.outputs]
          .sort((a, b) => compare(a.commodity, b.commodity))
          .map((output) => {
            if (!output.book) throw new Error("Missing output market");
            valid(output.referenceUnitPrice, "reference price");
            const policy: ProducerQuotePolicy =
              sector.pricingMode === "costPlus"
                ? { kind: "costPlus", markup: posture ?? 0 }
                : posture == null
                  ? { kind: "automatic", targetMarkup: 0 }
                  : {
                      kind: "manual",
                      unitPrice: valid(output.referenceUnitPrice * (1 + posture), "opening quote"),
                    };
            return { commodity: output.commodity, book: output.book, policy };
          }),
        // The opening inventory memo used daily-rate units. Preserve its per-turn equivalent
        // for comparison only; historical production costs were already expensed.
        openingInventoryMemoValueAnchor:
          valid(sector.inventoryValueAnchor, "inventory memo") / TURNS_PER_DAY,
      };
    });
  for (const image of source.protectedImages)
    if (!image.digest) throw new Error("Missing protected before-image");
  const total = (field: "openingCashAnchor" | "spendableCashAnchor" | "openingOverdraftAnchor") =>
    valid(
      accounts.reduce((sum, account) => sum + account[field], 0),
      field,
      true
    );
  return {
    version: 1,
    worldEpoch: source.worldEpoch,
    completedTurn: source.completedTurn,
    firstSettlementTurn: source.completedTurn + 1,
    accounts,
    sectors,
    protectedImages: [...source.protectedImages].sort((a, b) => compare(a.key, b.key)),
    reconciliation: {
      cashByCurrency: [...cashByCurrency]
        .sort(([a], [b]) => compare(a, b))
        .map(([currency, before]) => ({ currency, before, after: before })),
      signedCashAnchor: total("openingCashAnchor"),
      spendableCashAnchor: total("spendableCashAnchor"),
      overdraftAnchor: total("openingOverdraftAnchor"),
      inventoryByCommodity: [...quantities]
        .sort(([a], [b]) => compare(a, b))
        .map(([commodity, quantity]) => ({ commodity, ...quantity })),
      cashCreated: 0,
      inputStockCreated: 0,
    },
  };
}
