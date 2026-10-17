/** Pure opening-state conversion. This plan never applies a migration or invents funding. */
import { producerPayableId, type ProducerPayable } from "./payablesRules";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import type { ProducerQuotePolicy } from "./rules";
import { validateProducerCapacityState, type ProducerCapacityState } from "./capacityRules";
import { queueUndeliveredCost } from "@/lib/corporations/buildDelivery";

export interface ExistingWorldProducerOpening {
  worldEpoch: string;
  completedTurn: number;
  processing: boolean;
  /** One-time opening decision, never a runtime economy mode. */
  modeledLossPolicy:
    { kind: "unresolved" } | { kind: "openingAdjustment"; approvalReference: string };
  corporations: readonly {
    id: string;
    currency: string;
    localPerAnchor: number;
    /** Signed native balance. Negative cash remains debt, never forgiven by conversion. */
    cash: number;
    /** Audited outstanding operating bills, excluding separately preserved tax arrears. */
    operatingArrearsAnchor: number;
    /** Historical modeled loss carry is not evidence of a debt to a supplier. */
    modeledLossCarry: readonly { currency: string; amountLocal: number; localPerAnchor: number }[];
    /** Reconciled named creditors; an unresolved balance cannot be discarded. */
    payables: readonly ProducerPayable[];
  }[];
  sectors: readonly {
    id: string;
    accountId: string;
    /** Reconciled physical stock and paid basis; a revenue estimate cannot substitute. */
    capacity: Omit<ProducerCapacityState, "completedTurn">;
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
  version: 2;
  modeledLossPolicy: ExistingWorldProducerOpening["modeledLossPolicy"];
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
    producerPayables: { worldEpoch: string; turn: number; claims: ProducerPayable[] };
  }>;
  sectors: Array<{
    id: string;
    accountId: string;
    capacity: ProducerCapacityState;
    inputStock: [];
    outputStock: Array<{ commodity: string; book: string; units: number }>;
    quotes: Array<{ commodity: string; book: string; policy: ProducerQuotePolicy }>;
    openingInventoryMemoValueAnchor: number;
  }>;
  protectedImages: Array<{ key: string; digest: string }>;
  /** The apply host must bind these exact creditors before enabling the new economy. */
  requiredCreditorAccountIds: string[];
  /** An apply host must resolve these explicitly, never invent creditors or forgive them silently. */
  unresolvedModeledLossCarry: Array<{ accountId: string; amountAnchor: number }>;
  nonCashOpeningAdjustments: Array<{
    kind: "modeledOperatingLossReconciliation";
    accountId: string;
    originalModeledLossCarry: Array<{
      currency: string;
      amountLocal: number;
      localPerAnchor: number;
    }>;
    originalModeledLossCarryAnchor: number;
    recognizedLiabilityAnchor: number;
    liabilityDeltaAnchor: number;
    equityDeltaAnchor: number;
    cashDeltaLocal: 0;
    operatingIncomeDeltaAnchor: 0;
    taxableProfitDeltaAnchor: 0;
    approvalReference: string;
  }>;
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
    operatingArrearsAnchor: number;
    operatingArrearsCreated: 0;
    operatingArrearsForgiven: 0;
    modeledLossCarryRemovedAnchor: number;
    openingLiabilityDeltaAnchor: number;
    openingEquityDeltaAnchor: number;
    cashCreated: 0;
    inputStockCreated: 0;
    ownedDailyUnits: number;
    paidCapacityBookAnchor: number;
    constructionInProgressAnchor: number;
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
  const policy = source.modeledLossPolicy;
  if (
    !policy ||
    (policy.kind !== "unresolved" && policy.kind !== "openingAdjustment") ||
    (policy.kind === "openingAdjustment" && !policy.approvalReference?.trim())
  )
    throw new Error("Opening modeled loss policy requires an explicit audited decision");
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
  const creditorIds = new Set<string>();
  let operatingArrearsAnchor = 0;
  const currencyRates = new Map<string, number>();
  const cashByCurrency = new Map<string, number>();
  const accounts = [...source.corporations]
    .sort((a, b) => compare(a.id, b.id))
    .map((corp) => {
      valid(corp.cash, "cash", true);
      valid(corp.operatingArrearsAnchor, "opening operating arrears");
      if (!Array.isArray(corp.modeledLossCarry))
        throw new Error("Missing modeled loss reconciliation");
      uniqueIds(
        corp.modeledLossCarry.map((row) => ({ id: row.currency })),
        "modeled carry currency"
      );
      for (const row of corp.modeledLossCarry) {
        valid(row.amountLocal, "historical modeled loss carry", true);
        if (!(valid(row.localPerAnchor, "modeled carry currency rate") > 0))
          throw new Error("Missing modeled carry currency valuation");
        const prior = currencyRates.get(row.currency);
        if (prior != null && prior !== row.localPerAnchor)
          throw new Error("Inconsistent frozen currency rate");
        currencyRates.set(row.currency, row.localPerAnchor);
      }
      if (!Array.isArray(corp.payables))
        throw new Error("Opening creditors require reconciliation");
      uniqueIds(corp.payables, "opening payable");
      let due = 0;
      for (const claim of corp.payables) {
        if (
          !claim.producerId ||
          !claim.creditorAccountId ||
          claim.debtorAccountId !== corp.id ||
          claim.creditorAccountId === corp.id ||
          (claim.kind !== "labour" && claim.kind !== "operating") ||
          claim.id !== producerPayableId(claim) ||
          !(valid(claim.amount, "opening payable amount") > 0)
        )
          throw new Error("Opening creditors require reconciliation");
        creditorIds.add(claim.creditorAccountId);
        due = valid(due + claim.amount, "opening payable total");
      }
      if (
        Math.abs(due - corp.operatingArrearsAnchor) >
        Math.max(1e-7, corp.operatingArrearsAnchor * 1e-12)
      )
        throw new Error("Opening operating arrears require complete creditor reconciliation");
      operatingArrearsAnchor = valid(
        operatingArrearsAnchor + due,
        "opening operating arrears total"
      );
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
        producerPayables: {
          worldEpoch: source.worldEpoch,
          turn: source.completedTurn,
          claims: [...corp.payables]
            .sort((a, b) => compare(a.id, b.id))
            .map((claim) => ({ ...claim })),
        },
      };
    });
  const accountIds = new Set(accounts.map((account) => account.id));
  const quantities = new Map<string, { beforeDailyUnits: number; afterTurnUnits: number }>();
  const sectors: ProducerOpeningPlan["sectors"] = [...source.sectors]
    .sort((a, b) => compare(a.id, b.id))
    .map((sector) => {
      if (!accountIds.has(sector.accountId)) throw new Error("Unbound sector");
      if (!sector.capacity) throw new Error("Physical opening capacity requires reconciliation");
      const capacity = { ...sector.capacity, completedTurn: source.completedTurn };
      validateProducerCapacityState(capacity);
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
        capacity,
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
  const modeledCarry = [...source.corporations]
    .sort((a, b) => compare(a.id, b.id))
    .filter((corp) => corp.modeledLossCarry.some((row) => row.amountLocal !== 0))
    .map((corp) => ({
      ...corp,
      modeledLossCarryAnchor: valid(
        corp.modeledLossCarry.reduce((sum, row) => sum + row.amountLocal / row.localPerAnchor, 0),
        "modeled carry valuation",
        true
      ),
      // Current liability accounting excludes negative rounding residue per currency.
      recognizedLiabilityAnchor: valid(
        corp.modeledLossCarry.reduce(
          (sum, row) => sum + Math.max(0, row.amountLocal) / row.localPerAnchor,
          0
        ),
        "recognized modeled liability"
      ),
    }));
  const nonCashOpeningAdjustments: ProducerOpeningPlan["nonCashOpeningAdjustments"] =
    policy.kind === "openingAdjustment"
      ? modeledCarry.map((corp) => ({
          kind: "modeledOperatingLossReconciliation",
          accountId: corp.id,
          originalModeledLossCarry: [...corp.modeledLossCarry]
            .sort((a, b) => compare(a.currency, b.currency))
            .map((row) => ({ ...row })),
          originalModeledLossCarryAnchor: corp.modeledLossCarryAnchor,
          recognizedLiabilityAnchor: corp.recognizedLiabilityAnchor,
          liabilityDeltaAnchor:
            corp.recognizedLiabilityAnchor > 0 ? -corp.recognizedLiabilityAnchor : 0,
          equityDeltaAnchor: corp.recognizedLiabilityAnchor,
          cashDeltaLocal: 0,
          operatingIncomeDeltaAnchor: 0,
          taxableProfitDeltaAnchor: 0,
          approvalReference: policy.approvalReference,
        }))
      : [];
  const modeledLossCarryRemovedAnchor = valid(
    nonCashOpeningAdjustments.reduce((sum, row) => sum + row.originalModeledLossCarryAnchor, 0),
    "modeled loss opening adjustment total",
    true
  );
  const recognizedLiabilityRemovedAnchor = valid(
    nonCashOpeningAdjustments.reduce((sum, row) => sum + row.recognizedLiabilityAnchor, 0),
    "removed modeled liabilities"
  );
  return {
    version: 2,
    modeledLossPolicy: { ...policy },
    worldEpoch: source.worldEpoch,
    completedTurn: source.completedTurn,
    firstSettlementTurn: source.completedTurn + 1,
    accounts,
    sectors,
    protectedImages: [...source.protectedImages].sort((a, b) => compare(a.key, b.key)),
    requiredCreditorAccountIds: [...creditorIds].sort(compare),
    unresolvedModeledLossCarry:
      policy.kind === "unresolved"
        ? modeledCarry.map((corp) => ({
            accountId: corp.id,
            amountAnchor: corp.modeledLossCarryAnchor,
          }))
        : [],
    nonCashOpeningAdjustments,
    reconciliation: {
      operatingArrearsAnchor,
      operatingArrearsCreated: 0,
      operatingArrearsForgiven: 0,
      modeledLossCarryRemovedAnchor,
      openingLiabilityDeltaAnchor:
        recognizedLiabilityRemovedAnchor > 0 ? -recognizedLiabilityRemovedAnchor : 0,
      openingEquityDeltaAnchor: recognizedLiabilityRemovedAnchor,
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
      ownedDailyUnits: valid(
        sectors.reduce((sum, sector) => sum + sector.capacity.ownedDailyUnits, 0),
        "opening capacity total"
      ),
      paidCapacityBookAnchor: valid(
        sectors.reduce((sum, sector) => sum + sector.capacity.paidBookAnchor, 0),
        "opening capacity book total"
      ),
      constructionInProgressAnchor: valid(
        sectors.reduce(
          (sum, sector) =>
            sum + queueUndeliveredCost([...sector.capacity.buildQueue], source.completedTurn),
          0
        ),
        "opening construction total"
      ),
    },
  };
}
