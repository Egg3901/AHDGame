/** Goods and their paid input basis survive changes of site ownership. */
import type { ProducerInventoryState } from "@/lib/db/types/producerEconomy";
import type { ProducedStock } from "./production";

export interface ProducerTransferState {
  producerCapacity?: { worldEpoch: string; turn: number };
  producerInventory?: ProducerInventoryState;
}

function amount(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid producer transfer stock");
  return value;
}

function generation(states: readonly ProducerTransferState[]) {
  if (!states.some((state) => state.producerCapacity || state.producerInventory)) return null;
  const first = states[0].producerCapacity;
  if (!first?.worldEpoch || !Number.isSafeInteger(first.turn) || first.turn < 0)
    throw new Error("Producer transfer requires reconciled generations");
  for (const state of states) {
    if (
      state.producerCapacity?.worldEpoch !== first.worldEpoch ||
      state.producerCapacity.turn !== first.turn ||
      state.producerInventory?.worldEpoch !== first.worldEpoch ||
      state.producerInventory.turn !== first.turn
    )
      throw new Error("Producer transfer requires matching world and turn generations");
  }
  return { ...first };
}

/** A merge preserves actual acquisition value; quote memos create no new assets. */
export function mergeProducerTransferState(
  states: readonly ProducerTransferState[]
): ProducerTransferState {
  const stamp = generation(states);
  if (!stamp) return {};
  const inputs = new Map<string, { commodity: string; units: number; value: number }>();
  const outputs = new Map<
    string,
    { commodity: string; book: string; units: number; knownCost: boolean; quoteValue: number }
  >();
  for (const state of states) {
    for (const stock of state.producerInventory!.inputStock) {
      amount(stock.units);
      amount(stock.value);
      if (!stock.commodity || (stock.units === 0 && stock.value !== 0))
        throw new Error("Invalid transferred input basis");
      const row = inputs.get(stock.commodity) ?? { commodity: stock.commodity, units: 0, value: 0 };
      row.units = amount(row.units + stock.units);
      row.value = amount(row.value + stock.value);
      inputs.set(stock.commodity, row);
    }
    for (const stock of state.producerInventory!.outputStock) {
      amount(stock.units);
      if (!stock.commodity || !stock.book) throw new Error("Invalid transferred goods market");
      if (stock.quoteUnitCost != null) amount(stock.quoteUnitCost);
      if (stock.units === 0) continue;
      const key = JSON.stringify([stock.commodity, stock.book]);
      const row = outputs.get(key) ?? {
        commodity: stock.commodity,
        book: stock.book,
        units: 0,
        knownCost: true,
        quoteValue: 0,
      };
      row.units = amount(row.units + stock.units);
      row.knownCost &&= stock.quoteUnitCost != null;
      if (stock.quoteUnitCost != null)
        row.quoteValue = amount(row.quoteValue + stock.units * stock.quoteUnitCost);
      outputs.set(key, row);
    }
  }
  const outputStock: ProducedStock[] = [...outputs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => ({
      commodity: row.commodity,
      book: row.book,
      units: row.units,
      ...(row.knownCost ? { quoteUnitCost: amount(row.quoteValue / row.units) } : {}),
    }));
  return {
    producerCapacity: stamp,
    producerInventory: {
      ...stamp,
      inputStock: [...inputs]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, row]) => row),
      outputStock,
    },
  };
}

/** The requested split applies to goods and their actual acquisition value together. */
export function carveProducerTransferState(
  state: ProducerTransferState,
  fraction: number
): ProducerTransferState {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error("Invalid producer stock split");
  const merged = mergeProducerTransferState([state]);
  if (!merged.producerInventory) return {};
  return {
    producerCapacity: merged.producerCapacity,
    producerInventory: {
      ...merged.producerInventory,
      inputStock: merged.producerInventory.inputStock.map((stock) => ({
        ...stock,
        units: amount(stock.units * fraction),
        value: amount(stock.value * fraction),
      })),
      outputStock: merged.producerInventory.outputStock.map((stock) => ({
        ...stock,
        units: amount(stock.units * fraction),
      })),
    },
  };
}

/** Rollbacks restore the exact lot ordering and historical quote memos. */
export function copyProducerTransferState(state: ProducerTransferState): ProducerTransferState {
  const stamp = generation([state]);
  if (!stamp) return {};
  mergeProducerTransferState([state]);
  return {
    producerCapacity: stamp,
    producerInventory: {
      ...stamp,
      inputStock: state.producerInventory!.inputStock.map((stock) => ({ ...stock })),
      outputStock: state.producerInventory!.outputStock.map((stock) => ({ ...stock })),
    },
  };
}
