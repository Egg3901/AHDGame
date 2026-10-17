import { describe, expect, it } from "vitest";
import {
  carveProducerTransferState,
  copyProducerTransferState,
  mergeProducerTransferState,
} from "./inventoryTransferRules";
import type { ProducerInventoryState } from "@/lib/db/types/producerEconomy";

const state = (
  inputStock: ProducerInventoryState["inputStock"],
  outputStock: ProducerInventoryState["outputStock"]
) => ({
  producerCapacity: { worldEpoch: "world", turn: 4 },
  producerInventory: { worldEpoch: "world", turn: 4, inputStock, outputStock },
});

describe("producer property transfers", () => {
  it("conserves physical goods, actual input value and historical quote cost across a merge", () => {
    const a = state(
      [{ commodity: "energy", units: 5, value: 20 }],
      [{ commodity: "steel", book: "world", units: 4, quoteUnitCost: 3 }]
    );
    const b = state(
      [{ commodity: "energy", units: 3, value: 18 }],
      [{ commodity: "steel", book: "world", units: 6, quoteUnitCost: 5 }]
    );
    const before = structuredClone([a, b]);
    const merged = mergeProducerTransferState([a, b]);
    expect(merged).toEqual(
      state(
        [{ commodity: "energy", units: 8, value: 38 }],
        [{ commodity: "steel", book: "world", units: 10, quoteUnitCost: 4.2 }]
      )
    );
    expect([a, b]).toEqual(before);
    expect(mergeProducerTransferState([b, a])).toEqual(merged);
  });

  it("preserves market books and never replaces an unknown historical cost with a reference price", () => {
    const merged = mergeProducerTransferState([
      state([], [{ commodity: "steel", book: "world", units: 4, quoteUnitCost: 3 }]),
      state(
        [],
        [
          { commodity: "steel", book: "world", units: 6 },
          { commodity: "steel", book: "other-book", units: 2, quoteUnitCost: 10 },
        ]
      ),
    ]);
    expect(merged.producerInventory?.outputStock).toEqual([
      { commodity: "steel", book: "other-book", units: 2, quoteUnitCost: 10 },
      { commodity: "steel", book: "world", units: 10 },
    ]);
  });

  it.each([0, 0.1, 0.5, 1])(
    "conserves quantities and paid input basis across a split at %s",
    (fraction) => {
      const source = state(
        [{ commodity: "energy", units: 10, value: 37 }],
        [{ commodity: "steel", book: "world", units: 20, quoteUnitCost: 3 }]
      );
      const a = carveProducerTransferState(source, fraction);
      const b = carveProducerTransferState(source, 1 - fraction);
      expect(
        a.producerInventory!.inputStock[0].value + b.producerInventory!.inputStock[0].value
      ).toBeCloseTo(37);
      expect(
        a.producerInventory!.inputStock[0].units + b.producerInventory!.inputStock[0].units
      ).toBeCloseTo(10);
      expect(
        a.producerInventory!.outputStock[0].units + b.producerInventory!.outputStock[0].units
      ).toBeCloseTo(20);
      expect(a.producerInventory!.outputStock[0].quoteUnitCost).toBe(3);
      expect(a.producerCapacity).toEqual(source.producerCapacity);
    }
  );

  it("restores the exact original stock lots on rollback", () => {
    const source = state(
      [
        { commodity: "energy", units: 4, value: 10 },
        { commodity: "energy", units: 3, value: 15 },
      ],
      [
        { commodity: "steel", book: "world", units: 0 },
        { commodity: "steel", book: "world", units: 5, quoteUnitCost: 2 },
      ]
    );
    const copy = copyProducerTransferState(source);
    expect(copy).toEqual(source);
    copy.producerInventory!.inputStock[0].value = 999;
    expect(source.producerInventory.inputStock[0].value).toBe(10);
  });

  it("refuses unmatched generations rather than losing unreconciled property", () => {
    const source = state([], []);
    expect(() => mergeProducerTransferState([source, {}])).toThrow("matching world and turn");
    expect(() => mergeProducerTransferState([{}, source])).toThrow("reconciled generations");
    const later = { ...source, producerInventory: { ...source.producerInventory, turn: 5 } };
    expect(() => mergeProducerTransferState([source, later])).toThrow("matching world and turn");
    const other = {
      ...source,
      producerCapacity: { ...source.producerCapacity, worldEpoch: "other-world" },
    };
    expect(() => mergeProducerTransferState([source, other])).toThrow("matching world and turn");
  });

  it.each([-1, NaN, Infinity, 1.1])("refuses an invalid split fraction %s", (fraction) => {
    expect(() => carveProducerTransferState(state([], []), fraction)).toThrow(
      "Invalid producer stock split"
    );
  });

  it("refuses fabricated input value and corrupt stock before a transfer", () => {
    expect(() =>
      mergeProducerTransferState([state([{ commodity: "energy", units: 0, value: 10 }], [])])
    ).toThrow("input basis");
    expect(() =>
      mergeProducerTransferState([
        state([], [{ commodity: "steel", book: "world", units: 5, quoteUnitCost: -1 }]),
      ])
    ).toThrow("transfer stock");
  });
});
