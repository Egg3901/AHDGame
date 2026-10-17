import type {
  ProducerInventoryState,
  ProducerGenerationStamp,
  ProducerPayablesState,
} from "@/lib/db/types/producerEconomy";

function validateStamp(worldEpoch: string, turn: number): ProducerGenerationStamp {
  if (!worldEpoch || !Number.isSafeInteger(turn) || turn < 0)
    throw new Error("Producer opening requires a valid world generation");
  return { worldEpoch, turn };
}

/** Empty physical stock at a real completed-turn boundary. */
export function emptyProducerSectorOpening(worldEpoch: string, turn: number) {
  const stamp = validateStamp(worldEpoch, turn);
  const inventory: ProducerInventoryState = {
    ...stamp,
    inputStock: [],
    outputStock: [],
  };
  return {
    producerCapacity: stamp,
    producerInventory: inventory,
  };
}

/** A new corporation has no producer creditors until its first settled trade. */
export function emptyProducerPayables(worldEpoch: string, turn: number): ProducerPayablesState {
  return { ...validateStamp(worldEpoch, turn), claims: [] };
}
